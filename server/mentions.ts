import { type IssueCard, issueCard } from "../shared/lific";
import type { Connections } from "./connection";

const MAX_MENTIONS = 10;

interface TimelineItem {
  type: string;
  text?: string;
}

/**
 * Lific identifiers the agent mentioned in its replies during the last turn, in order of first
 * mention. Only identifiers of known projects count, so `UTF-8` or `ISO-8601` never match.
 */
export function mentionedIssues(timeline: readonly TimelineItem[], projectIdentifiers: readonly string[]): string[] {
  if (projectIdentifiers.length === 0) return [];
  let start = 0;
  for (let index = timeline.length - 1; index >= 0; index--) {
    if (timeline[index]!.type === "user_message") {
      start = index + 1;
      break;
    }
  }
  const text = timeline
    .slice(start)
    .filter((item) => item.type === "assistant_message" && item.text)
    .map((item) => item.text)
    .join("");

  const projects = projectIdentifiers.map(escapeRegExp).join("|");
  const pattern = new RegExp(`(?<![\\w-])(?:${projects})-\\d+(?![\\w-])`, "g");
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    if (!found.includes(match[0])) found.push(match[0]);
    if (found.length === MAX_MENTIONS) break;
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cards for the Lific issues an agent mentioned in its last turn, or none. */
export async function mentionedIssueCards(
  connections: Connections,
  timeline: readonly TimelineItem[],
): Promise<IssueCard[]> {
  const connection = await connections.optional();
  if (!connection) return [];
  const projects = await connections.listProjects(connection);
  const identifiers = mentionedIssues(
    timeline,
    projects.map((project) => project.identifier),
  );
  const issues = await Promise.all(identifiers.map((identifier) => connection.client.getIssue(identifier).catch(() => null)));
  return issues.flatMap((issue) => (issue ? [issueCard(connection.settings.baseUrl, issue)] : []));
}
