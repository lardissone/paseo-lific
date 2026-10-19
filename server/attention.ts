import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "../shared/errors";
import type { Connections } from "./connection";
import { repositoryRoot } from "./git";
import { listRuns } from "./run-store";

type PaseoApi = PluginHandlerContext["paseo"];

/**
 * What the sidebar badge counts. Kept cheaper than the home screen: one Lific request plus local
 * git config reads, since every connected app polls it.
 */
export async function loadAttention(connections: Connections, paseo: PaseoApi) {
  const connection = await connections.optional();
  if (!connection) return { issues: 0, pausedRuns: 0 };

  const [attention, { projects }] = await Promise.all([
    connection.client.attention().catch((error) => {
      console.error("Lific attention unavailable:", errorMessage(error));
      return null;
    }),
    paseo.projects.list(),
  ]);
  const issues = new Set(
    attention ? [...attention.assigned, ...attention.waiting, ...attention.human].map((issue) => issue.identifier) : [],
  ).size;

  const repos = new Set(
    await Promise.all(projects.filter((p) => p.projectKind === "git").map((p) => repositoryRoot(p.projectRootPath))),
  );
  repos.delete(null);
  const runs = await Promise.all([...repos].map((repo) => listRuns(repo!)));
  const pausedRuns = runs.flat().filter((run) => run.status === "paused").length;

  return { issues, pausedRuns };
}
