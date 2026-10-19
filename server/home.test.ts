import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Issue, Plan } from "../shared/lific";
import { lificSettings } from "../shared/settings";
import { createConnection } from "./connection";
import { git, writeLinkedIssue } from "./git";
import { loadHome } from "./home";
import { writeRun } from "./run-store";

function issue(identifier: string, changes: Partial<Issue> = {}): Issue {
  return {
    id: Number(identifier.split("-")[1]),
    project_id: 1,
    identifier,
    title: `Title of ${identifier}`,
    description: "",
    status: "active",
    priority: "none",
    labels: [],
    seq: 1,
    updated_at: "2026-10-19T00:00:00Z",
    needs_human: false,
    ...changes,
  };
}

function plan(identifier: string, status: string): Plan {
  return { id: Number(identifier.split("-")[2]), project_id: 1, identifier, title: `Title of ${identifier}`, status, step_count: 4, done_count: 1, steps: [] };
}

/** In-memory Lific with one project, MEM, served through the client's `request` seam. */
function fakeLific(state: { issues: Issue[]; plans: Plan[]; waiting: Issue[] }): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  return async (input) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    switch (url.pathname) {
      case "/api/projects":
        return json([{ id: 1, identifier: "MEM", name: "Memento" }]);
      case "/api/issues/attention":
        return json({ assigned: [], human: [], waiting: state.waiting });
      case "/api/issues":
        return json(
          state.issues.filter(
            (entry) =>
              (!params.has("status") || entry.status === params.get("status")) &&
              (params.get("workable") !== "true" || (entry.status !== "done" && entry.status !== "cancelled")),
          ),
        );
      case "/api/plans":
        return json(state.plans);
    }
    const resolved = url.pathname.match(/^\/api\/(issues|plans)\/resolve\/(.+)$/);
    if (resolved?.[1] === "issues") return json(state.issues.find((entry) => entry.identifier === resolved[2]));
    if (resolved?.[1] === "plans") return json(state.plans.find((entry) => entry.identifier === resolved[2]));
    return new Response("{}", { status: 404 });
  };
}

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "lific-home-"));
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function homeFor(lific: Parameters<typeof fakeLific>[0]) {
  const values = lificSettings.schema.parse({ baseUrl: "https://lific.test", apiKey: "k", projectOverrides: { [repo]: "MEM" } });
  const connections = createConnection({ read: async () => ({ status: "ready", values }) } as never, fakeLific(lific));
  const paseo = {
    projects: { list: async () => ({ projects: [{ projectKind: "git", projectRootPath: repo }] }) },
    workspaces: { list: async () => ({ entries: [{ id: "wks_1", title: "Parser", name: "main", workspaceDirectory: repo }] }) },
  } as unknown as PluginHandlerContext["paseo"];
  const home = await loadHome(connections, paseo);
  if (!home.configured) throw new Error("expected a configured home");
  return home;
}

describe("home", () => {
  it("shows active issues that no workspace is linked to, apart from linked and waiting ones", async () => {
    await writeLinkedIssue(repo, "MEM-2");
    const home = await homeFor({
      issues: [issue("MEM-2"), issue("MEM-7"), issue("MEM-9", { needs_human: true }), issue("MEM-3", { status: "todo" })],
      plans: [],
      waiting: [issue("MEM-9", { needs_human: true })],
    });

    expect(home.inProgress.map((entry) => entry.issue.identifier)).toEqual(["MEM-2"]);
    expect(home.activeWithoutWorkspace).toEqual([
      {
        identifier: "MEM-7",
        title: "Title of MEM-7",
        status: "active",
        priority: "none",
        url: "https://lific.test/MEM/issues/MEM-7",
        projectName: "Memento",
      },
    ]);
    expect(home.projects.flatMap((entry) => entry.ready.map((card) => card.identifier))).toEqual(["MEM-3"]);
  });

  it("shows active plans that no plan run drives", async () => {
    await writeRun(repo, {
      plan: "MEM-PLAN-2",
      status: "running",
      pause: null,
      mode: "review",
      branching: "stacked",
      base: "main",
      provider: "claude/opus",
      approved: null,
      archive: false,
    });
    const home = await homeFor({
      issues: [],
      plans: [plan("MEM-PLAN-1", "active"), plan("MEM-PLAN-2", "active"), plan("MEM-PLAN-3", "done")],
      waiting: [],
    });

    expect(home.runs.map((run) => run.plan)).toEqual(["MEM-PLAN-2"]);
    expect(home.activePlans).toEqual([
      {
        identifier: "MEM-PLAN-1",
        title: "Title of MEM-PLAN-1",
        projectName: "Memento",
        doneCount: 1,
        stepCount: 4,
        url: "https://lific.test/MEM/plans/1",
      },
    ]);
  });
});
