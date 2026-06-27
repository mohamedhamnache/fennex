"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, Eye, EyeOff } from "lucide-react";
import { getMe, listApiKeys, createApiKey, deleteApiKey, type ApiKey } from "@/lib/api";

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
