import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { MENTIONS_KIND, MENTIONS_VERSION } from "./shared/mentions";
import {
  addIssueComment,
  checkConnection,
  getBriefing,
  getHome,
  getWorkspaceIssue,
  linkWorkspaceIssue,
  listBranches,
  listIssues,
  resolveProject,
  runSlashCommand,
  searchAttachments,
  setIssueStatus,
  startWork,
} from "./shared/rpc";
import { lificSettings } from "./shared/settings";
import { runSlashCommand as runCommand } from "./server/commands";
import { createLifecycleReporter } from "./server/lifecycle";
import { createLificService } from "./server/service";

export default function contribute(server: PluginServerContext) {
  const lific = createLificService(server.registerSettings(lificSettings));

  server.handle(checkConnection, () => lific.checkConnection());
  server.handle(resolveProject, ({ projectRoot }) => lific.resolveProject(projectRoot));
  server.handle(getWorkspaceIssue, ({ directory }) => lific.workspaceIssue(directory));
  server.handle(linkWorkspaceIssue, ({ directory, identifier }) =>
    lific.linkWorkspace(directory, identifier),
  );
  server.handle(listIssues, ({ projectRoot, query }) => lific.listIssues(projectRoot, query));
  server.handle(setIssueStatus, ({ identifier, status }) => lific.setStatus(identifier, status));
  server.handle(addIssueComment, ({ identifier, content }) => lific.addComment(identifier, content));
  server.handle(listBranches, ({ projectRoot }) => lific.listBranches(projectRoot));
  server.handle(searchAttachments, ({ query }) => lific.searchAttachments(query));
  server.handle(runSlashCommand, async (input, { paseo }) => {
    await runCommand(input, paseo, {
      connect: async () => {
        const connection = await lific.connection();
        if (!connection) throw new Error("Lific is not configured. Add the URL and API key in the plugin settings.");
        return { client: connection.client, baseUrl: connection.settings.baseUrl };
      },
      resolveProject: lific.resolveProject,
    });
    return {};
  });
  server.handle(getHome, (_input, { paseo }) => lific.home(paseo));
  server.handle(getBriefing, ({ project, since }) => lific.briefing(project, since));
  server.handle(startWork, (input, { paseo }) => lific.startWork(input, paseo));

  server.before("agent.create", async ({ request }) => {
    const cwd = request.config.cwd;
    let instructions: string | null;
    try {
      instructions = await lific.instructionsFor(cwd);
    } catch (error) {
      // Agent creation must not fail because Lific is unreachable.
      console.error(`Lific context for ${cwd} unavailable:`, error instanceof Error ? error.message : error);
      return undefined;
    }
    if (!instructions) return undefined;
    const systemPrompt = request.config.systemPrompt
      ? `${request.config.systemPrompt}\n\n${instructions}`
      : instructions;
    return { ...request, config: { ...request.config, systemPrompt } };
  });

  const reporter = createLifecycleReporter(() => lific.connection());
  server.on("agent.permission_requested", ({ agent, request }) => {
    if (request.kind === "question") void reporter.questionAsked(agent.cwd, request);
  });
  server.on("agent.permission_resolved", ({ agent, requestId }) => {
    void reporter.questionResolved(agent.cwd, requestId);
  });
  server.on("agent.turn_ended", ({ agent, outcome, turnId, timeline }, { paseo }) => {
    void reporter.turnEnded(agent.cwd, outcome);
    if (outcome.kind === "completed") void appendMentions(paseo, agent.id, turnId, timeline);
  });
  server.on("workspace.archived", ({ workspace }, { paseo }) => {
    void reporter.workspaceArchived(workspace, paseo);
  });

  async function appendMentions(
    paseo: PluginHandlerContext["paseo"],
    agentId: string,
    turnId: string | null,
    timeline: Parameters<typeof lific.mentionedIssueCards>[0],
  ) {
    try {
      const issues = await lific.mentionedIssueCards(timeline);
      if (issues.length === 0) return;
      await paseo.agents.ref(agentId).timeline.append({
        type: "plugin",
        id: `mentions-${turnId ?? Date.now()}`,
        kind: MENTIONS_KIND,
        version: MENTIONS_VERSION,
        data: { issues },
      });
    } catch (error) {
      console.error("Lific mentions failed:", error instanceof Error ? error.message : error);
    }
  }

  return () => {};
}
