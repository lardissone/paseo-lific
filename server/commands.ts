import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { issueWebUrl } from "../shared/lific";
import { NOTE_KIND, NOTE_VERSION, type Note } from "../shared/note";
import type { ProjectResolution, SlashCommand } from "../shared/rpc";
import { readLinkedIssue, writeLinkedIssue } from "./git";
import type { LificClient } from "./lific-client";

type PaseoApi = PluginHandlerContext["paseo"];

const MAX_TITLE = 120;
// Timeline rows are capped at 64 KiB serialized; leave room for the envelope.
const MAX_NOTE_BODY = 48_000;

interface CommandDeps {
  connect(): Promise<{ client: LificClient; baseUrl: string }>;
  resolveProject(projectRoot: string): Promise<ProjectResolution>;
}

interface CommandInput {
  command: SlashCommand;
  args: string;
  agentId: string;
  directory: string;
  projectRoot: string;
}

export async function runSlashCommand(input: CommandInput, paseo: PaseoApi, deps: CommandDeps): Promise<void> {
  const note = await commandNote(input, deps);
  await paseo.agents.ref(input.agentId).timeline.append({
    type: "plugin",
    id: `${input.command}-${Date.now()}`,
    kind: NOTE_KIND,
    version: NOTE_VERSION,
    data: {
      title: note.title,
      tone: note.tone ?? "info",
      ...(note.body ? { body: note.body.length > MAX_NOTE_BODY ? `${note.body.slice(0, MAX_NOTE_BODY)}…` : note.body } : {}),
      ...(note.url ? { url: note.url } : {}),
    },
  });
}

async function commandNote(input: CommandInput, deps: CommandDeps): Promise<Note> {
  const { client, baseUrl } = await deps.connect();
  const args = input.args.trim();

  switch (input.command) {
    case "issue": {
      if (args === "") throw new Error("Usage: /issue MIO-23");
      const issue = await client.getIssue(args.toUpperCase());
      await writeLinkedIssue(input.directory, issue.identifier);
      return {
        title: `Linked this workspace to ${issue.identifier}: ${issue.title}`,
        body: "Agents created in this workspace from now on get the issue as context.",
        url: issueWebUrl(baseUrl, issue.identifier),
        tone: "success",
      };
    }

    case "file": {
      if (args === "") throw new Error("Usage: /file <title>, with an optional description on the following lines");
      const project = await requireProject(deps, input.projectRoot);
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
      const project = await requireProject(deps, input.projectRoot);
      const briefing = await client.callTool("get_briefing", {
        project: project.identifier,
        ...(args === "" ? {} : { since: args }),
      });
      return {
        title: `${project.identifier} briefing${args === "" ? "" : ` since ${args}`}`,
        body: briefing,
        url: `${baseUrl.replace(/\/+$/, "")}/${project.identifier}/overview`,
      };
    }
  }
}

async function requireLinkedIssue(directory: string): Promise<string> {
  const identifier = await readLinkedIssue(directory);
  if (!identifier) throw new Error("This workspace is not linked to a Lific issue. Use /issue MIO-23 first.");
  return identifier;
}

async function requireProject(deps: CommandDeps, projectRoot: string) {
  const resolution = await deps.resolveProject(projectRoot);
  if (resolution.kind === "resolved") return resolution.project;
  if (resolution.kind === "conflict") {
    throw new Error("This repository is bound to several Lific projects. Pick one in the Lific plugin settings.");
  }
  throw new Error("This repository is not bound to a Lific project. Run `lific bind` or pick one in settings.");
}
