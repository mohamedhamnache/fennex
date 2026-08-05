"use client";

import { useState, useRef, useEffect, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Send, Bot, User, Sparkles, Wand2, Undo2, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  sendAiCommand, improvePrompt, uploadImage, interpretAttachment, ApiError,
  type GeneratedImage, type AiCommandMessage, type AttachmentInterpretation,
} from "@/lib/api";
import { PROMPT_REPHRASE_CREDIT_COST, ATTACHMENT_INTERPRET_CREDIT_COST } from "@/lib/creditCosts";
import type { EditCanvasRef } from "./EditCanvas";

const SUGGESTION_GROUPS = ["oneGo", "enhance", "retouch", "style", "transform"] as const;

/** Refuse before uploading rather than after: a large photo costs the user a
 *  slow upload and then still has to be downloaded again server-side. */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

/**
 * Appended to the user's own sentence when their attachment is used as a
 * REFERENCE. Model-facing text, deliberately NOT run through t(): it is an
 * instruction to the planner (whose own system prompt is English), not
 * something the user reads. The user's message is displayed and stored
 * unchanged; only the text sent to the model carries this.
 *
 * The "do not add" clause is the load-bearing half. Handed a description of
 * another picture with no such instruction, the instruction model cheerfully
 * composites that picture in -- which is precisely the failure "reference"
 * exists to avoid.
 */
function referenceClause(description: string): string {
  return description
    ? `\n\nThe user attached a REFERENCE image. Do NOT add that image, or any part of `
      + `it, to the picture: use it only as a guide for the look being asked for. `
      + `The reference image shows: ${description}`
    : `\n\nThe user attached a reference image showing the look they want. Do NOT add `
      + `any new image to the picture.`;
}

interface AiChatPanelProps {
  imageId: string;
  onVersionAdded: (img: GeneratedImage) => void;
  /** Shared with the center canvas so a mask pending confirmation can be
   *  previewed there, the same overlay the manual editor uses. */
  canvasRef?: RefObject<EditCanvasRef>;
  /** Drives the scan overlay on the image, the same one the manual panel uses. */
  onProcessingChange?: (processing: boolean) => void;
  /**
   * Stable id for the PICTURE being worked on, across its whole version chain.
   * Chat history keys on this, not on imageId: every successful edit creates a
   * new version and switches imageId to it, so keying history on imageId wiped
   * the conversation after every single edit (and on every undo/redo).
   */
  conversationId: string;
  /** Where an attached image is stored. */
  projectId: string;
  /**
   * Adds an attached image to the composition as a LAYER, returning its id.
   * This is the "insert" half of an attachment, and it reuses the editor's
   * existing layer system rather than a generative insert: the element lands
   * where the user can move, resize and delete it, and it costs nothing to
   * place or to remove again -- which is what makes correcting a wrong
   * interpretation free.
   */
  onAddImageLayer?: (imageUrl: string, name: string, aspectRatio: number) => string;
  /** Removes a layer this panel added, when the user corrects an insert into a
   *  reference. Without it a rejected insert would stay in the picture. */
  onRemoveLayer?: (layerId: string) => void;
}

/** An image the user has attached to the message they are composing. */
interface PendingAttachment {
  imageId: string;
  url: string;
  name: string;
  aspectRatio: number;
}

/**
 * The last attachment that was interpreted, kept so the user can CORRECT the
 * interpretation. The classification will sometimes be wrong and the failure
 * is asymmetric, so the correction has to be one click and it has to be free:
 * both the description and the uploaded file are already in hand, so switching
 * either way re-uploads nothing and calls nothing.
 */
interface ResolvedAttachment extends PendingAttachment {
  /** The user's own sentence, without the reference clause. */
  command: string;
  description: string;
  intent: AttachmentInterpretation["intent"];
  guessed: boolean;
  /** Set while the "insert" reading is in effect, so undoing it can remove
   *  the layer again. */
  layerId?: string;
}

/** Natural size of a picked file, for the layer's aspect ratio. */
function readAspectRatio(file: File): Promise<number> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(1);
    };
    img.src = objectUrl;
  });
}

/** Awaiting the user's approval of an auto-derived mask for one step of a
 *  (possibly multi-step) ai-command chain. `accumulated` holds mask URLs
 *  already confirmed earlier in this same chain, indexed by step. */
interface PendingMaskConfirm {
  command: string;
  message: string;
  maskUrl: string;
  stepIndex: number;
  accumulated: string[];
  /** The 422's resume_token, so the retry resumes the server's cached plan
   *  instead of re-planning and re-billing already-applied steps. A chain
   *  can stop for confirmation more than once; each stop mints a FRESH
   *  token reflecting progress so far, so this always holds the most
   *  recent one, never an earlier round's. */
  resumeToken: string | undefined;
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

export function AiChatPanel({ imageId, onVersionAdded, canvasRef,
  onProcessingChange,
  conversationId,
  projectId,
  onAddImageLayer,
  onRemoveLayer,
}: AiChatPanelProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<AiCommandMessage[]>([]);

  // Chat history is scoped to the PICTURE (conversationId, stable across its
  // versions) and survives unmount, so switching to the Edit tab and back --
  // or reloading, or applying an edit -- does not lose the conversation about
  // it. Kept in localStorage rather than the server: it is a per-browser
  // working note about one image, not shared state.
  const historyKey = `fennex.mirage.chat.${conversationId}`;
  const [pendingConfirm, setPendingConfirm] = useState<PendingMaskConfirm | null>(null);

  // Rephrase. NEVER automatic -- it runs only from the button below, because a
  // rewrite the user did not ask for silently changes what they are about to
  // spend on. `rephraseOriginal` holds the text as it was immediately before
  // the rewrite so Undo can restore it in ONE click: an improvement that loses
  // what the user actually meant, with no way back, is worse than none. It is
  // kept through subsequent typing (the user may still want the original back)
  // and cleared only by Undo itself or by actually sending.
  const [rephrasing, setRephrasing] = useState(false);
  const [rephraseOriginal, setRephraseOriginal] = useState<string | null>(null);
  const [rephraseError, setRephraseError] = useState(false);

  // Image attachment. `attachment` is the file already uploaded and waiting to
  // be sent with the next message; `resolved` is the last one that was
  // interpreted, kept so the interpretation can be corrected for free.
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachErrorKey, setAttachErrorKey] = useState<string | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [resolved, setResolved] = useState<ResolvedAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // True when showMaskPreview() rejected (404/CORS/etc.) — the highlighted
  // area never rendered, so Apply must be disabled: approving a mask the
  // user never actually saw would defeat the confirmation gate entirely.
  const [maskPreviewError, setMaskPreviewError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, pendingConfirm]);

  // Mirror of EditControlsPanel's leak guard: the tinted mask preview lives
  // on the shared EditCanvas, not in this component. Switching the
  // right-hand tab back to "Edit" unmounts this whole panel (see page.tsx's
  // rightTab ternary), dropping pendingConfirm without ever running Cancel's
  // handler, which would otherwise leave abandoned mask pixels for
  // EditControlsPanel's next Save to silently pick up via getMaskBase64().
  const pendingConfirmRef = useRef(pendingConfirm);
  useEffect(() => { pendingConfirmRef.current = pendingConfirm; }, [pendingConfirm]);
  useEffect(() => {
    return () => {
      if (pendingConfirmRef.current) canvasRef?.current?.clearMask();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching the displayed image/version doesn't unmount this panel, so a
  // confirmation left pending from the PREVIOUS image would otherwise still
  // be Apply-able against the new one. History is handled by the effect above,
  // which swaps in the new image's own conversation.
  useEffect(() => () => onProcessingChange?.(false), [onProcessingChange]);

  // Which key the loaded conversation belongs to. The persist effect refuses to
  // write until this matches, because on MOUNT `history` is still [] while the
  // load effect's setHistory only takes effect on the NEXT render -- so the
  // persist effect would run with [] and erase the very conversation being
  // restored. That is what wiped the chat on every switch to the Edit tab.
  const loadedKeyRef = useRef<string | null>(null);

  // Load THIS picture's conversation whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    loadedKeyRef.current = null;
    try {
      const saved = window.localStorage.getItem(historyKey);
      setHistory(saved ? (JSON.parse(saved) as AiCommandMessage[]) : []);
    } catch {
      setHistory([]);
    }
    loadedKeyRef.current = historyKey;
  }, [historyKey]);

  // Persist on every change so an unmount (tab switch) cannot lose it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loadedKeyRef.current !== historyKey) return;  // see loadedKeyRef
    try {
      if (history.length) window.localStorage.setItem(historyKey, JSON.stringify(history));
      // An empty history is NOT written as a deletion: the conversation is kept
      // forever unless the user clears it, so a transient empty render can never
      // destroy it.
    } catch {
      // a full or disabled localStorage must never break the chat itself
    }
  }, [historyKey, history]);

  useEffect(() => {
    setPendingConfirm(null);
    setMaskPreviewError(false);
    canvasRef?.current?.clearMask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  const mutation = useMutation({
    // priorHistory is passed explicitly rather than read from state: the user's
    // message is appended optimistically before this runs, and the request must
    // carry the conversation as it was BEFORE it, not including it twice.
    mutationFn: ({ command, priorHistory, maskUrls, resumeToken }: {
      command: string;
      priorHistory: AiCommandMessage[];
      maskUrls?: string[];
      resumeToken?: string;
    }) => sendAiCommand(imageId, command, priorHistory, undefined, maskUrls, resumeToken),
    onSuccess: (img) => {
      const opLabel = img.edit_operation?.replace(/_/g, " ") ?? "edit";
      // The user turn was posted on submit, so only the reply is added here.
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: t("mirage.applied", { op: opLabel }) },
      ]);
      onVersionAdded(img);
      setPendingConfirm(null);
      setMaskPreviewError(false);
      canvasRef?.current?.clearMask();
      setInput("");
    },
    onError: (err, { command, maskUrls }) => {
      if (err instanceof ApiError && err.detail?.code === "mask_confirm_required") {
        const maskUrl = String(err.detail.mask_url ?? "");
        const stepIndex = Number(err.detail.step_index ?? 0);
        const message = typeof err.detail.message === "string"
          ? err.detail.message
          : t("mirage.maskConfirmDefault", "Confirm the highlighted area before applying.");
        if (maskUrl) {
          const resumeToken = typeof err.detail.resume_token === "string" ? err.detail.resume_token : undefined;
          setPendingConfirm({ command, message, maskUrl, stepIndex, accumulated: maskUrls ?? [], resumeToken });
          setMaskPreviewError(false);
          // See maskPreviewError declaration: an unseen mask must never be
          // silently approvable.
          canvasRef?.current?.showMaskPreview(maskUrl).catch(() => setMaskPreviewError(true));
          return;
        }
      }
      if (err instanceof ApiError && err.detail?.code === "mask_target_required") {
        const message = typeof err.detail.message === "string"
          ? err.detail.message
          : t("mirage.maskTargetDefault", "Which area did you mean?");
        setHistory((prev) => [...prev, { role: "assistant", content: message }]);
        setInput("");
        return;
      }
      setHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t("mirage.failed", { error: err instanceof Error ? err.message : t("mirage.unknownError") }),
        },
      ]);
      setInput("");
    },
  });

  // Same scan overlay the manual panel drives, so a Mirage request looks like
  // work happening ON the image rather than only in the chat column.
  useEffect(() => {
    onProcessingChange?.(mutation.isPending);
  }, [mutation.isPending, onProcessingChange]);


  const busy = mutation.isPending || uploading || interpreting;

  function submit(command: string) {
    const trimmed = command.trim();
    if (!trimmed || busy || pendingConfirm) return;
    // Post the user's turn BEFORE the request so the chat reflects what was
    // asked while it runs, instead of staying empty until the edit finishes.
    const priorHistory = history;
    setHistory((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    // The message is gone; there is no longer an "original" to go back to.
    setRephraseOriginal(null);
    setRephraseError(false);
    if (attachment) {
      void submitWithAttachment(trimmed, attachment, priorHistory);
      return;
    }
    // A message with no attachment ends whatever the previous one attached, so
    // the correction affordance does not linger against an unrelated turn.
    setResolved(null);
    mutation.mutate({ command: trimmed, priorHistory });
  }

  /** Send a message that carries an image: interpret it, then act on the verdict. */
  async function submitWithAttachment(
    trimmed: string, att: PendingAttachment, priorHistory: AiCommandMessage[],
  ) {
    setAttachment(null);
    setResolved(null);
    setInterpreting(true);
    let verdict: AttachmentInterpretation;
    try {
      verdict = await interpretAttachment({ command: trimmed, attachment_image_id: att.imageId });
    } catch {
      setHistory((prev) => [...prev, { role: "assistant", content: t("mirage.attachFailed") }]);
      // Give the file back rather than making the user pick it again.
      setAttachment(att);
      return;
    } finally {
      setInterpreting(false);
    }
    applyIntent(
      { ...att, command: trimmed, description: verdict.description, intent: verdict.intent, guessed: verdict.guessed },
      priorHistory,
    );
  }

  /**
   * Act on an interpretation and say which one was chosen.
   *
   * Called both for the model's verdict and for the user's correction of it,
   * from the same held data -- neither path re-uploads the file nor asks for
   * the interpretation again, so a correction is free in either direction.
   */
  function applyIntent(next: ResolvedAttachment, priorHistory: AiCommandMessage[]) {
    if (next.intent === "insert") {
      // The editor's own layer system, not a generative insert: the element
      // lands where it can be moved, resized and deleted, at no cost.
      const layerId = onAddImageLayer?.(next.url, next.name, next.aspectRatio);
      setResolved({ ...next, layerId });
      setHistory((prev) => [...prev, { role: "assistant", content: t("mirage.attachInserted") }]);
      return;
    }
    // Correcting an insert into a reference must also take the layer back out,
    // or the image the user just said should NOT appear stays in the picture.
    if (next.layerId) onRemoveLayer?.(next.layerId);
    setResolved({ ...next, layerId: undefined });
    setHistory((prev) => [...prev, { role: "assistant", content: t("mirage.attachReferenced") }]);
    mutation.mutate({ command: next.command + referenceClause(next.description), priorHistory });
  }

  /**
   * Switch the interpretation the other way, for free.
   *
   * Correcting reference -> insert only PLACES the layer; it does not roll
   * back the edit that was already applied. Undoing an applied edit is the
   * version history's job (every edit is a new version), and this panel must
   * not invent a second, competing undo for it.
   */
  function handleCorrectIntent() {
    if (!resolved || busy || pendingConfirm) return;
    applyIntent(
      { ...resolved, intent: resolved.intent === "insert" ? "reference" : "insert" },
      history,
    );
  }

  async function handlePickAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the SAME file twice still fires a change.
    e.target.value = "";
    if (!file) return;
    setAttachErrorKey(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachErrorKey("mirage.attachTooLarge");
      return;
    }
    setUploading(true);
    try {
      const aspectRatio = await readAspectRatio(file);
      const uploaded = await uploadImage(projectId, file);
      setAttachment({
        imageId: uploaded.id,
        url: uploaded.image_url ?? "",
        name: file.name,
        aspectRatio,
      });
    } catch {
      setAttachErrorKey("mirage.attachUploadFailed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRephrase() {
    const original = input.trim();
    if (!original || rephrasing || busy || pendingConfirm) return;
    setRephraseError(false);
    setRephrasing(true);
    try {
      // mode: "edit_instruction" -- this is an instruction against a picture
      // that already exists, not a brief for generating a new one.
      const { improved_prompt } = await improvePrompt({ prompt: original, mode: "edit_instruction" });
      const improved = improved_prompt.trim();
      if (!improved) {
        setRephraseError(true);
        return;
      }
      setRephraseOriginal(original);
      setInput(improved);
      textareaRef.current?.focus();
    } catch {
      setRephraseError(true);
    } finally {
      setRephrasing(false);
    }
  }

  function handleUndoRephrase() {
    if (rephraseOriginal === null) return;
    setInput(rephraseOriginal);
    setRephraseOriginal(null);
    setRephraseError(false);
    textareaRef.current?.focus();
  }

  function handleApplyMaskConfirm() {
    if (!pendingConfirm || maskPreviewError) return;
    const maskUrls = [...pendingConfirm.accumulated];
    maskUrls[pendingConfirm.stepIndex] = pendingConfirm.maskUrl;
    const command = pendingConfirm.command;
    const resumeToken = pendingConfirm.resumeToken;
    setPendingConfirm(null);
    setMaskPreviewError(false);
    canvasRef?.current?.clearMask();
    // Confirming re-sends the SAME command, whose user turn is already on
    // screen from the original submit -- so it is not posted again, and the
    // request carries the history as it stood before that turn.
    //
    // The turn is found by searching BACKWARDS rather than by assuming it is
    // the last entry. An attachment read as a reference posts an assistant
    // line ("Used your image as a reference") between the user's turn and the
    // request, so a last-entry-only test would find an assistant message,
    // leave the user turn in place, and send the command twice -- once in
    // `history` and once as `command`.
    const lastUserIndex = history.map((m) => m.role).lastIndexOf("user");
    const priorHistory = history.filter((_, i) => i !== lastUserIndex);
    mutation.mutate({ command, priorHistory, maskUrls, resumeToken });
  }

  function handleCancelMaskConfirm() {
    setPendingConfirm(null);
    setMaskPreviewError(false);
    canvasRef?.current?.clearMask();
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
        {history.length === 0 && !busy && !pendingConfirm && (
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
                        disabled={busy}
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

        {/* Mask confirmation — an auto-derived mask is waiting for approval */}
        {pendingConfirm && (
          <div className="flex gap-2 items-start animate-msg-in">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shrink-0 shadow-sm">
              <Bot className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-xs leading-relaxed text-foreground flex flex-col gap-2">
              <p>{pendingConfirm.message}</p>
              <p className="text-[10px] text-muted-foreground">
                {t("mirage.maskConfirmHint", "Check the highlighted area on the canvas.")}
              </p>
              {maskPreviewError && (
                <p className="text-[10px] text-destructive">
                  {t("mirage.maskPreviewError", "We couldn't show the highlighted area, so it can't be confirmed. Cancel and try again.")}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelMaskConfirm}
                  disabled={mutation.isPending}
                  className="flex-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {t("mirage.maskCancel", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleApplyMaskConfirm}
                  disabled={mutation.isPending || maskPreviewError}
                  title={maskPreviewError ? t("mirage.maskPreviewError", "We couldn't show the highlighted area, so it can't be confirmed. Cancel and try again.") : undefined}
                  className="flex-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {mutation.isPending ? t("mirage.applying", "Applying...") : t("mirage.maskApply", "Apply")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* The interpretation that was chosen, and the one-click way to change
            it. Stating the choice is not decoration: the classification will
            sometimes be wrong and the two failures are not symmetric -- a
            reference read as an insert puts an unwanted picture in the frame,
            an insert read as a reference silently drops what was asked for.
            Both the file and its description are already held, so this button
            re-uploads nothing and calls nothing. */}
        {resolved && !pendingConfirm && (
          <div className="flex items-center gap-2 flex-wrap pl-9 animate-msg-in">
            {resolved.guessed && (
              <span className="text-[10px] text-muted-foreground">{t("mirage.attachGuessed")}</span>
            )}
            <button
              type="button"
              onClick={handleCorrectIntent}
              disabled={busy}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50"
            >
              {resolved.intent === "insert"
                ? t("mirage.attachUseAsReference")
                : t("mirage.attachInsertInstead")}
            </button>
            <span className="text-[10px] text-muted-foreground">{t("mirage.attachCorrectionFree")}</span>
          </div>
        )}

        {/* Typing indicator */}
        {(mutation.isPending || interpreting) && !pendingConfirm && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 shrink-0">
        {/* Composer toolbar. The rephrase button carries its own price so the
            cost is on screen BEFORE the click that spends it, never only in
            the balance afterwards. */}
        <div className="flex items-center gap-2 pb-2">
          <button
            type="button"
            onClick={handleRephrase}
            disabled={!input.trim() || rephrasing || busy || !!pendingConfirm}
            title={t("mirage.rephraseTitle")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
              "bg-primary/10 text-primary hover:bg-primary/20",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {rephrasing
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Wand2 className="h-3 w-3" strokeWidth={1.8} />}
            {rephrasing ? t("mirage.rephrasing") : t("mirage.rephrase")}
          </button>
          <span className="text-[10px] text-muted-foreground">
            {t("mirage.rephraseCost", { count: PROMPT_REPHRASE_CREDIT_COST })}
          </span>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !!pendingConfirm || !!attachment}
            title={t("mirage.attachTitle")}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Paperclip className="h-3.5 w-3.5" strokeWidth={1.8} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickAttachment}
            className="hidden"
          />

          {rephraseOriginal !== null && (
            <button
              type="button"
              onClick={handleUndoRephrase}
              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Undo2 className="h-3 w-3" strokeWidth={1.8} />
              {t("mirage.rephraseUndo")}
            </button>
          )}
        </div>

        {rephraseError && (
          <p className="text-[10px] text-destructive pb-2 px-1">{t("mirage.rephraseFailed")}</p>
        )}
        {attachErrorKey && (
          <p className="text-[10px] text-destructive pb-2 px-1">{t(attachErrorKey)}</p>
        )}

        {/* The attached file, and what reading it will cost — on screen before
            the send that spends it. Inserting the image costs nothing beyond
            this read; using it as a reference then costs whatever the edit
            itself costs, which is the normal per-message charge. */}
        {attachment && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2 mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt=""
              className="h-9 w-9 rounded-lg object-cover shrink-0 border border-border"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-foreground">{attachment.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {t("mirage.attachCost", { count: ATTACHMENT_INTERPRET_CREDIT_COST })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setAttachment(null); setAttachErrorKey(null); }}
              disabled={busy}
              title={t("mirage.attachRemove")}
              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex gap-2 items-end rounded-xl border border-border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("mirage.placeholder")}
            rows={2}
            disabled={!!pendingConfirm}
            className="flex-1 resize-none px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground bg-transparent focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!input.trim() || busy || !!pendingConfirm}
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
