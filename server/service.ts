import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { type IssueCard, type IssueStatus, issueCard, issueWebUrl } from "../shared/lific";
import type { Home, ProjectResolution } from "../shared/rpc";
import { isConfigured, type LificSettings, lificSettings } from "../shared/settings";
import { gitOptional, readLinkedIssue, writeLinkedIssue, clearLinkedIssue } from "./git";
import { searchAttachments } from "./attachments";
import { loadHome } from "./home";
import { buildIssueInstructions } from "./issue-prompt";
import { mentionedIssues } from "./mentions";
import { createLificClient, type LificClient, type RepoResolution } from "./lific-client";
import { computeRepoAliases } from "./repo-identity";

type PaseoApi = PluginHandlerContext["paseo"];

const RECENT_COMMENTS = 3;
const BINDING_TTL_MS = 5 * 60_000;

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

  // Bindings change rarely and the home screen resolves every project, so cache them briefly.
  let projectIdentifiers: { at: number; value: string[] } | null = null;
  const bindings = new Map<string, { at: number; value: Promise<RepoResolution> }>();
  function resolveBinding(client: LificClient, baseUrl: string, projectRoot: string): Promise<RepoResolution> {
    const key = `${baseUrl}\n${projectRoot}`;
    const cached = bindings.get(key);
    if (cached && Date.now() - cached.at < BINDING_TTL_MS) return cached.value;
    const value = computeRepoAliases(projectRoot).then((aliases) =>
      aliases.length === 0 ? { resolution: "none" as const } : client.resolveRepo(aliases),
    );
    bindings.set(key, { at: Date.now(), value });
    value.catch(() => bindings.delete(key));
    return value;
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

    const resolution = await resolveBinding(client, current.baseUrl, projectRoot);
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
    /** The configured client, or null when the plugin has no URL or API key yet. */
    async connection(): Promise<{ client: LificClient; settings: LificSettings } | null> {
      const current = await settings();
      return isConfigured(current) ? connect() : null;
    },

    async home(paseo: PaseoApi): Promise<Home> {
      const current = await settings();
      if (!isConfigured(current)) {
        return { configured: false, inProgress: [], needsYou: [], projects: [], unlinkedProjects: [] };
      }
      const client = createLificClient({ baseUrl: current.baseUrl, apiKey: current.apiKey });
      return loadHome({ client, baseUrl: current.baseUrl, paseo, resolveProject });
    },

    async briefing(project: string, since: string | undefined) {
      const { client } = await connect();
      const fetchedAt = new Date().toISOString();
      const markdown = await client.callTool("get_briefing", { project, ...(since ? { since } : {}) });
      return { markdown, fetchedAt };
    },

    /** Cards for the Lific issues an agent mentioned in its last turn, or none. */
    async mentionedIssueCards(timeline: Parameters<typeof mentionedIssues>[0]): Promise<IssueCard[]> {
      const connection = await this.connection();
      if (!connection) return [];
      const { client, settings: current } = connection;
      if (!projectIdentifiers || Date.now() - projectIdentifiers.at > BINDING_TTL_MS) {
        projectIdentifiers = { at: Date.now(), value: (await client.listProjects()).map((p) => p.identifier) };
      }
      const identifiers = mentionedIssues(timeline, projectIdentifiers.value);
      const issues = await Promise.all(identifiers.map((identifier) => client.getIssue(identifier).catch(() => null)));
      return issues.flatMap((issue) => (issue ? [issueCard(current.baseUrl, issue)] : []));
    },

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
      await client.updateIssueByIdentifier(identifier, { status });
      return {};
    },

    async addComment(identifier: string, content: string) {
      const { client } = await connect();
      await client.addComment(await client.getIssue(identifier), content);
      return {};
    },

    async searchAttachments(query: string) {
      const { client, settings: current } = await connect();
      return { items: await searchAttachments(client, current.baseUrl, query) };
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

      const started = issue.status === "active" ? issue : await client.updateIssueByIdentifier(issue.identifier, { status: "active" });
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
