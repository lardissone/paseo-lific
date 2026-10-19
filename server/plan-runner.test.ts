import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lificSettings } from "../shared/settings";
import { createConnection } from "./connection";
import { canonicalPath, git, locateBranch, writeLinkedIssue, writeRunStep } from "./git";
import { createPlanRunner } from "./plan-runner";
import { readRun } from "./run-store";

type PaseoApi = PluginHandlerContext["paseo"];

/** Lific with one two-step plan whose steps have no issues yet. */
function fakePlanLific() {
  const issues = new Map<string, { id: number; identifier: string; title: string; status: string }>();
  const steps = [
    { id: 101, title: "First", issue: null as string | null },
    { id: 102, title: "Second", issue: null as string | null },
  ];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const issueJson = (issue: { id: number; identifier: string; title: string; status: string }) => ({
    ...issue,
    project_id: 1,
    description: "",
    priority: "none",
    labels: [],
    seq: 1,
    updated_at: "",
    needs_human: false,
  });

  const request: typeof fetch = async (input, init) => {
    const { pathname } = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method === "GET" && pathname === "/api/plans/resolve/MIO-PLAN-1") {
      return json(200, {
        id: 9,
        project_id: 1,
        identifier: "MIO-PLAN-1",
        title: "Ship it",
        status: "active",
        step_count: 2,
        done_count: 0,
        steps: steps.map((step) => {
          const issue = step.issue ? issues.get(step.issue)! : null;
          return {
            id: step.id,
            issue_id: issue?.id ?? null,
            title: step.title,
            description: "",
            done: issue?.status === "done",
            ...(issue ? { issue_identifier: issue.identifier, issue_status: issue.status } : {}),
            children: [],
          };
        }),
      });
    }
    if (method === "POST" && pathname === "/api/issues") {
      const issue = { id: issues.size + 1, identifier: `MIO-${issues.size + 1}`, title: body.title, status: "backlog" };
      issues.set(issue.identifier, issue);
      return json(200, issueJson(issue));
    }
    const step = /^\/api\/plans\/9\/steps\/(\d+)$/.exec(pathname);
    if (method === "PUT" && step) {
      const target = steps.find((candidate) => candidate.id === Number(step[1]))!;
      target.issue = [...issues.values()].find((issue) => issue.id === body.issue_id)!.identifier;
      return json(200, {});
    }
    const resolve = /^\/api\/issues\/resolve\/(.+)$/.exec(pathname);
    if (method === "GET" && resolve && issues.has(resolve[1]!)) return json(200, issueJson(issues.get(resolve[1]!)!));
    return json(404, { error: `no route for ${method} ${pathname}` });
  };

  return { request, issues, finish: (identifier: string) => (issues.get(identifier)!.status = "done") };
}

const settings = lificSettings.schema.parse({ baseUrl: "https://lific.test", apiKey: "k" });
const paseo = {
  workspaces: { list: async () => ({ entries: [] }) },
  agents: { list: async () => ({ entries: [] }) },
} as unknown as PaseoApi;

let repo: string;

beforeEach(async () => {
  repo = await canonicalPath(await mkdtemp(join(tmpdir(), "lific-runner-")));
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root"]);
});

afterEach(async () => {
  await rm(`${repo}-wt`, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function createRunner() {
  const lific = fakePlanLific();
  const connections = createConnection({ read: async () => ({ status: "ready", values: settings }) } as never, lific.request);
  const started: { identifier: string; baseBranch: string; branchName: string; index: number }[] = [];
  const runner = createPlanRunner({
    connections,
    // Stands in for Paseo creating the worktree: a real branch and worktree with the link written.
    async startWork(input) {
      const worktree = `${repo}-wt/${input.branchName}`;
      await git(repo, ["worktree", "add", "-q", "-b", input.branchName, worktree, input.baseBranch]);
      await writeLinkedIssue(worktree, input.identifier);
      await writeRunStep(worktree, input.step);
      started.push({ identifier: input.identifier, baseBranch: input.baseBranch, branchName: input.branchName, index: input.step.index });
    },
  });
  return { lific, runner, started };
}

const newRun = { plan: "MIO-PLAN-1", mode: "review" as const, branching: "stacked" as const, base: "main", provider: "claude/opus", archive: false };

describe("plan runner", () => {
  it("creates step issues, stacks branches, and pauses for review between steps", async () => {
    const { lific, runner, started } = createRunner();

    await runner.start(repo, newRun, paseo);
    expect(started).toEqual([{ identifier: "MIO-1", baseBranch: "main", branchName: "first", index: 1 }]);

    // Ticking again while the step works is a no-op.
    await runner.onActivity(repo, paseo);
    expect(started).toHaveLength(1);

    lific.finish("MIO-1");
    await runner.onActivity(repo, paseo);
    expect(await readRun(repo, "MIO-PLAN-1")).toMatchObject({ status: "paused", pause: { kind: "review", issue: "MIO-1" } });
    expect(started).toHaveLength(1);

    await runner.control(repo, "MIO-PLAN-1", "continue", paseo);
    expect(started[1]).toEqual({ identifier: "MIO-2", baseBranch: "first", branchName: "second", index: 2 });

    lific.finish("MIO-2");
    await runner.onActivity(repo, paseo);
    expect(await readRun(repo, "MIO-PLAN-1")).toMatchObject({ status: "done", pause: null });
  });

  it("refuses to start a plan that is already running", async () => {
    const { runner } = createRunner();
    await runner.start(repo, newRun, paseo);
    await expect(runner.start(repo, newRun, paseo)).rejects.toThrow("already running");
  });

  it("pauses only the run whose step failed", async () => {
    const { runner } = createRunner();
    await runner.start(repo, newRun, paseo);
    const unrelated = `${repo}-wt/unrelated`;
    await git(repo, ["worktree", "add", "-q", "-b", "unrelated", unrelated]);
    await writeLinkedIssue(unrelated, "MIO-9");

    await runner.stepFailed((await locateBranch(unrelated))!, "MIO-9");
    expect(await readRun(repo, "MIO-PLAN-1")).toMatchObject({ status: "running" });

    await runner.stepFailed((await locateBranch(`${repo}-wt/first`))!, "MIO-1");
    expect(await readRun(repo, "MIO-PLAN-1")).toMatchObject({ status: "paused", pause: { kind: "failed", issue: "MIO-1" } });
  });

  it("restarts an archived step on continue", async () => {
    const { runner, started } = createRunner();
    await runner.start(repo, newRun, paseo);
    await git(repo, ["worktree", "remove", "--force", `${repo}-wt/first`]);
    await runner.stepAbandoned({ cwd: repo, branch: "first" }, "MIO-1");
    expect(await readRun(repo, "MIO-PLAN-1")).toMatchObject({ pause: { kind: "archived", issue: "MIO-1" } });

    await runner.control(repo, "MIO-PLAN-1", "continue", paseo);
    expect(started[1]).toEqual({ identifier: "MIO-1", baseBranch: "main", branchName: "first-2", index: 1 });
  });
});
