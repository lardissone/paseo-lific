import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  addIssueComment,
  checkConnection,
  getWorkspaceIssue,
  linkWorkspaceIssue,
  listBranches,
  listIssues,
  resolveProject,
  setIssueStatus,
  startWork,
} from "./shared/rpc";
import { lificSettings } from "./shared/settings";
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

  return () => {};
}
