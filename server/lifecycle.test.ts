import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Issue, IssueStatus } from "../shared/lific";
import { git, writeLinkedIssue } from "./git";
import type { LificClient } from "./lific-client";
import { createLifecycleReporter } from "./lifecycle";

/** In-memory stand-in for a Lific server holding one issue. */
function fakeLific(initial: Partial<Issue>) {
  let issue: Issue = {
    id: 1,
    project_id: 1,
    identifier: "MIO-23",
    title: "Fix sync",
    description: "",
    status: "active",
    priority: "none",
    labels: [],
    seq: 1,
    updated_at: "2026-10-19T00:00:00Z",
    needs_human: false,
    ...initial,
  };
  const comments: string[] = [];
  const client = {
    async getIssue() {
      return issue;
    },
    async updateIssueByIdentifier(_identifier: string, changes: { status?: IssueStatus; assignees?: string[] }) {
      const assignees = changes.assignees;
      issue = {
        ...issue,
        ...(changes.status ? { status: changes.status } : {}),
        ...(assignees
          ? {
              needs_human: assignees.includes("human"),
              assignees: assignees
                .filter((name) => name !== "human")
                .map((username, index) => ({ user_id: index + 10, username })),
            }
          : {}),
        seq: issue.seq + 1,
      };
      return issue;
    },
    async addComment(_issue: Issue, content: string) {
      comments.push(content);
      return { id: comments.length, author: "paseo", author_display_name: "Paseo", content, created_at: "" };
    },
  } as unknown as LificClient;
  return { client, comments, issue: () => issue };
}

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "lific-lifecycle-"));
  await git(repo, ["init", "-q", "-b", "fix-sync"]);
  await git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root"]);
  await writeLinkedIssue(repo, "MIO-23");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("questions", () => {
  it("puts the issue on a person until the last question is answered, then restores assignees", async () => {
    const lific = fakeLific({ assignees: [{ user_id: 1, username: "leandro" }] });
    const reporter = createLifecycleReporter(async () => ({ client: lific.client }));
    const ask = (id: string) => ({ id, input: { questions: [{ question: `Question ${id}?` }] } });

    await reporter.questionAsked(repo, ask("q1"));
    await reporter.questionAsked(repo, ask("q1"));
    await reporter.questionAsked(repo, ask("q2"));
    expect(lific.issue().needs_human).toBe(true);
    expect(lific.comments).toEqual([
      "Waiting on a person. The agent asked in Paseo:\n\n- Question q1?",
      "Waiting on a person. The agent asked in Paseo:\n\n- Question q2?",
    ]);

    await reporter.questionResolved(repo, "q1");
    expect(lific.issue().needs_human).toBe(true);

    await reporter.questionResolved(repo, "q2");
    expect(lific.issue().needs_human).toBe(false);
    expect(lific.issue().assignees?.map((a) => a.username)).toEqual(["leandro"]);
    expect(lific.comments).toHaveLength(2);
  });

  it("ignores workspaces without a linked issue", async () => {
    const lific = fakeLific({});
    const reporter = createLifecycleReporter(async () => ({ client: lific.client }));
    await git(repo, ["switch", "-q", "-c", "unlinked"]);
    await reporter.questionAsked(repo, { id: "q1", title: "Question" });
    expect(lific.comments).toEqual([]);
  });
});

describe("failed turns", () => {
  it("reports a failure streak once and re-arms after a completed turn", async () => {
    const lific = fakeLific({});
    const reporter = createLifecycleReporter(async () => ({ client: lific.client }));
    const failed = { kind: "failed" as const, error: { message: "rate limited" } };

    await reporter.turnEnded(repo, failed);
    await reporter.turnEnded(repo, failed);
    expect(lific.comments).toEqual(["An agent turn failed in Paseo:\n\nrate limited"]);

    await reporter.turnEnded(repo, { kind: "completed" });
    await reporter.turnEnded(repo, failed);
    expect(lific.comments).toHaveLength(2);
  });
});

describe("archived workspaces", () => {
  const paseo = {} as Parameters<ReturnType<typeof createLifecycleReporter>["workspaceArchived"]>[1];

  it("moves an active issue back to todo", async () => {
    const lific = fakeLific({ status: "active" });
    const reporter = createLifecycleReporter(async () => ({ client: lific.client }));
    await reporter.workspaceArchived({ id: "w1", cwd: repo }, paseo);
    expect(lific.issue().status).toBe("todo");
    expect(lific.comments).toHaveLength(1);
  });

  it("leaves a closed issue alone", async () => {
    const lific = fakeLific({ status: "done" });
    const reporter = createLifecycleReporter(async () => ({ client: lific.client }));
    await reporter.workspaceArchived({ id: "w1", cwd: repo }, paseo);
    expect(lific.issue().status).toBe("done");
    expect(lific.comments).toEqual([]);
  });
});
