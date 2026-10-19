import { z } from "zod";
import {
  formatRunPause,
  parseRunPause,
  type RunBranching,
  RunBranchingSchema,
  type RunMode,
  RunModeSchema,
  type RunPause,
  type RunStatus,
  RunStatusSchema,
} from "../shared/run";
import { git, gitOptional } from "./git";

// Plan runs live in the repository's local git config, like issue links: shared by every
// worktree, never pushed, and readable with no app connected.
//   lific-run.<PLAN-ID>.status | reason | mode | branching | base | provider | approved | archive
// git lowercases variable names, so keys are single lowercase words.

export interface RunRecord {
  plan: string;
  status: RunStatus;
  /** Set exactly when `status` is `paused`. */
  pause: RunPause | null;
  mode: RunMode;
  branching: RunBranching;
  base: string;
  provider: string;
  /** Last step issue the person approved in review mode. */
  approved: string | null;
  /** Archive a step's workspace once the next stacked step starts from its branch. */
  archive: boolean;
}

const StoredRunSchema = z.object({
  status: RunStatusSchema,
  reason: z.string().optional(),
  mode: RunModeSchema,
  branching: RunBranchingSchema,
  base: z.string(),
  provider: z.string(),
  approved: z.string().optional(),
  archive: z.enum(["true", "false"]).default("false"),
});

const SECTION = "lific-run";

function toStored(run: RunRecord): Record<keyof z.output<typeof StoredRunSchema>, string | undefined> {
  return {
    status: run.status,
    reason: run.pause ? formatRunPause(run.pause) : undefined,
    mode: run.mode,
    branching: run.branching,
    base: run.base,
    provider: run.provider,
    approved: run.approved ?? undefined,
    archive: String(run.archive),
  };
}

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
    raw.set(plan, { ...raw.get(plan), [name.slice(lastDot + 1)]: value });
  }
  return [...raw].flatMap(([plan, fields]) => {
    const parsed = StoredRunSchema.safeParse(fields);
    if (!parsed.success) return [];
    const stored = parsed.data;
    const pause = stored.status === "paused" ? (parseRunPause(stored.reason ?? "") ?? { kind: "manual" as const }) : null;
    return [
      {
        plan,
        status: stored.status,
        pause,
        mode: stored.mode,
        branching: stored.branching,
        base: stored.base,
        provider: stored.provider,
        approved: stored.approved ?? null,
        archive: stored.archive === "true",
      },
    ];
  });
}

export async function readRun(repo: string, plan: string): Promise<RunRecord | null> {
  return (await listRuns(repo)).find((run) => run.plan === plan) ?? null;
}

export async function writeRun(repo: string, run: RunRecord): Promise<void> {
  for (const [field, value] of Object.entries(toStored(run))) {
    const key = `${SECTION}.${run.plan}.${field}`;
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

/** Worktree path checked out on `branch`, as git reports it (a real path), if any. */
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
