import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "./shared/errors";
import { MENTIONS_KIND, MENTIONS_VERSION } from "./shared/mentions";
import {
  addIssueComment,
  checkConnection,
  controlRun,
  getAttention,
  getBriefing,
  getHome,
  getPlanPreview,
  getWorkspaceIssue,
  linkWorkspaceIssue,
  listBranches,
  listIssues,
  listPlans,
  resolveProject,
  runSlashCommand,
  searchAttachments,
  setIssueStatus,
  startRun,
  startWork,
} from "./shared/rpc";
import { lificSettings } from "./shared/settings";
import { searchAttachments as searchLificAttachments } from "./server/attachments";
import { loadAttention } from "./server/attention";
import { runSlashCommand as runCommand } from "./server/commands";
import { createConnection } from "./server/connection";
import { listBranches as listGitBranches } from "./server/git";
import { loadHome } from "./server/home";
import { createLifecycleReporter } from "./server/lifecycle";
import { mentionedIssueCards } from "./server/mentions";
import { createPlanRunner } from "./server/plan-runner";
import { listPlans as listLificPlans, planPreview } from "./server/plans";
import { listIssues as listLificIssues, startWork as startLificWork } from "./server/work";
import {
  addIssueComment as addLificComment,
  instructionsFor,
  linkWorkspace,
  setIssueStatus as setLificStatus,
  workspaceIssue,
} from "./server/workspace-issue";

type PaseoApi = PluginHandlerContext["paseo"];

/** Agent creation waits on the before hook; a slow Lific must not hold it near the daemon's 30 s limit. */
const INSTRUCTIONS_BUDGET_MS = 5_000;

export default function contribute(server: PluginServerContext) {
  const connections = createConnection(server.registerSettings(lificSettings));
  const runner = createPlanRunner({
    connections,
    startWork: (input, paseo) => startLificWork(connections, input, paseo),
  });
  const reporter = createLifecycleReporter({
    connect: connections.optional,
    onStepFailed: runner.stepFailed,
    onStepAbandoned: runner.stepAbandoned,
  });

  // Running plans advance on a poller that needs a Paseo API, which plugin code only receives
  // inside handlers and hooks. Each entry that has one hands it over; the first starts polling.
  const withPaseo = (paseo: PaseoApi) => runner.ensurePolling(paseo);

  server.handle(checkConnection, async () => {
    try {
      const connection = await connections.require();
      return { ok: true as const, projects: await connection.client.listProjects() };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error) };
    }
  });
  server.handle(resolveProject, ({ projectRoot }) => connections.resolveProject(projectRoot));
  server.handle(getWorkspaceIssue, ({ directory }) => workspaceIssue(connections, directory));
  server.handle(linkWorkspaceIssue, async ({ directory, identifier }) => {
    await linkWorkspace(connections, directory, identifier);
    return {};
  });
  server.handle(listIssues, ({ projectRoot, query }) => listLificIssues(connections, projectRoot, query));
  server.handle(setIssueStatus, async ({ identifier, status }) => {
    await setLificStatus(connections, identifier, status);
    return {};
  });
  server.handle(addIssueComment, async ({ identifier, content }) => {
    await addLificComment(connections, identifier, content);
    return {};
  });
  server.handle(listBranches, ({ projectRoot }) => listGitBranches(projectRoot));
  server.handle(searchAttachments, async ({ query }) => {
    const { client, settings } = await connections.require();
    return { items: await searchLificAttachments(client, settings.baseUrl, query) };
  });
  server.handle(runSlashCommand, async (input, { paseo }) => {
    withPaseo(paseo);
    await runCommand(connections, input, paseo);
    return {};
  });
  server.handle(getBriefing, async ({ project, since }) => {
    const { client } = await connections.require();
    const fetchedAt = new Date().toISOString();
    return { markdown: await client.getBriefing(project, since), fetchedAt };
  });
  // Every connected app polls this for the sidebar badge, which also restarts the plan poller
  // promptly after a daemon restart.
  server.handle(getAttention, (_input, { paseo }) => {
    withPaseo(paseo);
    return loadAttention(connections, paseo);
  });
  server.handle(getHome, (_input, { paseo }) => {
    withPaseo(paseo);
    return loadHome(connections, paseo);
  });
  server.handle(startWork, (input, { paseo }) => {
    withPaseo(paseo);
    return startLificWork(connections, input, paseo);
  });
  server.handle(listPlans, ({ projectRoot }) => listLificPlans(connections, projectRoot));
  server.handle(getPlanPreview, ({ identifier }) => planPreview(connections, identifier));
  server.handle(startRun, async ({ projectRoot, archivePrevious, ...run }, { paseo }) => {
    withPaseo(paseo);
    await runner.start(projectRoot, { ...run, archive: archivePrevious }, paseo);
    return {};
  });
  server.handle(controlRun, async ({ projectRoot, plan, action }, { paseo }) => {
    withPaseo(paseo);
    await runner.control(projectRoot, plan, action, paseo);
    return {};
  });

  server.before("agent.create", async ({ request }) => {
    const cwd = request.config.cwd;
    let instructions: string | null;
    try {
      instructions = await withTimeout(instructionsFor(connections, cwd), INSTRUCTIONS_BUDGET_MS);
    } catch (error) {
      // Agent creation must not fail because Lific is slow or unreachable.
      console.error(`Lific context for ${cwd} unavailable:`, errorMessage(error));
      return undefined;
    }
    if (!instructions) return undefined;
    const systemPrompt = request.config.systemPrompt ? `${request.config.systemPrompt}\n\n${instructions}` : instructions;
    return { ...request, config: { ...request.config, systemPrompt } };
  });

  server.on("agent.permission_requested", ({ agent, request }) => {
    if (request.kind === "question") void reporter.questionAsked(agent.cwd, request);
  });
  server.on("agent.permission_resolved", ({ agent, requestId }) => {
    void reporter.questionResolved(agent.cwd, requestId);
  });
  server.on("agent.turn_ended", ({ agent, outcome, timeline }, { paseo }) => {
    withPaseo(paseo);
    void reporter.turnEnded(agent.cwd, outcome);
    if (outcome.kind !== "completed") return;
    void appendMentions(paseo, agent.id, timeline);
    void runner.onActivity(agent.cwd, paseo).catch((error) => console.error("Lific plan advance failed:", errorMessage(error)));
  });
  server.on("workspace.archived", ({ workspace }, { paseo }) => {
    withPaseo(paseo);
    void reporter.workspaceArchived(workspace, paseo);
  });

  async function appendMentions(paseo: PaseoApi, agentId: string, timeline: Parameters<typeof mentionedIssueCards>[1]) {
    try {
      const issues = await mentionedIssueCards(connections, timeline);
      if (issues.length === 0) return;
      await paseo.agents.ref(agentId).timeline.append({
        type: "plugin",
        // Turn ids can repeat after a session reopens, so they cannot key the row.
        id: `mentions-${Date.now()}`,
        kind: MENTIONS_KIND,
        version: MENTIONS_VERSION,
        data: { issues },
      });
    } catch (error) {
      console.error("Lific mentions failed:", errorMessage(error));
    }
  }

  return () => runner.stop();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
