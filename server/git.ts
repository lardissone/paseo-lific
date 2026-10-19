import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

/** Like {@link git}, but returns null when git exits non-zero (missing key, no HEAD, not a repo). */
export async function gitOptional(cwd: string, args: string[]): Promise<string | null> {
  try {
    const output = await git(cwd, args);
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

// Plugin state lives in the repo's local git config under `branch.<name>.*`. That config is
// shared by every worktree and never pushed, so Lific identifiers stay out of the shared
// repository, and `git branch -m` moves the section along with the branch.

/** A branch plus any checkout of its repository, which is enough to reach the shared config. */
export interface BranchLocation {
  cwd: string;
  branch: string;
}

export type BranchKey =
  /** Linked issue identifier. */
  | "lificIssue"
  /** Comma-separated ids of agent questions that put the issue on a person. */
  | "lificPendingQuestions"
  /** JSON array of the issue's assignees before the first pending question. */
  | "lificAssigneesBeforeQuestion"
  /** Set while turns keep failing, so a failure streak is reported once. */
  | "lificFailing"
  /** `<PLAN-ID> <index>/<total>` when a plan run started this branch for one of its steps. */
  | "lificRunStep";

export async function locateBranch(cwd: string): Promise<BranchLocation | null> {
  const branch = await gitOptional(cwd, ["branch", "--show-current"]);
  return branch ? { cwd, branch } : null;
}

export function readBranchConfig(location: BranchLocation, key: BranchKey): Promise<string | null> {
  return gitOptional(location.cwd, ["config", "--get", `branch.${location.branch}.${key}`]);
}

export async function writeBranchConfig(location: BranchLocation, key: BranchKey, value: string): Promise<void> {
  await git(location.cwd, ["config", `branch.${location.branch}.${key}`, value]);
}

export async function unsetBranchConfig(location: BranchLocation, key: BranchKey): Promise<void> {
  await gitOptional(location.cwd, ["config", "--unset", `branch.${location.branch}.${key}`]);
}

export async function readLinkedIssue(cwd: string): Promise<string | null> {
  const location = await locateBranch(cwd);
  return location ? readBranchConfig(location, "lificIssue") : null;
}

export async function writeLinkedIssue(cwd: string, identifier: string): Promise<void> {
  const location = await locateBranch(cwd);
  if (!location) throw new Error("This workspace is not on a branch, so it cannot be linked.");
  await writeBranchConfig(location, "lificIssue", identifier);
}

export async function clearLinkedIssue(cwd: string): Promise<void> {
  const location = await locateBranch(cwd);
  if (location) await unsetBranchConfig(location, "lificIssue");
}

export async function writeRunStep(cwd: string, step: { plan: string; index: number; total: number }): Promise<void> {
  const location = await locateBranch(cwd);
  if (location) await writeBranchConfig(location, "lificRunStep", `${step.plan} ${step.index}/${step.total}`);
}

export async function readRunStep(cwd: string): Promise<{ plan: string; index: number; total: number } | null> {
  const location = await locateBranch(cwd);
  const value = location ? await readBranchConfig(location, "lificRunStep") : null;
  const match = value ? /^(\S+) (\d+)\/(\d+)$/.exec(value) : null;
  return match ? { plan: match[1]!, index: Number(match[2]), total: Number(match[3]) } : null;
}
