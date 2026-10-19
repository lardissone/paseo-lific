import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { NOTE_KIND, NOTE_VERSION, type Note } from "../shared/note";

// Timeline rows are capped at 64 KiB serialized; leave room for the envelope.
const MAX_NOTE_BODY = 48_000;

/** Appends a plugin note card to an agent's timeline. */
export async function appendNote(
  paseo: PluginHandlerContext["paseo"],
  agentId: string,
  id: string,
  note: Note,
): Promise<void> {
  const body = note.body && note.body.length > MAX_NOTE_BODY ? `${note.body.slice(0, MAX_NOTE_BODY)}…` : note.body;
  await paseo.agents.ref(agentId).timeline.append({
    type: "plugin",
    id,
    kind: NOTE_KIND,
    version: NOTE_VERSION,
    data: { title: note.title, tone: note.tone ?? "info", ...(body ? { body } : {}), ...(note.url ? { url: note.url } : {}) },
  });
}
