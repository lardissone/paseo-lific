import { z } from "zod";
import {
  type Comment,
  CommentSchema,
  instanceRoot,
  type Issue,
  IssueSchema,
  type IssueStatus,
  type Page,
  PageSchema,
  type Plan,
  PlanSchema,
  type ProjectSummary,
  ProjectSummarySchema,
} from "../shared/lific";
import type { RepoAlias } from "./repo-identity";

/** Per-request budget. A Lific behind an unreachable VPN drops packets instead of refusing them. */
const REQUEST_TIMEOUT_MS = 10_000;

export class LificError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null when the request never got a response or the MCP call reported an error. */
    readonly status: number | null,
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

const SearchResultSchema = z.object({
  result_type: z.string(),
  id: z.number(),
  identifier: z.string().nullable(),
  title: z.string(),
});

const AttentionSchema = z.object({
  assigned: z.array(IssueSchema),
  human: z.array(IssueSchema),
  waiting: z.array(IssueSchema),
});

type IssueChanges = { status?: IssueStatus; assignees?: string[] };

interface LificClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Test seam; production uses the global fetch. */
  request?: typeof fetch;
}

export type LificClient = ReturnType<typeof createLificClient>;

export function createLificClient({ baseUrl, apiKey, request = fetch }: LificClientOptions) {
  const root = instanceRoot(baseUrl);

  async function send(path: string, init: { method: string; body?: unknown; accept?: string }): Promise<Response> {
    // A manual controller: the client's type environment mixes React Native and Node globals,
    // and only Node's AbortSignal declares `timeout()`.
    // The timer stays armed after the headers arrive so it also bounds reading the body.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS).unref();
    try {
      return await request(`${root}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: init.accept ?? "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = controller.signal.aborted ? `no response within ${REQUEST_TIMEOUT_MS / 1000} s` : String(error);
      throw new LificError(`Cannot reach Lific at ${root}: ${reason}`, null);
    }
  }

  async function call<T>(schema: z.ZodType<T>, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const response = await send(`/api${path}`, { method, body });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorBodySchema.safeParse(payload);
      const detail = parsed.success ? parsed.data.error : response.statusText;
      throw new LificError(`Lific ${method} ${path} failed (${response.status}): ${detail}`, response.status);
    }
    return schema.parse(payload);
  }

  /**
   * Calls a Lific MCP tool over `POST /mcp`. Lific serves MCP statelessly with JSON responses,
   * so a single `tools/call` needs no session. Used for tools with no REST equivalent.
   */
  async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await send("/mcp", {
      method: "POST",
      accept: "application/json, text/event-stream",
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    });
    if (!response.ok) throw new LificError(`Lific MCP ${name} failed (${response.status})`, response.status);
    const envelope = ToolResponseSchema.parse(await response.json());
    if (envelope.error) throw new LificError(`Lific MCP ${name} failed: ${envelope.error.message}`, null);
    const text = envelope.result?.content
      .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
      .join("\n");
    if (envelope.result?.isError) throw new LificError(text || `Lific MCP ${name} failed`, null);
    return text ?? "";
  }

  function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const text = search.toString();
    return text === "" ? "" : `?${text}`;
  }

  function getIssue(identifier: string): Promise<Issue> {
    return call(IssueSchema, "GET", `/issues/resolve/${encodeURIComponent(identifier)}`);
  }

  function updateIssue(issue: Issue, changes: IssueChanges): Promise<Issue> {
    return call(IssueSchema, "PUT", `/issues/${issue.id}`, { ...changes, expected_seq: issue.seq });
  }

  return {
    getIssue,
    updateIssue,

    listProjects(): Promise<ProjectSummary[]> {
      return call(z.array(ProjectSummarySchema), "GET", "/projects");
    },

    resolveRepo(aliases: RepoAlias[]): Promise<RepoResolution> {
      return call(ResolutionSchema, "POST", "/repos/resolve", { aliases });
    },

    createIssue(params: { projectId: number; title: string; description: string }): Promise<Issue> {
      return call(IssueSchema, "POST", "/issues", {
        project_id: params.projectId,
        title: params.title,
        description: params.description,
        status: "backlog",
      });
    },

    listIssues(params: { projectId: number; workable?: boolean; limit?: number }): Promise<Issue[]> {
      return call(
        z.array(IssueSchema),
        "GET",
        `/issues${query({ project_id: params.projectId, workable: params.workable, limit: params.limit, order_by: "priority" })}`,
      );
    },

    /** Open issues that need a person: assigned to the key's owner, marked for anyone, or waiting on them. */
    attention(): Promise<z.output<typeof AttentionSchema>> {
      return call(AttentionSchema, "GET", "/issues/attention");
    },

    /** Applies `changes` with `expected_seq`; on a conflict, re-reads the issue and applies them once more. */
    async updateIssueByIdentifier(identifier: string, changes: IssueChanges): Promise<Issue> {
      try {
        return await updateIssue(await getIssue(identifier), changes);
      } catch (error) {
        if (!(error instanceof LificError) || error.status !== 409) throw error;
        return updateIssue(await getIssue(identifier), changes);
      }
    },

    listRecentComments(issue: Issue, limit: number): Promise<Comment[]> {
      return call(z.array(CommentSchema), "GET", `/issues/${issue.id}/comments${query({ order: "desc", limit })}`);
    },

    addComment(issue: Issue, content: string): Promise<Comment> {
      return call(CommentSchema, "POST", `/issues/${issue.id}/comments`, { content });
    },

    search(params: { query: string; limit: number; projectId?: number; issuesOnly?: boolean }) {
      return call(
        z.array(SearchResultSchema),
        "GET",
        `/search${query({
          query: params.query,
          limit: params.limit,
          project_id: params.projectId,
          result_type: params.issuesOnly ? "issue" : undefined,
        })}`,
      );
    },

    getPage(id: number): Promise<Page> {
      return call(PageSchema, "GET", `/pages/${id}`);
    },

    resolvePage(identifier: string): Promise<Page> {
      return call(PageSchema, "GET", `/pages/resolve/${encodeURIComponent(identifier)}`);
    },

    listPlans(projectId: number): Promise<Plan[]> {
      return call(z.array(PlanSchema), "GET", `/plans${query({ project_id: projectId, limit: 50 })}`);
    },

    resolvePlan(identifier: string): Promise<Plan> {
      return call(PlanSchema, "GET", `/plans/resolve/${encodeURIComponent(identifier)}`);
    },

    async linkPlanStep(plan: Plan, stepId: number, issueId: number): Promise<void> {
      await call(z.unknown(), "PUT", `/plans/${plan.id}/steps/${stepId}`, { issue_id: issueId });
    },

    async checkPlanStep(plan: Plan, stepId: number): Promise<void> {
      await call(z.unknown(), "PUT", `/plans/${plan.id}/steps/${stepId}`, { done: true });
    },

    /** Markdown project briefing; MCP only, Lific has no REST route for it. */
    getBriefing(project: string, since?: string): Promise<string> {
      return callTool("get_briefing", { project, ...(since ? { since } : {}) });
    },
  };
}
