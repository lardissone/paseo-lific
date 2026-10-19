import type { Connections } from "./connection";
import { flattenSteps, stepFinished } from "./plan-steps";

export async function listPlans(connections: Connections, projectRoot: string) {
  const { client } = await connections.require();
  const project = await connections.requireProject(projectRoot);
  const plans = await client.listPlans(project.id);
  return {
    plans: plans.map((plan) => ({
      identifier: plan.identifier,
      title: plan.title,
      status: plan.status,
      stepCount: plan.step_count,
      doneCount: plan.done_count,
    })),
  };
}

export async function planPreview(connections: Connections, identifier: string) {
  const { client } = await connections.require();
  const plan = await client.resolvePlan(identifier);
  return {
    steps: flattenSteps(plan.steps).map(({ step, depth }) => ({
      depth,
      title: step.title,
      issue: step.issue_identifier ?? null,
      done: stepFinished(step),
    })),
  };
}
