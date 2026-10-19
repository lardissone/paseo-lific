import { z } from "zod";
import {
  type Comment,
  CommentSchema,
  type Issue,
  IssueSchema,
  type Page,
  PageSchema,
  type Plan,
  PlanSchema,
  type IssueStatus,
  type ProjectSummary,
  ProjectSummarySchema,
} from "../shared/lific";
import type { RepoAlias } from "./repo-identity";

export class LificError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const ErrorBodySchema = z.object({ error: z.string() });

const ResolutionSchema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("none") }),
  z.object({ resolution: z.literal("one"), project: ProjectSummarySchema }),
  z.object({ resolution: z.literal("conflict"), projects: z.array(ProjectSummarySchema) }),
]);
export type RepoResolution = z.output<typeof ResolutionSchema>;

const ToolResponseSchema = z.object({
  result: z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
});

interface LificClientOptions {
  baseUrl: string;
  apiKey: string;
  request?: typeof fetch;
}

export type LificClient = ReturnType<typeof createLificClient>;

export function createLificClient({ baseUrl, apiKey, request = fetch }: LificClientOptions) {
  const root = `${baseUrl.replace(/\/+$/, "")}/api`;

  async function call<T>(
    schema: z.ZodType<T>,
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await request(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new LificError(`Cannot reach Lific at ${baseUrl}: ${String(error)}`, 0);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorBodySchema.safeParse(payload);
      const detail = parsed.success ? parsed.data.error : response.statusText;
      throw new LificError(`Lific ${method} ${path} failed (${response.status}): ${detail}`, response.status);
    }
    return schema.parse(payload);
  }

  function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const text = search.toString();
    return text === "" ? "" : `?${text}`;
  }

  return {
    listProjects(): Promise<ProjectSummary[]> {
      return call(z.array(ProjectSummarySchema), "GET", "/projects");
    },

    createIssue(params: { projectId: number; title: string; description: string }): Promise<Issue> {
      return call(IssueSchema, "POST", "/issues", {
        project_id: params.projectId,
        title: params.title,
        description: params.description,
        status: "backlog",
      });
    },

    /**
     * Calls a Lific MCP tool over `POST /mcp`. Lific serves MCP statelessly with JSON responses,
     * so a single `tools/call` needs no session. Used for tools with no REST equivalent.
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
      let response: Response;
      try {
        response = await request(`${baseUrl.replace(/\/+$/, "")}/mcp`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        });
      } catch (error) {
        throw new LificError(`Cannot reach Lific at ${baseUrl}: ${String(error)}`, 0);
      }
      if (!response.ok) throw new LificError(`Lific MCP ${name} failed (${response.status})`, response.status);
      const envelope = ToolResponseSchema.parse(await response.json());
      if (envelope.error) throw new LificError(`Lific MCP ${name} failed: ${envelope.error.message}`, 200);
      const text = envelope.result?.content
        .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
        .join("\n");
      if (envelope.result?.isError) throw new LificError(text || `Lific MCP ${name} failed`, 200);
      return text ?? "";
    },

    resolveRepo(aliases: RepoAlias[]): Promise<RepoResolution> {
      return call(ResolutionSchema, "POST", "/repos/resolve", { aliases });
    },

    getIssue(identifier: string): Promise<Issue> {
      return call(IssueSchema, "GET", `/issues/resolve/${encodeURIComponent(identifier)}`);
    },

    listIssues(params: {
      projectId: number;
      workable?: boolean;
      limit?: number;
    }): Promise<Issue[]> {
      return call(
        z.array(IssueSchema),
        "GET",
        `/issues${query({
          project_id: params.projectId,
          workable: params.workable,
          limit: params.limit,
          order_by: "priority",
        })}`,
      );
    },

    /** Open issues that need a person: assigned to the key's owner, marked for anyone, or waiting on them. */
    attention(): Promise<{ assigned: Issue[]; human: Issue[]; waiting: Issue[] }> {
      return call(
        z.object({ assigned: z.array(IssueSchema), human: z.array(IssueSchema), waiting: z.array(IssueSchema) }),
        "GET",
        "/issues/attention",
      );
    },

    getPage(id: number): Promise<Page> {
      return call(PageSchema, "GET", `/pages/${id}`);
    },

    resolvePage(identifier: string): Promise<Page> {
      return call(PageSchema, "GET", `/pages/resolve/${encodeURIComponent(identifier)}`);
    },

    resolvePlan(identifier: string): Promise<Plan> {
      return call(PlanSchema, "GET", `/plans/resolve/${encodeURIComponent(identifier)}`);
    },

    search(params: { query: string; limit: number }): Promise<{ result_type: string; id: number; identifier: string | null }[]> {
      return call(
        z.array(z.object({ result_type: z.string(), id: z.number(), identifier: z.string().nullable() })),
        "GET",
        `/search${query({ query: params.query, limit: params.limit })}`,
      );
    },

    async searchIssues(params: {
      query: string;
      projectId?: number;
    }): Promise<{ identifier: string; title: string }[]> {
      const results = await call(
        z.array(z.object({ identifier: z.string().nullable(), title: z.string() })),
        "GET",
        `/search${query({ query: params.query, project_id: params.projectId, result_type: "issue", limit: 20 })}`,
      );
      return results.flatMap(({ identifier, title }) => (identifier ? [{ identifier, title }] : []));
    },

    updateIssue(
      issue: Issue,
      changes: { status?: IssueStatus; assignees?: string[] },
    ): Promise<Issue> {
      return call(IssueSchema, "PUT", `/issues/${issue.id}`, { ...changes, expected_seq: issue.seq });
    },

    /** Writes with `expected_seq`; on a conflict, re-reads the issue and applies the change once more. */
    async updateIssueByIdentifier(
      identifier: string,
      changes: { status?: IssueStatus; assignees?: string[] },
    ): Promise<Issue> {
      try {
        return await this.updateIssue(await this.getIssue(identifier), changes);
      } catch (error) {
        if (!(error instanceof LificError) || error.status !== 409) throw error;
        return this.updateIssue(await this.getIssue(identifier), changes);
      }
    },

    listRecentComments(issue: Issue, limit: number): Promise<Comment[]> {
      return call(
        z.array(CommentSchema),
        "GET",
        `/issues/${issue.id}/comments${query({ order: "desc", limit })}`,
      );
    },

    addComment(issue: Issue, content: string): Promise<Comment> {
      return call(CommentSchema, "POST", `/issues/${issue.id}/comments`, { content });
    },
  };
}
