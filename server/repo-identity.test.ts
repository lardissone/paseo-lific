import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "./git";
import { computeRepoAliases, normalizeRemoteUrl } from "./repo-identity";

// Cases copied from Lific's src/repo_identity.rs unit tests.
describe("normalizeRemoteUrl", () => {
  it.each([
    "ssh://git@github.com/VoidNullable/lific.git",
    "git@github.com:VoidNullable/lific.git",
    "git@github.com:VoidNullable/lific",
    "https://github.com/VoidNullable/lific",
    "https://github.com/VoidNullable/lific.git",
    "git://github.com/VoidNullable/lific.git",
    "https://github.com/VoidNullable/lific/",
  ])("normalizes %s", (url) => {
    expect(normalizeRemoteUrl(url)).toBe("v1:github.com/VoidNullable/lific");
  });

  it.each([
    ["https://host/a/b.git.git", "v1:host/a/b.git"],
    ["https://user:pass@host/a/b", "v1:host/a/b"],
    ["https://user@host/a/b", "v1:host/a/b"],
    ["ssh://git@host:2222/a/b.git", "v1:host:2222/a/b"],
    ["https://host:8443/a/b", "v1:host:8443/a/b"],
    ["git@GitHub.com:VoidNullable/lific.git", "v1:github.com/VoidNullable/lific"],
    ["https://GITHUB.COM/VoidNullable/Lific", "v1:github.com/VoidNullable/Lific"],
    ["ssh://git@[::1]:2222/a/b.git", "v1:[::1]:2222/a/b"],
    ["ssh://[2001:DB8::1]/a/b", "v1:[2001:db8::1]/a/b"],
    ["git@[::1]:a/b.git", "v1:[::1]/a/b"],
    ["https://host/a%2Fb/c", "v1:host/a%2Fb/c"],
  ])("maps %s to %s", (url, expected) => {
    expect(normalizeRemoteUrl(url)).toBe(expected);
  });

  it.each([
    "file:///tmp/x",
    "/tmp/x",
    "./x",
    "../x",
    "relative/path",
    "",
    "   ",
    "https://",
    "https:///a/b",
    "https://host",
    "https://host/",
    "ftp://host/a/b",
  ])("rejects %j", (url) => {
    expect(normalizeRemoteUrl(url)).toBeNull();
  });
});

describe("computeRepoAliases", () => {
  it("returns remote and root aliases, identical from a linked worktree", async () => {
    const repo = await mkdtemp(join(tmpdir(), "lific-alias-"));
    const worktree = `${repo}-wt`;
    try {
      await git(repo, ["init", "-q", "-b", "main"]);
      await git(repo, ["remote", "add", "origin", "git@github.com:Acme/app.git"]);
      await git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root"]);
      const root = await git(repo, ["rev-parse", "HEAD"]);
      await git(repo, ["worktree", "add", "-q", "-b", "side", worktree]);

      const expected = [
        { kind: "remote", value: "v1:github.com/Acme/app" },
        { kind: "root", value: `v1:${root}` },
      ];
      expect(await computeRepoAliases(repo)).toEqual(expected);
      expect(await computeRepoAliases(worktree)).toEqual(expected);
    } finally {
      await rm(worktree, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("returns nothing outside a repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lific-plain-"));
    try {
      expect(await computeRepoAliases(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
