import type { PluginSettings } from "@getpaseo/plugin/server";
import type { ProjectSummary } from "../shared/lific";
import type { ProjectResolution } from "../shared/rpc";
import { isConfigured, type LificSettings, type lificSettings } from "../shared/settings";
import { createLificClient, type LificClient, type RepoResolution } from "./lific-client";
import { computeRepoAliases } from "./repo-identity";

/** Bindings and the project list change rarely, and the home screen reads them for every project. */
const CACHE_TTL_MS = 5 * 60_000;

export const NOT_CONFIGURED = "Lific is not configured. Add the Lific URL and API key in Settings → Plugins → Lific.";

export interface Connection {
  client: LificClient;
  settings: LificSettings;
}

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

/**
 * The one way server code reaches Lific: reads the current settings, builds a client, and owns
 * the caches that depend on which instance the settings point at.
 */
export function createConnection(
  settingsHandle: Pick<PluginSettings<typeof lificSettings.schema>, "read">,
  /** Test seam passed to every client; production uses the global fetch. */
  request?: typeof fetch,
) {
  const bindings = new Map<string, Cached<RepoResolution>>();
  const projectLists = new Map<string, Cached<ProjectSummary[]>>();

  function cached<T>(cache: Map<string, Cached<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = load();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    return value;
  }

  async function optional(): Promise<Connection | null> {
    const state = await settingsHandle.read();
    if (state.status !== "ready") throw new Error(`Lific settings are invalid: ${state.error}`);
    if (!isConfigured(state.values)) return null;
    return {
      client: createLificClient({ baseUrl: state.values.baseUrl, apiKey: state.values.apiKey, request }),
      settings: state.values,
    };
  }

  async function require(): Promise<Connection> {
    const connection = await optional();
    if (!connection) throw new Error(NOT_CONFIGURED);
    return connection;
  }

  function listProjects({ client, settings }: Connection): Promise<ProjectSummary[]> {
    return cached(projectLists, settings.baseUrl, () => client.listProjects());
  }

  /** The Lific project for a repository: the settings override first, then `lific bind`. */
  async function resolveProject(projectRoot: string): Promise<ProjectResolution> {
    const connection = await optional();
    if (!connection) return { kind: "unconfigured" };
    const { client, settings } = connection;

    const override = settings.projectOverrides[projectRoot];
    if (override) {
      const project = (await listProjects(connection)).find((p) => p.identifier === override);
      if (project) return { kind: "resolved", project, source: "override" };
    }

    const resolution = await cached(bindings, `${settings.baseUrl}\n${projectRoot}`, async () => {
      const aliases = await computeRepoAliases(projectRoot);
      return aliases.length === 0 ? { resolution: "none" as const } : client.resolveRepo(aliases);
    });
    switch (resolution.resolution) {
      case "none":
        return { kind: "none" };
      case "conflict":
        return { kind: "conflict", projects: resolution.projects };
      case "one":
        return { kind: "resolved", project: resolution.project, source: "binding" };
    }
  }

  async function requireProject(projectRoot: string): Promise<ProjectSummary> {
    const resolution = await resolveProject(projectRoot);
    switch (resolution.kind) {
      case "resolved":
        return resolution.project;
      case "unconfigured":
        throw new Error(NOT_CONFIGURED);
      case "conflict":
        throw new Error(
          `This repository is bound to several Lific projects (${resolution.projects.map((p) => p.identifier).join(", ")}). Pick one in the Lific plugin settings.`,
        );
      case "none":
        throw new Error("This repository is not bound to a Lific project. Run `lific bind` in it, or pick a project in the Lific plugin settings.");
    }
  }

  return { optional, require, listProjects, resolveProject, requireProject };
}

export type Connections = ReturnType<typeof createConnection>;
