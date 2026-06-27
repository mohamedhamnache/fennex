"use client";

import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api";

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
