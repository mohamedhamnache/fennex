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

// ─── User / org ──────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  plan_tier: string;
  created_at: string | null;
}

export async function getMe(): Promise<UserProfile> {
  return apiClient.get<UserProfile>("/users/me");
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
  total_volume: number | null;
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
  const res = await apiClient.get<{ keywords: Keyword[] }>(`/keywords/research/${jobId}/keywords`);
  return res.keywords ?? [];
}

export async function getKeywordClusters(jobId: string): Promise<KeywordCluster[]> {
  const res = await apiClient.get<{ clusters: KeywordCluster[] }>(`/keywords/research/${jobId}/clusters`);
  return res.clusters ?? [];
}

// ─── Content Plan types & helpers ─────────────────────────────────────────────

export type ContentItemStatus = "idea" | "draft" | "in_review" | "approved" | "published";
export type ContentItemType = "article" | "landing_page" | "social_post" | "email";

export interface ContentItem {
  id: string;
  plan_id: string;
  title: string;
  content_type: ContentItemType;
  status: ContentItemStatus;
  target_keyword: string | null;
  notes: string | null;
  scheduled_date: string | null; // "YYYY-MM-DD"
  word_count_target: number | null;
  created_at: string;
}

export interface ContentPlan {
  id: string;
  project_id: string;
  name: string;
  items: ContentItem[];
  created_at: string;
}

export async function getContentPlans(projectId: string): Promise<ContentPlan[]> {
  return apiClient.get<ContentPlan[]>(`/content-plans?project_id=${projectId}`);
}

export async function createContentPlan(projectId: string, name?: string): Promise<ContentPlan> {
  return apiClient.post<ContentPlan>("/content-plans", {
    project_id: projectId,
    ...(name ? { name } : {}),
  });
}

export async function addContentItem(
  planId: string,
  item: Partial<ContentItem> & { title: string },
): Promise<ContentItem> {
  return apiClient.post<ContentItem>(`/content-plans/${planId}/items`, item);
}

export async function updateContentItem(
  planId: string,
  itemId: string,
  patch: Partial<ContentItem>,
): Promise<ContentItem> {
  return apiClient.patch<ContentItem>(`/content-plans/${planId}/items/${itemId}`, patch);
}

export async function deleteContentItem(planId: string, itemId: string): Promise<void> {
  await apiClient.delete<void>(`/content-plans/${planId}/items/${itemId}`);
}

export async function generateContentPlan(
  planId: string,
  seedKeyword?: string,
): Promise<{ plan_id: string; items_added: number }> {
  return apiClient.post<{ plan_id: string; items_added: number }>(
    `/content-plans/${planId}/generate`,
    seedKeyword ? { seed_keyword: seedKeyword } : {},
  );
}

// ─── Brand Voice types & helpers ───────────────────────────────────────────

export type VoiceTone =
  | "professional"
  | "conversational"
  | "authoritative"
  | "friendly"
  | "technical"
  | "inspirational";

export interface BrandVoiceSource {
  id: string;
  brand_voice_id: string;
  source_type: "url" | "text";
  content: string;
  extracted_text: string | null;
  created_at: string;
}

export interface BrandVoice {
  id: string;
  org_id: string;
  name: string;
  tone: VoiceTone;
  description: string | null;
  voice_prompt: string | null;
  vocabulary: string[] | null;
  avoid_words: string[] | null;
  is_default: boolean;
  created_at: string;
  training_sources?: BrandVoiceSource[];
}

export async function getBrandVoices(): Promise<BrandVoice[]> {
  return apiClient.get<BrandVoice[]>("/brand-voice");
}

export async function getBrandVoice(id: string): Promise<BrandVoice> {
  return apiClient.get<BrandVoice>(`/brand-voice/${id}`);
}

export async function createBrandVoice(data: {
  name: string;
  tone?: VoiceTone;
  description?: string;
  vocabulary?: string[];
  avoid_words?: string[];
}): Promise<BrandVoice> {
  return apiClient.post<BrandVoice>("/brand-voice", data);
}

export async function updateBrandVoice(
  id: string,
  patch: Partial<
    Pick<
      BrandVoice,
      "name" | "tone" | "description" | "vocabulary" | "avoid_words" | "voice_prompt"
    >
  >,
): Promise<BrandVoice> {
  return apiClient.patch<BrandVoice>(`/brand-voice/${id}`, patch);
}

export async function deleteBrandVoice(id: string): Promise<void> {
  await apiClient.delete<void>(`/brand-voice/${id}`);
}

export async function setDefaultBrandVoice(id: string): Promise<BrandVoice> {
  return apiClient.post<BrandVoice>(`/brand-voice/${id}/set-default`, {});
}

export async function addBrandVoiceSource(
  id: string,
  source: { source_type: "url" | "text"; content: string },
): Promise<BrandVoiceSource> {
  return apiClient.post<BrandVoiceSource>(`/brand-voice/${id}/sources`, source);
}

export async function deleteBrandVoiceSource(
  voiceId: string,
  sourceId: string,
): Promise<void> {
  await apiClient.delete<void>(`/brand-voice/${voiceId}/sources/${sourceId}`);
}

export async function generateVoicePrompt(
  id: string,
): Promise<{ voice_id: string; voice_prompt: string }> {
  return apiClient.post<{ voice_id: string; voice_prompt: string }>(
    `/brand-voice/${id}/generate-prompt`,
    {},
  );
}

// ─── Article types & helpers ───────────────────────────────────────────────

export type ArticleStatus = "draft" | "generating" | "ready" | "published";

export interface Article {
  id: string;
  project_id: string;
  title: string;
  target_keyword: string | null;
  tone: string;
  status: ArticleStatus;
  body_markdown: string | null;
  body_html: string | null;
  word_count: number;
  word_count_target: number;
  seo_score: number | null;
  meta_title: string | null;
  meta_description: string | null;
  outline: { sections: { heading: string; content?: string }[] } | null;
  brand_voice_id: string | null;
  content_item_id: string | null;
  error: string | null;
  created_at: string;
}

export interface SEOScoreBreakdown {
  score: number;
  breakdown: Record<string, number>;
}

export async function listArticles(projectId: string): Promise<Article[]> {
  return apiClient.get<Article[]>(`/articles?project_id=${projectId}`);
}

export async function getArticle(id: string): Promise<Article> {
  return apiClient.get<Article>(`/articles/${id}`);
}

export async function createArticle(data: {
  project_id: string;
  title: string;
  target_keyword?: string;
  tone?: string;
  word_count_target?: number;
}): Promise<Article> {
  return apiClient.post<Article>("/articles", data);
}

export async function updateArticle(
  id: string,
  patch: Partial<
    Pick<Article, "title" | "target_keyword" | "tone" | "body_markdown" | "meta_title" | "meta_description">
  >,
): Promise<Article> {
  return apiClient.patch<Article>(`/articles/${id}`, patch);
}

export async function deleteArticle(id: string): Promise<void> {
  await apiClient.delete<void>(`/articles/${id}`);
}

export async function generateArticle(id: string): Promise<Article> {
  return apiClient.post<Article>(`/articles/${id}/generate`, {});
}

export async function saveRevision(
  id: string,
  note?: string,
): Promise<{ revision_id: string; created_at: string }> {
  return apiClient.post<{ revision_id: string; created_at: string }>(
    `/articles/${id}/save-revision`,
    note ? { note } : {},
  );
}

export async function getArticleSeoScore(id: string): Promise<SEOScoreBreakdown> {
  return apiClient.get<SEOScoreBreakdown>(`/articles/${id}/seo-score`);
}

// ─── Publishing types & helpers ────────────────────────────────────────────

export type PublishingPlatform = "wordpress" | "ghost" | "notion" | "custom";
export type PublishJobStatus = "pending" | "running" | "done" | "failed";

export interface PublishingConnection {
  id: string;
  project_id: string;
  name: string;
  platform: PublishingPlatform;
  site_url: string;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  created_at: string;
}

export interface PublishJob {
  id: string;
  project_id: string;
  connection_id: string;
  article_id: string | null;
  status: PublishJobStatus;
  platform_post_id: string | null;
  published_url: string | null;
  error: string | null;
  created_at: string;
}

export async function listPublishingConnections(projectId: string): Promise<PublishingConnection[]> {
  return apiClient.get<PublishingConnection[]>(`/publishing/connections?project_id=${projectId}`);
}

export async function createPublishingConnection(data: {
  project_id: string;
  name: string;
  platform: string;
  site_url: string;
  credentials: { username: string; app_password: string };
}): Promise<PublishingConnection> {
  return apiClient.post<PublishingConnection>("/publishing/connections", data);
}

export async function updatePublishingConnection(
  id: string,
  patch: Partial<Pick<PublishingConnection, "name" | "site_url" | "is_active">>,
): Promise<PublishingConnection> {
  return apiClient.patch<PublishingConnection>(`/publishing/connections/${id}`, patch);
}

export async function deletePublishingConnection(id: string): Promise<void> {
  await apiClient.delete<void>(`/publishing/connections/${id}`);
}

export async function testPublishingConnection(
  id: string,
): Promise<{ ok: boolean; user?: string; error?: string }> {
  return apiClient.post<{ ok: boolean; user?: string; error?: string }>(
    `/publishing/connections/${id}/test`,
    {},
  );
}

export async function publishArticle(data: {
  article_id: string;
  connection_id: string;
  publish_status: "draft" | "publish";
}): Promise<PublishJob> {
  return apiClient.post<PublishJob>("/publishing/publish", data);
}

export async function listPublishJobs(projectId: string): Promise<PublishJob[]> {
  return apiClient.get<PublishJob[]>(`/publishing/jobs?project_id=${projectId}`);
}

// ─── Social Media types & helpers ──────────────────────────────────────────

export type SocialPlatform = "linkedin" | "twitter" | "instagram" | "facebook";
export type SocialPostStatus = "draft" | "scheduled" | "published" | "failed";
export type SocialPostType = "article_share" | "tip" | "question" | "announcement";

export interface SocialPost {
  id: string;
  project_id: string;
  platform: SocialPlatform;
  post_type: SocialPostType;
  status: SocialPostStatus;
  content: string;
  hashtags: string[] | null;
  media_urls: string[] | null;
  scheduled_at: string | null;
  published_at: string | null;
  article_id: string | null;
  engagement_stats: Record<string, number> | null;
  error: string | null;
  char_count: number;
  created_at: string;
}

export async function listSocialPosts(
  projectId: string,
  platform?: SocialPlatform,
  status?: SocialPostStatus,
): Promise<SocialPost[]> {
  const params = new URLSearchParams({ project_id: projectId });
  if (platform) params.set("platform", platform);
  if (status) params.set("status", status);
  return apiClient.get<SocialPost[]>(`/social?${params.toString()}`);
}

export async function createSocialPost(data: {
  project_id: string;
  platform: SocialPlatform;
  post_type?: SocialPostType;
  content: string;
  hashtags?: string[];
  scheduled_at?: string;
  article_id?: string;
}): Promise<SocialPost> {
  return apiClient.post<SocialPost>("/social", data);
}

export async function updateSocialPost(
  id: string,
  patch: Partial<Pick<SocialPost, "content" | "hashtags" | "scheduled_at" | "status" | "media_urls">>,
): Promise<SocialPost> {
  return apiClient.patch<SocialPost>(`/social/${id}`, patch);
}

export async function deleteSocialPost(id: string): Promise<void> {
  await apiClient.delete<void>(`/social/${id}`);
}

export async function generateSocialPost(data: {
  project_id: string;
  platform: SocialPlatform;
  post_type?: SocialPostType;
  article_id?: string;
}): Promise<SocialPost> {
  return apiClient.post<SocialPost>("/social/generate", data);
}

export async function scheduleSocialPost(id: string, scheduled_at: string): Promise<SocialPost> {
  return apiClient.post<SocialPost>(`/social/${id}/schedule`, { scheduled_at });
}

export async function publishSocialPost(id: string): Promise<SocialPost> {
  return apiClient.post<SocialPost>(`/social/${id}/publish`, {});
}

// ─── Image Studio types & helpers ─────────────────────────────────────────────

export type ImageStyle = "photorealistic" | "illustration" | "minimalist" | "abstract" | "professional";
export type ImageStatus = "pending" | "generating" | "ready" | "failed";
export type ImageUsage = "article_cover" | "social_post" | "brand_asset" | "custom";

export interface GeneratedImage {
  id: string;
  project_id: string;
  prompt: string;
  revised_prompt: string | null;
  style: ImageStyle;
  usage: ImageUsage;
  status: ImageStatus;
  image_url: string | null;
  thumbnail_url: string | null;
  width: number;
  height: number;
  article_id: string | null;
  social_post_id: string | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
}

export async function listImages(projectId: string, usage?: ImageUsage): Promise<GeneratedImage[]> {
  const params = new URLSearchParams({ project_id: projectId });
  if (usage) params.set("usage", usage);
  return apiClient.get<GeneratedImage[]>(`/images?${params.toString()}`);
}

export async function generateImage(data: {
  project_id: string;
  prompt?: string;
  title?: string;
  keyword?: string;
  style?: ImageStyle;
  usage?: ImageUsage;
  article_id?: string;
  social_post_id?: string;
}): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/generate", data);
}

export async function deleteImage(id: string): Promise<void> {
  await apiClient.delete<void>(`/images/${id}`);
}

export async function attachImage(id: string, data: { article_id?: string; social_post_id?: string }): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>(`/images/${id}/attach`, data);
}

// ─── Analytics types & helpers ─────────────────────────────────────────────

export interface AnalyticsOverview {
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  clicks_change: number;
  impressions_change: number;
  ctr_change: number;
  position_change: number;
}

export interface TrafficDataPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
}

export interface RankingRow {
  keyword_id: string;
  keyword: string;
  search_volume: number | null;
  intent: string | null;
  difficulty: number | null;
  current_position: number | null;
  position_change: number | null;
}

export interface ContentPerformanceRow {
  article_id: string;
  title: string;
  published_url: string | null;
  status: string;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface TopPageRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
}

export interface TopQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
}

export interface GscStatus {
  is_connected: boolean;
  google_email: string | null;
  site_url: string | null;
  last_synced_at: string | null;
}

export type AnalyticsRange = "7d" | "28d" | "90d";

export async function getAnalyticsOverview(
  projectId: string,
  range: AnalyticsRange = "28d",
): Promise<AnalyticsOverview> {
  return apiClient.get<AnalyticsOverview>(
    `/analytics/overview?project_id=${projectId}&range=${range}`,
  );
}

export async function getAnalyticsTraffic(
  projectId: string,
  range: AnalyticsRange = "28d",
): Promise<TrafficDataPoint[]> {
  return apiClient.get<TrafficDataPoint[]>(
    `/analytics/traffic?project_id=${projectId}&range=${range}`,
  );
}

export async function getAnalyticsRankings(
  projectId: string,
  sortBy: "position" | "volume" | "change" = "position",
  page: number = 1,
): Promise<RankingRow[]> {
  return apiClient.get<RankingRow[]>(
    `/analytics/rankings?project_id=${projectId}&sort_by=${sortBy}&page=${page}`,
  );
}

export async function getTopPages(projectId: string): Promise<TopPageRow[]> {
  return apiClient.get<TopPageRow[]>(`/analytics/top-pages?project_id=${projectId}`);
}

export async function getTopQueries(projectId: string): Promise<TopQueryRow[]> {
  return apiClient.get<TopQueryRow[]>(`/analytics/top-queries?project_id=${projectId}`);
}

export async function getContentPerformance(
  projectId: string,
): Promise<ContentPerformanceRow[]> {
  return apiClient.get<ContentPerformanceRow[]>(
    `/analytics/content-performance?project_id=${projectId}`,
  );
}

export async function getGscStatus(projectId: string): Promise<GscStatus> {
  return apiClient.get<GscStatus>(`/analytics/gsc/status?project_id=${projectId}`);
}

export async function connectGsc(projectId: string): Promise<{ redirect_url: string }> {
  return apiClient.post<{ redirect_url: string }>(
    `/analytics/gsc/connect?project_id=${projectId}`,
    {},
  );
}

export async function disconnectGsc(projectId: string): Promise<void> {
  return apiClient.delete<void>(`/analytics/gsc/disconnect?project_id=${projectId}`);
}
