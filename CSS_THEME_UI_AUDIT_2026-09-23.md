# 🔍 MUREEH MENU — Comprehensive Theme + CSS + Customer UI Audit
**التاريخ:** 2026-09-23 · **النوع:** READ-ONLY AUDIT — لم يُعدَّل أي ملف مصدري (`git status --porcelain` = 0) · **الحالة:** ⛔ STOP GATE — بانتظار موافقتك قبل أي تنفيذ

---

## A. Executive Summary — ما الذي يعمل فعلاً؟

**النتيجة الأهم:** بنية الـ Theme في هذا المستودع **أفضل بكثير مما تفترض التاسك**. التحقيق يثبت أن «إصلاح Theme Engine» كعنوان غير دقيق — المحرك الحالي سليم معمارياً ومحروس باختبارات:

```
ThemeConfig (server) → normalizeTheme() → buildSemanticTokens() (--m-*)
  → CustomerThemeProvider (كاتب وحيد، scope element واحد، display:contents)
    → Tailwind m.* colors + var(--m-*) في مكونات الزبون (276 استخدام)
    → Compatibility aliases (--brand-*/--theme-*/--menu-*) مشتقة من نفس الحساب
```

- **كاتب واحد** للتوكنز (`CustomerThemeProvider`) — حالات الكتابة الأربع القديمة محذوفة فعلاً من `App.tsx`/`RestaurantContext`/`brandTheme` (موثقة ومُختبرة في `appearanceIsolation.test.tsx`).
- **مكونات الزبون مهاجرة بالكامل** إلى `--m-*`: صفر استهلاك لـ `luxury-*`/`gold-*`/`--brand-*` في `src/components/customer/*.tsx`، ويمنع الرجوع اختبار حارس `customerTokenGuard.test.ts`.
- **ThemePreview يمرّ عبر نفس الأنبوب الإنتاجي** (`ThemeTokensScope → CustomerThemeProvider`) — لا يوجد «محرك ثانٍ».
- **RTL سليم** في الخطوط العاملة: `dir="rtl"` على الجذر، `inset-inline-*` و`margin-inline` في CSS الحاكم، والـ sticky stack مقيس بـ `StickyStack` بدل ارتفاعات مخمَّنة.
- 33 `!important` كلها مبررة (reduced-motion / print / display-static) — لا حروب specificity.

**المشاكل الحقيقية المتبقية** ليست معمارية بل **تنفيذية موضعية**: ① قيم داكنة hardcoded في قسم القائمة CSS تُفقد الضوء معناها في light mode (4 مواضع)، ② كلاسات Tailwind ميتة (`animate-in` family بلا plugin — 34 استخداماً، و`py-0.2`) تعني أن رسم الدروارات/الشيتات لا يحصل أصلاً، ③ تعارض cascade واحد حقيقي (`.menu-empty` مقابل كلاساته الخاصة)، ④ ازدواجية نظام ألوان الحالة (60 استخدام emerald/amber/red مقابل توكنز `--m-success/-warning/-error` الموجودة أصلاً)، ⑤ تشظّي الطباعة: 3 أكوام serif متبارزة و`font-serif` بلا خط عربي، ⑥ تحميلان متضاعفان (`.mload` في index.css مقابل `.mload-root` في ملف CSS منفصل) مع معركة z-index بينهما (90 مقابل 9999)، ⑦ شاشة ترحيب قديمة ميتة إنتاجياً (`LuxuryWelcomeScreen` 1623 سطر + 543 سطر CSS `.welcome-*` تعيش بالاختبارات فقط)، ⑧ فجوات Preview parity صغيرة (chip radius)، ⑨ تسريبات platform/customer (scrollbar داكن عالمي، قاعدة `min-height:38px` غير محصورة).

---

## B. Theme Architecture Issues

| # | الحالة | التقييم |
|---|---|---|
| B1 | `CustomerThemeProvider` كاتب وحيد + aliases مشتقة من نفس الدالة | ✅ سليم — لا تغيير |
| B2 | `display:contents` على الـ scope + لا `createPortal` في المشروع (متحقق، واختبار يمنع إدخاله) | ✅ سليم |
| B3 | `resolveSurfaceMode` يُحلّ مرة واحدة؛ `data-appearance` لا يحمل "auto" أبداً | ✅ سليم |
| B4 | العقد `''` = غياب للتجاوزات الاختيارية (`--card-bg` إلخ): React يحذف الخاصية → الـ CSS fallback يعمل | ✅ سليم (موثق ومقصود) |
| B5 | **فجوة:** قواعد قسم القائمة في `index.css` تستهلك aliases داكنة افتراضية + قيم داكنة ثابتة، و`data-appearance='light'` يعيد تعريف أسطح `--menu-*` فقط — النصوص/الحدود/التظليلات المكتوبة يدوياً تبقى داكنة (تفاصيل في I) | ⚠️ HARDCODED_STYLE |
| B6 | **فجوة:** `LuxuryWelcomeScreen` (المستخدمة بالاختبارات فقط) تركّب `text-m-text` (وَعْي بالمظهر) فوق canvas داكن دائم `--welcome-canvas:#0a0b0d` → نص شبه أسود على أسود لو تفعّلت. **غير مؤثرة إنتاجياً اليوم** لأنها لا تُعرض إلا بالاختبارات — لكنها قنبلة موقوتة إن أُعيد استخدامها | ⚠️ ميتة إنتاجياً |
| B7 | سلسلة الوكالة DEFAULT→PLATFORM→LEGACY→RESTAURANT→BRANCH تعيش في `normalizeTheme`/`themeResolver` (خادم) مع `source` مُعلن — لم أجد خللاً في مسار الزبون | ✅ لا تغيير بدون إثبات خلل |

## C. CSS Issues

1. **تعارض cascade حقيقي — `.menu-empty` (index.css:1505) ضد كلاساته في `CustomerLayout.tsx:455`:** كلاهما يضبط `border-radius/background/border/padding`. المؤكد بالـ CSS المبني: `.menu-empty` يأتي بعد utilities → `rounded-2xl bg-m-surface/60 border-m-hairline p-6 sm:p-8` **ميتة بصرياً** (الشفافية المقصودة /60 غير متحققة؛ الخلفية معتمة). نفس النمط على `.menu-empty__icon` (CSS يغلب `w-12 h-12 bg-m-surface-raised/80 text-m-text-muted flex...`).
2. **كلاسات Tailwind ميتة — إدخالات بلا CSS مُولَّد (مُثبت بفحص `dist/assets/*.css`):**
   - `animate-in`, `slide-in-from-bottom`, `slide-in-from-top-3`, `fade-in` — **34 استخداماً** في 10 ملفات زبون. هذه واجهة plugin `tailwindcss-animate` و**غير مثبت وغير مسجل في `plugins: []`**. النتيجة: قائمة الجوال، درج السلة، شريط الطلبات العائم، المُنبيه، toast إتمام الطلب… **تظهر دفعة واحدة بلا رسم دخول** (نيّة المؤلف موثقة في الكود).
   - `py-0.2` في `CustomerHeader.tsx:195,219` (شارة عدد السلة) — `0.2` ليست في سلم Tailwind → لا padding رأسي للشارة.
3. **قواعد داكنة صمّاء أمام light mode** داخل قسم القائمة — التفاصيل الكاملة والأسطر في القسم I.
4. **قاعدة لمس غير محصورة (index.css:1576):** `@media (max-width:640px){ button,input,select{min-height:38px} }` — مُحدد عالمي يمس Manager/Admin على الشاشات الصغيرة (تسريب customer↔platform بالاتجاه المعاكس). تعمل اليوم بلا ضرر مرئي، لكنها تخرق مبدأ العزل.
5. **Scrollbar داكن عالمي (index.css:1495-1502):** `::-webkit-scrollbar { background:#0D0E12; thumb:#262933 }` — لصق داكن على كل الأسطح بما فيها platform light.
6. **CSS ميتة مشحونة في الحزمة (مؤكد في dist):** `.glass-panel`, `.gold-gradient-text`, `.luxury-border`, `.luxury-border-gold`, `.bg-subtle-pattern` — صفر مستهلكين في كل `src/`.
7. **ازدواجية ملفات الـ loader:** `CustomerLoadingExperience` يركّب `className="mload-root mload"` → نظاما تسمية مختلفان (`.mload-root/.mload-stage/...` في `customerLoadingExperience.css` مقابل `.mload__*` BEM في index.css:3223+) يلبسان **نفس العنصر**، مع تعريفات أساس مكررة (`position:fixed; inset:0; display:flex; padding; overflow; color`) ومعركة z-index: `.mload{z-index:90}` (index.css:3252) مقابل `.mload-root{z-index:9999}` (ملف CSS، سطر 10) — 9999 يفوز **بسبب ترتيب الاستيراد فقط** (specificity متساوية).
8. `!important` (33): كلها داخل `prefers-reduced-motion`/`@media print`/`[data-static]` للعرض — **مبررة، لا تُمس**.
9. index.css (5913 سطر) مقسم فعلياً 8 أقسام موثقة بتعليقات ممتازة؛ لا duplicate selectors ضمن قسم الزبون؛ الازدواج الوحيد الحقيقي هو الـ loader (بند 7) و`.welcome-*` (K).

## D. UI/Layout Issues

- **منطق التخطيط سليم**: `StickyStack` يقيس الـ bands الفعلية وينشر `--m-stack-h`/`--m-stack-above-header` — لا ارتفاعات مخمنة (محروس باختبارات `menuStyles.test.ts`).
- `.menu-empty` (بند C1): النية كانت بطاقة شفافة 60%؛ الواقع بطاقة معتمة — تعارض لا اختيار تصميمي.
- شارة السلة بلا padding رأسي (`py-0.2` الميتة) — تبدو مضغوطة عمودياً.
- `.menu-layout-switch button` 28px + hit-area 44px ✓، `.menu-qty button` 26px + 40px ✓ — أهداف اللمس سليمة.
- فروق radius طفيفة داخل نفس العائلة (تُصنَّف، لا تُسطَّح — انظر القسم 5/Phase-5 أدناه): card=16px (من `--card-radius` الافتراضي lg) مقابل media الداخلية 15px (مقصود بصرياً) مقابل qty 12px/9px وswitch 11px وmeta 7px وempty 22px وrail 18px.
- `OrderCompletedModal` z-40 بينما الدروارات z-50: لا تعارض فعلي اليوم (لا يُفتحان معاً — الدروار يُغلق قبل شاشة الإتمام)، لكنه غير متسق مع سلّم الطبقات (J/Stacking).

## E. Responsive Issues

**الخلاصة: لا horizontal overflow متوقع.** الأدلة:
- القيد الهيكلي الصحيح: `.menu-cats{min-width:0}` + `overflow-x` داخل المسار نفسه؛ `.customer-shell{overflow-x:clip}` و`--m-gutter` واحدة يقرأها `main` والـ rail معاً (لا تثليث).

- الوحيد `100vw/100dvh`: `max-width:100vw` (index.css:3169 داخل قفل viewport القائمة) + `height:100vh/100dvh` بالـ loaders (fixed بإطار مخصوص) — لا مُسبِّب تمرير جانبي. `w-screen` لدرج السلة داخل حاوية `fixed inset-0 overflow-hidden` — مُقصاصة بأمان.
- شبكة المنتجات: 1 عمود → 2 (`≥640px`) → 3 (`≥1100px` layout grid) مع `minmax(0,1fr)` في كل المستويات ✓.
- `xs` breakpoint معرّف فعلاً (400px، مؤكد في CSS المبني بصيغة `width>=400px`) — تعليق الـ config سابق لأوانه/محسوم.
- نقطة ضعف وحيدة: `.menu-toolbar` يلفّ سطراً ثانياً متوقعاً تحت 400px (سلوك مكتوب ومقصود بـ `flex-wrap`).

## F. RTL Issues

- الجذر `dir="rtl"` + `<html dir="rtl" lang="ar">`؛ الأسهم/الشيفرون معكوسة صحيحاً (`ArrowLeft/ChevronLeft` للأمام)؛ السحب الأفقي للغاليري يحترم RTL صراحةً.
- CSS الحاكم يستخدم `inset-inline-start/end` و`margin-inline` (rail، edge-fades، badges) ✓.
- **بقايا فيزيائية مقصودة أو غير مؤذية** (لا تُمسّ بشكل أعمى): `.menu-select` يستخدم `background-position:left` + `padding` فيزيائي مع تجاوز منطقي `paddingInlineStart` inline — يعمل RTL صحيحاً؛ `left-0` لدرج السلة (يفتح من اليسار عمداً مع `border-r`)؛ `left-4 right-4` للأشرطة العائمة متناظرة.
- `dir="ltr"` على الأسعار (`menu-price__value`) ✓ — أرقام وعملة بلا انعكاس.
- **الوحيد المستحق إصلاح:** لا شيء إلزامي في هذه الجولة. (التحويل الشامل logical-properties = refactor واسع ممنوع بدون خلل مثبت.)

## G. Accessibility Issues

1. **`.menu-select:focus-visible { outline:none }` (index.css:975-977):** يُبطل حلقة التركيز العالمية (`:where(...):focus-visible` بطبقة base) — يبقى تغيّر `border-color` وحده كمؤشر تركيز (ضعيف علىWCAG 2.4.7). `.menu-toggle` المجاور يحصل على الحلقة العالمية — تناقض بين عنصري التحكم المتجاورين.
2. **تباين status في الوضع الداكن:** نصوص `text-emerald-400/amber-400` (فاتحة) مختارة عمداً للتباين على الداكن — لكنها خارج نظام التوكنز (J). النقاط/الخلفيات تستعمل -500 — كلها فوق 3:1 كعناصر غير نصية ✓.
3. أهداف اللمس: 40-44px عبر `::after` expanders ✓ (محروسة).
4. `prefers-reduced-motion`: مغطى عالمياً (index.css:96-102) + أقسام display/entry/mload خاصة ✓. **لكن** رسوم الدخول الميتة (C2) تعني أن reduced-motion لا يخصّ شيئاً هناك أصلاً — إحياؤها (M4) سيورّث الحماية العالمية تلقائياً.
5. قصّ النص: `line-clamp:1` للعنوان و2 للوصف في بطاقة المنتج — مع fallback مقصود (زر «تخصيص»/المودال يعرض كامل النص) — مقبول وموثق.
6. `aria-*` جيدة (live regions على العدّادات، `aria-modal`، `role=tablist`، تسميات عربية كاملة).

## H. Preview/Production Issues

المحاذاة شبه كاملة (نفس الأنبوب). الفجوات المؤكدة:

| العنصر | الواقع (menu) | Preview | الأثر |
|---|---|---|---|
| chip القسم radius | `999px` hardcoded (index.css:890) | `var(--m-radius-full)` (افتراضي **9999px**) | بصرياً متطابق كـ pill؛ **ينكسر فقط** لو theme غيّر `radius.full` — Preview يتغير والقائمة لا |
| مادة البطاقة | + inset highlight أبيض 3.5% + hover lift | بلا inset/hover | Preview أهدأ — مقبول لعينة ثابتة (توثيق فقط) |
| زر الإضافة radius | `var(--button-radius)`=radius.md | `var(--m-radius-md)` | متطابقان بالاشتقاق ✓ |

## I. Hardcoded Values — الجرد والتصنيف (قسم القائمة 794-1600 + ملفات الزبون)

**142 hex** في index.css (معظمها أقسام display/entry/landing غير-Zبونية أو fallbacks). الجدول يغطي ما **يؤثر على الزبون**:

| القيمة | السطر | التصنيف | القرار |
|---|---|---|---|
| `.menu-toggle:hover{color:#eef1f6}` | 993 | **A — Theme-dependent (داكن فقط)** → خطأ light mode | استبدال بـ `var(--menu-text-strong, #eef1f6)` |
| `.menu-meta{background:rgb(255 255 255/.035);border:...255/.05}` | 1303-1321 | A → يختفي في light | صباغة من `--m-text-rgb` (نفس المنظر داكنًا) |
| `.menu-add--customize{bg white/5%; border white/10%}` | 1394-1397 | A | كما أعلاه |
| `.menu-card` inset highlight `rgb(255 255 255/.035)` + hover `/.05` | 1284,1297 | A (شبحي في light، غير مؤذٍ) | كما أعلاه (تطابق تام داكنًا) |
| `.menu-media{border:rgb(255 255 255/.05)}` | 1349 | A | كما أعلاه |
| scrollbar `#0D0E12/#262933/#C5A880` | 1495-1502 | A (عالمي) | ربطها بتوكنز platform أو حصرها — موضع قرار |
| chevron `.menu-select` svg `stroke='%239aa3b2'` | 963 | B/C — رمز ثابت على سطح raised (مقروء بالمظهرين) | يبقى (موثق) |
| `#fff1f1` على خلفية error | 1359 | C — نص على status | يبقى |
| fallbacks `#f4f6fa/#9aa3b2/#98a1b0/#f6f8fb/#e6e9f0/#fff` | 1469,1494,1518,1691… | B — fallbacks بعد توكن يعمل | تبقى (لا تُعرض أبداً داخل الـ scope) |
| `--welcome-*` canvas داكن | 261-267 | C — canvas تعريفي داكن | يبقى (المكوّن ميت إنتاجياً — K) |
| `.mload-*` لوحة محلية `--ml-*` | 3245+ | C — فن تحميل معفى ومسجل بـ customerTokenGuard | يبقى |
| `menu-empty` radius 22px، rail 18px، media 15px، qty 12/9px، switch 11px، meta 7px | 1508/838/1139/1418-1420/1004/1308 | B — هرمية داخلية | تبقى (ممنوع التسطيح؛ التوكنز تغطي card/button/badge/chip) |
| customer TSX: 60 usages `emerald/amber/red/sky-*` | 14 ملف | **D — ازدواجية توكنز الحالة** | J/M6 |

**قاعدة الالتزام:** لا حذف أعمى — كل قيمة أعلاه لها تصنيف واحد فقط، والإصلاحات المقترحة (M) لا تمس إلا الصفوف المصنفة A.

## J. Token Duplication

1. **ألوان الحالة — ثلاثة مصادر تتنافس:** (أ) توكنز `--m-success:#10B981/--m-warning:#F59E0B/--m-error:#EF4444` + قنواتها RGB (موجودة وغير مستهلكة تقريباً!)، (ب) `getOrderStatusConfig` (formatting.ts:129+) يرجع كلاسات Tailwind صلبة (amber/blue/emerald/red)، (ج) 60 استخدام مباشر emerald/amber/red في 14 مكوّن. القيم -500 تطابق التوكنز حرفياً؛ -400 (نصوص داكنة) ظل أفتح **مقصود للتباين**.
2. **العائلات الثلاث `--brand-*/--theme-*/--menu-*` مقابل `--m-*`:** ليست ازدواجية قيم — aliases مشتقة من نفس الحساب (معمارياً سليم، مؤقت بحسب التصميم حتى تكتمل هجرة CSS). استهلاك الـ CSS الحالي: `--brand-*`×192، `--menu-*`×27 مقابل `--m-*`×6 — **الهجرة الكاملة لقسم القائمة في index.css مهمة لاحقة كبيرة**، لا تدخل نطاق «إصلاح» هذه الجولة (قاعدة: الحفاظ على التوافق القديم حتى يثبت أمان إزالتها).
3. **أكوام serif ثلاثة:** Tailwind `font-serif` = Cormorant فقط (35 استخداماً على عناوين عربية!) / `--font-serif` = Amiri-first (3 استخدمات) / hardcoded `'Cormorant Garamond', Georgia` (menu-card__title-en, section-head__sub — عناصر لاتينية فقط، مقبول). **الفجوة:** العناوين العربية بـ `font-serif` تسقط إلى serif الجهاز، بينما الـ loader يعرض الاسم بـ Amiri — هوية مطعم بنوعين مختلفين في نفس الجلسة. ملاحظة إضافية: `--font-sans:'Inter',...` في `:root` — **توكن ميت** (صفر مستهلكين، وInter غير محمّل أصلاً في index.html).
4. **z-index:** سلّم شبه منظم (20 rail → 30 header/bar → 40 notifier → 50 درواب/درج → 60 entry/transfer → 100 table-entry → 120/130 guide) مع شاذّين: `z-[9999]` (toast المنصة — مقصود كسقف فوق كل شيء) و`9999` (loader) الذي يتصارع مع 90 داخلياً (C7).

## K. Legacy Consumers (ما الذي ما زال على القديم ولماذا)

| المستهلك | الحالة | القرار المقترح |
|---|---|---|
| قسم «CUSTOMER MENU» في index.css (على `--brand-*/--menu-*/--card-*`… عبر aliases) | يعمل بدقة بفضل الاشتقاق الموحد | **يبقى** — هجرته إلى `--m-*` مشروع منفصل (تقريباً 230 مرجعاً) |
| `LuxuryWelcomeScreen` (1623 سطر) + `.welcome-*` CSS (543 سطر: 253-795) + اختباراته | **ميت إنتاجياً** — لا يعرضه أي مكوّن؛ البديل `RestaurantEntryExperience` | هذا الجولة: توثيق فقط. الحذف (مكوّن+CSS+اختباراته) قرار منفصل يتطلب موافقة صريحة (يتجاوز «minimal diff») |
| `getOrderStatusConfig` بكلاساته الصلبة | يعمل | إما ربطه بالتوكنز (M6) أو توثيقه كاستثناء — لا تركه بلا قرار |
| `--font-sans` (Inter) | ميت | حذف سطر واحد (أو محاذاته لمكدس Tajawal) |
| `.glass-panel/.gold-gradient-text/.luxury-border*/.bg-subtle-pattern` | ميتة في الحزمة كاملة | حذف اختياري (5 قواعد) — خارج نطاق الزبون، لا يُنفذ إلا بموافقة |
| dark scrollbar عالمي | يعمل | موضع قرار (M8) |

## L. Root Causes (تصنيف نهائي — كل قضية لسبب جذري واحد)

| القضية | السبب الجذري |
|---|---|
| نص/حدود/تظليل داكنة في light mode (I-A) | **HARDCODED_STYLE** |
| `.menu-empty` التailwind الميتة | **CSS_CONFLICT** (تحكّم مزدوج، يحسمه الترتيب) |
| لا رسم دخول للدروارات/الشيتات (34 استخداماً) | **ANIMATION** (plugin واجهته الكلاسات غير مثبت) |
| شارة السلة مضغوطة | **LAYOUT** (`py-0.2` خارج السلم) |
| ازدواجية ألوان الحالة | **TOKEN_DUPLICATION** |
| هوية العناوين العربية بنوعين | **TYPOGRAPHY** (Tailwind serif بلا وجه عربي) |
| loader بنظامين + معركة z-index | **STACKING** + ازدواجية ملفات (COMPONENT_OVERRIDE/تاريخي) |
| `.menu-select` بلا حلقة تركيز | **ACCESSIBILITY** |
| chip radius بين preview والواقع | **PREVIEW_PARITY** |
| `LuxuryWelcomeScreen`/`.welcome-*` | **LEGACY_COMPATIBILITY** (ميت إنتاجياً) |
| scrollbar داكن عالمي + قاعدة 38px | **CASCADE** (تحديد نطاق مفقود) |
| (لا توجد) | THEME_ARCHITECTURE — المحرك نفسه سليم |

## M. Proposed Fixes (خطة تنفيذ — بعد موافقتك فقط)

**WAVE 1 — إصلاحات الأعطال (diff صغير، مخاطر شبه معدومة):**

1. **`src/index.css`** — إزالة الصماء الداكنة (5 مواضع من جدول I): استبدال `rgb(255 255 255 / α)` و`#eef1f6` بصباغة من `--m-text-rgb`/`--menu-text-strong`. التزام: قيمة الداكن تتغير من `255,255,255` إلى `243,245,249` (نص الداكن الحالي) — فرق غير مُدرك (ΔE<1 على شفافيات ≤5%)، والفاتح يُصلح.
2. **`src/index.css:975-977`** — حذف `outline:none` من `.menu-select:focus-visible` (يرث الحلقة العالمية؛ تبقى إضافة border-color).
3. **`src/components/customer/CustomerLayout.tsx:455-456`** — حذف الكلاسات المتعارضة الميتة (`rounded-2xl bg-m-surface/60 border border-m-hairline p-6 sm:p-8` و`w-12 h-12 rounded-full bg-m-surface-raised/80 flex items-center justify-center text-m-text-muted`)؛ يبقى CSS الطبقة وحدها مصدر الحقيقة (تصفح شفافية 60% يتحقق أخيراً — انظر P).
4. **إحياء رسوم الدخول (اختر خياراً):**
   - **(موصى به)** إضافة `tailwindcss-animate` كـ devDependency وتسجيله في `plugins` — السبب الجذري مباشرة؛ الكلاسات المكتوبة هي واجهته الحرفية.
   - بديل بلا اعتماديات: ~25 سطراً keyframes+utilities مكافئة في index.css.
   - في الحالتين يرث `prefers-reduced-motion` الحماية العالمية الجاهزة.
5. **`src/components/customer/CustomerHeader.tsx:195,219`** — `py-0.2` → `py-0.5`.
6. **`src/components/customer/customerLoadingExperience.css:10`** — حذف `z-index:9999` من `.mload-root` (يتحكّم `.mload{z-index:90}` كمالك وحيد) + حذف أسطر الأساس المكررة الثمانية من `.mload-root` (position/inset/display/padding/overflow/color) لأن `.mload` يعرفها — **نفس العنصر، مصدر واحد**.
7. **`tailwind.config.js`** — سطر واحد: `serif: ['Cormorant Garamond', 'Amiri', 'Georgia', 'serif']` — العربية تستقر على Amiri (المحمّل) بدل serif الجهاز، واللاتينية تبقى Cormorant بلا أي تغيّر بصري.

**WAVE 2 — توحيد (بعد نجاح Wave 1 ومراجعته):**

8. **ألوان الحالة:** إضافة `m.success/m.warning/m.error` (باستخدام قنوات `--m-*-rgb` الموجودة) إلى `tailwind.config.js`، ثم استبدال موضعي **فقط** للاستخدامات الدلالية الصريحة (نقاط الحالة، حدود/خلفيات الشارات بألفا) في مكونات الزبون + `getOrderStatusConfig`. نصوص `-400` تبقى ظل تباين للداكن موثقة التعليق (أو تُرحّل لاحقاً بقرار منفصل).
9. **Preview parity:** `.menu-chip{border-radius:var(--radius-full,999px)}` (index.css:890) — لا فرق مرئي افتراضياً (999→9999px كلاهما pill)، ويستعيد التزامن مع `radius.full` المخصص.
10. **حصر قواعد عالمية:** تغليف قاعدة اللمس 38px (index.css:1576) تحت `.customer-theme-scope`، وربط ألوان الـ scrollbar بتوكنز platform (أو حصرها بـ `.dark`) — قرار مطلوب منك بالخيارين.

**خارج النطاق عمداً (موثقة فقط):** هجرة قسم القائمة CSS إلى `--m-*`، حذف `LuxuryWelcomeScreen`/`.welcome-*` واختباراتها، حذف الـ utilities الميتة platform (`glass-panel`…)، تحويل شامل إلى logical properties، أي مساس بمنطق الطلب/المصادقة/API/DB.

## N. Files To Change

| الملف | التغيير | السبب |
|---|---|---|
| `src/index.css` | ~12 سطراً في 8 قواعد (I-A) + حذف outline:none + (W2) chip radius + (W2) حصر قاعدتين عالميتين | HARDCODED_STYLE / ACCESSIBILITY / PREVIEW_PARITY / CASCADE |
| `tailwind.config.js` | serif stack + (W2) ألوان m.status + (M4) plugins | TYPOGRAPHY / TOKEN_DUPLICATION / ANIMATION |
| `src/components/customer/CustomerLayout.tsx` | حذف كلاسات متعارضة (سطران) | CSS_CONFLICT |
| `src/components/customer/CustomerHeader.tsx` | `py-0.2`→`py-0.5` (موضعان) | LAYOUT |
| `src/components/customer/customerLoadingExperience.css` | حذف z-index و8 أسطر مكررة من `.mload-root` | STACKING |
| `package.json` + lockfile | (إن وُافق M4-أ) `tailwindcss-animate` devDep | ANIMATION |
| (W2) 14 ملف زبون + `src/utils/formatting.ts` | استبدال موضعي لألوان الحالة الدلالية | TOKEN_DUPLICATION |

**لا يُمسّ:** أي ملف server/، `prisma/`، `CustomerThemeProvider`/`semanticTokens`/`brandTheme`/`normalizeTheme` (المحرك سليم)، `ThemePreview.tsx`، أقسام landing/display/entry في index.css، منطق الطلب أو المصادقة.

## O. Files Intentionally Not Changed

`src/theme/*` (سليم ومحروس)، `src/components/display/*` (forceMode dark تعريفي)، `LuxuryWelcomeScreen.tsx` و`.welcome-*` (قرار حذف منفصل)، `src/components/common/Toast.tsx` (z-[9999] مقصود كسقف — يوثق فقط)، `getOrderStatusConfig` في Wave 1 (يدخل W2 فقط)، fallbackات التوكنز B في جدول I (لا تُعرض أبداً).

## P. Risk Assessment

| البند | الخطورة | التخفيف |
|---|---|---|
| صباغة `--m-text-rgb` بدل الأبيض الثابت | أدنى — الداكن ΔE<1 غير مُدرك | مقارنة بصرية قبل/بعد على التيم الافتراضي |
| إحياء رسوم الدخول | منخفض — يعيد نيّة موجودة في الكود | حماية reduced-motion قائمة؛ فحص الدروارات يدوياً |
| `.menu-empty` تصبح شفافة فعلاً | **تغيير بصري مقصود واحد** (النية الأصلية /60) | لقطة قبل/بعد للموافقة |
| serif + Amiri | منخفض — العربية فقط تتغير (Cormorant بلا glyphs عربية أصلاً) | لقطة لاسم مطعم عربي/إنجليزي |
| حذف `z-index:9999` من loader | أدنى — 90 يفوز سلوكياً كما كان مقصوداً | ترتيب الظهور لا يتغير (loader قبل كل شيء) |
| ألوان الحالة (W2) | متوسط — قيم تتحرك من -400 إلى توكن في مواضع | جدول قبل/بعد لكل موضع؛ النصوص -400 تبقى |

**خط الأساس المُثبت هذه الجولة (أوامر package.json الفعلية):** `npm run lint` → 0 errors/166 تحذيراً سابقاً · `npx tsc -b` → PASS · `npm run build` → PASS (تحذير chunk-size فقط) · `npm run test` → **1342/1343 ناجح**؛ الملفان الفاشلان (`prismaPostgresValidation`, `production-hardening`) بسبب تعذر `prisma generate` في الـ sandbox (حجب شبكتي لـ binaries.prisma.sh) — **غير مرتبط بالثيم/CSS ويُتوقع نجاحه في بيئتك**.

**معيار التحقق بعد التنفيذ:** إعادة الأوامر الأربعة + `git diff --stat` مطابق تماماً لجدول N + مصفوفة الانحدار (Surface×Light/Dark/Custom×Mobile/Desktop) بلقطات فعلية للأسطح: Welcome/Header/Categories/Product Cards/Buttons/Badges/Cart/Modal/Empty/Loading/Presentation.

---

## 🛑 STOP — بانتظار موافقتك

لم يُعدَّل أي ملف. أخبرني بالقرارات:
1. **M4:** إضافة `tailwindcss-animate` (موصى به) أم ~25 سطر CSS بلا اعتماديات؟
2. **M8/W2:** تنفيذ توحيد ألوان الحالة الآن أم توثيقه وتأجيله؟
3. **W2-10:** scrollbar — توكنز platform أم حصر بـ `.dark`؟ وقاعدة اللمس 38px — حصرها تحت scope الزبون؟
4. **K:** إبقاء `LuxuryWelcomeScreen` + `.welcome-*` كما هي (توثيق فقط) في هذه الجولة؟
5. موافقة عامة على Wave 1 (وWave 2) كما هي موضحة؟

---

# ✅ IMPLEMENTATION ADDENDUM — 2026-09-23 (بعد الموافقة: «اكمل»)

نُفّذت الخطة بخياراتي الموصى بها (M4 عبر plugin؛ W2 بالنسخة المنضبطة؛ scrollbar عبر توكنز platform؛ قاعدة اللمس حُصرت؛ LuxuryWelcomeScreen لم تُمس). **انحرافان موثقان عن الخطة، كلاهما اكتشاف أثناء التنفيذ يمنع الضرر:**

1. **أُلغي ترحيل `getOrderStatusConfig` (formatting.ts)** — الفحص أثناء التنفيذ كشف أن الدالة يستخدمها **مكونات المدير** أيضاً (`KitchenDisplaySystem`, `OrderManagement`, `TableAggregationModal`, `DashboardOverview`) خارج `.customer-theme-scope`، حيث لا تُحل `--m-*-rgb` فتصبح الشفافيات شفافة تماماً على شاشات الإدارة (خرق القاعدة 13). الملف بقي كما هو **دون أي تعديل**؛ توكنز `m.success/warning/error` أُضيفت للـ config ومتاحة للترحيل لاحقاً بعد إنشاء مسار مشترك للتوكنز. القيم اليوم متطابقة حرفياً (emerald-500 ≡ `#10B981` = `--m-success`) فلا خطر انحراف فعلي.
2. **تفعيل plugin `animate-in` يشمل ملفات المنصة أيضاً** — نفس الكلاسات الميتة كانت مستخدمة في `LoginModal/Modal/Toast/BottomSheet/ManagerLayout/...`؛ تسجيل الـ plugin يُنشّط رسم الدخول المكتوب فيها كذلك (إصلاح خلل مشترك بنفس الوسيلة، وليس تغييراً تصميمياً للمنصة).

## الملفات المتغيرة فعلياً (git diff — 103 إضافة / 30 حذفاً)

| الملف | التغيير |
|---|---|
| `src/index.css` | 5 مواضع داكنة-صلبة → صباغة `--m-text-rgb` · إزالة `outline:none` من `.menu-select` · chip → `var(--radius-full, 999px)` · حصر قاعدة اللمس 38px تحت `.customer-theme-scope` · scrollbar → توكنز `--mureeh-*` |
| `tailwind.config.js` | `serif += 'Amiri'` · `m.success/warning/error` · `plugins: [tailwindcssAnimate]` |
| `src/components/customer/CustomerLayout.tsx` | حذف كلاسات `.menu-empty` الميتة (الرسم كما هو — CSS كان يفوز أصلاً) |
| `src/components/customer/CustomerHeader.tsx` | `py-0.2` → `py-0.5` (موضعان) |
| `src/components/customer/customerLoadingExperience.css` | حذف `z-index:9999` + 7 أسطر مكررة من `.mload-root` |
| `package.json` / `package-lock.json` | + `tailwindcss-animate@^1.0.7` (devDep) |

## نتائج التحقق الفعلية

- `npm run lint` → **0 errors** (166 تحذيراً — كما كان قبل التغيير حرفياً)
- `npx tsc -b` → **PASS**
- `npm run build` → **PASS** (تحذير chunk-size القائم مسبقاً فقط)
- `npm run test` → **1342 passed / 1 failed / 79 skipped** — مطابق لخط الأساس قبل التغيير حرفياً؛ الملفان (`prismaPostgresValidation`, `production-hardening`) يفشلان بحجب شبكة الـ sandbox لتنزيل محرك Prisma (`binaries.prisma.sh`) — غير مرتبط بالثيم/CSS
- **CSS المبني (مُتحقق فيه مباشرة):** `.animate-in{animation-name:enter…}` + `@keyframes enter` مُولَّدة ✓ · `slide-in-from-bottom{--tw-enter-translate-y:100%}` ✓ · `zoom-in-95` ✓ · `.py-0\.5` ✓ · قاعدة اللمس المحصورة ✓ · chip `var(--radius-full,999px)` ✓ · scrollbar توكنز ✓ · `.menu-meta` بصباغة الحبر ✓

## المتبقي (موثق، غير منفذ عمداً)

هجرة 60 استخدام حالة في 14 ملف زبون (تتطلب مسار توكنز مشترك مع المنصة) · هجرة قسم القائمة CSS إلى `--m-*` · قرار حذف `LuxuryWelcomeScreen`/`.welcome-*` · حذف utilities platform الميتة (`glass-panel`…) · تحويل شامل logical-properties.

---

## ✅ COMMIT 3 (ac7fe5f) — إكمال «المتبقي» الآمن

**نُفّذ — حذف الـ CSS الميتة (المتحقق من انعدام مستهلكيها عبر src/ + index.html + e2e/ + public/ + server/):**
- `.glass-panel` — **تعريفان** (الأصلي + قاعدة `-webkit-backdrop-filter` مكررة عند نهاية قسم iOS) — كلاهما حُذف
- `.luxury-border`, `.luxury-border-gold`, `.gold-gradient-text`, `.bg-subtle-pattern` — حُذفت
- `.gold-glow` **بقيت** (18 مستهلكاً على المنصة) — متحقق في الحزمة المبنية: الاسمان المتبقيان له هما الكلاس + `shadow-gold-glow` من الـ config
- الحزمة المبنية بعد الحذف: صفر تكرارات للأربعة (`grep -o` على الـ dist)

**تصحيح للتقرير:** توكن `--font-sans` (Inter) **ليس ميتاً** — يستهلكه `.entry-root` عبر `var(--font-sans, system-ui, …)` (grep الأول فاته المراجع ذات الـ fallback). بقي كما هو؛ وعملياً يتدهور إلى system-ui لأن Inter غير محمّل في index.html.

**التحقق:** lint 0 errors · `tsc -b` PASS · build PASS · vitest **1342/1343** (مطابق للخط الأساسي) · diff = `src/index.css` فقط (+8/−29).

## ⏸️ البنود التي تبقى **معلّقة على قرار صريح منك** (لا تُنفذ بـ«أكمل» عام)

1. **حذف `LuxuryWelcomeScreen` (1623 سطر) + 543 سطر `.welcome-*` + اختباراته** — ميت إنتاجياً (لا يعرضه أي مكوّن) لكنه حذف إتلافي ~2,400 سطر يستحق كلمة «نعم احذفه» أو «ابقِه».
2. **توحيد ألوان الحالة -400/-blue** — يتطلب قرار تصميم: إما توكنز إضافية (`success-strong`/`info`) أو إبقاء ظلال التباين كما هي؛ ترحيل `getOrderStatusConfig` محجوب على عدم وجود توكن info ومشاركة الدالة مع المنصة.
3. **هجرة قسم القائمة CSS إلى `--m-*` (~230 مرجعاً)** — آمنة قيمياً بالبناء لكنها مشروع تغيير واسع منفصل (بعض الكلاسات المشتركة مثل `.brand-soft`/`.brand-cta` تستخدم على المنصة ويجب استثناؤها).
