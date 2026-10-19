import { describe, expect, it } from "vitest";
import type { Plan, PlanStep } from "../shared/lific";
import { lificSettings } from "../shared/settings";
import { createConnection } from "./connection";
import { planPreview } from "./plans";

function step(id: number, changes: Partial<PlanStep> = {}): PlanStep {
  return { id, issue_id: null, title: `Step ${id}`, description: "", done: false, children: [], ...changes };
}

const plan: Plan = {
  id: 43,
  project_id: 1,
  identifier: "MEM-PLAN-1",
  title: "Memento v0",
  status: "active",
  step_count: 3,
  done_count: 1,
  steps: [
    step(1, {
      children: [
        step(2, { issue_id: 2, issue_identifier: "MEM-2", issue_status: "done" }),
        step(3, { issue_id: 7, issue_identifier: "MEM-7", issue_status: "active" }),
      ],
    }),
    step(4, { children: [step(5, { issue_id: 9, issue_identifier: "MEM-9", issue_status: "done" })] }),
  ],
};

describe("plan preview", () => {
  it("lists every step with its issue status and links, and finishes parents whose children are done", async () => {
    const values = lificSettings.schema.parse({ baseUrl: "https://lific.test/", apiKey: "k" });
    const request: typeof fetch = async (input) =>
      new URL(String(input)).pathname === "/api/plans/resolve/MEM-PLAN-1"
        ? new Response(JSON.stringify(plan), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response("{}", { status: 404 });
    const connections = createConnection({ read: async () => ({ status: "ready", values }) } as never, request);

    expect(await planPreview(connections, "MEM-PLAN-1")).toEqual({
      title: "Memento v0",
      status: "active",
      url: "https://lific.test/MEM/plans/43",
      doneCount: 1,
      stepCount: 3,
      steps: [
        { depth: 0, title: "Step 1", issue: null, issueStatus: null, issueUrl: null, done: false },
        { depth: 1, title: "Step 2", issue: "MEM-2", issueStatus: "done", issueUrl: "https://lific.test/MEM/issues/MEM-2", done: true },
        { depth: 1, title: "Step 3", issue: "MEM-7", issueStatus: "active", issueUrl: "https://lific.test/MEM/issues/MEM-7", done: false },
        { depth: 0, title: "Step 4", issue: null, issueStatus: null, issueUrl: null, done: true },
        { depth: 1, title: "Step 5", issue: "MEM-9", issueStatus: "done", issueUrl: "https://lific.test/MEM/issues/MEM-9", done: true },
      ],
    });
  });
});
