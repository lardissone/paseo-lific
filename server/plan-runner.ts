import { dirname } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { renderBranchName } from "../shared/branch";
import { issueWebUrl, type Plan } from "../shared/lific";
import type { Note } from "../shared/note";
import { gitOptional } from "./git";
import type { LificClient } from "./lific-client";
import { appendNote } from "./notes";
import { type Leaf, nextRunAction, planLeaves } from "./plan-steps";
import {
  deleteRun,
  linkedBranches,
  listRuns,
  readRun,
  type RunRecord,
  worktreeForBranch,
  writeRun,
} from "./run-store";

type PaseoApi = PluginHandlerContext["paseo"];

const POLL_MS = 30_000;
/** Steps created in one tick before yielding; a plan of empty steps should not spin forever. */
const MAX_ACTIONS_PER_TICK = 20;

export interface RunStep {
  plan: string;
  index: number;
  total: number;
}

interface PlanRunnerDeps {
  connection(): Promise<{ client: LificClient; baseUrl: string; branchTemplate: string } | null>;
  startWork(
    input: { identifier: string; projectRoot: string; baseBranch: string; branchName: string; provider: string; step: RunStep },
    paseo: PaseoApi,
  ): Promise<unknown>;
}

export function createPlanRunner(deps: PlanRunnerDeps) {
  const locks = new Map<string, Promise<void>>();
  let poller: ReturnType<typeof setInterval> | null = null;

  function serialize(key: string, task: () => Promise<void>): Promise<void> {
    const next = (locks.get(key) ?? Promise.resolve()).then(task).catch((error) => {
      console.error(`Lific plan run ${key} failed:`, error instanceof Error ? error.message : error);
    });
    locks.set(key, next);
    return next;
  }

  function tick(repo: string, planIdentifier: string, paseo: PaseoApi): Promise<void> {
    return serialize(`${repo}\n${planIdentifier}`, async () => {
      const connection = await deps.connection();
      if (!connection) return;
      const { client, baseUrl } = connection;

      for (let actions = 0; actions < MAX_ACTIONS_PER_TICK; actions++) {
        const run = await readRun(repo, planIdentifier);
        if (run?.status !== "running") return;
        const plan = await client.resolvePlan(planIdentifier);
        const leaves = planLeaves(plan.steps);
        const branches = await linkedBranches(repo);
        const branchOf = (issue: string) => branches.get(issue) ?? null;
        const action = nextRunAction(leaves, run, branchOf);

        switch (action.kind) {
          case "wait":
            return;
          case "done": {
            await writeRun(repo, { ...run, status: "done", reason: undefined });
            const last = leaves.at(-1)?.issue;
            if (last) {
              await noteOnStep(paseo, repo, branchOf(last), {
                title: `${plan.identifier} is complete`,
                body: `All ${leaves.length} steps of "${plan.title}" are done.`,
                tone: "success",
              });
            }
            return;
          }
          case "pause": {
            await writeRun(repo, { ...run, status: "paused", reason: action.reason });
            const [why, issue = ""] = action.reason.split(":");
            await noteOnStep(paseo, repo, branchOf(issue), pauseNote(why ?? "", issue, plan, baseUrl));
            return;
          }
          case "create-issue":
            await createStepIssue(client, plan, action.leaf);
            continue;
          case "start": {
            const issue = await client.getIssue(action.leaf.issue!);
            const previous = action.index > 0 ? leaves[action.index - 1]!.issue : null;
            await deps.startWork(
              {
                identifier: issue.identifier,
                projectRoot: repo,
                baseBranch: action.baseBranch,
                branchName: await freeBranchName(repo, renderBranchName(connection.branchTemplate, issue)),
                provider: run.provider,
                step: { plan: plan.identifier, index: action.index + 1, total: leaves.length },
              },
              paseo,
            );
            const previousBranch = previous ? branchOf(previous) : null;
            if (run.archive === "yes" && run.branching === "stacked" && previousBranch) {
              await archiveStep(paseo, repo, previousBranch, previous!);
            }
            return;
          }
        }
      }
    });
  }

  async function tickRepo(repo: string, paseo: PaseoApi): Promise<void> {
    const runs = await listRuns(repo);
    await Promise.all(runs.filter((run) => run.status === "running").map((run) => tick(repo, run.plan, paseo)));
  }

  return {
    /** Starts polling running plans. Needs a Paseo API, which plugin code only gets from a handler or hook. */
    ensurePolling(paseo: PaseoApi) {
      if (poller) return;
      poller = setInterval(() => {
        void paseo.projects
          .list()
          .then(({ projects }) =>
            Promise.all(
              projects.filter((p) => p.projectKind === "git").map((p) => tickRepo(p.projectRootPath, paseo)),
            ),
          )
          .catch((error) => console.error("Lific plan poll failed:", error instanceof Error ? error.message : error));
      }, POLL_MS);
    },

    stop() {
      if (poller) clearInterval(poller);
      poller = null;
    },

    /** Advances any running plan of the repository that contains `cwd`. */
    async onActivity(cwd: string, paseo: PaseoApi) {
      const repo = await repositoryRoot(cwd);
      if (repo) await tickRepo(repo, paseo);
    },

    async start(repo: string, run: Omit<RunRecord, "status" | "reason" | "approved">, paseo: PaseoApi) {
      if (await readRun(repo, run.plan).then((existing) => existing?.status === "running")) {
        throw new Error(`${run.plan} is already running in this repository.`);
      }
      await writeRun(repo, { ...run, status: "running" });
      await tick(repo, run.plan, paseo);
    },

    async control(repo: string, plan: string, action: "continue" | "pause" | "stop", paseo: PaseoApi) {
      const run = await readRun(repo, plan);
      if (!run) throw new Error(`${plan} is not running in this repository.`);
      if (action === "stop") return deleteRun(repo, plan);
      if (action === "pause") return writeRun(repo, { ...run, status: "paused", reason: "manual" });
      const reviewed = run.reason?.startsWith("review:") ? run.reason.slice("review:".length) : run.approved;
      await writeRun(repo, { ...run, status: "running", reason: undefined, approved: reviewed });
      await tick(repo, plan, paseo);
    },

    /** Pauses the run a failing step belongs to. */
    async pauseForFailure(cwd: string, issue: string) {
      const repo = await repositoryRoot(cwd);
      if (!repo) return;
      for (const run of await listRuns(repo)) {
        if (run.status !== "running") continue;
        const branches = await linkedBranches(repo);
        if (!branches.has(issue)) continue;
        await writeRun(repo, { ...run, status: "paused", reason: `failed:${issue}` });
      }
    },
  };
}

export type PlanRunner = ReturnType<typeof createPlanRunner>;

/** Main checkout of the repository that contains `cwd`, also from a linked worktree. */
export async function repositoryRoot(cwd: string): Promise<string | null> {
  const common = await gitOptional(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common ? dirname(common) : null;
}

async function createStepIssue(client: LificClient, plan: Plan, leaf: Leaf): Promise<void> {
  const issue = await client.createIssue({
    projectId: plan.project_id,
    title: leaf.title,
    description: [leaf.description.trim(), `Step of ${plan.identifier}: ${plan.title}.`].filter(Boolean).join("\n\n"),
  });
  await client.linkPlanStep(plan, leaf.stepId, issue.id);
}

async function freeBranchName(repo: string, name: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? name : `${name}-${attempt}`;
    if ((await gitOptional(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`])) === null) return candidate;
  }
}

function pauseNote(why: string, issue: string, plan: Plan, baseUrl: string): Note {
  const url = issueWebUrl(baseUrl, issue);
  switch (why) {
    case "review":
      return {
        title: `${plan.identifier} is waiting for your review`,
        body: `${issue} is done. Review this step, then press Continue on the Lific home or in this workspace's Lific panel.`,
        url,
        tone: "warning",
      };
    case "cancelled":
      return { title: `${plan.identifier} paused`, body: `${issue} was cancelled.`, url, tone: "warning" };
    default:
      return { title: `${plan.identifier} paused`, body: `Paused at ${issue}.`, url, tone: "warning" };
  }
}

/**
 * Archives the workspace of a finished stacked step: the next step's branch already carries its
 * commits. A worktree with uncommitted changes is left alone, since archiving could discard them.
 */
async function archiveStep(paseo: PaseoApi, repo: string, branch: string, issue: string): Promise<void> {
  const directory = await worktreeForBranch(repo, branch);
  if (!directory) return;
  const changes = await gitOptional(directory, ["status", "--porcelain"]);
  if (changes) {
    console.error(`Lific: kept the workspace for ${issue}; ${directory} has uncommitted changes.`);
    return;
  }
  const { entries } = await paseo.workspaces.list();
  const workspace = entries.find((entry) => entry.workspaceDirectory === directory);
  if (workspace) await paseo.workspaces.archive(workspace.id);
}

/** Appends a note to the most recent agent working on `branch`, when there is one. */
async function noteOnStep(paseo: PaseoApi, repo: string, branch: string | null, note: Note): Promise<void> {
  if (!branch) return;
  const directory = await worktreeForBranch(repo, branch);
  if (!directory) return;
  const { entries } = await paseo.agents.list();
  const agent = entries
    .map((entry) => entry.agent)
    .filter((candidate) => candidate.cwd === directory)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (!agent) return;
  await appendNote(paseo, agent.id, `run-${Date.now()}`, note);
}
