import { z } from "zod";

const QuestionsSchema = z.array(
  z.object({
    question: z.string(),
    options: z.array(z.object({ label: z.string() }).passthrough()).optional(),
  }).passthrough(),
);

interface QuestionRequest {
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  detail?: unknown;
}

/**
 * Readable text of a pending agent question. Claude, Codex, and OpenCode all put
 * `{ question, options? }[]` under `input.questions`; other providers fall back to the
 * plain-text detail, description, or title.
 */
export function questionText(request: QuestionRequest): string {
  const questions = QuestionsSchema.safeParse(request.input?.questions);
  if (questions.success && questions.data.length > 0) {
    return questions.data
      .map(({ question, options }) => {
        const choices = options?.length ? `\n  Options: ${options.map((o) => o.label).join(" / ")}` : "";
        return `- ${question}${choices}`;
      })
      .join("\n");
  }
  const detail = z.object({ type: z.literal("plain_text"), text: z.string() }).safeParse(request.detail);
  if (detail.success && detail.data.text.trim()) return detail.data.text.trim();
  return request.description?.trim() || request.title?.trim() || "The agent is waiting for an answer.";
}
