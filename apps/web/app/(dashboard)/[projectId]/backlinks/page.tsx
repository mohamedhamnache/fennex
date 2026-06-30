"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, RefreshCw, ExternalLink, ChevronDown, ChevronUp, Send, Link2 } from "lucide-react";
import { FennecMascot } from "@fennex/ui";
import {
  getMe, getBacklinkProfile, analyzeBacklinks, listBacklinks, listOpportunities,
  updateOpportunityStatus, getExchangeBoard, getOwnListing, upsertExchangeListing,
  deleteExchangeListing, listExchangeRequests, createExchangeRequest,
  updateExchangeRequest, verifyExchangeLink, getExchangeMessages, sendExchangeMessage,
  type BacklinkProfile, type BacklinkItem, type BacklinkOpportunity,
  type ExchangeListing, type ExchangeRequest, type ExchangeMessage,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DaChip({ da }: { da: number | null }) {
  if (da === null) return <span className="text-muted-foreground text-xs">—</span>;
  const tone: BadgeTone = da >= 60 ? "success" : da >= 30 ? "warning" : "neutral";
  return <Badge tone={tone}>DA {Math.round(da)}</Badge>;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "warning",
  accepted: "info",
  live: "success",
  rejected: "danger",
  cancelled: "neutral",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

// ─── ProfileTab ───────────────────────────────────────────────────────────────

function ProfileTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery<BacklinkProfile>({
    queryKey: ["backlinks", "profile", projectId],
    queryFn: () => getBacklinkProfile(projectId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const analyze = useMutation({
    mutationFn: () => analyzeBacklinks(projectId),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["backlinks", "profile", projectId] }), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {[...Array(5)].map((_, i) => <div key={i} className="glass h-20 animate-pulse p-5" />)}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <FennecMascot />
        <p className="text-sm text-muted-foreground">{t("backlinks.noData")}</p>
        <button
          onClick={() => analyze.mutate()}
          disabled={analyze.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {analyze.isPending ? t("backlinks.syncing") : t("backlinks.analyze")}
        </button>
      </div>
    );
  }

  const stats = [
    { label: t("backlinks.stats.totalBacklinks"), value: profile.total_backlinks.toLocaleString() },
    { label: t("backlinks.stats.referringDomains"), value: profile.referring_domains.toLocaleString() },
    { label: t("backlinks.stats.domainAuthority"), value: profile.domain_authority?.toFixed(1) ?? "—" },
    { label: t("backlinks.stats.trustScore"), value: profile.trust_score?.toFixed(1) ?? "—" },
    { label: t("backlinks.stats.spamScore"), value: profile.spam_score?.toFixed(1) ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {profile.last_synced_at
            ? t("backlinks.lastSynced", { date: new Date(profile.last_synced_at).toLocaleDateString() })
            : t("backlinks.neverSynced")}
        </p>
        <button
          onClick={() => analyze.mutate()}
          disabled={analyze.isPending}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/20 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${analyze.isPending ? "animate-spin" : ""}`} />
          {analyze.isPending ? t("backlinks.syncing") : t("backlinks.reanalyze")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {stats.map(({ label, value }) => (
          <div key={label} className="glass flex flex-col gap-1 p-5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BacklinksTab ─────────────────────────────────────────────────────────────

function BacklinksTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [hideSpam, setHideSpam] = useState(true);

  const { data: rows = [], isLoading } = useQuery<BacklinkItem[]>({
    queryKey: ["backlinks", "list", projectId, page, hideSpam],
    queryFn: () => listBacklinks(projectId, page, hideSpam ? false : undefined),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={hideSpam} onChange={(e) => { setHideSpam(e.target.checked); setPage(1); }} className="rounded" />
          {t("backlinks.hideSpam")}
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <FennecMascot />
          <p className="text-sm text-muted-foreground">{t("backlinks.noBacklinks")}</p>
        </div>
      ) : (
        <div className="glass overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.sourceDomain")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.anchor")}</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.da")}</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.type")}</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bl) => (
                <tr key={bl.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs max-w-xs truncate">{bl.source_domain ?? bl.source_url}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[160px]">{bl.anchor_text ?? "—"}</td>
                  <td className="px-4 py-3"><DaChip da={bl.domain_authority} /></td>
                  <td className="px-4 py-3">
                    <Badge tone={bl.link_type === "dofollow" ? "info" : "neutral"}>{bl.link_type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {bl.is_spam && <span title="Spam"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>}
                      <a href={bl.source_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40 hover:text-foreground">{t("common.previousPage")}</button>
        <span>{t("common.page", { n: page })}</span>
        <button disabled={rows.length < 25} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40 hover:text-foreground">{t("common.nextPage")}</button>
      </div>
    </div>
  );
}

// ─── OpportunitiesTab ─────────────────────────────────────────────────────────

const OPP_STATUSES = ["new", "contacted", "won", "lost", "ignored"];
// Dark-mode-safe classes for the inline status <select> (can't use <Badge> there).
const OPP_STATUS_CLASS: Record<string, string> = {
  new: "bg-info/12 text-info",
  contacted: "bg-warning/12 text-warning",
  won: "bg-success/12 text-success",
  lost: "bg-destructive/12 text-destructive",
  ignored: "bg-muted text-muted-foreground",
};

function OpportunitiesTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<BacklinkOpportunity[]>({
    queryKey: ["backlinks", "opportunities", projectId, null],
    queryFn: () => listOpportunities(projectId),
    staleTime: 5 * 60_000,
  });

  async function handleStatusChange(id: string, status: string) {
    await updateOpportunityStatus(id, status);
    qc.invalidateQueries({ queryKey: ["backlinks", "opportunities", projectId] });
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <FennecMascot />
        <p className="text-sm text-muted-foreground">No opportunities found. Run backlink analysis first.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.domain")}</th>
            <th className="px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.da")}</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.linksTo")}</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("backlinks.tableHeaders.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((opp) => (
            <tr key={opp.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3 font-mono text-xs">{opp.source_domain ?? opp.source_url}</td>
              <td className="px-4 py-3"><DaChip da={opp.domain_authority} /></td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{opp.linking_to_competitor ?? "—"}</td>
              <td className="px-4 py-3">
                <select
                  value={opp.status}
                  onChange={(e) => handleStatusChange(opp.id, e.target.value)}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 outline-none cursor-pointer ${OPP_STATUS_CLASS[opp.status] ?? "bg-muted"}`}
                >
                  {OPP_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MessageThread ────────────────────────────────────────────────────────────

function MessageThread({ requestId, myOrgId }: { requestId: string; myOrgId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery<ExchangeMessage[]>({
    queryKey: ["backlinks", "exchange", "messages", requestId],
    queryFn: () => getExchangeMessages(requestId),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: () => sendExchangeMessage(requestId, text),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["backlinks", "exchange", "messages", requestId] });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
  });

  return (
    <div className="flex flex-col gap-3 pt-3 border-t mt-3">
      <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
        {messages.map((msg) => {
          const mine = msg.sender_org_id === myOrgId;
          return (
            <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-xs rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                {msg.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); send.mutate(); } }}
          placeholder="Type a message…"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={() => send.mutate()}
          disabled={!text.trim() || send.isPending}
          className="rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── RequestCard ──────────────────────────────────────────────────────────────

function RequestCard({ req, myOrgId, projectId }: { req: ExchangeRequest; myOrgId: string; projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const isSender = req.requester_project_id === projectId;
  const counterpart = isSender ? req.target_project_id : req.requester_project_id;

  async function handleStatus(status: string) {
    await updateExchangeRequest(req.id, status);
    qc.invalidateQueries({ queryKey: ["backlinks", "exchange", "requests"] });
  }

  async function handleVerify(side: "requester" | "target") {
    await verifyExchangeLink(req.id, side);
    qc.invalidateQueries({ queryKey: ["backlinks", "exchange", "requests"] });
  }

  return (
    <div className="glass flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Project {counterpart.slice(0, 8)}…</p>
          <p className="text-xs text-muted-foreground">{isSender ? t("backlinks.requests.sent") : t("backlinks.requests.received")}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={req.status} />
          <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Verification row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className={`flex items-center gap-1 ${req.requester_link_verified ? "text-success" : ""}`}>
          {req.requester_link_verified ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {t("backlinks.requests.requesterLink")}
          {!req.requester_link_verified && isSender && (
            <button onClick={() => handleVerify("requester")} className="ml-1 underline hover:text-foreground">{t("backlinks.requests.verify")}</button>
          )}
        </span>
        <span className={`flex items-center gap-1 ${req.target_link_verified ? "text-success" : ""}`}>
          {req.target_link_verified ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {t("backlinks.requests.targetLink")}
          {!req.target_link_verified && !isSender && (
            <button onClick={() => handleVerify("target")} className="ml-1 underline hover:text-foreground">{t("backlinks.requests.verify")}</button>
          )}
        </span>
      </div>

      {/* Actions for received requests in pending */}
      {!isSender && req.status === "pending" && (
        <div className="flex gap-2">
          <button onClick={() => handleStatus("accepted")} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">{t("backlinks.requests.accept")}</button>
          <button onClick={() => handleStatus("rejected")} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted/20">{t("backlinks.requests.reject")}</button>
        </div>
      )}
      {isSender && req.status === "pending" && (
        <button onClick={() => handleStatus("cancelled")} className="w-fit rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted/20">{t("backlinks.requests.cancel")}</button>
      )}

      {open && <MessageThread requestId={req.id} myOrgId={myOrgId} />}
    </div>
  );
}

// ─── ExchangeTab ──────────────────────────────────────────────────────────────

function ExchangeTab({ projectId, orgId }: { projectId: string; orgId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "requests">("board");
  const [reqRole, setReqRole] = useState<"sent" | "received">("sent");
  const [listingForm, setListingForm] = useState({ site_url: "", niche: "", language: "", description: "" });
  const [requestForm, setRequestForm] = useState<{ targetProjectId: string; requesterUrl: string; targetUrl: string; message: string; open: boolean }>({ targetProjectId: "", requesterUrl: "", targetUrl: "", message: "", open: false });

  const { data: listing } = useQuery<ExchangeListing>({
    queryKey: ["backlinks", "exchange", "listing", projectId],
    queryFn: () => getOwnListing(projectId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (listing) {
      setListingForm({
        site_url: listing.site_url ?? '',
        niche: listing.niche ?? '',
        language: listing.language ?? '',
        description: listing.description ?? '',
      });
    }
  }, [listing]);

  const { data: board = [] } = useQuery<ExchangeListing[]>({
    queryKey: ["backlinks", "exchange", "board", null, null],
    queryFn: () => getExchangeBoard(projectId),
    staleTime: 2 * 60_000,
    enabled: view === "board",
  });

  const { data: requests = [] } = useQuery<ExchangeRequest[]>({
    queryKey: ["backlinks", "exchange", "requests", projectId, reqRole],
    queryFn: () => listExchangeRequests(projectId, reqRole),
    staleTime: 30_000,
    enabled: view === "requests",
  });

  async function saveListing() {
    try {
      await upsertExchangeListing(projectId, {
        site_url: listingForm.site_url,
        niche: listingForm.niche || undefined,
        language: listingForm.language || undefined,
        description: listingForm.description || undefined,
      });
      qc.invalidateQueries({ queryKey: ["backlinks", "exchange", "listing", projectId] });
    } catch (e) {
      console.error('Failed to save listing', e);
    }
  }

  async function sendRequest() {
    try {
      await createExchangeRequest(projectId, {
        target_project_id: requestForm.targetProjectId,
        requester_url: requestForm.requesterUrl,
        target_url: requestForm.targetUrl,
        initial_message: requestForm.message || undefined,
      });
      setRequestForm(f => ({ ...f, open: false }));
      qc.invalidateQueries({ queryKey: ["backlinks", "exchange"] });
    } catch (e) {
      console.error('Failed to send exchange request', e);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Listing panel */}
      <div className="glass p-5">
        <h3 className="text-sm font-medium mb-4">{listing ? t("backlinks.exchange.yourListing") : t("backlinks.exchange.listYourSite")}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            placeholder={t("backlinks.exchange.siteUrl")}
            value={listingForm.site_url}
            onChange={(e) => setListingForm(f => ({ ...f, site_url: e.target.value }))}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            placeholder={t("backlinks.exchange.niche")}
            value={listingForm.niche}
            onChange={(e) => setListingForm(f => ({ ...f, niche: e.target.value }))}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            placeholder={t("backlinks.exchange.language")}
            value={listingForm.language}
            onChange={(e) => setListingForm(f => ({ ...f, language: e.target.value }))}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            placeholder={t("backlinks.exchange.description")}
            value={listingForm.description}
            onChange={(e) => setListingForm(f => ({ ...f, description: e.target.value }))}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={saveListing} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            {listing ? t("backlinks.exchange.save") : t("backlinks.exchange.listMySite")}
          </button>
          {listing && (
            <button
              onClick={async () => { await deleteExchangeListing(projectId); qc.invalidateQueries({ queryKey: ["backlinks", "exchange", "listing", projectId] }); }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/20"
            >
              {t("backlinks.exchange.deactivate")}
            </button>
          )}
        </div>
      </div>

      {/* Board / Requests toggle */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {(["board", "requests"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {v === "board" ? t("backlinks.exchange.board") : t("backlinks.exchange.myRequests")}
          </button>
        ))}
      </div>

      {/* Board */}
      {view === "board" && (
        <div className="flex flex-col gap-3">
          {board.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("backlinks.exchange.noListings")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {board.map((item) => (
                <div key={item.id} className="glass flex flex-col gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium truncate">{item.site_url}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {item.niche && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{item.niche}</span>}
                      {item.language && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{item.language}</span>}
                      <DaChip da={item.domain_authority} />
                    </div>
                    {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>}
                  </div>
                  {requestForm.open && requestForm.targetProjectId === item.project_id ? (
                    <div className="flex flex-col gap-2">
                      <input placeholder={t("backlinks.exchange.yourLinkUrl")} value={requestForm.requesterUrl} onChange={(e) => setRequestForm(f => ({ ...f, requesterUrl: e.target.value }))} className="rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring" />
                      <input placeholder={t("backlinks.exchange.theirLinkUrl")} value={requestForm.targetUrl} onChange={(e) => setRequestForm(f => ({ ...f, targetUrl: e.target.value }))} className="rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring" />
                      <input placeholder={t("backlinks.exchange.message")} value={requestForm.message} onChange={(e) => setRequestForm(f => ({ ...f, message: e.target.value }))} className="rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring" />
                      <div className="flex gap-2">
                        <button onClick={sendRequest} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">{t("backlinks.exchange.send")}</button>
                        <button onClick={() => setRequestForm(f => ({ ...f, open: false }))} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted/20">{t("backlinks.exchange.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRequestForm({ targetProjectId: item.project_id, requesterUrl: "", targetUrl: "", message: "", open: true })}
                      className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/20"
                    >
                      {t("backlinks.exchange.requestExchange")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Requests */}
      {view === "requests" && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
            {(["sent", "received"] as const).map((r) => (
              <button key={r} onClick={() => setReqRole(r)} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${reqRole === r ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {r === "sent" ? t("backlinks.requests.sent") : t("backlinks.requests.received")}
              </button>
            ))}
          </div>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("backlinks.requests.noRequests", { role: reqRole })}</p>
          ) : (
            requests.map((req) => <RequestCard key={req.id} req={req} myOrgId={orgId} projectId={projectId} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "profile" | "backlinks" | "opportunities" | "exchange";

export default function BacklinksPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  // Fetch the current user's org_id for message thread alignment
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "profile", label: t("backlinks.tabs.profile") },
    { key: "backlinks", label: t("backlinks.tabs.backlinks") },
    { key: "opportunities", label: t("backlinks.tabs.opportunities") },
    { key: "exchange", label: t("backlinks.tabs.exchange") },
  ];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <PageHeader
        title={t("backlinks.title")}
        icon={Link2}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("backlinks.title") }]}
        description={t("backlinks.subtitle")}
      />
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === tab.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <ProfileTab projectId={projectId} />}
      {activeTab === "backlinks" && <BacklinksTab projectId={projectId} />}
      {activeTab === "opportunities" && <OpportunitiesTab projectId={projectId} />}
      {activeTab === "exchange" && <ExchangeTab projectId={projectId} orgId={me?.org_id ?? ""} />}
    </div>
  );
}
