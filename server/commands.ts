import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { issueWebUrl, parseIssueIdentifier, projectWebUrl } from "../shared/lific";
import type { Note } from "../shared/note";
import type { SlashCommand } from "../shared/rpc";
import type { Connections } from "./connection";
import { readLinkedIssue } from "./git";
import { appendNote } from "./notes";
import { linkWorkspace } from "./workspace-issue";

type PaseoApi = PluginHandlerContext["paseo"];

const MAX_TITLE = 120;

interface CommandInput {
  command: SlashCommand;
  args: string;
  agentId: string;
  directory: string;
  projectRoot: string;
}

/** Runs a slash command and reports its result as a note card in the agent's timeline. */
export async function runSlashCommand(connections: Connections, input: CommandInput, paseo: PaseoApi): Promise<void> {
  const note = await commandNote(connections, input);
  await appendNote(paseo, input.agentId, `${input.command}-${Date.now()}`, note);
}

async function commandNote(connections: Connections, input: CommandInput): Promise<Note> {
  const { client, settings } = await connections.require();
  const baseUrl = settings.baseUrl;
  const args = input.args.trim();

  switch (input.command) {
    case "issue": {
      const identifier = parseIssueIdentifier(args);
      if (!identifier) throw new Error("Usage: /issue MIO-23");
      const issue = await client.getIssue(identifier);
      await linkWorkspace(connections, input.directory, issue.identifier);
      return {
        title: `Linked this workspace to ${issue.identifier}: ${issue.title}`,
        body: "Agents created in this workspace from now on get the issue as context.",
        url: issueWebUrl(baseUrl, issue.identifier),
        tone: "success",
      };
    }

    case "file": {
      if (args === "") throw new Error("Usage: /file <title>, with an optional description on the following lines");
      const project = await connections.requireProject(input.projectRoot);
      const [firstLine = "", ...rest] = args.split("\n");
      const title = firstLine.trim().slice(0, MAX_TITLE);
      const overflow = firstLine.trim().slice(MAX_TITLE);
      const description = [overflow, rest.join("\n").trim()].filter(Boolean).join("\n\n");
      const issue = await client.createIssue({ projectId: project.id, title, description });
      return {
        title: `Filed ${issue.identifier}: ${issue.title}`,
        body: `Added to the ${project.identifier} backlog.`,
        url: issueWebUrl(baseUrl, issue.identifier),
        tone: "success",
      };
    }

    case "done": {
      const identifier = await requireLinkedIssue(input.directory);
      const issue = await client.updateIssueByIdentifier(identifier, { status: "done" });
      if (args !== "") await client.addComment(issue, args);
      return { title: `${identifier} is done`, url: issueWebUrl(baseUrl, identifier), tone: "success" };
    }

    case "block": {
      if (args === "") throw new Error("Usage: /block <what you are waiting for>");
      const identifier = await requireLinkedIssue(input.directory);
      const issue = await client.updateIssueByIdentifier(identifier, { assignees: ["human"] });
      await client.addComment(issue, `Blocked: ${args}`);
      return {
        title: `${identifier} is waiting on a person`,
        body: args,
        url: issueWebUrl(baseUrl, identifier),
        tone: "warning",
      };
    }

    case "briefing": {
      const project = await connections.requireProject(input.projectRoot);
      const since = args === "" ? undefined : args;
      return {
        title: `${project.identifier} briefing${since ? ` since ${since}` : ""}`,
        body: await client.getBriefing(project.identifier, since),
        url: projectWebUrl(baseUrl, project.identifier),
      };
    }
  }
}

async function requireLinkedIssue(directory: string): Promise<string> {
  const identifier = await readLinkedIssue(directory);
  if (!identifier) throw new Error("This workspace is not linked to a Lific issue. Use /issue MIO-23 first.");
  return identifier;
}
