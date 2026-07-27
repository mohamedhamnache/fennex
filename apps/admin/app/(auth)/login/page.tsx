"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/api";
import { useAdminStore, type AdminUser } from "@/store";

interface LoginResponse {
  access_token: string;
  token_type: string;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const setAuth = useAdminStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { access_token } = await apiClient.postForm<LoginResponse>("/admin/auth/login", {
        username: email,
        password,
      });
      // Stash the token immediately so the /admin/me call below (and every
      // apiClient call after it) is authenticated — admin is set once we
      // have the full profile.
      useAdminStore.setState({ token: access_token });
      const admin = await apiClient.get<AdminUser>("/admin/me");
      setAuth(access_token, admin);
      router.push("/overview");
    } catch (err) {
      useAdminStore.setState({ token: null });
      setError(
        err instanceof ApiError && err.status === 401
          ? "Incorrect email or password."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-border bg-input px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:border-primary/50";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[380px] animate-fade-in">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="gradient-brand glow-primary flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white">
            F
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Fennex Admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with your staff account
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-fade-in"
          >
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 card-base card-shadow border border-border bg-card p-6">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@fennex.ai"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full px-4 py-3 text-sm">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
