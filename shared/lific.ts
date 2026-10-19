import { z } from "zod";

export const IssueStatusSchema = z.enum(["backlog", "todo", "active", "done", "cancelled"]);
export type IssueStatus = z.output<typeof IssueStatusSchema>;

export const ISSUE_STATUSES = IssueStatusSchema.options;

export const IssueSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  status: IssueStatusSchema,
  priority: z.enum(["urgent", "high", "medium", "low", "none"]),
  labels: z.array(z.string()),
  seq: z.number(),
  updated_at: z.string(),
  needs_human: z.boolean(),
  blocked_by: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
  assignees: z
    .array(z.object({ user_id: z.number(), username: z.string(), display_name: z.string().optional() }))
    .optional(),
});
export type Issue = z.output<typeof IssueSchema>;

export const CommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  author_display_name: z.string(),
  content: z.string(),
  created_at: z.string(),
});
export type Comment = z.output<typeof CommentSchema>;

export const ProjectSummarySchema = z.object({
  id: z.number(),
  identifier: z.string(),
  name: z.string(),
});
export type ProjectSummary = z.output<typeof ProjectSummarySchema>;

export const PageSchema = z.object({
  id: z.number(),
  identifier: z.string(),
  title: z.string(),
  content: z.string(),
  status: z.string(),
});
export type Page = z.output<typeof PageSchema>;

export interface PlanStep {
  id: number;
  issue_id: number | null;
  title: string;
  description: string;
  done: boolean;
  issue_identifier?: string;
  issue_status?: string;
  children: PlanStep[];
}

export const PlanStepSchema: z.ZodType<PlanStep> = z.lazy(() =>
  z.object({
    id: z.number(),
    issue_id: z.number().nullable(),
    title: z.string(),
    description: z.string(),
    done: z.boolean(),
    issue_identifier: z.string().optional(),
    issue_status: z.string().optional(),
    children: z.array(PlanStepSchema),
  }),
);

export const PlanSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  identifier: z.string(),
  title: z.string(),
  status: z.string(),
  step_count: z.number(),
  done_count: z.number(),
  // Plan lists may omit the tree.
  steps: z.array(PlanStepSchema).default([]),
});
export type Plan = z.output<typeof PlanSchema>;

/** Same route the Lific web UI and its own link builder use (src/links.rs). */
export function issueWebUrl(baseUrl: string, identifier: string): string {
  const project = identifier.slice(0, identifier.lastIndexOf("-"));
  return `${baseUrl.replace(/\/+$/, "")}/${project}/issues/${identifier}`;
}

/** Web URL of a page (`P-DOC-n`) or plan (`P-PLAN-n`); links use the numeric id. */
export function resourceWebUrl(baseUrl: string, identifier: string, kind: "pages" | "plans", id: number): string {
  const marker = kind === "pages" ? "-DOC-" : "-PLAN-";
  const index = identifier.lastIndexOf(marker);
  const project = index > 0 ? identifier.slice(0, index) : "DOC";
  return `${baseUrl.replace(/\/+$/, "")}/${project}/${kind}/${id}`;
}

export const IssueCardSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  status: IssueStatusSchema,
  priority: z.string(),
  url: z.string(),
});
export type IssueCard = z.output<typeof IssueCardSchema>;

export function issueCard(baseUrl: string, issue: Issue): IssueCard {
  return {
    identifier: issue.identifier,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    url: issueWebUrl(baseUrl, issue.identifier),
  };
}
