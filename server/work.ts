import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "../shared/errors";
import { parseIssueIdentifier } from "../shared/lific";
import type { IssueSummary } from "../shared/rpc";
import type { Connections } from "./connection";
import { type RunStep, writeLinkedIssue, writeRunStep } from "./git";

type PaseoApi = PluginHandlerContext["paseo"];

const WORKABLE_LIMIT = 50;
const SEARCH_LIMIT = 20;

export interface StartWorkInput {
  identifier: string;
  projectRoot: string;
  baseBranch: string;
  branchName: string;
  provider: string;
  /** Set when a plan run starts this issue as one of its steps. */
  step?: RunStep;
}

/** Creates a worktree workspace on a new branch, links it to the issue, and starts an agent there. */
export async function startWork(connections: Connections, input: StartWorkInput, paseo: PaseoApi) {
  const { client } = await connections.require();
  const issue = await client.getIssue(input.identifier);
  const step = input.step;

  const workspace = await paseo.workspaces.create({
    title: `${issue.identifier} · ${issue.title}`,
    source: {
      kind: "worktree",
      cwd: input.projectRoot,
      action: "branch-off",
      baseBranch: input.baseBranch,
      branchName: input.branchName,
    },
  });
  const directory = workspace.directory ?? (await workspace.refresh())?.workspaceDirectory;
  if (!directory) throw new Error("Paseo created the workspace without a directory.");
  // Link before the agent exists so the agent.create hook sees the issue.
  await writeLinkedIssue(directory, issue.identifier);
  if (step) await writeRunStep(directory, step);

  const agent = await workspace.agents.create({
    config: { provider: input.provider },
    prompt: step
      ? `Work on Lific issue ${issue.identifier}: ${issue.title}. It is step ${step.index} of ${step.total} in ${step.plan}. The details are in your instructions.`
      : `Work on Lific issue ${issue.identifier}: ${issue.title}. The issue details are in your instructions.`,
  });

  // The work has started; failing to record it in Lific must not report the start as failed,
  // or a retry would create a second worktree and agent.
  try {
    const started =
      issue.status === "active" ? issue : await client.updateIssueByIdentifier(issue.identifier, { status: "active" });
    await client.addComment(
      started,
      `Started in Paseo on branch \`${input.branchName}\` from \`${input.baseBranch}\` (${input.provider})${
        step ? `, as step ${step.index} of ${step.total} in ${step.plan}` : ""
      }.`,
    );
  } catch (error) {
    console.error(`Lific could not mark ${issue.identifier} as started:`, errorMessage(error));
  }
  return { workspaceId: workspace.id, agentId: agent.id };
}

/** Workable issues when `search` is empty, the exact issue for an ID, else a text search. */
export async function listIssues(
  connections: Connections,
  projectRoot: string,
  search: string,
): Promise<{ issues: IssueSummary[] }> {
  const { client } = await connections.require();
  const project = await connections.requireProject(projectRoot);
  const text = search.trim();
  if (text === "") return { issues: await client.listIssues({ projectId: project.id, workable: true, limit: WORKABLE_LIMIT }) };

  const identifier = parseIssueIdentifier(text);
  if (identifier) {
    const issue = await client.getIssue(identifier).catch(() => null);
    if (issue) return { issues: [issue] };
  }
  const results = await client.search({ query: text, projectId: project.id, issuesOnly: true, limit: SEARCH_LIMIT });
  return {
    issues: results.flatMap(({ identifier: id, title }) => (id ? [{ identifier: id, title }] : [])),
  };
}
