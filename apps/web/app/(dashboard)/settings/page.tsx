"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { LanguagePicker } from "@/components/layout/LanguagePicker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User, Building2, KeyRound, Share2, Users,
  Trash2, Plus, Eye, EyeOff, Link2, Link2Off,
  UserX, UserPlus, Copy, Check, ChevronRight,
  Shield, AtSign, Calendar, CreditCard, Palette, Globe,
  Sun, Moon, Monitor, Search, Brush, Settings as SettingsIcon,
  FileText, Image as ImageIcon, Gauge, Mic2, Sparkles, Star,
  type LucideIcon,
} from "lucide-react";
import {
  getMe,
  listApiKeys, createApiKey, deleteApiKey, type ApiKey,
  listSocialConnections, upsertSocialConnection, deleteSocialConnection, type SocialConnection,
  listOrgMembers, inviteMember, updateMemberRole, deactivateMember, type OrgMember,
  createCheckoutSession, createPortalSession, getBillingUsage,
  listProjects, updateProject, type ProjectPersona,
} from "@/lib/api";
import { BrandKitSection } from "@/components/settings/BrandKitSection";
import { applyPalette, isCustomTheme } from "@/lib/palette";
import { useProjectStore } from "@/lib/store";
import { useUsageStore } from "@/lib/billing-store";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ProviderLogo } from "@/components/ui/ProviderLogo";

// ─── Constants ────────────────────────────────────────────────────────────────

// Dark-mode-safe: tinted backgrounds use the 500-level hue at low alpha so they
// read on both light and dark surfaces.
const PLAN_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  starter: "bg-teal-500/12 text-teal-500",
  pro: "bg-amber-500/12 text-amber-500",
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
  google: "bg-teal-500/12 text-teal-600 border-teal-500/20",
};

const PROVIDERS = ["openai", "anthropic", "google"] as const;

const SOCIAL_PLATFORMS = [
  { id: "twitter", label: "Twitter / X", color: "bg-black text-white", abbr: "𝕏", placeholder: "Bearer eyJ..." },
  { id: "linkedin", label: "LinkedIn", color: "bg-[#0077B5] text-white", abbr: "in", placeholder: "AQX..." },
  { id: "instagram", label: "Instagram", color: "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-white", abbr: "IG", placeholder: "EAA..." },
  { id: "facebook", label: "Facebook", color: "bg-[#1877F2] text-white", abbr: "f", placeholder: "EAA..." },
] as const;

type PlatformId = (typeof SOCIAL_PLATFORMS)[number]["id"];

// Grouped nav. `navKey` maps to settings.nav.<navKey>; `tone` colors the icon chip.
const NAV_ITEMS = [
  { id: "account", navKey: "account", icon: User, group: "account", tone: "bg-primary/12 text-primary" },
  { id: "appearance", navKey: "appearance", icon: Palette, group: "account", tone: "bg-violet-500/12 text-violet-500" },
  { id: "organization", navKey: "organization", icon: Building2, group: "account", tone: "bg-sky-500/12 text-sky-500" },
  { id: "billing", navKey: "billing", icon: CreditCard, group: "account", tone: "bg-emerald-500/12 text-emerald-500" },
  { id: "project", navKey: "project", icon: Globe, group: "workspace", tone: "bg-primary/12 text-primary" },
  { id: "team", navKey: "team", icon: Users, group: "workspace", tone: "bg-amber-500/12 text-amber-500" },
  { id: "brand-kit", navKey: "brandKit", icon: Brush, group: "workspace", tone: "bg-rose-500/12 text-rose-500" },
  { id: "ai-keys", navKey: "aiKeys", icon: KeyRound, group: "workspace", tone: "bg-sky-500/12 text-sky-500" },
  { id: "social", navKey: "social", icon: Share2, group: "workspace", tone: "bg-violet-500/12 text-violet-500" },
] as const;

const NAV_GROUPS = ["account", "workspace"] as const;

const PROJECT_LANGS = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
] as const;

const PROJECT_PERSONAS: ProjectPersona[] = ["creator", "ecommerce", "freelancer"];

type SectionId = (typeof NAV_ITEMS)[number]["id"];

const PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["1 project", "4 articles/month", "5 images/month", "1 seat"],
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 49,
    annualPrice: 39,
    features: ["5 projects", "20 articles/month", "50 images/month", "3 seats"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 99,
    annualPrice: 79,
    features: ["10 projects", "40 articles/month", "150 images/month", "10 seats"],
  },
  {
    id: "agency",
    name: "Agency",
    monthlyPrice: 249,
    annualPrice: 199,
    features: ["100 projects", "400 articles/month", "Unlimited images", "Unlimited seats"],
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

const RESOURCE_ICON: Record<string, LucideIcon> = {
  articles: FileText,
  images: ImageIcon,
  social: Share2,
  keywords: Search,
  brand_voices: Mic2,
  audits: Gauge,
  backlinks: Link2,
};

// ─── Primitives ───────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, description }: { icon?: LucideIcon; title: string; description?: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
      )}
      <div className="min-w-0">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
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
    <div className={`rounded-2xl border border-border bg-card/60 backdrop-blur-sm ${className}`}>{children}</div>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

const SELECT_CLS =
  "w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/50 transition";

function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

// ─── Account ─────────────────────────────────────────────────────────────────

function AccountSection({ me }: { me: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMe>>>>["data"] }) {
  const { t } = useTranslation();
  if (!me) return null;

  const planLabel = me.plan_tier.charAt(0).toUpperCase() + me.plan_tier.slice(1);
  const planColor = PLAN_COLORS[me.plan_tier] ?? "bg-muted text-muted-foreground";

  return (
    <div>
      <SectionHeader icon={User} title={t("settings.account.title")} description={t("settings.account.subtitle")} />

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
          <InfoRow icon={User} label={t("settings.account.fullName")} value={me.full_name} />
          <InfoRow icon={AtSign} label={t("settings.account.email")} value={me.email} />
          <InfoRow icon={Shield} label={t("settings.account.role")} value={ROLE_LABELS[me.role] ?? me.role} />
          {me.created_at && (
            <InfoRow
              icon={Calendar}
              label={t("settings.account.memberSince")}
              value={new Date(me.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            />
          )}
          <div className="flex items-center justify-between py-3 border-t border-border">
            <div>
              <p className="text-sm font-medium">{t("settings.language")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.languageDescription")}</p>
            </div>
            <LanguagePicker showLabel />
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Organization ─────────────────────────────────────────────────────────────

function OrganizationSection({ me }: { me: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMe>>>>["data"] }) {
  const { t } = useTranslation();
  if (!me) return null;

  const planLabel = me.plan_tier.charAt(0).toUpperCase() + me.plan_tier.slice(1);
  const planColor = PLAN_COLORS[me.plan_tier] ?? "bg-muted text-muted-foreground";

  return (
    <div>
      <SectionHeader icon={Building2} title={t("settings.organization.title")} description={t("settings.organization.subtitle")} />

      <Card>
        <div className="px-5">
          <InfoRow icon={Building2} label={t("settings.organization.name")} value={me.org_name} />
          <InfoRow icon={AtSign} label={t("settings.organization.slug")} value={me.org_slug} mono />
          <div className="flex items-start gap-4 py-3.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground mb-1">{t("settings.organization.plan")}</p>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${planColor}`}>
                  {planLabel}
                </span>
                {me.plan_tier === "free" && (
                  <span className="text-xs text-primary font-medium cursor-pointer hover:underline">
                    {t("settings.organization.upgrade")}
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
  const { t } = useTranslation();
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

  const [showSeoForm, setShowSeoForm] = useState(false);
  const [seoLogin, setSeoLogin] = useState("");
  const [seoPassword, setSeoPassword] = useState("");
  const [showSeoPassword, setShowSeoPassword] = useState(false);

  const seoKey = keys.find((k: ApiKey) => k.provider === "dataforseo");

  const addSeoMutation = useMutation({
    mutationFn: () => createApiKey("dataforseo", `${seoLogin}:${seoPassword}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setSeoLogin(""); setSeoPassword(""); setShowSeoForm(false);
      success(t("settings.seoData.connected"));
    },
    onError: () => error("Couldn't save key", { message: "Check the value and try again." }),
  });

  const deleteSeoMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); success("Key removed"); },
    onError: () => error("Couldn't remove key"),
  });

  return (
    <div>
      <SectionHeader
        title={t("settings.aiKeys.title")}
        description={t("settings.aiKeys.subtitle")}
      />

      {/* Provider status grid */}
      {!isLoading && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const connected = keys.some((k: ApiKey) => k.provider === p);
            return (
              <div key={p} className={`relative rounded-xl border-2 p-4 transition-all ${connected ? "border-primary/30 bg-primary/5" : "border-dashed border-border bg-card"}`}>
                <div className="flex items-start justify-between mb-3">
                  <ProviderLogo provider={p} size={28} />
                  {connected && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                      <Check className="h-2.5 w-2.5 text-primary-foreground" />
                    </span>
                  )}
                </div>
                <p className={`text-xs font-semibold mb-0.5 ${connected ? "text-primary" : "text-muted-foreground"}`}>
                  {PROVIDER_LABELS[p]}
                </p>
                <p className={`text-xs ${connected ? "text-primary/70" : "text-muted-foreground/60"}`}>
                  {connected ? t("settings.aiKeys.connected") : t("settings.aiKeys.notConnected")}
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
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${PROVIDER_COLORS[k.provider] ?? "bg-muted text-muted-foreground border-border"}`}>
                    <ProviderLogo provider={k.provider as "openai" | "anthropic" | "google"} size={14} />
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
          <p className="text-sm font-semibold mb-4">{t("settings.aiKeys.addKey")}</p>
          <div className="flex gap-2 mb-4">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  provider === p
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                }`}
              >
                <ProviderLogo provider={p} size={14} />
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
          {addMutation.isError && <ErrorMsg>{t("settings.aiKeys.saveError")}</ErrorMsg>}
          <div className="flex gap-2 mt-4">
            <PrimaryBtn onClick={() => addMutation.mutate()} disabled={!value.trim() || addMutation.isPending}>
              {addMutation.isPending ? t("settings.aiKeys.saving") : t("settings.aiKeys.saveKey")}
            </PrimaryBtn>
            <GhostBtn onClick={() => { setShowForm(false); setValue(""); }}>{t("common.cancel")}</GhostBtn>
          </div>
        </Card>
      ) : (
        <PrimaryBtn onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" /> {t("settings.aiKeys.addKeyAction")}
        </PrimaryBtn>
      )}

      {/* SEO data (DataForSEO) */}
      <div className="mt-8">
        <SectionHeader
          title={t("settings.seoData.title")}
          description={t("settings.seoData.hint")}
        />
        {seoKey ? (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                  <Check className="h-2.5 w-2.5 text-primary-foreground" />
                </span>
                <span className="text-sm font-semibold text-primary">{t("settings.seoData.connected")}</span>
                <span className="font-mono text-sm text-muted-foreground">{seoKey.masked_value}</span>
              </div>
              <button
                onClick={() => deleteSeoMutation.mutate(seoKey.id)}
                disabled={deleteSeoMutation.isPending}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                title={t("settings.seoData.remove")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </Card>
        ) : showSeoForm ? (
          <Card className="p-5">
            <div className="mb-3">
              <Input
                placeholder={t("settings.seoData.login")}
                value={seoLogin}
                onChange={setSeoLogin}
              />
            </div>
            <div className="relative mb-3">
              <Input
                type={showSeoPassword ? "text" : "password"}
                placeholder={t("settings.seoData.password")}
                value={seoPassword}
                onChange={setSeoPassword}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSeoPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSeoPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {addSeoMutation.isError && <ErrorMsg>{t("settings.aiKeys.saveError")}</ErrorMsg>}
            <div className="flex gap-2 mt-4">
              <PrimaryBtn
                onClick={() => addSeoMutation.mutate()}
                disabled={!seoLogin.trim() || !seoPassword.trim() || addSeoMutation.isPending}
              >
                {addSeoMutation.isPending ? t("settings.aiKeys.saving") : t("settings.seoData.connect")}
              </PrimaryBtn>
              <GhostBtn onClick={() => { setShowSeoForm(false); setSeoLogin(""); setSeoPassword(""); }}>
                {t("common.cancel")}
              </GhostBtn>
            </div>
          </Card>
        ) : (
          <PrimaryBtn onClick={() => setShowSeoForm(true)}>
            <Plus className="h-3.5 w-3.5" /> {t("settings.seoData.connect")}
          </PrimaryBtn>
        )}
      </div>
    </div>
  );
}

// ─── Social Accounts ──────────────────────────────────────────────────────────

function SocialSection() {
  const { t } = useTranslation();
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
        title={t("settings.socialAccounts.title")}
        description={t("settings.socialAccounts.subtitle")}
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
                        <p className="text-xs text-muted-foreground/60">{t("settings.socialAccounts.notConnected")}</p>
                      )}
                    </div>
                    {conn ? (
                      <div className="flex items-center gap-2">
                        <Badge tone="success" dot>{t("settings.aiKeys.connected")}</Badge>
                        <button
                          onClick={() => disconnectMutation.mutate(p.id)}
                          disabled={disconnectMutation.isPending}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title={t("settings.socialAccounts.disconnect")}
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
                        {isConnecting ? t("settings.socialAccounts.cancel") : t("settings.socialAccounts.connect")}
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
                          {t("settings.socialAccounts.tokenHint", { platform: activePlatform.label })}
                        </p>
                        {connectMutation.isError && <ErrorMsg>{t("settings.socialAccounts.connectError")}</ErrorMsg>}
                        <PrimaryBtn
                          onClick={() => connectMutation.mutate()}
                          disabled={!form.token.trim() || connectMutation.isPending}
                        >
                          {connectMutation.isPending ? t("settings.socialAccounts.connecting") : t("settings.socialAccounts.connectAccount")}
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
  admin: "bg-amber-500/12 text-amber-500",
  seo_manager: "bg-teal-500/12 text-teal-500",
  content_writer: "bg-emerald-500/12 text-emerald-500",
  editor: "bg-teal-500/12 text-teal-600",
  designer: "bg-pink-500/12 text-pink-500",
  marketing_manager: "bg-orange-500/12 text-orange-600",
  viewer: "bg-muted text-muted-foreground",
};

const AVATAR_COLORS = [
  "bg-amber-500/15 text-amber-500",
  "bg-teal-500/15 text-teal-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-600",
  "bg-pink-500/15 text-pink-500",
  "bg-teal-500/15 text-teal-600",
];

function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function TeamSection({ orgId, myId, myRole }: { orgId: string; myId: string; myRole: string }) {
  const { t } = useTranslation();
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
          <h2 className="text-base font-semibold text-foreground">{t("settings.team.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.team.memberCount", { n: members.length })}
          </p>
        </div>
        {canManage && (
          <PrimaryBtn onClick={() => { setShowInvite((v) => !v); setInviteLink(null); }}>
            <UserPlus className="h-3.5 w-3.5" /> {t("settings.team.invite")}
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
                <p className="text-sm font-semibold text-success">{t("settings.team.linkReady")}</p>
              </div>
              <p className="text-xs text-muted-foreground">{t("settings.team.linkHint")}</p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5">
                <p className="flex-1 truncate font-mono text-xs text-muted-foreground">{inviteLink}</p>
                <button onClick={copyLink} className="shrink-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">
                  {copied ? <><Check className="h-3.5 w-3.5 text-success" /><span className="text-success">{t("settings.team.copied")}</span></> : <><Copy className="h-3.5 w-3.5" />{t("settings.team.copy")}</>}
                </button>
              </div>
              <GhostBtn onClick={() => { setShowInvite(false); setInviteLink(null); }} className="self-start">
                {t("settings.team.done")}
              </GhostBtn>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">{t("settings.team.inviteTitle")}</p>
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
                  {inviteMutation.isPending ? t("settings.team.generating") : t("settings.team.generateLink")}
                </PrimaryBtn>
                <GhostBtn onClick={() => setShowInvite(false)}>{t("settings.team.cancel")}</GhostBtn>
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
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("settings.team.you")}</span>
                    )}
                    {!m.is_active && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t("settings.team.inactive")}</span>
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
                      title={t("settings.team.deactivate")}
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
  const { t } = useTranslation();
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
    mutationFn: ({ tier, annual }: { tier: string; annual: boolean }) =>
      createCheckoutSession(
        tier,
        annual,
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
    <div className="flex flex-col gap-6">
      <SectionHeader icon={CreditCard} title={t("settings.billing.title")} description={t("settings.billing.subtitle")} />

      {/* Current plan hero */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card/60 p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(560px 200px at 10% -30%, hsl(var(--primary) / 0.18), transparent 60%), radial-gradient(420px 160px at 100% 120%, hsl(var(--primary-accent) / 0.12), transparent 60%)" }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl gradient-brand text-white glow-primary">
              <Sparkles className="h-6 w-6" strokeWidth={1.9} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t("settings.billing.currentPlan")}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
                <p className="font-display text-3xl font-bold capitalize leading-none text-foreground">{currentTier}</p>
                {trialDaysLeft !== null && trialDaysLeft > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2.5 py-0.5 text-xs font-medium text-warning">
                    {t("settings.billing.trialEnds", { n: trialDaysLeft })}
                  </span>
                )}
              </div>
            </div>
          </div>
          {currentTier !== "free" && (
            <button
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="btn-primary px-4 py-2 text-sm"
            >
              {portalMutation.isPending ? t("settings.billing.opening") : t("settings.billing.managePlan")}
            </button>
          )}
        </div>
      </div>

      {/* Usage meters */}
      {billing && Object.keys(billing.usage).length > 0 && (
        <Card className="p-5">
          <p className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary"><Gauge className="h-3.5 w-3.5" strokeWidth={2} /></span>
            {t("settings.billing.usageThisMonth")}
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {Object.entries(billing.usage).map(([resource, { used, limit, pct }]) => {
              const RIcon = RESOURCE_ICON[resource] ?? Sparkles;
              const over = pct >= 1;
              const near = pct >= 0.8 && pct < 1;
              return (
                <div key={resource} className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${over ? "bg-destructive/12 text-destructive" : near ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground"}`}>
                    <RIcon className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-muted-foreground">{t(`settings.billing.resources.${resource}`) || RESOURCE_LABELS[resource] || resource}</span>
                      <span className={`shrink-0 font-medium tabular-nums ${over ? "text-destructive" : near ? "text-warning" : "text-foreground"}`}>
                        {limit === -1 ? `${used} / ∞` : `${used} / ${limit}`}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${over ? "bg-destructive" : near ? "bg-warning" : "gradient-brand"}`}
                        style={{ width: `${Math.max(Math.min(pct * 100, 100), pct > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Pricing table */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">{t("settings.billing.plans")}</p>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
            <button
              onClick={() => setAnnual(false)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${!annual ? "bg-card text-primary shadow-sm ring-1 ring-inset ring-primary/15" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("settings.billing.monthly")}
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${annual ? "bg-card text-primary shadow-sm ring-1 ring-inset ring-primary/15" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("settings.billing.annual")}
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">{t("settings.billing.annualDiscount")}</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const planIdx = tierOrder.indexOf(plan.id);
            const isCurrent = plan.id === currentTier;
            const isUpgrade = planIdx > currentIdx;
            const popular = plan.id === "pro";

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col gap-4 rounded-2xl border p-5 transition-all ${
                  isCurrent
                    ? "border-primary bg-primary/[0.04] ring-1 ring-inset ring-primary/20"
                    : popular
                      ? "border-primary/40 bg-card/60 hover:-translate-y-0.5 hover:shadow-lg"
                      : "border-border bg-card/60 hover:-translate-y-0.5 hover:border-primary/25"
                }`}
              >
                {popular && !isCurrent && (
                  <span className="absolute -top-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full gradient-brand px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                    <Star className="h-2.5 w-2.5 fill-current" /> {t("settings.billing.popular")}
                  </span>
                )}
                <div>
                  <p className="font-display text-lg font-bold text-foreground">{plan.name}</p>
                  <p className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
                    {plan.monthlyPrice === 0 ? t("settings.billing.free") : (
                      <>${annual ? plan.annualPrice : plan.monthlyPrice}<span className="text-sm font-normal text-muted-foreground">{t("settings.billing.perMonth")}</span></>
                    )}
                  </p>
                  {annual && plan.monthlyPrice > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("settings.billing.billedAnnually")}</p>
                  )}
                </div>
                <ul className="flex flex-1 flex-col gap-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-foreground/80">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.4} />
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <span className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-2 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
                    <Check className="h-3.5 w-3.5" /> {t("settings.billing.currentPlan")}
                  </span>
                ) : isUpgrade ? (
                  <button
                    onClick={() => checkoutMutation.mutate({ tier: plan.id, annual })}
                    disabled={checkoutMutation.isPending}
                    className="btn-primary w-full py-2 text-xs"
                  >
                    {t("settings.billing.upgrade")}
                  </button>
                ) : (
                  <button
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                    className="w-full rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t("settings.billing.downgrade")}
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

// ─── Project ──────────────────────────────────────────────────────────────────

const PALETTES: { id: string; label: string; color: string }[] = [
  { id: "desert", label: "Desert", color: "#b5522f" },
  { id: "indigo", label: "Indigo", color: "#5a54d6" },
  { id: "teal", label: "Teal", color: "#268a8a" },
  { id: "forest", label: "Forest", color: "#3a8354" },
  { id: "amber", label: "Amber", color: "#d68a1e" },
  { id: "rose", label: "Rose", color: "#c94f74" },
  { id: "plum", label: "Plum", color: "#8b57c0" },
];

function ProjectSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { success, error } = useToast();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 5 * 60_000,
  });

  const [editId, setEditId] = useState<string | null>(null);
  const active = projects.find((p) => p.id === (editId ?? currentProjectId)) ?? projects[0];

  const [form, setForm] = useState({
    name: "", domain: "", locale: "en", target_country: "", industry: "", persona: "" as ProjectPersona | "",
    autopilot_enabled: false, theme: "desert",
  });

  // Re-seed the form whenever the selected project changes.
  useEffect(() => {
    if (active) {
      setForm({
        name: active.name ?? "",
        domain: active.domain ?? "",
        locale: active.locale ?? "en",
        target_country: active.target_country ?? "",
        industry: active.industry ?? "",
        persona: active.persona ?? "",
        autopilot_enabled: active.autopilot_enabled ?? false,
        theme: active.theme || "desert",
      });
    }
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discard any unsaved accent preview when leaving: restore the app's real
  // active-project theme (the picker only persists via Save).
  const appActiveTheme = (projects.find((p) => p.id === currentProjectId) ?? projects[0])?.theme || "desert";
  const appThemeRef = useRef(appActiveTheme);
  appThemeRef.current = appActiveTheme;
  useEffect(() => () => { applyPalette(appThemeRef.current); }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProject(active!.id, {
        name: form.name.trim(),
        domain: form.domain.trim(),
        locale: form.locale,
        target_country: form.target_country.trim() || null,
        industry: form.industry.trim() || null,
        persona: form.persona || undefined,
        autopilot_enabled: form.autopilot_enabled,
        theme: form.theme,
      }),
    onSuccess: () => {
      // Refreshing projects also lets I18nProvider pick up a new project
      // language and update the default interface language.
      qc.invalidateQueries({ queryKey: ["projects"] });
      success(t("settings.project.saved"));
    },
    onError: () => error(t("settings.project.saveError")),
  });

  if (isLoading) {
    return (
      <div>
        <SectionHeader title={t("settings.project.title")} description={t("settings.project.subtitle")} />
        <div className="h-64 rounded-xl border bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (!active) {
    return (
      <div>
        <SectionHeader title={t("settings.project.title")} description={t("settings.project.subtitle")} />
        <p className="text-sm text-muted-foreground">{t("settings.project.none")}</p>
      </div>
    );
  }

  const knownLang = PROJECT_LANGS.some((l) => l.code === form.locale);
  const currentTheme = form.theme || "desert";
  const custom = isCustomTheme(form.theme);

  // Live preview only: recolor the app now, but it's definitive on Save.
  function pickTheme(theme: string) {
    applyPalette(theme);
    setForm((f) => ({ ...f, theme }));
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={Globe} title={t("settings.project.title")} description={t("settings.project.subtitle")} />

      <Card className="flex flex-col gap-4 p-5">
        {projects.length > 1 && (
          <Field label={t("settings.project.selectProject")}>
            <select value={active.id} onChange={(e) => setEditId(e.target.value)} className={SELECT_CLS}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t("settings.project.name")}>
          <Input value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        </Field>

        <Field label={t("settings.project.domain")}>
          <Input value={form.domain} onChange={(v) => setForm((f) => ({ ...f, domain: v }))} placeholder="example.com" />
        </Field>

        <Field label={t("settings.project.language")} hint={t("settings.project.languageHint")}>
          <select value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))} className={SELECT_CLS}>
            {!knownLang && <option value={form.locale}>{form.locale}</option>}
            {PROJECT_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("settings.project.country")}>
            <Input value={form.target_country} onChange={(v) => setForm((f) => ({ ...f, target_country: v }))} placeholder="US" />
          </Field>
          <Field label={t("settings.project.industry")}>
            <Input value={form.industry} onChange={(v) => setForm((f) => ({ ...f, industry: v }))} />
          </Field>
        </div>

        <Field label={t("settings.project.persona")}>
          <select
            value={form.persona}
            onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value as ProjectPersona | "" }))}
            className={SELECT_CLS}
          >
            <option value="">—</option>
            {PROJECT_PERSONAS.map((p) => (
              <option key={p} value={p}>{t(`settings.project.personas.${p}`)}</option>
            ))}
          </select>
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("settings.project.autopilot")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.project.autopilotHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.autopilot_enabled}
            onClick={() => setForm((f) => ({ ...f, autopilot_enabled: !f.autopilot_enabled }))}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.autopilot_enabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form.autopilot_enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {saveMutation.isError && <ErrorMsg>{t("settings.project.saveError")}</ErrorMsg>}

        <div>
          <PrimaryBtn onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name.trim()}>
            {saveMutation.isPending ? t("settings.project.saving") : t("settings.project.save")}
          </PrimaryBtn>
        </div>
      </Card>

      {/* Accent palette */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Palette className="h-3.5 w-3.5" strokeWidth={2} /></span>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("settings.project.palette")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.project.paletteHint")}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {PALETTES.map((p) => {
            const on = !custom && currentTheme === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickTheme(p.id)}
                title={t(`settings.project.palettes.${p.id}`, { defaultValue: p.label })}
                className="group flex flex-col items-center gap-1.5"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-transform group-hover:scale-105 ${on ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
                  style={{ background: p.color, ...(on ? { boxShadow: `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${p.color}` } : {}) }}
                >
                  {on && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
                </span>
                <span className={`text-[10px] font-medium ${on ? "text-foreground" : "text-muted-foreground"}`}>
                  {t(`settings.project.palettes.${p.id}`, { defaultValue: p.label })}
                </span>
              </button>
            );
          })}

          {/* Custom color */}
          <label className="group flex cursor-pointer flex-col items-center gap-1.5" title={t("settings.project.custom")}>
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform group-hover:scale-105"
              style={
                custom
                  ? { background: form.theme, boxShadow: `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${form.theme}` }
                  : { background: "conic-gradient(from 0deg, #ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)" }
              }
            >
              {custom ? <Check className="h-4 w-4" strokeWidth={3} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
              <input
                type="color"
                value={custom ? form.theme : "#c2603a"}
                onChange={(e) => pickTheme(e.target.value)}
                className="sr-only"
                aria-label={t("settings.project.custom")}
              />
            </span>
            <span className={`text-[10px] font-medium ${custom ? "text-foreground" : "text-muted-foreground"}`}>{t("settings.project.custom")}</span>
          </label>
        </div>

        {/* Live preview */}
        <div className="mt-5 rounded-xl border border-border bg-background/50 p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t("settings.project.accentPreview")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="btn-primary px-3 py-1.5 text-xs">{active.name || "Fennex"}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" /> {custom ? t("settings.project.custom") : t(`settings.project.palettes.${currentTheme}`, { defaultValue: currentTheme })}
            </span>
            <a className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-2">{active.domain || "example.com"}</a>
            <span className="h-2 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full w-2/3 rounded-full gradient-brand" /></span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Appearance ────────────────────────────────────────────────────────────────

/** A tiny app-shell mock used inside the theme preview cards. */
function ThemeMock({ light }: { light: boolean }) {
  const bg = light ? "#f6f0e7" : "#171310";
  const rail = light ? "#e9dccb" : "#241b15";
  const line = light ? "#d8cbb9" : "#2c231d";
  return (
    <span className="flex h-full w-full">
      <span className="h-full w-1/3" style={{ background: rail }} />
      <span className="flex-1 p-1.5" style={{ background: bg }}>
        <span className="block h-1.5 w-7 rounded-full" style={{ background: "#c2603a" }} />
        <span className="mt-1.5 block h-1 w-full rounded-full" style={{ background: line }} />
        <span className="mt-1 block h-1 w-2/3 rounded-full" style={{ background: line }} />
      </span>
    </span>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "system") : "system";

  const options: { id: "light" | "dark" | "system"; Icon: LucideIcon }[] = [
    { id: "light", Icon: Sun },
    { id: "dark", Icon: Moon },
    { id: "system", Icon: Monitor },
  ];

  return (
    <div>
      <SectionHeader icon={Palette} title={t("settings.appearance.title")} description={t("settings.appearance.subtitle")} />
      <Field label={t("settings.appearance.theme")} hint={t("settings.appearance.themeHint")}>
        <div className="grid grid-cols-3 gap-3">
          {options.map(({ id, Icon }) => {
            const active = current === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={active}
                className={`group flex flex-col items-center gap-2.5 rounded-xl border p-2.5 transition-all active:scale-[0.98] ${
                  active ? "border-primary bg-primary/[0.05] ring-2 ring-inset ring-primary/25" : "border-border hover:border-primary/30 hover:bg-accent/40"
                }`}
              >
                <span className="flex h-16 w-full overflow-hidden rounded-lg border border-border">
                  {id === "system" ? (
                    <>
                      <span className="w-1/2 overflow-hidden"><ThemeMock light /></span>
                      <span className="w-1/2 overflow-hidden"><ThemeMock light={false} /></span>
                    </>
                  ) : (
                    <ThemeMock light={id === "light"} />
                  )}
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} /> {t(`settings.appearance.${id}`)}
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
              </button>
            );
          })}
        </div>
      </Field>
      <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {t("settings.appearance.accentNote")}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const NAV_IDS = NAV_ITEMS.map((i) => i.id) as readonly string[];

export default function SettingsPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SectionId>("account");
  const [query, setQuery] = useState("");

  // Deep-link sections via the URL hash (bookmarkable + back/forward friendly).
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace("#", "");
      if (h && NAV_IDS.includes(h)) setActiveSection(h as SectionId);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  function selectSection(id: SectionId) {
    setActiveSection(id);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${id}`);
  }

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 5 * 60_000,
  });

  const renderSection = () => {
    if (isLoading || !me) return (
      <div className="flex flex-col gap-4">
        <div className="h-6 w-32 rounded-lg bg-muted/40 animate-pulse" />
        <div className="h-48 rounded-2xl border bg-muted/20 animate-pulse" />
        <div className="h-32 rounded-2xl border bg-muted/20 animate-pulse" />
      </div>
    );

    switch (activeSection) {
      case "account": return <AccountSection me={me} />;
      case "appearance": return <AppearanceSection />;
      case "organization": return <OrganizationSection me={me} />;
      case "project": return <ProjectSection />;
      case "team": return <TeamSection orgId={me.org_id} myId={me.id} myRole={me.role} />;
      case "ai-keys": return <AIKeysSection />;
      case "brand-kit": return <BrandKitSection />;
      case "social": return <SocialSection />;
      case "billing": return <BillingSection />;
    }
  };

  const q = query.trim().toLowerCase();
  const matches = (navKey: string) => !q || t(`settings.nav.${navKey}`).toLowerCase().includes(q);
  const anyMatch = NAV_ITEMS.some((it) => matches(it.navKey));

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/50 px-5 py-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(600px 160px at 8% -40%, hsl(var(--primary) / 0.14), transparent 60%)" }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl gradient-brand glow-primary">
            <SettingsIcon className="h-5 w-5 text-white" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">{t("settings.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("settings.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* Nav rail */}
        <aside className="shrink-0 self-start lg:sticky lg:top-4 lg:w-60">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              className="w-full rounded-xl border border-border bg-input py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {!anyMatch ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("settings.noResults")}</p>
          ) : (
            <nav className="flex flex-col gap-4">
              {NAV_GROUPS.map((group) => {
                const items = NAV_ITEMS.filter((it) => it.group === group && matches(it.navKey));
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                      {t(`settings.groups.${group}`)}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {items.map(({ id, navKey, icon: Icon, tone }) => {
                        const active = activeSection === id;
                        return (
                          <button
                            key={id}
                            onClick={() => selectSection(id)}
                            className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-all ${
                              active
                                ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/20"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                            }`}
                          >
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                              <Icon className="h-4 w-4" strokeWidth={1.9} />
                            </span>
                            <span className="flex-1 text-left">{t(`settings.nav.${navKey}`)}</span>
                            {active && <ChevronRight className="h-3.5 w-3.5 text-primary/70" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          )}
        </aside>

        {/* Main content */}
        <main key={activeSection} className="min-w-0 flex-1 animate-fade-in lg:max-w-2xl">
          {renderSection()}
        </main>
      </div>
    </div>
  );
}
