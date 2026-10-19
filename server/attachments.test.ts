import { describe, expect, it } from "vitest";
import { PluginAttachmentItemSchema } from "@getpaseo/plugin";
import { issueItem, pageItem, planItem } from "./attachments";

const base = "https://lific.test/";

describe("attachment snapshots", () => {
  it("renders an issue with its comments and a valid item", () => {
    const item = issueItem(
      base,
      {
        id: 1,
        project_id: 1,
        identifier: "MIO-23",
        title: "Fix sync",
        description: "Drops after sleep.",
        status: "todo",
        priority: "high",
        labels: ["ble"],
        seq: 3,
        updated_at: "",
        needs_human: false,
        blocked_by: ["MIO-20"],
      },
      [{ id: 1, author: "leandro", author_display_name: "Leandro", content: "Seen on v2", created_at: "2026-10-18" }],
    );
    expect(PluginAttachmentItemSchema.parse(item)).toEqual(item);
    expect(item.url).toBe("https://lific.test/MIO/issues/MIO-23");
    expect(item.text).toContain("Blocked by: MIO-20");
    expect(item.text).toContain("**Leandro** (2026-10-18)\nSeen on v2");
  });

  it("links pages and plans by numeric id", () => {
    expect(pageItem(base, { id: 17, identifier: "LIF-DOC-3", title: "Design", content: "x", status: "active" }).url).toBe(
      "https://lific.test/LIF/pages/17",
    );
    expect(pageItem(base, { id: 18, identifier: "DOC-3", title: "Global", content: "x", status: "active" }).url).toBe(
      "https://lific.test/DOC/pages/18",
    );
  });

  it("renders a plan as a nested checklist", () => {
    const item = planItem(base, {
      id: 19,
      identifier: "LIF-PLAN-4",
      title: "Ship v2",
      status: "active",
      step_count: 3,
      done_count: 1,
      steps: [
        {
          title: "Backend",
          description: "",
          done: false,
          children: [
            { title: "Schema", description: "", done: true, issue_identifier: "LIF-9", issue_status: "done", children: [] },
          ],
        },
        { title: "App", description: "Wire it up", done: false, children: [] },
      ],
    });
    expect(item.url).toBe("https://lific.test/LIF/plans/19");
    expect(item.text).toContain("- [ ] Backend\n  - [x] Schema (LIF-9, done)\n- [ ] App\n  Wire it up");
  });
});
