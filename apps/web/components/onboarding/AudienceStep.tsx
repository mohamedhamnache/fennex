"use client";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { DiscoveryResult, DiscoveryICP } from "@/lib/api";
import { EditableField } from "./EditableField";

export function AudienceStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const setICP = (i: number, patch: Partial<DiscoveryICP>) => {
    const audience = result.audience.map((a, idx) => idx === i ? { ...a, ...patch } : a);
    onChange({ ...result, audience });
  };
  const add = () => onChange({ ...result, audience: [...result.audience, { label: "" }] });
  const remove = (i: number) => onChange({ ...result, audience: result.audience.filter((_, idx) => idx !== i) });

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.audience.title")}</h2>
      <div className="mt-6 space-y-4">
        {result.audience.map((icp, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <EditableField label={t("onboarding.audience.label")} value={icp.label ?? ""} onChange={(v) => setICP(i, { label: v })} />
              <button onClick={() => remove(i)} className="ml-3 mt-4 text-muted-foreground hover:text-destructive" aria-label={t("onboarding.audience.remove")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <EditableField label={t("onboarding.audience.profession")} value={icp.profession ?? ""} onChange={(v) => setICP(i, { profession: v })} />
              <EditableField label={t("onboarding.audience.budget")} value={icp.budget ?? ""} onChange={(v) => setICP(i, { budget: v })} />
            </div>
          </div>
        ))}
        <button onClick={add} className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          <Plus className="h-4 w-4" /> {t("onboarding.audience.add")}
        </button>
      </div>
      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.audience.next")}</button>
    </div>
  );
}
