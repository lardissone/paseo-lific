import { describe, expect, it } from "vitest";
import { renderBranchName, slugify } from "./branch";

describe("slugify", () => {
  it("folds accents and punctuation into dashes", () => {
    expect(slugify("Transcribir audio: ¡rápido!")).toBe("transcribir-audio-rapido");
  });

  it("cuts long titles at a word boundary", () => {
    const slug = slugify("Keep the workspace setup logs scoped to the visible setup panel forever");
    expect(slug).toBe("keep-the-workspace-setup-logs-scoped-to-the");
    expect(slug.length).toBeLessThanOrEqual(48);
  });
});

describe("renderBranchName", () => {
  const issue = { identifier: "MIO-23", title: "Fix BLE reconnect" };

  it("keeps the identifier out by default", () => {
    expect(renderBranchName("{slug}", issue)).toBe("fix-ble-reconnect");
  });

  it("supports identifier and prefix templates", () => {
    expect(renderBranchName("feat/{identifier}-{slug}", issue)).toBe("feat/mio-23-fix-ble-reconnect");
  });

  it("falls back when the title has no usable characters", () => {
    expect(renderBranchName("{slug}", { identifier: "X-1", title: "???" })).toBe("work");
  });
});
