import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "../shared/errors";
import { issueCard, type ProjectSummary, resourceWebUrl } from "../shared/lific";
import type { ConfiguredHome, Home } from "../shared/rpc";
import type { Connections } from "./connection";
import { readLinkedIssue, repositoryRoot } from "./git";
import type { LificClient } from "./lific-client";
import { planLeaves } from "./plan-steps";
import { listRuns } from "./run-store";

type PaseoApi = PluginHandlerContext["paseo"];

const READY_PER_PROJECT = 8;
const CLOSED = new Set(["done", "cancelled"]);

const NO_ATTENTION = { assigned: [], human: [], waiting: [] };

export async function loadHome(connections: Connections, paseo: PaseoApi): Promise<Home> {
  const connection = await connections.optional();
  if (!connection) return { configured: false };
  const { client } = connection;
  const baseUrl = connection.settings.baseUrl;
  const resolveProject = connections.resolveProject;
  const [lificProjects, { projects: paseoProjects }, { entries: workspaces }, attention] = await Promise.all([
    connections.listProjects(connection),
    paseo.projects.list(),
    paseo.workspaces.list(),
    // One missing section should not take the whole screen down.
    client.attention().catch((error) => {
      console.error("Lific attention unavailable:", errorMessage(error));
      return NO_ATTENTION;
    }),
  ]);
  const projectNames = new Map(lificProjects.map((project) => [project.id, project.name]));

  // Lific project → the first Paseo project bound to it, so its issues can start work there.
  const rootsByProject = new Map<number, string>();
  await Promise.all(
    paseoProjects
      .filter((project) => project.projectKind === "git")
      .map(async (project) => {
        const resolution = await resolveProject(project.projectRootPath).catch(() => null);
        if (resolution?.kind === "resolved" && !rootsByProject.has(resolution.project.id)) {
          rootsByProject.set(resolution.project.id, project.projectRootPath);
        }
      }),
  );

  const linked = await Promise.all(
    workspaces.map(async (workspace) => {
      const identifier = await readLinkedIssue(workspace.workspaceDirectory).catch(() => null);
      if (!identifier) return null;
      const issue = await client.getIssue(identifier).catch(() => null);
      if (!issue) return null;
      return {
        workspaceId: workspace.id,
        workspaceName: workspace.title || workspace.name,
        issue: issueCard(baseUrl, issue),
      };
    }),
  );
  // A workspace whose issue is closed is finished work, not work in progress.
  const inProgress = linked.flatMap((entry) => (entry && !CLOSED.has(entry.issue.status) ? [entry] : []));
  const busy = new Set(inProgress.map((entry) => entry.issue.identifier));

  const seen = new Set<string>();
  const needsYou = (["assigned", "waiting", "human"] as const).flatMap((reason) =>
    attention[reason].flatMap((issue) => {
      if (seen.has(issue.identifier)) return [];
      seen.add(issue.identifier);
      return [{ ...issueCard(baseUrl, issue), reason, projectName: projectNames.get(issue.project_id) ?? "" }];
    }),
  );

  const linkedProjects = lificProjects.filter((project) => rootsByProject.has(project.id));
  const [projects, runs] = await Promise.all([
    Promise.all(
      linkedProjects.map(async (project: ProjectSummary) => {
        const [workable, active, plans] = await Promise.all([
          client.listIssues({ projectId: project.id, workable: true, limit: 50 }),
          client.listIssues({ projectId: project.id, status: "active", limit: 50 }),
          client.listPlans(project.id),
        ]);
        const ready = workable
          .filter((issue) => issue.status !== "active" && !issue.needs_human && !busy.has(issue.identifier))
          .slice(0, READY_PER_PROJECT)
          .map((issue) => issueCard(baseUrl, issue));
        return { project, projectRoot: rootsByProject.get(project.id)!, ready, active, plans };
      }),
    ),
    Promise.all([...new Set(rootsByProject.values())].map((root) => loadRuns(client, root))).then((lists) => lists.flat()),
  ]);

  // Work started outside Paseo, such as an agent picking issues over MCP, has no workspace link or plan run.
  const activeWithoutWorkspace = projects.flatMap(({ project, active }) =>
    active
      .filter((issue) => !busy.has(issue.identifier) && !seen.has(issue.identifier))
      .map((issue) => ({ ...issueCard(baseUrl, issue), projectName: project.name })),
  );
  const runPlans = new Set(runs.map((run) => run.plan));
  const activePlans = projects.flatMap(({ project, plans }) =>
    plans
      .filter((plan) => plan.status === "active" && !runPlans.has(plan.identifier))
      .map((plan) => ({
        identifier: plan.identifier,
        title: plan.title,
        projectName: project.name,
        doneCount: plan.done_count,
        stepCount: plan.step_count,
        url: resourceWebUrl(baseUrl, plan.identifier, "plans", plan.id),
      })),
  );

  return {
    configured: true,
    runs,
    inProgress,
    activeWithoutWorkspace,
    activePlans,
    needsYou,
    projects: projects
      .filter((entry) => entry.ready.length > 0)
      .map(({ project, projectRoot, ready }) => ({ project, projectRoot, ready })),
    unlinkedProjects: lificProjects.filter((project) => !rootsByProject.has(project.id)),
  };
}

async function loadRuns(client: LificClient, projectRoot: string): Promise<ConfiguredHome["runs"]> {
  const repo = await repositoryRoot(projectRoot);
  if (!repo) return [];
  const runs = await listRuns(repo);
  return Promise.all(
    runs.map(async (run) => {
      const plan = await client.resolvePlan(run.plan).catch(() => null);
      const leaves = plan ? planLeaves(plan.steps) : [];
      const current = leaves.find((leaf) => !leaf.finished);
      return {
        projectRoot: repo,
        plan: run.plan,
        title: plan?.title ?? run.plan,
        status: run.status,
        pause: run.pause,
        mode: run.mode,
        doneCount: leaves.filter((leaf) => leaf.finished).length,
        stepCount: leaves.length,
        current: current ? { identifier: current.issue, title: current.title } : null,
      };
    }),
  );
}
