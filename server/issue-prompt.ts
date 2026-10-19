import type { Comment, Issue } from "../shared/lific";

const MAX_DESCRIPTION = 6000;
const MAX_COMMENT = 1200;

/**
 * Instructions appended to the system prompt of agents that run in a workspace linked to a Lific
 * issue. The agent owns the issue's content updates through its own Lific MCP connection; this
 * only tells it which issue it is on and how to close it.
 */
export function buildIssueInstructions(input: {
  issue: Issue;
  comments: Comment[];
  url: string;
  privateTracker: boolean;
  step?: { plan: string; index: number; total: number } | null;
}): string {
  const { issue, comments, url, privateTracker, step } = input;
  const lines = [
    `## Lific issue ${issue.identifier}`,
    "",
    `This workspace is linked to the Lific issue ${issue.identifier}: "${issue.title}" (${url}).`,
    `Status: ${issue.status}. Priority: ${issue.priority}.`,
  ];
  if (issue.labels.length > 0) lines.push(`Labels: ${issue.labels.join(", ")}.`);
  if (issue.blocked_by?.length) lines.push(`Blocked by: ${issue.blocked_by.join(", ")}.`);
  lines.push("", "### Description", "", truncate(issue.description.trim() || "(empty)", MAX_DESCRIPTION));

  if (comments.length > 0) {
    lines.push("", "### Recent comments (newest first)");
    for (const comment of comments) {
      lines.push("", `- ${comment.author_display_name || comment.author} (${comment.created_at}):`);
      lines.push(indent(truncate(comment.content.trim(), MAX_COMMENT)));
    }
  }

  lines.push(
    "",
    "### Working on it",
    "",
    "- Use your Lific MCP tools to read more context or update the issue. If they are not available, say so once and continue without them.",
    `- When the work is finished, set ${issue.identifier} to done with a short summary of what you changed and how you verified it.`,
    "- Comment on the issue only for things worth keeping: decisions, blockers, or the final summary. Do not narrate each step.",
  );
  if (step) {
    lines.push(
      `- This is step ${step.index} of ${step.total} in the Lific plan ${step.plan}. The next step branches off this branch, so commit your work here before you set the issue to done.`,
      "- Do not open a pull request unless you are asked to.",
    );
  }
  if (privateTracker) {
    lines.push(
      `- The tracker is private. Never mention ${issue.identifier} or any other Lific identifier or URL in branch names, commit messages, pull request titles, or pull request descriptions.`,
    );
  }
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
