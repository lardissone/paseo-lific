import { describe, expect, it } from "vitest";
import { formatRunPause, parseRunPause, type RunPause } from "./run";

describe("run pause encoding", () => {
  it.each<RunPause>([
    { kind: "manual" },
    { kind: "review", issue: "MIO-23" },
    { kind: "failed", issue: "MIO-23" },
    { kind: "cancelled", issue: "MIO-23" },
    { kind: "archived", issue: "MIO-23" },
    { kind: "error", message: "Lific GET /plans failed (500): boom" },
  ])("round-trips %j", (pause) => {
    expect(parseRunPause(formatRunPause(pause))).toEqual(pause);
  });

  it("keeps error messages on one line and rejects unknown text", () => {
    expect(formatRunPause({ kind: "error", message: "a\nb" })).toBe("error:a b");
    expect(parseRunPause("bogus:MIO-1")).toBeNull();
    expect(parseRunPause("review:")).toBeNull();
    expect(parseRunPause("nonsense")).toBeNull();
  });
});
