"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Send, User, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { duneChat } from "@/lib/api";
import { FENNEX_AGENTS } from "@/lib/agents";
import { useToast } from "@/components/ui/Toast";

const SUGGESTION_CHIPS = ["outline", "stats", "intro", "listicle"] as const;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  insertable?: string | null;
}

function TypingIndicator() {
  const dune = FENNEX_AGENTS.dune;
  return (
    <div className="flex gap-2 items-start animate-msg-in">
      <div className="h-7 w-7 rounded-full gradient-brand flex items-center justify-center shrink-0 shadow-sm">
        <dune.Icon className="h-3.5 w-3.5 text-white" strokeWidth={1.9} />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-typing-dot"
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
  onBodyChange: (val: string) => void;
  cursorPosition: number | null;
}

/**
 * Dune's chat assistant for the article studio dock — mirrors AiChatPanel's
 * layout (message list, typing indicator, Enter-to-send input) with a
 * brand-gradient avatar and an "insert at cursor" action on replies that
 * carry insertable content.
 */
export function AssistantTab({ articleId, body, onBodyChange, cursorPosition }: AssistantTabProps) {
  const { t } = useTranslation();
  const { success: toastSuccess, error: toastError } = useToast();
  const dune = FENNEX_AGENTS.dune;

  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      const result = await duneChat(articleId, trimmed, apiHistory);
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: result.answer, insertable: result.insertable },
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
    if (cursorPosition != null && cursorPosition >= 0 && cursorPosition <= body.length) {
      onBodyChange(body.slice(0, cursorPosition) + text + body.slice(cursorPosition));
    } else {
      onBodyChange(body + text);
    }
    toastSuccess(t("articleStudio.assistant.inserted"));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto flex flex-col gap-3">
        {history.length === 0 && !pending && (
          <div className="flex flex-col gap-3 animate-fade-in">
            <p className="text-xs text-muted-foreground leading-relaxed px-1">
              {t("articleStudio.assistant.tagline")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => submit(t(`articleStudio.assistant.prompts.${chip}`))}
                  disabled={pending}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  {t(`articleStudio.assistant.chips.${chip}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 items-end animate-msg-in",
              msg.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center shrink-0 shadow-sm",
                msg.role === "user" ? "bg-muted" : "gradient-brand",
              )}
            >
              {msg.role === "user" ? (
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <dune.Icon className="h-3.5 w-3.5 text-white" strokeWidth={1.9} />
              )}
            </div>
            <div className="flex flex-col gap-1.5 max-w-[82%]">
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm",
                )}
              >
                {msg.content}
              </div>
              {msg.role === "assistant" && msg.insertable && (
                <button
                  onClick={() => handleInsert(msg.insertable as string)}
                  className="self-start flex items-center gap-1.5 rounded-full border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  <CornerDownLeft className="h-3 w-3" />
                  {t("articleStudio.assistant.insert")}
                </button>
              )}
            </div>
          </div>
        ))}

        {pending && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border pt-3 mt-3 shrink-0">
        <div className="flex gap-2 items-end rounded-xl border border-border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("articleStudio.assistant.placeholder")}
            rows={2}
            className="flex-1 resize-none px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground bg-transparent focus:outline-none"
          />
          <button
            type="button"
            disabled={!input.trim() || pending}
            onClick={() => submit(input)}
            className="m-1.5 h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
            aria-label={t("articleStudio.assistant.send")}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
