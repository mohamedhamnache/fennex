"use client";

export function EditableField({ label, value, onChange, placeholder }: {
  label: string; value: string | null; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input value={value ?? ""} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)}
             className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50" />
    </label>
  );
}
