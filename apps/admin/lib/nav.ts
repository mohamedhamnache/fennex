import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Layers,
  Cpu,
  Brain,
  SearchCode,
  BarChart2,
  ListTodo,
  Webhook,
  Flag,
  ShieldCheck,
  ScrollText,
  Plug,
  Bell,
  Settings,
  type LucideIcon,
} from "lucide-react";

/** One nav destination — used by both the NavRail (grouped) and the
 * CommandPalette (flat list). Only `/overview` is a live page in this phase;
 * every other href routes to a thin "Coming in Phase 1b" placeholder. */
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Grouped nav, mirroring the spec IA (§1 Information Architecture):
 * Overview / Customers / Revenue / AI & SEO / Operations / Trust / Settings. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Executive", href: "/overview", icon: LayoutDashboard }],
  },
  {
    label: "Customers",
    items: [
      { label: "Organizations", href: "/orgs", icon: Building2 },
      { label: "Users", href: "/users", icon: Users },
    ],
  },
  {
    label: "Revenue",
    items: [
      { label: "Billing", href: "/billing", icon: CreditCard },
      { label: "Plans", href: "/plans", icon: Layers },
    ],
  },
  {
    label: "AI & SEO",
    items: [
      { label: "Providers", href: "/providers", icon: Cpu },
      { label: "Models", href: "/models", icon: Brain },
      { label: "DataForSEO", href: "/dataforseo", icon: SearchCode },
      { label: "Usage", href: "/usage", icon: BarChart2 },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Queue", href: "/queue", icon: ListTodo },
      { label: "API", href: "/api", icon: Webhook },
      { label: "Feature Flags", href: "/flags", icon: Flag },
    ],
  },
  {
    label: "Trust",
    items: [
      { label: "Security", href: "/security", icon: ShieldCheck },
      { label: "Audit", href: "/audit", icon: ScrollText },
      { label: "Integrations", href: "/integrations", icon: Plug },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Notifications", href: "/alerts", icon: Bell },
      { label: "System", href: "/system", icon: Settings },
    ],
  },
];

/** Flat list of every nav destination, for the command palette. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Routes with a real page in this phase — everything else is a stub. */
export const LIVE_ROUTES = new Set(["/overview"]);
