import type { PluginHandlerContext, PluginTurnOutcome } from "@getpaseo/plugin/server";
import { z } from "zod";
import { errorMessage } from "../shared/errors";
import {
  type BranchLocation,
  locateBranch,
  readBranchConfig,
  unsetBranchConfig,
  writeBranchConfig,
} from "./git";
import type { LificClient } from "./lific-client";
import { questionText } from "./question-text";

type PaseoApi = PluginHandlerContext["paseo"];

const SavedAssigneesSchema = z.array(z.string());

interface LifecycleDeps {
  connect(): Promise<{ client: LificClient } | null>;
  /** An agent turn failed on a linked branch. */
  onStepFailed(location: BranchLocation, issue: string): Promise<void>;
  /** A linked workspace was archived while its issue was still active. */
  onStepAbandoned(location: BranchLocation, issue: string): Promise<void>;
}

interface LinkedIssue {
  location: BranchLocation;
  identifier: string;
  client: LificClient;
}

/**
 * Lifecycle reporting to Lific. The agent owns the issue's content; this only records state
 * changes a person needs to see: a question waiting on them, a failing agent, and a workspace
 * archived while the issue was still active.
 */
export function createLifecycleReporter({ connect, onStepFailed, onStepAbandoned }: LifecycleDeps) {
  // Hooks fire concurrently; one queue keeps read-modify-write of the branch state consistent.
  let queue: Promise<void> = Promise.resolve();
  function serialize(label: string, task: () => Promise<void>): Promise<void> {
    const next = queue.then(task).catch((error) => {
      console.error(`Lific ${label} failed:`, errorMessage(error));
    });
    queue = next;
    return next;
  }

  async function linkedIssue(location: BranchLocation | null): Promise<LinkedIssue | null> {
    if (!location) return null;
    const identifier = await readBranchConfig(location, "lificIssue");
    if (!identifier) return null;
    const connection = await connect();
    return connection ? { location, identifier, client: connection.client } : null;
  }

  async function pendingQuestions(location: BranchLocation): Promise<string[]> {
    const raw = await readBranchConfig(location, "lificPendingQuestions");
    return raw ? raw.split(",") : [];
  }

  async function restoreAssignees({ location, identifier, client }: LinkedIssue): Promise<void> {
    const saved = await readBranchConfig(location, "lificAssigneesBeforeQuestion");
    // Parse before clearing, so a corrupt value fails loudly instead of losing the record.
    const assignees = SavedAssigneesSchema.parse(saved ? JSON.parse(saved) : []);
    await client.updateIssueByIdentifier(identifier, { assignees });
    await unsetBranchConfig(location, "lificPendingQuestions");
    await unsetBranchConfig(location, "lificAssigneesBeforeQuestion");
  }

  return {
    questionAsked(cwd: string, request: Parameters<typeof questionText>[0] & { id: string }) {
      return serialize("question report", async () => {
        const linked = await linkedIssue(await locateBranch(cwd));
        if (!linked) return;
        const { location, identifier, client } = linked;
        const pending = await pendingQuestions(location);
        if (pending.includes(request.id)) return;

        const issue = await client.getIssue(identifier);
        if (pending.length === 0) {
          const before = issue.assignees?.map((a) => a.username) ?? (issue.needs_human ? ["human"] : []);
          await writeBranchConfig(location, "lificAssigneesBeforeQuestion", JSON.stringify(before));
          await client.updateIssueByIdentifier(identifier, { assignees: ["human"] });
        }
        await writeBranchConfig(location, "lificPendingQuestions", [...pending, request.id].join(","));
        await client.addComment(issue, `Waiting on a person. The agent asked in Paseo:\n\n${questionText(request)}`);
      });
    },

    questionResolved(cwd: string, requestId: string) {
      return serialize("question resolution", async () => {
        const linked = await linkedIssue(await locateBranch(cwd));
        if (!linked) return;
        const pending = await pendingQuestions(linked.location);
        if (!pending.includes(requestId)) return;
        const remaining = pending.filter((id) => id !== requestId);
        if (remaining.length > 0) {
          await writeBranchConfig(linked.location, "lificPendingQuestions", remaining.join(","));
          return;
        }
        await restoreAssignees(linked);
      });
    },

    turnEnded(cwd: string, outcome: PluginTurnOutcome) {
      if (outcome.kind === "canceled") return Promise.resolve();
      return serialize("turn report", async () => {
        const linked = await linkedIssue(await locateBranch(cwd));
        if (!linked) return;
        const failing = (await readBranchConfig(linked.location, "lificFailing")) !== null;
        if (outcome.kind === "completed") {
          if (failing) await unsetBranchConfig(linked.location, "lificFailing");
          return;
        }
        await onStepFailed(linked.location, linked.identifier);
        if (failing) return;
        await writeBranchConfig(linked.location, "lificFailing", "true");
        const issue = await linked.client.getIssue(linked.identifier);
        await linked.client.addComment(issue, `An agent turn failed in Paseo:\n\n${outcome.error.message}`);
      });
    },

    workspaceArchived(workspace: { id: string; cwd: string }, paseo: PaseoApi) {
      return serialize("archive report", async () => {
        const linked = await linkedIssue(await archivedBranch(workspace, paseo));
        if (!linked) return;
        if ((await pendingQuestions(linked.location)).length > 0) await restoreAssignees(linked);
        await unsetBranchConfig(linked.location, "lificFailing");

        const issue = await linked.client.getIssue(linked.identifier);
        if (issue.status !== "active") return;
        const moved = await linked.client.updateIssueByIdentifier(linked.identifier, { status: "todo" });
        await linked.client.addComment(
          moved,
          "The Paseo workspace for this issue was archived before the issue was closed. Moved back to todo.",
        );
        await onStepAbandoned(linked.location, linked.identifier);
      });
    },
  };
}

/**
 * Archiving can remove the worktree before the hook runs. Fall back to the branch Paseo last
 * saw and the project root, which shares the same git config.
 */
async function archivedBranch(workspace: { id: string; cwd: string }, paseo: PaseoApi): Promise<BranchLocation | null> {
  const direct = await locateBranch(workspace.cwd);
  if (direct) return direct;
  const descriptor = await paseo.workspaces.ref(workspace.id).refresh().catch(() => null);
  const branch = descriptor?.gitRuntime?.currentBranch;
  if (!descriptor || !branch) return null;
  return { cwd: descriptor.projectRootPath, branch };
}
