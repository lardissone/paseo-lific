import { z } from "zod";

// Plan run vocabulary shared by the runner, its git-config store, and the screens.

export const RunStatusSchema = z.enum(["running", "paused", "done"]);
export type RunStatus = z.output<typeof RunStatusSchema>;

export const RunModeSchema = z.enum(["review", "continuous"]);
export type RunMode = z.output<typeof RunModeSchema>;

export const RunBranchingSchema = z.enum(["stacked", "base"]);
export type RunBranching = z.output<typeof RunBranchingSchema>;

export const RunControlActionSchema = z.enum(["continue", "pause", "stop"]);
export type RunControlAction = z.output<typeof RunControlActionSchema>;

/** Why a run is paused. Every kind except `manual` names the step issue it stopped at. */
export const RunPauseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("review"), issue: z.string() }),
  z.object({ kind: z.literal("failed"), issue: z.string() }),
  z.object({ kind: z.literal("cancelled"), issue: z.string() }),
  z.object({ kind: z.literal("archived"), issue: z.string() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type RunPause = z.output<typeof RunPauseSchema>;

/** One-line encoding for git config, e.g. `review:MIO-23`. */
export function formatRunPause(pause: RunPause): string {
  switch (pause.kind) {
    case "manual":
      return "manual";
    case "error":
      return `error:${pause.message.replace(/\s+/g, " ")}`;
    default:
      return `${pause.kind}:${pause.issue}`;
  }
}

export function parseRunPause(text: string): RunPause | null {
  if (text === "manual") return { kind: "manual" };
  const colon = text.indexOf(":");
  const kind = text.slice(0, colon);
  const rest = text.slice(colon + 1);
  if (colon === -1 || rest === "") return null;
  if (kind === "error") return { kind, message: rest };
  const parsed = RunPauseSchema.safeParse({ kind, issue: rest });
  return parsed.success ? parsed.data : null;
}

export function describeRunPause(pause: RunPause): string {
  switch (pause.kind) {
    case "manual":
      return "Paused";
    case "review":
      return `Waiting for your review of ${pause.issue}`;
    case "failed":
      return `Paused: an agent failed on ${pause.issue}`;
    case "cancelled":
      return `Paused: ${pause.issue} was cancelled`;
    case "archived":
      return `Paused: the workspace for ${pause.issue} was archived. Continue restarts that step.`;
    case "error":
      return `Paused after an error: ${pause.message}`;
  }
}
