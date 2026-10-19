import type { PluginAttachmentItem } from "@getpaseo/plugin";
import {
  type Comment,
  type Issue,
  issueWebUrl,
  type Page,
  type Plan,
  type PlanStep,
  resourceWebUrl,
} from "../shared/lific";
import type { LificClient } from "./lific-client";

const ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/i;
const PAGE_ID = /^(?:[A-Z][A-Z0-9]*-)?DOC-\d+$/i;
const PLAN_ID = /^[A-Z][A-Z0-9]*-PLAN-\d+$/i;
const SEARCH_LIMIT = 8;

export async function searchAttachments(
  client: LificClient,
  baseUrl: string,
  rawQuery: string,
): Promise<PluginAttachmentItem[]> {
  const query = rawQuery.trim();
  if (query === "") return [];

  if (PLAN_ID.test(query)) {
    const plan = await client.resolvePlan(query.toUpperCase()).catch(() => null);
    return plan ? [planItem(baseUrl, plan)] : [];
  }
  if (PAGE_ID.test(query)) {
    const page = await client.resolvePage(query.toUpperCase()).catch(() => null);
    return page ? [pageItem(baseUrl, page)] : [];
  }
  if (ISSUE_ID.test(query)) {
    const issue = await client.getIssue(query.toUpperCase()).catch(() => null);
    if (issue) return [issueItem(baseUrl, issue, await client.listRecentComments(issue, 5))];
  }

  const results = await client.search({ query, limit: SEARCH_LIMIT });
  const items = await Promise.all(
    results.map(async (result) => {
      if (result.result_type === "issue" && result.identifier) {
        const issue = await client.getIssue(result.identifier);
        return issueItem(baseUrl, issue, await client.listRecentComments(issue, 5));
      }
      if (result.result_type === "page") return pageItem(baseUrl, await client.getPage(result.id));
      return null;
    }),
  );
  return items.filter((item) => item !== null);
}

export function issueItem(baseUrl: string, issue: Issue, comments: Comment[]): PluginAttachmentItem {
  const url = issueWebUrl(baseUrl, issue.identifier);
  const lines = [
    `# ${issue.identifier}: ${issue.title}`,
    "",
    `Lific issue · ${url}`,
    `Status: ${issue.status} · Priority: ${issue.priority}${issue.labels.length ? ` · Labels: ${issue.labels.join(", ")}` : ""}`,
  ];
  if (issue.blocked_by?.length) lines.push(`Blocked by: ${issue.blocked_by.join(", ")}`);
  if (issue.blocks?.length) lines.push(`Blocks: ${issue.blocks.join(", ")}`);
  lines.push("", issue.description.trim() || "(no description)");
  if (comments.length > 0) {
    lines.push("", "## Recent comments (newest first)");
    for (const comment of comments) {
      lines.push("", `**${comment.author_display_name || comment.author}** (${comment.created_at})`, comment.content.trim());
    }
  }
  return {
    id: `issue:${issue.identifier}`,
    identifier: issue.identifier,
    title: issue.title,
    subtitle: `Issue · ${issue.status}`,
    url,
    text: lines.join("\n"),
    resourceType: "issue",
  };
}

export function pageItem(baseUrl: string, page: Page): PluginAttachmentItem {
  const url = resourceWebUrl(baseUrl, page.identifier, "pages", page.id);
  return {
    id: `page:${page.identifier}`,
    identifier: page.identifier,
    title: page.title,
    subtitle: `Page · ${page.status}`,
    url,
    text: [`# ${page.identifier}: ${page.title}`, "", `Lific page · ${url}`, "", page.content.trim()].join("\n"),
    resourceType: "page",
  };
}

export function planItem(baseUrl: string, plan: Plan): PluginAttachmentItem {
  const url = resourceWebUrl(baseUrl, plan.identifier, "plans", plan.id);
  const lines = [
    `# ${plan.identifier}: ${plan.title}`,
    "",
    `Lific plan · ${url}`,
    `Status: ${plan.status} · ${plan.done_count}/${plan.step_count} steps done`,
    "",
  ];
  appendSteps(lines, plan.steps, 0);
  return {
    id: `plan:${plan.identifier}`,
    identifier: plan.identifier,
    title: plan.title,
    subtitle: `Plan · ${plan.done_count}/${plan.step_count} done`,
    url,
    text: lines.join("\n"),
    resourceType: "plan",
  };
}

function appendSteps(lines: string[], steps: PlanStep[], depth: number): void {
  for (const step of steps) {
    const issue = step.issue_identifier ? ` (${step.issue_identifier}${step.issue_status ? `, ${step.issue_status}` : ""})` : "";
    lines.push(`${"  ".repeat(depth)}- [${step.done ? "x" : " "}] ${step.title}${issue}`);
    if (step.description.trim()) lines.push(`${"  ".repeat(depth + 1)}${step.description.trim().replace(/\n/g, " ")}`);
    appendSteps(lines, step.children, depth + 1);
  }
}
