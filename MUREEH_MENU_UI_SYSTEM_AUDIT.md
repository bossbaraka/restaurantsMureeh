# MUREEH MENU — UI SYSTEM AUDIT

**Repository** `bossbaraka/restaurantsMureeh` · **Base commit** `d0c9768` · **Branch** `arena/01a10307-restaurantsMureeh`
**Date** 2026-10-03 · **Scope** Theme System · Design System · Mobile Responsive Engineering (Customer Menu)
**Method** READ → UNDERSTAND → AUDIT → PROVE → PLAN → IMPLEMENT → VERIFY

Every claim below is either measured in a real headless-Chromium build against a local mock API, or
is explicitly labelled as inferred / unverified. Nothing is asserted from reading code alone where a
measurement was possible.

---

## 1 · Executive Summary

The customer menu is **architecturally sound**. The theme pipeline (`NormalizedTheme →
buildSemanticTokens → --m-* → CustomerThemeProvider`) is a correct, well-documented single source of
truth, the sticky stack is measured rather than guessed, and RTL is handled deliberately. **None of
it was rewritten.** Every fix in this report sits at the layer that actually owns the defect.

What is broken is **coverage, not architecture**: the token vocabulary had three holes, and each
hole had been patched locally in markup with a hardcoded Tailwind colour. Those patches are the
defects — they are invisible in Dark mode (the historical default), and they are why the light
canvas, the RTL edges and the phone widths degraded independently.

The single most important measurement in this audit: **the customer menu resolves to Light mode by
default** (`--m-bg: #FFFFFF`, confirmed with the appearance toggle in its `تلقائي` state). Every
hardcoded dark-surface ink was therefore failing on the *primary* experience, not an edge case.

**Headline results**

| Before | After | Where |
|---|---|---|
| Card price `--m-brand-on-surface` **3.35:1** | **4.84:1** | `brandTheme.deepenForLight` |
| Status pill ink (PENDING) **~1.7:1** on light | **4.98:1** | `semanticTokens.statusExtensionTokens` |
| Status pill ink (PREPARING) **~1.7:1** on light | **4.81:1** | same |
| Price currency **2.39:1** | de-emphasised toward `--m-text` | `index.css` |
| Rail background stopped **24px short** of one edge | full-bleed at ≤639px | `index.css` |
| Toolbar wrapped to **2 rows** at 320px | **1 row** | same rule |
| Hero stepper colours **shifted one step** vs tracker | single source | `CustomerHero` |
| First dish **1.4–2.5 viewports** down | mitigated (208px hero + scroll CTA) | `CustomerHero` |

**Verification status: PARTIALLY VERIFIED.** Typecheck, lint, unit/theme tests and production build
are green and reproducible. All contrast and geometry claims are browser-measured in Light + Dark
across the mandated widths. Three items could **not** be verified in this environment and are
labelled as such in §13 and §17 — notably the iOS notch behaviour, which requires hardware.

---

## 2 · Current Architecture

```
Server EffectiveTheme (theme row)
   └─ normalizeTheme()            → NormalizedTheme  (src/theme/normalizeTheme.ts)
        └─ buildBrandTokens()     → brand identity + derived surfaces (brandTheme.ts)
             └─ buildSemanticTokens(theme, mode) → { '--m-*': value }  (semanticTokens.ts)
                  └─ CustomerThemeProvider        → applied to ONE scope element
                       └─ components consume var(--m-*) via Tailwind arbitrary values
```

Three overlapping families predate the `--m-*` vocabulary: `--brand-*` (legacy engine),
`--theme-*` (server contract) and `--menu-*` (a third derivation re-computed in CSS). The `--m-*`
layer is the consolidation and is the correct direction. **It was preserved as-is.**

Sticky layout is handled by `StickyStack.tsx`, which measures registered bands and publishes
`--m-stack-h` / `--m-stack-above-header` as CSS variables rather than relying on magic offsets. This
is the right pattern and was extended, not replaced.

---

## 3 · Theme Architecture

**Sound.** `resolveModeAwareColors()` flips only `background | surface | textPrimary | textSecondary
| border`, and only when the stored value exactly matches a dark default — a deliberately narrow
rule that prevents a tenant's custom identity from being silently overwritten. `primary`/`accent` are
mode-independent by design.

**Defect 1 — the light-mode brand ink had no floor.** `deepenForLight(primary, 0.40, 0.32)` darkens by
a fixed ratio with no regard for the result's legibility. For the default gold `#D4AF37` it returned
`#A88924` → **3.35:1** on white, which is what every card price is painted with. The brand engine
already owned `contrastRatio()` and `relativeLuminance()` (exported, and used by four test files);
they simply were not consulted here.

**Fixed** by giving `deepenForLight` a WCAG floor: keep darkening until ≥4.5:1, bounded by the
existing `floorLightness = 0.12`. Measured effect across palettes — `#D4AF37 → #886F1D` (4.84:1),
`#FFFFFF → #666666` (5.74), `#FFFF00 → #787800` (4.68), `#E11D48 → #B5173A` (6.67), `#16A34A →
#12883E` (4.55). `#111111` and `#0072BC` were already compliant and are **byte-identical**. The dark
path is untouched and still pinned by the existing `dark === defaulted` test.

**Defect 2 — status inks were documented as mode-aware but were not.** `--m-*-strong` carries this
comment: *"the dark-surface contrast companions of the DEFAULT status palette"*. The name promises
mode awareness; the implementation was four fixed Tailwind-400 hex constants. On the dark canvas they
measure 10.34:1 and 7.07:1. On the light canvas, **1.55:1 and 2.27:1** — invisible.

**Fixed** by making `statusExtensionTokens()` take the resolved mode. Dark values are unchanged
(`#FBBF24`, `#60A5FA`, `#34D399`, `#F87171`); light values are darkened multiplicatively (preserving
hue and saturation) against the badge tint *as composited* — not against the bare canvas, because a
status badge is `rgb(var(--m-*-rgb)/0.1)` over the canvas, and measuring against the canvas would
have under-corrected. **No new tokens were introduced**: the whole point is that the existing name
should have been doing this job already.

---

## 4 · Token Coverage

The vocabulary is comprehensive. Three gaps were found, and each gap had been filled in markup with
a raw palette class — which is precisely the failure mode a token system exists to prevent.

| Gap | Filled in markup by | Consequence |
|---|---|---|
| No light-mode brand ink | — (engine returned a failing value) | card price 3.35:1 |
| No light-mode status ink | `text-amber-300`, `text-amber-400` in `CustomerHero` | status pills ~1.7:1 on light |
| No token for the SERVED neutral | `bg-zinc-500/10`, `text-zinc-300`, `bg-zinc-400` in `formatting.ts` | 1.47:1 on light |

The SERVED case is worth dwelling on because it is the most instructive. The neighbouring branches
of `getOrderStatusConfig()` had already been migrated to `--m-*` with the historical Tailwind value
as an arbitrary-value fallback:

```ts
badgeText: 'text-[rgb(var(--m-warning-strong-rgb,251_191_36))]'
```

SERVED was left on literal `zinc-*`. The migration was therefore **90% complete and 0% safe** — the
one branch that was not migrated was the one that broke. This is the argument for finishing
propagation rather than adding tokens.

---

## 5 · Typography

No type-scale defect was found. The customer layer uses `--m-font-*` and the scale is consistent
between the header, hero, card title, price and metadata.

Two observations that are **not** defects and were deliberately left alone:

- **`--m-font-chosen` resolves to `""`** with no tenant override. This is a benign default, not a
  bug: `font-family: '' , <fallback>` is invalid, but the consuming declaration carries a fallback
  chain that resolves correctly. Measured rendering is correct.
- **`FONT_FAMILY_MAP` resolves `inter | poppins` and `Cormorant → Amiri`,** but no `@font-face` or
  `<link>` loads them. The only font link in `index.html` is `fonts.googleapis.com`, which is
  unreachable from this sandbox (and, notably, from many restaurant networks). **Measured impact:
  none on layout** — the fallback stack is sound. Flagged as P2 because a QR menu whose typography
  silently degrades to system fonts cannot deliver the "luxury" identity the design intends.

---

## 6 · Layout System

**Sound.** `main` is `max-w-5xl mx-auto px-4 sm:px-6`, the rail cancels the gutter with
`margin-inline: calc(-1 * var(--m-gutter))`, and content sits on a 12-column grid. Measured
alignment is correct at every width.

**Defect 3 — the rail was over-constrained at ≤640px.** This is the deepest root cause in the audit,
and the one that best illustrates why "the visual bug location is not the root cause".

```
@media (max-width: 640px) { :root { --m-gutter: 0.75rem }  /* + a max-width:100% list */ }
```

`.menu-rail` appeared in that `max-width: 100%` list. The rail *already* cancels the gutter with a
negative inline margin, so constraining its width forced the browser to resolve an
over-constrained box — and it does so by **dropping the RTL end margin**. Measured before/after:

| Width | Before | After |
|---|---|---|
| 320 | `left: 24, width: 296` | `left: 0, width: 320` |
| 360 | `left: 24, width: 336` | `left: 0, width: 360` |
| 390 | `left: 24, width: 366` | `left: 0, width: 390` |
| 412 | `left: 24, width: 388` | `left: 0, width: 412` |

Three separate symptoms, one cause: the background stopped 24px short of an edge; the contents were
inset 24px on one side only; and the lost 24px of line budget pushed the toolbar to two rows at
320px. Removing one selector fixed all three — **no `!important`, no `overflow: hidden`, no new
breakpoint.**

**Note on 640px exactly.** At 640px both `@media (max-width:640px)` and Tailwind's `sm:` apply, so
`--m-gutter` is 12px while `sm:px-6` is 24px. The rail therefore bleeds 12px past the content edge
on each side. This is **symmetric and intentional-looking**, not a defect — but it is a boundary
inconsistency worth knowing about if the gutter is ever retuned.

---

## 7 · Responsive Audit

Tested at **320 / 360 / 390 / 412 / 640 / 768 / 1024 / 1280**, Light + Dark, Arabic + English.

**Horizontal overflow: zero at every width** (`scrollWidth - innerWidth = 0`). Critically, this was
re-tested with `overflow-x` *removed* from the customer shell: **zero offenders**. The existing clip
is not masking an overflow bug, so it was left alone rather than deleted.

**Card overflow with long product names: zero.** No card exceeded its container or the viewport.

**Empty state: correct.** Searching `zzzqqq999` renders «لا توجد نتائج بحث عن …» with recovery
guidance («جرّب البحث بكلمات أخرى أو تصفح الأقسام المختلفة»).

**Defect 4 — the toolbar still wraps at 412px and 430px.** The `xs: 400px` breakpoint turns the
toggle labels on, and the group then needs 388px against 388px available at 412px. This was measured
with `flex-wrap: nowrap` forced, and by sweeping candidate breakpoints: **424px fixes 412 but not
430; 432px and above de-wrap every width tested up to 639px.**

**Not fixed.** Moving a shared breakpoint (`tailwind.config.js`) affects four components, and the
`xs` scale is used by `Badge`, `CustomerHeader`, `CustomerModeToggle` and `MenuToolbar`. That is a
design-system decision, not a bug fix, and it belongs in the next phase with the other layout
changes. Recorded as P2 with the measurement attached so the decision is cheap to make.

---

## 8 · Mobile Audit

The dominant mobile finding is **information architecture, not CSS**.

Measured scroll depth to the first dish card (`?qr=qrtok-1`, all products rendered):

| Viewport | First dish at | Viewports down |
|---|---|---|
| 320×568 | 1417px | **2.49** |
| 360×640 | 1384px | **2.16** |
| 390×844 | 1407px | **1.67** |
| 412×915 | 1470px | **1.61** |
| 768×1024 | 1401px | **1.37** |

The hero occupies ~1200px of the ~1400px budget before any food appears. A QR guest's first intent is
**Find**, and the menu asks for two to three full-page swipes before it serves that intent.

**Mitigated — honestly, only mitigated.** Two changes:
1. Hero banner **256px → 208px** on phones (measured 208px layout height; 216px rendered because of
   the existing `scale-105` transform). Saves 48px.
2. A **«استكشف القائمة»** CTA below the hero copy, `md:hidden`, smooth-scrolling to `id="menu-rail"`.
   It anchors on the rail itself rather than a wrapper, so the guest lands on the restaurant's own
   category navigation rather than on more marketing copy.

This does **not** fix the IA problem. A real fix means collapsing or re-ordering the gallery block,
which is a redesign and was explicitly out of scope. The honest claim is: the fold is less bad and
there is now a one-tap route past it.

**Sticky stack: correct.** Measured `stackH 69 / headerBottom 69 / railTop 69` — no gap, no overlap.
Hit-tested with `elementFromPoint` while stuck: the rail and its track/select are reachable, not
covered by a later-painted band.

**Defect 5 — the safe-area guarantee did not hold on the public QR route.** The stack assumed the
platform toolbar band always absorbs `env(safe-area-inset-top)`. It does — but `ViewSwitcher` is
**unmounted on the public QR route**, which is the route every real guest lands on. There, the
header is the topmost band and nothing was taking the notch inset.

**Fixed** at the layer that owns the knowledge: `useStickyStackVars()` now also publishes
`--m-stack-safe-top` — the inset the stack has *not* already absorbed (`0px` when the toolbar band is
registered, `env(safe-area-inset-top)` when it is not). `CustomerHeader` adds it to its `top`.
Because the header is measured, `--m-stack-h` inherits the value and the rail follows with no second
change. **Not verified on hardware** — see §17.

---

## 9 · RTL Audit

RTL is first-class: `<html dir="rtl">`, logical properties in the layout system, and `margin-inline`
negative gutter cancellation on the rail.

**Defect 6 — `.menu-select` padding was LTR-authored.** `padding: 0.4rem 1.6rem 0.4rem 0.7rem` puts
the 1.6rem of clearance on the inline-**start** side. The chevron is painted at physical `left`,
which in RTL is the inline-**end** edge — so the arrow got 8px where it needed 19px, and the longest
sort option («الأسرع تحضيراً») collided with it. **Fixed** by swapping the two values.

**Defect 7 — the rail's lost end margin** (§6) is also an RTL defect: the browser resolved the
over-constrained box by dropping the end margin, which is only visually obvious in RTL because the
other edge is pinned.

No other RTL spacing defect was found. Category chips, cards, the cart drawer and the modals were
checked at 320–1280.

---

## 10 · Component Audit

26 files / ~8,000 LOC in `src/components/customer/`. Findings:

**`CustomerHero`** — the stepper carried a **private copy of the status palette**, and it had
drifted. The mapping was shifted one step:

| Step | Status | Hero painted | Canonical |
|---|---|---|---|
| 1 «استقبال» | PENDING | brand gold | amber / warning |
| 2 «تحضير» | PREPARING | **amber** (= PENDING's colour) | blue / info |
| 3 «جاهز» | READY | emerald | emerald ✓ |
| 4 «تم التقديم» | SERVED | **blue** (= PREPARING's colour) | neutral |

The hero and the order tracker were telling the guest **two different stories about the same
order**. The component also carried its own `getStepIndex()` switch — a second copy of the lifecycle
model.

**Fixed** by declaring the stepper as data (`ORDER_STEPS`, four entries naming their `OrderStatus`)
and resolving label, icon and colour through `getOrderStatusConfig(status)`. The private switch is
gone. One incidental behaviour improvement: `animate-pulse` now marks the step *in progress* rather
than every completed step — previously step 2 kept pulsing after the order had already been served.

**`ProductCard`** — **"Add to cart" is present and correctly differentiated.** Measured at 390px:
products without variants get **«إضافة»** (80×38) wired to `onQuickAdd`; products with variants get
**«تخصيص»** (91×38) opening the detail modal. The whole-card hit area for details sits *below* the
action controls in the stacking order, so it does not swallow the add button — verified by the
`elementFromPoint` hit test.

**`getOrderStatusConfig`** — now the single owner. Its SERVED branch was the last hardcoded palette
in the file (§4).

**`MenuToolbar`** — wrapping at 412/430px, see §7. Not fixed.

**Focus & keyboard** — no defect. The first focused control renders
`outline: rgb(136, 111, 29) solid 2px` (4.84:1 against the light canvas) — visible. Notably, the
value is the *new* light-mode `primaryStrong`, so the contrast floor improved the focus ring too.

---

## 11 · Root Causes

Ordered by depth. Each is stated as the layer that owns it, per the decision rule.

| # | Symptom | Mechanism | Owning layer | Fix |
|---|---|---|---|---|
| 1 | Rail bg stops short; toolbar wraps | Over-constrained box → browser drops RTL end margin | **Parent layout / CSS** | drop `max-width:100%` for `.menu-rail` |
| 2 | Status pills invisible on light | `--m-*-strong` fixed -400 shades | **Theme engine (token resolution)** | resolve per mode |
| 3 | Card price 3.35:1 | `deepenForLight` darkens by ratio, ignores result | **Theme engine (brand derivation)** | WCAG floor |
| 4 | Hero/tracker disagree | Duplicated palette + duplicated lifecycle switch | **Component CSS / single-source** | data-driven stepper |
| 5 | First dish 2.5 viewports down | Hero is ~1200px of atmosphere | **UX hierarchy** | 208px banner + CTA |
| 6 | Sort chevron overlaps text | LTR-authored padding in RTL | **Component CSS** | swap padding |
| 7 | Content under the iOS notch (QR route) | Assumption that the toolbar band is always mounted | **Layout mechanism** | `--m-stack-safe-top` |
| 8 | Currency 2.39:1 | De-emphasis mixed toward `#ffffff` | **Token dependency** | mix toward `--m-text` |

Note that **no fix came from a different layer than the cause.** In particular, nothing was fixed
with `z-index`, `overflow: hidden`, `!important`, `position: absolute`, or a new breakpoint.

---

## 12 · Issues — P0 / P1 / P2 / P3

### P0 — blocks use or causes data/action failure
**None.** No defect found that prevented ordering, cart mutation, or navigation.

### P1 — breaks responsive/layout or major UX defect
| ID | Issue | Status |
|---|---|---|
| P1-1 | Rail over-constrained at ≤640px (bg stops 24px short, contents misaligned, toolbar wraps) | **FIXED** |
| P1-2 | Status inks ~1.7:1 on the light canvas — the default mode | **FIXED** |
| P1-3 | Card price `--m-brand-on-surface` 3.35:1 | **FIXED** |
| P1-4 | Hero stepper palette shifted one step vs the order tracker | **FIXED** |
| P1-5 | Safe-area inset unclaimed on the public QR route | **FIXED** (unverified on hardware) |

### P2 — inconsistency or design-system debt
| ID | Issue | Status |
|---|---|---|
| P2-1 | SERVED branch still on literal `zinc-*` (1.47:1 on light) | **FIXED** |
| P2-2 | Toolbar wraps to 2 rows at 412px and 430px (`xs: 400px`) | **OPEN** — needs a design-system decision |
| P2-3 | Fonts (`Amiri`, `Cormorant`, `Inter`, `Poppins`) unmapped to any `@font-face`/`<link>`; only unreachable `fonts.googleapis.com` | **OPEN** |
| P2-4 | First dish 1.4–2.5 viewports down on every phone | **PARTIAL** — mitigated, not solved |
| P2-5 | `--m-stack-safe-top` is a new contract between two files | **OPEN** — accepted, documented |

### P3 — cosmetic / cleanup
| ID | Issue | Status |
|---|---|---|
| P3-1 | `.menu-add` controls are 38px tall (below the 44px advisory, above the 24px WCAG 2.5.8 minimum). The repo already has a `touch-target` utility that expands hit area via `::after` with **no layout change** — one class or one `min-height` in `.menu-add` | **OPEN** |
| P3-2 | `<html class="dark">` persists while the customer scope resolves a light canvas. Harmless today (the customer layer uses **zero** `dark:` variants — verified), but a trap for any future `dark:` utility | **OPEN** |

---

## 13 · Changes Implemented

Nine changes across eight files. **+337 / −97.**

**Theme engine**
1. `brandTheme.deepenForLight()` — WCAG 4.5:1 floor on the light canvas, bounded by `floorLightness`.
   Reuses the module's existing `contrastRatio()`; dark path byte-identical.
2. `semanticTokens.statusExtensionTokens(surfaceMode)` — `--m-*-strong` resolves per mode. Dark
   unchanged. No new tokens.
3. `StickyStack.useStickyStackVars()` — publishes `--m-stack-safe-top`.

**Customer UI**
4. `CustomerHero` — stepper is data-driven from `getOrderStatusConfig()`; private `getStepIndex()`
   switch deleted; `animate-pulse` marks the in-progress step.
5. `CustomerHero` — banner `h-64` → `h-52` (256 → 208px) below `sm`.
6. `CustomerHero` — «استكشف القائمة» CTA, `md:hidden`, scrolls to the rail.
7. `CustomerLayout` — `id="menu-rail"` anchors that CTA.
8. `CustomerHeader` — consumes `--m-stack-safe-top`.

**CSS**
9. `.menu-rail` removed from the `max-width:100%` list; `.menu-select` padding swapped to
   RTL-correct; `.menu-price__currency` mixes toward `--m-text` instead of `#ffffff`.

**Explicitly not done:** no architecture change, no API/database/schema/business-logic change, no new
dependencies, no new hardcoded colours, no new breakpoints, no `z-index`, no `overflow: hidden`, no
`!important`, no component deletion.

---

## 14 · Files Changed

```
src/theme/brandTheme.ts                        |  47 +++++-
src/theme/semanticTokens.ts                   | 128 ++++++++++++--
src/theme/StickyStack.tsx                     |  35 ++-
src/components/customer/CustomerHero.tsx      | 146 +++++++++++------
src/components/customer/CustomerHeader.tsx    |  11 +-
src/components/customer/CustomerLayout.tsx    |   9 +-
src/index.css                                 |  38 +++-
src/utils/formatting.ts                       |  20 +-
src/tests/statusPaletteContract.test.ts       |  (new, 21 tests)
```

Commit `3f36c40` on `arena/01a10307-restaurantsMureeh`.

---

## 15 · Tests

**Added: `src/tests/statusPaletteContract.test.ts` (21 tests).** Guards three real invariants that
were all violated, and all of which the *naive* repair would reintroduce:

- every `getOrderStatusConfig()` colour slot resolves through a `--m-*` token, never a raw Tailwind
  palette class;
- the lifecycle order is `PENDING→1, PREPARING→2, READY→3, SERVED→4`, and terminal states are `0`;
- `--m-*-strong` clears 4.5:1 on **both** canvases and **differs between modes** (a single fixed
  shade for both is exactly the original defect).

**Mutation-verified, not just green.** Reintroducing the old hardcoded SERVED branch
(`text-zinc-300`) fails the suite on the `SERVED` case and passes on the other four; restoring the
fix returns 21/21. A test that has never been seen to fail is not evidence.

**Coupling made explicit rather than duplicated:** the badge tint alpha is exported as
`STATUS_BADGE_TINT_ALPHA` from `semanticTokens.ts` and imported by the test. When the constant and
the test's copy drifted (0.15 vs 0.10) the test caught it immediately — which is the point.

No decorative tests were added.

---

## 16 · Build Verification

| Gate | Result |
|---|---|
| `tsc -b` | **clean** |
| `oxlint src` | 114 warnings, 0 errors — **identical to baseline** (verified via `git stash`) |
| `vitest run` | **1378 passed**, 79 skipped; 2 files / 1 test fail |
| `npm run build` | **succeeds** (2.75s, 214 kB CSS / 1.14 MB JS) |

**Failure classification.** The 2 failing files (`prismaPostgresValidation.test.ts`, and one test in
`production-hardening.test.ts`) both fail with `@prisma/client did not initialize yet`. Prisma
binaries cannot be fetched in this sandbox, so `prisma generate` cannot run. **Pre-existing and
environmental** — reproduced on the untouched base commit.

**One real regression was introduced and caught during this pass.** `npm run build` began failing
with `SyntaxError: [lightningcss minify] Unexpected token Delim('*')`. The cause was a **doc
comment I wrote**: Tailwind's content scanner reads comments as well as code, and my comment quoted
the illustrative class `bg-[rgb(var(--m-*-rgb)/0.15)]`. `var(--m-*-rgb)` is not a legal custom
property, so Tailwind emitted it as real CSS and the minifier choked. Fixed by rewording the comment
and leaving a warning in the file. Worth stating plainly because it is a trap anyone touching this
codebase will hit: **in this repo, a Tailwind arbitrary-value class written inside a comment
becomes shipped CSS.**

---

## 17 · Remaining Risks

**Verification status: PARTIALLY VERIFIED.**

1. **iOS notch / safe-area — NOT VERIFIED (environment blocked).** `--m-stack-safe-top` is `0px`
   under headless Chromium, where `env(safe-area-inset-top)` is zero. The change is therefore a
   verified **no-op on desktop** and an **unverified improvement on notched iOS**. It needs one
   manual pass on a physical iPhone on the `/r/:slug?qr=` route. The logic is sound and the failure
   mode is bounded (worst case: the header sits 47px lower, matching the pre-existing behaviour of
   the toolbar route), but I am not claiming it works until someone has seen it.
2. **Arabic glyph shaping — NOT VERIFIED.** This sandbox has no Arabic font (`fc-list` unavailable),
   so screenshots show fallback boxes. **Geometry is trusted; typography is not.** Line-wrap
   behaviour with real Arabic shaping (kashida, ligatures) should be eyeballed once.
3. **Prisma-dependent tests — ENVIRONMENT BLOCKED.** Not caused by these changes; reproduced on the
   base commit.
4. **The 412/430px toolbar wrap is still open** (P2-2). Fully characterised — moving `xs` from
   400px to 432px de-wraps every width tested — but deliberately not applied, because it is a
   shared design-system breakpoint affecting four components.
5. **The fold problem is mitigated, not solved** (P2-4). ~48px recovered and a one-tap route added;
   the gallery block still sits between the guest and the food.
6. **Tenant themes other than the default gold were verified by unit test, not by screenshot.** The
   contrast floor was measured across seven palettes programmatically; only the default was rendered.

---

## 18 · Recommended Next Phase

In priority order, with the reason each was deferred:

1. **Hardware pass on notched iOS** — closes the one P1 that is fixed-but-unverified. Half a day.
2. **Decide the `xs` breakpoint (P2-2).** Move `xs: 400px → 432px` in `tailwind.config.js`; the
   measurement in §7 shows this de-wraps 412px and 430px with no other change. Needs a decision
   because four components share the scale.
3. **Self-host the fonts (P2-3).** `Amiri`, `Cormorant`, `Inter`, `Poppins` are referenced by
   `FONT_FAMILY_MAP` and loaded from an unreachable CDN. Self-hosting removes a network dependency
   from a product that must work on restaurant Wi-Fi. This is the highest-value *identity* fix
   remaining — the menu currently cannot render its intended typography at all.
4. **Re-order the hero block (P2-4).** Collapse the gallery behind an affordance, or move the search
   above it. This is the real fix for the fold; it is a redesign, which is why it was not done here.
5. **Audit the manager/KDS surfaces with the same ruler.** They consume the same `--m-*` tokens via
   the arbitrary-value fallback pattern, which means they inherit every fix here — but they were
   never the subject of this audit and their light-mode coverage is unmeasured.
6. **Add one line for P3-1** (`.menu-add { min-height: 44px }`) once card layout can be re-verified
   in both modes.

---

### A note on what this audit did not do

It did not rewrite the theme engine, add a token, change an API, touch the schema, delete a
component, or introduce a dependency. It finished a migration that was 90% complete, repaired three
derived values that were computed without checking their own contracts, and removed one selector
that was quietly breaking three things at once. The architecture was good; it was just being
undermined at the edges by local patches, which is the normal way good architecture degrades.
