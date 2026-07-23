"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { User, Building2, Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import { ApiError, authRegister } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [form, setForm] = useState({ email: "", password: "", fullName: "", orgName: "" });
  const [showPassword, setShowPassword] = useState(false);
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

  const field =
    "w-full rounded-xl border border-border bg-input py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:border-primary/50";
  const iconCls = "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70";

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">{t("auth.createAccount")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.registerSubtitle")}</p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-fade-in"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground" htmlFor="fullName">{t("auth.fullName")}</label>
            <div className="relative">
              <User className={iconCls} />
              <input id="fullName" type="text" required value={form.fullName} onChange={set("fullName")} className={field} placeholder="Jane Smith" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground" htmlFor="orgName">{t("auth.company")}</label>
            <div className="relative">
              <Building2 className={iconCls} />
              <input id="orgName" type="text" required value={form.orgName} onChange={set("orgName")} className={field} placeholder="Acme Inc." />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground" htmlFor="email">{t("auth.workEmail")}</label>
          <div className="relative">
            <Mail className={iconCls} />
            <input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} className={field} placeholder="you@company.com" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground" htmlFor="password">{t("auth.password")}</label>
          <div className="relative">
            <Lock className={iconCls} />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={6}
              value={form.password}
              onChange={set("password")}
              className={`${field} pr-11`}
              placeholder={t("auth.passwordHint")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary group w-full px-4 py-3 text-sm">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              {t("auth.creatingAccount")}
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              {t("auth.getStarted")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
        </button>

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {t("auth.termsText")}
        </p>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
        <div className="relative flex justify-center"><span className="bg-background px-3 text-xs text-muted-foreground">{t("auth.haveAccount")}</span></div>
      </div>

      <Link
        href="/login"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground transition-all hover:border-primary/40 hover:bg-accent"
      >
        {t("auth.signInInstead")}
      </Link>
    </div>
  );
}
