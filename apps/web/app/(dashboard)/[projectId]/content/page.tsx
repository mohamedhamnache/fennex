"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FennecMascot } from "@fennex/ui";
import { Sparkles, Key, Calendar, FileText, CheckCircle } from "lucide-react";
import { useProjectStore } from "@/lib/store";
import {
  getContentPlans,
  createContentPlan,
  addContentItem,
  updateContentItem,
  deleteContentItem,
  generateContentPlan,
  type ContentItem,
  type ContentPlan,
  type ContentItemStatus,
  type ContentItemType,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";

// ─── Spinner ───────────────────────────────────────────────────────────────

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

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUSES: ContentItemStatus[] = ["idea", "draft", "in_review", "approved", "published"];

const STATUS_LABELS: Record<ContentItemStatus, string> = {
  idea: "Idea",
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  published: "Published",
};

// Dark-mode-safe tints (500-level hue at low alpha reads on both themes).
const STATUS_COLORS: Record<ContentItemStatus, string> = {
  idea: "bg-muted text-muted-foreground",
  draft: "bg-blue-500/12 text-blue-600",
  in_review: "bg-amber-500/12 text-amber-600",
  approved: "bg-emerald-500/12 text-emerald-600",
  published: "bg-indigo-500/12 text-indigo-500",
};

const STATUS_HEADER_COLORS: Record<ContentItemStatus, string> = {
  idea: "text-muted-foreground",
  draft: "text-blue-500",
  in_review: "text-amber-500",
  approved: "text-emerald-500",
  published: "text-indigo-500",
};

const TYPE_COLORS: Record<ContentItemType, string> = {
  article: "bg-indigo-500/12 text-indigo-500",
  landing_page: "bg-violet-500/12 text-violet-500",
  social_post: "bg-pink-500/12 text-pink-500",
  email: "bg-amber-500/12 text-amber-600",
};

const TYPE_LABELS: Record<ContentItemType, string> = {
  article: "Article",
  landing_page: "Landing Page",
  social_post: "Social Post",
  email: "Email",
};

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function nextStatus(status: ContentItemStatus): ContentItemStatus | null {
  const idx = STATUSES.indexOf(status);
  if (idx === -1 || idx === STATUSES.length - 1) return null;
  return STATUSES[idx + 1];
}

// ─── ContentItemCard ───────────────────────────────────────────────────────

function ContentItemCard({
  item,
  planId,
  onClick,
}: {
  item: ContentItem;
  planId: string;
  onClick: () => void;
}) {
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(false);

  const moveMutation = useMutation({
    mutationFn: (status: ContentItemStatus) =>
      updateContentItem(planId, item.id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-plans"] }),
  });

  const next = nextStatus(item.status);

  return (
    <div
      className="relative rounded-xl border border-border bg-card p-3 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="font-medium text-sm text-foreground line-clamp-2">{item.title}</p>

      <div className="mt-2 flex flex-wrap gap-1">
        <span className={`badge text-[10px] ${TYPE_COLORS[item.content_type]}`}>
          <FileText size={10} className="inline mr-0.5" />{TYPE_LABELS[item.content_type]}
        </span>
      </div>

      {item.target_keyword && (
        <p className="mt-1.5 text-xs text-muted-foreground truncate">
          <Key size={10} className="inline mr-0.5" />{item.target_keyword}
        </p>
      )}
      {item.scheduled_date && (
        <p className="mt-0.5 text-xs text-muted-foreground"><Calendar size={10} className="inline mr-0.5" />{formatDate(item.scheduled_date)}</p>
      )}
      {item.word_count_target && (
        <p className="mt-0.5 text-xs text-muted-foreground">{item.word_count_target.toLocaleString()} words</p>
      )}

      {/* Move to next status button */}
      {next && hovered && (
        <button
          className="absolute top-2 right-2 rounded-md bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            moveMutation.mutate(next);
          }}
          disabled={moveMutation.isPending}
          title={`Move to ${STATUS_LABELS[next]}`}
        >
          {moveMutation.isPending ? <Spinner size={10} /> : "→"}
        </button>
      )}
    </div>
  );
}

// ─── Kanban Column ─────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  items,
  planId,
  onCardClick,
}: {
  status: ContentItemStatus;
  items: ContentItem[];
  planId: string;
  onCardClick: (item: ContentItem) => void;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-[220px] w-[220px]">
      {/* Column header */}
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${STATUS_HEADER_COLORS[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
        <span className="badge text-[10px] bg-muted text-muted-foreground">{items.length}</span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center">
            <p className="text-xs text-muted-foreground">No items</p>
          </div>
        ) : (
          items.map((item) => (
            <ContentItemCard
              key={item.id}
              item={item}
              planId={planId}
              onClick={() => onCardClick(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────

function DetailDrawer({
  item,
  planId,
  onClose,
}: {
  item: ContentItem;
  planId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const drawerRef = useRef<HTMLDivElement>(null);

  const [localStatus, setLocalStatus] = useState(item.status);
  const [localType, setLocalType] = useState(item.content_type);

  useEffect(() => {
    setLocalStatus(item.status);
    setLocalType(item.content_type);
  }, [item.status, item.content_type]);

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<ContentItem>) => updateContentItem(planId, item.id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-plans"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteContentItem(planId, item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-plans"] });
      onClose();
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

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay to avoid immediate close from the card click that opened it
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  function saveOnBlur(field: keyof ContentItem, value: string | number | null) {
    updateMutation.mutate({ [field]: value } as Partial<ContentItem>);
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="absolute right-0 top-0 bottom-0 w-[400px] bg-card border-l border-border shadow-xl overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold text-foreground">Content Item</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 p-5 flex-1">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <input
              type="text"
              defaultValue={item.title}
              onBlur={(e) => saveOnBlur("title", e.target.value)}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <select
              value={localStatus}
              onChange={(e) => {
                const newStatus = e.target.value as ContentItemStatus;
                setLocalStatus(newStatus);
                updateMutation.mutate({ status: newStatus });
              }}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <select
              value={localType}
              onChange={(e) => {
                const newType = e.target.value as ContentItemType;
                setLocalType(newType);
                updateMutation.mutate({ content_type: newType });
              }}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              {(["article", "landing_page", "social_post", "email"] as ContentItemType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Target keyword */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Target Keyword</label>
            <input
              type="text"
              defaultValue={item.target_keyword ?? ""}
              onBlur={(e) => saveOnBlur("target_keyword", e.target.value || null)}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
              placeholder="e.g. content marketing"
            />
          </div>

          {/* Scheduled date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Scheduled Date</label>
            <input
              type="date"
              defaultValue={item.scheduled_date ?? ""}
              onChange={(e) => updateMutation.mutate({ scheduled_date: e.target.value || null })}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
          </div>

          {/* Word count target */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Word Count Target</label>
            <input
              type="number"
              defaultValue={item.word_count_target ?? ""}
              onBlur={(e) =>
                saveOnBlur("word_count_target", e.target.value ? parseInt(e.target.value, 10) : null)
              }
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
              placeholder="e.g. 1500"
              min={0}
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea
              defaultValue={item.notes ?? ""}
              onBlur={(e) => saveOnBlur("notes", e.target.value || null)}
              rows={4}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground resize-none"
              placeholder="Add notes..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4">
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="w-full rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/15 transition-colors flex items-center justify-center gap-2"
          >
            {deleteMutation.isPending ? (
              <>
                <Spinner size={14} />
                Deleting...
              </>
            ) : (
              "Delete Item"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Generate Modal ─────────────────────────────────────────────────────────

function GenerateModal({
  onClose,
  onGenerate,
  isGenerating,
}: {
  onClose: () => void;
  onGenerate: (seedKeyword: string) => void;
  isGenerating: boolean;
}) {
  const [seed, setSeed] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

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
      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl p-6"
      >
        <h2 className="font-semibold text-foreground text-lg">Generate Content Plan</h2>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Seed keyword (optional)
          </label>
          <input
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="e.g. SEO"
            className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            autoFocus
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Uses your keyword research if available, otherwise uses seed.
        </p>

        <div className="mt-5 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onGenerate(seed.trim())}
            disabled={isGenerating}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            {isGenerating ? (
              <>
                <Spinner size={14} />
                Generating...
              </>
            ) : (
              <><Sparkles size={14} className="inline mr-1" />Generate</>

            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Item Form ──────────────────────────────────────────────────────────

function NewItemForm({
  planId,
  onClose,
}: {
  planId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentItemType>("article");

  const addMutation = useMutation({
    mutationFn: () =>
      addContentItem(planId, { title: title.trim(), content_type: contentType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-plans"] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    addMutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-card border border-border shadow-xl p-6">
        <h2 className="font-semibold text-foreground text-lg">New Content Item</h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter title..."
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentItemType)}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              {(["article", "landing_page", "social_post", "email"] as ContentItemType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
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
              disabled={!title.trim() || addMutation.isPending}
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
            >
              {addMutation.isPending ? (
                <>
                  <Spinner size={14} />
                  Adding...
                </>
              ) : (
                "Add Item"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── List View ──────────────────────────────────────────────────────────────

function ListView({
  items,
  planId,
  onRowClick,
}: {
  items: ContentItem[];
  planId: string;
  onRowClick: (item: ContentItem) => void;
}) {
  const queryClient = useQueryClient();
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteContentItem(planId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-plans"] }),
    onSettled: () => setDeletingItemId(null),
  });

  const statusMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: ContentItemStatus }) =>
      updateContentItem(planId, itemId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-plans"] }),
  });

  return (
    <div className="card-base overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Title</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Keyword</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No items yet. Add your first item!
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border/50 last:border-0 hover:bg-accent/40 transition-colors cursor-pointer"
                  onClick={() => onRowClick(item)}
                >
                  <td className="px-4 py-3 font-medium text-foreground max-w-[200px] truncate">
                    {item.title}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge text-[10px] ${TYPE_COLORS[item.content_type]}`}>
                      {TYPE_LABELS[item.content_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      defaultValue={item.status}
                      onChange={(e) =>
                        statusMutation.mutate({
                          itemId: item.id,
                          status: e.target.value as ContentItemStatus,
                        })
                      }
                      className={`badge text-[10px] ${STATUS_COLORS[item.status]} border-0 cursor-pointer`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[120px]">
                    {item.target_keyword ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {item.scheduled_date ? formatDate(item.scheduled_date) : "—"}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        setDeletingItemId(item.id);
                        deleteMutation.mutate(item.id);
                      }}
                      disabled={deletingItemId === item.id}
                      className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      {deletingItemId === item.id ? <Spinner size={10} /> : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function ContentPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // Fetch content plans
  const plansQuery = useQuery<ContentPlan[]>({
    queryKey: ["content-plans", projectId],
    queryFn: () => getContentPlans(projectId),
  });

  const plans = plansQuery.data ?? [];
  const plan = plans[0] ?? null;
  const items = plan?.items ?? [];

  // Group items by status for kanban
  const itemsByStatus = STATUSES.reduce(
    (acc, status) => {
      acc[status] = items.filter((item) => item.status === status);
      return acc;
    },
    {} as Record<ContentItemStatus, ContentItem[]>,
  );

  const handleCardClick = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedItem(null);
  }, []);

  async function handleGenerate(seedKeyword: string) {
    setIsGenerating(true);
    try {
      let targetPlanId = plan?.id;

      // If no plan, create one first
      if (!targetPlanId) {
        const newPlan = await createContentPlan(projectId);
        targetPlanId = newPlan.id;
        await queryClient.invalidateQueries({ queryKey: ["content-plans"] });
      }

      const result = await generateContentPlan(targetPlanId, seedKeyword || undefined);
      await queryClient.invalidateQueries({ queryKey: ["content-plans"] });
      setShowGenerateModal(false);
      setSuccessMessage(`${result.items_added} items added to your plan`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setSuccessMessage(`Error: ${err instanceof Error ? err.message : "Generation failed"}`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } finally {
      setIsGenerating(false);
    }
  }

  const isLoading = plansQuery.isLoading;
  const hasError = plansQuery.isError;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title="Content Planner"
        icon={FileText}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Planner" }]}
        description="Plan and manage your content pipeline."
        actions={
          <>
            <button
              onClick={() => setShowNewItemForm(true)}
              disabled={isLoading || !plan}
              title={!plan ? "Generate a plan first" : undefined}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + New Item
            </button>
            <button
              onClick={() => setShowGenerateModal(true)}
              disabled={isLoading || isGenerating}
              className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
            >
              {isGenerating ? (
                <>
                  <Spinner size={13} />
                  Generating...
                </>
              ) : (
                <><Sparkles size={13} className="inline mr-1" />Generate Plan</>
              )}
            </button>
          </>
        }
      />

      {/* Success / error toast */}
      {successMessage && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            successMessage.startsWith("Error:")
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {successMessage}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Spinner size={20} />
          <span className="text-sm">Loading plans…</span>
        </div>
      )}

      {/* Error */}
      {hasError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <p className="text-sm font-medium text-destructive">Failed to load content plans. Please try again.</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !hasError && plans.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FennecMascot />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">No content plan yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Generate your first plan to start building your content pipeline.
            </p>
          </div>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm mt-2"
          >
            <Sparkles size={14} className="inline mr-1" />Generate your first plan
          </button>
        </div>
      )}

      {/* View toggle + board */}
      {!isLoading && !hasError && plan && (
        <>
          {/* View toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
            {(["kanban", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  view === v
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "kanban" ? "Kanban" : "List"}
              </button>
            ))}
          </div>

          {/* Kanban view */}
          {view === "kanban" && (
            <div className="overflow-x-auto">
              <div className="flex gap-4 pb-4" style={{ minWidth: "max-content" }}>
                {STATUSES.map((status) => (
                  <KanbanColumn
                    key={status}
                    status={status}
                    items={itemsByStatus[status]}
                    planId={plan.id}
                    onCardClick={handleCardClick}
                  />
                ))}
              </div>
            </div>
          )}

          {/* List view */}
          {view === "list" && (
            <ListView items={items} planId={plan.id} onRowClick={handleCardClick} />
          )}
        </>
      )}

      {/* Modals & drawers */}
      {showGenerateModal && (
        <GenerateModal
          onClose={() => setShowGenerateModal(false)}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
        />
      )}

      {showNewItemForm && (
        <NewItemForm
          planId={plan?.id ?? ""}
          onClose={() => setShowNewItemForm(false)}
        />
      )}

      {selectedItem && (
        <DetailDrawer item={selectedItem} planId={plan?.id ?? ""} onClose={handleCloseDrawer} />
      )}
    </div>
  );
}
