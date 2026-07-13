/**
 * Pure markdown editing transforms for the article studio's plain-textarea
 * editor. Each action takes the current value + selection and returns the new
 * value plus the range to re-select (so the editor can flash and focus it).
 */

export type MdAction =
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "h2"
  | "h3"
  | "quote"
  | "ul"
  | "ol";

export interface FormatResult {
  value: string;
  selStart: number;
  selEnd: number;
}

function lineBounds(body: string, start: number, end: number) {
  const ls = body.lastIndexOf("\n", start - 1) + 1;
  let le = body.indexOf("\n", end);
  if (le === -1) le = body.length;
  return { ls, le };
}

function wrap(body: string, start: number, end: number, left: string, right: string, placeholder: string): FormatResult {
  const sel = body.slice(start, end);
  const inner = sel || placeholder;
  const value = body.slice(0, start) + left + inner + right + body.slice(end);
  const s = start + left.length;
  return { value, selStart: s, selEnd: s + inner.length };
}

function linePrefix(body: string, start: number, end: number, prefix: string): FormatResult {
  const { ls, le } = lineBounds(body, start, end);
  const block = body.slice(ls, le);
  const newBlock = block
    .split("\n")
    .map((l) => (l.startsWith(prefix) ? l : prefix + l))
    .join("\n");
  const value = body.slice(0, ls) + newBlock + body.slice(le);
  return { value, selStart: ls, selEnd: ls + newBlock.length };
}

function orderedList(body: string, start: number, end: number): FormatResult {
  const { ls, le } = lineBounds(body, start, end);
  const block = body.slice(ls, le);
  const newBlock = block
    .split("\n")
    .map((l, i) => `${i + 1}. ` + l.replace(/^\d+\.\s/, ""))
    .join("\n");
  const value = body.slice(0, ls) + newBlock + body.slice(le);
  return { value, selStart: ls, selEnd: ls + newBlock.length };
}

export function applyFormat(body: string, start: number, end: number, action: MdAction): FormatResult {
  switch (action) {
    case "bold":
      return wrap(body, start, end, "**", "**", "bold text");
    case "italic":
      return wrap(body, start, end, "*", "*", "italic text");
    case "code":
      return wrap(body, start, end, "`", "`", "code");
    case "link": {
      const text = body.slice(start, end) || "link text";
      const value = body.slice(0, start) + `[${text}](url)` + body.slice(end);
      const urlStart = start + 1 + text.length + 2; // past `[text](`
      return { value, selStart: urlStart, selEnd: urlStart + 3 };
    }
    case "h2":
      return linePrefix(body, start, end, "## ");
    case "h3":
      return linePrefix(body, start, end, "### ");
    case "quote":
      return linePrefix(body, start, end, "> ");
    case "ul":
      return linePrefix(body, start, end, "- ");
    case "ol":
      return orderedList(body, start, end);
  }
}
