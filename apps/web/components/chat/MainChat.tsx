"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowRight, Check, CornerDownLeft, Loader2, Send, Sparkles, Square, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  decideApproval, getConversation, sendMessage,
  type ChatEmployee, type ChatEvent, type ChatMessage, type TeamStep,
} from "@/lib/chat";
import { departmentAccent, employeeIcon, listEmployees, type Employee } from "@/lib/employees";

/** A turn in flight: the employee currently speaking and their partial text. */
interface Live {
  employeeId: string | null;
  text: string;
}

export function MainChat({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [routing, setRouting] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamStep[] | null>(null);
  const [stage, setStage] = useState<{ step: number; of: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: registry } = useQuery({
    queryKey: ["employees"], queryFn: () => listEmployees(), staleTime: 300_000,
  });
  const byId = new Map((registry?.employees ?? []).map((e) => [e.id, e]));

  // Keep the newest turn in view while text streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, live, routing]);

  const loadConversation = useCallback(async (id: string) => {
    const data = await getConversation(id);
    setMessages(data.messages);
    setOwner(data.conversation.ownerEmployeeId);
  }, []);

  const handleEvent = useCallback((event: ChatEvent) => {
    switch (event.type) {
      case "conversation":
        setConversationId(event.id);
        break;
      case "routing":
        setRouting(true);
        break;
      case "joined":
      case "handoff":
        setRouting(false);
        setOwner(event.employee.id);
        setMessages((prev) => [...prev, event.message]);
        setLive({ employeeId: event.employee.id, text: "" });
        break;
      case "plan":
        setTeam(event.team);
        setMessages((prev) => [...prev, event.message]);
        break;
      case "stage":
        setStage({ step: event.step, of: event.of });
        setLive({ employeeId: event.employeeId, text: "" });
        break;
      case "delta":
        setLive((prev) => ({
          employeeId: event.employeeId,
          text: (prev?.employeeId === event.employeeId ? prev.text : "") + event.text,
        }));
        break;
      case "message":
        // The persisted message replaces the streaming buffer.
        setLive(null);
        setMessages((prev) => [...prev, event.message]);
        break;
      case "approval":
      case "clarify":
        setRouting(false);
        setLive(null);
        setMessages((prev) => [...prev, event.message]);
        break;
      case "error":
        setRouting(false);
        setLive(null);
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`, seq: prev.length + 1, role: "system",
          employeeId: event.employeeId ?? null, event: "error", content: event.message,
          routing: null, confidence: null, artifactType: null, artifactIds: null,
          structured: null, error: event.message, createdAt: null,
        }]);
        break;
      case "done":
        setRouting(false);
        setLive(null);
        setStage(null);
        setBusy(false);
        break;
    }
  }, []);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setTeam(null);
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}`, seq: prev.length + 1, role: "user", employeeId: null,
      event: null, content: text, routing: null, confidence: null, artifactType: null,
      artifactIds: null, structured: null, error: null,
      createdAt: new Date().toISOString(),
    }]);
    const { cancel } = sendMessage(
      { message: text, project_id: projectId, conversation_id: conversationId },
      handleEvent,
    );
    cancelRef.current = cancel;
  }, [input, busy, projectId, conversationId, handleEvent]);

  const stop = () => {
    cancelRef.current?.();
    setBusy(false);
    setRouting(false);
    setLive(null);
  };

  const startNew = () => {
    stop();
    setConversationId(null);
    setMessages([]);
    setOwner(null);
    setTeam(null);
  };

  const activeEmployee = live?.employeeId ? byId.get(live.employeeId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        owner={owner ? byId.get(owner) : undefined}
        active={activeEmployee}
        participants={messages
          .map((m) => m.employeeId)
          .filter((id, i, arr): id is string => !!id && arr.indexOf(id) === i)
          .map((id) => byId.get(id))
          .filter((e): e is Employee => !!e)}
        onNew={startNew}
        hasThread={messages.length > 0}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && !routing && <EmptyState onPick={setInput} />}

          {messages.map((message) => (
            <MessageRow key={message.id} message={message} employee={
              message.employeeId ? byId.get(message.employeeId) : undefined
            } onReload={() => conversationId && loadConversation(conversationId)} />
          ))}

          {team && stage && (
            <TeamProgress team={team} step={stage.step} of={stage.of} byId={byId} />
          )}

          {routing && <RoutingIndicator />}

          {live && live.text && activeEmployee && (
            <EmployeeBubble employee={activeEmployee} content={live.text} streaming />
          )}
          {live && !live.text && activeEmployee && (
            <WorkingIndicator employee={activeEmployee} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onStop={stop}
        busy={busy}
      />
    </div>
  );
}

// --- header -------------------------------------------------------------------

function ChatHeader({
  owner, active, participants, onNew, hasThread,
}: {
  owner?: Employee;
  active?: Employee;
  participants: Employee[];
  onNew: () => void;
  hasThread: boolean;
}) {
  const { t } = useTranslation();
  const current = active ?? owner;

  return (
    <header className="flex items-center gap-3 border-b border-border bg-card/30 px-4 py-3 sm:px-6">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl gradient-brand glow-primary">
        <Sparkles className="h-4 w-4 text-white" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold leading-tight text-foreground">
          {t("chat.title")}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {current
            ? t("chat.ownedBy", { name: current.name, role: current.role })
            : t("chat.subtitle")}
        </p>
      </div>

      {/* Who has worked on this thread; the active one is lit. */}
      {participants.length > 0 && (
        <div className="hidden items-center -space-x-1.5 sm:flex">
          {participants.slice(-5).map((employee) => {
            const Icon = employeeIcon(employee.icon);
            const isActive = current?.id === employee.id;
            return (
              <span
                key={employee.id}
                title={`${employee.name} — ${employee.role}`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full ring-2 transition-all duration-200",
                  departmentAccent(employee.department),
                  isActive
                    ? "z-10 scale-110 ring-primary"
                    : "opacity-60 ring-background",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              </span>
            );
          })}
        </div>
      )}

      {hasThread && (
        <button
          type="button"
          onClick={onNew}
          className="cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {t("chat.new")}
        </button>
      )}
    </header>
  );
}

// --- messages -----------------------------------------------------------------

function MessageRow({
  message, employee, onReload,
}: { message: ChatMessage; employee?: Employee; onReload: () => void }) {
  if (message.role === "user") return <UserBubble content={message.content} />;
  if (message.role === "approval") {
    return <ApprovalCard message={message} employee={employee} onDecided={onReload} />;
  }
  if (message.role === "system") {
    return <SystemNotice message={message} employee={employee} />;
  }
  if (!employee) return <UnknownBubble content={message.content} />;
  return <EmployeeBubble employee={employee} content={message.content} />;
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
        {content}
      </div>
    </div>
  );
}

function UnknownBubble({ content }: { content: string }) {
  return (
    <div className="max-w-[85%] rounded-2xl border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground">
      {content}
    </div>
  );
}

function EmployeeBubble({
  employee, content, streaming = false,
}: { employee: Employee; content: string; streaming?: boolean }) {
  const Icon = employeeIcon(employee.icon);
  return (
    <div className="flex gap-3 animate-slide-up">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
        departmentAccent(employee.department))}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-baseline gap-2">
          <span className="font-display text-xs font-bold text-foreground">{employee.name}</span>
          <span className="text-[10px] text-muted-foreground">{employee.role}</span>
        </p>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground">
          {content}
          {streaming && (
            <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse-dot bg-primary" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Router notices: joins, handoffs, clarifications, errors. */
function SystemNotice({ message, employee }: { message: ChatMessage; employee?: Employee }) {
  const { t } = useTranslation();
  const Icon = employee ? employeeIcon(employee.icon) : Sparkles;
  const isError = message.event === "error";
  const isHandoff = message.event === "handoff";

  if (message.event === "plan") return null;   // rendered by TeamProgress

  return (
    <div className={cn(
      "flex items-center gap-2.5 self-center rounded-full border px-3 py-1.5 text-xs animate-slide-up",
      isError
        ? "border-destructive/20 bg-destructive/10 text-destructive"
        : "border-border bg-muted/40 text-muted-foreground",
    )}>
      {employee && !isError && (
        <span className={cn("flex h-5 w-5 items-center justify-center rounded-full",
          departmentAccent(employee.department))}>
          <Icon className="h-3 w-3" strokeWidth={2} />
        </span>
      )}
      <span>{message.content}</span>
      {isHandoff && <ArrowRight className="h-3 w-3 opacity-60" />}
      {message.confidence != null && !isError && (
        <span
          title={t("chat.confidenceHint")}
          className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] font-medium"
        >
          {Math.round(message.confidence * 100)}%
        </span>
      )}
    </div>
  );
}

// --- approvals ----------------------------------------------------------------

function ApprovalCard({
  message, employee, onDecided,
}: { message: ChatMessage; employee?: Employee; onDecided: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const structured = (message.structured ?? {}) as {
    approvalId?: string;
    preview?: { action?: string; description?: string; permissions?: string[]; request?: string };
  };
  const approvalId = structured.approvalId;
  const preview = structured.preview ?? {};

  const decide = async (decision: "approved" | "rejected") => {
    if (!approvalId || pending) return;
    setPending(true);
    try {
      const result = await decideApproval(approvalId, decision);
      setStatus(result.status);
      onDecided();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] p-4 animate-slide-up">
      <p className="flex items-center gap-2 text-xs font-semibold text-warning">
        {t("chat.approval.title")}
      </p>
      <p className="mt-1.5 text-sm text-foreground">{message.content}</p>
      {preview.description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{preview.description}</p>
      )}
      {preview.permissions && preview.permissions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {preview.permissions.map((p) => (
            <span key={p} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {p}
            </span>
          ))}
        </div>
      )}

      {status ? (
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          {t(`chat.approval.${status}`)}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => decide("approved")}
            disabled={pending}
            className="btn-primary flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> {t("chat.approval.approve")}
          </button>
          <button
            type="button"
            onClick={() => decide("rejected")}
            disabled={pending}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <X className="h-3 w-3" /> {t("chat.approval.reject")}
          </button>
        </div>
      )}
    </div>
  );
}

// --- progress -----------------------------------------------------------------

function TeamProgress({
  team, step, of, byId,
}: { team: TeamStep[]; step: number; of: number; byId: Map<string, Employee> }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-3 animate-slide-up">
      <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
        {t("chat.team.progress", { step, of })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {team.map((member, index) => {
          const employee = byId.get(member.employeeId);
          const Icon = employeeIcon(employee?.icon ?? "sparkles");
          const state = index + 1 < step ? "done" : index + 1 === step ? "active" : "todo";
          return (
            <span
              key={`${member.employeeId}-${index}`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] transition-all duration-200",
                state === "active" && "bg-primary/12 font-semibold text-primary ring-1 ring-primary/30",
                state === "done" && "bg-success/10 text-success",
                state === "todo" && "bg-muted text-muted-foreground/70",
              )}
            >
              {state === "done" ? <Check className="h-3 w-3" strokeWidth={2.5} />
                : <Icon className="h-3 w-3" strokeWidth={2} />}
              {member.employeeName}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RoutingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5 self-center rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground animate-fade-in">
      <Loader2 className="h-3 w-3 animate-spin" />
      {t("chat.routing")}
    </div>
  );
}

function WorkingIndicator({ employee }: { employee: Employee }) {
  const { t } = useTranslation();
  const Icon = employeeIcon(employee.icon);
  return (
    <div className="flex gap-3 animate-fade-in">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
        departmentAccent(employee.department))}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3">
        <span className="text-xs text-muted-foreground">
          {t("chat.working", { name: employee.name })}
        </span>
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-1 animate-typing-dot rounded-full bg-muted-foreground"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

// --- empty state --------------------------------------------------------------

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation();
  const examples = t("chat.examples", { returnObjects: true }) as string[];
  return (
    <div className="flex flex-col items-center py-10 text-center animate-fade-in">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary">
        <Sparkles className="h-7 w-7 text-white" strokeWidth={1.8} />
      </span>
      <h2 className="font-display text-2xl font-bold text-foreground">{t("chat.emptyTitle")}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t("chat.emptyBody")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- composer -----------------------------------------------------------------

function Composer({
  value, onChange, onSubmit, onStop, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-border bg-card/30 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <label htmlFor="main-chat-input" className="sr-only">{t("chat.inputLabel")}</label>
        <textarea
          id="main-chat-input"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={t("chat.placeholder")}
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t("chat.stop")}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Square className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!value.trim()}
            aria-label={t("chat.send")}
            className="btn-primary flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
      <p className="mx-auto mt-1.5 flex max-w-3xl items-center gap-1 text-[10px] text-muted-foreground">
        <CornerDownLeft className="h-2.5 w-2.5" /> {t("chat.hint")}
      </p>
    </div>
  );
}
