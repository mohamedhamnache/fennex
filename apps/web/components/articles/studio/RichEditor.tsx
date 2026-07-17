"use client";

import { forwardRef, useImperativeHandle, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold, Italic, Code, Link2, Heading2, Heading3, Quote, List, ListOrdered, Wand2, Minus,
  type LucideIcon,
} from "lucide-react";
import { transformText, type TransformMode } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { FlashHighlight } from "./editor/flash-highlight";

export interface RichEditorHandle {
  getMarkdown: () => string;
  getHTML: () => string;
  setMarkdown: (md: string) => void;
  insertAtCursor: (md: string) => void;
  applyWithDiff: (newMarkdown: string, oldMarkdown: string) => void;
  highlightChanges: (oldMarkdown: string) => number;
  clearChanges: () => void;
  scrollToHeading: (index: number) => void;
  focus: () => void;
}

/** Normalize a block of text for diffing: strip markdown syntax + collapse ws. */
function normBlock(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/[*_`#>~]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Tokenize into words with their char offsets in the source string. */
function wordTokens(s: string): { w: string; start: number; end: number }[] {
  const out: { w: string; start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

/** Char ranges of words in `text` that are NOT part of an LCS with `oldText`. */
function changedWordRanges(text: string, oldText: string): { start: number; end: number }[] {
  const a = wordTokens(text);
  const b = wordTokens(oldText).map((t) => t.w);
  if (a.length === 0) return [];
  if (a.length * b.length > 40000) {
    // Guard against O(n*m) blowup on huge blocks - fall back to whole block.
    return [{ start: 0, end: text.length }];
  }
  // LCS table between new words (a) and old words (b).
  const n = a.length;
  const m2 = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m2 + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m2 - 1; j >= 0; j--) {
      dp[i][j] = a[i].w === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep = new Array(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m2) {
    if (a[i].w === b[j]) {
      keep[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // Merge consecutive changed words into ranges.
  const ranges: { start: number; end: number }[] = [];
  for (let k = 0; k < n; k++) {
    if (keep[k]) continue;
    const last = ranges[ranges.length - 1];
    if (last && a[k].start - last.end <= 1) last.end = a[k].end;
    else ranges.push({ start: a[k].start, end: a[k].end });
  }
  return ranges;
}

/** Word-set similarity used to pair a changed block with its old version. */
function similarity(aText: string, bText: string): number {
  const a = new Set(aText.split(/\s+/).filter(Boolean));
  const bWords = bText.split(/\s+/).filter(Boolean);
  if (a.size === 0 || bWords.length === 0) return 0;
  let common = 0;
  const b = new Set(bWords);
  a.forEach((w) => {
    if (b.has(w)) common++;
  });
  return common / Math.max(a.size, b.size);
}

/**
 * Ranges in the editor that differ from the old markdown. Block-level diff
 * first; for a changed block that clearly evolved from an old one (word-set
 * similarity), narrow down to the changed WORDS inside it.
 */
function changedRanges(editor: Editor, oldMarkdown: string): { ranges: { from: number; to: number }[]; first: number } {
  const oldRaw = oldMarkdown.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const oldNorm = oldRaw.map(normBlock);
  const oldSet = new Set(oldNorm);
  const ranges: { from: number; to: number }[] = [];
  let first = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const text = node.textContent.trim();
      if (text && !oldSet.has(normBlock(text))) {
        const base = pos + 1;
        // Find the most similar old block; if it's close enough, word-diff it.
        let bestIdx = -1;
        let bestScore = 0;
        const norm = normBlock(text);
        for (let k = 0; k < oldNorm.length; k++) {
          const s = similarity(norm, oldNorm[k]);
          if (s > bestScore) {
            bestScore = s;
            bestIdx = k;
          }
        }
        const inner = node.textContent;
        if (bestIdx >= 0 && bestScore >= 0.4) {
          // Compare against the markdown-stripped old block so syntax like
          // ** or ## never counts as a word change.
          const wordRanges = changedWordRanges(inner, oldNorm[bestIdx]);
          for (const r of wordRanges) {
            ranges.push({ from: base + r.start, to: base + r.end });
            if (first < 0) first = base + r.start;
          }
        } else {
          ranges.push({ from: base, to: base + node.content.size });
          if (first < 0) first = base;
        }
      }
      return false;
    }
    return true;
  });
  return { ranges, first };
}

interface RichEditorProps {
  articleId: string;
  value: string;
  editable: boolean;
  onChange: (markdown: string) => void;
}

const FLASH_MS = 1700;
const REWRITE_MODES: TransformMode[] = ["rephrase", "simplify", "expand", "shorten", "humanize"];

const TOOLBAR: { action: string; Icon: LucideIcon; run: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
  { action: "bold", Icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { action: "italic", Icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { action: "code", Icon: Code, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { action: "h2", Icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { action: "h3", Icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { action: "ul", Icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { action: "ol", Icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { action: "quote", Icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
];

/** Slash-command menu items: type "/" at the start of an empty line. */
const SLASH_ITEMS: { id: string; Icon: LucideIcon; run: (e: Editor) => void }[] = [
  { id: "h2", Icon: Heading2, run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", Icon: Heading3, run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: "ul", Icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "ol", Icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "quote", Icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "divider", Icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
];

interface SlashState {
  x: number;
  y: number;
  query: string;
  index: number;
  anchor: number;
}

const PROSE_CLASS =
  "prose-editor min-h-full text-[15px] leading-[1.8] text-foreground focus:outline-none " +
  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:mt-8 [&_h1]:mb-3 " +
  "[&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:mt-7 [&_h2]:mb-2 " +
  "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-1.5 " +
  "[&_p]:my-2.5 [&_strong]:font-semibold [&_em]:italic " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_li]:my-1 " +
  "[&_a]:text-primary [&_a]:underline " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground " +
  "[&_code]:font-mono [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded " +
  "[&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto";

/**
 * WYSIWYG article editor (TipTap). Markdown stays the source of truth: content
 * loads from and serializes back to markdown so scoring/checks/publishing are
 * unchanged. Exposes imperative methods for Dune insert / restore / typewriter,
 * a fixed formatting toolbar, and a selection bubble menu with Dune rewrites.
 */
export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { articleId, value, editable, onChange },
  ref,
) {
  const { t } = useTranslation();
  const { error: toastError } = useToast();
  const lastEmitted = useRef<string>(value);
  const [rewriting, setRewriting] = useState<TransformMode | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  slashRef.current = slash;
  const filteredRef = useRef(SLASH_ITEMS);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: () => t("articles.editor.bodyPlaceholder") }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
      FlashHighlight,
    ],
    content: value,
    editorProps: {
      attributes: { class: PROSE_CLASS },
      handleKeyDown: (view, event) => {
        const s = slashRef.current;
        if (s) {
          const items = filteredRef.current;
          if (event.key === "ArrowDown" && items.length) {
            setSlash({ ...s, index: (s.index + 1) % items.length });
            return true;
          }
          if (event.key === "ArrowUp" && items.length) {
            setSlash({ ...s, index: (s.index - 1 + items.length) % items.length });
            return true;
          }
          if (event.key === "Enter" && items.length) {
            executeSlash(items[Math.min(s.index, items.length - 1)]);
            return true;
          }
          if (event.key === "Escape") {
            setSlash(null);
            return true;
          }
        }
        if (event.key === "/" && !s) {
          const { $from, empty } = view.state.selection;
          if (empty && $from.parent.isTextblock && $from.parent.textContent === "") {
            const coords = view.coordsAtPos($from.pos);
            setSlash({ x: coords.left, y: coords.bottom + 6, query: "", index: 0, anchor: $from.pos });
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      lastEmitted.current = md;
      onChange(md);
      // Track the slash query (text typed after "/") while the menu is open.
      const s = slashRef.current;
      if (s) {
        const head = editor.state.selection.from;
        if (head <= s.anchor) {
          setSlash(null);
        } else {
          const text = editor.state.doc.textBetween(s.anchor, head, "\n");
          if (!text.startsWith("/")) setSlash(null);
          else setSlash({ ...s, query: text.slice(1), index: 0 });
        }
      }
    },
    onSelectionUpdate: ({ editor }) => setHasSelection(!editor.state.selection.empty),
    onBlur: () => setSlash(null),
    immediatelyRender: false,
  });

  function executeSlash(item: (typeof SLASH_ITEMS)[number]) {
    const s = slashRef.current;
    if (!s || !editor) return;
    const head = editor.state.selection.from;
    editor.chain().focus().deleteRange({ from: s.anchor, to: head }).run();
    item.run(editor);
    setSlash(null);
  }

  // External value changes (restore, generation typewriter) — re-render doc.
  useEffect(() => {
    if (!editor) return;
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  function flash(from: number, to: number) {
    if (!editor) return;
    editor.commands.flashRange(from, to);
    window.setTimeout(() => editor?.commands.clearFlash(), FLASH_MS);
  }

  useImperativeHandle(ref, () => ({
    getMarkdown: () => editor?.storage.markdown.getMarkdown() ?? "",
    getHTML: () => editor?.getHTML() ?? "",
    setMarkdown: (md: string) => {
      if (!editor) return;
      lastEmitted.current = md;
      editor.commands.setContent(md, true);
    },
    insertAtCursor: (md: string) => {
      if (!editor) return;
      const from = editor.state.selection.from;
      editor.chain().focus().insertContent(md).run();
      const to = editor.state.selection.from;
      flash(Math.min(from, to), Math.max(from, to));
      editor.commands.scrollIntoView();
    },
    applyWithDiff: (newMarkdown: string, oldMarkdown: string) => {
      if (!editor) return;
      lastEmitted.current = newMarkdown;
      editor.commands.setContent(newMarkdown, true);
      const { ranges, first } = changedRanges(editor, oldMarkdown);
      if (ranges.length) {
        editor.commands.flashRanges(ranges);
        window.setTimeout(() => editor?.commands.clearFlash(), FLASH_MS);
        if (first >= 0) editor.chain().setTextSelection(first).scrollIntoView().run();
      }
    },
    highlightChanges: (oldMarkdown: string) => {
      if (!editor) return 0;
      const { ranges, first } = changedRanges(editor, oldMarkdown);
      editor.commands.setChangedRanges(ranges, t("articleStudio.changeTooltip"));
      if (first >= 0) editor.chain().setTextSelection(first).scrollIntoView().run();
      return ranges.length;
    },
    clearChanges: () => editor?.commands.clearChanged(),
    scrollToHeading: (index: number) => {
      if (!editor) return;
      let n = -1;
      let target = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          n += 1;
          if (n === index) {
            target = pos + 1;
            return false;
          }
        }
        return target < 0;
      });
      if (target >= 0) {
        editor.chain().focus().setTextSelection(target).scrollIntoView().run();
      }
    },
    focus: () => editor?.commands.focus(),
  }), [editor]);

  async function rewrite(mode: TransformMode) {
    if (!editor || rewriting) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "\n").trim();
    if (!selected) return;
    setRewriting(mode);
    try {
      const result = await transformText(articleId, mode, selected);
      editor.chain().focus().insertContentAt({ from, to }, result.text).run();
      const end = editor.state.selection.from;
      flash(from, end);
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setRewriting(null);
    }
  }

  if (!editor) return null;

  const q = (slash?.query ?? "").toLowerCase();
  const slashFiltered = q
    ? SLASH_ITEMS.filter(
        (it) => it.id.includes(q) || t(`articleStudio.format.${it.id}`).toLowerCase().includes(q),
      )
    : SLASH_ITEMS;
  filteredRef.current = slashFiltered;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Formatting toolbar */}
      {editable && (
        <div className="flex items-center gap-0.5 border-b border-border px-5 py-1.5">
          {TOOLBAR.map(({ action, Icon, run, active }, i) => (
            <span key={action} className="flex items-center">
              {(i === 3 || i === 5) && <span className="mx-1 h-4 w-px bg-border" />}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(editor)}
                title={t(`articleStudio.format.${action}`)}
                aria-label={t(`articleStudio.format.${action}`)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-90 ${
                  active(editor) ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const prev = editor.getAttributes("link").href as string | undefined;
              const url = window.prompt(t("articleStudio.format.link"), prev ?? "https://");
              if (url === null) return;
              if (url === "") editor.chain().focus().unsetLink().run();
              else editor.chain().focus().setLink({ href: url }).run();
            }}
            title={t("articleStudio.format.link")}
            aria-label={t("articleStudio.format.link")}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-90 ${
              editor.isActive("link") ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Dune rewrite bar — always visible; acts on the current selection */}
      {editable && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-1.5">
          <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5 text-primary" /> Dune
          </span>
          {REWRITE_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => rewrite(mode)}
              disabled={!hasSelection || !!rewriting}
              title={hasSelection ? undefined : t("articleStudio.selection.hint")}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "humanize"
                  ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                  : "border-border text-foreground hover:border-primary/30 hover:bg-accent"
              }`}
            >
              {rewriting === mode && <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />}
              {t(`articleStudio.selection.${mode}`)}
            </button>
          ))}
          {!hasSelection && (
            <span className="text-[11px] text-muted-foreground">{t("articleStudio.selection.hint")}</span>
          )}
        </div>
      )}

      {/* Editor surface */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6" onScroll={() => setSlash(null)}>
        <div className="mx-auto w-full max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Slash-command menu */}
      {slash && slashFiltered.length > 0 && (
        <div
          className="popover fixed z-50 w-52 overflow-hidden rounded-xl p-1 animate-scale-in"
          style={{ left: slash.x, top: slash.y }}
        >
          {slashFiltered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => executeSlash(item)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                i === Math.min(slash.index, slashFiltered.length - 1)
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/60">
                <item.Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              {t(`articleStudio.format.${item.id}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
