"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { sendAiCommand, type GeneratedImage, type AiCommandMessage } from "@/lib/api";

const SUGGESTION_GROUPS = ["oneGo", "enhance", "retouch", "style", "transform"] as const;

interface AiChatPanelProps {
  imageId: string;
  onVersionAdded: (img: GeneratedImage) => void;
}

function TypingIndicator() {
  return (
    <div className="flex gap-2 items-start animate-msg-in">
      <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shrink-0 shadow-sm">
        <Bot className="h-3.5 w-3.5 text-white" />
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

export function AiChatPanel({ imageId, onVersionAdded }: AiChatPanelProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<AiCommandMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const mutation = useMutation({
    mutationFn: ({ command }: { command: string }) => sendAiCommand(imageId, command, history),
    onSuccess: (img, { command }) => {
      const opLabel = img.edit_operation?.replace(/_/g, " ") ?? "edit";
      setHistory((prev) => [
        ...prev,
        { role: "user", content: command },
        { role: "assistant", content: t("mirage.applied", { op: opLabel }) },
      ]);
      onVersionAdded(img);
      setInput("");
    },
    onError: (err, { command }) => {
      setHistory((prev) => [
        ...prev,
        { role: "user", content: command },
        {
          role: "assistant",
          content: t("mirage.failed", { error: err instanceof Error ? err.message : t("mirage.unknownError") }),
        },
      ]);
      setInput("");
    },
  });

  function submit(command: string) {
    const trimmed = command.trim();
    if (!trimmed || mutation.isPending) return;
    mutation.mutate({ command: trimmed });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">{t("mirage.header")}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{t("mirage.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Message history */}
      <div className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-3">

        {/* Suggestion chips — shown only before any messages */}
        {history.length === 0 && !mutation.isPending && (
          <div className="flex flex-col gap-3 animate-fade-in">
            <p className="text-xs text-muted-foreground leading-relaxed px-1">
              {t("mirage.tryPrompt")}
            </p>
            {SUGGESTION_GROUPS.map((gid) => {
              const items = t(`mirage.suggestions.${gid}`, { returnObjects: true }) as string[];
              return (
                <div key={gid} className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">{t(`mirage.groups.${gid}`)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Array.isArray(items) ? items : []).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => submit(s)}
                        disabled={mutation.isPending}
                        className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Conversation messages */}
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
                msg.role === "user"
                  ? "bg-muted"
                  : "bg-gradient-to-br from-primary/80 to-primary",
              )}
            >
              {msg.role === "user" ? (
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Bot className="h-3.5 w-3.5 text-white" />
              )}
            </div>
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm",
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {mutation.isPending && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2 items-end rounded-xl border border-border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("mirage.placeholder")}
            rows={2}
            className="flex-1 resize-none px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground bg-transparent focus:outline-none"
          />
          <button
            type="button"
            disabled={!input.trim() || mutation.isPending}
            onClick={() => submit(input)}
            className="m-1.5 h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
          {t("mirage.enterHint")}
        </p>
      </div>
    </div>
  );
}
