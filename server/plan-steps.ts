import type { PlanStep } from "../shared/lific";
import type { RunRecord } from "./run-store";

export interface Leaf {
  stepId: number;
  title: string;
  description: string;
  issue: string | null;
  finished: boolean;
  cancelled: boolean;
}

/** Leaf steps in depth-first order. A parent step is done when its children are. */
export function planLeaves(steps: readonly PlanStep[]): Leaf[] {
  return steps.flatMap((step) =>
    step.children.length > 0
      ? planLeaves(step.children)
      : [
          {
            stepId: step.id,
            title: step.title,
            description: step.description,
            issue: step.issue_identifier ?? null,
            finished: step.done || step.issue_status === "done",
            cancelled: step.issue_status === "cancelled",
          },
        ],
  );
}

export type RunAction =
  | { kind: "done" }
  | { kind: "wait"; leaf: Leaf }
  | { kind: "create-issue"; leaf: Leaf }
  | { kind: "pause"; reason: string }
  | { kind: "start"; leaf: Leaf; index: number; baseBranch: string };

/**
 * The next thing a run should do, derived only from the plan and the linked branches, so
 * evaluating it again after a crash or restart converges instead of repeating work.
 */
export function nextRunAction(leaves: readonly Leaf[], run: RunRecord, branchOf: (issue: string) => string | null): RunAction {
  const index = leaves.findIndex((leaf) => !leaf.finished);
  if (index === -1) return { kind: "done" };
  const leaf = leaves[index]!;
  if (leaf.cancelled && leaf.issue) return { kind: "pause", reason: `cancelled:${leaf.issue}` };
  if (!leaf.issue) return { kind: "create-issue", leaf };
  if (branchOf(leaf.issue)) return { kind: "wait", leaf };

  const previous = index > 0 ? leaves[index - 1]! : null;
  if (run.mode === "review" && previous?.issue && run.approved !== previous.issue) {
    return { kind: "pause", reason: `review:${previous.issue}` };
  }
  const previousBranch = previous?.issue ? branchOf(previous.issue) : null;
  const baseBranch = run.branching === "stacked" && previousBranch ? previousBranch : run.base;
  return { kind: "start", leaf, index, baseBranch };
}
