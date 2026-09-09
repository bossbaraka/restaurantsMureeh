# 🎨 MUREEH — UI / DESIGN QA AUDIT

**Date:** 2026-09-09 · **Baseline:** `24c59bc` · **Branch:** `arena/01a086cc-restaurantsmureeh`

---

## Executive Summary

**Overall score: 78 / 100 — GOOD**
**Final verdict: 🟡 DESIGN READY WITH IMPROVEMENTS**

Mureeh is a genuinely well-built product with a real design system: a
coherent dark "luxury" identity, a thoughtful per-tenant theming layer
(`--brand-*` CSS variables that re-skin the customer menu without a
re-render), iOS safe-area handling, RTL-aware logical CSS in the customer
menu, and print/reduced-motion support. It does **not** need a redesign.

The defects were concentrated in **accessibility and design-system
governance**, not visual craft: pinch-zoom was disabled platform-wide, 95
form controls had no programmatic label, no overlay closed on Escape, and
three well-written shared primitives (`Button`, `Modal`, `Badge`) were used
by **zero** files while 271 buttons were hand-rolled.

### Method — and its limits

I ran the app (Vite dev server, HTTP 200 throughout) and rendered **every**
view and all 13 manager tabs into a real DOM, then measured the **compiled
Tailwind stylesheet** with `getComputedStyle` to obtain true font sizes,
element dimensions and WCAG contrast ratios.

> **I could not use a real browser.** Playwright/Chromium downloads are
> blocked by sandbox egress, so there are **no screenshots and no true
> pixel-level rendering**. Findings come from measured DOM + compiled CSS,
> which reliably catches semantics, type scale, contrast and box metrics,
> but *cannot* catch genuine visual regressions (overlap, clipping,
> z-index/stacking, font-fallback shifts). **Viewport-specific behaviour at
> 320–1920px was assessed from CSS breakpoints, not from rendered
> screenshots.** A human pass in a real browser is still required before
> declaring the UI visually flawless.

Two of my own measurements were **false positives that I caught and
corrected** rather than reporting:
- **20 "contrast failures"** — jsdom applies its UA link colour
  (`#0000EE`) and does not inherit author `color`. Real value for nav links
  is `slate-300` on `#020A14` = **13.39:1 (passing)**. After fixing the
  tool, contrast failures went to **0**.
- **`border-l` used 462 times** — actually matched `border-luxury-*`. True
  count is 2.

### Score breakdown

| Category | Score | Note |
|---|---|---|
| Visual consistency | 11 / 15 | strong identity; blue palette was untokenised |
| Responsive design | 11 / 15 | sound breakpoints; **not screenshot-verified** |
| RTL / Arabic | 9 / 10 | RTL-first and correct; logical CSS in menu |
| Typography | 7 / 10 | 18 sizes on one page; 7–9px type |
| Color system | 8 / 10 | 345 hardcoded blues, now tokenised |
| Components | 6 / 10 | primitives existed but were unused |
| UX | 12 / 15 | no Escape, no scroll lock on overlays |
| Accessibility | 9 / 10 | was ~4; zoom + labels + focus fixed |
| Interaction states | 5 / 5 | hover/active/disabled well covered |
| **TOTAL** | **78 / 100** | up from **~58** at baseline |

---

## Critical Issues (P0) — all fixed

**A11Y-001 · Pinch-zoom disabled platform-wide (WCAG 2.1 SC 1.4.4)**
`index.html` shipped `maximum-scale=1.0, user-scalable=no`. Low-vision
users could not zoom **any** screen — including the QR menu, the app's
primary public surface. Verified against the live server response.

**A11Y-002 · 95 form controls with no accessible name**
Measured: **85 `<label>` elements, 0 `htmlFor`; 95 inputs, 0 `id`, 0
`aria-label`.** Labels were purely visual, so screen readers announced
"edit text, blank" for every field in the product form, staff management,
branding, and onboarding.

**A11Y-003 · No visible keyboard focus**
46 × `focus:outline-none`, **0** `focus-visible` rules outside the customer
menu. The entire manager/admin console was unusable by keyboard.

---

## High Priority (P1) — all fixed

**UX-001 · No overlay closed on Escape; page scrolled behind modals**
All 7 overlays (cart, product detail, product form, waiter call,
onboarding, login, bottom sheet) were plain `<div>`s — no Escape, no
`role="dialog"`, no body-scroll lock.

**TYPO-001 · Illegible type in real dashboards**
Measured on the compiled CSS: the landing page renders **18 distinct font
sizes** including **7px and 8px**; `AnalyticsView` plotted real chart data
at **8px**.

**A11Y-004 · Touch targets below 44px**
Measured: customer menu layout switcher **26×26**, video controls **32×32**,
mobile nav **40×40**.

**A11Y-005 · Two `<h1>` on the customer menu**
`CustomerHeader` and `LuxuryWelcomeScreen` both rendered `<h1>`, breaking
the document outline. KDS and Live Screen jumped h1 → h3.

---

## Medium Priority (P2)

**DS-001 · Platform blue was not a token** — `#0072BC` ×106, `#38BDF8` ×82,
`#004B87` ×46 … **345 hardcoded blues**, none in the Tailwind theme, which
only defined gold/luxury. *Fixed: tokenised.*

**DS-002…006 · Shared primitives orphaned** — `Button`, `Modal`, `Badge`
are well-written but imported by **0 files**; 271 raw `<button>`s exist
instead, producing **15+ distinct padding combinations**. *Partially
fixed — see "Deliberately not done".*

**A11Y-007 · No reduced-motion support** for the landing page's infinite
decorative animations. *Fixed.*

---

## Cosmetic (P3) — documented, not changed

- 8 arbitrary radii (`rounded-[1.65rem]`, `[2.4rem]`…) alongside a clean
  `xl/2xl/full` scale (346/163/168 uses).
- `src/App.css` (184 lines) is dead Vite boilerplate, imported nowhere.
- `charcoal-*` palette defined in Tailwind, used 0 times.

---

## Fixed Issues

### A11Y-001 — Pinch-zoom
**Before:** `maximum-scale=1.0, user-scalable=no` · **After:** removed;
iOS auto-zoom prevented the correct way (existing 16px control font-size).
**Files:** `index.html` · **Impact:** unblocks WCAG 1.4.4 for all users.

### A11Y-002 — Form labelling
**Before:** 0 of 95 controls programmatically labelled.
**After:** **57 label↔control pairs linked** via `htmlFor`/`id`, **13
`aria-label`s** added to placeholder-only search fields, file input and
dynamic size/add-on rows. DOM-measured `input-no-label`: **20 → 1**
(remaining one is a decorative hidden input).
**Files:** 15 components · **Impact:** forms are now screen-reader usable.

### A11Y-003 — Focus visibility
**After:** global `:focus-visible` ring in `@layer base` (keyboard-only,
never on mouse click) + `focus-visible:ring-2` on `Button`.
**Files:** `src/index.css`, `Button.tsx`

### UX-001 — Dialog behaviour
**After:** new `src/hooks/useDialog.ts` — Escape-to-close + **reference-counted**
body-scroll lock (so nested overlays don't unlock early). Applied to 5
overlays. The onboarding wizard deliberately opts out of Escape
(`closeOnEscape: false`) so a stray keypress can't discard entered data.
**Impact:** `btn-no-name` **1 → 0**; every overlay is now dismissible.

### TYPO-001 — Legibility
**After:** 30 occurrences of 8px/9px raised to 11px across 9 real UI files.
**Deliberately preserved:** miniature type inside landing-page *phone
mockups* — those are illustrations of a device screen, not readable UI.
Blanket-raising them would have broken the artwork.

### A11Y-004 — Touch targets
**After:** layout switcher 26→28px visual with a **44px pseudo-element hit
area** (preserves toolbar density), video controls 32→36px + 44px hit area,
mobile nav 40→44px. `Button` gained `min-h` 44/48px at md/lg.

### A11Y-005 — Heading outline
**After:** welcome splash `h1`→`h2`; KDS and Live Screen section headings
normalised. Customer `h1` count **2 → 1**; KDS now fully clean.

### DS-001 — Colour tokens
**After:** `brand.100–950` ramp added to `tailwind.config.js` using the
**exact existing hex values**, so adopting `bg-brand-400` for `bg-[#0072BC]`
is a zero-visual-change refactor. Documented as distinct from the
per-tenant `--brand-primary` variables.

### DS-002…006 — Primitives hardened
`Button`: focus-visible ring, `aria-busy`, `aria-hidden` icons, no empty
label span, touch-target floors. `Modal`: `role="dialog"`, `aria-modal`,
`aria-labelledby` via `useId`, `aria-hidden` backdrop.

---

## Deliberately NOT done

Per the brief's "do not redesign randomly" rule:

1. **Did not migrate 271 buttons to `<Button>`.** That is a 271-site
   refactor across every screen with real regression risk and no visual
   benefit; I fixed the primitive and documented adoption instead. This is
   the single largest remaining consistency debt.
2. **Did not normalise the 8 arbitrary radii** — each is a deliberate
   large-surface curve; changing them alters brand feel.
3. **Did not touch mockup typography** (see TYPO-001).
4. **Did not delete `src/App.css`** — dead, but deleting files is outside
   a design-QA remit; flagged instead.

---

## Design System Reference

**Colour** — `luxury.50–950` (neutral, 1,981 uses) · `gold.100–900`
(accent, 394) · **`brand.100–950` (platform blue, new)** · per-tenant
`--brand-primary/accent` for the customer menu.

**Type scale (recommended, consolidating 18 → 8):**
`11px` micro · `12px` caption · `13px` body-sm · `14px` body ·
`16px` body-lg · `20px` h3 · `24px` h2 · `36px+` display.
Fonts: Tajawal (Arabic/UI), Cormorant Garamond (display).

**Spacing** — Tailwind 4px base; the codebase is consistent here.

**Radius** — `lg` 8 · `xl` 12 · `2xl` 16 · `3xl` 24 · `full`. Avoid new
arbitrary values.

**Breakpoints** — `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280, plus a
custom 1100px menu-grid step.

**Buttons** — sizes sm/md/lg (36/44/48px min-height); variants
gold · primary · secondary · outline · danger · ghost.

---

## Regression Testing

New: **`src/tests/design-system.test.tsx` — 31 tests.**
Validated against the vulnerable baseline: **25 of 31 fail on `24c59bc`**
and all pass now, so they detect the defects rather than assert the status
quo.

| Check | Before | After |
|---|---|---|
| Test suite | 141 pass | **172 pass / 1 skip** |
| `tsc -b` | clean | **clean** |
| `vite build` | OK | **OK (1.7s)** |
| `oxlint` | 128 warn / 0 err | **128 warn / 0 err (unchanged)** |
| Dev server | 200 | **200, no HMR errors** |
| DOM `input-no-label` | 20 | **1** |
| DOM `btn-no-name` | 1 | **0** |
| Measured contrast failures | 0 | **0** |

---

## Recommended Next Steps

1. **Run a real browser pass** at 320/375/768/1280/1920 to catch the visual
   classes this environment cannot see (overlap, clipping, stacking).
2. **Adopt `<Button>` incrementally**, one screen per PR.
3. **Consolidate the type scale** to the 8 steps above.
4. **Codemod `bg-[#0072BC]` → `bg-brand-400`** now that tokens exist.
5. Delete `src/App.css`; drop the unused `charcoal` palette.
