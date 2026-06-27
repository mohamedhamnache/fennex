"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, Eye, EyeOff, Link2, Link2Off, UserX, UserPlus, Copy, Check } from "lucide-react";
import { getMe, listApiKeys, createApiKey, deleteApiKey, type ApiKey, listSocialConnections, upsertSocialConnection, deleteSocialConnection, type SocialConnection, listOrgMembers, inviteMember, updateMemberRole, deactivateMember, type OrgMember } from "@/lib/api";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  agency: "Agency",
  enterprise: "Enterprise",
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-5">{children}</div>
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

const PROVIDERS = ["openai", "anthropic", "google"] as const;

function LLMKeysSection() {
  const qc = useQueryClient();
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
      setValue("");
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">LLM API Keys</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3 w-3" /> Add key
        </button>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">
        {showForm && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    provider === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "text-muted-foreground border-border hover:border-foreground"
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type={showValue ? "text" : "password"}
                placeholder="sk-..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => addMutation.mutate()}
                disabled={!value.trim() || addMutation.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addMutation.isPending ? "Saving…" : "Save key"}
              </button>
              <button
                onClick={() => { setShowForm(false); setValue(""); }}
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            {addMutation.isError && (
              <p className="text-xs text-destructive">Failed to save key. Check the value and try again.</p>
            )}
          </div>
        )}
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted/30" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys added yet. Add keys to enable AI features.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {keys.map((k: ApiKey) => (
              <div key={k.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {PROVIDER_LABELS[k.provider] ?? k.provider}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">{k.masked_value}</span>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(k.id)}
                  disabled={deleteMutation.isPending}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const SOCIAL_PLATFORMS = [
  { id: "twitter", label: "Twitter / X", icon: "𝕏", placeholder: "Bearer eyJ..." },
  { id: "linkedin", label: "LinkedIn", icon: "in", placeholder: "AQX..." },
  { id: "instagram", label: "Instagram", icon: "📷", placeholder: "EAA..." },
  { id: "facebook", label: "Facebook", icon: "f", placeholder: "EAA..." },
] as const;

type PlatformId = (typeof SOCIAL_PLATFORMS)[number]["id"];

function SocialAccountsSection() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<PlatformId | null>(null);
  const [form, setForm] = useState({ handle: "", token: "" });

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["social-connections"],
    queryFn: listSocialConnections,
    staleTime: 60_000,
  });

  const connected = new Map(connections.map((c: SocialConnection) => [c.platform, c]));

  const connectMutation = useMutation({
    mutationFn: () =>
      upsertSocialConnection(connecting!, form.handle || null, form.token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-connections"] });
      setConnecting(null);
      setForm({ handle: "", token: "" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => deleteSocialConnection(platform),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-connections"] }),
  });

  const platform = SOCIAL_PLATFORMS.find((p) => p.id === connecting);

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4">
        <h2 className="text-sm font-semibold">Social Accounts</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-3">
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted/30" />
        ) : (
          SOCIAL_PLATFORMS.map((p) => {
            const conn = connected.get(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-bold">{p.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    {conn?.handle && (
                      <p className="text-xs text-muted-foreground">{conn.handle}</p>
                    )}
                  </div>
                </div>
                {conn ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
                      Connected
                    </span>
                    <button
                      onClick={() => disconnectMutation.mutate(p.id)}
                      disabled={disconnectMutation.isPending}
                      className="text-muted-foreground hover:text-destructive"
                      title="Disconnect"
                    >
                      <Link2Off className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConnecting(p.id)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground"
                  >
                    <Link2 className="h-3 w-3" /> Connect
                  </button>
                )}
              </div>
            );
          })
        )}

        {connecting && platform && (
          <div className="flex flex-col gap-3 rounded-md border p-4 bg-muted/20">
            <p className="text-sm font-medium">Connect {platform.label}</p>
            <input
              type="text"
              placeholder="Handle (e.g. @yourcompany)"
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              type="password"
              placeholder={platform.placeholder}
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-xs text-muted-foreground">
              Paste your access token. Get it from the {platform.label} developer portal.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => connectMutation.mutate()}
                disabled={!form.token.trim() || connectMutation.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {connectMutation.isPending ? "Connecting…" : "Connect"}
              </button>
              <button
                onClick={() => { setConnecting(null); setForm({ handle: "", token: "" }); }}
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            {connectMutation.isError && (
              <p className="text-xs text-destructive">Failed to connect. Check your token and try again.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ROLE_OPTIONS = [
  "owner", "admin", "seo_manager", "content_writer",
  "editor", "designer", "marketing_manager", "viewer",
] as const;

function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function TeamSection({ orgId, myId, myRole }: { orgId: string; myId: string; myRole: string }) {
  const qc = useQueryClient();
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
      setInviteLink(data.invite_link);
      setInviteForm({ email: "", role: "viewer" });
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateMemberRole(orgId, userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });

  const deactivateMutationFn = useMutation({
    mutationFn: (userId: string) => deactivateMember(orgId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Team Members</h2>
        {canManage && (
          <button
            onClick={() => { setShowInvite((v) => !v); setInviteLink(null); }}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-3 w-3" /> Invite
          </button>
        )}
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">
        {showInvite && canManage && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            {inviteLink ? (
              <>
                <p className="text-sm font-medium text-green-600">Invite link generated</p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <p className="flex-1 truncate font-mono text-xs text-muted-foreground">{inviteLink}</p>
                  <button onClick={copyLink} className="shrink-0 text-muted-foreground hover:text-foreground">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  onClick={() => { setShowInvite(false); setInviteLink(null); }}
                  className="self-start rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => inviteMutation.mutate()}
                    disabled={!inviteForm.email.trim() || inviteMutation.isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {inviteMutation.isPending ? "Sending…" : "Generate invite link"}
                  </button>
                  <button
                    onClick={() => setShowInvite(false)}
                    className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted/30" />
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m: OrgMember) => (
              <div
                key={m.id}
                className={`flex items-center justify-between rounded-md border px-4 py-3 ${!m.is_active ? "opacity-50" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(m.full_name)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{m.full_name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && m.id !== myId ? (
                    <select
                      value={m.role}
                      onChange={(e) => roleMutation.mutate({ userId: m.id, role: e.target.value })}
                      disabled={roleMutation.isPending}
                      className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  )}
                  {!m.is_active && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                      Inactive
                    </span>
                  )}
                  {canManage && m.id !== myId && m.is_active && (
                    <button
                      onClick={() => deactivateMutationFn.mutate(m.id)}
                      disabled={deactivateMutationFn.isPending}
                      className="text-muted-foreground hover:text-destructive"
                      title="Deactivate member"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 max-w-2xl">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="rounded-lg border bg-card p-6 h-40 animate-pulse bg-muted/30" />
        <div className="rounded-lg border bg-card p-6 h-32 animate-pulse bg-muted/30" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Section title="Account">
        <Field label="Full name" value={me?.full_name ?? "—"} />
        <Field label="Email" value={me?.email ?? "—"} />
        <Field label="Role" value={ROLE_LABELS[me?.role ?? ""] ?? me?.role ?? "—"} />
        {me?.created_at && (
          <Field
            label="Member since"
            value={new Date(me.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          />
        )}
      </Section>

      <Section title="Organization">
        <Field label="Name" value={me?.org_name ?? "—"} />
        <Field label="Slug" value={me?.org_slug ?? "—"} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Plan
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">
              {PLAN_LABELS[me?.plan_tier ?? ""] ?? me?.plan_tier ?? "—"}
            </span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {me?.plan_tier === "free" ? "Upgrade available" : "Active"}
            </span>
          </div>
        </div>
      </Section>

      <LLMKeysSection />

      <SocialAccountsSection />

      {me && (
        <TeamSection orgId={me.org_id} myId={me.id} myRole={me.role} />
      )}

      <Section title="Integrations">
        <p className="text-sm text-muted-foreground">
          Manage API keys and third-party connections from the{" "}
          <span className="font-medium text-foreground">Analytics</span> and{" "}
          <span className="font-medium text-foreground">Publishing</span> sections.
          Billing and plan upgrades are coming in the next release.
        </p>
      </Section>
    </div>
  );
}
