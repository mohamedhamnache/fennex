"use client";

import { useState, useRef, useEffect, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import {
  Send, Bot, User, Sparkles, Wand2, Undo2, Loader2, Paperclip, X,
  AlertCircle, ImagePlus, RefreshCw,
} from "lucide-react";
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
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

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
  /** Whether a new file can be taken right now. One condition, so the paperclip,
   *  the drop overlay and attachFile itself cannot disagree about it. */
  const canAttach = !busy && !pendingConfirm && !attachment;

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

  /**
   * The single intake for an attached image, shared by the file picker, paste
   * and drop.
   *
   * One function rather than three because the validation and the upload are
   * the parts that must not drift: a size limit enforced on the picker but not
   * on drop is a limit that does not exist.
   */
  async function attachFile(file: File) {
    if (!canAttach) return;
    setAttachErrorKey(null);
    if (!file.type.startsWith("image/")) {
      setAttachErrorKey("mirage.attachNotAnImage");
      return;
    }
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
        // A pasted screenshot arrives as "image.png" or with no name at all;
        // showing that tells the user nothing about what they attached.
        name: file.name || t("mirage.attachPastedName"),
        aspectRatio,
      });
    } catch {
      setAttachErrorKey("mirage.attachUploadFailed");
    } finally {
      setUploading(false);
    }
  }

  function handlePickAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the SAME file twice still fires a change.
    e.target.value = "";
    if (file) void attachFile(file);
  }

  /** Paste an image straight into the composer -- the fastest path from a
   *  screenshot to an edit, and the one people reach for first. */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return; // Plain text paste: leave it to the textarea.
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    void attachFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    // Reset the counter, not just the flag: the drop consumes the drag without
    // firing the matching dragleave, so a depth left above zero would keep the
    // NEXT drag's overlay stuck on screen after the pointer had left.
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void attachFile(file);
  }

  /**
   * Drag tracking, counted rather than toggled.
   *
   * dragenter/dragleave both fire when the pointer crosses a CHILD element, so
   * a plain boolean flickers off the moment the cursor moves over the textarea
   * inside the drop zone. Counting enters against leaves is the standard fix.
   */
  function handleDragEnter(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
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
          <div className="pl-9 animate-msg-in">
            <div className="rounded-xl border border-border bg-muted/30 p-2.5 flex items-start gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolved.url}
                alt={resolved.name}
                className="h-8 w-8 rounded-lg object-cover shrink-0 border border-border"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-foreground leading-snug">
                  {resolved.intent === "insert"
                    ? t("mirage.attachInsertedShort")
                    : t("mirage.attachReferencedShort")}
                </p>
                {resolved.guessed && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {t("mirage.attachGuessed")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleCorrectIntent}
                  disabled={busy}
                  className={cn(
                    "mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold",
                    "min-h-[28px] text-primary transition-colors hover:bg-primary/10",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  <RefreshCw className="h-3 w-3" strokeWidth={2} />
                  {resolved.intent === "insert"
                    ? t("mirage.attachUseAsReference")
                    : t("mirage.attachInsertInstead")}
                  <span className="font-normal text-muted-foreground">
                    {t("mirage.attachCorrectionFree")}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {(mutation.isPending || interpreting) && !pendingConfirm && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input area. The whole block is the drop target, not just the text
          box: aiming at a 2-row textarea is fussy, and a drop that lands one
          pixel outside navigates the browser away to the dropped file. */}
      <div
        className="relative border-t border-border p-3 shrink-0"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Composer toolbar. Each action carries its own price, so the cost is
            on screen BEFORE the click that spends it and never only in the
            balance afterwards. */}
        <div className="flex items-center gap-2 pb-2">
          <button
            type="button"
            onClick={handleRephrase}
            disabled={!input.trim() || rephrasing || busy || !!pendingConfirm}
            title={t("mirage.rephraseTitle")}
            className={cn(
              "group flex items-center gap-1.5 rounded-lg pl-2.5 pr-1.5 py-1.5 text-[11px] font-semibold",
              "min-h-[32px] transition-colors bg-primary/10 text-primary hover:bg-primary/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {rephrasing
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Wand2 className="h-3 w-3" strokeWidth={1.8} />}
            {rephrasing ? t("mirage.rephrasing") : t("mirage.rephrase")}
            {/* The price rides INSIDE the control it applies to. As a loose
                span beside it, it read as a caption for the whole toolbar and
                left the attachment's separate cost unexplained. */}
            <span
              aria-label={t("mirage.rephraseCost", { count: PROMPT_REPHRASE_CREDIT_COST })}
              title={t("mirage.rephraseCost", { count: PROMPT_REPHRASE_CREDIT_COST })}
              className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            >
              {PROMPT_REPHRASE_CREDIT_COST}
            </span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canAttach}
            title={t("mirage.attachTitle")}
            aria-label={t("mirage.attachTitle")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground",
              "transition-colors hover:text-foreground hover:bg-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {uploading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Paperclip className="h-4 w-4" strokeWidth={1.8} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickAttachment}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />

          {rephraseOriginal !== null && (
            <button
              type="button"
              onClick={handleUndoRephrase}
              className={cn(
                "ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold",
                "min-h-[32px] text-muted-foreground transition-colors hover:text-foreground hover:bg-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              )}
            >
              <Undo2 className="h-3 w-3" strokeWidth={1.8} />
              {t("mirage.rephraseUndo")}
            </button>
          )}
        </div>

        {/* Errors carry an icon as well as the destructive colour: colour
            alone is not a signal every reader receives. role="alert" so the
            message is announced rather than only painted. */}
        {(rephraseError || attachErrorKey) && (
          <p role="alert" className="flex items-start gap-1.5 text-[10px] text-destructive pb-2 px-1">
            <AlertCircle className="h-3 w-3 shrink-0 mt-px" strokeWidth={2} />
            {rephraseError ? t("mirage.rephraseFailed") : t(attachErrorKey!)}
          </p>
        )}

        {/* The attached file, and what reading it will cost — on screen before
            the send that spends it. Inserting the image costs nothing beyond
            this read; using it as a reference then costs whatever the edit
            itself costs, which is the normal per-message charge. */}
        {attachment && (
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 p-2 mb-2 animate-scale-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.name}
              className="h-10 w-10 rounded-lg object-cover shrink-0 border border-border"
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
              aria-label={t("mirage.attachRemove")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
                "transition-colors hover:text-foreground hover:bg-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                "disabled:opacity-40",
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex gap-2 items-end rounded-xl border border-border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("mirage.placeholder")}
            aria-label={t("mirage.placeholder")}
            rows={2}
            disabled={!!pendingConfirm}
            className="flex-1 resize-none px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground bg-transparent focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!input.trim() || busy || !!pendingConfirm}
            onClick={() => submit(input)}
            title={t("mirage.send")}
            aria-label={t("mirage.send")}
            className={cn(
              "m-1.5 h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground",
              "transition-colors hover:bg-primary/90 shrink-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "disabled:opacity-40",
            )}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
          {t("mirage.enterHint")}
        </p>

        {/* Drop overlay. Rendered above the composer only while a file is
            actually over it, and pointer-events-none so it can never swallow
            the drop it is advertising. */}
        {dragging && (
          canAttach ? (
            <div className="absolute inset-2 z-10 pointer-events-none rounded-xl border-2 border-dashed border-primary bg-background/90 flex flex-col items-center justify-center gap-1 animate-fade-in">
              <ImagePlus className="h-5 w-5 text-primary" strokeWidth={1.8} />
              <p className="text-[11px] font-semibold text-primary">{t("mirage.attachDropHere")}</p>
              <p className="text-[10px] text-muted-foreground">
                {t("mirage.attachCost", { count: ATTACHMENT_INTERPRET_CREDIT_COST })}
              </p>
            </div>
          ) : (
            /* Dragging over a composer that cannot take the file. Saying why
               beats an inviting dashed outline over a drop that would be
               silently discarded. */
            <div className="absolute inset-2 z-10 pointer-events-none rounded-xl border-2 border-dashed border-border bg-background/90 flex items-center justify-center px-4 animate-fade-in">
              <p className="text-[11px] font-semibold text-muted-foreground text-center">
                {attachment ? t("mirage.attachOneAtATime") : t("mirage.attachBusy")}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
