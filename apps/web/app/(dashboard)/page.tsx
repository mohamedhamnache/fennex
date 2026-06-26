import {
  TrendingUp,
  FileText,
  Target,
  Zap,
  ArrowRight,
  Clock,
  CheckCircle2,
  Circle,
  Search,
  Globe,
} from "lucide-react";

const stats = [
  {
    label: "Organic Sessions",
    value: "—",
    icon: TrendingUp,
    color: "text-violet-500",
    iconBg: "bg-violet-500/8",
  },
  {
    label: "Published Articles",
    value: "—",
    icon: FileText,
    color: "text-indigo-500",
    iconBg: "bg-indigo-500/8",
  },
  {
    label: "Keywords Tracked",
    value: "—",
    icon: Target,
    color: "text-emerald-500",
    iconBg: "bg-emerald-500/8",
  },
  {
    label: "AI Tasks Run",
    value: "—",
    icon: Zap,
    color: "text-amber-500",
    iconBg: "bg-amber-500/8",
  },
];

const quickActions = [
  {
    label: "Keyword research",
    description: "Find high-ROI opportunities",
    href: "/keywords",
    icon: Search,
    color: "text-violet-500",
    bg: "bg-violet-500/8",
  },
  {
    label: "Generate article",
    description: "AI-written, SEO-optimized",
    href: "/articles",
    icon: Zap,
    color: "text-indigo-500",
    bg: "bg-indigo-500/8",
  },
  {
    label: "Audit your site",
    description: "Find and fix SEO issues",
    href: "/audit",
    icon: Globe,
    color: "text-emerald-500",
    bg: "bg-emerald-500/8",
  },
];

const checklist = [
  { label: "Connect AI keys",       href: "/settings/api-keys" },
  { label: "Create a project",      href: "#" },
  { label: "Run your first audit",  href: "#" },
  { label: "Generate an article",   href: "#" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Overview</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Connect a project to start growing your organic traffic.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-5">
            <div className={`inline-flex items-center justify-center rounded-lg p-2 ${stat.iconBg} mb-4`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} strokeWidth={1.8} />
            </div>
            <p className="font-display text-3xl font-bold tracking-tight text-foreground leading-none">
              {stat.value}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Content row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Quick actions */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Get started</h2>
          <div className="space-y-1.5">
            {quickActions.map((action) => (
              <a
                key={action.label}
                href={action.href}
                className="group flex items-center gap-4 rounded-lg px-4 py-3.5 transition-all hover:bg-accent"
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${action.bg}`}>
                  <action.icon className={`h-3.5 w-3.5 ${action.color}`} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className="text-xs text-muted-foreground">{action.description}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 transition-all group-hover:text-primary group-hover:translate-x-0.5 shrink-0" strokeWidth={2} />
              </a>
            ))}
          </div>
        </div>

        {/* Activity */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Recent activity</h2>
          <div className="flex flex-col items-center justify-center h-36 gap-3 text-center">
            <div className="rounded-full bg-muted/60 p-3">
              <Clock className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No activity yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Actions appear here</p>
            </div>
          </div>
        </div>
      </div>

      {/* Setup checklist */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" strokeWidth={2} />
            <h2 className="text-sm font-semibold text-foreground">Setup checklist</h2>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            0 / 4
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {checklist.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="group flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground transition-all hover:border-primary/25 hover:bg-primary/4 hover:text-foreground"
            >
              <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" strokeWidth={2} />
              {item.label}
              <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground/20 group-hover:text-primary/50 group-hover:translate-x-0.5 transition-all shrink-0" strokeWidth={2} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
