"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowDown, ArrowRight, Check, ChevronDown, Copy, CornerDownLeft, Cpu,
  History, Loader2, Send, Sparkles, Square, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  approveAndRun, decideApproval, deleteConversation, getConversation,
  listConversations, listModels, runAction, runWorkflow, runWorkflowStep,
  sendMessage,
  type ChatEvent, type ChatMessage, type ChatModel, type Conversation,
  type FollowOnAction,
  type OfferedAction, type TeamStep, type WorkflowStep,
} from "@/lib/chat";
import { listProjects } from "@/lib/api";
import { departmentAccent, employeeIcon, listEmployees, type Employee } from "@/lib/employees";
import { Markdown } from "./Markdown";
import { WorkflowCard, type StepState } from "./WorkflowCard";
import { ArtifactCard } from "./ArtifactCard";
import { FollowOnCard } from "./FollowOnCard";

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
  const [working, setWorking] = useState<{ employeeId: string; action: string } | null>(null);
  // Tools the employee is reaching for, shown while it thinks.
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  // Per-workflow step outcomes, keyed by the workflow message id.
  const [stepStates, setStepStates] = useState<Record<string, Record<number, StepState>>>({});
  const [activeStep, setActiveStep] = useState<{ messageId: string; index: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  // The model the user picked for this thread; null follows the org tier.
  const [model, setModel] = useState<ChatModel | null>(null);
  // Follow-on suggestions the user waved away; kept out of the way.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const cancelRef = useRef<(() => void) | null>(null);
  // Read inside the streaming callback, so it must not go stale.
  const activeStepRef = useRef<{ messageId: string; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: registry } = useQuery({
    queryKey: ["employees"], queryFn: () => listEmployees(), staleTime: 300_000,
  });
  const byId = new Map((registry?.employees ?? []).map((e) => [e.id, e]));
  // Notices follow the project's language, matching what the employees speak,
  // so a French project never reads English notices between French replies.
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"], queryFn: listProjects, staleTime: 60_000,
  });
  const lng = projects.find((p) => p.id === projectId)?.locale;

  // Past conversations. Refetched whenever a thread starts or is deleted.
  const { data: modelData } = useQuery({
    queryKey: ["chat-models"], queryFn: listModels, staleTime: 300_000,
  });
  const models = modelData?.models ?? [];

  const conversations = useQuery({
    queryKey: ["conversations", projectId],
    queryFn: () => listConversations(projectId),
    staleTime: 30_000,
  });

  // Follow the stream only while the user is already at the bottom; yanking
  // them away from something they scrolled up to read is worse than a gap.
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, live, routing, atBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setAtBottom(true);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    cancelRef.current?.();
    const data = await getConversation(id);
    setConversationId(id);
    setMessages(data.messages);
    setOwner(data.conversation.ownerEmployeeId);
    setLive(null);
    setTeam(null);
    setWorking(null);
    setBusy(false);
    setShowHistory(false);
  }, []);

  const removeConversation = useCallback(async (id: string) => {
    await deleteConversation(id);
    await conversations.refetch();
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
      setOwner(null);
    }
  }, [conversationId, conversations]);

  /** Record how a workflow step ended, against the workflow it belongs to. */
  const markStep = useCallback((index: number, state: StepState) => {
    const active = activeStepRef.current;
    if (!active) return;
    setStepStates((prev) => ({
      ...prev,
      [active.messageId]: { ...(prev[active.messageId] ?? {}), [index]: state },
    }));
  }, []);

  /** A step is locked until every step before it has succeeded -- later steps
   *  consume what earlier ones produced, so running them out of order would
   *  give the specialist nothing to work from. */
  const stepStateFor = useCallback((messageId: string, index: number): StepState => {
    const states = stepStates[messageId] ?? {};
    if (states[index]) return states[index];
    const active = activeStep;
    if (active && active.messageId === messageId && active.index === index) return "running";
    for (let i = 0; i < index; i += 1) {
      if (states[i] !== "done") return "locked";
    }
    return "ready";
  }, [stepStates, activeStep]);

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
      case "actions":
      case "workflow":
      case "followOn":
      case "clarify":
        setRouting(false);
        setLive(null);
        setMessages((prev) => [...prev, event.message]);
        break;
      case "working":
        setWorking({ employeeId: event.employeeId, action: event.action });
        break;
      case "tool":
        setActiveTools((prev) => (prev.includes(event.tool) ? prev : [...prev, event.tool]));
        break;
      case "telemetry":
        // Recorded server-side; the transcript does not need to show numbers.
        break;
      case "result":
        setWorking(null);
        setMessages((prev) => [...prev, event.message]);
        if (event.stepIndex !== undefined) markStep(event.stepIndex, "done");
        break;
      case "error":
        setRouting(false);
        setLive(null);
        if (event.stepIndex !== undefined) markStep(event.stepIndex, "failed");
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
        setActiveTools([]);
        setBusy(false);
        break;
    }
  }, [markStep]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setTeam(null);
    setActiveTools([]);
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}`, seq: prev.length + 1, role: "user", employeeId: null,
      event: null, content: text, routing: null, confidence: null, artifactType: null,
      artifactIds: null, structured: null, error: null,
      createdAt: new Date().toISOString(),
    }]);
    const { cancel, done } = sendMessage(
      {
        message: text, project_id: projectId, conversation_id: conversationId,
        model_provider: model?.provider ?? null, model_id: model?.id ?? null,
      },
      handleEvent,
    );
    cancelRef.current = cancel;
    // A brand-new thread needs to appear in the history list.
    if (!conversationId) done.then(() => conversations.refetch());
  }, [input, busy, projectId, conversationId, handleEvent, conversations, model]);

  /** Validate a proposed action -- and actually run it. */
  const approve = useCallback((approvalId: string) => {
    if (busy) return;
    setBusy(true);
    setDecisions((prev) => ({ ...prev, [approvalId]: "approved" }));
    const { cancel } = approveAndRun(approvalId, handleEvent);
    cancelRef.current = cancel;
  }, [busy, handleEvent]);

  /** The user pressed one of the offered action buttons. */
  const runChosenAction = useCallback((
    messageId: string, employeeId: string, actionId: string, decisionKey?: string,
  ) => {
    if (busy || !conversationId) return;
    setBusy(true);
    setDecisions((prev) => ({ ...prev, [messageId]: decisionKey ?? actionId }));
    const { cancel } = runAction(
      { conversation_id: conversationId, employee_id: employeeId, action_id: actionId },
      handleEvent,
    );
    cancelRef.current = cancel;
  }, [busy, conversationId, handleEvent]);

  /** The user validated one step. Only that step runs. */
  const runOneStep = useCallback((
    messageId: string, steps: WorkflowStep[], index: number,
  ) => {
    if (busy || !conversationId) return;
    setBusy(true);
    activeStepRef.current = { messageId, index };
    setActiveStep({ messageId, index });
    setStepStates((prev) => ({
      ...prev,
      [messageId]: { ...(prev[messageId] ?? {}), [index]: "running" },
    }));
    const { cancel, done } = runWorkflowStep(
      { conversation_id: conversationId, steps, index }, handleEvent);
    cancelRef.current = cancel;
    done.then(() => {
      activeStepRef.current = null;
      setActiveStep(null);
    });
  }, [busy, conversationId, handleEvent]);

  /** The user approved the whole squad's workflow. */
  const runApprovedWorkflow = useCallback((messageId: string, steps: WorkflowStep[]) => {
    if (busy || !conversationId) return;
    setBusy(true);
    setDecisions((prev) => ({ ...prev, [messageId]: "started" }));
    setTeam(steps.map((s) => ({
      capability: "", employeeId: s.employeeId, employeeName: s.employeeName,
      actionId: s.actionId, icon: s.icon, department: s.department,
    })));
    const { cancel } = runWorkflow({ conversation_id: conversationId, steps }, handleEvent);
    cancelRef.current = cancel;
  }, [busy, conversationId, handleEvent]);

  const reject = useCallback(async (approvalId: string) => {
    setDecisions((prev) => ({ ...prev, [approvalId]: "rejected" }));
    try {
      await decideApproval(approvalId, "rejected");
    } catch {
      // The card already reads as rejected; a failed write is not worth a modal.
    }
  }, []);

  const dismissSuggestion = useCallback((messageId: string) => {
    setDismissed((prev) => new Set(prev).add(messageId));
  }, []);

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
    setWorking(null);
    setShowHistory(false);
  };

  const activeEmployee = live?.employeeId ? byId.get(live.employeeId) : undefined;
  const workingEmployee = working ? byId.get(working.employeeId) : undefined;

  return (
    <div className="flex h-full">
      <HistoryPanel
        open={showHistory}
        conversations={conversations.data?.conversations ?? []}
        activeId={conversationId}
        byId={byId}
        onSelect={loadConversation}
        onDelete={removeConversation}
        onNew={startNew}
        onClose={() => setShowHistory(false)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChatHeader
          owner={owner ? byId.get(owner) : undefined}
          active={activeEmployee ?? workingEmployee}
          participants={messages
            .map((m) => m.employeeId)
            .filter((id, i, arr): id is string => !!id && arr.indexOf(id) === i)
            .map((id) => byId.get(id))
            .filter((e): e is Employee => !!e)}
          onNew={startNew}
          onToggleHistory={() => setShowHistory((v) => !v)}
          models={models}
          model={model}
          onPickModel={setModel}
          historyCount={conversations.data?.conversations.length ?? 0}
          hasThread={messages.length > 0}
        />

        <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.length === 0 && !routing && (
              <EmptyState onPick={setInput} employees={registry?.employees ?? []} />
            )}

            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                employee={message.employeeId ? byId.get(message.employeeId) : undefined}
                onApprove={approve}
                onReject={reject}
                onRunAction={runChosenAction}
                onRunWorkflow={runApprovedWorkflow}
                onRunStep={runOneStep}
                stepStateFor={stepStateFor}
                runningStep={activeStep}
                byId={byId}
                projectId={projectId}
                busy={busy}
                lng={lng}
                onDismiss={dismissSuggestion}
                dismissedIds={dismissed}
                decisions={decisions}
              />
            ))}

            {team && stage && (
              <TeamProgress team={team} step={stage.step} of={stage.of} byId={byId} />
            )}

            {routing && <RoutingIndicator />}

            {working && workingEmployee && (
              <WorkingIndicator employee={workingEmployee} action={working.action} />
            )}

            {live && live.text && activeEmployee && (
              <EmployeeBubble employee={activeEmployee} content={live.text} streaming />
            )}
            {live && !live.text && activeEmployee && !working && (
              <WorkingIndicator employee={activeEmployee} tools={activeTools} />
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {!atBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label={t("chat.jumpToLatest")}
            className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground shadow-lg transition-colors hover:bg-accent animate-fade-in"
          >
            <ArrowDown className="h-3 w-3" />
            {t("chat.jumpToLatest")}
          </button>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={stop}
          busy={busy}
        />
      </div>
    </div>
  );
}

// --- history ------------------------------------------------------------------

function HistoryPanel({
  open, conversations, activeId, byId, onSelect, onDelete, onNew, onClose,
}: {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  byId: Map<string, Employee>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <>
      {/* Overlay only on small screens; the panel is inline from lg up. */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="fixed inset-0 z-30 cursor-default bg-background/70 backdrop-blur-sm lg:hidden animate-fade-in"
      />
      <aside className="fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-card animate-slide-in-right lg:static lg:z-auto lg:animate-none">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <p className="flex-1 font-display text-sm font-bold text-foreground">
            {t("chat.history.title")}
          </p>
          <button
            type="button"
            onClick={onNew}
            className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("chat.new")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("chat.history.empty")}
            </p>
          )}
          {conversations.map((convo) => {
            const owner = convo.ownerEmployeeId ? byId.get(convo.ownerEmployeeId) : undefined;
            const Icon = employeeIcon(owner?.icon ?? "sparkles");
            const active = convo.id === activeId;
            return (
              <div
                key={convo.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                  active ? "bg-primary/10" : "hover:bg-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(convo.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                    owner ? departmentAccent(owner.department) : "bg-muted text-muted-foreground")}>
                    <Icon className="h-3 w-3" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-xs font-medium",
                      active ? "text-primary" : "text-foreground")}>
                      {convo.title || t("chat.history.untitled")}
                    </span>
                    {convo.participants.length > 0 && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {convo.participants
                          .map((id) => byId.get(id)?.name ?? id)
                          .join(", ")}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(convo.id)}
                  aria-label={t("chat.history.delete")}
                  className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

// --- header -------------------------------------------------------------------

function ChatHeader({
  owner, active, participants, onNew, onToggleHistory, historyCount, hasThread,
  models, model, onPickModel,
}: {
  owner?: Employee;
  active?: Employee;
  participants: Employee[];
  onNew: () => void;
  onToggleHistory: () => void;
  historyCount: number;
  hasThread: boolean;
  models: ChatModel[];
  model: ChatModel | null;
  onPickModel: (m: ChatModel | null) => void;
}) {
  const { t } = useTranslation();
  const current = active ?? owner;

  return (
    <header className="flex items-center gap-3 border-b border-border bg-card/30 px-4 py-3 sm:px-6">
      <button
        type="button"
        onClick={onToggleHistory}
        aria-label={t("chat.history.title")}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <History className="h-4 w-4" />
        {historyCount > 0 && (
          <span className="text-[10px] font-medium">{historyCount}</span>
        )}
      </button>
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

      {models.length > 0 && (
        <ModelPicker models={models} model={model} onPick={onPickModel} />
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

/** Choose the model for this conversation.
 *
 *  Only models the organisation has a key for are offered, and the server
 *  re-checks the choice — a picker must not be able to select something the
 *  account cannot run, or bill for. */
function ModelPicker({
  models, model, onPick,
}: { models: ChatModel[]; model: ChatModel | null; onPick: (m: ChatModel | null) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Cpu className="h-3 w-3" />
        <span className="hidden sm:inline">{model?.label ?? t("chat.model.auto")}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="popover absolute right-0 top-full z-20 mt-1 w-64 animate-scale-in p-1">
            <button
              type="button"
              onClick={() => { onPick(null); setOpen(false); }}
              className={cn(
                "flex w-full cursor-pointer flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                !model && "bg-primary/10",
              )}
            >
              <span className={cn("text-xs font-semibold",
                !model ? "text-primary" : "text-foreground")}>
                {t("chat.model.auto")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("chat.model.autoHint")}
              </span>
            </button>

            {models.map((option) => {
              const active = model?.id === option.id;
              return (
                <button
                  key={`${option.provider}:${option.id}`}
                  type="button"
                  onClick={() => { onPick(option); setOpen(false); }}
                  className={cn(
                    "flex w-full cursor-pointer flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                    active && "bg-primary/10",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn("text-xs font-semibold",
                      active ? "text-primary" : "text-foreground")}>
                      {option.label}
                    </span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                      option.grade === "deep"
                        ? "bg-primary/12 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {t(`chat.model.${option.grade}`)}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// --- messages -----------------------------------------------------------------

function MessageRow({
  message, employee, onApprove, onReject, onRunAction, onRunWorkflow, onRunStep,
  stepStateFor, runningStep, byId, projectId, busy, decisions, lng,
  onDismiss, dismissedIds,
}: {
  message: ChatMessage;
  employee?: Employee;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRunAction: (messageId: string, employeeId: string, actionId: string,
                decisionKey?: string) => void;
  onRunWorkflow: (messageId: string, steps: WorkflowStep[]) => void;
  onDismiss: (messageId: string) => void;
  dismissedIds?: Set<string>;
  lng?: string;
  onRunStep: (messageId: string, steps: WorkflowStep[], index: number) => void;
  stepStateFor: (messageId: string, index: number) => StepState;
  runningStep: { messageId: string; index: number } | null;
  byId: Map<string, Employee>;
  projectId: string;
  busy: boolean;
  decisions: Record<string, string>;
}) {
  if (message.role === "user") return <UserBubble content={message.content} />;
  if (message.role === "approval") {
    const structured = (message.structured ?? {}) as {
      approvalId?: string;
      actions?: OfferedAction[];
      workflow?: WorkflowStep[];
      followOn?: FollowOnAction[];
    };
    if (structured.followOn?.length) {
      if (dismissedIds?.has(message.id)) return null;
      return (
        <FollowOnCard
          message={message}
          actions={structured.followOn}
          byId={byId}
          onRun={(id, employeeId, actionId) =>
            onRunAction(id, employeeId, actionId, `${employeeId}:${actionId}`)}
          onDismiss={onDismiss}
          chosen={decisions[message.id]}
        />
      );
    }
    if (structured.workflow?.length) {
      return (
        <WorkflowCard
          message={message}
          steps={structured.workflow}
          byId={byId}
          stateOf={(index) => stepStateFor(message.id, index)}
          runningIndex={runningStep?.messageId === message.id ? runningStep.index : null}
          onRunStep={onRunStep}
          onRunAll={onRunWorkflow}
          busy={busy}
        />
      );
    }
    // An offer of work renders as buttons; a hard gate renders as approve/reject.
    if (structured.actions?.length) {
      return (
        <ActionChoices
          message={message}
          employee={employee}
          actions={structured.actions}
          onRun={onRunAction}
          lng={lng}
          chosen={decisions[message.id]}
        />
      );
    }
    return (
      <ApprovalCard
        message={message}
        employee={employee}
        onApprove={onApprove}
        onReject={onReject}
        decided={structured.approvalId ? decisions[structured.approvalId] : undefined}
      />
    );
  }
  if (message.role === "system") {
    return <SystemNotice message={message} employee={employee} lng={lng} />;
  }
  if (message.event === "result") {
    return <ArtifactCard message={message} employee={employee} projectId={projectId} />;
  }
  if (!employee) {
    return message.role === "assistant"
      ? <AssistantBubble
          content={message.content}
          model={message.routing?.model ?? undefined}
          credits={message.routing?.credits}
          tokens={message.routing?.tokens}
        />
      : <UnknownBubble content={message.content} />;
  }
  return (
    <EmployeeBubble
      employee={employee}
      content={message.content}
      model={message.routing?.model ?? undefined}
      credits={message.routing?.credits}
      tokens={message.routing?.tokens}
    />
  );
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

/** Fennex speaking for itself: a greeting, or a question outside what the
 *  company does. It wears the Fennex mark rather than any specialist's icon --
 *  an assistant reply under an employee's avatar claims the wrong author. */
function AssistantBubble({ content, streaming = false, model, credits, tokens }: {
  content: string; streaming?: boolean; model?: string; credits?: number; tokens?: number;
}) {
  return (
    <div className="group/msg flex gap-3 animate-slide-up">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fennec-white.png" alt="" className="h-5 w-5 object-contain" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-baseline gap-2">
          <span className="font-display text-xs font-bold text-foreground">Fennex</span>
          {model && !streaming && (
            <span
              title={tokens ? `${model} · ${tokens.toLocaleString()} tokens` : model}
              className="rounded border border-border px-1.5 py-px font-mono text-[9px] text-muted-foreground"
            >
              {model}
              {credits !== undefined && <span className="ml-1 text-primary">{credits} cr</span>}
            </span>
          )}
        </p>
        <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground">
          <Markdown text={content} streaming={streaming} />
        </div>
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
  employee, content, streaming = false, model, credits, tokens,
}: {
  employee: Employee; content: string; streaming?: boolean;
  model?: string; credits?: number; tokens?: number;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const Icon = employeeIcon(employee.icon);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; failing silently beats an error modal here.
    }
  };

  return (
    <div className="group/msg flex gap-3 animate-slide-up">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
        departmentAccent(employee.department))}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-baseline gap-2">
          <span className="font-display text-xs font-bold text-foreground">{employee.name}</span>
          <span className="text-[10px] text-muted-foreground">{employee.role}</span>
          {/* Which model answered. A reseller pays per reply, so the cost of an
              answer belongs beside the answer rather than only in a report. */}
          {model && !streaming && (
            <span
              title={tokens
                ? `${model} · ${tokens.toLocaleString()} tokens`
                : `Answered by ${model}`}
              className="rounded border border-border px-1.5 py-px font-mono text-[9px] text-muted-foreground"
            >
              {model}
              {credits !== undefined && (
                <span className="ml-1 text-primary">{credits} cr</span>
              )}
            </span>
          )}
          {!streaming && content && (
            <button
              type="button"
              onClick={copy}
              aria-label={t("chat.copy")}
              className="ml-auto cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"
            >
              {copied
                ? <Check className="h-3 w-3 text-success" strokeWidth={2.5} />
                : <Copy className="h-3 w-3" />}
            </button>
          )}
        </p>
        <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground">
          {/* Raw while streaming, markdown once complete. A partial table or an
              unterminated code fence reflows on every token if parsed live,
              which reads as the answer rewriting itself. */}
          <Markdown text={content} streaming={streaming} />
          {streaming && (
            <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse-dot bg-primary" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Router notices: joins, handoffs, clarifications, errors. */
function SystemNotice({
  message, employee, lng,
}: { message: ChatMessage; employee?: Employee; lng?: string }) {
  const { t } = useTranslation();
  // Notices are generated server-side in English. When one carries a
  // translation key, render it in the project's language so the thread does
  // not mix languages; the stored English stays as the fallback.
  const i18n = (message.structured as { i18n?: { key: string; params?: Record<string, unknown> } } | null)?.i18n;
  const text = i18n ? t(i18n.key, { ...i18n.params, lng, defaultValue: message.content }) : message.content;
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
      <span>{text}</span>
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

/** What the employee is offering to do, as buttons. Nothing runs until pressed. */
function ActionChoices({
  message, employee, actions, onRun, lng, chosen,
}: {
  message: ChatMessage;
  employee?: Employee;
  actions: OfferedAction[];
  onRun: (messageId: string, employeeId: string, actionId: string) => void;
  lng?: string;
  chosen?: string;
}) {
  const { t } = useTranslation();
  const Icon = employee ? employeeIcon(employee.icon) : Sparkles;
  const employeeId = employee?.id ?? message.employeeId ?? "";

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-4 animate-slide-up">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        {employee && (
          <span className={cn("flex h-4 w-4 items-center justify-center rounded-full",
            departmentAccent(employee.department))}>
            <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
        )}
        {t("chat.actions.title")}
      </p>
      <p className="mt-1.5 text-sm text-foreground">{noticeText(message, t, lng)}</p>

      <div className="mt-3 flex flex-col gap-2">
        {actions.map((action, index) => {
          const isChosen = chosen === action.actionId;
          const dimmed = !!chosen && !isChosen;
          return (
            <button
              key={action.actionId}
              type="button"
              disabled={!!chosen}
              onClick={() => onRun(message.id, employeeId, action.actionId)}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                index === 0 && !chosen
                  ? "border-primary/40 bg-primary/[0.07] hover:border-primary/60"
                  : "border-border hover:border-primary/30 hover:bg-accent",
                isChosen && "border-success/40 bg-success/[0.07]",
                dimmed && "cursor-not-allowed opacity-40",
                !!chosen && "cursor-not-allowed",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{action.label}</span>
                  {action.destructive && (
                    <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
                      {t("chat.actions.external")}
                    </span>
                  )}
                  {action.weight === "heavy" && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {t("chat.actions.takesLonger")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
                {action.outputs.length > 0 && (
                  <span className="mt-1 block text-[10px] text-muted-foreground/80">
                    {t("chat.approval.produces", { what: action.outputs.join(", ") })}
                  </span>
                )}
              </span>
              {isChosen ? (
                <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={2.5} />
              ) : (
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              )}
            </button>
          );
        })}
      </div>

      {!chosen && (
        <p className="mt-2.5 text-[10px] text-muted-foreground">
          {t("chat.actions.hint")}
        </p>
      )}
    </div>
  );
}

function ApprovalCard({
  message, employee, onApprove, onReject, lng, decided,
}: {
  message: ChatMessage;
  employee?: Employee;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  lng?: string;
  decided?: string;
}) {
  const { t } = useTranslation();
  const structured = (message.structured ?? {}) as {
    approvalId?: string;
    kind?: "approval" | "proposal";
    preview?: {
      action?: string; description?: string; permissions?: string[];
      request?: string; outputs?: string[];
    };
  };
  const approvalId = structured.approvalId;
  const preview = structured.preview ?? {};
  // A proposal ("shall I write it?") is routine; a hard gate ("shall I
  // publish it?") reaches outside Fennex and is styled as the heavier ask.
  const isProposal = (structured.kind ?? message.event) === "proposal";
  const Icon = employee ? employeeIcon(employee.icon) : Sparkles;

  return (
    <div className={cn(
      "rounded-2xl border p-4 animate-slide-up",
      isProposal
        ? "border-primary/25 bg-primary/[0.05]"
        : "border-warning/30 bg-warning/[0.06]",
    )}>
      <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
        isProposal ? "text-primary" : "text-warning")}>
        {employee && (
          <span className={cn("flex h-4 w-4 items-center justify-center rounded-full",
            departmentAccent(employee.department))}>
            <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
        )}
        {isProposal ? t("chat.approval.proposalTitle") : t("chat.approval.title")}
      </p>

      <p className="mt-1.5 text-sm text-foreground">{noticeText(message, t, lng)}</p>
      {preview.description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{preview.description}</p>
      )}

      {preview.outputs && preview.outputs.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("chat.approval.produces", { what: preview.outputs.join(", ") })}
        </p>
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

      {decided ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {decided === "approved" && <Check className="h-3 w-3 text-success" strokeWidth={2.5} />}
          {t(`chat.approval.${decided}`)}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => approvalId && onApprove(approvalId)}
            disabled={!approvalId}
            className="btn-primary flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <Check className="h-3 w-3" />
            {isProposal ? t("chat.approval.goAhead") : t("chat.approval.approve")}
          </button>
          <button
            type="button"
            onClick={() => approvalId && onReject(approvalId)}
            disabled={!approvalId}
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

function WorkingIndicator({
  employee, action, tools = [],
}: { employee: Employee; action?: string; tools?: string[] }) {
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
          {action
            ? t("chat.runningAction", { name: employee.name, action })
            : tools.length > 0
              ? t("chat.usingTool", { name: employee.name, tool: prettyTool(tools[tools.length - 1]) })
              : t("chat.working", { name: employee.name })}
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

/** A server notice, in the project's language when it carries a key. */
function noticeText(
  message: ChatMessage,
  t: (key: string, opts?: Record<string, unknown>) => string,
  lng?: string,
): string {
  const i18n = (message.structured as
    { i18n?: { key: string; params?: Record<string, unknown> } } | null)?.i18n;
  // `lng` pins the render to the project's language: a French project must
  // not read English notices between French replies, whatever UI language
  // the viewer happens to use.
  return i18n ? t(i18n.key, { ...i18n.params, lng, defaultValue: message.content })
              : message.content;
}

/** Tool names are internal slugs; show them as something a person reads. */
function prettyTool(name: string): string {
  return name.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- empty state --------------------------------------------------------------

function EmptyState({
  onPick, employees,
}: { onPick: (text: string) => void; employees: Employee[] }) {
  const { t } = useTranslation();
  const examples = t("chat.examples", { returnObjects: true }) as string[];

  return (
    <div className="flex flex-col items-center py-8 text-center animate-fade-in">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary">
        <Sparkles className="h-7 w-7 text-white" strokeWidth={1.8} />
      </span>
      <h2 className="font-display text-2xl font-bold text-foreground">{t("chat.emptyTitle")}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t("chat.emptyBody")}
      </p>

      {/* Who is behind the assistant. Seeing the specialists makes it obvious
          what can be asked for, without reading any documentation. */}
      {employees.length > 0 && (
        <div className="mt-6 w-full max-w-lg">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("chat.teamBehind", { count: employees.length })}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {employees.map((employee) => {
              const Icon = employeeIcon(employee.icon);
              return (
                <span
                  key={employee.id}
                  title={`${employee.name} — ${employee.role}`}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  <span className={cn("flex h-4 w-4 items-center justify-center rounded-full",
                    departmentAccent(employee.department))}>
                    <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </span>
                  {employee.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 w-full max-w-lg">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("chat.tryOne")}
        </p>
        <div className="flex flex-col gap-1.5">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onPick(example)}
              className="group flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-left text-xs text-muted-foreground transition-all duration-200 hover:border-primary/30 hover:bg-accent hover:text-foreground active:scale-[0.99]"
            >
              <span className="flex-1">{example}</span>
              <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
            </button>
          ))}
        </div>
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
