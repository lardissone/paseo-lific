import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";
import {
  CommentSchema,
  IssueCardSchema,
  IssueSchema,
  IssueStatusSchema,
  PrioritySchema,
  ProjectSummarySchema,
} from "./lific";
import {
  RunBranchingSchema,
  RunControlActionSchema,
  RunModeSchema,
  RunPauseSchema,
  RunStatusSchema,
} from "./run";

export const IssueSummarySchema = z.object({
  identifier: z.string(),
  title: z.string(),
  status: IssueStatusSchema.optional(),
  priority: PrioritySchema.optional(),
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

/** The plan step a workspace runs, when a plan run started it. */
const WorkspaceRunSchema = z
  .object({
    projectRoot: z.string(),
    plan: z.string(),
    index: z.number(),
    total: z.number(),
    status: RunStatusSchema.nullable(),
    pause: RunPauseSchema.nullable(),
  })
  .nullable();

export const WorkspaceIssueSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unconfigured") }),
  z.object({ state: z.literal("unlinked"), run: WorkspaceRunSchema }),
  z.object({ state: z.literal("unavailable"), identifier: z.string(), error: z.string(), run: WorkspaceRunSchema }),
  z.object({
    state: z.literal("linked"),
    issue: IssueSchema,
    comments: z.array(CommentSchema),
    url: z.string(),
    run: WorkspaceRunSchema,
  }),
]);
export type WorkspaceIssue = z.output<typeof WorkspaceIssueSchema>;

export const getWorkspaceIssue = defineRpc({
  name: "lific.workspace.issue",
  input: z.object({ directory: z.string() }),
  output: WorkspaceIssueSchema,
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

export const searchAttachments = defineRpc({
  name: "lific.attachments.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const lificAttachments = defineAttachmentSource({
  id: "lific",
  title: "Lific issue, page, or plan",
  icon: "SquareKanban",
  pickerTitle: "Attach from Lific",
  searchPlaceholder: "Search, or type MIO-23, MIO-DOC-4, MIO-PLAN-2",
  search: searchAttachments,
});

export const SlashCommandSchema = z.enum(["issue", "file", "done", "block", "briefing"]);
export type SlashCommand = z.output<typeof SlashCommandSchema>;

export const runSlashCommand = defineRpc({
  name: "lific.command.run",
  input: z.object({
    command: SlashCommandSchema,
    args: z.string(),
    agentId: z.string(),
    directory: z.string(),
    projectRoot: z.string(),
  }),
  output: z.object({}),
});

export const getBriefing = defineRpc({
  name: "lific.briefing.get",
  input: z.object({ project: z.string(), since: z.string().optional() }),
  output: z.object({ markdown: z.string(), fetchedAt: z.string() }),
});

export const listPlans = defineRpc({
  name: "lific.plans.list",
  input: z.object({ projectRoot: z.string() }),
  output: z.object({
    plans: z.array(
      z.object({
        identifier: z.string(),
        title: z.string(),
        status: z.string(),
        stepCount: z.number(),
        doneCount: z.number(),
      }),
    ),
  }),
});

export const getPlanPreview = defineRpc({
  name: "lific.plans.preview",
  input: z.object({ identifier: z.string() }),
  output: z.object({
    steps: z.array(z.object({ depth: z.number(), title: z.string(), issue: z.string().nullable(), done: z.boolean() })),
  }),
});

export const startRun = defineRpc({
  name: "lific.run.start",
  input: z.object({
    projectRoot: z.string(),
    plan: z.string(),
    mode: RunModeSchema,
    branching: RunBranchingSchema,
    base: z.string().min(1),
    provider: z.string().min(1),
    /** Archive a step's workspace once the next stacked step starts from its branch. */
    archivePrevious: z.boolean(),
  }),
  output: z.object({}),
});

export const controlRun = defineRpc({
  name: "lific.run.control",
  input: z.object({
    projectRoot: z.string(),
    plan: z.string(),
    action: RunControlActionSchema,
  }),
  output: z.object({}),
});

export const RunSummarySchema = z.object({
  projectRoot: z.string(),
  plan: z.string(),
  title: z.string(),
  status: RunStatusSchema,
  pause: RunPauseSchema.nullable(),
  mode: RunModeSchema,
  doneCount: z.number(),
  stepCount: z.number(),
  /** First unfinished step; its issue is null until the run creates one. */
  current: z.object({ identifier: z.string().nullable(), title: z.string() }).nullable(),
});
export type RunSummary = z.output<typeof RunSummarySchema>;

export const HomeSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }),
  z.object({
  configured: z.literal(true),
  inProgress: z.array(
    z.object({ workspaceId: z.string(), workspaceName: z.string(), issue: IssueCardSchema }),
  ),
  needsYou: z.array(
    IssueCardSchema.extend({ reason: z.enum(["assigned", "human", "waiting"]), projectName: z.string() }),
  ),
  projects: z.array(
    z.object({
      project: ProjectSummarySchema,
      projectRoot: z.string(),
      ready: z.array(IssueCardSchema),
    }),
  ),
  unlinkedProjects: z.array(ProjectSummarySchema),
  runs: z.array(RunSummarySchema),
  }),
]);
export type Home = z.output<typeof HomeSchema>;
export type ConfiguredHome = Extract<Home, { configured: true }>;

export const getHome = defineRpc({
  name: "lific.home.get",
  input: z.object({}),
  output: HomeSchema,
});
