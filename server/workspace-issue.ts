import { errorMessage } from "../shared/errors";
import { type IssueStatus, issueWebUrl, parseIssueIdentifier } from "../shared/lific";
import type { WorkspaceIssue } from "../shared/rpc";
import type { Connections } from "./connection";
import {
  clearLinkedIssue,
  locateBranch,
  readBranchConfig,
  readLinkedIssue,
  readRunStep,
  repositoryRoot,
  writeLinkedIssue,
} from "./git";
import { buildIssueInstructions } from "./issue-prompt";
import { readRun } from "./run-store";

/** Comments included in an agent's instructions and in the issue panel. */
const RECENT_COMMENTS = 3;

export async function workspaceIssue(connections: Connections, directory: string): Promise<WorkspaceIssue> {
  const connection = await connections.optional();
  if (!connection) return { state: "unconfigured" };
  const run = await workspaceRun(directory);
  const identifier = await readLinkedIssue(directory);
  if (!identifier) return { state: "unlinked", run };
  try {
    const issue = await connection.client.getIssue(identifier);
    const comments = await connection.client.listRecentComments(issue, RECENT_COMMENTS);
    return { state: "linked", issue, comments, url: issueWebUrl(connection.settings.baseUrl, identifier), run };
  } catch (error) {
    return { state: "unavailable", identifier, error: errorMessage(error), run };
  }
}

async function workspaceRun(directory: string) {
  const step = await readRunStep(await locateBranch(directory));
  if (!step) return null;
  const projectRoot = (await repositoryRoot(directory)) ?? directory;
  const record = await readRun(projectRoot, step.plan);
  return { ...step, projectRoot, status: record?.status ?? null, pause: record?.pause ?? null };
}

export async function linkWorkspace(connections: Connections, directory: string, input: string | null): Promise<void> {
  if (input === null) return clearLinkedIssue(directory);
  const identifier = parseIssueIdentifier(input);
  if (!identifier) throw new Error(`"${input}" is not a Lific issue ID like MIO-23.`);
  const { client } = await connections.require();
  const issue = await client.getIssue(identifier);
  await writeLinkedIssue(directory, issue.identifier);
}

export async function setIssueStatus(connections: Connections, identifier: string, status: IssueStatus): Promise<void> {
  const { client } = await connections.require();
  await client.updateIssueByIdentifier(identifier, { status });
}

export async function addIssueComment(connections: Connections, identifier: string, content: string): Promise<void> {
  const { client } = await connections.require();
  await client.addComment(await client.getIssue(identifier), content);
}

/** System prompt addition for an agent created in `cwd`, or null when it is not linked. */
export async function instructionsFor(connections: Connections, cwd: string): Promise<string | null> {
  const location = await locateBranch(cwd);
  const identifier = location ? await readBranchConfig(location, "lificIssue") : null;
  if (!identifier) return null;
  const connection = await connections.optional();
  if (!connection) return null;
  const { client, settings } = connection;
  const issue = await client.getIssue(identifier);
  const comments = await client.listRecentComments(issue, RECENT_COMMENTS);
  return buildIssueInstructions({
    issue,
    comments,
    url: issueWebUrl(settings.baseUrl, identifier),
    privateTracker: settings.privateTracker,
    step: await readRunStep(location),
  });
}
