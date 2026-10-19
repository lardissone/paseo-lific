import { describe, expect, it } from "vitest";
import { questionText } from "./question-text";

describe("questionText", () => {
  it("lists structured questions with their options", () => {
    expect(
      questionText({
        title: "Question",
        input: {
          questions: [
            { question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres" }] },
            { question: "Ship today?" },
          ],
        },
      }),
    ).toBe("- Which database?\n  Options: SQLite / Postgres\n- Ship today?");
  });

  it("falls back to plain-text detail, then description, then title", () => {
    expect(questionText({ title: "Q", detail: { type: "plain_text", text: " Pick one " } })).toBe("Pick one");
    expect(questionText({ title: "Q", description: "Need a name" })).toBe("Need a name");
    expect(questionText({ title: "Q" })).toBe("Q");
    expect(questionText({})).toBe("The agent is waiting for an answer.");
  });
});
