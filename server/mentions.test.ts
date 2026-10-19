import { describe, expect, it } from "vitest";
import { mentionedIssues } from "./mentions";

describe("mentionedIssues", () => {
  it("collects known identifiers from the last turn's replies only", () => {
    const timeline = [
      { type: "user_message", text: "look at MIO-1" },
      { type: "assistant_message", text: "Done with MIO-1." },
      { type: "user_message", text: "and now?" },
      { type: "assistant_message", text: "Fixed MIO-23 and LIFIC-6; MIO-23 again, " },
      { type: "tool_call", text: "MIO-99" },
      { type: "assistant_message", text: "see SG-4 (not UTF-8, MIO-DOC-3, or XMIO-5)." },
    ];
    expect(mentionedIssues(timeline, ["MIO", "LIFIC", "SG"])).toEqual(["MIO-23", "LIFIC-6", "SG-4"]);
  });

  it("returns nothing without known projects", () => {
    expect(mentionedIssues([{ type: "assistant_message", text: "MIO-1" }], [])).toEqual([]);
  });
});
