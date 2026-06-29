"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FennecMascot } from "@fennex/ui";
import {
  Mic2,
  Star,
  Trash2,
  Plus,
  Sparkles,
  Link as LinkIcon,
  FileText,
  X,
} from "lucide-react";
import {
  getBrandVoices,
  getBrandVoice,
  createBrandVoice,
  updateBrandVoice,
  deleteBrandVoice,
  setDefaultBrandVoice,
  addBrandVoiceSource,
  deleteBrandVoiceSource,
  generateVoicePrompt,
  type BrandVoice,
  type BrandVoiceSource,
  type VoiceTone,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";

// ─── Spinner ────────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TONES: VoiceTone[] = [
  "professional",
  "conversational",
  "authoritative",
  "friendly",
  "technical",
  "inspirational",
];

const TONE_LABELS: Record<VoiceTone, string> = {
  professional: "Professional",
  conversational: "Conversational",
  authoritative: "Authoritative",
  friendly: "Friendly",
  technical: "Technical",
  inspirational: "Inspirational",
};

// Dark-mode-safe tone tints (500-level hue at low alpha reads on both themes).
const TONE_COLORS: Record<VoiceTone, string> = {
  professional: "bg-muted text-muted-foreground",
  conversational: "bg-sky-500/12 text-sky-500",
  authoritative: "bg-indigo-500/12 text-indigo-500",
  friendly: "bg-emerald-500/12 text-emerald-500",
  technical: "bg-violet-500/12 text-violet-500",
  inspirational: "bg-amber-500/12 text-amber-600",
};

// ─── Tag Chip Input ──────────────────────────────────────────────────────────

function TagChipInput({
  label,
  words,
  onAdd,
  onRemove,
}: {
  label: string;
  words: string[];
  onAdd: (word: string) => void;
  onRemove: (word: string) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const word = inputValue.trim();
      if (word && !words.includes(word)) {
        onAdd(word);
        setInputValue("");
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {words.map((word) => (
          <span
            key={word}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
          >
            {word}
            <button
              type="button"
              onClick={() => onRemove(word)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Remove ${word}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a word and press Enter"
        className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ─── Voice Card ──────────────────────────────────────────────────────────────

function VoiceCard({
  voice,
  isSelected,
  onSelect,
  onDelete,
  onSetDefault,
}: {
  voice: BrandVoice;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [deletingConfirm, setDeletingConfirm] = useState(false);

  return (
    <div
      className={`relative rounded-xl border bg-card p-5 cursor-pointer transition-all hover:shadow-md ${
        isSelected ? "border-primary bg-primary/5" : "border-border"
      }`}
      onClick={onSelect}
    >
      {/* Delete button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (deletingConfirm) {
            onDelete();
          } else {
            setDeletingConfirm(true);
            setTimeout(() => setDeletingConfirm(false), 2000);
          }
        }}
        className="absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        aria-label="Delete voice"
        title={deletingConfirm ? "Click again to confirm" : "Delete"}
      >
        <Trash2 size={14} />
      </button>

      {/* Header */}
      <div className="flex items-start gap-2 pr-8">
        {voice.is_default && (
          <Star size={14} className="mt-0.5 shrink-0 text-amber-400 fill-amber-400" />
        )}
        <h3 className="font-semibold text-foreground leading-tight">{voice.name}</h3>
      </div>

      {/* Badges */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`badge text-[10px] ${TONE_COLORS[voice.tone]}`}>
          {TONE_LABELS[voice.tone]}
        </span>
        {voice.is_default && (
          <span className="badge text-[10px] bg-primary/10 text-primary font-semibold">
            Default
          </span>
        )}
      </div>

      {/* Description */}
      {voice.description && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{voice.description}</p>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          Edit
        </button>
        {!voice.is_default && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault();
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Set Default
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Voice Detail Panel ──────────────────────────────────────────────────────

function VoiceDetailPanel({
  voiceId,
  onClose,
}: {
  voiceId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: voice, isLoading } = useQuery({
    queryKey: ["brand-voice", voiceId],
    queryFn: () => getBrandVoice(voiceId),
  });

  // Local state for tag inputs
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [avoidWords, setAvoidWords] = useState<string[]>([]);

  // Source form state
  const [sourceType, setSourceType] = useState<"url" | "text">("url");
  const [sourceContent, setSourceContent] = useState("");

  // Generated prompt state
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isDeletingSource, setIsDeletingSource] = useState<string | null>(null);

  useEffect(() => {
    if (voice) {
      setVocabulary(voice.vocabulary ?? []);
      setAvoidWords(voice.avoid_words ?? []);
    }
  }, [voice]);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateBrandVoice>[1]) =>
      updateBrandVoice(voiceId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      queryClient.invalidateQueries({ queryKey: ["brand-voice", voiceId] });
    },
  });

  const addSourceMutation = useMutation({
    mutationFn: (source: { source_type: "url" | "text"; content: string }) =>
      addBrandVoiceSource(voiceId, source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voice", voiceId] });
      setSourceContent("");
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (sourceId: string) => deleteBrandVoiceSource(voiceId, sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voice", voiceId] });
    },
    onSettled: () => {
      setIsDeletingSource(null);
    },
  });

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function saveVocabulary(words: string[]) {
    updateMutation.mutate({ vocabulary: words });
  }

  function saveAvoidWords(words: string[]) {
    updateMutation.mutate({ avoid_words: words });
  }

  function handleAddVocab(word: string) {
    const next = [...vocabulary, word];
    setVocabulary(next);
    saveVocabulary(next);
  }

  function handleRemoveVocab(word: string) {
    const next = vocabulary.filter((w) => w !== word);
    setVocabulary(next);
    saveVocabulary(next);
  }

  function handleAddAvoid(word: string) {
    const next = [...avoidWords, word];
    setAvoidWords(next);
    saveAvoidWords(next);
  }

  function handleRemoveAvoid(word: string) {
    const next = avoidWords.filter((w) => w !== word);
    setAvoidWords(next);
    saveAvoidWords(next);
  }

  async function handleGeneratePrompt() {
    setIsGeneratingPrompt(true);
    try {
      await generateVoicePrompt(voiceId);
      queryClient.invalidateQueries({ queryKey: ["brand-voice", voiceId] });
      queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
    } finally {
      setIsGeneratingPrompt(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div
        className="absolute right-0 top-0 bottom-0 w-[440px] bg-card border-l border-border shadow-xl overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2">
            <Mic2 size={16} className="text-primary" />
            <h2 className="font-semibold text-foreground">Voice Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <Spinner size={20} />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {voice && (
          <div className="flex flex-col gap-6 p-5">
            {/* 1. Basic settings */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Basic Settings
              </p>
              <div className="flex flex-col gap-4">
                {/* Name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Name</label>
                  <input
                    type="text"
                    defaultValue={voice.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== voice.name) {
                        updateMutation.mutate({ name: e.target.value.trim() });
                      }
                    }}
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  />
                </div>

                {/* Tone */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Tone</label>
                  <select
                    defaultValue={voice.tone}
                    onChange={(e) => updateMutation.mutate({ tone: e.target.value as VoiceTone })}
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  >
                    {TONES.map((t) => (
                      <option key={t} value={t}>
                        {TONE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Description</label>
                  <textarea
                    defaultValue={voice.description ?? ""}
                    onBlur={(e) => {
                      const val = e.target.value.trim() || null;
                      if (val !== voice.description) {
                        updateMutation.mutate({ description: val ?? undefined });
                      }
                    }}
                    rows={3}
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground resize-none"
                    placeholder="Describe this voice..."
                  />
                </div>
              </div>
            </section>

            {/* 2. Voice characteristics */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Voice Characteristics
              </p>
              <div className="flex flex-col gap-4">
                <TagChipInput
                  label="Preferred words"
                  words={vocabulary}
                  onAdd={handleAddVocab}
                  onRemove={handleRemoveVocab}
                />
                <TagChipInput
                  label="Words to avoid"
                  words={avoidWords}
                  onAdd={handleAddAvoid}
                  onRemove={handleRemoveAvoid}
                />
              </div>
            </section>

            {/* 3. Training sources */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Training Sources
              </p>

              {/* Existing sources */}
              {voice.training_sources && voice.training_sources.length > 0 ? (
                <ul className="flex flex-col gap-2 mb-4">
                  {voice.training_sources.map((source: BrandVoiceSource) => (
                    <li
                      key={source.id}
                      className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                    >
                      <span className="mt-0.5 shrink-0">
                        {source.source_type === "url" ? (
                          <LinkIcon size={12} className="text-muted-foreground" />
                        ) : (
                          <FileText size={12} className="text-muted-foreground" />
                        )}
                      </span>
                      <span className="flex-1 text-xs text-foreground truncate">
                        {source.content}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsDeletingSource(source.id);
                          deleteSourceMutation.mutate(source.id);
                        }}
                        disabled={isDeletingSource === source.id}
                        className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                        aria-label="Delete source"
                      >
                        {isDeletingSource === source.id ? (
                          <Spinner size={12} />
                        ) : (
                          <Trash2 size={12} />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground mb-4">No training sources yet.</p>
              )}

              {/* Add source form */}
              <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
                {/* Source type radio */}
                <div className="flex gap-4">
                  {(["url", "text"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="source-type"
                        value={t}
                        checked={sourceType === t}
                        onChange={() => setSourceType(t)}
                        className="accent-primary"
                      />
                      <span className="text-xs font-medium text-foreground capitalize">
                        {t === "url" ? "URL" : "Text"}
                      </span>
                    </label>
                  ))}
                </div>

                {sourceType === "url" ? (
                  <input
                    type="url"
                    value={sourceContent}
                    onChange={(e) => setSourceContent(e.target.value)}
                    placeholder="https://example.com/blog-post"
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  />
                ) : (
                  <textarea
                    value={sourceContent}
                    onChange={(e) => setSourceContent(e.target.value)}
                    rows={4}
                    placeholder="Paste your brand copy here..."
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground resize-none"
                  />
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (!sourceContent.trim()) return;
                    addSourceMutation.mutate({
                      source_type: sourceType,
                      content: sourceContent.trim(),
                    });
                  }}
                  disabled={addSourceMutation.isPending || !sourceContent.trim()}
                  className="btn-primary flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
                >
                  {addSourceMutation.isPending ? (
                    <>
                      <Spinner size={14} />
                      Adding…
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Add Source
                    </>
                  )}
                </button>
              </div>
            </section>

            {/* 4. Generated voice prompt */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Generated Voice Prompt
              </p>

              {voice.voice_prompt ? (
                <div className="flex flex-col gap-3">
                  <textarea
                    readOnly
                    value={voice.voice_prompt}
                    rows={6}
                    className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs font-mono text-foreground resize-none"
                  />
                  <button
                    type="button"
                    onClick={handleGeneratePrompt}
                    disabled={isGeneratingPrompt}
                    className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50 w-fit"
                  >
                    {isGeneratingPrompt ? (
                      <>
                        <Spinner size={14} />
                        Regenerating…
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        Regenerate
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">
                    No voice prompt generated yet. Train on sources or generate one now.
                  </p>
                  <button
                    type="button"
                    onClick={handleGeneratePrompt}
                    disabled={isGeneratingPrompt}
                    className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50 w-fit"
                  >
                    {isGeneratingPrompt ? (
                      <>
                        <Spinner size={14} />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        Generate Voice Prompt
                      </>
                    )}
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Voice Modal ──────────────────────────────────────────────────────

function CreateVoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (voice: BrandVoice) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [tone, setTone] = useState<VoiceTone>("professional");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createBrandVoice({
        name: name.trim(),
        tone,
        description: description.trim() || undefined,
      }),
    onSuccess: (voice) => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      onCreated(voice);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl p-6">
        <h2 className="font-semibold text-foreground text-lg">New Brand Voice</h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Brand Voice"
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as VoiceTone)}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Description <span className="font-normal text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground resize-none"
              placeholder="Describe this voice..."
            />
          </div>

          <div className="flex gap-3 justify-end mt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || createMutation.isPending}
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <>
                  <Spinner size={14} />
                  Creating…
                </>
              ) : (
                "Create"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function BrandVoicePage() {
  const queryClient = useQueryClient();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: voices = [], isLoading, isError } = useQuery<BrandVoice[]>({
    queryKey: ["brand-voices"],
    queryFn: getBrandVoices,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBrandVoice(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      if (selectedVoiceId === id) setSelectedVoiceId(null);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => setDefaultBrandVoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
    },
  });

  const handleClose = useCallback(() => setSelectedVoiceId(null), []);

  function handleCreated(voice: BrandVoice) {
    setShowCreateModal(false);
    setSelectedVoiceId(voice.id);
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title="Brand Voice"
        icon={Mic2}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Brand Voice" }]}
        description="Define how your brand communicates across all generated content."
        actions={
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            <Plus size={13} />
            New Voice
          </button>
        }
      />

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Spinner size={20} />
          <span className="text-sm">Loading voices…</span>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <p className="text-sm font-medium text-destructive">Failed to load brand voices. Please try again.</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && voices.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FennecMascot />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">No brand voices yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first brand voice to define how your brand communicates.
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm mt-2"
          >
            <Plus size={14} />
            Create your first brand voice
          </button>
        </div>
      )}

      {/* Voice cards grid */}
      {!isLoading && !isError && voices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {voices.map((voice) => (
            <VoiceCard
              key={voice.id}
              voice={voice}
              isSelected={selectedVoiceId === voice.id}
              onSelect={() => setSelectedVoiceId(voice.id)}
              onDelete={() => deleteMutation.mutate(voice.id)}
              onSetDefault={() => setDefaultMutation.mutate(voice.id)}
            />
          ))}

          {/* New voice dashed card */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-5 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all min-h-[120px]"
          >
            <Plus size={20} />
            <span className="text-sm font-medium">New Voice</span>
          </button>
        </div>
      )}

      {/* Detail panel */}
      {selectedVoiceId && (
        <VoiceDetailPanel voiceId={selectedVoiceId} onClose={handleClose} />
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateVoiceModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
