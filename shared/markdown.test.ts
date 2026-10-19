import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("splits links, bold, code, and italics from text", () => {
    expect(parseInline("[LIFIC-2](https://l.test/LIFIC/issues/LIFIC-2) | **bold** `code` *it* _too_ snake_case")).toEqual([
      { type: "link", text: "LIFIC-2", url: "https://l.test/LIFIC/issues/LIFIC-2" },
      { type: "text", text: " | " },
      { type: "bold", text: "bold" },
      { type: "text", text: " " },
      { type: "code", text: "code" },
      { type: "text", text: " " },
      { type: "italic", text: "it" },
      { type: "text", text: " " },
      { type: "italic", text: "too" },
      { type: "text", text: " snake_case" },
    ]);
  });

  it("keeps since='…' style text intact", () => {
    expect(parseInline("Resume later with since='2026-10-19T16:43:44Z'")).toEqual([
      { type: "text", text: "Resume later with since='2026-10-19T16:43:44Z'" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("parses a Lific briefing", () => {
    const blocks = parseMarkdown(
      [
        "[LIFIC](https://l.test/LIFIC/overview) briefing at 2026-10-19.",
        "Resume later.",
        "",
        "## Workable (2)",
        "- [LIFIC-2](https://l.test/x) | backlog",
        "  - [x] nested done",
        "1. first",
        "---",
        "```",
        "code **not bold**",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "heading", "item", "item", "item", "rule", "code"]);
    expect(blocks[0]).toMatchObject({ inlines: [{ type: "link", text: "LIFIC" }, { type: "text", text: " briefing at 2026-10-19. Resume later." }] });
    expect(blocks[1]).toMatchObject({ level: 2 });
    expect(blocks[3]).toMatchObject({ depth: 1, marker: "☑", inlines: [{ type: "text", text: "nested done" }] });
    expect(blocks[4]).toMatchObject({ marker: "1." });
    expect(blocks[6]).toEqual({ type: "code", text: "code **not bold**" });
  });
});
