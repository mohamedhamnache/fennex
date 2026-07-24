"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, BookOpen, FileText, Loader2, Plus, Trash2, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  addNote, deleteKnowledge, listKnowledge, uploadKnowledge, type KnowledgeDoc,
} from "@/lib/knowledge";

/** What the agency knows about this project.
 *
 *  Anything added here is read once, summarised into a standing brief every
 *  employee carries, and searched on demand — so a large library does not make
 *  every conversation more expensive. */
export function KnowledgePanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["knowledge", projectId],
    queryFn: () => listKnowledge(projectId),
    staleTime: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });

  const save = useMutation({
    mutationFn: () => addNote({ project_id: projectId, title, body }),
    onSuccess: () => {
      setTitle(""); setBody(""); setAdding(false); setError(null); refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t("knowledge.saveFailed")),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadKnowledge(projectId, file),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : t("knowledge.saveFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteKnowledge(id),
    onSuccess: refresh,
  });

  const documents = data?.documents ?? [];
  const busy = save.isPending || upload.isPending;

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <BookOpen className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-foreground">
            {t("knowledge.title")}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t("knowledge.subtitle")}</p>
        </div>
        {data && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t("knowledge.count", {
              docs: data.stats.documents, words: data.stats.words,
            })}
          </span>
        )}
      </header>

      {/* The standing brief: what every employee already knows. */}
      {data?.digest && (
        <div className="border-b border-border bg-primary/[0.04] px-5 py-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {t("knowledge.digestTitle")}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{data.digest}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          disabled={busy}
          className="btn-primary flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {t("knowledge.addNote")}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {upload.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Upload className="h-3 w-3" />}
          {t("knowledge.upload")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.markdown,.csv,.json,.html,.htm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
        <p className="text-[10px] text-muted-foreground">{t("knowledge.formats")}</p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 border-b border-border bg-destructive/10 px-5 py-2.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      )}

      {adding && (
        <div className="border-b border-border bg-muted/30 px-5 py-4 animate-slide-up">
          <label className="block text-[10px] font-semibold text-muted-foreground" htmlFor="k-title">
            {t("knowledge.noteTitle")}
          </label>
          <input
            id="k-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("knowledge.noteTitlePlaceholder")}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <label className="mt-2.5 block text-[10px] font-semibold text-muted-foreground" htmlFor="k-body">
            {t("knowledge.noteBody")}
          </label>
          <textarea
            id="k-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("knowledge.noteBodyPlaceholder")}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!title.trim() || !body.trim() || save.isPending}
            className="btn-primary mt-3 flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("knowledge.save")}
          </button>
        </div>
      )}

      {isLoading && (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {t("knowledge.loading")}
        </p>
      )}

      {!isLoading && documents.length === 0 && (
        <p className="px-5 py-8 text-center text-xs leading-relaxed text-muted-foreground">
          {t("knowledge.empty")}
        </p>
      )}

      <div className="divide-y divide-border">
        {documents.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} onDelete={() => remove.mutate(doc.id)} />
        ))}
      </div>
    </section>
  );
}

function DocumentRow({ doc, onDelete }: { doc: KnowledgeDoc; onDelete: () => void }) {
  const { t } = useTranslation();
  const failed = doc.status === "failed";
  const unindexed = doc.status === "no_vectors";

  return (
    <div className="group flex items-start gap-3 px-5 py-3">
      <span className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        failed ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground",
      )}>
        <FileText className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{doc.title}</p>
        <p className="text-[10px] text-muted-foreground">
          {t("knowledge.meta", { words: doc.wordCount, chunks: doc.chunkCount })}
          {unindexed && ` · ${t("knowledge.noVectors")}`}
        </p>
        {failed && doc.error && (
          <p className="mt-1 text-[10px] text-destructive">{doc.error}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("knowledge.remove")}
        className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
