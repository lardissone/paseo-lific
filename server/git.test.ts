import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLinkedIssue, git, readLinkedIssue, writeLinkedIssue } from "./git";

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "lific-git-"));
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("issue link", () => {
  it("is shared with linked worktrees", async () => {
    await git(repo, ["switch", "-q", "-c", "fix-sync"]);
    await writeLinkedIssue(repo, "MIO-23");
    await git(repo, ["switch", "-q", "main"]);
    const worktree = join(repo, "..", `${repo.split("/").pop()}-wt`);
    await git(repo, ["worktree", "add", "-q", worktree, "fix-sync"]);
    try {
      expect(await readLinkedIssue(worktree)).toBe("MIO-23");
      expect(await readLinkedIssue(repo)).toBeNull();
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("follows a branch rename", async () => {
    await git(repo, ["switch", "-q", "-c", "fix-sync"]);
    await writeLinkedIssue(repo, "MIO-23");
    await git(repo, ["branch", "-m", "better-name"]);
    expect(await readLinkedIssue(repo)).toBe("MIO-23");
  });

  it("can be cleared", async () => {
    await writeLinkedIssue(repo, "MIO-23");
    await clearLinkedIssue(repo);
    expect(await readLinkedIssue(repo)).toBeNull();
  });
});
