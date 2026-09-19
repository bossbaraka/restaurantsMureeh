# Live Menu rebuild — design analysis & verification report

**Date:** 2026-09-19 · **Branch:** `arena/01a0bb15-restaurantsmureeh`
**Scope:** the read-only Live Menu (`/r/{slug}?view=display`), the customer menu's
«تواصل معنا» section, the manager's «التواصل والحجز» settings, and the data/security
plumbing that feeds them.

---

## Part 0 — A note on the design reference

The reference image named in the brief was **never present in this conversation or in
the workspace** (`find` across the checkout returns nothing). This analysis is therefore
built from the written principles in the brief — layout, hierarchy, typography, spacing,
motion rhythm, price placement, category presentation — and from the repository's own
visual language. Nothing here is a reproduction of an unseen file, which is also the
outcome the brief asked for: principles, not a clone.

---

# Part I — Design analysis (A–I)

## A. What the brief actually asks for

Two experiences that must never be confused:

| | **A — Customer Interactive Menu** | **B — Live Menu / Display Mode** |
|---|---|---|
| Who | one guest, phone in hand, ~40 cm away | a room, 3–8 m away, nobody touching it |
| Job | browse → order → pay | advertise, set atmosphere, sell the room |
| Input | taps, scrolling, cart | none (autoplay) + **one** CTA |
| Failure mode | a lost order | a screen that looks like a shrunk website |

Everything below follows from that table. B is not A with the buttons removed; it is a
different medium.

## B. Why the shipped screen failed (measured, not assumed)

The Live Menu in git was a **scrolling menu board**, not signage:

* `dwellSeconds` of 6 / 9 / 14 driven by `setTimeout` — the whole "sequence" was three
  numbers.
* a `setInterval` at **120 ms** painting a progress bar, plus a second `setInterval` at
  **60 ms** drifting the scroll position — 25 React/ layout touches per second, forever.
* `useClock` on a 15 s interval.
* a `keydown` listener registered in a `useEffect` **with no dependency array** — a new
  listener on every render, never removed.

Consequences on a TV that runs 12 hours a day: timer drift, listener growth, constant
repaint, and a look that could not be read from across a dining room because the
typography was sized for a phone.

## C. Separation of the two experiences

* The Live Menu keeps **no** cart, order, quantity or checkout surface. The footer still
  reads «الأسعار تشمل ضريبة القيمة المضافة · للطلب يرجى التوجه إلى الكاشير».
* The customer menu keeps **no** autoplay, no scene clock, no fullscreen chrome.
* They share a data model (`buildLiveSections` reads the same categories/products) and
  nothing visual: the signage system is namespaced under `.display-menu` and the style
  contract test fails the build if a Live Menu component reaches for a `customer-menu`
  or `cart-` class.

## D. The identity system (no archetypes)

The brief forbids hardcoded venue archetypes ("burger = bold", "fine dining = editorial").
Instead one model derives everything from the tenant's own data:

```
resolveLiveProfile(restaurant, sections) → LiveVisualProfile
  ├─ buildBrandTokens(primaryColor, accentColor) → contrast-safe brand pair
  ├─ rgbToHsl(primary)                            → hue / saturation / lightness
  ├─ imageCoverage(sections)                      → how photographic the venue is
  ├─ businessType                                 → RESTAURANT | CAFE | BAKERY
  └─ editorialScore = (1 - saturation) * 0.5 + coverage * 0.3
                      + businessType bonus + lightness bonus        (threshold 0.5)
```

`editorialScore` picks the **typographic voice** (Cormorant Garamond, wide tracking,
square radii, low Ken Burns) versus the **expressive voice** (Tajawal Black, tight
tracking, soft radii, strong Ken Burns). It is a continuous score, not a lookup table:
a muted café and a muted fine-dining room both land editorial, a saturated burger joint
lands expressive, and a venue with **no photography at all** is pushed expressive because
there is nothing to be quiet about.

`imageCoverage` also decides **structure**: sections whose dishes have no photos get no
spotlight beat and no hero panel — a text-only menu is never faked with an image moment.

Output is ~24 `--lm-*` custom properties on the stage element, so the whole screen is
one theme object that a restaurant's own colors drive.

## E. Motion language

Every animation has one job; none of them decorate:

| Motion | Job |
|---|---|
| `lm-scene-in` (820 ms, one-shot) | hierarchy — the new scene settles into place |
| `lm-sweep` (1100 ms light pass) | navigation — "you have moved to the next beat" |
| `lm-ken-burns` (22 s alternate) | storytelling — photography stays alive, never busy |
| `lm-rise` + `--lm-stagger` | hierarchy — crest → name → Latin → tagline in order |
| `lm-row-in` (per dish row, staggered) | attention — the eye walks the price list |
| `lm-drift-a/b` (46 s, two glows) | brand — the room's colour breathing in the corners |
| progress bar `transform: scaleX()` | navigation — how long is left on this beat |

Rules enforced by `liveMenuStyles.test.ts`: no `transition: all`, and keyframes may only
touch `transform / opacity / filter / background* / color / border-color / box-shadow /
clip-path`. Everything that runs for hours is on the compositor; `will-change` is
declared on the Ken Burns and glow layers only.

## F. Scene grammar (the film)

```
intro (8.0 s)  →  [ category (3.4 s) → spotlight (5.6 s) → board (4.2 s + 1.15 s/dish,
                     capped 16 s) ] × sections  →  outro (7.0 s)  →  loop
```

All durations scale by `profile.rhythm` (0.8 / 1.0 / 1.3 pace control), with a 2 400 ms
floor so the fastest setting never flickers. Rules the model enforces:

* unavailable dishes (`isAvailable === false`) never reach the screen;
* a category left with nothing to show is dropped, so an empty section can never become
  an empty beat;
* boards paginate so **every** dish is on screen at some point;
* `intro`/`outro` are skipped for a single-section venue (nothing to introduce).

## G. The single interaction — «احجز طاولتك»

Reservation is a **request**, not a booking, because Mureeh has no reservation engine:

```
name (2–60) · party (1–20) · date (min = today) · time · notes (≤300)
   → buildReservationMessage()  → Arabic WhatsApp text, «بانتظار تأكيدكم»
   → buildWhatsappUrl(dial, message) → https://wa.me/<e164>?text=<encoded>
   → window.open(url, '_blank', 'noopener,noreferrer')
```

The copy on screen says «تم فتح واتساب» and «بانتظار تأكيد المطعم» — the strings
«تم تأكيد الحجز» / «تم الحجز» are asserted **absent** by test. The CTA and the whole
panel are not rendered at all when the venue published no WhatsApp number. While the
panel is open the scene clock is held, so a guest is never cut off mid-form.

There is one central WhatsApp utility (`src/utils/whatsapp.ts`): it cleans the number,
requires 8–15 digits, builds the international dial form, URL-encodes the message and
caps it at 600 characters (≈3.7 KB encoded — a 1 200-char Arabic message encodes to
6 bytes/char and produced a 7 KB link).

## H. The customer «تواصل معنا» section

Guest-menu only, last child of `<main>`. Renders `null` — not an empty shell — when the
venue published nothing. WhatsApp tile first (it is the only channel that starts a
conversation), then instagram → facebook → tiktok → youtube → website, only those that
exist. One channel → single column; more → 2 / 3 / 5 columns across breakpoints. Every
tile carries `rel="noopener noreferrer"`, an `aria-label="{platform} — {restaurant}"`,
and its handle in `dir="ltr"` so Latin usernames do not scramble in RTL. The glyphs are
inline SVG (`lucide-react` no longer ships brand icons) with a visible Arabic label — no
injected HTML anywhere.

## I. Data & security model

* **One row, one truth.** The six fields live on `Restaurant` (tenant scope — a guest
  reserves with the venue, not a branch). No duplicate "contact" table, no Branch copy.
* **Server-side validation is the only validation.** `isAllowedSocialUrl` enforces
  HTTPS, a per-platform host allowlist (incl. `fb.me`, `vm.tiktok.com`, `youtu.be`),
  no credentials, no IP/localhost hosts, no lookalike domains, no control characters,
  ≤ ~1 KB. `javascript:` / `data:` / `vbscript:` / `file:` / `blob:` / `ftp:` and
  protocol-relative URLs are rejected with an Arabic message. Client and server agree
  (asserted by a shared-cases test).
* **Write contract:** omitted key → untouched; `''` → `NULL` (the UI hides the channel);
  value → normalized. WhatsApp must be canonical E.164 or it is stored as `NULL`.
* **Read contract:** `public.ts` re-sanitizes on the way out, omits the whole `socials`
  key when nothing is published, and omits `whatsappNumber` when it is not canonical.
  The public payload never carries a channel the venue did not publish.
* **Audit:** `CONTACT_CHANNELS_UPDATED` records **field names only**, never values.

---

# Part II — Verification report

## 1. What changed

**Live Menu (`?view=display`)** — rebuilt as a cinematic signage screen:
scene-graph model → single rAF clock → five scene components → brand-token theme.
Removed: 3 timer patterns, the 120 ms progress interval, the 60 ms scroll interval, and
the leaking `keydown` listener. Kept: fullscreen, play/pause, prev/next, pace,
images on/off, QR/share modal, poster + video-clip export, clock, watermark, link copy.

**Customer menu** — added the «تواصل معنا» section (guest menu only).

**Manager** — added «التواصل والحجز» to the existing Branding settings card:
WhatsApp + 5 social fields, add / edit / clear / save, inline validation, `''` clears.

**Data** — 6 nullable columns on `Restaurant`, one additive idempotent migration.

**Architecture (this session's last refactor)** — `DisplayMenu.tsx` is now a 6-line
binding between the restaurant context and `LiveMenuStage`, a pure presentation
component that takes `{restaurant, categories, products, onToast}`. That split is what
makes the screen reviewable without a database (see §9).

## 2. Files modified (14)

```
prisma/schema.prisma                              +26
server/routes/manager.ts                          +53   PUT /branding: whatsapp + socials
server/routes/public.ts                           +38   public payload: socials/whatsapp
server/validation/schemas.ts                      +86   socialLinkSchema, brandingSchema
src/components/customer/CustomerLayout.tsx         +5   mounts CustomerSocialSection
src/components/customer/DisplayMenu.tsx          -709   → context binding only
src/components/manager/BrandingSettingsView.tsx  +191   «التواصل والحجز» card
src/index.css                                   +1162   --lm-* signage system
src/services/api.ts                               +50   mapSocials / mapRestaurantRow
src/types/restaurant.ts                           +31   RestaurantSocials + fields
src/tests/displayMenu.test.tsx                    ±96   rewritten for the scene model
src/tests/fulfillment-gate.test.ts                 ±6   migration order (extended)
src/tests/production-hardening.test.ts            +10   window.open allowlist (extended)
src/tests/transfer-details.test.ts                ±24   audit span (extended)
```

## 3. Files added (18)

```
src/components/display/liveMenuModel.ts      406   scene graph + identity profile
src/components/display/useLiveSequence.ts    124   the clock (rAF, pause, prefetch)
src/components/display/LiveScenes.tsx        289   intro/category/spotlight/board/outro
src/components/display/LiveMenuStage.tsx     817   the screen (presentation only)
src/components/display/LiveReservation.tsx   316   «احجز طاولتك» CTA + panel
src/components/common/SocialMarks.tsx         72   inline SVG brand glyphs
src/components/customer/CustomerSocialSection.tsx 163  «تواصل معنا»
src/utils/whatsapp.ts                        118   the ONLY wa.me builder
src/utils/socialLinks.ts                     154   client-side link rules
server/utils/contactChannels.ts              177   server-side link rules
prisma/migrations/20260919180000_add_restaurant_contact_channels/migration.sql
src/tests/liveMenuModel.test.ts              13 tests
src/tests/displayMenu.test.tsx               13 tests   (rewritten, counted above)
src/tests/whatsapp.test.ts                   11 tests
src/tests/contactChannels.test.ts            23 tests
src/tests/customerSocialSection.test.tsx      7 tests
src/tests/liveReservation.test.tsx            8 tests
src/tests/liveSequence.test.tsx               9 tests
src/tests/liveMenuStyles.test.ts              5 tests
```

## 4. Database migration

`prisma/migrations/20260919180000_add_restaurant_contact_channels/migration.sql`

Six nullable `TEXT` columns on `Restaurant` via `ADD COLUMN IF NOT EXISTS`:
`whatsappNumber`, `instagramUrl`, `facebookUrl`, `tiktokUrl`, `youtubeUrl`,
`websiteUrl`. Purely additive — no default, no backfill, no enum, no index, no
constraint, no data touched. `NULL` means "not filled in", which the UI reads as "hide
the channel". Runs through the existing `tsx server/db/deploy-migrations.ts` path
(`prisma migrate deploy`, P3005 fallback). Both deploy-order guard tests were updated.

## 5. API changes

**`PUT /api/manager/restaurants/:id/branding`** — accepts `whatsappNumber` and
`socials { instagram, facebook, tiktok, youtube, website }`. `requireManager()` →
`validateBody(brandingSchema)` (still `.strict()`, so unknown keys are rejected) →
tenant ownership checks. Omitted key = untouched, `''` = clear, value = normalized.
Audits `BRANDING_UPDATED` + `CONTACT_CHANNELS_UPDATED` (field names only). Deliberately
**outside** the `hasCustomBrandingFields` entitlement gate (that gate covers
`promoVideoUrl`/`galleryImages`) — contact details are not a premium feature.

**`GET /api/public/restaurants/:slug`** — adds `socials` (omitted entirely when nothing
is published) and `whatsappNumber` (omitted unless canonical E.164). Both re-sanitized on
read. No new endpoint, no new auth surface, tenant isolation unchanged.

**Client** — `mapRestaurantRow` maps `socials`/`whatsappNumber` (with legacy flat
`*Url` fallback), and `RestaurantContext` line 859 assigns that mapped restaurant
straight to `currentRestaurant` in display mode. Verified by reading the path:
`public.ts` → `api.getPublicRestaurantBySlug` (api.ts:838 `mapRestaurantRow`) →
`setCurrentRestaurant(catalogRes.data.restaurant)` → `LiveMenuStage.restaurant`.

## 6. Tests run

| Command | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npm run lint` (oxlint) | **142 warnings, 0 errors** on 220 files |
| `npm run build` | **✓ built in 2.6 s** (pre-existing chunk-size warning only) |
| `npx vitest run` (full) | **933 passed / 73 skipped / 1 failed** |

Baselines were re-measured in this session from the branch point
(`git worktree add /tmp/basewt f3299c7`, `node_modules` symlinked in), not remembered:

* lint at `f3299c7`: **144 warnings, 0 errors on 203 files** → now **142 on 220 files** (−2).
* tests at `f3299c7`: **854 passed / 1 failed / 73 skipped** → now **933 passed / 1 failed /
  73 skipped**. So **+79 passing tests, no new failures**, and the failing test is the same
  one on both sides.

The single failure is pre-existing and environmental:
`production-hardening.test.ts > redacts sessionToken/qrToken/pin/token/password values`
throws `@prisma/client did not initialize yet` because `npm ci`'s `prisma generate`
postinstall cannot reach `binaries.prisma.sh` from this sandbox. `prismaPostgresValidation`
fails to load for the same reason. Neither touches the code in this change.

The 89 tests covering this work, per file:

```
liveMenuModel      13   scene graph, profile, coverage, empty states
displayMenu        13   stage render, controls, pace, images toggle, export
whatsapp           11   number cleaning, URL building, message wording
contactChannels    23   server rules, schema, client rules, client/server agreement,
                        mapRestaurantRow contract
customerSocialSection 7  empty/1/5 channels, rel, aria, WhatsApp tile
liveReservation     8   CTA presence, panel a11y, "never claims confirmed"
liveSequence        9   frame clock: order, dwell, pause, hold, cleanup, prefetch
liveMenuStyles      5   class↔CSS contract, token contract, animation whitelist
```

## 7. Problems found (and fixed)

Real bugs the tests caught — not test noise:

1. **`socialHandle` invented handles.** `instagram.com/reel/abc123` rendered as
   `@abc123` because it searched *all* path segments. Now first-segment-only with a
   `notHandles` set (`reel|reels|p|stories|watch|shorts|channel|c|user|share|v`),
   falling back to the bare host.
2. **A 7 KB WhatsApp link.** `MAX_WHATSAPP_MESSAGE_LENGTH` was 1 200; Arabic text
   percent-encodes to 6 bytes/char. Capped at 600 (≈3.7 KB).
3. **`--lm-accent` was dead.** Emitted by the model, defaulted in CSS, consumed nowhere.
   Now drives the intro rule gradient and the «مميز» badge.
4. **Five unstyled classes.** `display-menu__scene--intro/--category/--spotlight/--outro`
   were markup with no rule (an invisible-on-a-TV class of bug); they now carry the
   per-beat framing rules. `display-menu__cta-label` was inert and was removed.
5. **Dead `data-kind` attributes** on all five scenes (nothing read them) — removed.
6. **Four regressions my own code caused in existing repo guards** — a repo-wide sweep
   that greps for the literal `dangerouslySetInnerHTML` (a *comment* counts), the
   `window.open` argument allowlist, the audit-interpolation span in `manager.ts`, and
   two migration-order lists. All four guards were **extended**, never weakened.

Still open (documented, not fixed): two other WhatsApp links bypass the central utility.
`CustomerHeader.tsx:47` hard-codes `` `https://wa.me/970593498909?text=…` `` (the platform
support number, as a literal in a component), and `OrderTrackingDrawer.tsx:86` opens
`` `https://api.whatsapp.com/send?text=${encoded}` `` with `window.open(url, '_blank')` —
no `noopener,noreferrer`. Both are outside this task's scope (platform support and order
sharing, not reservations) but both belong on `src/utils/whatsapp.ts` in a follow-up.

## 8. Decisions needed from you

1. **Reservation fields** — is name / party / date / time / notes the right set? Some
   venues will want phone number (WhatsApp already carries it) or "smoking / terrace".
2. **Entitlement** — contact channels are currently free for every plan (outside the
   custom-branding gate). Confirm, or move them behind a plan.
3. **Platform support links** — should `CustomerHeader`'s hard-coded
   `wa.me/970593498909` move to a config value (and onto the shared utility), and should
   `OrderTrackingDrawer`'s share link get `noopener,noreferrer`?
4. **Board density** — `profile.perPage` is currently 4 (editorial, image-led) / 5
   (expressive, image-led) / 7 (editorial, text) / 8 (expressive, text), with each board
   page dwelling `4200 + 1150 × rows` ms up to a 16 s cap. For a venue with 40 items the
   loop is long; do you want a hard page cap, a "top N only" setting, or is a long loop
   the point?
5. **The reference image** — if you can re-attach it I will re-check the hierarchy and
   spacing against it. The current design is derived from the written principles only.

## 9. How to look at it (local preview harness)

`preview/` is already git-ignored in this repo for exactly this purpose. A dev-only
harness renders the **real** `LiveMenuStage` against five stub venues — burger (saturated,
fully photographed), fine dining (muted → editorial serif), café (partial photography),
bakery (no WhatsApp → no CTA) and a bare venue (no images, no logo) — plus an empty
catalog case:

```
npm run dev   →   http://localhost:5173/preview/livemenu.html
```

Vite builds only `index.html`, so the harness is never part of the shipped bundle.
Sample photography lives in `preview/assets/` (also ignored).

**Honest limitation:** this sandbox cannot reach a browser binary
(`storage.googleapis.com` and `cdn.playwright.dev` are both unreachable), so I could not
screenshot the rendered screen. What I *did* verify mechanically: all five venue profiles
render through `LiveMenuStage` without throwing, each emitting 24 `--lm-*` tokens, with
no `undefined` leakage and no ordering affordance; the frame clock was driven frame by
frame for a full loop plus a simulated hour of sleep; and the class/token contract
against `index.css` is checked on every test run. The pixel-level judgement is yours to
make in the preview.
