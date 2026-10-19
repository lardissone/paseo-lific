import { z } from "zod";
import { RunBranchingSchema, RunModeSchema } from "../shared/rpc";
import { git, gitOptional } from "./git";

// Plan runs live in the repository's local git config, like issue links: shared by every
// worktree, never pushed, and readable with no app connected.
//   lific-run.<PLAN-ID>.status | reason | mode | branching | base | provider | approved | archive
// git lowercases variable names, so keys are single lowercase words.

export const RunStatusSchema = z.enum(["running", "paused", "done", "stopped"]);

export const RunRecordSchema = z.object({
  plan: z.string(),
  status: RunStatusSchema,
  /** Why the run is paused: `review:<ISSUE>`, `failed:<ISSUE>`, `cancelled:<ISSUE>`, or `manual`. */
  reason: z.string().optional(),
  mode: RunModeSchema,
  branching: RunBranchingSchema,
  base: z.string(),
  provider: z.string(),
  /** Last step issue the person approved in review mode. */
  approved: z.string().optional(),
  /** `yes` archives a step's workspace once the next stacked step starts from its branch. */
  archive: z.enum(["yes", "no"]).default("no"),
});
export type RunRecord = z.output<typeof RunRecordSchema>;

const SECTION = "lific-run";
const FIELDS = ["status", "reason", "mode", "branching", "base", "provider", "approved", "archive"] as const;

export async function listRuns(repo: string): Promise<RunRecord[]> {
  const output = await gitOptional(repo, ["config", "--local", "--get-regexp", `^${SECTION}\\.`]);
  if (!output) return [];
  const raw = new Map<string, Record<string, string>>();
  for (const line of output.split("\n")) {
    const space = line.indexOf(" ");
    const name = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    const lastDot = name.lastIndexOf(".");
    const plan = name.slice(SECTION.length + 1, lastDot);
    const field = name.slice(lastDot + 1);
    raw.set(plan, { ...raw.get(plan), [field]: value });
  }
  return [...raw].flatMap(([plan, fields]) => {
    const parsed = RunRecordSchema.safeParse({ plan, ...fields });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function readRun(repo: string, plan: string): Promise<RunRecord | null> {
  return (await listRuns(repo)).find((run) => run.plan === plan) ?? null;
}

export async function writeRun(repo: string, run: RunRecord): Promise<void> {
  for (const field of FIELDS) {
    const key = `${SECTION}.${run.plan}.${field}`;
    const value = run[field];
    if (value === undefined) await gitOptional(repo, ["config", "--local", "--unset", key]);
    else await git(repo, ["config", "--local", key, value]);
  }
}

export async function deleteRun(repo: string, plan: string): Promise<void> {
  await gitOptional(repo, ["config", "--local", "--remove-section", `${SECTION}.${plan}`]);
}

/** Branches linked to an issue, keyed by issue identifier. */
export async function linkedBranches(repo: string): Promise<Map<string, string>> {
  const output = await gitOptional(repo, ["config", "--local", "--get-regexp", "^branch\\..*\\.lificissue$"]);
  const branches = new Map<string, string>();
  if (!output) return branches;
  for (const line of output.split("\n")) {
    const [name = "", identifier = ""] = line.split(" ");
    branches.set(identifier, name.slice("branch.".length, -".lificissue".length));
  }
  return branches;
}

/** Worktree path checked out on `branch`, if any. */
export async function worktreeForBranch(repo: string, branch: string): Promise<string | null> {
  const output = await gitOptional(repo, ["worktree", "list", "--porcelain"]);
  if (!output) return null;
  let path: string | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}
