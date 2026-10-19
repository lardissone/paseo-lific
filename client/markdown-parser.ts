// Small Markdown subset for Lific text (briefings, issue descriptions, comments). Plugin client
// bundles can only use host-provided modules, and the host exposes no Markdown renderer.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; url: string };

export type Block =
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "item"; depth: number; marker: string; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "code"; text: string }
  | { type: "rule" };

const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<!\w)_([^_\s][^_]*)_(?!\w)/g;

export function parseInline(text: string): Inline[] {
  const inlines: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) inlines.push({ type: "text", text: text.slice(last, index) });
    const [, linkText, url, bold, code, starItalic, underscoreItalic] = match;
    if (linkText !== undefined && url !== undefined) inlines.push({ type: "link", text: linkText, url });
    else if (bold !== undefined) inlines.push({ type: "bold", text: bold });
    else if (code !== undefined) inlines.push({ type: "code", text: code });
    else inlines.push({ type: "italic", text: starItalic ?? underscoreItalic ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) inlines.push({ type: "text", text: text.slice(last) });
  return inlines;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++index < lines.length && !lines[index]!.trimStart().startsWith("```")) code.push(lines[index]!);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length, inlines: parseInline(heading[2]!.trim()) });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
    } else if (item) {
      flush();
      const marker = /^\d/.test(item[2]!) ? item[2]! : "•";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]!);
      blocks.push({
        type: "item",
        depth: Math.floor(item[1]!.replace(/\t/g, "  ").length / 2),
        marker: task ? (task[1] === " " ? "☐" : "☑") : marker,
        inlines: parseInline(task ? task[2]! : item[3]!),
      });
    } else if (line.trim() === "") {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
