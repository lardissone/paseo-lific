import { z } from "zod";
import {
  type Comment,
  CommentSchema,
  type Issue,
  IssueSchema,
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
