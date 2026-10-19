import type { PlanStep } from "../shared/lific";
import type { RunRecord } from "./run-store";

export interface FlatStep {
  step: PlanStep;
  depth: number;
}

/** Every step of a plan tree in depth-first order, with its nesting depth. */
export function flattenSteps(steps: readonly PlanStep[], depth = 0): FlatStep[] {
  return steps.flatMap((step) => [{ step, depth }, ...flattenSteps(step.children, depth + 1)]);
}

/** A step is finished when it is checked or its mirrored issue is done; the two normally move together. */
export function stepFinished(step: PlanStep): boolean {
  return step.done || step.issue_status === "done";
}

/** A leaf is finished on its own; a parent is finished once every leaf under it is, checked or not. */
export function subtreeFinished(step: PlanStep): boolean {
  return step.children.length === 0 ? stepFinished(step) : step.children.every(subtreeFinished);
}

/**
 * Parent steps whose children are all finished but that are not checked themselves. Lific does
 * not close a parent on its own, so without this a plan never reaches 100%. Deepest first, so
 * checking them in order also completes grandparents on the next pass.
 */
export function finishedParents(steps: readonly PlanStep[]): PlanStep[] {
  return flattenSteps(steps)
    .filter(({ step }) => step.children.length > 0 && !step.done && step.children.every(subtreeFinished))
    .sort((a, b) => b.depth - a.depth)
    .map(({ step }) => step);
}

export interface Leaf {
  stepId: number;
  title: string;
  description: string;
  issue: string | null;
  finished: boolean;
  cancelled: boolean;
}

/** Leaf steps in depth-first order. Only leaves get work; a parent is done when its children are. */
export function planLeaves(steps: readonly PlanStep[]): Leaf[] {
  return flattenSteps(steps)
    .filter(({ step }) => step.children.length === 0)
    .map(({ step }) => ({
      stepId: step.id,
      title: step.title,
      description: step.description,
      issue: step.issue_identifier ?? null,
      finished: stepFinished(step),
      cancelled: step.issue_status === "cancelled",
    }));
}

export type RunAction =
  | { kind: "done" }
  | { kind: "wait" }
  | { kind: "create-issue"; leaf: Leaf }
  | { kind: "pause"; pause: { kind: "review" | "cancelled"; issue: string } }
  | {
      kind: "start";
      issue: string;
      /** Zero-based position among the plan's leaves. */
      index: number;
      baseBranch: string;
      /** The step before this one, so the runner can archive its workspace once this starts. */
      previous: { issue: string; branch: string | null } | null;
    };

/**
 * The next thing a run should do, derived only from the plan and the linked branches, so
 * evaluating it again after a crash or restart converges instead of repeating work.
 */
export function nextRunAction(
  leaves: readonly Leaf[],
  run: RunRecord,
  branchOf: (issue: string) => string | null,
): RunAction {
  const index = leaves.findIndex((leaf) => !leaf.finished);
  if (index === -1) return { kind: "done" };
  const leaf = leaves[index]!;
  if (leaf.issue && leaf.cancelled) return { kind: "pause", pause: { kind: "cancelled", issue: leaf.issue } };
  if (leaf.issue && branchOf(leaf.issue)) return { kind: "wait" };

  const previousIssue = index > 0 ? leaves[index - 1]!.issue : null;
  const previous = previousIssue ? { issue: previousIssue, branch: branchOf(previousIssue) } : null;
  // The review gate comes before creating the next step's issue, so that issue does not show up
  // as ready to start while the run waits for the person.
  if (run.mode === "review" && previous && run.approved !== previous.issue) {
    return { kind: "pause", pause: { kind: "review", issue: previous.issue } };
  }
  if (!leaf.issue) return { kind: "create-issue", leaf };
  const baseBranch = run.branching === "stacked" && previous?.branch ? previous.branch : run.base;
  return { kind: "start", issue: leaf.issue, index, baseBranch, previous };
}
