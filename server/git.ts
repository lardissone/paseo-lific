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

export function currentBranch(cwd: string): Promise<string | null> {
  return gitOptional(cwd, ["branch", "--show-current"]);
}

// The issue link lives in the repo's local git config, which is shared by every worktree and
// never pushed, so Lific identifiers stay out of the shared repository. `git branch -m` moves the
// section along with the branch.
const ISSUE_KEY = "lificIssue";

export async function readLinkedIssue(cwd: string): Promise<string | null> {
  const branch = await currentBranch(cwd);
  if (!branch) return null;
  return gitOptional(cwd, ["config", "--get", `branch.${branch}.${ISSUE_KEY}`]);
}

export async function writeLinkedIssue(cwd: string, identifier: string): Promise<void> {
  const branch = await currentBranch(cwd);
  if (!branch) throw new Error("This workspace is not on a branch, so it cannot be linked.");
  await git(cwd, ["config", `branch.${branch}.${ISSUE_KEY}`, identifier]);
}

export async function clearLinkedIssue(cwd: string): Promise<void> {
  const branch = await currentBranch(cwd);
  if (!branch) return;
  await gitOptional(cwd, ["config", "--unset", `branch.${branch}.${ISSUE_KEY}`]);
}
