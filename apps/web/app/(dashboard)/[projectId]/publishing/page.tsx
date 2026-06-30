"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Link as LinkIcon,
  MoreHorizontal,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  ToggleLeft,
  ToggleRight,
  Send,
} from "lucide-react";
import { useProjectStore } from "@/lib/store";
import {
  listPublishingConnections,
  createPublishingConnection,
  updatePublishingConnection,
  deletePublishingConnection,
  testPublishingConnection,
  listPublishJobs,
  listArticles,
  type PublishingConnection,
  type PublishJob,
  type PublishingPlatform,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// ─── Spinner ───────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <Loader2
      className="animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

// ─── Platform badge ────────────────────────────────────────────────────────

const PLATFORM_STYLES: Record<PublishingPlatform, string> = {
  wordpress: "bg-[#21759b]/10 text-[#21759b]",
  ghost: "bg-muted text-muted-foreground",
  notion: "bg-muted text-muted-foreground",
  custom: "bg-muted text-muted-foreground",
};

function PlatformBadge({ platform }: { platform: PublishingPlatform }) {
  const label = platform.charAt(0).toUpperCase() + platform.slice(1);
  return (
    <span className={`badge capitalize ${PLATFORM_STYLES[platform]}`}>{label}</span>
  );
}

// ─── Job status badge ──────────────────────────────────────────────────────

const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  done: "success",
  failed: "danger",
  running: "info",
  pending: "neutral",
};

function JobStatusBadge({ status }: { status: keyof typeof JOB_STATUS_TONE }) {
  return <Badge tone={JOB_STATUS_TONE[status] ?? "neutral"} className="capitalize">{status}</Badge>;
}

// ─── Relative time helper ──────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

// ─── Connection Card ────────────────────────────────────────────────────────

function ConnectionCard({
  connection,
  onEdit,
  onDelete,
}: {
  connection: PublishingConnection;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, []);

  const testMutation = useMutation({
    mutationFn: () => testPublishingConnection(connection.id),
    onSuccess: (result) => {
      setTestResult(result);
      queryClient.invalidateQueries({ queryKey: ["publishing-connections", connection.project_id] });
      if (dismissRef.current) clearTimeout(dismissRef.current);
      dismissRef.current = setTimeout(() => setTestResult(null), 4000);
    },
    onError: (err) => {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "Test failed" });
      if (dismissRef.current) clearTimeout(dismissRef.current);
      dismissRef.current = setTimeout(() => setTestResult(null), 4000);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () =>
      updatePublishingConnection(connection.id, { is_active: !connection.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publishing-connections", connection.project_id] });
    },
  });

  let dotClass = "bg-gray-400";
  if (connection.last_test_ok === true) dotClass = "bg-emerald-500";
  else if (connection.last_test_ok === false) dotClass = "bg-red-500";

  const statusLabel =
    connection.last_test_ok === true
      ? t("publishing.connectionCard.connected")
      : connection.last_test_ok === false
      ? t("publishing.connectionCard.failed")
      : t("publishing.connectionCard.notTested");

  return (
    <div className="card-base p-5 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-foreground">{connection.name}</p>
            <PlatformBadge platform={connection.platform} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{connection.site_url}</p>

          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
              <span className="text-xs text-muted-foreground">
                {statusLabel}
                {connection.last_tested_at && (
                  <> · {t("publishing.connectionCard.lastTested", { time: relativeTime(connection.last_tested_at) })}</>
                )}
              </span>
            </div>

            {testResult !== null && (
              <span
                className={`text-xs font-medium flex items-center gap-1 ${
                  testResult.ok ? "text-success" : "text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {testResult.user ? `Connected as ${testResult.user}` : t("publishing.connectionCard.connectionSuccessful")}
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    {testResult.error ?? t("publishing.connectionCard.connectionFailed")}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title={connection.is_active ? t("publishing.connectionCard.deactivate") : t("publishing.connectionCard.activate")}
          >
            {connection.is_active ? (
              <ToggleRight className="h-5 w-5 text-emerald-500" />
            ) : (
              <ToggleLeft className="h-5 w-5" />
            )}
          </button>

          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {testMutation.isPending ? (
              <>
                <Spinner size={12} /> {t("publishing.connectionCard.testing")}
              </>
            ) : (
              t("publishing.connectionCard.test")
            )}
          </button>

          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                  className="w-full px-4 py-2.5 text-sm text-left text-foreground hover:bg-accent transition-colors"
                >
                  {t("publishing.connectionCard.edit")}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full px-4 py-2.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
                >
                  {t("publishing.connectionCard.delete")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Add/Edit Connection Modal ─────────────────────────────────────────────

const PLATFORMS: { value: PublishingPlatform; label: string; disabled?: boolean }[] = [
  { value: "wordpress", label: "WordPress" },
  { value: "ghost", label: "Ghost (coming soon)", disabled: true },
  { value: "notion", label: "Notion (coming soon)", disabled: true },
  { value: "custom", label: "Custom (coming soon)", disabled: true },
];

function ConnectionModal({
  projectId,
  connection,
  onClose,
  onSaved,
}: {
  projectId: string;
  connection?: PublishingConnection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!connection;
  const [name, setName] = useState(connection?.name ?? "");
  const [platform, setPlatform] = useState<PublishingPlatform>(connection?.platform ?? "wordpress");
  const [siteUrl, setSiteUrl] = useState(connection?.site_url ?? "");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !siteUrl.trim()) return;
    if (!isEdit && (!username.trim() || !appPassword.trim())) return;
    setError(null);
    setSubmitting(true);

    try {
      if (isEdit) {
        const patch: Partial<Pick<PublishingConnection, "name" | "site_url" | "is_active">> = {
          name: name.trim(),
          site_url: siteUrl.trim(),
        };
        await updatePublishingConnection(connection.id, patch);
        onSaved();
      } else {
        const created = await createPublishingConnection({
          project_id: projectId,
          name: name.trim(),
          platform,
          site_url: siteUrl.trim(),
          credentials: { username: username.trim(), app_password: appPassword.trim() },
        });
        testPublishingConnection(created.id).catch(() => {});
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {isEdit ? t("publishing.connectionModal.editTitle") : t("publishing.connectionModal.addTitle")}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isEdit ? t("publishing.connectionModal.editSubtitle") : t("publishing.connectionModal.addSubtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("publishing.connectionModal.name")} <span className="text-red-500">*</span>
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My WordPress Blog"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("publishing.connectionModal.platform")} <span className="text-red-500">*</span>
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PublishingPlatform)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value} disabled={p.disabled}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("publishing.connectionModal.siteUrl")} <span className="text-red-500">*</span>
            </label>
            <input
              required
              type="url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://myblog.com"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("publishing.connectionModal.username")}{!isEdit && <span className="text-red-500"> *</span>}
              {isEdit && (
                <span className="ml-1 text-xs text-muted-foreground font-normal">
                  (leave blank to keep unchanged)
                </span>
              )}
            </label>
            <input
              required={!isEdit}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("publishing.connectionModal.usernamePlaceholder")}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("publishing.connectionModal.password")}{!isEdit && <span className="text-red-500"> *</span>}
              {isEdit && (
                <span className="ml-1 text-xs text-muted-foreground font-normal">
                  (leave blank to keep unchanged)
                </span>
              )}
            </label>
            <input
              required={!isEdit}
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("publishing.connectionModal.passwordHint")}
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {t("publishing.connectionModal.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Spinner size={14} />
                  {isEdit ? t("publishing.connectionModal.saving") : t("publishing.connectionModal.adding")}
                </>
              ) : isEdit ? (
                t("publishing.connectionModal.saveChanges")
              ) : (
                t("publishing.connectionModal.addConnection")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function PublishingPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState<PublishingConnection | null>(null);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const { data: connections = [], isLoading: connectionsLoading } = useQuery<PublishingConnection[]>({
    queryKey: ["publishing-connections", projectId],
    queryFn: () => listPublishingConnections(projectId),
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<PublishJob[]>({
    queryKey: ["publish-jobs", projectId],
    queryFn: () => listPublishJobs(projectId),
  });

  const { data: articles = [] } = useQuery({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePublishingConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publishing-connections", projectId] });
    },
  });

  function handleSaved() {
    setShowAddModal(false);
    setEditingConnection(null);
    queryClient.invalidateQueries({ queryKey: ["publishing-connections", projectId] });
    queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
  }

  function handleDelete(connection: PublishingConnection) {
    if (confirm(`Delete "${connection.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(connection.id);
    }
  }

  const articleMap = Object.fromEntries(articles.map((a) => [a.id, a]));
  const connectionMap = Object.fromEntries(connections.map((c) => [c.id, c]));

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <PageHeader
        title={t("publishing.title")}
        icon={Send}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("publishing.title") }]}
        description={t("publishing.subtitle")}
        actions={
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("publishing.addConnection")}
          </button>
        }
      />

      {/* Connections section */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {t("publishing.connections")}
        </p>

        {connectionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={28} />
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 rounded-xl border border-dashed border-border">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <LinkIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">{t("publishing.noConnections")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("publishing.noConnectionsHint")}
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              {t("publishing.addConnection")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onEdit={() => setEditingConnection(connection)}
                onDelete={() => handleDelete(connection)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Publish history section */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {t("publishing.publishHistory")}
        </p>

        {jobsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={28} />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground">{t("publishing.noJobs")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((job) => {
              const article = job.article_id ? articleMap[job.article_id] : null;
              const conn = connectionMap[job.connection_id];
              return (
                <div
                  key={job.id}
                  className="card-base p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {article?.title ?? t("publishing.job.unknownArticle")}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {conn?.name ?? t("publishing.job.unknownConnection")}
                      {job.created_at && <> &middot; {relativeTime(job.created_at)}</>}
                    </p>
                    {job.error && (
                      <p className="mt-1 text-xs text-red-500">{job.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <JobStatusBadge status={job.status} />
                    {job.published_url && (
                      <a
                        href={job.published_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {t("publishing.job.viewPost")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAddModal && (
        <ConnectionModal
          projectId={projectId}
          onClose={() => setShowAddModal(false)}
          onSaved={handleSaved}
        />
      )}
      {editingConnection && (
        <ConnectionModal
          projectId={projectId}
          connection={editingConnection}
          onClose={() => setEditingConnection(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
