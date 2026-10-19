import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { type Issue, type IssueStatus, issueWebUrl } from "../shared/lific";
import type { ProjectResolution } from "../shared/rpc";
import { isConfigured, type LificSettings, lificSettings } from "../shared/settings";
import { gitOptional, readLinkedIssue, writeLinkedIssue, clearLinkedIssue } from "./git";
import { buildIssueInstructions } from "./issue-prompt";
import { createLificClient, type LificClient, LificError } from "./lific-client";
import { computeRepoAliases } from "./repo-identity";

type PaseoApi = PluginHandlerContext["paseo"];

const RECENT_COMMENTS = 3;

type SettingsHandle = PluginSettings<typeof lificSettings.schema>;

export class NotConfiguredError extends Error {
  constructor() {
    super("Lific is not configured. Add the instance URL and API key in the plugin settings.");
  }
}

export function createLificService(settingsHandle: SettingsHandle) {
  async function settings(): Promise<LificSettings> {
    const state = await settingsHandle.read();
    if (state.status !== "ready") throw new Error(`Lific settings are invalid: ${state.error}`);
    return state.values;
  }

  async function connect(): Promise<{ client: LificClient; settings: LificSettings }> {
    const current = await settings();
    if (!isConfigured(current)) throw new NotConfiguredError();
    return {
      client: createLificClient({ baseUrl: current.baseUrl, apiKey: current.apiKey }),
      settings: current,
    };
  }

  /** Writes with `expected_seq`; on a conflict, re-reads the issue and applies the change once more. */
  async function updateIssue(
    client: LificClient,
    identifier: string,
    changes: { status?: IssueStatus; assignees?: string[] },
  ): Promise<Issue> {
    const issue = await client.getIssue(identifier);
    try {
      return await client.updateIssue(issue, changes);
    } catch (error) {
      if (!(error instanceof LificError) || error.status !== 409) throw error;
      return client.updateIssue(await client.getIssue(identifier), changes);
    }
  }

  async function resolveProject(projectRoot: string): Promise<ProjectResolution> {
    const current = await settings();
    if (!isConfigured(current)) return { kind: "unconfigured" };
    const client = createLificClient({ baseUrl: current.baseUrl, apiKey: current.apiKey });

    const override = current.projectOverrides[projectRoot];
    if (override) {
      const project = (await client.listProjects()).find((p) => p.identifier === override);
      if (project) return { kind: "resolved", project, source: "override" };
    }

    const aliases = await computeRepoAliases(projectRoot);
    if (aliases.length === 0) return { kind: "none" };
    const resolution = await client.resolveRepo(aliases);
    switch (resolution.resolution) {
      case "none":
        return { kind: "none" };
      case "conflict":
        return { kind: "conflict", projects: resolution.projects };
      case "one":
        return { kind: "resolved", project: resolution.project, source: "binding" };
    }
  }

  return {
    async checkConnection() {
      try {
        const { client } = await connect();
        return { ok: true as const, projects: await client.listProjects() };
      } catch (error) {
        return { ok: false as const, error: errorMessage(error) };
      }
    },

    resolveProject,

    async workspaceIssue(directory: string) {
      const identifier = await readLinkedIssue(directory);
      const current = await settings();
      const empty = { identifier, issue: null, comments: [], url: null, error: null };
      if (!isConfigured(current)) return { ...empty, configured: false };
      if (!identifier) return { ...empty, configured: true };
      const client = createLificClient({ baseUrl: current.baseUrl, apiKey: current.apiKey });
      try {
        const issue = await client.getIssue(identifier);
        const comments = await client.listRecentComments(issue, RECENT_COMMENTS);
        return {
          configured: true,
          identifier,
          issue,
          comments,
          url: issueWebUrl(current.baseUrl, identifier),
          error: null,
        };
      } catch (error) {
        return { ...empty, configured: true, error: errorMessage(error) };
      }
    },

    async linkWorkspace(directory: string, identifier: string | null) {
      if (identifier === null) {
        await clearLinkedIssue(directory);
        return {};
      }
      const { client } = await connect();
      const issue = await client.getIssue(identifier.trim().toUpperCase());
      await writeLinkedIssue(directory, issue.identifier);
      return {};
    },

    async listIssues(projectRoot: string, search: string) {
      const { client } = await connect();
      const resolution = await resolveProject(projectRoot);
      if (resolution.kind !== "resolved") {
        throw new Error("This project is not bound to a Lific project. Run `lific bind` or pick one in settings.");
      }
      const projectId = resolution.project.id;
      const text = search.trim();
      if (text === "") {
        const issues = await client.listIssues({ projectId, workable: true, limit: 50 });
        return { issues };
      }
      if (/^[A-Z][A-Z0-9]*-\d+$/i.test(text)) {
        const issue = await client.getIssue(text.toUpperCase()).catch(() => null);
        if (issue) return { issues: [issue] };
      }
      return { issues: await client.searchIssues({ query: text, projectId }) };
    },

    async setStatus(identifier: string, status: IssueStatus) {
      const { client } = await connect();
      await updateIssue(client, identifier, { status });
      return {};
    },

    async addComment(identifier: string, content: string) {
      const { client } = await connect();
      await client.addComment(await client.getIssue(identifier), content);
      return {};
    },

    async listBranches(projectRoot: string) {
      const output = await gitOptional(projectRoot, [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)",
        "refs/heads",
      ]);
      const originHead = await gitOptional(projectRoot, [
        "symbolic-ref",
        "--short",
        "refs/remotes/origin/HEAD",
      ]);
      const branches = output ? output.split("\n") : [];
      const remoteDefault = originHead?.replace(/^origin\//, "") ?? null;
      const defaultBranch =
        remoteDefault && branches.includes(remoteDefault)
          ? remoteDefault
          : (["main", "master"].find((name) => branches.includes(name)) ?? branches[0] ?? null);
      return { branches, defaultBranch };
    },

    async startWork(
      input: { identifier: string; projectRoot: string; baseBranch: string; branchName: string; provider: string },
      paseo: PaseoApi,
    ) {
      const { client } = await connect();
      const issue = await client.getIssue(input.identifier);

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

      const agent = await workspace.agents.create({
        config: { provider: input.provider },
        prompt: `Work on Lific issue ${issue.identifier}: ${issue.title}. The issue details are in your instructions.`,
      });

      const started = issue.status === "active" ? issue : await updateIssue(client, issue.identifier, { status: "active" });
      await client.addComment(
        started,
        `Started in Paseo on branch \`${input.branchName}\` from \`${input.baseBranch}\` (${input.provider}).`,
      );
      return { workspaceId: workspace.id, agentId: agent.id };
    },

    /** System prompt addition for an agent created in `cwd`, or null when it is not linked. */
    async instructionsFor(cwd: string): Promise<string | null> {
      const identifier = await readLinkedIssue(cwd);
      if (!identifier) return null;
      const current = await settings();
      if (!isConfigured(current)) return null;
      const client = createLificClient({ baseUrl: current.baseUrl, apiKey: current.apiKey });
      const issue = await client.getIssue(identifier);
      const comments = await client.listRecentComments(issue, RECENT_COMMENTS);
      return buildIssueInstructions({
        issue,
        comments,
        url: issueWebUrl(current.baseUrl, identifier),
        privateTracker: current.privateTracker,
      });
    },
  };
}

export type LificService = ReturnType<typeof createLificService>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
