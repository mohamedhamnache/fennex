# LLM Provider Logos in Settings — Design Spec
**Date:** 2026-07-01
**Scope:** Add inline SVG brand logos for OpenAI, Anthropic, and Google in the AI Keys settings section.

---

## 1. Problem & Goal

The AI Keys section (`/settings` → "AI Keys") identifies providers using plain text labels and colored badges. This is functional but looks generic. Adding official brand mark SVGs makes providers immediately recognisable at a glance and improves the visual quality of a section users visit every time they configure an integration.

---

## 2. Scope

One new shared component + three targeted updates in `AIKeysSection`. No other files touched.

**Out of scope:** logos in other sections (social accounts, billing), animated logos, dark-mode-specific logo variants (logos render in their canonical colors on both themes).

---

## 3. New Component: `ProviderLogo`

**File:** `apps/web/components/ui/ProviderLogo.tsx`

```
<ProviderLogo provider="openai"    size={20} />
<ProviderLogo provider="anthropic" size={20} />
<ProviderLogo provider="google"    size={20} />
```

**Props:**
```ts
interface ProviderLogoProps {
  provider: "openai" | "anthropic" | "google";
  size?: number;       // px, applied to width and height. Default: 20
  className?: string;
}
```

**Implementation:** inline `<svg>` elements using paths sourced from SimpleIcons (MIT-compatible). Each provider uses its canonical brand colors:

| Provider | Mark | Color |
|---|---|---|
| OpenAI | Bloom/asterisk mark | `#000000` (light) / `#ffffff` (dark) — uses `currentColor` with `fill="currentColor"` so it adapts to context |
| Anthropic | "A" letterform | `#D97757` (brand orange, fixed) |
| Google | Multicolor "G" | Four-segment path with `#4285F4` / `#EA4335` / `#FBBC05` / `#34A853` (fixed) |

OpenAI uses `currentColor` so it inverts correctly in dark mode. Anthropic and Google use fixed brand colors that are legible on both light and dark backgrounds.

---

## 4. Changes to `AIKeysSection`

### 4.1 Provider Status Grid

The three cards at the top of the AI Keys section (lines 344–366 of `settings/page.tsx`).

**Before:** provider name as `<span>` text.

**After:** `<ProviderLogo>` (size 28) above the provider name text:

```
┌───────────────────────────────┐
│  [logo 28px]                  │
│                               │
│  OpenAI                  [✓]  │
│  Connected                    │
└───────────────────────────────┘
```

Logo sits at the top-left of each card. The existing text label and connected badge remain unchanged below it.

### 4.2 Key List Rows

Each existing key row (lines 370–392) currently shows a colored text badge (`PROVIDER_COLORS`) + masked key value.

**After:** `<ProviderLogo>` (size 16) prepended inside the badge, before the provider label text:

```
[ [logo 16px]  OpenAI ]   ••••••••sk-abc     [trash]
```

The colored badge background (`PROVIDER_COLORS`) is kept — the logo sits inside it alongside the text.

### 4.3 Add Key Form — Provider Selector Buttons

The three provider buttons in the add-key form (lines 399–411) currently show only the text label.

**After:** `<ProviderLogo>` (size 16) + label side by side:

```
[ [logo] OpenAI ]  [ [logo] Anthropic ]  [ [logo] Google ]
```

---

## 5. Success Criteria

- All three provider logos render correctly in both light and dark mode
- OpenAI logo inverts (black in light, white in dark) via `currentColor`
- Anthropic and Google logos use fixed brand colors, visible on both themes
- No layout shift in the status grid, key list, or form selector
- `npm run typecheck` passes with 0 errors
