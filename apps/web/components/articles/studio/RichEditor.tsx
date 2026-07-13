"use client";

import { forwardRef, useImperativeHandle, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold, Italic, Code, Link2, Heading2, Heading3, Quote, List, ListOrdered, Wand2,
  type LucideIcon,
} from "lucide-react";
import { transformText, type TransformMode } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { FlashHighlight } from "./editor/flash-highlight";

export interface RichEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  insertAtCursor: (md: string) => void;
  applyWithDiff: (newMarkdown: string, oldMarkdown: string) => void;
  highlightChanges: (oldMarkdown: string) => number;
  clearChanges: () => void;
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

/** Ranges of block nodes in the editor whose text is new vs the old markdown. */
function changedRanges(editor: Editor, oldMarkdown: string): { ranges: { from: number; to: number }[]; first: number } {
  const oldBlocks = new Set(oldMarkdown.split(/\n{2,}/).map(normBlock).filter(Boolean));
  const ranges: { from: number; to: number }[] = [];
  let first = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const text = node.textContent.trim();
      if (text && !oldBlocks.has(normBlock(text))) {
        ranges.push({ from: pos + 1, to: pos + 1 + node.content.size });
        if (first < 0) first = pos + 1;
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
    editorProps: { attributes: { class: PROSE_CLASS } },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      lastEmitted.current = md;
      onChange(md);
    },
    onSelectionUpdate: ({ editor }) => setHasSelection(!editor.state.selection.empty),
    immediatelyRender: false,
  });

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
      editor.commands.setChangedRanges(ranges);
      if (first >= 0) editor.chain().setTextSelection(first).scrollIntoView().run();
      return ranges.length;
    },
    clearChanges: () => editor?.commands.clearChanged(),
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
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto w-full max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});
