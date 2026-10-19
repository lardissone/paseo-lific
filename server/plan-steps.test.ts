import { describe, expect, it } from "vitest";
import type { PlanStep } from "../shared/lific";
import { type Leaf, nextRunAction, planLeaves } from "./plan-steps";
import type { RunRecord } from "./run-store";

function step(id: number, fields: Partial<PlanStep> = {}): PlanStep {
  return { id, issue_id: null, title: `Step ${id}`, description: "", done: false, children: [], ...fields };
}

function leaf(issue: string | null, fields: Partial<Leaf> = {}): Leaf {
  return { stepId: 0, title: "t", description: "", issue, finished: false, cancelled: false, ...fields };
}

const run: RunRecord = {
  plan: "MIO-PLAN-1",
  status: "running",
  mode: "continuous",
  branching: "stacked",
  base: "main",
  provider: "claude/opus",
  pause: null,
  approved: null,
  archive: false,
};

describe("planLeaves", () => {
  it("flattens nested steps depth first and reads issue state", () => {
    const leaves = planLeaves([
      step(1, { children: [step(2, { issue_identifier: "MIO-2", issue_status: "done" }), step(3)] }),
      step(4, { issue_identifier: "MIO-4", issue_status: "cancelled" }),
    ]);
    expect(leaves.map((l) => [l.stepId, l.issue, l.finished, l.cancelled])).toEqual([
      [2, "MIO-2", true, false],
      [3, null, false, false],
      [4, "MIO-4", false, true],
    ]);
  });
});

describe("nextRunAction", () => {
  const branches = new Map([["MIO-1", "first-step"]]);
  const branchOf = (issue: string) => branches.get(issue) ?? null;

  it("starts the first step from the run base", () => {
    expect(nextRunAction([leaf("MIO-9")], run, branchOf)).toEqual({
      kind: "start",
      issue: "MIO-9",
      index: 0,
      baseBranch: "main",
      previous: null,
    });
  });

  it("stacks the next step on the previous step's branch", () => {
    const leaves = [leaf("MIO-1", { finished: true }), leaf("MIO-2")];
    expect(nextRunAction(leaves, run, branchOf)).toMatchObject({
      kind: "start",
      index: 1,
      baseBranch: "first-step",
      previous: { issue: "MIO-1", branch: "first-step" },
    });
    expect(nextRunAction(leaves, { ...run, branching: "base" }, branchOf)).toMatchObject({ baseBranch: "main" });
  });

  it("waits while the current step has a workspace", () => {
    expect(nextRunAction([leaf("MIO-1")], run, branchOf)).toMatchObject({ kind: "wait" });
  });

  it("pauses for review until the previous step is approved", () => {
    const leaves = [leaf("MIO-1", { finished: true }), leaf("MIO-2")];
    const review = { ...run, mode: "review" as const };
    expect(nextRunAction(leaves, review, branchOf)).toEqual({ kind: "pause", pause: { kind: "review", issue: "MIO-1" } });
    expect(nextRunAction(leaves, { ...review, approved: "MIO-1" }, branchOf)).toMatchObject({ kind: "start" });
  });

  it("pauses for review before creating the next step's issue", () => {
    const leaves = [leaf("MIO-1", { finished: true }), leaf(null)];
    expect(nextRunAction(leaves, { ...run, mode: "review" }, branchOf)).toEqual({
      kind: "pause",
      pause: { kind: "review", issue: "MIO-1" },
    });
  });

  it("creates missing issues, pauses on cancelled ones, and finishes", () => {
    expect(nextRunAction([leaf(null)], run, branchOf)).toMatchObject({ kind: "create-issue" });
    expect(nextRunAction([leaf("MIO-3", { cancelled: true })], run, branchOf)).toEqual({
      kind: "pause",
      pause: { kind: "cancelled", issue: "MIO-3" },
    });
    expect(nextRunAction([leaf("MIO-1", { finished: true })], run, branchOf)).toEqual({ kind: "done" });
  });
});
