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

/** Same route the Lific web UI and its own link builder use (src/links.rs). */
export function issueWebUrl(baseUrl: string, identifier: string): string {
  const project = identifier.slice(0, identifier.lastIndexOf("-"));
  return `${baseUrl.replace(/\/+$/, "")}/${project}/issues/${identifier}`;
}
