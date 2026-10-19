import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { issueCard, type ProjectSummary } from "../shared/lific";
import type { Home, ProjectResolution } from "../shared/rpc";
import { readLinkedIssue } from "./git";
import type { LificClient } from "./lific-client";
import { planLeaves } from "./plan-steps";
import { listRuns } from "./run-store";

type PaseoApi = PluginHandlerContext["paseo"];

const READY_PER_PROJECT = 8;

interface HomeDeps {
  client: LificClient;
  baseUrl: string;
  paseo: PaseoApi;
  resolveProject(projectRoot: string): Promise<ProjectResolution>;
}

export async function loadHome({ client, baseUrl, paseo, resolveProject }: HomeDeps): Promise<Home> {
  const [lificProjects, { projects: paseoProjects }, { entries: workspaces }, attention] = await Promise.all([
    client.listProjects(),
    paseo.projects.list(),
    paseo.workspaces.list(),
    client.attention(),
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
  const inProgress = linked.filter((entry) => entry !== null);
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
  const projects = await Promise.all(
    linkedProjects.map(async (project: ProjectSummary) => {
      const issues = await client.listIssues({ projectId: project.id, workable: true, limit: 50 });
      const ready = issues
        .filter((issue) => issue.status !== "active" && !issue.needs_human && !busy.has(issue.identifier))
        .slice(0, READY_PER_PROJECT)
        .map((issue) => issueCard(baseUrl, issue));
      return { project, projectRoot: rootsByProject.get(project.id)!, ready };
    }),
  );

  const runs = (
    await Promise.all([...new Set(rootsByProject.values())].map((root) => loadRuns(client, root)))
  ).flat();

  return {
    configured: true,
    runs,
    inProgress,
    needsYou,
    projects: projects.filter((entry) => entry.ready.length > 0),
    unlinkedProjects: lificProjects.filter((project) => !rootsByProject.has(project.id)),
  };
}

async function loadRuns(client: LificClient, repo: string): Promise<Home["runs"]> {
  const runs = (await listRuns(repo)).filter((run) => run.status !== "stopped");
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
        reason: run.reason ?? null,
        mode: run.mode,
        doneCount: leaves.filter((leaf) => leaf.finished).length,
        stepCount: leaves.length,
        current: current ? { identifier: current.issue ?? "", title: current.title } : null,
      };
    }),
  );
}
