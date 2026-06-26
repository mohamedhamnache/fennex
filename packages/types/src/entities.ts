export type PlanTier = "free" | "starter" | "pro" | "agency" | "enterprise";

export type UserRole =
  | "owner"
  | "admin"
  | "seo_manager"
  | "content_writer"
  | "editor"
  | "designer"
  | "marketing_manager"
  | "viewer";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  plan_tier: PlanTier;
  created_at: string;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

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

export type ContentStatus =
  | "idea"
  | "brief_ready"
  | "in_generation"
  | "review"
  | "approved"
  | "published";

export type ContentType =
  | "blog_article"
  | "pillar_page"
  | "comparison_page"
  | "landing_page"
  | "linkedin_post"
  | "twitter_thread"
  | "instagram_post"
  | "facebook_post"
  | "tiktok_script"
  | "youtube_script";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface AsyncJob {
  job_id: string;
  status: JobStatus;
  progress: number;
  result: unknown | null;
  error: string | null;
}
