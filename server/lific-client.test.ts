import { describe, expect, it } from "vitest";
import { createLificClient, LificError } from "./lific-client";

const issue = {
  id: 7,
  project_id: 1,
  identifier: "MIO-23",
  title: "Fix sync",
  description: "",
  status: "todo",
  priority: "none",
  labels: [],
  seq: 1,
  updated_at: "2026-10-19T00:00:00Z",
  needs_human: false,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createLificClient", () => {
  it("retries an update once after a sequence conflict", async () => {
    const puts: unknown[] = [];
    let seq = 1;
    const client = createLificClient({
      baseUrl: "https://lific.test/",
      apiKey: "k",
      request: async (url, init) => {
        expect(String(url)).toMatch(/^https:\/\/lific\.test\/api\//);
        if (init?.method === "GET") return json(200, { ...issue, seq });
        puts.push(JSON.parse(String(init?.body)));
        if (puts.length === 1) {
          seq = 2;
          return json(409, { error: "MIO-23 has changed", code: "update_conflict" });
        }
        return json(200, { ...issue, seq: 3, status: "active" });
      },
    });

    const updated = await client.updateIssueByIdentifier("MIO-23", { status: "active" });
    expect(updated.status).toBe("active");
    expect(puts).toEqual([
      { status: "active", expected_seq: 1 },
      { status: "active", expected_seq: 2 },
    ]);
  });

  it("reports Lific's error message with the status", async () => {
    const client = createLificClient({
      baseUrl: "https://lific.test",
      apiKey: "k",
      request: async () => json(404, { error: "issue MIO-99 not found" }),
    });
    await expect(client.getIssue("MIO-99")).rejects.toMatchObject({
      message: "Lific GET /issues/resolve/MIO-99 failed (404): issue MIO-99 not found",
      status: 404,
    });
  });

  it("reads MCP tool text and surfaces tool errors", async () => {
    const replies = [
      json(200, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "# Briefing" }] } }),
      json(200, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "unknown project" }], isError: true } }),
    ];
    const client = createLificClient({ baseUrl: "https://lific.test", apiKey: "k", request: async () => replies.shift()! });
    expect(await client.getBriefing("MIO")).toBe("# Briefing");
    await expect(client.getBriefing("NOPE")).rejects.toBeInstanceOf(LificError);
  });
});
