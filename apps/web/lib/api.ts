const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fennex_access_token");
}

// Shared in-flight refresh promise — prevents parallel refresh storms
let _refreshPromise: Promise<void> | null = null;

async function _attemptRefresh(): Promise<void> {
  const refreshToken =
    typeof window !== "undefined"
      ? localStorage.getItem("fennex_refresh_token")
      : null;
  if (!refreshToken) throw new Error("no refresh token");

  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error("refresh failed");

  const data: TokenResponse = await res.json();
  localStorage.setItem("fennex_access_token", data.access_token);
  localStorage.setItem("fennex_refresh_token", data.refresh_token);
}

function _redirectToLogin(): never {
  authLogout();
  window.location.href = "/login";
  throw new ApiError(401, "Session expired");
}

async function request<T>(path: string, init: RequestInit = {}, _isRetry = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });

  if (res.status === 401 && !_isRetry && !path.startsWith("/auth/")) {
    // Coalesce concurrent 401s into a single refresh attempt
    if (!_refreshPromise) {
      _refreshPromise = _attemptRefresh().finally(() => { _refreshPromise = null; });
    }
    try {
      await _refreshPromise;
      return request<T>(path, init, true);
    } catch {
      _redirectToLogin();
    }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "object" && body.detail !== null) {
        detail = body.detail as Record<string, unknown>;
        msg = (detail.code as string) ?? msg;
      } else {
        msg = body.detail ?? body.message ?? msg;
      }
    } catch {}
    throw new ApiError(res.status, msg, detail);
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
  language: string;
}

export async function getMe(): Promise<UserProfile> {
  return apiClient.get<UserProfile>("/users/me");
}

export async function updateMyLanguage(language: string): Promise<{ language: string }> {
  return apiClient.patch<{ language: string }>("/users/me/language", { language });
}

// ─── Project types & helpers ───────────────────────────────────────────────

export type ProjectPersona = "creator" | "ecommerce" | "freelancer" | "company";

export interface Project {
  id: string;
  org_id: string;
  name: string;
  domain: string;
  locale: string;
  target_country: string | null;
  industry: string | null;
  persona?: ProjectPersona | null;
  persona_data?: Record<string, unknown> | null;
  autopilot_enabled: boolean;
  theme?: string | null;
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
  persona?: ProjectPersona;
  persona_data?: Record<string, unknown>;
}): Promise<Project> {
  return apiClient.post<Project>("/projects", data);
}

export async function listProjects(): Promise<Project[]> {
  return apiClient.get<Project[]>("/projects");
}

export async function updateProject(
  projectId: string,
  patch: Partial<Pick<Project, "name" | "domain" | "locale" | "target_country" | "industry" | "persona" | "persona_data" | "autopilot_enabled" | "theme">>,
): Promise<Project> {
  return apiClient.put<Project>(`/projects/${projectId}`, patch);
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

export type ArticleStatus = "draft" | "generating" | "ready" | "published" | "failed";

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
  geo_score: number | null;
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

export async function generateArticle(
  id: string,
  options?: { provider?: string; model?: string },
): Promise<Article> {
  return apiClient.post<Article>(`/articles/${id}/generate`, options ?? {});
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

export type SocialPlatform = "linkedin" | "twitter" | "instagram" | "facebook" | "tiktok";
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

// Influencer Studio — LLM per-network variants
export interface StudioVariant {
  platform: SocialPlatform;
  hooks: string[];
  content: string;
  hashtags: string[];
  char_count: number;
  best_time?: { day: string; time: string } | null;
}
export async function generateSocialStudio(data: {
  project_id: string;
  topic: string;
  platforms: SocialPlatform[];
  tone?: string;
  keyword?: string | null;
}): Promise<{ ok: boolean; error?: string | null; variants: StudioVariant[] }> {
  return apiClient.post<{ ok: boolean; error?: string | null; variants: StudioVariant[] }>(
    "/social/studio", data,
  );
}

export async function publishSocialPost(id: string): Promise<SocialPost> {
  return apiClient.post<SocialPost>(`/social/${id}/publish`, {});
}

// ─── Image Studio types & helpers ─────────────────────────────────────────────

export type ImageStyle =
  | "photorealistic"
  | "illustration"
  | "minimalist"
  | "abstract"
  | "professional"
  | "3d_render"
  | "anime"
  | "cinematic"
  | "luxury_product";
export type ImageStatus = "pending" | "generating" | "ready" | "failed";
export type ImageUsage = "article_cover" | "social_post" | "brand_asset" | "product_shot" | "custom";

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
  source_image_id: string | null;
  edit_operation: string | null;
  alt_text?: string | null;
  caption?: string | null;
  seo_filename?: string | null;
  social_platform?: string | null;
  folder_id?: string | null;
  tags?: string[];
  is_deleted?: boolean;
  banner_format?: string | null;
}

export async function listImages(projectId: string, usage?: ImageUsage, folderId?: string | null): Promise<GeneratedImage[]> {
  const params = new URLSearchParams({ project_id: projectId });
  if (usage) params.set("usage", usage);
  if (folderId) params.set("folder_id", folderId);
  return apiClient.get<GeneratedImage[]>(`/images?${params.toString()}`);
}

export async function getImage(imageId: string): Promise<GeneratedImage> {
  return apiClient.get<GeneratedImage>(`/images/${imageId}`);
}

export interface CampaignAsset {
  title: string;
  prompt: string;
  style: ImageStyle;
  usage: ImageUsage;
  platform: string | null;
  caption: string;
}

export interface CampaignPlan {
  title: string;
  summary: string;
  assets: CampaignAsset[];
}

export async function planCampaign(goal: string, useBrandKit = false, projectId?: string): Promise<CampaignPlan> {
  return apiClient.post<CampaignPlan>("/images/plan-campaign", {
    goal,
    use_brand_kit: useBrandKit,
    project_id: projectId ?? null,
  });
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
  quality?: "standard" | "hd";
  reference_image?: string;
  use_brand_kit?: boolean;
  social_platform?: string;
}): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/generate", data);
}

export async function deleteImage(id: string): Promise<void> {
  await apiClient.delete<void>(`/images/${id}`);
}

export async function attachImage(id: string, data: { article_id?: string; social_post_id?: string }): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>(`/images/${id}/attach`, data);
}

export async function improvePrompt(data: {
  prompt: string;
  usage?: ImageUsage;
  style?: ImageStyle;
}): Promise<{ improved_prompt: string }> {
  return apiClient.post<{ improved_prompt: string }>("/images/improve-prompt", data);
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
  keyword_id: string | null;
  keyword: string;
  search_volume: number | null;
  intent: string | null;
  difficulty: number | null;
  current_position: number | null;
  position_change: number | null;
  clicks: number;
  impressions: number;
  tracked: boolean;
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
  offset = 0,
): Promise<TrafficDataPoint[]> {
  return apiClient.get<TrafficDataPoint[]>(
    `/analytics/traffic?project_id=${projectId}&range=${range}&offset=${offset}`,
  );
}

export async function getAnalyticsRankings(
  projectId: string,
  sortBy: "position" | "clicks" | "volume" | "change" = "clicks",
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

export interface OpportunityRow {
  query: string;
  url: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  potential_clicks: number;
  kind: "striking_distance" | "ctr_win";
}

export interface OpportunitiesResponse {
  striking_distance: OpportunityRow[];
  ctr_wins: OpportunityRow[];
  total_potential_clicks: number;
}

export async function getOpportunities(projectId: string): Promise<OpportunitiesResponse> {
  return apiClient.get<OpportunitiesResponse>(`/analytics/opportunities?project_id=${projectId}`);
}

export interface TopicCluster {
  topic: string;
  query_count: number;
  clicks: number;
  impressions: number;
  avg_position: number;
  top_query: string;
}

export type IdeaType = "question" | "how-to" | "comparison" | "commercial" | "list" | "informational";

export interface ContentIdea {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
  idea_type: IdeaType;
}

export interface MarketInsights {
  clusters: TopicCluster[];
  ideas: ContentIdea[];
  total_clicks: number;
  total_impressions: number;
}

export async function getMarketInsights(projectId: string): Promise<MarketInsights> {
  return apiClient.get<MarketInsights>(`/analytics/market-insights?project_id=${projectId}`);
}

export interface CompetitorScorecard {
  score: number;
  title: string;
  title_length: number;
  meta_description: string;
  meta_length: number;
  word_count: number;
  h1_count: number;
  h2_count: number;
  schema_types: string[];
  images_without_alt: number;
  internal_links: number;
  canonical: string | null;
  checks: Record<string, boolean>;
}

export interface CompetitorAnalysis {
  ok: boolean;
  error?: string | null;
  url?: string | null;
  scorecard?: CompetitorScorecard | null;
  outline: string[];
  insights: string;
}

export async function analyzeCompetitorPage(projectId: string, url: string): Promise<CompetitorAnalysis> {
  return apiClient.post<CompetitorAnalysis>(`/analytics/competitor?project_id=${projectId}`, { url });
}

export interface AnalyticsChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChartSpec {
  type: "bar" | "line";
  title?: string;
  x_key: string;
  series: { key: string; name: string }[];
  data: Record<string, unknown>[];
}

export interface AiAgentResponse {
  answer: string;
  chart?: AgentChartSpec | null;
  followups?: string[];
}

export type AnalyticsPersona = "creator" | "ecommerce" | "freelancer" | "company";

export async function askAnalyticsAgent(
  projectId: string,
  question: string,
  history: AnalyticsChatTurn[] = [],
  persona: AnalyticsPersona = "creator",
): Promise<AiAgentResponse> {
  return apiClient.post<AiAgentResponse>(`/analytics/ai-agent?project_id=${projectId}`, {
    question,
    history,
    persona,
  });
}

export interface HealthComponent {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface HealthScore {
  score: number;
  grade: string;
  components: HealthComponent[];
  has_data: boolean;
}

export async function getHealthScore(projectId: string): Promise<HealthScore> {
  return apiClient.get<HealthScore>(`/analytics/health-score?project_id=${projectId}`);
}

export interface NorthStar {
  key: string;
  label: string;
  value: number;
  unit: string;
  change: number | null;
  context: string | null;
  trend: number[];
}

export interface SecondaryMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  change: number | null;
  invert_change: boolean;
}

export interface FocusItem {
  label: string;
  detail: string;
}

export interface FocusList {
  title: string;
  items: FocusItem[];
}

export interface PersonaHome {
  persona: string;
  north_star: NorthStar;
  secondary: SecondaryMetric[];
  focus: FocusList;
}

export async function getPersonaHome(projectId: string, persona: string): Promise<PersonaHome> {
  return apiClient.get<PersonaHome>(`/analytics/persona-home?project_id=${projectId}&persona=${persona}`);
}

export interface PlanHint {
  key: string;   // capability: keywords | articles | social | competitors
  query: string;
  a: number;
  b: number;
}

export interface PlanGrounding {
  has_data: boolean;
  hints: PlanHint[];
}

export async function getPlanGrounding(projectId: string): Promise<PlanGrounding> {
  return apiClient.get<PlanGrounding>(`/analytics/plan-grounding?project_id=${projectId}`);
}

export interface DigestResult {
  ok: boolean;
  sent: number;
  recipients?: string[];
  subject?: string;
  error?: string | null;
}

export async function sendDigestNow(projectId: string): Promise<DigestResult> {
  return apiClient.post<DigestResult>(`/analytics/digest/send-now?project_id=${projectId}`, {});
}

export interface MarketReport {
  ok: boolean;
  title?: string;
  markdown?: string;
  generated_at?: string;
  error?: string;
}

export async function generateMarketReport(projectId: string): Promise<MarketReport> {
  return apiClient.post<MarketReport>(`/analytics/market-report?project_id=${projectId}`, {});
}

export interface OutreachPost {
  day: string;
  type: string;
  content: string;
  hashtags: string[];
}

export interface OutreachMessage {
  scenario: string;
  content: string;
}

export interface OutreachPlan {
  ok: boolean;
  posts?: OutreachPost[];
  messages?: OutreachMessage[];
  tips?: string[];
  drafts_saved?: number;
  error?: string;
}

export async function planOutreach(projectId: string, goal: string, audience?: string): Promise<OutreachPlan> {
  return apiClient.post<OutreachPlan>(`/social/outreach-plan?project_id=${projectId}`, { goal, audience: audience ?? "" });
}

export interface IcpSegment {
  name: string;
  description: string;
  pains: string[];
  channels: string[];
  angle: string;
}
export async function generateIcp(projectId: string): Promise<{ ok: boolean; error?: string; segments?: IcpSegment[] }> {
  return apiClient.post<{ ok: boolean; error?: string; segments?: IcpSegment[] }>(
    `/analytics/icp?project_id=${projectId}`, {},
  );
}

export interface TestimonialPiece {
  format: "linkedin_post" | "case_study" | "quote_card" | "website_blurb";
  content: string;
}
export async function generateTestimonialContent(
  projectId: string,
  data: { testimonial: string; client?: string; service?: string },
): Promise<{ ok: boolean; error?: string; pieces?: TestimonialPiece[] }> {
  return apiClient.post<{ ok: boolean; error?: string; pieces?: TestimonialPiece[] }>(
    `/social/testimonial-content?project_id=${projectId}`, data,
  );
}

export interface RecommendationMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  captured_at?: string;
}

export interface DetectedContent {
  type: "article" | "social";
  id: string;
  title: string;
  matched_on: string;
}

export interface Recommendation {
  id: string;
  source: "opportunity" | "agent";
  source_agent: string | null;
  kind: string | null;
  title: string;
  detail: string | null;
  anchor_query: string | null;
  anchor_url: string | null;
  status: "tracking" | "done" | "dismissed";
  outcome: "pending" | "won" | "flat" | "declined" | null;
  impact_score: number | null;
  baseline: RecommendationMetrics | null;
  latest: RecommendationMetrics | null;
  detected_content: DetectedContent[] | null;
  done_at: string | null;
  measured_at: string | null;
}

export interface RecommendationSummary {
  acted: number;
  won: number;
  measuring: number;
  won_clicks: number;
}

export interface TrackRecommendationInput {
  source: "opportunity" | "agent";
  source_agent?: string;
  kind?: string;
  title: string;
  detail?: string;
  anchor_query?: string;
  anchor_url?: string;
}

export async function trackRecommendation(projectId: string, input: TrackRecommendationInput): Promise<Recommendation> {
  return apiClient.post<Recommendation>(`/recommendations?project_id=${projectId}`, input);
}

export async function listRecommendations(projectId: string, status?: string): Promise<Recommendation[]> {
  const q = status ? `&status=${status}` : "";
  return apiClient.get<Recommendation[]>(`/recommendations?project_id=${projectId}${q}`);
}

export async function updateRecommendation(id: string, status: "done" | "dismissed"): Promise<Recommendation> {
  return apiClient.patch<Recommendation>(`/recommendations/${id}`, { status });
}

export async function getRecommendationSummary(projectId: string): Promise<RecommendationSummary> {
  return apiClient.get<RecommendationSummary>(`/recommendations/summary?project_id=${projectId}`);
}

export async function connectLinkedIn(returnTo = "/"): Promise<{ redirect_url: string }> {
  return apiClient.post<{ redirect_url: string }>(
    `/social/linkedin/connect?return_to=${encodeURIComponent(returnTo)}`,
    {},
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

export interface GscSite {
  site_url: string;
  permission_level: string;
}

export interface GscSyncResult {
  ok: boolean;
  days: number;
  date_points: number;
  queries: number;
  pages: number;
  keywords_matched: number;
  last_synced_at: string | null;
  error?: string | null;
}

export async function getGscSites(projectId: string): Promise<GscSite[]> {
  return apiClient.get<GscSite[]>(`/analytics/gsc/sites?project_id=${projectId}`);
}

export async function selectGscSite(projectId: string, siteUrl: string): Promise<GscStatus> {
  return apiClient.post<GscStatus>(`/analytics/gsc/select-site?project_id=${projectId}`, {
    site_url: siteUrl,
  });
}

export async function syncGsc(projectId: string, days = 90): Promise<GscSyncResult> {
  return apiClient.post<GscSyncResult>(`/analytics/gsc/sync?project_id=${projectId}&days=${days}`, {});
}

export async function disconnectGsc(projectId: string): Promise<void> {
  return apiClient.delete<void>(`/analytics/gsc/disconnect?project_id=${projectId}`);
}

// ─── Backlinks ────────────────────────────────────────────────────────────────

export interface BacklinkProfile {
  id: string;
  project_id: string;
  domain: string | null;
  total_backlinks: number;
  domain_authority: number | null;
  trust_score: number | null;
  spam_score: number | null;
  referring_domains: number;
  last_synced_at: string | null;
}

export interface BacklinkItem {
  id: string;
  source_url: string;
  source_domain: string | null;
  target_url: string | null;
  anchor_text: string | null;
  domain_authority: number | null;
  trust_score: number | null;
  is_spam: boolean;
  link_type: string;
  first_seen: string | null;
  last_seen: string | null;
}

export interface BacklinkOpportunity {
  id: string;
  source_domain: string | null;
  source_url: string;
  domain_authority: number | null;
  trust_score: number | null;
  is_spam: boolean;
  linking_to_competitor: string | null;
  status: string;
}

export interface ExchangeListing {
  id: string;
  project_id: string;
  site_url: string;
  niche: string | null;
  language: string | null;
  domain_authority: number | null;
  description: string | null;
  is_active: boolean;
}

export interface ExchangeRequest {
  id: string;
  requester_project_id: string;
  target_project_id: string;
  requester_org_id: string;
  target_org_id: string;
  status: string;
  requester_url: string | null;
  target_url: string | null;
  requester_link_verified: boolean;
  target_link_verified: boolean;
}

export interface ExchangeMessage {
  id: string;
  request_id: string;
  sender_org_id: string;
  body: string;
  created_at: string | null;
}

export async function getBacklinkProfile(projectId: string): Promise<BacklinkProfile> {
  return apiClient.get<BacklinkProfile>(`/backlinks/profile?project_id=${projectId}`);
}

export async function analyzeBacklinks(projectId: string): Promise<{ job_id: string; status: string }> {
  return apiClient.post<{ job_id: string; status: string }>(`/backlinks/analyze?project_id=${projectId}`, {});
}

export async function listBacklinks(projectId: string, page: number, isSpam?: boolean): Promise<BacklinkItem[]> {
  const spam = isSpam !== undefined ? `&is_spam=${isSpam}` : "";
  return apiClient.get<BacklinkItem[]>(`/backlinks?project_id=${projectId}&page=${page}${spam}`);
}

export async function listOpportunities(projectId: string, status?: string): Promise<BacklinkOpportunity[]> {
  const q = status ? `&status=${status}` : "";
  return apiClient.get<BacklinkOpportunity[]>(`/backlinks/opportunities?project_id=${projectId}${q}`);
}

export async function updateOpportunityStatus(id: string, status: string): Promise<BacklinkOpportunity> {
  return apiClient.patch<BacklinkOpportunity>(`/backlinks/opportunities/${id}`, { status });
}

export async function getExchangeBoard(projectId: string, niche?: string, language?: string): Promise<ExchangeListing[]> {
  const q = [niche ? `niche=${niche}` : "", language ? `language=${language}` : ""].filter(Boolean).join("&");
  return apiClient.get<ExchangeListing[]>(`/backlinks/exchange/board?project_id=${projectId}${q ? `&${q}` : ""}`);
}

export async function getOwnListing(projectId: string): Promise<ExchangeListing> {
  return apiClient.get<ExchangeListing>(`/backlinks/exchange/listing?project_id=${projectId}`);
}

export async function upsertExchangeListing(projectId: string, data: { site_url: string; niche?: string; language?: string; domain_authority?: number; description?: string }): Promise<ExchangeListing> {
  return apiClient.post<ExchangeListing>(`/backlinks/exchange/listing?project_id=${projectId}`, data);
}

export async function deleteExchangeListing(projectId: string): Promise<void> {
  return apiClient.delete<void>(`/backlinks/exchange/listing?project_id=${projectId}`);
}

export async function listExchangeRequests(projectId: string, role?: "sent" | "received"): Promise<ExchangeRequest[]> {
  const q = role ? `&role=${role}` : "";
  return apiClient.get<ExchangeRequest[]>(`/backlinks/exchange/requests?project_id=${projectId}${q}`);
}

export async function createExchangeRequest(projectId: string, data: { target_project_id: string; requester_url: string; target_url: string; initial_message?: string }): Promise<ExchangeRequest> {
  return apiClient.post<ExchangeRequest>(`/backlinks/exchange/requests?project_id=${projectId}`, data);
}

export async function updateExchangeRequest(requestId: string, status: string): Promise<ExchangeRequest> {
  return apiClient.patch<ExchangeRequest>(`/backlinks/exchange/requests/${requestId}`, { status });
}

export async function verifyExchangeLink(requestId: string, side: "requester" | "target"): Promise<{ job_id: string; status: string }> {
  return apiClient.post<{ job_id: string; status: string }>(`/backlinks/exchange/requests/${requestId}/verify?side=${side}`, {});
}

export async function getExchangeMessages(requestId: string): Promise<ExchangeMessage[]> {
  return apiClient.get<ExchangeMessage[]>(`/backlinks/exchange/requests/${requestId}/messages`);
}

export async function sendExchangeMessage(requestId: string, body: string): Promise<ExchangeMessage> {
  return apiClient.post<ExchangeMessage>(`/backlinks/exchange/requests/${requestId}/messages`, { body });
}

// ── LLM API Keys ─────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  provider: string;
  masked_value: string;
  created_at: string | null;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return apiClient.get<ApiKey[]>("/api-keys");
}

export async function createApiKey(provider: string, value: string): Promise<ApiKey> {
  return apiClient.post<ApiKey>("/api-keys", { provider, value });
}

export async function deleteApiKey(keyId: string): Promise<void> {
  return apiClient.delete<void>(`/api-keys/${keyId}`);
}

// ── Social Connections ────────────────────────────────────────────────────────

export interface SocialConnection {
  id: string;
  platform: string;
  handle: string | null;
}

export async function listSocialConnections(): Promise<SocialConnection[]> {
  return apiClient.get<SocialConnection[]>("/social/connections");
}

export async function upsertSocialConnection(
  platform: string,
  handle: string | null,
  token: string
): Promise<SocialConnection> {
  return apiClient.put<SocialConnection>(`/social/connections/${platform}`, { handle, token });
}

export async function deleteSocialConnection(platform: string): Promise<void> {
  return apiClient.delete<void>(`/social/connections/${platform}`);
}

// ── Team / RBAC ───────────────────────────────────────────────────────────────

export interface OrgMember {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  invite_link: string;
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  return apiClient.get<OrgMember[]>(`/organizations/${orgId}/members`);
}

export async function inviteMember(orgId: string, email: string, role: string): Promise<OrgInvite> {
  return apiClient.post<OrgInvite>(`/organizations/${orgId}/invites`, { email, role });
}

export async function updateMemberRole(orgId: string, userId: string, role: string): Promise<OrgMember> {
  return apiClient.patch<OrgMember>(`/organizations/${orgId}/members/${userId}`, { role });
}

export async function deactivateMember(orgId: string, userId: string): Promise<void> {
  return apiClient.delete<void>(`/organizations/${orgId}/members/${userId}`);
}

// ── Billing ────────────────────────────────────────────────────────────────

export interface BillingUsageResource {
  used: number;
  limit: number;
  pct: number;
}

export interface BillingUsage {
  plan_tier: string;
  trial_ends_at: string | null;
  period_start: string;
  usage: Record<string, BillingUsageResource>;
}

export async function createCheckoutSession(
  tier: string,
  annual: boolean,
  successUrl: string,
  cancelUrl: string,
): Promise<{ checkout_url: string }> {
  return apiClient.post<{ checkout_url: string }>("/billing/checkout", {
    tier,
    annual,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function createPortalSession(
  returnUrl: string,
): Promise<{ portal_url: string }> {
  return apiClient.post<{ portal_url: string }>("/billing/portal", {
    return_url: returnUrl,
  });
}

export async function getBillingUsage(): Promise<BillingUsage> {
  return apiClient.get<BillingUsage>("/billing/usage");
}

// ── Brand Kit ─────────────────────────────────────────────────────────────────

export interface BrandKit {
  logo_url: string | null;
  colors: string[];
  primary_font: string | null;
  secondary_font: string | null;
  style_rules: string | null;
  tone: string | null;
}

export async function getBrandKit(): Promise<BrandKit> {
  return apiClient.get<BrandKit>("/brand-kit");
}

export async function updateBrandKit(
  data: Partial<Omit<BrandKit, "logo_url">>,
): Promise<BrandKit> {
  return apiClient.put<BrandKit>("/brand-kit", data);
}

export async function uploadBrandLogo(file: File): Promise<BrandKit> {
  const formData = new FormData();
  formData.append("file", file);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/v1/brand-kit/logo`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

// ── Image Editing ──────────────────────────────────────────────────────────────

export interface EditImageResult {
  ok: boolean;
  image_url: string | null;
  image_id: string | null;
  error: string | null;
}

export async function editImage(
  imageId: string,
  operation: string,
  params?: Record<string, unknown>,
): Promise<EditImageResult> {
  return apiClient.post<EditImageResult>(`/images/${imageId}/edit`, { operation, params });
}

export interface SeoResult {
  id: string;
  alt_text: string | null;
  caption: string | null;
  seo_filename: string | null;
}

export async function generateImageSeo(imageId: string): Promise<SeoResult> {
  return apiClient.post<SeoResult>(`/images/${imageId}/seo`, {});
}

export async function resizeToPlatforms(imageId: string, platforms: string[]): Promise<GeneratedImage[]> {
  return apiClient.post<GeneratedImage[]>(`/images/${imageId}/resize-set`, { platforms });
}

// ── Campaign collections ─────────────────────────────────────────────────────

export interface ImageCollection {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  image_count: number;
  cover_url: string | null;
}

export interface ImageCollectionDetail extends ImageCollection {
  images: GeneratedImage[];
}

export async function listCollections(projectId: string): Promise<ImageCollection[]> {
  return apiClient.get<ImageCollection[]>(`/collections?project_id=${projectId}`);
}

export async function getCollection(collectionId: string): Promise<ImageCollectionDetail> {
  return apiClient.get<ImageCollectionDetail>(`/collections/${collectionId}`);
}

export async function createCollection(data: {
  project_id: string;
  name: string;
  description?: string;
  image_ids?: string[];
}): Promise<ImageCollectionDetail> {
  return apiClient.post<ImageCollectionDetail>("/collections", data);
}

export async function deleteCollection(collectionId: string): Promise<void> {
  return apiClient.delete<void>(`/collections/${collectionId}`);
}

export async function addImagesToCollection(collectionId: string, imageIds: string[]): Promise<ImageCollectionDetail> {
  return apiClient.post<ImageCollectionDetail>(`/collections/${collectionId}/images`, { image_ids: imageIds });
}

export interface ExportResult {
  download_url: string;
  format: string;
  size_bytes: number;
  width: number;
  height: number;
}

export type ExportFormat = "png" | "jpg" | "webp";

export async function exportImage(
  imageId: string,
  format: ExportFormat = "webp",
  quality = 85,
  width?: number,
): Promise<ExportResult> {
  return apiClient.post<ExportResult>(`/images/${imageId}/export`, {
    format,
    quality,
    width: width ?? null,
  });
}

export interface ImageSuggestion {
  placement: string;
  section_hint: string;
  image_concept: string;
  suggested_prompt: string;
}

export async function suggestImagesForArticle(articleId: string): Promise<ImageSuggestion[]> {
  return apiClient.post<ImageSuggestion[]>(`/articles/${articleId}/suggest-images`, {});
}

export interface ProductSceneRequest {
  project_id: string;
  product_image_url: string;
  product_description: string;
  scene_id: string;
  use_brand_kit: boolean;
}

export async function generateProductScene(body: ProductSceneRequest): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/product-scene", body);
}

export interface MarketingBannerRequest {
  project_id: string;
  product: string;
  offer: string;
  cta: string;
  style?: string;
  format_ids?: string[];
  use_brand_kit?: boolean;
}

export async function generateMarketingBanners(body: MarketingBannerRequest): Promise<GeneratedImage[]> {
  return apiClient.post<GeneratedImage[]>("/images/marketing-banners", body);
}

// ── Image Publishing ──────────────────────────────────────────────────────────

export interface PublishRecord {
  id: string;
  image_id: string;
  platform: string;
  external_id: string | null;
  external_url: string | null;
  published_at: string;
  error: string | null;
}

export async function publishImage(
  imageId: string,
  platform: string,
  config?: Record<string, string>,
): Promise<PublishRecord> {
  return apiClient.post<PublishRecord>(`/images/${imageId}/publish`, { platform, config: config ?? {} });
}

// ── DAM — Folders, Tags, Search ───────────────────────────────────────────────

export interface ImageFolder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
}

export async function listImageFolders(): Promise<ImageFolder[]> {
  return apiClient.get<ImageFolder[]>("/image-folders");
}

export async function createImageFolder(name: string, color?: string): Promise<ImageFolder> {
  return apiClient.post<ImageFolder>("/image-folders", { name, color });
}

export async function deleteImageFolder(folderId: string): Promise<void> {
  return apiClient.delete<void>(`/image-folders/${folderId}`);
}

export async function moveImageToFolder(imageId: string, folderId: string | null): Promise<GeneratedImage> {
  return apiClient.patch<GeneratedImage>(`/images/${imageId}/folder`, { folder_id: folderId });
}

export async function tagImage(imageId: string, tags: string[]): Promise<GeneratedImage> {
  return apiClient.patch<GeneratedImage>(`/images/${imageId}/tags`, { tags });
}

export async function searchImages(projectId: string, q: string, folderId?: string): Promise<GeneratedImage[]> {
  const params = new URLSearchParams({ project_id: projectId, q });
  if (folderId) params.set("folder_id", folderId);
  return apiClient.get<GeneratedImage[]>(`/images/search?${params}`);
}

export async function uploadImage(projectId: string, file: File | Blob): Promise<GeneratedImage> {
  const formData = new FormData();
  formData.append("project_id", projectId);
  const f = file instanceof File ? file : new File([file], "canvas-export.png", { type: "image/png" });
  formData.append("file", f);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/v1/images/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new ApiError(res.status, text);
  }
  return res.json();
}

// ── AI Design Assistant ───────────────────────────────────────────────────────

export interface AiCommandMessage {
  role: "user" | "assistant";
  content: string;
}

export async function sendAiCommand(
  imageId: string,
  command: string,
  history: AiCommandMessage[],
  maskBase64?: string,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>(`/images/${imageId}/ai-command`, {
    command,
    history,
    mask_base64: maskBase64 ?? null,
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface StudioTemplate {
  id: string;
  label: string;
  category: string;
  description: string;
  slots: Record<string, string>;
  width: number;
  height: number;
}

export async function listTemplates(): Promise<StudioTemplate[]> {
  return apiClient.get<StudioTemplate[]>("/templates");
}

export async function generateFromTemplate(
  projectId: string,
  templateId: string,
  slots: Record<string, string>,
  useBrandKit = false,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/from-template", {
    project_id: projectId,
    template_id: templateId,
    slots,
    use_brand_kit: useBrandKit,
  });
}

// ── Analytics / Scoring ───────────────────────────────────────────────────────

export interface ImageScore {
  image_id: string;
  visual_quality: number | null;
  brand_consistency: number | null;
  seo_score: number | null;
  ad_performance: number | null;
  overall: number | null;
  feedback: string | null;
  scored_at: string | null;
}

export async function scoreImage(imageId: string): Promise<ImageScore> {
  return apiClient.post<ImageScore>(`/images/${imageId}/score`, {});
}

export async function getImageScore(imageId: string): Promise<ImageScore> {
  return apiClient.get<ImageScore>(`/images/${imageId}/score`);
}

// ── Premium AI ────────────────────────────────────────────────────────────────

export interface ABTestResult {
  test_id: string;
  variants: GeneratedImage[];
}

export async function createABTest(
  projectId: string,
  concept: string,
  variantCount: number,
  useBrandKit = false,
): Promise<ABTestResult> {
  return apiClient.post<ABTestResult>("/images/ab-test", {
    project_id: projectId,
    concept,
    variant_count: variantCount,
    use_brand_kit: useBrandKit,
  });
}

export interface Trend {
  id: string;
  label: string;
  category: string;
  description: string;
}

export async function listTrends(): Promise<Trend[]> {
  return apiClient.get<Trend[]>("/trends");
}

export async function generateFromTrend(
  projectId: string,
  trendId: string,
  subject: string,
  useBrandKit = false,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/from-trend", {
    project_id: projectId,
    trend_id: trendId,
    subject,
    use_brand_kit: useBrandKit,
  });
}

export interface CompetitorResult {
  analysis: string;
  improved_image: GeneratedImage;
}

export async function analyzeCompetitor(
  projectId: string,
  competitorUrl: string,
  focus: string,
  useBrandKit = false,
): Promise<CompetitorResult> {
  return apiClient.post<CompetitorResult>("/images/competitor-analysis", {
    project_id: projectId,
    competitor_image_url: competitorUrl,
    improvement_focus: focus,
    use_brand_kit: useBrandKit,
  });
}

// ── Canvas decomposition ─────────────────────────────────────────────────────

export interface CanvasTextElement {
  text: string;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  font_size: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

export interface CanvasObjectElement {
  description: string;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  image_data: string;
}

export interface CanvasBackground {
  description: string;
  dominant_color: string;
  image_data: string;
  image_width: number;
  image_height: number;
}

export interface DecomposeResult {
  text_elements: CanvasTextElement[];
  objects: CanvasObjectElement[];
  background: CanvasBackground;
}

export type InpaintMethod = "diffusion" | "lama";

export async function decomposeImage(
  imageId: string,
  inpaintMethod: InpaintMethod = "diffusion",
): Promise<DecomposeResult> {
  return apiClient.post<DecomposeResult>(`/images/${imageId}/decompose`, {
    inpaint_method: inpaintMethod,
  });
}

// ── Unified Content Calendar ──────────────────────────────────────────────────

export type CalendarContentType = "article" | "social" | "banner";
export type CalendarState = "planned" | "scheduled" | "publishing" | "published" | "failed";

export interface CalendarEntry {
  id: string;
  content_type: CalendarContentType;
  content_id: string;
  title: string;
  scheduled_at: string;
  timezone: string;
  target_kind: "wordpress" | "linkedin" | null;
  connection_id: string | null;
  state: CalendarState;
  error: string | null;
  published_at: string | null;
  published_url: string | null;
}

export interface CreateCalendarEntryInput {
  content_type: CalendarContentType;
  content_id: string;
  scheduled_at: string;
  timezone?: string;
  target_kind?: "wordpress" | "linkedin";
  connection_id?: string;
}

export interface UpdateCalendarEntryInput {
  scheduled_at?: string;
  timezone?: string;
  target_kind?: "wordpress" | "linkedin";
  connection_id?: string;
  state?: CalendarState;
}

export async function listCalendar(projectId: string, start: string, end: string): Promise<CalendarEntry[]> {
  return apiClient.get<CalendarEntry[]>(`/calendar?project_id=${projectId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}
export async function createCalendarEntry(projectId: string, body: CreateCalendarEntryInput): Promise<CalendarEntry> {
  return apiClient.post<CalendarEntry>(`/calendar?project_id=${projectId}`, body);
}
export async function updateCalendarEntry(id: string, patch: UpdateCalendarEntryInput): Promise<CalendarEntry> {
  return apiClient.patch<CalendarEntry>(`/calendar/${id}`, patch);
}
export async function deleteCalendarEntry(id: string): Promise<void> {
  return apiClient.delete<void>(`/calendar/${id}`);
}
export async function publishCalendarEntryNow(id: string): Promise<CalendarEntry> {
  return apiClient.post<CalendarEntry>(`/calendar/${id}/publish-now`, {});
}

// ── Orchestrated Campaigns ─────────────────────────────────────────────────────

export type CampaignStatus = "planned" | "running" | "completed" | "failed" | "cancelled";
export type CampaignStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface CampaignStep {
  id: string;
  order: number;
  agent: string;
  action: string;
  brief: Record<string, unknown> | null;
  why: string | null;
  status: CampaignStepStatus;
  summary: string | null;
  artifact_type: string | null;
  artifact_ids: string[] | null;
  structured: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface Campaign {
  id: string;
  goal: string;
  persona: string;
  status: CampaignStatus;
  director_summary: string | null;
  steps: CampaignStep[];
  source: string;
  week_of: string | null;
}

export async function createCampaign(projectId: string, goal: string): Promise<Campaign> {
  return apiClient.post<Campaign>(`/campaigns?project_id=${projectId}`, { goal });
}
export async function listCampaigns(projectId: string): Promise<Campaign[]> {
  return apiClient.get<Campaign[]>(`/campaigns?project_id=${projectId}`);
}
export async function getCampaign(id: string): Promise<Campaign> {
  return apiClient.get<Campaign>(`/campaigns/${id}`);
}
export async function updateCampaignPlan(id: string, stepIds: string[]): Promise<Campaign> {
  return apiClient.patch<Campaign>(`/campaigns/${id}/plan`, { step_ids: stepIds });
}
export async function runCampaign(id: string): Promise<Campaign> {
  return apiClient.post<Campaign>(`/campaigns/${id}/run`, {});
}
export async function cancelCampaign(id: string): Promise<Campaign> {
  return apiClient.post<Campaign>(`/campaigns/${id}/cancel`, {});
}

// ── Monitoring: alerts + competitor watchlist ─────────────────────────────────

export interface Alert {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string | null;
  url: string;
  is_read: boolean;
  created_at: string;
}

export interface WatchedCompetitor {
  id: string;
  url: string;
  label: string | null;
  last_scanned_at: string | null;
}

export async function listAlerts(
  projectId: string,
  opts?: { unreadOnly?: boolean; kind?: string; limit?: number },
): Promise<Alert[]> {
  const params = new URLSearchParams({ project_id: projectId });
  if (opts?.unreadOnly) params.set("unread_only", "true");
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  return apiClient.get<Alert[]>(`/monitoring/alerts?${params.toString()}`);
}
export async function markAlertRead(alertId: string): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(`/monitoring/alerts/${alertId}/read`, {});
}
export async function markAllAlertsRead(projectId: string): Promise<{ marked: number }> {
  return apiClient.post<{ marked: number }>(`/monitoring/alerts/read-all?project_id=${projectId}`, {});
}
export async function getUnreadAlertCount(projectId: string): Promise<{ count: number }> {
  return apiClient.get<{ count: number }>(`/monitoring/alerts/unread-count?project_id=${projectId}`);
}
export async function listWatchedCompetitors(projectId: string): Promise<WatchedCompetitor[]> {
  return apiClient.get<WatchedCompetitor[]>(`/monitoring/competitors?project_id=${projectId}`);
}
export async function addWatchedCompetitor(
  projectId: string,
  url: string,
  label?: string,
): Promise<WatchedCompetitor> {
  return apiClient.post<WatchedCompetitor>("/monitoring/competitors", {
    project_id: projectId,
    url,
    label,
  });
}
export async function removeWatchedCompetitor(watchId: string): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`/monitoring/competitors/${watchId}`);
}

export interface TrackedKeywordRow {
  id: string;
  keyword: string;
  position: number | null;
  url: string | null;
  features: string[];
  last_checked: string | null;
  delta_7d: number | null;
  delta_30d: number | null;
  spark: { date: string; position: number | null }[];
}

export interface KeywordHistory {
  keyword: string;
  points: { date: string; position: number | null }[];
  top10: { rank: number; domain: string; url: string; title: string }[];
  features: string[];
  url: string | null;
}

export async function getSeoProviderStatus(
  projectId: string,
): Promise<{ connected: boolean; source: string | null }> {
  return apiClient.get<{ connected: boolean; source: string | null }>(
    `/seo/provider-status?project_id=${projectId}`,
  );
}
export interface ShopifyStatus {
  connected: boolean;
  shop_domain: string | null;
  shop_name: string | null;
  last_tested_at?: string | null;
  oauth_available?: boolean;
}
export interface ShopifyConnectResult {
  ok: boolean;
  error?: string | null;
  detail?: string | null;
  shop_domain?: string | null;
  shop_name?: string | null;
}
export async function getShopifyStatus(projectId: string): Promise<ShopifyStatus> {
  return apiClient.get<ShopifyStatus>(`/shopify/status?project_id=${projectId}`);
}
export async function startShopifyOAuth(
  projectId: string,
  shopDomain: string,
): Promise<{ ok: boolean; error?: string | null; redirect_url?: string | null }> {
  return apiClient.post<{ ok: boolean; error?: string | null; redirect_url?: string | null }>(
    "/shopify/oauth/start",
    { project_id: projectId, shop_domain: shopDomain },
  );
}
export async function connectShopify(
  projectId: string,
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<ShopifyConnectResult> {
  return apiClient.post<ShopifyConnectResult>("/shopify/connect", {
    project_id: projectId,
    shop_domain: shopDomain,
    client_id: clientId,
    client_secret: clientSecret,
  });
}
export async function disconnectShopify(projectId: string): Promise<void> {
  return apiClient.delete<void>(`/shopify/disconnect?project_id=${projectId}`);
}
export interface StoreProduct {
  id: string;
  source: string;   // "shopify" | "woocommerce"
  external_id: string;
  title: string;
  handle?: string | null;
  description?: string | null;
  image_url?: string | null;
  price?: string | null;
  status?: string | null;
}
export async function listStoreProducts(projectId: string): Promise<StoreProduct[]> {
  return apiClient.get<StoreProduct[]>(`/store/products?project_id=${projectId}`);
}
export async function syncStoreProducts(projectId: string): Promise<{ ok: boolean; error?: string | null; synced: number }> {
  return apiClient.post<{ ok: boolean; error?: string | null; synced: number }>(
    `/store/products/sync?project_id=${projectId}`, {},
  );
}

// WooCommerce store connection
export interface WooStatus {
  connected: boolean;
  store_url: string | null;
  shop_name: string | null;
  last_tested_at?: string | null;
}
export interface WooConnectResult {
  ok: boolean;
  error?: string | null;
  detail?: string | null;
  store_url?: string | null;
  shop_name?: string | null;
}
export async function getWooStatus(projectId: string): Promise<WooStatus> {
  return apiClient.get<WooStatus>(`/woocommerce/status?project_id=${projectId}`);
}
export async function connectWoo(
  projectId: string,
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
): Promise<WooConnectResult> {
  return apiClient.post<WooConnectResult>("/woocommerce/connect", {
    project_id: projectId,
    store_url: storeUrl,
    consumer_key: consumerKey,
    consumer_secret: consumerSecret,
  });
}
export async function disconnectWoo(projectId: string): Promise<void> {
  return apiClient.delete<void>(`/woocommerce/disconnect?project_id=${projectId}`);
}
export interface ProductCopyResult {
  ok: boolean;
  error?: string | null;
  title?: string | null;
  description_html?: string | null;
  meta_description?: string | null;
}
export async function generateProductCopy(projectId: string, productId: string): Promise<ProductCopyResult> {
  return apiClient.post<ProductCopyResult>(
    `/store/products/${productId}/copy?project_id=${projectId}`, {},
  );
}
export async function publishProductCopy(
  projectId: string,
  productId: string,
  title: string,
  descriptionHtml: string,
): Promise<{ ok: boolean; error?: string | null }> {
  return apiClient.post<{ ok: boolean; error?: string | null }>(
    `/store/products/${productId}/publish-copy`,
    { project_id: projectId, title, description_html: descriptionHtml },
  );
}
export async function listTrackedKeywords(projectId: string): Promise<TrackedKeywordRow[]> {
  return apiClient.get<TrackedKeywordRow[]>(`/seo/keywords?project_id=${projectId}`);
}
export async function addTrackedKeyword(projectId: string, keyword: string): Promise<TrackedKeywordRow> {
  return apiClient.post<TrackedKeywordRow>("/seo/keywords", { project_id: projectId, keyword });
}
export async function removeTrackedKeyword(id: string): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`/seo/keywords/${id}`);
}
export async function refreshTrackedKeyword(id: string): Promise<{ ok: boolean }> {
  return apiClient.post<{ ok: boolean }>(`/seo/keywords/${id}/refresh`, {});
}
export async function getKeywordHistory(id: string, days?: number): Promise<KeywordHistory> {
  const params = days != null ? `?days=${days}` : "";
  return apiClient.get<KeywordHistory>(`/seo/keywords/${id}/history${params}`);
}
export async function getKeywordSuggestions(
  projectId: string,
): Promise<{ keyword: string; impressions: number }[]> {
  return apiClient.get<{ keyword: string; impressions: number }[]>(
    `/seo/suggestions?project_id=${projectId}`,
  );
}

export interface ContentScoreTerm {
  term: string;
  status: "present" | "underused" | "missing";
  count: number;
  target: number;
}

export interface ContentScore {
  score: number;
  terms: ContentScoreTerm[];
  structure: {
    word_count: number;
    target_words: number;
    headings: number;
    target_headings: number;
  };
  questions: string[];
  brief: string | null;
  serp_median_words: number;
  pages_analyzed: number;
}

export async function scoreContent(
  projectId: string,
  keyword: string,
  opts?: { articleId?: string; url?: string; text?: string },
): Promise<ContentScore> {
  return apiClient.post<ContentScore>("/seo/score", {
    project_id: projectId,
    keyword,
    article_id: opts?.articleId,
    url: opts?.url,
    text: opts?.text,
  });
}

// ── Article Studio ─────────────────────────────────────────────────────────

export type TransformMode = "rephrase" | "simplify" | "expand" | "shorten" | "humanize";

export interface SeoCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface AiPatternReport {
  score: number;
  signals: { id: string; severity: string; detail: string }[];
  flagged: { sentence: string; reason: string }[];
}

export interface PlagiarismReport {
  checked: number;
  matches: { sentence: string; urls: string[] }[];
}

export async function transformText(
  articleId: string,
  mode: TransformMode,
  text: string,
): Promise<{ text: string }> {
  return apiClient.post<{ text: string }>(`/articles/${articleId}/transform`, { mode, text });
}

/**
 * POST to an SSE endpoint and stream text chunks via onChunk; resolves with
 * the final structured payload ({"done": true, "result": ...} frame).
 */
async function streamRequest<T>(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = typeof data.detail === "string" ? data.detail : message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: T | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = JSON.parse(line.slice(5));
      if (payload.error) throw new ApiError(500, payload.error);
      if (payload.d) onChunk(payload.d as string);
      if (payload.status) onStatus?.(payload.status as string);
      if (payload.done) final = payload.result as T;
    }
  }
  if (final === null) throw new ApiError(500, "Stream ended unexpectedly");
  return final;
}

export async function duneChatStream(
  articleId: string,
  question: string,
  history: { role: string; content: string }[],
  body: string,
  onChunk: (text: string) => void,
): Promise<DuneChatResult> {
  return streamRequest<DuneChatResult>(
    `/articles/${articleId}/chat/stream`,
    { question, history, body },
    onChunk,
  );
}

export interface GenerateStreamResult {
  body_markdown: string;
  meta_title: string | null;
  meta_description: string | null;
  word_count: number;
  seo_score: number;
}

export async function generateArticleStream(
  articleId: string,
  opts: { provider?: string; model?: string; template?: string } | undefined,
  onChunk: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<GenerateStreamResult> {
  return streamRequest<GenerateStreamResult>(
    `/articles/${articleId}/generate/stream`,
    opts ?? {},
    onChunk,
    onStatus,
  );
}

export interface InternalLinkSuggestion {
  article_id: string;
  title: string;
  url: string;
  phrase: string;
  snippet: string;
}

export async function findInternalLinks(
  articleId: string,
  body: string,
): Promise<{ suggestions: InternalLinkSuggestion[] }> {
  return apiClient.post<{ suggestions: InternalLinkSuggestion[] }>(
    `/articles/${articleId}/links`,
    { body },
  );
}

export interface DuneChatResult {
  answer: string;
  insertable: string | null;
  revised: string | null;
  meta_title: string | null;
  meta_description: string | null;
}

export async function duneChat(
  articleId: string,
  question: string,
  history: { role: string; content: string }[],
  body?: string,
): Promise<DuneChatResult> {
  return apiClient.post<DuneChatResult>(`/articles/${articleId}/chat`, {
    question,
    history,
    ...(body !== undefined ? { body } : {}),
  });
}

export interface ArticleRevision {
  id: string;
  note: string | null;
  word_count: number;
  body_markdown: string;
  created_at: string;
}

export async function listArticleRevisions(articleId: string): Promise<ArticleRevision[]> {
  return apiClient.get<ArticleRevision[]>(`/articles/${articleId}/revisions`);
}

export async function runArticleChecks(articleId: string): Promise<{ seo: SeoCheck[]; ai: AiPatternReport }> {
  return apiClient.post<{ seo: SeoCheck[]; ai: AiPatternReport }>(`/articles/${articleId}/checks`, {});
}

export async function runPlagiarismScan(articleId: string): Promise<PlagiarismReport> {
  return apiClient.post<PlagiarismReport>(`/articles/${articleId}/plagiarism`, {});
}
