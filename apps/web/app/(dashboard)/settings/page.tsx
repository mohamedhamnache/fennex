"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Building2, KeyRound, Share2, Users,
  Trash2, Plus, Eye, EyeOff, Link2, Link2Off,
  UserX, UserPlus, Copy, Check, ChevronRight,
  Shield, AtSign, Calendar, CreditCard,
} from "lucide-react";
import {
  getMe,
  listApiKeys, createApiKey, deleteApiKey, type ApiKey,
  listSocialConnections, upsertSocialConnection, deleteSocialConnection, type SocialConnection,
  listOrgMembers, inviteMember, updateMemberRole, deactivateMember, type OrgMember,
  createCheckoutSession, createPortalSession, getBillingUsage,
} from "@/lib/api";
import { useUsageStore } from "@/lib/billing-store";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

// ─── Constants ────────────────────────────────────────────────────────────────

// Dark-mode-safe: tinted backgrounds use the 500-level hue at low alpha so they
// read on both light and dark surfaces.
const PLAN_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  starter: "bg-blue-500/12 text-blue-500",
  pro: "bg-violet-500/12 text-violet-500",
  agency: "bg-amber-500/12 text-amber-600",
  enterprise: "bg-emerald-500/12 text-emerald-500",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  seo_manager: "SEO Manager",
  content_writer: "Content Writer",
  editor: "Editor",
  designer: "Designer",
  marketing_manager: "Marketing Manager",
  viewer: "Viewer",
};

const ROLE_OPTIONS = [
  "owner", "admin", "seo_manager", "content_writer",
  "editor", "designer", "marketing_manager", "viewer",
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-emerald-500/12 text-emerald-600 border-emerald-500/20",
  anthropic: "bg-orange-500/12 text-orange-600 border-orange-500/20",
  google: "bg-blue-500/12 text-blue-600 border-blue-500/20",
};

const PROVIDERS = ["openai", "anthropic", "google"] as const;

const SOCIAL_PLATFORMS = [
  { id: "twitter", label: "Twitter / X", color: "bg-black text-white", abbr: "𝕏", placeholder: "Bearer eyJ..." },
  { id: "linkedin", label: "LinkedIn", color: "bg-[#0077B5] text-white", abbr: "in", placeholder: "AQX..." },
  { id: "instagram", label: "Instagram", color: "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-white", abbr: "IG", placeholder: "EAA..." },
  { id: "facebook", label: "Facebook", color: "bg-[#1877F2] text-white", abbr: "f", placeholder: "EAA..." },
] as const;

type PlatformId = (typeof SOCIAL_PLATFORMS)[number]["id"];

const NAV_ITEMS = [
  { id: "account", label: "Account", icon: User },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "ai-keys", label: "AI Keys", icon: KeyRound },
  { id: "social", label: "Social Accounts", icon: Share2 },
  { id: "billing", label: "Billing", icon: CreditCard },
] as const;

type SectionId = (typeof NAV_ITEMS)[number]["id"];

const PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["1 project", "4 articles/month", "5 images/month", "1 seat"],
    monthlyPriceId: null,
    annualPriceId: null,
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 49,
    annualPrice: 39,
    features: ["5 projects", "20 articles/month", "50 images/month", "3 seats"],
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY ?? "",
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_ANNUAL ?? "",
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 99,
    annualPrice: 79,
    features: ["10 projects", "40 articles/month", "150 images/month", "10 seats"],
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? "",
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_ANNUAL ?? "",
  },
  {
    id: "agency",
    name: "Agency",
    monthlyPrice: 249,
    annualPrice: 199,
    features: ["100 projects", "400 articles/month", "Unlimited images", "Unlimited seats"],
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY_MONTHLY ?? "",
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY_ANNUAL ?? "",
  },
] as const;

const RESOURCE_LABELS: Record<string, string> = {
  articles: "Articles",
  images: "Images",
  social: "Social posts",
  keywords: "Keywords tracked",
  brand_voices: "Brand voices",
  audits: "Audit runs",
  backlinks: "Backlink analyses",
};

// ─── Primitives ───────────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono = false }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-4 py-3.5 border-b last:border-0">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
        <p className={`text-sm text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border bg-card ${className}`}>{children}</div>
  );
}

function PrimaryBtn({ onClick, disabled, children, className = "" }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

function GhostBtn({ onClick, disabled, children, className = "" }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-40 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

function Input({ type = "text", placeholder, value, onChange, className = "" }: {
  type?: string; placeholder?: string; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/50 transition ${className}`}
    />
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-destructive font-medium">{children}</p>;
}

function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

// ─── Account ─────────────────────────────────────────────────────────────────

function AccountSection({ me }: { me: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMe>>>>["data"] }) {
  if (!me) return null;

  const planLabel = me.plan_tier.charAt(0).toUpperCase() + me.plan_tier.slice(1);
  const planColor = PLAN_COLORS[me.plan_tier] ?? "bg-muted text-muted-foreground";

  return (
    <div>
      <SectionHeader title="Account" description="Your personal profile and membership details." />

      {/* Avatar block */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
          {initials(me.full_name)}
        </div>
        <div>
          <p className="text-base font-semibold">{me.full_name}</p>
          <p className="text-sm text-muted-foreground">{me.email}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {ROLE_LABELS[me.role] ?? me.role}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${planColor}`}>
              {planLabel}
            </span>
          </div>
        </div>
      </div>

      <Card>
        <div className="px-5">
          <InfoRow icon={User} label="Full name" value={me.full_name} />
          <InfoRow icon={AtSign} label="Email" value={me.email} />
          <InfoRow icon={Shield} label="Role" value={ROLE_LABELS[me.role] ?? me.role} />
          {me.created_at && (
            <InfoRow
              icon={Calendar}
              label="Member since"
              value={new Date(me.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Organization ─────────────────────────────────────────────────────────────

function OrganizationSection({ me }: { me: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMe>>>>["data"] }) {
  if (!me) return null;

  const planLabel = me.plan_tier.charAt(0).toUpperCase() + me.plan_tier.slice(1);
  const planColor = PLAN_COLORS[me.plan_tier] ?? "bg-muted text-muted-foreground";

  return (
    <div>
      <SectionHeader title="Organization" description="Details about your organization and current plan." />

      <Card>
        <div className="px-5">
          <InfoRow icon={Building2} label="Organization name" value={me.org_name} />
          <InfoRow icon={AtSign} label="Slug" value={me.org_slug} mono />
          <div className="flex items-start gap-4 py-3.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground mb-1">Plan</p>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${planColor}`}>
                  {planLabel}
                </span>
                {me.plan_tier === "free" && (
                  <span className="text-xs text-primary font-medium cursor-pointer hover:underline">
                    Upgrade →
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── AI Keys ─────────────────────────────────────────────────────────────────

function AIKeysSection() {
  const qc = useQueryClient();
  const { success, error } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<string>("openai");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: () => createApiKey(provider, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setValue(""); setShowForm(false);
      success(`${PROVIDER_LABELS[provider] ?? provider} key saved`);
    },
    onError: () => error("Couldn't save key", { message: "Check the value and try again." }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); success("Key removed"); },
    onError: () => error("Couldn't remove key"),
  });

  return (
    <div>
      <SectionHeader
        title="AI Keys"
        description="Add your own API keys. Fennex uses whichever providers you've connected."
      />

      {/* Provider status grid */}
      {!isLoading && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const connected = keys.some((k: ApiKey) => k.provider === p);
            return (
              <div key={p} className={`relative rounded-xl border-2 p-4 transition-all ${connected ? "border-primary/30 bg-primary/5" : "border-dashed border-border bg-card"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold ${connected ? "text-primary" : "text-muted-foreground"}`}>
                    {PROVIDER_LABELS[p]}
                  </span>
                  {connected && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                      <Check className="h-2.5 w-2.5 text-primary-foreground" />
                    </span>
                  )}
                </div>
                <p className={`text-xs ${connected ? "text-primary/70" : "text-muted-foreground/60"}`}>
                  {connected ? "Connected" : "Not connected"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Key list */}
      {!isLoading && keys.length > 0 && (
        <Card className="mb-4">
          <div className="divide-y">
            {keys.map((k: ApiKey) => (
              <div key={k.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${PROVIDER_COLORS[k.provider] ?? "bg-muted text-muted-foreground border-border"}`}>
                    {PROVIDER_LABELS[k.provider] ?? k.provider}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">{k.masked_value}</span>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(k.id)}
                  disabled={deleteMutation.isPending}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title="Remove key"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add key form */}
      {showForm ? (
        <Card className="p-5">
          <p className="text-sm font-semibold mb-4">Add API key</p>
          <div className="flex gap-2 mb-4">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-all ${
                  provider === p
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                }`}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="relative mb-3">
            <Input
              type={showValue ? "text" : "password"}
              placeholder="sk-..."
              value={value}
              onChange={setValue}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {addMutation.isError && <ErrorMsg>Failed to save key. Check the value and try again.</ErrorMsg>}
          <div className="flex gap-2 mt-4">
            <PrimaryBtn onClick={() => addMutation.mutate()} disabled={!value.trim() || addMutation.isPending}>
              {addMutation.isPending ? "Saving…" : "Save key"}
            </PrimaryBtn>
            <GhostBtn onClick={() => { setShowForm(false); setValue(""); }}>Cancel</GhostBtn>
          </div>
        </Card>
      ) : (
        <PrimaryBtn onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" /> Add key
        </PrimaryBtn>
      )}
    </div>
  );
}

// ─── Social Accounts ──────────────────────────────────────────────────────────

function SocialSection() {
  const qc = useQueryClient();
  const { success, error } = useToast();
  const [connecting, setConnecting] = useState<PlatformId | null>(null);
  const [form, setForm] = useState({ handle: "", token: "" });

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["social-connections"],
    queryFn: listSocialConnections,
    staleTime: 60_000,
  });

  const connected = new Map(connections.map((c: SocialConnection) => [c.platform, c]));

  const connectMutation = useMutation({
    mutationFn: () => upsertSocialConnection(connecting!, form.handle || null, form.token),
    onSuccess: () => {
      const label = SOCIAL_PLATFORMS.find((p) => p.id === connecting)?.label ?? "Account";
      qc.invalidateQueries({ queryKey: ["social-connections"] });
      setConnecting(null); setForm({ handle: "", token: "" });
      success(`${label} connected`);
    },
    onError: () => error("Couldn't connect", { message: "Check your token and try again." }),
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => deleteSocialConnection(platform),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["social-connections"] }); success("Account disconnected"); },
    onError: () => error("Couldn't disconnect"),
  });

  const activePlatform = SOCIAL_PLATFORMS.find((p) => p.id === connecting);

  return (
    <div>
      <SectionHeader
        title="Social Accounts"
        description="Connect your social accounts to enable direct publishing from the Social Studio."
      />

      <div className="flex flex-col gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl border animate-pulse bg-muted/30" />
          ))
        ) : (
          SOCIAL_PLATFORMS.map((p) => {
            const conn = connected.get(p.id);
            const isConnecting = connecting === p.id;

            return (
              <div key={p.id}>
                <Card className={`transition-all ${isConnecting ? "ring-2 ring-primary/30" : ""}`}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${p.color}`}>
                      {p.abbr}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{p.label}</p>
                      {conn?.handle ? (
                        <p className="text-xs text-muted-foreground">{conn.handle}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground/60">Not connected</p>
                      )}
                    </div>
                    {conn ? (
                      <div className="flex items-center gap-2">
                        <Badge tone="success" dot>Connected</Badge>
                        <button
                          onClick={() => disconnectMutation.mutate(p.id)}
                          disabled={disconnectMutation.isPending}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Disconnect"
                        >
                          <Link2Off className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConnecting(isConnecting ? null : p.id)}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {isConnecting ? "Cancel" : "Connect"}
                      </button>
                    )}
                  </div>

                  {isConnecting && activePlatform && (
                    <div className="border-t px-5 py-4 bg-muted/20 rounded-b-xl">
                      <div className="flex flex-col gap-3">
                        <Input
                          type="text"
                          placeholder="Handle (e.g. @yourcompany)"
                          value={form.handle}
                          onChange={(v) => setForm((f) => ({ ...f, handle: v }))}
                        />
                        <Input
                          type="password"
                          placeholder={activePlatform.placeholder}
                          value={form.token}
                          onChange={(v) => setForm((f) => ({ ...f, token: v }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Paste your access token from the {activePlatform.label} developer portal.
                        </p>
                        {connectMutation.isError && <ErrorMsg>Failed to connect. Check your token and try again.</ErrorMsg>}
                        <PrimaryBtn
                          onClick={() => connectMutation.mutate()}
                          disabled={!form.token.trim() || connectMutation.isPending}
                        >
                          {connectMutation.isPending ? "Connecting…" : "Connect account"}
                        </PrimaryBtn>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Team ─────────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-500/12 text-amber-600",
  admin: "bg-violet-500/12 text-violet-500",
  seo_manager: "bg-blue-500/12 text-blue-500",
  content_writer: "bg-emerald-500/12 text-emerald-500",
  editor: "bg-cyan-500/12 text-cyan-600",
  designer: "bg-pink-500/12 text-pink-500",
  marketing_manager: "bg-orange-500/12 text-orange-600",
  viewer: "bg-muted text-muted-foreground",
};

const AVATAR_COLORS = [
  "bg-violet-500/15 text-violet-500",
  "bg-blue-500/15 text-blue-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-600",
  "bg-pink-500/15 text-pink-500",
  "bg-cyan-500/15 text-cyan-600",
];

function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function TeamSection({ orgId, myId, myRole }: { orgId: string; myId: string; myRole: string }) {
  const qc = useQueryClient();
  const { success, error } = useToast();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "viewer" });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canManage = myRole === "owner" || myRole === "admin";

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => listOrgMembers(orgId),
    staleTime: 60_000,
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember(orgId, inviteForm.email, inviteForm.role),
    onSuccess: (data) => {
      setInviteLink(data.invite_link); setInviteForm({ email: "", role: "viewer" });
      success("Invite link generated");
    },
    onError: () => error("Couldn't create invite", { message: "You may not have permission, or the email is invalid." }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => updateMemberRole(orgId, userId, role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); success("Role updated"); },
    onError: () => error("Couldn't update role"),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateMember(orgId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); success("Member deactivated"); },
    onError: () => error("Couldn't deactivate member"),
  });

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Team</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.length} member{members.length !== 1 ? "s" : ""} in your organization.
          </p>
        </div>
        {canManage && (
          <PrimaryBtn onClick={() => { setShowInvite((v) => !v); setInviteLink(null); }}>
            <UserPlus className="h-3.5 w-3.5" /> Invite member
          </PrimaryBtn>
        )}
      </div>

      {/* Invite panel */}
      {showInvite && canManage && (
        <Card className="mb-5 p-5">
          {inviteLink ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15">
                  <Check className="h-4 w-4 text-success" />
                </div>
                <p className="text-sm font-semibold text-success">Invite link ready</p>
              </div>
              <p className="text-xs text-muted-foreground">Share this link with your team member. It expires in 7 days.</p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5">
                <p className="flex-1 truncate font-mono text-xs text-muted-foreground">{inviteLink}</p>
                <button onClick={copyLink} className="shrink-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">
                  {copied ? <><Check className="h-3.5 w-3.5 text-success" /><span className="text-success">Copied</span></> : <><Copy className="h-3.5 w-3.5" />Copy</>}
                </button>
              </div>
              <GhostBtn onClick={() => { setShowInvite(false); setInviteLink(null); }} className="self-start">
                Done
              </GhostBtn>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">Invite team member</p>
              <Input type="email" placeholder="colleague@company.com" value={inviteForm.email} onChange={(v) => setInviteForm((f) => ({ ...f, email: v }))} />
              <select
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/50 transition"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <PrimaryBtn onClick={() => inviteMutation.mutate()} disabled={!inviteForm.email.trim() || inviteMutation.isPending}>
                  {inviteMutation.isPending ? "Generating…" : "Generate invite link"}
                </PrimaryBtn>
                <GhostBtn onClick={() => setShowInvite(false)}>Cancel</GhostBtn>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Member list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl border animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : (
        <Card>
          <div className="divide-y">
            {members.map((m: OrgMember) => (
              <div
                key={m.id}
                className={`flex items-center gap-4 px-5 py-4 transition-opacity ${!m.is_active ? "opacity-40" : ""}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${avatarColor(m.full_name)}`}>
                  {initials(m.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{m.full_name}</p>
                    {m.id === myId && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">You</span>
                    )}
                    {!m.is_active && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && m.id !== myId ? (
                    <select
                      value={m.role}
                      onChange={(e) => roleMutation.mutate({ userId: m.id, role: e.target.value })}
                      disabled={roleMutation.isPending}
                      className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_COLORS[m.role] ?? "bg-muted text-muted-foreground"}`}>
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  )}
                  {canManage && m.id !== myId && m.is_active && (
                    <button
                      onClick={() => deactivateMutation.mutate(m.id)}
                      disabled={deactivateMutation.isPending}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Deactivate"
                    >
                      <UserX className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Billing ──────────────────────────────────────────────────────────────────

function BillingSection() {
  const [annual, setAnnual] = useState(false);
  const setUsage = useUsageStore((s) => s.setUsage);

  const { data: billing } = useQuery({
    queryKey: ["billing-usage"],
    queryFn: async () => {
      const data = await getBillingUsage();
      setUsage(data);
      return data;
    },
    refetchInterval: 60_000,
  });

  const checkoutMutation = useMutation({
    mutationFn: ({ priceId }: { priceId: string }) =>
      createCheckoutSession(
        priceId,
        `${window.location.origin}/settings?billing=success`,
        `${window.location.origin}/settings`,
      ),
    onSuccess: ({ checkout_url }) => { window.location.href = checkout_url; },
  });

  const portalMutation = useMutation({
    mutationFn: () => createPortalSession(`${window.location.origin}/settings`),
    onSuccess: ({ portal_url }) => { window.location.href = portal_url; },
  });

  const currentTier = billing?.plan_tier ?? "free";
  const tierOrder = ["free", "starter", "pro", "agency"];
  const currentIdx = tierOrder.indexOf(currentTier);

  const trialEndsAt = billing?.trial_ends_at
    ? new Date(billing.trial_ends_at)
    : null;
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Current plan card */}
      <div className="glass rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Current plan</p>
            <p className="mt-1 text-2xl font-bold capitalize">{currentTier}</p>
            {trialDaysLeft !== null && trialDaysLeft > 0 && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                Trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {currentTier !== "free" && (
            <button
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="btn-aurora px-4 py-2 text-sm"
            >
              {portalMutation.isPending ? "Opening…" : "Manage plan →"}
            </button>
          )}
        </div>
      </div>

      {/* Usage meters */}
      {billing && Object.keys(billing.usage).length > 0 && (
        <div className="glass rounded-xl p-6">
          <p className="mb-4 text-sm font-semibold">Usage this month</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(billing.usage).map(([resource, { used, limit, pct }]) => (
              <div key={resource}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">{RESOURCE_LABELS[resource] ?? resource}</span>
                  <span className={pct >= 1 ? "text-destructive" : pct >= 0.8 ? "text-warning" : "text-foreground"}>
                    {limit === -1 ? `${used} / ∞` : `${used} / ${limit}`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 1 ? "bg-destructive" : pct >= 0.8 ? "bg-warning" : "bg-primary"
                    }`}
                    style={{ width: `${Math.min(pct * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pricing table */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Plans</p>
          <div className="flex items-center gap-2 rounded-lg border border-border p-1">
            <button
              onClick={() => setAnnual(false)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${!annual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${annual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Annual <span className="text-success">−20%</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const planIdx = tierOrder.indexOf(plan.id);
            const isCurrent = plan.id === currentTier;
            const isUpgrade = planIdx > currentIdx;
            const priceId = annual ? plan.annualPriceId : plan.monthlyPriceId;

            return (
              <div
                key={plan.id}
                className={`glass rounded-xl p-5 flex flex-col gap-4 ${isCurrent ? "border-primary/50" : ""}`}
              >
                <div>
                  <p className="font-bold text-lg">{plan.name}</p>
                  <p className="mt-1 text-2xl font-bold">
                    {plan.monthlyPrice === 0 ? "Free" : (
                      <>${annual ? plan.annualPrice : plan.monthlyPrice}<span className="text-sm font-normal text-muted-foreground">/mo</span></>
                    )}
                  </p>
                </div>
                <ul className="flex flex-col gap-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button disabled className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground cursor-default">
                    Current plan
                  </button>
                ) : isUpgrade && priceId ? (
                  <button
                    onClick={() => checkoutMutation.mutate({ priceId })}
                    disabled={checkoutMutation.isPending}
                    className="btn-aurora w-full py-2 text-xs"
                  >
                    Upgrade →
                  </button>
                ) : (
                  <button
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                    className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Downgrade
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("account");

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 5 * 60_000,
  });

  const renderSection = () => {
    if (isLoading || !me) return (
      <div className="flex flex-col gap-4">
        <div className="h-6 w-32 rounded-lg bg-muted/40 animate-pulse" />
        <div className="h-48 rounded-xl border bg-muted/20 animate-pulse" />
        <div className="h-32 rounded-xl border bg-muted/20 animate-pulse" />
      </div>
    );

    switch (activeSection) {
      case "account": return <AccountSection me={me} />;
      case "organization": return <OrganizationSection me={me} />;
      case "team": return <TeamSection orgId={me.org_id} myId={me.id} myRole={me.role} />;
      case "ai-keys": return <AIKeysSection />;
      case "social": return <SocialSection />;
      case "billing": return <BillingSection />;
    }
  };

  return (
    <div className="flex h-full gap-8">
      {/* Sidebar nav */}
      <aside className="w-52 shrink-0">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
          Settings
        </p>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                <span className="flex-1 text-left">{label}</span>
                {active && <ChevronRight className="h-3.5 w-3.5 text-primary/60" />}
              </button>
            );
          })}
        </nav>

      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 max-w-2xl">
        {renderSection()}
      </main>
    </div>
  );
}
