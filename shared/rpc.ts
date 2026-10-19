import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { CommentSchema, IssueSchema, IssueStatusSchema, ProjectSummarySchema } from "./lific";

export const IssueSummarySchema = z.object({
  identifier: z.string(),
  title: z.string(),
  status: IssueStatusSchema.optional(),
  priority: z.string().optional(),
});
export type IssueSummary = z.output<typeof IssueSummarySchema>;

export const checkConnection = defineRpc({
  name: "lific.connection.check",
  input: z.object({}),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), projects: z.array(ProjectSummarySchema) }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

const ProjectResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unconfigured") }),
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("conflict"), projects: z.array(ProjectSummarySchema) }),
  z.object({
    kind: z.literal("resolved"),
    project: ProjectSummarySchema,
    source: z.enum(["binding", "override"]),
  }),
]);
export type ProjectResolution = z.output<typeof ProjectResolutionSchema>;

export const resolveProject = defineRpc({
  name: "lific.project.resolve",
  input: z.object({ projectRoot: z.string() }),
  output: ProjectResolutionSchema,
});

export const getWorkspaceIssue = defineRpc({
  name: "lific.workspace.issue",
  input: z.object({ directory: z.string() }),
  output: z.object({
    configured: z.boolean(),
    identifier: z.string().nullable(),
    issue: IssueSchema.nullable(),
    comments: z.array(CommentSchema),
    url: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const linkWorkspaceIssue = defineRpc({
  name: "lific.workspace.link",
  input: z.object({ directory: z.string(), identifier: z.string().nullable() }),
  output: z.object({}),
});

export const listIssues = defineRpc({
  name: "lific.issues.list",
  input: z.object({ projectRoot: z.string(), query: z.string() }),
  output: z.object({ issues: z.array(IssueSummarySchema) }),
});

export const setIssueStatus = defineRpc({
  name: "lific.issue.status.set",
  input: z.object({ identifier: z.string(), status: IssueStatusSchema }),
  output: z.object({}),
});

export const addIssueComment = defineRpc({
  name: "lific.issue.comment.add",
  input: z.object({ identifier: z.string(), content: z.string().trim().min(1) }),
  output: z.object({}),
});

export const listBranches = defineRpc({
  name: "lific.git.branches.list",
  input: z.object({ projectRoot: z.string() }),
  output: z.object({ branches: z.array(z.string()), defaultBranch: z.string().nullable() }),
});

export const startWork = defineRpc({
  name: "lific.work.start",
  input: z.object({
    identifier: z.string(),
    projectRoot: z.string(),
    baseBranch: z.string().min(1),
    branchName: z.string().min(1),
    provider: z.string().min(1),
  }),
  output: z.object({ workspaceId: z.string(), agentId: z.string() }),
});
