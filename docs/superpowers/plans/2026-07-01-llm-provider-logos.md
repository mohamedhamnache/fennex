# LLM Provider Logos in Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accurate inline SVG brand logos for OpenAI, Anthropic, and Google into the AI Keys settings section (status grid, key list, and provider form selector).

**Architecture:** One new `ProviderLogo` component in `components/ui/` renders the correct inline SVG based on a `provider` prop. The existing `AIKeysSection` in `settings/page.tsx` is updated in three targeted spots to use it. No new dependencies.

**Tech Stack:** React 18, TypeScript 5, Tailwind CSS v3, Next.js 14 App Router.

## Global Constraints

- No new npm dependencies — all SVG paths are inlined as JSX
- OpenAI logo uses `fill-black dark:fill-white` Tailwind utilities so it inverts correctly in dark mode
- Anthropic and Google logos use hardcoded brand colors on their `<path>` elements — not affected by parent text color
- Verify every change with `npm run typecheck` from `apps/web/`
- Commit style: `feat(settings): ...`

---

## File Map

**Create:**
- `apps/web/components/ui/ProviderLogo.tsx` — single component, three inline SVGs

**Modify:**
- `apps/web/app/(dashboard)/settings/page.tsx` — three edits inside `AIKeysSection`

---

## Task 1: Create `ProviderLogo` component

**Files:**
- Create: `apps/web/components/ui/ProviderLogo.tsx`

**Interfaces:**
- Produces:
  ```tsx
  <ProviderLogo
    provider: "openai" | "anthropic" | "google"
    size?: number      // default 20, applied as width and height in px
    className?: string
  />
  ```

- [ ] **Step 1: Create `ProviderLogo.tsx`**

```tsx
// apps/web/components/ui/ProviderLogo.tsx
import { cn } from "@/lib/cn";

interface ProviderLogoProps {
  provider: "openai" | "anthropic" | "google";
  size?: number;
  className?: string;
}

function OpenAILogo({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("fill-black dark:fill-white shrink-0", className)}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function AnthropicLogo({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      <path
        fill="#D97757"
        d="M17.3218 1.2676H6.6782L.9 22.7324h4.7905l1.1676-4.4865h10.284l1.1676 4.4865H23.1l-5.7782-21.4648zm-9.3867 13.0593 3.8456-14.7758h.2386l3.8456 14.7758H7.9351z"
      />
    </svg>
  );
}

function GoogleLogo({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function ProviderLogo({ provider, size = 20, className }: ProviderLogoProps) {
  if (provider === "openai")    return <OpenAILogo    size={size} className={className} />;
  if (provider === "anthropic") return <AnthropicLogo size={size} className={className} />;
  if (provider === "google")    return <GoogleLogo    size={size} className={className} />;
  return null;
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/ProviderLogo.tsx
git commit -m "feat(settings): add ProviderLogo component with inline SVGs for OpenAI, Anthropic, Google"
```

---

## Task 2: Integrate `ProviderLogo` into `AIKeysSection`

**Files:**
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `ProviderLogo` from `@/components/ui/ProviderLogo` (Task 1)

### 2.1 Add import

- [ ] **Step 1: Add `ProviderLogo` import**

At the top of `apps/web/app/(dashboard)/settings/page.tsx`, after the existing UI component imports (after the `Badge` and `useToast` imports, around line 23), add:

```tsx
import { ProviderLogo } from "@/components/ui/ProviderLogo";
```

### 2.2 Status grid cards (lines 348–362)

- [ ] **Step 2: Update the provider status grid**

Replace lines 348–362 (the inner card content):

**Before:**
```tsx
<div key={p} className={`relative rounded-xl border-2 p-4 transition-all ${connected ? "border-primary/30 bg-primary/5" : "border-dashed border-border bg-card"}`}>
  <div className="flex items-center justify-between mb-2">
    <span className={`text-xs font-semibold ${connected ? "text-primary" : "text-muted-foreground"}`}>
      {PROVIDER_LABELS[p]}
    </span>
    {connected && (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
        <Check className="h-2.5 w-2.5 text-primary-foreground" />
      </span>
    )}
  </div>
  <p className={`text-xs ${connected ? "text-primary/70" : "text-muted-foreground/60"}`}>
    {connected ? t("settings.aiKeys.connected") : t("settings.aiKeys.notConnected")}
  </p>
</div>
```

**After:**
```tsx
<div key={p} className={`relative rounded-xl border-2 p-4 transition-all ${connected ? "border-primary/30 bg-primary/5" : "border-dashed border-border bg-card"}`}>
  <div className="flex items-start justify-between mb-3">
    <ProviderLogo provider={p} size={28} />
    {connected && (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
        <Check className="h-2.5 w-2.5 text-primary-foreground" />
      </span>
    )}
  </div>
  <p className={`text-xs font-semibold mb-0.5 ${connected ? "text-primary" : "text-muted-foreground"}`}>
    {PROVIDER_LABELS[p]}
  </p>
  <p className={`text-xs ${connected ? "text-primary/70" : "text-muted-foreground/60"}`}>
    {connected ? t("settings.aiKeys.connected") : t("settings.aiKeys.notConnected")}
  </p>
</div>
```

### 2.3 Key list badge (line 375–376)

- [ ] **Step 3: Update the key list badge**

Replace lines 375–376:

**Before:**
```tsx
<span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${PROVIDER_COLORS[k.provider] ?? "bg-muted text-muted-foreground border-border"}`}>
  {PROVIDER_LABELS[k.provider] ?? k.provider}
</span>
```

**After:**
```tsx
<span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${PROVIDER_COLORS[k.provider] ?? "bg-muted text-muted-foreground border-border"}`}>
  <ProviderLogo provider={k.provider as "openai" | "anthropic" | "google"} size={14} />
  {PROVIDER_LABELS[k.provider] ?? k.provider}
</span>
```

### 2.4 Add key form provider selector (lines 400–411)

- [ ] **Step 4: Update the provider selector buttons**

Replace lines 400–411:

**Before:**
```tsx
<button
  key={p}
  onClick={() => setProvider(p)}
  className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-all ${
    provider === p
      ? "border-primary bg-primary/5 text-primary"
      : "border-border text-muted-foreground hover:border-foreground/30"
  }`}
>
  {PROVIDER_LABELS[p]}
</button>
```

**After:**
```tsx
<button
  key={p}
  onClick={() => setProvider(p)}
  className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
    provider === p
      ? "border-primary bg-primary/5 text-primary"
      : "border-border text-muted-foreground hover:border-foreground/30"
  }`}
>
  <ProviderLogo provider={p} size={14} />
  {PROVIDER_LABELS[p]}
</button>
```

### 2.5 Verify and commit

- [ ] **Step 5: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Visual verification**

Start the dev server:

```bash
cd apps/web && npm run dev
```

Navigate to `/settings` → "AI Keys" section. Check:

1. **Status grid** — each of the 3 cards shows its logo (28px) at top-left, provider name below, connected checkmark at top-right when connected. OpenAI logo is black in light mode, white in dark mode. Anthropic logo is orange. Google logo is multicolor.
2. **Key list** — if any keys are saved, each row's badge shows the logo (14px) to the left of the provider name text, inline.
3. **Add key form** — click "+ Add API Key". Provider selector buttons each show logo (14px) + label side by side, centered.
4. Toggle dark mode — OpenAI logo inverts; Anthropic and Google remain fixed-color.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(settings): integrate ProviderLogo into AIKeysSection (grid, list, form)"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `ProviderLogo` component, `provider` + `size` + `className` props | Task 1 |
| OpenAI bloom mark, `fill-black dark:fill-white` | Task 1 |
| Anthropic "A" mark, `#D97757` fixed | Task 1 |
| Google multicolor "G", four segments | Task 1 |
| Status grid cards — logo (28px) above name | Task 2 step 2 |
| Key list rows — logo (14px) inside badge | Task 2 step 3 |
| Add key form — logo (14px) + label in buttons | Task 2 step 4 |
| Dark mode: OpenAI inverts, others fixed | Task 1 (`fill-black dark:fill-white`) |
| No layout shift | Verified visually in Task 2 step 6 |
| `typecheck` passes | Task 1 step 2, Task 2 step 5 |

All requirements covered. ✓

**Placeholder scan:** No TBDs. All code blocks complete. ✓

**Type consistency:**
- `ProviderLogo` accepts `provider: "openai" | "anthropic" | "google"` in Task 1
- Status grid: `p` comes from `PROVIDERS` typed as `readonly ["openai", "anthropic", "google"]` — no cast needed ✓
- Key list: `k.provider` is `string` from `ApiKey` type — cast to `"openai" | "anthropic" | "google"` explicit in step 3 ✓
- Form selector: `p` from `PROVIDERS.map` is already `"openai" | "anthropic" | "google"` — no cast needed ✓
