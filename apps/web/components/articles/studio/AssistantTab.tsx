"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Send, User, CornerDownLeft, ListTree, BarChart3, Sparkles, ListOrdered, Wand2, Check,
  Gauge, ShieldCheck, HelpCircle, Tags, Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { duneChat } from "@/lib/api";
import { FENNEX_AGENTS } from "@/lib/agents";
import { useToast } from "@/components/ui/Toast";

const SUGGESTION_CHIPS: { id: "outline" | "stats" | "intro" | "listicle"; Icon: LucideIcon }[] = [
  { id: "outline", Icon: ListTree },
  { id: "stats", Icon: BarChart3 },
  { id: "intro", Icon: Sparkles },
  { id: "listicle", Icon: ListOrdered },
];

/** Dune's one-click agentic skills - each fires a crafted prompt that Dune
 *  executes directly (revise / insert / set meta), grounded in real data. */
const SKILLS: { id: "seo" | "fixChecks" | "faq" | "intro" | "meta"; Icon: LucideIcon }[] = [
  { id: "seo", Icon: Gauge },
  { id: "fixChecks", Icon: ShieldCheck },
  { id: "faq", Icon: HelpCircle },
  { id: "intro", Icon: Zap },
  { id: "meta", Icon: Tags },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  insertable?: string | null;
  revised?: string | null;
  metaTitle?: string | null;
  metaDesc?: string | null;
  applied?: boolean;
  appliedMeta?: boolean;
}

function DuneAvatar({ size = 28 }: { size?: number }) {
  const dune = FENNEX_AGENTS.dune;
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full gradient-brand shadow-sm"
      style={{ height: size, width: size }}
    >
      <dune.Icon className="text-white" style={{ height: size * 0.5, width: size * 0.5 }} strokeWidth={1.9} />
    </span>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5 animate-msg-in">
      <DuneAvatar size={28} />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70 animate-typing-dot"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}

interface AssistantTabProps {
  articleId: string;
  body: string;
  onInsert: (text: string) => void;
  onApplyRevision: (markdown: string) => void;
  onApplyMeta: (title: string | null, desc: string | null) => void;
}

/**
 * Dune's agentic co-writer chat: identity-led empty state, one-click skills
 * (SEO pass, fix checks, FAQ, intro, meta) that Dune executes directly, and
 * apply actions for revisions, insertables and meta suggestions.
 */
export function AssistantTab({ articleId, body, onInsert, onApplyRevision, onApplyMeta }: AssistantTabProps) {
  const { t } = useTranslation();
  const { success: toastSuccess, error: toastError } = useToast();
  const dune = FENNEX_AGENTS.dune;

  const [input, setInput] = useState("");
  // Conversation survives tab switches and reloads (per article, per browser tab).
  const storageKey = `dune-chat-${articleId}`;
  const [history, setHistory] = useState<ChatMessage[]>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(storageKey) : null;
      return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(history.slice(-40)));
    } catch {
      // storage full/unavailable - the chat just won't persist
    }
  }, [history, storageKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, pending]);

  async function submit(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setInput("");
    const nextHistory: ChatMessage[] = [...history, { role: "user", content: trimmed }];
    setHistory(nextHistory);
    try {
      const apiHistory = history.map((m) => ({ role: m.role, content: m.content }));
      const result = await duneChat(articleId, trimmed, apiHistory, body);
      setHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answer,
          insertable: result.insertable,
          revised: result.revised,
          metaTitle: result.meta_title,
          metaDesc: result.meta_description,
        },
      ]);
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
      setHistory((prev) => prev.slice(0, -1));
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  function handleInsert(text: string) {
    onInsert(text);
    toastSuccess(t("articleStudio.assistant.inserted"));
  }

  function handleApply(index: number, markdown: string) {
    onApplyRevision(markdown);
    setHistory((prev) => prev.map((m, i) => (i === index ? { ...m, applied: true } : m)));
    toastSuccess(t("articleStudio.assistant.applied"));
  }

  function handleApplyMeta(index: number, title: string | null, desc: string | null) {
    onApplyMeta(title, desc);
    setHistory((prev) => prev.map((m, i) => (i === index ? { ...m, appliedMeta: true } : m)));
    toastSuccess(t("articleStudio.assistant.metaApplied"));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {history.length === 0 && !pending ? (
          /* ── Greeting / empty state ── */
          <div className="flex flex-col gap-5 animate-fade-in">
            <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.08] to-transparent p-4">
              <div className="flex items-center gap-3">
                <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl gradient-brand glow-primary shrink-0">
                  <dune.Icon className="h-5 w-5 text-white" strokeWidth={1.9} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{dune.name}</p>
                  <p className="text-[11px] text-muted-foreground">{t("articleStudio.dock.subtitle")}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {t("articleStudio.assistant.tagline")}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t("articleStudio.assistant.starters")}
              </p>
              <div className="grid grid-cols-1 gap-2">
                {SUGGESTION_CHIPS.map(({ id, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => submit(t(`articleStudio.assistant.prompts.${id}`))}
                    disabled={pending}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2.5 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.06] disabled:opacity-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                      <Icon className="h-4 w-4" strokeWidth={1.9} />
                    </span>
                    <span className="flex-1 text-xs font-medium text-foreground">
                      {t(`articleStudio.assistant.chips.${id}`)}
                    </span>
                    <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Message thread ── */
          <div className="flex flex-col gap-4">
            {history.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-2.5 animate-msg-in",
                  msg.role === "user" ? "flex-row-reverse" : "flex-row",
                )}
              >
                {msg.role === "user" ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                ) : (
                  <DuneAvatar size={28} />
                )}
                <div className={cn("flex min-w-0 flex-col gap-1.5", msg.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                      msg.role === "user"
                        ? "gradient-brand rounded-tr-md text-white shadow-sm"
                        : "rounded-tl-md border border-border bg-card text-foreground",
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.role === "assistant" && msg.insertable && (
                    <div className="flex w-full max-w-[85%] flex-col gap-1.5 rounded-xl border border-primary/25 bg-primary/[0.04] p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                        {t("articleStudio.assistant.willInsert")}
                      </p>
                      <p className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                        {msg.insertable}
                      </p>
                      <button
                        onClick={() => handleInsert(msg.insertable as string)}
                        className="btn-primary flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px]"
                      >
                        <CornerDownLeft className="h-3 w-3" />
                        {t("articleStudio.assistant.insert")}
                      </button>
                    </div>
                  )}
                  {msg.role === "assistant" && msg.revised && (
                    msg.applied ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                        <Check className="h-3 w-3" />
                        {t("articleStudio.assistant.applied")}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleApply(i, msg.revised as string)}
                        className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-[11px]"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                        {t("articleStudio.assistant.apply")}
                      </button>
                    )
                  )}
                  {msg.role === "assistant" && (msg.metaTitle || msg.metaDesc) && (
                    <div className="flex w-full max-w-[85%] flex-col gap-1.5 rounded-xl border border-primary/25 bg-primary/[0.04] p-2.5">
                      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                        <Tags className="h-3 w-3" />
                        {t("articleStudio.assistant.metaSuggestion")}
                      </p>
                      {msg.metaTitle && (
                        <p className="text-[11px] leading-snug text-foreground">{msg.metaTitle}</p>
                      )}
                      {msg.metaDesc && (
                        <p className="text-[11px] leading-snug text-muted-foreground">{msg.metaDesc}</p>
                      )}
                      {msg.appliedMeta ? (
                        <span className="flex items-center gap-1.5 self-start rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                          <Check className="h-3 w-3" />
                          {t("articleStudio.assistant.metaApplied")}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleApplyMeta(i, msg.metaTitle ?? null, msg.metaDesc ?? null)}
                          className="btn-primary flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px]"
                        >
                          <Check className="h-3 w-3" />
                          {t("articleStudio.assistant.applyMeta")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {pending && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Skills row ── */}
      <div className="shrink-0 pt-3">
        <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t("articleStudio.assistant.skillsTitle")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKILLS.map(({ id, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => submit(t(`articleStudio.assistant.skillPrompts.${id}`))}
              disabled={pending}
              title={t(`articleStudio.assistant.skills.${id}`)}
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-all hover:bg-primary/10 disabled:opacity-50"
            >
              <Icon className="h-3 w-3" strokeWidth={2} />
              {t(`articleStudio.assistant.skills.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Composer ── */}
      <div className="shrink-0 pt-2.5">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-input p-1.5 transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("articleStudio.assistant.placeholder")}
            rows={2}
            className="flex-1 resize-none bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            disabled={!input.trim() || pending}
            onClick={() => submit(input)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl gradient-brand text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-40 disabled:brightness-100"
            aria-label={t("articleStudio.assistant.send")}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
