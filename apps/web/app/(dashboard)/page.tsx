import {
  TrendingUp,
  FileText,
  Target,
  Zap,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const stats = [
  {
    label: "Organic Sessions",
    value: "—",
    change: null,
    icon: TrendingUp,
    accent: "accent-violet",
    iconColor: "text-violet-500",
    iconBg: "bg-violet-50 dark:bg-violet-500/10",
  },
  {
    label: "Published Articles",
    value: "—",
    change: null,
    icon: FileText,
    accent: "accent-indigo",
    iconColor: "text-indigo-500",
    iconBg: "bg-indigo-50 dark:bg-indigo-500/10",
  },
  {
    label: "Keywords Tracked",
    value: "—",
    change: null,
    icon: Target,
    accent: "accent-emerald",
    iconColor: "text-emerald-500",
    iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
  },
  {
    label: "AI Tasks Run",
    value: "—",
    change: null,
    icon: Zap,
    accent: "accent-amber",
    iconColor: "text-amber-500",
    iconBg: "bg-amber-50 dark:bg-amber-500/10",
  },
];

const quickActions = [
  { label: "Run keyword research", description: "Discover opportunities for your domain", href: "/keywords", color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-500/10" },
  { label: "Generate an article", description: "AI-written, SEO-optimized content", href: "/articles", color: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-500/10" },
  { label: "Audit your site", description: "Find and fix SEO issues", href: "/audit", color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-7 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-sans text-2xl font-semibold text-foreground">Overview</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Connect a project to start growing your organic traffic.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className={`rounded-xl border border-border bg-card p-5 shadow-sm card-shadow ${stat.accent}`}>
            <div className="flex items-start justify-between">
              <div className={`rounded-lg p-2 ${stat.iconBg}`}>
                <stat.icon className={`h-4 w-4 ${stat.iconColor}`} strokeWidth={1.8} />
              </div>
              {stat.change !== null && (
                <span className="flex items-center gap-0.5 text-xs font-medium text-green-400">
                  <ArrowUpRight className="h-3 w-3" />
                  {stat.change}
                </span>
              )}
            </div>
            <div className="mt-4">
              <p className="font-sans text-2xl font-semibold text-foreground">{stat.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Quick actions */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <h2 className="font-sans text-base font-semibold text-foreground mb-4">Get started</h2>
          <div className="space-y-2">
            {quickActions.map((action) => (
              <a
                key={action.label}
                href={action.href}
                className="flex items-center gap-4 rounded-lg border border-border p-4 transition-all hover:bg-accent hover:border-primary/20 group"
              >
                <div className={`rounded-lg p-2.5 ${action.bg} shrink-0`}>
                  <Zap className={`h-4 w-4 ${action.color}`} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className="text-xs text-muted-foreground">{action.description}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" strokeWidth={1.8} />
              </a>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-sans text-base font-semibold text-foreground mb-4">Activity</h2>
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
            <div className="rounded-full border border-border p-3 text-muted-foreground/40">
              <Clock className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No activity yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Create a project to begin</p>
            </div>
          </div>
        </div>
      </div>

      {/* Setup checklist */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="h-4 w-4 text-primary" strokeWidth={2} />
          <h2 className="font-sans text-base font-semibold text-foreground">Setup checklist</h2>
          <span className="ml-auto text-xs font-medium text-muted-foreground">0 / 4 done</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "Connect AI keys", done: false, href: "/settings/api-keys" },
            { label: "Create a project", done: false, href: "#" },
            { label: "Run your first audit", done: false, href: "#" },
            { label: "Generate an article", done: false, href: "#" },
          ].map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
            >
              {item.done
                ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" strokeWidth={2} />
                : <AlertCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" strokeWidth={1.8} />}
              {item.label}
              {!item.done && <ArrowUpRight className="h-3.5 w-3.5 ml-auto text-muted-foreground/30" strokeWidth={2} />}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
