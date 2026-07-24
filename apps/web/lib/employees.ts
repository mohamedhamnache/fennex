/** The AI company, as the frontend sees it.
 *
 *  Nothing here hardcodes the roster. The registry on the API is the single
 *  source of truth; this module types it, fetches it, and maps the icon name
 *  each employee declares onto a real component. An employee hired on the
 *  backend appears in the UI with no frontend change.
 */
import {
  BarChart3, Compass, Footprints, Palmtree, Radar, ScrollText, Sparkles,
  Wand2, Wind, type LucideIcon,
} from "lucide-react";
import { apiClient } from "./api";

export interface EmployeeAction {
  id: string;
  label: string;
  description: string;
  capabilities: string[];
  weight: "light" | "heavy";
  inputs: string[];
  outputs: string[];
  requiresApproval: boolean;
  requiresPermissions: string[];
}

export interface Employee {
  id: string;
  name: string;
  codename: string;
  avatar: string;
  icon: string;
  role: string;
  department: string;
  description: string;
  version: string;
  status: "active" | "beta" | "deprecated" | "disabled";
  personality: string;
  expertise: string[];
  goals: string[];
  capabilities: string[];
  allowedTools: string[];
  connectedApps: string[];
  permissions: string[];
  memoryScope: "self" | "department" | "project" | "org";
  knowledgeSources: string[];
  supportedInputs: string[];
  supportedOutputs: string[];
  consumes: string[];
  producesFor: string[];
  actions: EmployeeAction[];
  versions?: string[];
}

export interface RegistryStats {
  employees: number;
  active: number;
  departments: number;
  actions: number;
  capabilities: number;
}

export interface EmployeeRegistry {
  employees: Employee[];
  stats: RegistryStats;
  departments: string[];
}

export interface CapabilityInfo {
  slug: string;
  label: string;
  domain: string;
  description: string;
  coveredBy: string[];
}

export interface EmployeeTool {
  name: string;
  label: string;
  description: string;
  kind: "data" | "app";
  app: string;
  permission: string;
  writes: boolean;
}

export interface EmployeeHealth {
  id: string;
  name: string;
  department: string;
  status: string;
  ok: boolean;
  detail: string;
  checks: Record<string, unknown>;
  connectedApps: Record<string, boolean>;
}

export interface PlannedTask {
  id: string;
  goal: string;
  capabilities: string[];
  employeeId: string | null;
  actionId: string | null;
  dependsOn: string[];
  why: string;
}

export interface PlanPreview {
  capabilities: string[];
  tasks: PlannedTask[];
  /** Task ids grouped by execution layer — each layer runs in parallel. */
  layers: string[][];
  team: { id: string; name: string; role: string; department: string; icon: string }[];
  brandDna: Record<string, unknown>;
  logs: { at: string; level: string; event: string; detail: Record<string, unknown> }[];
}

export interface RunReport {
  goal: string;
  ok: boolean;
  team: string[];
  tasks: (PlannedTask & { ok: boolean; summary: string; error: string | null })[];
  artifacts: Record<string, unknown>[];
  logs: { at: string; level: string; event: string; detail: Record<string, unknown> }[];
  cost: { calls: number; by_model: Record<string, number> };
  error: string | null;
}

export interface MemoryEntry {
  id: string;
  employeeId: string;
  scope: string;
  kind: string;
  key: string | null;
  content: string;
  meta: Record<string, unknown>;
  score: number;
}

/** Icon names the backend may declare, mapped to components.
 *  Unknown names fall back to a neutral mark rather than breaking the page. */
const ICONS: Record<string, LucideIcon> = {
  radar: Radar,
  "scroll-text": ScrollText,
  wind: Wind,
  "wand-2": Wand2,
  footprints: Footprints,
  palmtree: Palmtree,
  compass: Compass,
  "bar-chart": BarChart3,
  sparkles: Sparkles,
};

export function employeeIcon(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}

/** Department accent tokens. Uses CSS variables so palettes stay per-project. */
export const DEPARTMENT_ACCENT: Record<string, string> = {
  Strategy: "text-primary bg-primary/10",
  Content: "text-amber-500 bg-amber-500/10",
  Marketing: "text-sky-500 bg-sky-500/10",
  "Creative Studio": "text-violet-500 bg-violet-500/10",
  Intelligence: "text-rose-500 bg-rose-500/10",
  Research: "text-emerald-500 bg-emerald-500/10",
  Growth: "text-cyan-500 bg-cyan-500/10",
};

export function departmentAccent(department: string): string {
  return DEPARTMENT_ACCENT[department] ?? "text-muted-foreground bg-muted";
}

// --- API ---------------------------------------------------------------------

export async function listEmployees(params?: {
  department?: string;
  capability?: string;
}): Promise<EmployeeRegistry> {
  const q = new URLSearchParams();
  if (params?.department) q.set("department", params.department);
  if (params?.capability) q.set("capability", params.capability);
  const suffix = q.toString() ? `?${q}` : "";
  return apiClient.get<EmployeeRegistry>(`/employees${suffix}`);
}

export async function getEmployee(id: string): Promise<Employee> {
  return apiClient.get<Employee>(`/employees/${id}`);
}

export async function listCapabilities(): Promise<{
  capabilities: CapabilityInfo[];
  domains: string[];
}> {
  return apiClient.get(`/employees/capabilities`);
}

export async function listEmployeeTools(projectId?: string): Promise<{
  tools: EmployeeTool[];
  apps: string[];
  connected: Record<string, boolean>;
}> {
  const suffix = projectId ? `?project_id=${projectId}` : "";
  return apiClient.get(`/employees/tools${suffix}`);
}

export async function employeeHealth(projectId: string): Promise<{ employees: EmployeeHealth[] }> {
  return apiClient.get(`/employees/health?project_id=${projectId}`);
}

/** Preview the team and plan without spending anything — the approval surface. */
export async function previewPlan(body: {
  goal: string;
  project_id: string;
  persona?: string;
  capabilities?: string[];
}): Promise<PlanPreview> {
  return apiClient.post<PlanPreview>("/employees/plan", body);
}

/** Hand a goal to the company and let the Orchestrator deliver it. */
export async function delegate(body: {
  goal: string;
  project_id: string;
  persona?: string;
  tier?: string;
  capabilities?: string[];
  parallelism?: number;
}): Promise<RunReport> {
  return apiClient.post<RunReport>("/employees/delegate", body);
}

export async function recallMemory(params: {
  project_id: string;
  q?: string;
  employee_id?: string;
  limit?: number;
}): Promise<{ memories: MemoryEntry[] }> {
  const q = new URLSearchParams({ project_id: params.project_id });
  if (params.q) q.set("q", params.q);
  if (params.employee_id) q.set("employee_id", params.employee_id);
  if (params.limit) q.set("limit", String(params.limit));
  return apiClient.get(`/employees/memory/recall?${q}`);
}

export async function forgetMemory(memoryId: string): Promise<{ ok: boolean }> {
  return apiClient.delete(`/employees/memory/${memoryId}`);
}
