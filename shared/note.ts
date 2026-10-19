import { z } from "zod";

/** Timeline card the plugin appends to an agent's timeline to report a slash command result. */
export const NOTE_KIND = "note";
export const NOTE_VERSION = 1;

export const NoteSchema = z.object({
  title: z.string(),
  body: z.string().optional(),
  url: z.string().optional(),
  tone: z.enum(["info", "success", "warning"]).default("info"),
});
export type Note = z.input<typeof NoteSchema>;
