import type { Issue } from "../shared/lific";

/**
 * In-memory Lific holding one issue, served through the client's `request` seam so tests run the
 * real client: URL building, `expected_seq`, and response parsing. Test-only; not imported by
 * the plugin entries.
 */
export function createFakeLific(initial: Partial<Issue> = {}) {
  let issue: Issue = {
    id: 1,
    project_id: 1,
    identifier: "MIO-23",
    title: "Fix sync",
    description: "",
    status: "active",
    priority: "none",
    labels: [],
    seq: 1,
    updated_at: "2026-10-19T00:00:00Z",
    needs_human: false,
    ...initial,
  };
  const comments: string[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const request: typeof fetch = async (input, init) => {
    const { pathname } = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (method === "GET" && pathname === `/api/issues/resolve/${issue.identifier}`) return json(200, issue);
    if (method === "PUT" && pathname === `/api/issues/${issue.id}`) {
      if (body.expected_seq !== issue.seq) return json(409, { error: "changed", code: "update_conflict" });
      const assignees: string[] | undefined = body.assignees;
      issue = {
        ...issue,
        ...(body.status ? { status: body.status } : {}),
        ...(assignees
          ? {
              needs_human: assignees.includes("human"),
              assignees: assignees
                .filter((name) => name !== "human")
                .map((username, index) => ({ user_id: index + 10, username })),
            }
          : {}),
        seq: issue.seq + 1,
      };
      if (issue.assignees?.length === 0) delete issue.assignees;
      return json(200, issue);
    }
    if (method === "POST" && pathname === `/api/issues/${issue.id}/comments`) {
      comments.push(body.content);
      return json(200, {
        id: comments.length,
        author: "paseo",
        author_display_name: "Paseo",
        content: body.content,
        created_at: "2026-10-19T00:00:00Z",
      });
    }
    return json(404, { error: `no route for ${method} ${pathname}` });
  };

  return { request, comments, issue: () => issue };
}
