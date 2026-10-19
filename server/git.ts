import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
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

/** The plan step a branch was started for. */
export interface RunStep {
  plan: string;
  index: number;
  total: number;
}

export async function writeRunStep(cwd: string, step: RunStep): Promise<void> {
  const location = await locateBranch(cwd);
  if (location) await writeBranchConfig(location, "lificRunStep", `${step.plan} ${step.index}/${step.total}`);
}

export async function readRunStep(location: BranchLocation | null): Promise<RunStep | null> {
  const value = location ? await readBranchConfig(location, "lificRunStep") : null;
  const match = value ? /^(\S+) (\d+)\/(\d+)$/.exec(value) : null;
  return match ? { plan: match[1]!, index: Number(match[2]), total: Number(match[3]) } : null;
}

/**
 * Main checkout of the repository containing `cwd`, also from a linked worktree, as a real path.
 * Every caller keys locks and compares paths with this form, so `/tmp` vs `/private/tmp` or a
 * symlinked home cannot make one repository look like two.
 */
export async function repositoryRoot(cwd: string): Promise<string | null> {
  // `--path-format=absolute` needs git 2.31; resolve the relative form ourselves instead.
  const common = await gitOptional(cwd, ["rev-parse", "--git-common-dir"]);
  if (!common) return null;
  return canonicalPath(resolve(cwd, common, ".."));
}

export async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/** Local branches, most recently committed first, and the branch new work should start from. */
export async function listBranches(repo: string): Promise<{ branches: string[]; defaultBranch: string | null }> {
  const output = await gitOptional(repo, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]);
  const originHead = await gitOptional(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const branches = output ? output.split("\n") : [];
  const remoteDefault = originHead?.replace(/^origin\//, "") ?? null;
  const defaultBranch =
    remoteDefault && branches.includes(remoteDefault)
      ? remoteDefault
      : (["main", "master"].find((name) => branches.includes(name)) ?? branches[0] ?? null);
  return { branches, defaultBranch };
}
