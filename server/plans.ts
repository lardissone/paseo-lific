import { IssueStatusSchema, issueWebUrl, resourceWebUrl } from "../shared/lific";
import type { Connections } from "./connection";
import { flattenSteps, stepFinished, subtreeFinished } from "./plan-steps";

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
  const { client, settings } = await connections.require();
  const plan = await client.resolvePlan(identifier);
  return {
    title: plan.title,
    status: plan.status,
    url: resourceWebUrl(settings.baseUrl, plan.identifier, "plans", plan.id),
    doneCount: plan.done_count,
    stepCount: plan.step_count,
    steps: flattenSteps(plan.steps).map(({ step, depth }) => {
      const issue = step.issue_identifier ?? null;
      return {
        depth,
        title: step.title,
        issue,
        issueStatus: IssueStatusSchema.safeParse(step.issue_status).data ?? null,
        issueUrl: issue ? issueWebUrl(settings.baseUrl, issue) : null,
        done: stepFinished(step) || subtreeFinished(step),
      };
    }),
  };
}
