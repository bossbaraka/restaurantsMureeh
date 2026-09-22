# تقرير ما بعد التنفيذ — «تخصيص متقدم» (Phase 2)

التاريخ: 2026-09-22 · الفرع: `arena/01a0ca53-restaurantsmureeh` · الأساس: `bdaca42` (main)

---

## 1) الملفات المعدّلة (3 فقط كما اعتُبد) + ملخّص diff لكل ملف

| الملف | الحجم | ملخّص Diff |
|---|---|---|
| `src/components/manager/ThemeColorField.tsx` | +94/−~40 سطرًا | إضافة `clearable`/`onClear` فقط. عند `clearable` + بلا قيمة: السواتش يصبح **متقطّعًا + أيقونة Wand2** فوق تدرّج سطح العرض، وحقل HEX يعرض placeholder «تلقائي» فارغًا (بلا hex مصطنع). زر Eraser («إزالة التخصيص») في صف العنوان يظهر فقط `clearable && hasValue`. `defaultValue` (إن وُجد) يبقى مساعد عرض/زر إعادة فقط — **لا يُكتب عند Clear إطلاقًا**. بدون `clearable`: الرندر والسلوك كما كان حرفيًا (اختبار overlayAlpha يثبّته). |
| `src/components/manager/ThemePreview.tsx` | +147/−~3 سطور | استخراج `ThemeTokensScope` (نطاق `CustomerThemeProvider` المصدَّر) + **4 عينات مصغّرة حيّة** مصدَّرة: `ButtonTokensSample`/`CardTokensSample`/`BadgeTokensSample`/`CategoryTokensSample` — كلها `var(--m-*)` حصريًا بلا أي تكرار لمنطق المحرك. إصلاح خلل قائم: `backgroundImage:'var(--m-button-bg)'` → `background` (مكانان) — البنية اللونية للمحرك سليمة كما هي. |
| `src/components/manager/BrandingSettingsView.tsx` | +474/−~70 سطرًا | مكوّن `AdvancedSection` (طي بـ state — بلا `<details>` متداخل، مطويًا/موسّعًا بالزرار `aria-expanded`) + helpers المجموعات (`groupColor`/`setGroupColor` حذف-عند-null، `cardOverride`/`setCardOverride` بترميز الغياب `''`، `shadowChoice`/`handleShadowChoice`، `basicColorFields`/`statusColorFields`) + إعادة بناء كتلة التخصيص المتقدم إلى **سبع مجموعات**: (1) الألوان الأساسية (2) الأزرار (3) البطاقات (4) الشارات (5) التصنيفات (6) ألوان الحالة (7) القياسات (كما هي حرفيًا: `editConfig.radius`/`editConfig.shadows`) — كل مجموعة تفتح على **preview صغير حي** فوقها (`ThemeTokensScope` + العينات). سطر توضيحي تحت كل مجموعة حرجة: قالب `cardStyle`/`cornerStyle` مقابل تخصيص يدوي `colors.card.radius/shadow`، و`activeBg` يُطفئ تدرّج الهوية تلقائيًا. **لم يُلمس**: `handleSaveTheme` (`toServerThemePayload(editConfig, { primaryColor, accentColor })` + `api.upsertTheme` بلا DOM writes)، ولا أي ملف آخر (editorModel/brandTheme/semanticTokens/normalizeTheme/api/server schema/themeResolver). |

العقود المفروضة باقية: «تخصيص متقدم» داخل `<details>` (بلا `open`) تحت `activeTab === 'theme'`، وكلمات slice المطلوبة موجودة داخله (`ThemeColorField`، `'success'`، `editConfig.radius`، `editConfig.shadows`)، `<ThemePreview` موجود، الحقول الجديدة كلها تحت `colors.<group>.*` و`cards.radius/shadow` (أسماء صارمة) — **بلا CSS variables جديدة**.

---

## 2) كيف مُثِّل Clear (زر «إزالة التخصيص»)

- **مجموعات الألوان** (`button`/`card`/`badge`/`category`): `setGroupColor(g, k, null)` ينفّذ **`delete colors[g][k]]` حقيقي** — لا قيمة بديلة ولا null في الحمولة: المفتاح يغيب من `toServerThemePayload` → الخادم/المحرك يرثان الموروث.
- **البطاقات (تخصيص يدوي)**: `setCardOverride('radius'|'shadow', null)` = حذف التوأم من `colors.card` + كتابة `''` في `cards[key]` — ترميز الغياب الذي يفهمه المحرك (`cards.radius || theme.radius.lg`) ولا يُرسل إلى الخادم. (تملك `toThemeConfig` تسريب re-fill للتوأم؛ هذا هو الحل المعتمد الذي يمنع التصاريح.)
- **`ThemeColorField`**: الحالة الفارغة «تلقائي» = `clearable && !value` — بلا أي fallback مصطنع عند Clear (لا `defaultValue` ولا `#000` يُكتب أبدًا في الحالة «تلقائي»؛ الـ hex المعروض في الـ picker غياب الحالة فقط).
- الألوان الأساسية/الحالة تبقى قيَمًا ملموسة دائمًا (كما كانت) — لا clear عليها («كما هي» في الخطة).

---

## 3) كيف حُفظت الوراثة

- **«تلقائي» = مفتاح مفقود** (غياب مُرمَّز، لا قيمة افتراضية): كل مستهلك يسقط إلى قيمته المشتقة في المحرك (`brandTheme`/`toThemeConfig` بلا أي تعديل عليهما).
- بعد الحذف: المفتاح غير موجود في الحمولة إطلاقًا (probe S4: `'bg' in card` = false) → الوراثة Platform→Restaurant→Branch تعمل عبر غياب الـ override نفسها (`mergeThemeConfigs` و`resolveEffectiveTheme` كما هما).
- التحميل يعرض القيمة الفعلية المطبقة (`effective.rawConfig`)؛ زر الإزالة يحذف التخصيص فيعود الحكم للموروث عند الحفظ التالي — بلا ترميز مصطنع في أي اتجاه.

---

## 4) نتائج validation/tests

| الأداة | النتيجة | مقارنة بالأساس |
|---|---|---|
| `npx tsc -b` | ✅ 0 أخطاء | نظيف |
| `npx oxlint` | ✅ 0 أخطاء (166 تحذيرًا) | مطابق للأساس حرفيًا |
| `npx vitest run` | ✅ **1249 ناجحًا** / 79 متخطّى — فشلان معروفان فقط | **بلا فشول جديد**: (1) `prismaPostgresValidation` — `prisma generate` محجوب في البيئة (2) `production-hardening > redacts sessionToken…` — قائم خارج النطاق. كل عقود المحرر الخضراء ما زالت: `themeEditorSimplified` **14/14**، `overlayAlpha`، `design-system` (TYPO-001/A11Y-002)، `appearanceIsolation` (صفر DOM-writes/ClassList)، `transfer-details-ui`، `logoFraming`، `managerLayout`، `theme-effective-mapping`، `theme-mode-resolution`، `customerThemeProvider`… |
| `npm run build` | ✅ ناجح (vite ~3.8s) | نجح |

---

## 5) السيناريوهات العشرة (تأكيد عبر probes + اختبارات محفوظة)

| # | السيناريو | الدليل |
|---|---|---|
| 1 | بدون overrides | probe: الحمولة = الأعمدة الدائمة فقط — `groups-sent? false` وكل حقول المجموعات «تلقائي» |
| 2 | override واحد | probe: `{"primaryBg":"#111111"}` وحده — لا مجموعات أخرى تُرسل |
| 3 | كل الـ overrides | probe: المجموعات الأربع كاملة + `card:{bg,border,radius,shadow}` تصل كلها (مع تطبيع hex جمالي للأحرف الكبيرة) |
| 4 | إزالة override → وراثة | probe: set-then-clear → `'bg' in card` = **false** (غياب المفتاح = وراثة) |
| 5 | light | probe: `mode=light` + الـ override باقٍ؛ + `theme-mode-resolution.test.ts` |
| 6 | dark | probe: `mode=dark` كذلك؛ + الاختبار نفسه |
| 7 | preset فقط | probe: لا مفاتيح مجموعات في الحمولة إطلاقًا (القالب يظل مصدر الاشتقاق)؛ + `themeEditorSimplified` (presets تبقى root-only في draft/config) |
| 8 | preset + تدخل يدوي | probe: التدخل اليدوي يبقى صريحًا بجانب القالب (`card.radius` manual wins عبر خانة `cards` الحصرية)؛ لا تصاريح `cardStyle`↔`colors.card.*` (السطر التوضيحي في UI) |
| 9 | save→reload | المسار: `toServerThemePayload` → `PUT /manager/theme` (strict zod) → `effective.rawConfig` → المحرر. حفظ/استرجاع المجموعات والبطاقات والأعمدة مغطى باختبارات persistence/backward-compat الخضراء؛ probe S9: الحمولة تُعاد قراءتها كما هي بلا تحويل |
| 10 | Platform→Restaurant→Branch | `theme-backward-compat.test.ts` سيناريوهات 1–3 + `brand-theme-inheritance.test.ts` (الأخير يتضمن تفوق branch manual على مستوى أعلى) — خضراء كلها؛ probe merge: `source=branch` مع primary من branch وsecondary من platform |

---

## 6) ملاحظات / Limitations متبقية (شفافية)

1. **حلّ اسم الظل عند الحفظ**: خانة `cards.shadow` (مفتاح مقياس مثل `md` أو CSS خام) تُحوَّل في `toServerThemePayload` إلى **قيمة CSS فعلية** في `colors.card.shadow` (سلوك قائم في الأساس — «the server slot is a CSS shadow, أبدًا مجرد مفتاح»). نتيجة لذلك: بعد reload تظهر الشريحة «مخصص» والنص الـ CSS بدل شريحة `md` — القيمة النهائية نفسها صحيحة وتُشتق منها الحركة، لكن هوية المقياس لا تبقى كنص. (إصلاح ذلك يتطلب تعديل عقد الخادم — خارج نطاق.)
2. **القيمة المعروضة بعد التحميل** = القيمة المطبقة فعليًا (`effective.rawConfig`) لا «الأصل الموروث» — زر «إزالة التخصيص» يحذف التخصيص ويعيد الوصاية للموروث عند الحفظ؛ لا fallback مصطنع في أي حال.
3. **تباين auto-preview** الموثوق من المرحلة 1: سواتش «تلقائي» يعرض مشتق السطح، بينما قد ينتج المحرك تدرّج `brand-fill` للتصنيف النشط (`--m-chip-active-image`) — التنبيه النصي موجود في UI («عند التلقائي قد يستبدل المحرك…»).
4. **`stylePresets`/`presets`/`cards` ليست ضمن عقد `PUT /manager/theme` الحالي** («GET/PUT/DELETE only — no copy/presets/lockedFields») — سلوك قائم كما هو في الأساس ولم تتغيره المرحلة 2؛ اختيار القوالب يظل في draft المحرر ويؤثر على الاشتقاق محليًا.
5. **`colors.category.activeImage` مقصود عدم إضافته** (قرار S3): غير موجود في الـ schema الصارم؛ إطفاء تدرّج التصنيف النشط يمر عبر `activeBg` فقط.
6. فشلا البيئة المعروفان (prisma generate محجوب / production-hardening sessionToken) يبقيان كما هما — خارجا النطاق ولم يزيدا.

---

## مسار البيانات (كما طُلب — بلا تغيير)

`Editor → Theme Draft → Theme Config → Server Adapter (toServerThemePayload) → Persisted Theme → Effective Theme → CSS Variables → Customer Menu` — كل محرّكات المسار (toDraft/toThemeConfig/brandTheme/semanticTokens/normalizeTheme/themeResolver/zod) **لم تُلمس**؛ كل ما أُضيف هو طبقة المحرر + واجهات العرض فوقها.
