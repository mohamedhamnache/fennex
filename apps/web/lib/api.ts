const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fennex_access_token");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.detail ?? body.message ?? msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export async function authLogin(email: string, password: string): Promise<TokenResponse> {
  const data = await apiClient.post<TokenResponse>("/auth/login", { email, password });
  localStorage.setItem("fennex_access_token", data.access_token);
  localStorage.setItem("fennex_refresh_token", data.refresh_token);
  return data;
}

export async function authRegister(
  email: string,
  password: string,
  fullName: string,
  orgName: string
): Promise<TokenResponse> {
  const data = await apiClient.post<TokenResponse>("/auth/register", {
    email,
    password,
    full_name: fullName,
    org_name: orgName,
  });
  localStorage.setItem("fennex_access_token", data.access_token);
  localStorage.setItem("fennex_refresh_token", data.refresh_token);
  return data;
}

export function authLogout() {
  localStorage.removeItem("fennex_access_token");
  localStorage.removeItem("fennex_refresh_token");
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("fennex_access_token");
}

// ─── Project types & helpers ───────────────────────────────────────────────

export interface Project {
  id: string;
  org_id: string;
  name: string;
  domain: string;
  locale: string;
  target_country: string | null;
  industry: string | null;
  created_at: string;
}

export interface CrawlStatus {
  job_id: string;
  status: string;
  pages_crawled: number;
  error?: string;
}

export interface AuditIssue {
  severity: "critical" | "warning" | "info";
  issue_type: string;
  url: string;
  message: string;
}

export interface AuditResult {
  id: string;
  status: string;
  overall_score: number;
  technical_score: number;
  content_score: number;
  onpage_score: number;
  issues: AuditIssue[];
  summary: {
    pages_audited: number;
    critical_issues: number;
    warnings: number;
  };
}

export async function createProject(data: {
  name: string;
  domain: string;
  locale?: string;
  target_country?: string;
}): Promise<Project> {
  return apiClient.post<Project>("/projects", data);
}

export async function listProjects(): Promise<Project[]> {
  return apiClient.get<Project[]>("/projects");
}

export async function triggerCrawl(
  projectId: string,
  url: string,
): Promise<{ job_id: string; status: string }> {
  return apiClient.post<{ job_id: string; status: string }>("/crawl", {
    project_id: projectId,
    url,
  });
}

export async function getCrawlStatus(jobId: string): Promise<CrawlStatus> {
  return apiClient.get<CrawlStatus>(`/crawl/${jobId}`);
}

export async function triggerAudit(
  projectId: string,
  crawlJobId?: string,
): Promise<{ audit_id: string; status: string }> {
  return apiClient.post<{ audit_id: string; status: string }>("/audit", {
    project_id: projectId,
    ...(crawlJobId ? { crawl_job_id: crawlJobId } : {}),
  });
}

export async function getAuditStatus(auditId: string): Promise<AuditResult> {
  return apiClient.get<AuditResult>(`/audit/${auditId}`);
}

// ─── Keyword Research types & helpers ─────────────────────────────────────────

export interface KeywordResearchJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  seed_keyword: string;
  keywords_found: number;
  error?: string;
}

export interface Keyword {
  id: string;
  keyword: string;
  search_volume: number | null;
  difficulty: number | null; // 0–100
  cpc: number | null;
  intent: "informational" | "navigational" | "commercial" | "transactional" | null;
  is_seed: boolean;
  cluster_id: string | null;
}

export interface KeywordCluster {
  id: string;
  name: string;
  topic: string | null;
  keyword_count: number;
  total_volume: number;
}

export async function triggerKeywordResearch(
  projectId: string,
  seedKeyword: string,
): Promise<{ job_id: string; status: string }> {
  return apiClient.post<{ job_id: string; status: string }>("/keywords/research", {
    project_id: projectId,
    seed_keyword: seedKeyword,
  });
}

export async function getKeywordJobStatus(jobId: string): Promise<KeywordResearchJob> {
  return apiClient.get<KeywordResearchJob>(`/keywords/research/${jobId}`);
}

export async function getKeywordResults(jobId: string): Promise<Keyword[]> {
  return apiClient.get<Keyword[]>(`/keywords/research/${jobId}/keywords`);
}

export async function getKeywordClusters(jobId: string): Promise<KeywordCluster[]> {
  return apiClient.get<KeywordCluster[]>(`/keywords/research/${jobId}/clusters`);
}
