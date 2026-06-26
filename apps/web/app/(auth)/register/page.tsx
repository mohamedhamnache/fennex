"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, authRegister } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", fullName: "", orgName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authRegister(form.email, form.password, form.fullName, form.orgName);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all";

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Free to start · No credit card required</p>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/15 dark:text-red-400">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground" htmlFor="fullName">Full name</label>
            <input id="fullName" type="text" required value={form.fullName} onChange={set("fullName")} className={field} placeholder="Jane Smith" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground" htmlFor="orgName">Company</label>
            <input id="orgName" type="text" required value={form.orgName} onChange={set("orgName")} className={field} placeholder="Acme Inc." />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground" htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} className={field} placeholder="you@company.com" />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" required minLength={6} value={form.password} onChange={set("password")} className={field} placeholder="Min. 6 characters" />
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full px-4 py-2.5 text-sm">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Creating account…
            </span>
          ) : "Get started for free →"}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <span className="underline underline-offset-2 cursor-pointer">Terms of Service</span>
        </p>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
        <div className="relative flex justify-center"><span className="bg-background px-3 text-xs text-muted-foreground">Have an account?</span></div>
      </div>

      <p className="text-center text-sm">
        <Link href="/login" className="font-semibold text-primary hover:underline underline-offset-4">
          Sign in instead →
        </Link>
      </p>
    </div>
  );
}
