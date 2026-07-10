"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Globe, Plus, X } from "lucide-react";
import {
  addWatchedCompetitor, listWatchedCompetitors, removeWatchedCompetitor, ApiError,
} from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const WATCHLIST_CAP = 10;

export function WatchlistCard({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  const { data: watchlist = [] } = useQuery({
    queryKey: ["watchlist", projectId],
    queryFn: () => listWatchedCompetitors(projectId),
    enabled: !!projectId,
  });

  const addMutation = useMutation({
    mutationFn: () => addWatchedCompetitor(projectId, url.trim(), label.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", projectId] });
      setUrl("");
      setLabel("");
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409)) {
        toast.error(err.message);
      } else {
        toast.error(t("common.error"));
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeWatchedCompetitor(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", projectId] });
    },
  });

  const atCap = watchlist.length >= WATCHLIST_CAP;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || atCap || addMutation.isPending) return;
    addMutation.mutate();
  }

  return (
    <Card>
      <CardHeader title={t("alertsCenter.watchlist.title")} />
      <div className="px-5 pb-2">
        <p className="text-xs text-muted-foreground">{t("alertsCenter.watchlist.hint")}</p>
      </div>

      <div className="flex flex-col gap-1 px-2.5 pb-2">
        {watchlist.length === 0 && (
          <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {t("alertsCenter.watchlist.empty")}
          </p>
        )}
        {watchlist.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Globe className="h-3.5 w-3.5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{c.label ?? c.url}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {c.last_scanned_at
                  ? new Date(c.last_scanned_at).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })
                  : "—"}
              </p>
            </div>
            <button
              onClick={() => removeMutation.mutate(c.id)}
              disabled={removeMutation.isPending}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={t("alertsCenter.watchlist.title")}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("alertsCenter.watchlist.urlPlaceholder")}
          disabled={atCap}
          className="w-full rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary/40 focus:outline-none disabled:opacity-50"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("alertsCenter.watchlist.labelPlaceholder")}
            disabled={atCap}
            className="min-w-0 flex-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary/40 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={atCap || !url.trim() || addMutation.isPending}
            className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t("alertsCenter.watchlist.add")}
          </button>
        </div>
        {atCap && (
          <p className="text-[10px] text-muted-foreground">{t("alertsCenter.watchlist.cap")}</p>
        )}
      </form>
    </Card>
  );
}
