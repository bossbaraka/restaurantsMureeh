# MUREEH MENU
# PROFESSIONAL REAL-USER UX AUDIT

Branch audited: `arena/01a0ab5c-restaurantsmureeh` (HEAD `f8098df`, working tree untouched — `git status` clean).
Date: 2026-09-16. Method: the product was actually built and run (Vite dev :5173 → API :3001 → embedded PostgreSQL :5433, seeded with the repo's own `e2e/seed-test-data.mjs` plus two audit tenants). Every flow below was driven in a real headless Chromium (touch emulation for mobile) with screenshots saved under `docs/ux-audit-2026-09-16/evidence/` (selected; full set was generated at `/tmp/audit/shots/` during the run). Anything not run is explicitly marked **NOT EXECUTED — reason**.

---

## 1. Audit Scope

| Item | Detail |
|---|---|
| Viewports | Mobile 390×844 (touch, iPhone-class DPR 3), Tablet 1024×768 (touch), Desktop 1440×900 (mouse) |
| Tenants used | `ghosn-cafe` (164 products, 11 categories, real-looking data), `test-tenant-a` (2 products, seeded active order + waiter call) |
| Personas executed | Customer (mobile, tablet, desktop), Manager (email login), Waiter (PIN 1111), Cashier (PIN 3333 + manager POS), Kitchen/KDS (PIN 4444 + manager KDS) |
| Orders created during audit | #1001–#1010 on ghosn-cafe (tables 1–5); #1001, #1004–#1010 paid in cash via POS; #1004, #1008, #1009 progressed through KDS to READY |
| Stress executed | offline order submit + retry, double-tap on confirm, double-tap on waiter call, page reload mid-order, Slow-3G (400 ms / 50 KB/s) cold load, invalid QR / unknown slug / slug without QR |
| Environment limitations (affect evidence, flagged where relevant) | (a) no outbound internet → every Unsplash image URL fails; `/uploads/*` logos of test tenants 404; (b) sandbox has no color-emoji font → emoji render as tofu boxes in screenshots (not counted as product defects); (c) headless Chromium — no real screen reader, no real haptics |
| NOT EXECUTED — reason | Bank-transfer proof **rejection** path; customer order cancel / notes edit / rating / WhatsApp share buttons (present in tracker, not clicked); onboarding wizard "ابدأ تجربتك المجانية"; Platform Admin portal; Live Screen; `?view=display` menu board; Branding save, Menu CRUD, Staff CRUD, QR download/print, receipt print, CSV export (write operations against tenant data — deliberately avoided in a read-only audit); screen-reader traversal (no AT available); real device emoji rendering; real 3G on a real handset |

---

## 2. Executive UX Assessment

The customer-facing menu is visually ambitious and the *happy path* — scan → splash → menu → add → cart → review → submit — works end to end, is idempotent on double-tap, survives an offline submit with a retry, and lands the order in the cashier queue within a second. Staff tools are complete and dense: the manager gets a real operations dashboard, POS, KDS, table map and analytics, all populated with live data.

The experience breaks precisely where the product's own promise is strongest: **"المطبخ الحي — تحديث مباشر"**. In every run, the moment the cashier collected payment, the guest's phone stopped receiving updates (the server closes the QR session on settlement and the tracker then gets `403` on every poll). The guest keeps reading *"لن يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع"* while the kitchen has already marked the order READY. After a reload, the order disappears from the phone altogether. For a guest, this is the difference between "my order is being made" and "did they lose my order?".

Second, the customer surface contradicts itself about payment three times in one flow (review modal: "pay at the cashier after your meal" → tracker: "kitchen won't start until you pay" → menu hero: "the kitchen is preparing your order now"), and it pushes a bank-transfer form on top of the tracker for every order, including plain cash orders.

Third, on mobile the entire top chrome (logo, table, cart, category rail) scrolls away and nothing floats back. A guest who has scrolled 2,000 px into a 164-item menu has no cart, no categories, no search — only the platform's "تجربة العميل الآمنة" banner, which is the one element that does stay pinned.

The first-10-seconds story is split: on a good connection the splash is polished and the menu appears fast; on a throttled connection the screen is **solid black for 15+ seconds** with no logo, spinner or text, because `index.html` ships an empty `#root` in front of a ~1 MB JS bundle.

Staff side: the flows are learnable and the copy is mostly precise about the payment gate. Friction is concentrated in navigation cost (login lives behind the SaaS marketing page's hamburger menu on phones), developer vocabulary leaking into the login screen, raw UUIDs in the activity feed, and small overflow/clipping in the top bar.

---

## 3. Persona Analysis

| Persona | Core Workflow | Observed Experience | Main Friction | Confidence |
|---|---|---|---|---|
| Customer (mobile) | QR → splash → menu → add → cart → review → submit → pay cash → track | Works; order created once even on double-tap; offline submit shows error + retry succeeds. After the cashier takes payment the tracker freezes at "waiting for payment", reload loses the order, splash replays. | F-01 frozen tracker, F-02 no sticky cart/categories, F-03/F-09 contradictory payment copy + forced transfer modal, F-13 black screen on slow network | High |
| Customer (tablet / desktop) | Same | Same layout, same non-sticky header; desktop splash button requires mouse click and works | F-02 identical at 1024/1440 | High |
| Manager | Email login → overview → 12 sections | Clear dashboard with live counters; all sections load with real data in <2 s; wrong password shows remaining attempts | UUIDs in activity feed (F-06), clipped top bar (F-14), jargon on login (F-12), over-limit dish count shown without explanation (F-19) | High |
| Waiter | PIN login → calls inbox → tables → orders | Lands directly on the pending waiter call; badge counts on nav; role label "Waiter" in English | Must choose restaurant from a list of *all* tenants before PIN (F-15); login only reachable via marketing page (F-11) | High |
| Cashier | PIN or manager → POS → table → collect → receipt | Pending-payment queue is explicit ("الطلب محجوز عن المطبخ حتى يتم الدفع"), checkout modal is fast, receipt modal confirms with RC number | Collecting payment silently kills the guest's live session (F-01); "تحصيل ₪0" button stays enabled on empty table (F-20) | High |
| Kitchen / KDS | PIN → KDS → start → ready | Only paid orders appear; explicit banner explains withheld orders; two-tap lifecycle | Guest never sees the state changes the cook is making (F-01) | High |

---

## 4. Customer Journey

### 4.1 QR scan → entry splash
- **Status:** Works (mobile/tablet/desktop).
- **Strengths:** Brand colour applied immediately; table number visible on the splash ("طاولة 1"); "تخطي" escape hatch; swipe or tap both work; total time to menu ≈ 3–4 s on LAN.
- **Friction:** Splash replays on every reload of the same tab even though `merar_welcome_seen_ghosn-cafe` is written to sessionStorage (F-04). Hint text "المس الشعار للمتابعة" + numbered "01 / 02" dots are ornamental rather than informative.
- **Risk:** Guests who refresh (very common when a page "feels stuck") sit through the intro again while their order state is being lost (see 4.9).
- **Evidence:** `c48-after-reload.png`, s28 `C4 reload dialogs ['مدخل غصن كافيه']`, s31 storage dump.

### 4.2 First 10 seconds (perceived load)
- **Status:** Good on fast network; **fails on slow network**.
- **Strengths:** After the bundle arrives the menu skeleton and hero render together; no layout jumps observed.
- **Friction:** Slow-3G emulation (400 ms RTT / 50 KB/s): `document.body.innerText` empty and screenshot is pure `#0A0C10` at +1 s, +3 s, +6 s, +10 s, +15 s. No inline splash, no spinner, no "loading" text (F-13).
- **Risk:** Guest assumes the QR is broken and calls a waiter — the exact interaction the product exists to remove.
- **Evidence:** `r03-slow3g-{1000..15000}.png`; `index.html` line 68 `<div id="root"></div>` with nothing inside; `dist/assets/index-*.js` = 977 KB.

### 4.3 Menu browsing
- **Status:** Works, with a structural navigation defect.
- **Strengths:** Category rail with counts (164 / 22 / 24 …), search placeholder is descriptive ("ابحث عن طبق، مكون، أو صنف…"), gallery section, offers rail, add-to-cart toast + inline quantity stepper appear immediately.
- **Friction:** Header (logo, table, cart, hamburger) is declared `sticky top-14` and the category rail `sticky top-118`, but both scroll away: measured header `y = -287` at scrollY 400 and `-1287` at 1400 on all three viewports. Nothing floats back (no FAB, no bottom bar). Only the platform bar "تجربة العميل الآمنة — يظهر لك منيو مطعمك فقط" (57 px) stays pinned (F-02, F-24). Every product and gallery image is a broken-image glyph with its alt text painted over the card (F-05 — partly environmental, but the fallback design is the finding).
- **Risk:** Deep in a 164-item list, the guest cannot reach the cart or switch category without scrolling all the way up; the one pinned element is platform messaging, not the guest's tools.
- **Evidence:** `c37-deep-scroll.png`, `r02-customer-{tablet,desktop}-scrolled.png`, s14/s15 measurements, s19 ancestor chain (`.customer-shell` `overflow-x: hidden`).

### 4.4 Product → customise → add
- **Status:** Add-to-cart works from the card ("إضافة …" button); size shown inline ("وسط M").
- **Friction:** NOT EXECUTED — full customisation sheet (add-ons / remove ingredients / notes per item). The audit added items from the card's quick-add only. Marked as untested, not as a defect.
- **Evidence:** `c34`, `c36`.

### 4.5 Cart
- **Status:** Works.
- **Strengths:** Table shown in drawer, stepper, delete, per-order notes textarea, totals with "الضريبة والخدمة مشمولة", one primary CTA "مراجعة وتأكيد الطلب".
- **Friction:** Drawer can only be reached after scrolling to the top (4.3). Item thumbnail broken with alt text.
- **Evidence:** `c38-cart.png`.

### 4.6 Review & submit
- **Status:** Works; idempotent.
- **Strengths:** Confirmation modal restates items, total, table; button label states the consequence ("تأكيد وإرسال الطلب للمطبخ"); "تعديل الطلب" secondary. Double-tap created exactly one order (#1001). Offline tap shows a red toast "تعذر إرسال الطلب" and the modal stays with the cart intact; retry after reconnect succeeded (order #1003).
- **Friction:** Modal note says *"المحاسبة تتم نقداً أو بالبطاقة عند الكاشير بعد الانتهاء من وجبتك"* (pay after meal) — the very next screen says the kitchen will not start until payment (F-09). Offline error body reads *"تعذر الاتصال بقاعدة البيانات. تأكد من تشغيل الخادم والاتصال بالشبكة"* — developer language shown to a guest (F-08).
- **Evidence:** `c40-review.png`, `c60-submit-offline.png`, `c61-submit-offline-5s.png`, `c62-after-retry.png`, DB rows #1001–#1003.

### 4.7 Payment prompt
- **Status:** Works mechanically; wrong default.
- **Friction:** Immediately after submit, **two dialogs stack**: the tracker and, on top of it, the bank-transfer form (name*, phone*, receipt image, "إرسال إشعار التحويل" / "لاحقاً"). This appears for a plain cash order that the guest never asked to pay by transfer (F-03). The tracker body underneath simultaneously says "ادفع عند الكاشير".
- **Risk:** Guests who intend to pay cash read a mandatory-looking form with required fields and either abandon or fill it with junk; guests who actually paid by transfer have to find the button again later.
- **Evidence:** `c41`/`c43-after-submit-3s.png` (transfer form), `c45-tracking-after-later.png`, dialogs list `['order-tracking-title','transfer-payment-title']` in s17/s18/s27/s28.

### 4.8 Confirmation & tracking (before payment)
- **Status:** Works.
- **Strengths:** Order number, time, four-stage rail (الاستلام / التحضير / تم الإنجاز / تم التقديم), items and total, contextual actions (تعديل الملاحظات, إلغاء هذا الطلب, طلب النادل, طلب أصناف إضافية), Telegram support handle.
- **Friction:** Closing the tracker shows a hero card titled **"حالة طلبك الفعّال ##1002"** (double hash, F-07) whose body says **"المطبخ الحي يعمل على تجهيز طلبك الآن بكل عناية"** while the order is UNPAID/PENDING and the KDS has not received it (F-09). "(1 طلبات نشطة)" — singular/plural mismatch (F-18).
- **Evidence:** `c47-menu-after-order.png`, s30 `H0`.

### 4.9 Tracking after the cashier collects payment — **the critical break**
- **Status:** **Fails.**
- **Observed (three independent runs, tables 4 & 5, orders #1007–#1010):**
  1. Cashier taps "تأكيد الدفع — ₪5" → receipt "تم الدفع بنجاح RC-2026-0004".
  2. Server sets `paymentStatus=PAID` **and** closes the table session (`tableSession.updateMany → status CLOSED`, `server/routes/manager.ts:3609`).
  3. Guest's 10-s poll `GET /api/public/tables/:id/orders?sessionToken=…` flips from `200` to **`403 "جلسة QR غير صالحة أو منتهية الصلاحية"`** and stays there (s32 timeline: 19:14:42 → 200, 19:14:53 → 403 after payment at 19:14:55 ±).
  4. The tracker keeps showing *"تم استلام الطلب — لن يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع…"* at +3 s, +10 s, +20 s after payment, after KDS "بدء التحضير" (+12 s) and after KDS "تم تجهيز الطلب" (+12 s), while the DB reads `PREPARING` then `READY` (s28/s30 `C1…C3`, `H1…H3`). No toast, no banner, no "connection lost" hint.
  5. Reload → splash → menu with **no active-order card at all** (a new session is minted; old orders belong to the closed one) (s28 `C4`, s29 `HERO []`, s30 `H4 []`).
- **Impact:** The guest can never see "جاهز" or "تم التقديم"; the "Live KDS" promise is never delivered to a paying guest; a guest who reloads believes the order vanished and re-orders or calls staff. Follow-up actions offered in the tracker ("طلب أصناف إضافية", "تعديل الملاحظات") would also hit the dead session — NOT EXECUTED, but the 403 makes success implausible.
- **Evidence:** `z01`–`z04`, `z06`–`z08`, s28.log, s30.log, s32 request log, DB queries.

### 4.9b Bank-transfer path (executed after the first report draft — order #1011, table 1)
- Empty submit of the transfer form shows inline validation ("يرجى كتابة اسم العميل كما هو على إشعار التحويل"). Filled with name/phone/receipt → toast "تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع" and tracker copy switches to a precise waiting-for-cashier message; the tracker button becomes "تحديث إشعار التحويل".
- Cashier POS: proof appears at the top of the queue with name/phone/time; "الطلب والإشعار" opens a proof dialog that states the consequence and that a second confirmation will be rejected; "تأكيد الدفع وإرسال للمطبخ" → toast with receipt id RC-2026-0009.
- **Guest tracker updated within 8 s** to "تم تأكيد الدفع، وجارٍ تجهيز طلبك. (تحويل بنكي/محفظة)" and "طريقة الدفع: تم الدفع". So F-01 is specific to **cash settlement through the POS table bill** (which closes the table session); the transfer-verification path keeps the session alive. Confidence: High. Evidence: `p01`–`p07` in `docs/ux-audit-2026-09-16/evidence/` (selected; full set was generated at `/tmp/audit/shots/` during the run), s36.log.
- NOT EXECUTED: proof rejection, notes edit, order cancel (the run was stopped by the user).

### 4.10 Reload / back / expired session
- Reload mid-order (before payment): order persisted in hero (good, `c48`). After payment: see 4.9. Browser back: NOT EXECUTED — no router; back leaves the app entirely (observed only as URL behaviour, not measured). Expired session (24 h TTL): NOT EXECUTED — would require clock manipulation.

---

## 5. Manager Journey
- **Entry:** `/` renders the SaaS marketing page; login is the "دخول لوحة التحكم" button (desktop navbar; on mobile hidden behind the "فتح القائمة" hamburger, F-11). Wrong password → *"البريد الإلكتروني أو كلمة المرور غير صحيحة (تبقى لك 4 محاولات)"* (good feedback). Login → dashboard in ~6 s with a success toast.
- **Overview:** Status line "النظام متصل ويعمل بكفاءة عالية", attention block ("3 طلب بانتظار تأكيد الدفع" with a one-line explanation of the gate), four KPI cards, three lifecycle columns, live activity feed. The feed labels events by **table UUID** ("e9f38be8-…: تم استلام الطلب") instead of "طاولة 1 / #1001" (F-06).
- **Sections (all 12 opened, all rendered with data):** POS, Orders/KDS screen (explains withheld orders inline — strong), Tables (20, occupancy, per-table "الطلبات" / "معاينة العميل"), Waiter calls, QR (per-table URL, download/print/copy, display-mode link), Menu (164 rows, stock toggle), Offers (good empty state with CTA "إضافة أول عرض"), Branches (upsell placeholder), Staff, Analytics (7-day chart, top dishes), Branding (long form; save NOT EXECUTED), Subscription ("الأطباق المتاحة 164 / 150" — over the plan limit with no warning or consequence explained, F-19).
- **Mobile manager (390 px):** usable; sidebar collapses into "قائمة لوحة التحكم" with a red badge "6"; no horizontal overflow (`scrollWidth 390 = clientWidth 390`). Top bar on desktop clips its last tab ("العر…") at 1440 px (F-14).
- **Evidence:** `m01`–`m15`, `r05-manager-mobile.png`.

## 6. Waiter Journey
- PIN tab lists **every tenant on the platform** ("الشقرة كافيه, غصن كافيه, مطعم الاختبار A/B/C") as a required first choice (F-15). Wrong PIN → *"رمز PIN غير صحيح. يرجى مراجعة مدير المطعم. (تبقى 4 محاولات)"*. Correct PIN (1111) → toast "تم الدخول بنجاح" and lands directly on **نداءات طاقم الضيافة** showing the seeded pending call for table 2 ("منذ 35 دقيقة", "استلام النداء" CTA). Nav shows only the three sections a waiter needs, with count badges. Role chip reads "Waiter" in English inside an all-Arabic UI (F-21).
- Resolving a call: NOT EXECUTED (write action).
- Customer-side waiter call (table 5): 5 typed reasons + note, "إرسال النداء الآن" → success toast; second tap produced no second toast (no duplicate observed). The toast overlaps the modal's own confirmation text (F-10).
- **Evidence:** `w02-pin-tab.png`, `w03-wrong-pin.png`, `w04-after-pin-1111.png`, `v02`, `v03-waiter-sent.png`.

## 7. Cashier Journey
- PIN 3333 → lands on **الكاشير (POS)** with KPI strip, "تحقق من إشعارات التحويلات" queue (explicit copy about why orders are withheld from the kitchen), table grid (occupied tables show the open amount), walk-in button, product grid with category chips, "آخر معاملات اليوم".
- Table 1 → bill panel "#1001 … بانتظار دفع الزبون — تحصيل الفاتورة يفرج عن الطلب للمطبخ" → "تحصيل ₪5" → checkout modal (cash/card/e-wallet, amount with quick chips 50/100/200/500, tip, note) → "تأكيد الدفع — ₪5" → receipt modal "تم الدفع بنجاح, RC-2026-0004, نقدي, الكاشير: مدير غصن كافيه" with "طباعة الإيصال" / "فاتورة جديدة".
- After payment the table returns to "متاحة" and the order leaves the pending list; KDS shows it as new. The guest-side consequence is F-01. "تحصيل ₪0" remains an enabled primary button on an empty table (F-20).
- Transfer-proof verification: executed and works end-to-end (see 4.9b); rejection: NOT EXECUTED.
- **Evidence:** `m04-الكاشير.png`, `k01`, `k02-checkout-modal.png`, receipt text in s27.log.

## 8. Kitchen / KDS Journey
- PIN 4444 → KDS directly. Header "شاشة المطبخ والطهي · تحديث لحظي مباشر"; filters الكل/جديدة/قيد الطهي/جاهزة with counts; banner "N طلب محجوز عن المطبخ: بانتظار تأكيد الكاشير…" explains what is *not* on the board. Card: table, #number, time, quantity × item, one big CTA "بدء التحضير والطهي 👨‍🍳" → "تم تجهيز الطلب (إشعار النادل) 🔔" → card leaves the board; empty state "المطبخ جاهز بالكامل". Toast "تم تحديث حالة الطلب … #1001" confirms each tap.
- Serve step is not on KDS (done from Orders screen / dashboard "تم التقديم للضيف") — reasonable split, but a cook cannot tell from KDS whether READY orders were picked up.
- Mobile KDS: NOT EXECUTED beyond screenshot `r08` (not reviewed in detail).
- **Evidence:** `x02-kds.png`, `x03-kds-preparing.png`, `x05-kds-ready.png`, s26/s28 logs.

---

## 9. Critical Findings

Format: ID · Category · Severity · Persona · Workflow · Screen/Route · Problem / Expected / Actual / Impact / Repro / Evidence / File-Component / Confidence / Direction.

### P0

**F-01 · BUG · P0 · Customer · Track order after paying · `/r/:slug?qr=` tracker + menu hero**
- Problem: Cash settlement from the POS table bill closes the guest's QR session (transfer verification does NOT — see 4.9b); the guest's tracker silently stops updating and the order vanishes after reload.
- Expected: After paying, the guest sees the stages advance (التحضير → تم الإنجاز → تم التقديم) live, and a reload restores the same active order.
- Actual: Tracker frozen on "تم استلام الطلب / لن يبدأ المطبخ قبل تأكيد الدفع" while DB = PREPARING/READY; polls return 403; reload → no order card.
- Impact: Core trust promise broken for every paying guest; drives re-orders and waiter calls.
- Repro: scan table QR → add item → submit → cashier POS: select table → تحصيل → تأكيد الدفع → watch guest tracker for 20 s → KDS بدء التحضير → guest still unchanged → reload guest.
- Evidence: s28.log/s30.log (`C1…C3`, `H1…H4`), s32 request timeline (200 → 403), `z01–z08`.
- File/Component: `server/routes/manager.ts` ~3609 (session CLOSED on settle), `server/routes/public.ts:107` `getQrSession` requires `status:'ACTIVE'`, guest poll in `src/context/RestaurantContext.tsx` (~612 interval, SSE ~874).
- Confidence: High.
- Direction: Keep the guest's read access to *their own* orders after settlement (e.g., allow closed sessions for read-only tracking until orders are SERVED/archived), and surface a visible "connection lost / session ended" state instead of silent 403s.

### P1

**F-02 · USABILITY · P1 · Customer · Browse → cart · menu page (all viewports)**
- Problem: Header (cart, table, hamburger) and category rail scroll off and never return; no floating cart.
- Expected: Cart and category access persistent while browsing a 164-item list.
- Actual: header `y=-287` at scrollY 400; only platform "تجربة العميل الآمنة" bar stays pinned.
- Repro: open menu, scroll 400 px. Evidence: `c37`, `r02-*`, s14/s15/s19.
- File: `src/components/customer/CustomerHeader.tsx` (`sticky top-14`), `src/index.css:2332` `.customer-shell { overflow-x: hidden }` (sticky is broken by an overflow ancestor — UNVERIFIED as sole cause, observed as effect). Confidence: High (behaviour), Medium (cause).
- Direction: Make sticky actually stick or add a persistent bottom cart/category bar.

**F-03 · UX · P1 · Customer · Submit → pay · tracker + transfer modal**
- Problem: Bank-transfer form auto-opens over the tracker for every order, including cash.
- Expected: Tracker first; transfer form only if the guest chooses "الدفع عبر حوالة".
- Actual: Two stacked dialogs; required fields; "لاحقاً" needed to reach the tracker. Evidence: `c41-submitting`, `c43-after-submit-3s`, `c45`, dialogs arrays in s17/s18/s27/s28. Confidence: High.
- Direction: Payment-method choice step, or transfer CTA inside the tracker only.

**F-09 · UX · P1 · Customer · Review → track · confirmation modal, tracker, menu hero**
- Problem: Three contradictory payment messages in one flow: "pay after your meal" (review) → "kitchen will not start until you pay" (tracker) → "kitchen is preparing your order now" (hero, while UNPAID).
- Impact: Guest cannot tell whether to walk to the cashier now or wait. Evidence: `c61` (review note), s27 `C0` text, s30 `H0`. Confidence: High.
- Direction: One payment state machine feeding all three surfaces; hero copy must derive from `fulfillmentState`.

**F-13 · PERFORMANCE_UX · P1 · Customer · First load · `/r/:slug?qr=`**
- Problem: Blank black screen with no indicator until the ~1 MB bundle executes.
- Actual: empty body at +1/3/6/10/15 s on Slow-3G emulation. Evidence: `r03-slow3g-*.png`, `index.html:68`, `dist/assets` sizes. Confidence: High (emulated), real-device timing UNVERIFIED.
- Direction: Inline splash/skeleton in `index.html` (brand colour + "جارٍ فتح القائمة…"), code-split staff surfaces out of the guest bundle.

### P2

**F-04 · BUG · P2 · Customer · Reload · splash** — Splash replays on every reload despite `merar_welcome_seen_<slug>` in sessionStorage. Evidence: `c48`, s28 `C4`, s31 storage. Component: `RestaurantEntryExperience.tsx` / `RestaurantContext.tsx`. Confidence: High (observed), cause UNVERIFIED.

**F-05 · VISUAL · P2 · Customer · Browse · menu cards, gallery, cart** — Missing images render as broken-image glyph + raw alt text ("الصورة الرئيسية لصالة المطعم") over the card; no branded placeholder. Environmental trigger (no internet) but any slow/blocked CDN reproduces it. Evidence: `c47`, `x04`, `c38`. Confidence: High.

**F-06 · UX · P2 · Manager · Overview · Live Activity Feed** — Events keyed by table UUID instead of table number / order #. Evidence: `m03`. Component: `DashboardOverview.tsx`. Confidence: High.

**F-08 · UX · P2 · Customer · Submit offline · toast** — Error body "تعذر الاتصال بقاعدة البيانات. تأكد من تشغيل الخادم…" is developer language. Evidence: `c60`. Confidence: High.

**F-11 · USABILITY · P2 · Waiter/Cashier/Kitchen · Login · `/`** — No direct staff login route; staff must load the marketing page and (on phone) open the hamburger to find "دخول لوحة التحكم". Evidence: `l01b-landing-menu-m.png`, s22 click timeout on hidden button. Confidence: High.

**F-15 · PRODUCT · P2 · Staff · PIN login · LoginModal PIN tab** — When no tenant context exists the PIN tab lists every restaurant on the platform as a required pick; confusing for staff and exposes tenant names. Evidence: `w02-pin-tab.png`, s25 text. Component: `src/components/auth/LoginModal.tsx` (`tenantsList`). Confidence: High.

**F-24 · UX · P2 · Customer · Whole session · ViewSwitcher bar** — The only persistent element on the guest screen is the 57 px platform bar with sound/user icons and the sentence "تجربة العميل الآمنة — يظهر لك منيو مطعمك فقط", which means nothing to a guest and costs 7 % of a phone viewport. Evidence: every customer screenshot. Component: `src/components/common/ViewSwitcher.tsx`. Confidence: High.

**F-29 · PRODUCT · P2 · Customer · Shared link · `/r/:slug` without `qr`** — Opening the restaurant link without a table token shows "هذا الرابط غير صالح للدخول المباشر" and no menu. Likely intentional (table-bound ordering) but blocks browse-only use from social links; the QR section also advertises a `?view=display` board link (NOT EXECUTED). Evidence: `c50-slug-no-qr`. Confidence: High (behaviour), Medium (intent).

### P3

**F-07 · VISUAL · P3** — Hero title "حالة طلبك الفعّال ##1002" (order id already contains `#`). Evidence: `c47`, s30 `H0`.
**F-10 · VISUAL · P3** — Toasts render over modal content (waiter-call confirmation). Evidence: `v03`.
**F-12 · UX · P3** — Login screen shows "Bcrypt & JWT", "Bcrypt Protected", "Anti-Brute Force", "v2.0 SaaS" to waiters. Evidence: `l02-login-d.png`.
**F-14 · VISUAL · P3** — Manager top bar clips last tab ("العر…") at 1440 px. Evidence: `m03`.
**F-18 · RTL/COPY · P3** — "(1 طلبات نشطة)", "3 طلب بانتظار" — Arabic number agreement inconsistent. Evidence: s27 `C0`, `m03`.
**F-19 · UX · P3 · Manager · Subscription** — "الأطباق المتاحة 164 / 150" exceeds plan with no warning/consequence. Evidence: m15 text. Impact UNVERIFIED.
**F-20 · UX · P3 · Cashier · POS** — "تحصيل ₪0" primary button enabled on an empty table. Evidence: s24 `T1 btns`.
**F-21 · RTL · P3** — Role chips "Waiter/Cashier/Kitchen" in English in an Arabic UI. Evidence: `w04-*`.
**F-22 · ACCESSIBILITY · P3** — Two cart buttons in the DOM ("عرض سلة الطلبات" hidden-sm and "عرض السلة — N صنف"); three unlabeled header buttons (`aria-label` empty) in the platform bar. Evidence: s33 `HEADER btns` (`'', '', ''`). Confidence: Medium (labels may be `title`-only).
**F-23 · UX · P3 · Customer · Invalid QR** — Error card is clear but offers no action (no "retry scan" / support link). Evidence: `c50-invalid-qr.png`.
**F-25 · UX · P3 · Customer · Header** — Badge "مقفلة 🔒" next to the table number; meaning unexplained to a guest. UNVERIFIED semantics.

---

## 10. RTL / Arabic
- Direction, alignment and icon mirroring are correct across all screens tested; mixed Arabic/Latin strings ("Ghosn Cafe | غصن كافيه") render in the right order.
- Currency renders as `₪5` consistently; times use Arabic-Indic digits ("٠٦:٣٨ م") while order numbers and prices use Western digits — deliberate mix, readable, but not uniform (analytics chart axis uses "10/9").
- Copy quality is generally high and specific. Defects: number agreement (F-18), English role chips (F-21), "##" (F-07), developer jargon (F-08, F-12).
- Emoji used as icons in waiter-call reasons and KDS buttons (🙋‍♂️ 💧 🧾 👨‍🍳 🔔) — rendering depends on the device font; in this sandbox they were boxes. UNVERIFIED on real devices; low risk on modern phones, medium on older kitchen tablets.

## 11. Responsive
- **Mobile (390):** Guest flow fits; modals are bottom-sheets; manager collapses to a stacked layout with a hamburger and badge; no horizontal overflow. Defects: F-02, F-24, F-11.
- **Tablet (1024, touch):** Guest layout is the mobile layout stretched; header still not sticky (F-02). Staff screens use the desktop sidebar; PIN keypad is large and usable.
- **Desktop (1440):** Guest splash needs a mouse click on the button (works); manager sidebar + content comfortable; top ViewSwitcher clips (F-14); POS three-column layout readable.

## 12. Loading / Error / Empty states
- **Loading:** No first-paint loader (F-13). Submit button shows a busy state (c44 series — not individually reviewed). KDS/POS transitions are near-instant; no skeletons needed on LAN.
- **Error:** Offline submit → clear red toast + preserved modal (good), wording developer-ish (F-08). Wrong password / wrong PIN → precise messages with remaining attempts. Invalid QR / unknown slug → dedicated card, no action (F-23). **Missing:** any error/disconnected state when the guest's polling gets 403 (F-01) — the UI shows a green "مباشر / تحديث مباشر" chip while it is in fact dead.
- **Empty:** Offers ("أنشئ عرضًا خاصًا…" + CTA), waiter calls ("جميع الضيوف يتلقون الخدمة برضا تام"), KDS ("المطبخ جاهز بالكامل" + explanation), POS transactions — all good, specific, and instructive. Orders screen explains withheld orders inline (strong).

## 13. Accessibility (evidence-based, no AT run)
- Dialogs use `role=dialog` with `aria-labelledby`/`aria-label`; primary buttons have descriptive `aria-label`s ("إضافة …", "عرض السلة — 1 صنف"); toasts use `role=status/alert`.
- Gaps: three unlabeled icon buttons in the platform bar (F-22); duplicate cart controls in DOM; focus management after stacked dialogs untested (NOT EXECUTED — keyboard traversal); colour contrast of grey helper text on near-black (e.g., "0 طلبات جاهزة للتقديم") looks low — NOT MEASURED; infinite CSS animations everywhere (screenshots hang unless animations are disabled) with no evidence of `prefers-reduced-motion` handling — UNVERIFIED.

## 14. Trust & Operational Confidence
| Question a user asks | What the product answers |
|---|---|
| Was my order submitted? | Yes — tracker with #number appears immediately; double-tap safe; offline gives an error and keeps the cart. **Strong.** |
| Do I need to pay now? | Contradictory (F-03, F-09). |
| Is the kitchen making it? | Before payment: hero falsely says yes. After payment: tracker falsely says no, forever (F-01). |
| Is it safe to reload? | Before payment yes; after payment the order disappears (F-01) and the splash replays (F-04). |
| Staff: was payment recorded? | Yes — receipt modal with RC id, KPI strip updates, table flips to available. **Strong.** |
| Staff: why isn't the order on KDS? | Explained in three places with consistent wording. **Strong.** |

## 15. Strong UX Decisions (preserve)
1. **Idempotent submit + offline-safe modal** — double-tap and offline retry both behaved correctly; keep the client request id approach.
2. **Payment gate explained everywhere on the staff side** — dashboard, POS, orders screen and KDS all say the same thing in plain Arabic; staff never wonder where an order went.
3. **Role-appropriate landing after PIN** — waiter lands on calls, cashier on POS, cook on KDS; nav shrinks to what the role needs, with count badges.
4. **Confirmation copy that names the consequence** — "تأكيد وإرسال الطلب للمطبخ", "تحصيل الفاتورة يفرج عن الطلب للمطبخ".
5. **Attempt-count feedback on login/PIN failure.**
6. **Empty states that teach** (offers, KDS, waiter calls).
7. **Tenant scoping made visible** ("أنت داخل حساب مطعمك فقط") — reduces manager anxiety in a multi-tenant product.

## 16. Hidden UX Problems (not obvious from a walkthrough)
- Settlement-closes-session (F-01) only shows up if you watch the guest device *after* the cashier acts; a demo that stops at "order submitted" never sees it.
- Sticky chrome failing (F-02) is invisible at the top of the page and in every screenshot taken at scrollY 0.
- The "مباشر / تحديث مباشر" live chip is static — it does not reflect SSE/poll health, so a dead feed looks alive.
- Guest polling continues every ~10 s against a 403 endpoint indefinitely — wasted battery/network and a log-noise source (rate limiter `customerOrdersLimiter` could eventually block a legitimate guest — UNVERIFIED).
- Bundle: the guest downloads the manager, POS, KDS, analytics and landing page code (single 977 KB chunk) to see a menu.
- `merar_view_mode` persists in localStorage; a staff member who last used KDS on a shared device then opens a QR link is fine (QR wins), but a bare `/` without QR goes to the landing — OK; however UNVERIFIED what happens if a guest device previously held a staff session.

## 17. Roadmap
**Immediate (this sprint):** F-01 (keep read access for the guest's own orders after settlement + visible disconnected state), F-09/F-03 (single payment narrative; transfer form on demand), F-02 (persistent cart/category access), F-13 (inline first-paint splash).
**Next:** F-04 (splash once per session), F-05 (image placeholder), F-08 (guest-facing error copy), F-11/F-15 (dedicated staff login route with slug/tenant memory, no tenant list), F-24 (remove or shrink platform bar for guests), F-06 (human labels in activity feed), F-29 (decide browse-only mode).
**Later:** F-07, F-10, F-12, F-14, F-18, F-19, F-20, F-21, F-22, F-23, F-25; reduced-motion support; code-splitting; contrast audit.

## 18. Final User Perspective
1. **Do I understand what this is within 3 seconds?** Yes on a good connection (brand splash + table number); no on a slow one (black screen).
2. **Can I find and order what I want without help?** Yes for the first item; for the fifth item deep in the list I must scroll back up to find the cart.
3. **Do I know whether my order went through?** Yes — immediately and reliably.
4. **Do I know whether and when to pay?** No — I'm told three different things.
5. **Can I see my order progressing?** Only until I pay; after that the screen lies to me and a reload erases it.
6. **If something goes wrong, does it tell me what to do?** Offline: yes (clumsily worded). Dead session: no.
7. **As staff, can I do my job in one screen?** Yes — waiter, cashier and cook each land where they work, and the system explains itself when an order is withheld.
8. **Would I trust this at a busy table?** As a cashier or cook, yes. As a guest who just paid, not yet — fix F-01 and the answer flips.
