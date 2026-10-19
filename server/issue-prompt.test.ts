import { describe, expect, it } from "vitest";
import type { Issue } from "../shared/lific";
import { buildIssueInstructions } from "./issue-prompt";

const issue: Issue = {
  id: 7,
  project_id: 1,
  identifier: "MIO-23",
  title: "Fix BLE reconnect",
  description: "The pendant drops after sleep.",
  status: "active",
  priority: "high",
  labels: ["ble"],
  seq: 10,
  updated_at: "2026-10-19T10:00:00Z",
  needs_human: false,
  blocked_by: ["MIO-20"],
};

describe("buildIssueInstructions", () => {
  it("names the issue, its context, and how to close it", () => {
    const text = buildIssueInstructions({
      issue,
      comments: [
        {
          id: 1,
          author: "leandro",
          author_display_name: "Leandro",
          content: "Repro with the v2 firmware.",
          created_at: "2026-10-18T09:00:00Z",
        },
      ],
      url: "https://lific.test/MIO/issues/MIO-23",
      privateTracker: true,
    });
    expect(text).toContain('MIO-23: "Fix BLE reconnect"');
    expect(text).toContain("Blocked by: MIO-20.");
    expect(text).toContain("The pendant drops after sleep.");
    expect(text).toContain("Leandro (2026-10-18T09:00:00Z)");
    expect(text).toContain("set MIO-23 to done");
    expect(text).toContain("Never mention MIO-23");
  });

  it("allows identifiers in commits when the tracker is not private", () => {
    const text = buildIssueInstructions({ issue, comments: [], url: "u", privateTracker: false });
    expect(text).not.toContain("Never mention");
    expect(text).not.toContain("Recent comments");
  });
});
