import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git, writeLinkedIssue } from "./git";
import { deleteRun, linkedBranches, listRuns, readRun, type RunRecord, worktreeForBranch, writeRun } from "./run-store";

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "lific-runs-"));
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root"]);
});

afterEach(async () => {
  await rm(`${repo}-wt`, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

const run: RunRecord = {
  plan: "MIO-PLAN-2",
  status: "paused",
  pause: { kind: "review", issue: "MIO-23" },
  mode: "review",
  branching: "stacked",
  base: "main",
  provider: "claude/opus",
  approved: null,
  archive: true,
};

describe("run records", () => {
  it("round-trips, updates, and deletes", async () => {
    await writeRun(repo, run);
    expect(await listRuns(repo)).toEqual([run]);

    const resumed = { ...run, status: "running" as const, pause: null, approved: "MIO-23" };
    await writeRun(repo, resumed);
    expect(await readRun(repo, "MIO-PLAN-2")).toEqual(resumed);

    await deleteRun(repo, "MIO-PLAN-2");
    expect(await listRuns(repo)).toEqual([]);
  });
});

describe("linked branches", () => {
  it("maps issues to branches, including names with dots and slashes", async () => {
    await git(repo, ["switch", "-q", "-c", "feat/v1.2-sync"]);
    await writeLinkedIssue(repo, "MIO-23");
    await git(repo, ["switch", "-q", "main"]);
    expect(await linkedBranches(repo)).toEqual(new Map([["MIO-23", "feat/v1.2-sync"]]));
  });

  it("finds the worktree checked out on a branch", async () => {
    await git(repo, ["worktree", "add", "-q", "-b", "step-one", `${repo}-wt`]);
    expect(await worktreeForBranch(repo, "step-one")).toMatch(/-wt$/);
    expect(await worktreeForBranch(repo, "missing")).toBeNull();
  });
});
