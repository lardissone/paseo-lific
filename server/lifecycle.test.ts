import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Issue } from "../shared/lific";
import { createFakeLific } from "./fake-lific";
import { git, writeLinkedIssue } from "./git";
import { createLificClient } from "./lific-client";
import { createLifecycleReporter } from "./lifecycle";

function fakeLific(initial: Partial<Issue>) {
  const lific = createFakeLific(initial);
  return { ...lific, client: createLificClient({ baseUrl: "https://lific.test", apiKey: "k", request: lific.request }) };
}

/** Reporter wired to a fake Lific, recording what it reports to the plan runner. */
function reporterFor(lific: ReturnType<typeof fakeLific>) {
  const failed: string[] = [];
  const abandoned: string[] = [];
  const reporter = createLifecycleReporter({
    connect: async () => ({ client: lific.client }),
    onStepFailed: async (_location, issue) => void failed.push(issue),
    onStepAbandoned: async (_location, issue) => void abandoned.push(issue),
  });
  return { reporter, failed, abandoned };
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
    const { reporter } = reporterFor(lific);
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
    const { reporter } = reporterFor(lific);
    await git(repo, ["switch", "-q", "-c", "unlinked"]);
    await reporter.questionAsked(repo, { id: "q1", title: "Question" });
    expect(lific.comments).toEqual([]);
  });
});

describe("failed turns", () => {
  it("reports a failure streak once and re-arms after a completed turn", async () => {
    const lific = fakeLific({});
    const { reporter, failed: reportedFailures } = reporterFor(lific);
    const failed = { kind: "failed" as const, error: { message: "rate limited" } };

    await reporter.turnEnded(repo, failed);
    await reporter.turnEnded(repo, failed);
    expect(lific.comments).toEqual(["An agent turn failed in Paseo:\n\nrate limited"]);
    expect(reportedFailures).toEqual(["MIO-23", "MIO-23"]);

    await reporter.turnEnded(repo, { kind: "completed" });
    await reporter.turnEnded(repo, failed);
    expect(lific.comments).toHaveLength(2);
  });
});

describe("archived workspaces", () => {
  const paseo = {} as Parameters<ReturnType<typeof createLifecycleReporter>["workspaceArchived"]>[1];

  it("moves an active issue back to todo", async () => {
    const lific = fakeLific({ status: "active" });
    const { reporter, abandoned } = reporterFor(lific);
    await reporter.workspaceArchived({ id: "w1", cwd: repo }, paseo);
    expect(lific.issue().status).toBe("todo");
    expect(lific.comments).toHaveLength(1);
    expect(abandoned).toEqual(["MIO-23"]);
  });

  it("leaves a closed issue alone", async () => {
    const lific = fakeLific({ status: "done" });
    const { reporter, abandoned } = reporterFor(lific);
    await reporter.workspaceArchived({ id: "w1", cwd: repo }, paseo);
    expect(lific.issue().status).toBe("done");
    expect(lific.comments).toEqual([]);
    expect(abandoned).toEqual([]);
  });
});
