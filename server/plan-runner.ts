import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { renderBranchName } from "../shared/branch";
import { errorMessage } from "../shared/errors";
import { issueWebUrl, type Plan } from "../shared/lific";
import type { Note } from "../shared/note";
import type { RunControlAction, RunPause } from "../shared/run";
import type { Connections } from "./connection";
import {
  type BranchLocation,
  canonicalPath,
  gitOptional,
  readRunStep,
  repositoryRoot,
  type RunStep,
  unsetBranchConfig,
} from "./git";
import type { LificClient } from "./lific-client";
import { appendNote } from "./notes";
import { finishedParents, type Leaf, nextRunAction, planLeaves } from "./plan-steps";
import { deleteRun, linkedBranches, listRuns, readRun, type RunRecord, worktreeForBranch, writeRun } from "./run-store";

type PaseoApi = PluginHandlerContext["paseo"];

const POLL_MS = 30_000;
/** Steps created in one tick before yielding; a plan of empty steps should not spin forever. */
const MAX_ACTIONS_PER_TICK = 20;

interface PlanRunnerDeps {
  connections: Connections;
  startWork(
    input: { identifier: string; projectRoot: string; baseBranch: string; branchName: string; provider: string; step: RunStep },
    paseo: PaseoApi,
  ): Promise<unknown>;
}

export type NewRun = Pick<RunRecord, "plan" | "mode" | "branching" | "base" | "provider" | "archive">;

/**
 * Works through plan runs. Every entry point canonicalizes the repository with `repositoryRoot`
 * and every change to a run goes through `serialize`, keyed by repository and plan, so a poll and
 * a turn-end tick can never start the same step twice.
 */
export function createPlanRunner({ connections, startWork }: PlanRunnerDeps) {
  const locks = new Map<string, Promise<void>>();
  let poller: ReturnType<typeof setInterval> | null = null;

  function serialize(repo: string, plan: string, task: () => Promise<void>): Promise<void> {
    const key = `${repo}\n${plan}`;
    const next = (locks.get(key) ?? Promise.resolve()).then(task);
    locks.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  async function canonicalRepo(path: string): Promise<string> {
    const repo = await repositoryRoot(path);
    if (!repo) throw new Error(`${path} is not inside a git repository.`);
    return repo;
  }

  async function advance(repo: string, planIdentifier: string, paseo: PaseoApi): Promise<void> {
    const connection = await connections.optional();
    if (!connection) return;
    const { client, settings } = connection;

    for (let actions = 0; actions < MAX_ACTIONS_PER_TICK; actions++) {
      const run = await readRun(repo, planIdentifier);
      if (run?.status !== "running") return;
      const plan = await client.resolvePlan(planIdentifier);
      for (const parent of finishedParents(plan.steps)) await client.checkPlanStep(plan, parent.id);
      const leaves = planLeaves(plan.steps);
      const branches = await linkedBranches(repo);
      const branchOf = (issue: string) => branches.get(issue) ?? null;
      const action = nextRunAction(leaves, run, branchOf);

      switch (action.kind) {
        case "wait":
          return;
        case "done": {
          await writeRun(repo, { ...run, status: "done", pause: null });
          const last = leaves.at(-1)?.issue;
          if (last) {
            await noteOnBranch(paseo, repo, branchOf(last), {
              title: `${plan.identifier} is complete`,
              body: `All ${leaves.length} steps of "${plan.title}" are done.`,
              tone: "success",
            });
          }
          return;
        }
        case "pause":
          await writeRun(repo, { ...run, status: "paused", pause: action.pause });
          await noteOnBranch(paseo, repo, branchOf(action.pause.issue), pauseNote(action.pause, plan, settings.baseUrl));
          return;
        case "create-issue":
          await createStepIssue(client, plan, action.leaf);
          continue;
        case "start": {
          const issue = await client.getIssue(action.issue);
          await startWork(
            {
              identifier: issue.identifier,
              projectRoot: repo,
              baseBranch: action.baseBranch,
              branchName: await freeBranchName(repo, renderBranchName(settings.branchTemplate, issue)),
              provider: run.provider,
              step: { plan: plan.identifier, index: action.index + 1, total: leaves.length },
            },
            paseo,
          );
          if (run.archive && run.branching === "stacked" && action.previous?.branch) {
            await archiveStep(paseo, repo, action.previous.branch, action.previous.issue);
          }
          return;
        }
      }
    }
  }

  /** Advances one run. A failure pauses it, so a broken step is not retried, with its side effects, every poll. */
  function tick(repo: string, plan: string, paseo: PaseoApi): Promise<void> {
    return serialize(repo, plan, async () => {
      try {
        await advance(repo, plan, paseo);
      } catch (error) {
        console.error(`Lific plan run ${plan} paused after an error:`, errorMessage(error));
        const run = await readRun(repo, plan);
        if (run?.status === "running") {
          await writeRun(repo, { ...run, status: "paused", pause: { kind: "error", message: errorMessage(error) } });
        }
      }
    });
  }

  async function tickRepo(repo: string, paseo: PaseoApi): Promise<void> {
    const runs = await listRuns(repo);
    await Promise.all(runs.filter((run) => run.status === "running").map((run) => tick(repo, run.plan, paseo)));
  }

  /** Pauses the run that started the branch at `location`, if it is still running. */
  async function pauseStep(location: BranchLocation, pause: RunPause): Promise<void> {
    const step = await readRunStep(location);
    if (!step) return;
    const repo = await canonicalRepo(location.cwd);
    await serialize(repo, step.plan, async () => {
      const run = await readRun(repo, step.plan);
      if (run?.status === "running") await writeRun(repo, { ...run, status: "paused", pause });
    });
  }

  return {
    /**
     * Starts polling running plans. Plugin code only gets a Paseo API inside a handler or hook, so
     * the server entry calls this from each of them; the first call starts the poller.
     */
    ensurePolling(paseo: PaseoApi) {
      if (poller) return;
      poller = setInterval(() => {
        void paseo.projects
          .list()
          .then(({ projects }) =>
            Promise.all(
              projects
                .filter((project) => project.projectKind === "git")
                .map(async (project) => {
                  const repo = await repositoryRoot(project.projectRootPath);
                  if (repo) await tickRepo(repo, paseo);
                }),
            ),
          )
          .catch((error) => console.error("Lific plan poll failed:", errorMessage(error)));
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

    async start(projectRoot: string, run: NewRun, paseo: PaseoApi) {
      const repo = await canonicalRepo(projectRoot);
      await serialize(repo, run.plan, async () => {
        if ((await readRun(repo, run.plan))?.status === "running") {
          throw new Error(`${run.plan} is already running in this repository.`);
        }
        await writeRun(repo, { ...run, status: "running", pause: null, approved: null });
      });
      await tick(repo, run.plan, paseo);
    },

    async control(projectRoot: string, plan: string, action: RunControlAction, paseo: PaseoApi) {
      const repo = await canonicalRepo(projectRoot);
      await serialize(repo, plan, async () => {
        const run = await readRun(repo, plan);
        if (!run) throw new Error(`${plan} is not running in this repository.`);
        switch (action) {
          case "stop":
            return deleteRun(repo, plan);
          case "pause":
            return writeRun(repo, { ...run, status: "paused", pause: { kind: "manual" } });
          case "continue": {
            const pause = run.pause;
            if (pause?.kind === "archived") {
              // The step's workspace is gone; unlinking its branch lets the run start it again.
              const branch = (await linkedBranches(repo)).get(pause.issue);
              if (branch) await unsetBranchConfig({ cwd: repo, branch }, "lificIssue");
            }
            return writeRun(repo, {
              ...run,
              status: "running",
              pause: null,
              approved: pause?.kind === "review" ? pause.issue : run.approved,
            });
          }
        }
      });
      if (action === "continue") await tick(repo, plan, paseo);
    },

    /** An agent turn failed on a plan step: pause that step's run. */
    stepFailed(location: BranchLocation, issue: string) {
      return pauseStep(location, { kind: "failed", issue });
    },

    /** A plan step's workspace was archived before its issue was done: pause that step's run. */
    stepAbandoned(location: BranchLocation, issue: string) {
      return pauseStep(location, { kind: "archived", issue });
    },
  };
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

function pauseNote(pause: { kind: "review" | "cancelled"; issue: string }, plan: Plan, baseUrl: string): Note {
  const url = issueWebUrl(baseUrl, pause.issue);
  if (pause.kind === "review") {
    return {
      title: `${plan.identifier} is waiting for your review`,
      body: `${pause.issue} is done. Review this step, then press Continue on the Lific home or in this workspace's Lific panel.`,
      url,
      tone: "warning",
    };
  }
  return { title: `${plan.identifier} paused`, body: `${pause.issue} was cancelled.`, url, tone: "warning" };
}

/** Paseo's workspace for a worktree path. Both sides are canonicalized: git reports real paths. */
async function workspaceForDirectory(paseo: PaseoApi, directory: string) {
  const target = await canonicalPath(directory);
  const { entries } = await paseo.workspaces.list();
  for (const workspace of entries) {
    if ((await canonicalPath(workspace.workspaceDirectory)) === target) return workspace;
  }
  return null;
}

/**
 * Archives the workspace of a finished stacked step: the next step's branch already carries its
 * commits. A worktree with uncommitted changes is left alone, since archiving could discard them.
 */
async function archiveStep(paseo: PaseoApi, repo: string, branch: string, issue: string): Promise<void> {
  const directory = await worktreeForBranch(repo, branch);
  if (!directory) return;
  if (await gitOptional(directory, ["status", "--porcelain"])) {
    console.error(`Lific kept the workspace for ${issue}: ${directory} has uncommitted changes.`);
    return;
  }
  const workspace = await workspaceForDirectory(paseo, directory);
  if (workspace) await paseo.workspaces.archive(workspace.id);
}

/** Appends a note to the most recent agent in the workspace on `branch`, when there is one. */
async function noteOnBranch(paseo: PaseoApi, repo: string, branch: string | null, note: Note): Promise<void> {
  if (!branch) return;
  const directory = await worktreeForBranch(repo, branch);
  const workspace = directory ? await workspaceForDirectory(paseo, directory) : null;
  if (!workspace) return;
  const { entries } = await paseo.agents.list();
  const agent = entries
    .map((entry) => entry.agent)
    .filter((candidate) => candidate.workspaceId === workspace.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (agent) await appendNote(paseo, agent.id, `run-${Date.now()}`, note);
}
