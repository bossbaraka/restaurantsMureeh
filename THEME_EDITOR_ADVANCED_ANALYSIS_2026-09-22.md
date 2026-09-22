# تقرير المرحلة 1 — تحليل Theme Editor: «تخصيص متقدم»

التاريخ: 2026-09-22 · الحالة: **Investigation فقط — لم يُعدَّل أي ملف، ولم يُكتب أي كود**
الهدف: إظهار كل خيارات التخصيص التي يدعمها نظام الـ Theme الحالي (الأزرار، البطاقات، الشارات، التصنيفات) داخل قسم «تخصيص متقدم» في `BrandingSettingsView.tsx`، دون أي تغيير في الـ Theme Engine أو الـ architecture.

---

## 0. الخلاصة التنفيذية

- **الـ Theme Engine يدعم كل ما طلبته بالفعل** — data model كامل (`colors.button/card/badge/category`)، server schema صارم، adapters ذهابًا وإيابًا، وCSS variables كاملة (`--button-bg` … `--category-active-text`) تتصل فعليًا بـ Customer Menu عبر `--m-*` semantic tokens و`index.css`. **النقص كله في واجهة المحرر فقط.**
- الاستثناء الوحيد: `colors.category.activeImage` **لا وجود له في الـ data model** — الموجود هو متحول CSS مشتق `--category-active-image` (مفتاح إظهار/إخفاء لتدرّج الهوية على التصنيف النشط، وليس صورة ولا لونًا). تفاصيله في القسم 4.
- تدفق البيانات سليم ومختبَر (`theme-effective-mapping.test.ts` يضمن عدم فقد أي مجموعة ألوان ذهابًا وإيابًا). الربط من الـ UI يجب أن يكون على نفس الـ keys الحالية دون أي key جديد.
- **اكتشافان حسّاسان** (تم إثباتهما بتشغيل فعلي على سلسلة الدوال الحقيقية — probes) يجب أن تُفهم قبل أي قرار UI:
  1. **طبقة «الاشتقاق التلقائي» محجوبة على المسار الحي**: خادم الـ resolver يملأ المجموعات دائمًا من `DEFAULT_PLATFORM_CONFIG`/`FALLBACK_THEME` (ذهبي داكن)، فتتفوق على الاشتقاق من `primary/accent` في `semanticTokens.pick()`. القاعدة «غياب المفتاح ← مشتق من البراند» موجودة ومختبرة في العميل، لكنها تُستدعى فقط لمسارات «لا يوجد ثيم».
  2. **`toDraft` يثبّت الـ overrides** بعد Hydration (الظلال/الزوايا/`cards`)، ما يجعل مُنتقيي «شكل البطاقات/الزوايا» البسيطين بلا تأثير فعلي على البطاقة نفسها بعد أول تحميل. علاقتهما بـ `colors.card.radius/shadow` موضحة في القسم 5.
- خطة Minimal-Diff: ملفان أساسيان (`BrandingSettingsView.tsx` + إضافة تصديرات preview صغيرة في `ThemePreview.tsx`)، وربما خاصية `clearable` صغيرة جدًا في `ThemeColorField.tsx`. **صفر تعديل** على `brandTheme.ts` / `semanticTokens.ts` / `normalizeTheme.ts` / `editorModel.ts` / `api.ts` / `CustomerThemeProvider.tsx` / `server/*` / مكونات Customer / `index.css`.

---

## 1. الملفات ذات العلاقة

### 1.1 ملفات ستحتاج تعديلًا (Phase 2 — بعد الموافقة)

| الملف | ما سيتغير | لماذا |
|---|---|---|
| `src/components/manager/BrandingSettingsView.tsx` (1544 سطر) | الأقسام الجديدة داخل `<details> تخصيص متقدم` (الأسطر 1134–1245 حاليًا) + setters مساعدة صغيرة تحرّك `editConfig.colors.button/card/badge/category` و`editConfig.cards` | الملف الوحيد الذي يملك الـ UI؛ الحقول ستكتب بنفس نمط الحقول الحالية (`setEditConfig`) على الـ keys الموجودة |
| `src/components/manager/ThemePreview.tsx` (227 سطر) | إضافة **تصديرات** معاينات مصغّرة (زر أساسي/ثانوي، بطاقة، شارة، تصنيف عادي/نشط) بنفس لفّافة `CustomerThemeProvider` ونفس `var(--m-*)` | لتجنّب «محرك ثانٍ» للمعاينات؛ المعاينة الحالية تمر بنفس خط الإنتاج (`toThemeConfig → normalizeTheme → buildSemanticTokens → CustomerThemeProvider`) ولا يمكن أن تنحرف عن المنيو الحقيقي |
| `src/components/manager/ThemeColorField.tsx` (366 سطر) — **اختياري وصغير جدًا** | خاصية اختيارية مثل `clearable?: boolean` + زر «إزالة التخصيص» (قيمة فارغة = تلقائي) لأن الكونترول الحالي يمثل لونًا ماديًا فقط (`value/onChange` إجباري، وfallback داخلي `#000000`) | حتى لا نضع قيمة صناعية للحقول غير المحددة (شرطك صراحةً). البديل بدون لمس الملف: wrapper في BrandingSettingsView بحالة «تلقائي/مخصص» — سأعرض الخيارين عند التنفيذ |

### 1.2 ملفات مقروءة فقط (مرجع المعمارية — ممنوعة عن التعديل)

| الملف | الدور |
|---|---|
| `src/types/restaurant.ts` (89–255) | `ThemeColors` + `ThemeButtonColors` (125) + `ThemeCardColors` (132) + `ThemeBadgeColors` (139) + `ThemeCategoryColors` (144) + `ThemeRadius` (169) + `ThemeShadows` (177) + `ThemeCardStyle` (196) + `ThemeConfig` (201) + `EffectiveTheme` (229) |
| `src/theme/editorModel.ts` | `ThemeDraft` (+ `overrides: Partial<ThemeConfig>`)، `toDraft` (171)، `toThemeConfig` (224)، presets و scales |
| `src/theme/brandTheme.ts` | `THEME_VAR_NAMES` (122)، `resolveThemeShadow` (767)، `themeShadowKey` (783)، `buildEffectiveThemeVars` (853)، `resolveModeAwareColors` (544) |
| `src/theme/normalizeTheme.ts` | `normalizeTheme` (202) — يحفظ المجموعات كما هي (`...effective.colors`) |
| `src/theme/semanticTokens.ts` | `buildSemanticTokens` (207) — `pick(override, derived)` للمجموعات (270–308) + alias قديمة |
| `src/theme/CustomerThemeProvider.tsx` | الكاتب الوحيد لـ tokens على عنصر scope (style prop، بلا DOM writes) |
| `src/services/api.ts` | `mapColorGroups`/`pickGroupFields` (601–618)، `uiThemeConfigFromServer` (652)، `mapEffectiveTheme` (709)، دوال `getTheme/upsertTheme/deleteTheme` |
| `server/validation/schemas.ts` | `themeColorsSchema` (1466) — strict، `themeConfigSchema` (1545) |
| `server/services/themeResolver.ts` | `FALLBACK_THEME` (136)، `DEFAULT_PLATFORM_CONFIG` (209)، `mergeThemeConfigs` (276)، `resolveEffectiveTheme` (359) |
| `src/index.css` | مستهلكو الـ vars: `.menu-chip` (886–908)، `.menu-card` (1060–1080)، `.menu-badge--dark` (1235–1241) — `var(--card-bg, …)` مع fallback |
| `src/components/customer/CustomerLayout.tsx` (493) | `var(--button-bg, var(--m-brand))` على زر CTA |
| `src/components/manager/ThemeColorField.tsx` | الكونترول الموحّد للألوان (picker + HEX + RTL + a11y + reset) |

### 1.3 عقود اختبارية يجب ألا تُكسر (قيود على التنفيذ)

- `src/tests/themeEditorSimplified.test.ts` — عقود مصدرية صارمة:
  - القسم الأساسي (قبل `<details>`) يجب أن يبقى خالًٍا من `editConfig.radius/shadows` و`'surface'/'border'/…` وجُمل CSS/token/RGB…
  - كتلة `<details>` يجب أن تبقى **مطوية افتراضيًا** (بلا `open`) وأن **تبقى** تحتوي على `editConfig.radius` و`editConfig.shadows` و`'success'` و`ThemeColorField`.
  - الاستدلال على «كتلة الـ details» في الاختبار يقطع عند **أول** `</details>` → **يُمنع استخدام `<details>` متداخل** للأقسام الجديدة؛ الطي سيكون بحالة React (أزرار aria-expanded) أو أقسام مسطحة.
  - في `BrandingSettingsView`: منع `setProperty(` / `applyBrandTheme` / `applyEffectiveTheme` / `documentElement.style` / `setInterval` / `previewVars`. وفي `ThemePreview`: منع أي ألوان مكتوبة hex/luxury/gold — يجب أن يبقى `var(--m-*` فقط.
- `src/tests/brandWritePath.test.ts` — يجب بقاء النص الحرفي `toServerThemePayload(editConfig, { primaryColor, accentColor })` وتعليق `DELIBERATELY NOT sent`، و**عدد `allowAlpha` في الملف = 1 بالضبط** (حقول المجموعات الجديدة HEX6 بلا alpha).
- `src/tests/themeEditorModel.test.ts` — `toDraft/toThemeConfig` يحفظان المجموعات (`button/category` في الاختبار)؛ لا نلمس `editorModel.ts`.

---

## 2. كيف يتم تخزين Theme configuration حاليًا

**التخزين**: جدول Prisma `Theme` (`server/db`) كـ JSON `config` يطابق حرفًا `themeConfigSchema` (strict — أي key مجهول = رفض 400):

```ts
ThemeConfig {            // server/validation/schemas.ts:1545
  mode?: 'light'|'dark'|'auto';
  colors?: {             // الأعمدة الإحدى عشر إلزامية HEX6 عند الحضور
    primary…error,       // ثمانية scalars + ثلاثة حالة
    button?:  { primaryBg?, primaryText?, secondaryBg?, secondaryText? },   // HEX اختياري
    card?:    { bg?, border?, shadow? (CSS حر ≤300), radius? (نص حر ≤20) },
    badge?:   { bg?, text? },
    category?:{ bg?, text?, activeBg?, activeText? },                       // بلا activeImage
  };
  radius?: { sm?, md?, lg?, xl?, full? };
  shadows?: { sm?, md?, lg? };
  typography?: { fontFamily?, headingWeight?, bodyWeight? };  // أوزان رقمية على السيرفر
  background?: { light?, dark? };                            // overlay/readability بصيغة السيرفر
}
```

**نطاقات الحفظ**: صف Theme واحد لكل نطاق — `restaurantId` (المطعم) أو `restaurantId+branchId` (فرع)، وصف منصة واحد (`restaurantId: null, branchId: null`). `PUT /manager/theme` يستبدل الـ config كاملاً (upsert على النطاق)؛ `DELETE /manager/theme` يحذف صف النطاق فيرث من المستوى الأعلى.

**الوراثة** (`resolveEffectiveTheme` + `mergeThemeConfigs`, themeResolver.ts:276,359):

```
DEFAULT_PLATFORM_CONFIG  ←  Platform Theme row  ←  legacy primaryColor/accentColor  ←  Restaurant Theme  ←  Branch Theme
```

دمج عميق (deep merge) على المفاتيح الموجودة فقط. بعد الدمج تُملأ الفجوات من `FALLBACK_THEME` — **بما فيها مجموعات button/card/badge/category كاملة بقيم ذهبية داكنة** (انظر القسم 5، الخطر #1).

**ملاحظة التخزين المزدوج للبطاقة**: المكان المُخزَّن الوحيد للتخصيصات هو `colors.card.radius` / `colors.card.shadow`. الـ UI model يستخدم حقل `cards: ThemeCardStyle` (restaurant.ts:196) الذي يمثّل **نفس الخصمتين**؛ الـ adapters يحولان بينهما:
- حفظ: `toServerThemePayload` (BrandingSettingsView:344) → `ui.cards.radius/shadow` تكتب `colors.card.radius/shadow` (وتتفوق على النسخة الخام في `colors.card`) — و`cards.shadow` تُحوَّل من مفتاح المقاييس (`sm|md|lg`) إلى CSS حقيقي عبر `resolveThemeShadow`.
- قراءة: `uiThemeConfigFromServer`/`mapEffectiveTheme` (api.ts:652,709) → `colors.card.radius/shadow` تُعبَّأ في `config.cards`، و`shadow` تُرتدّ إلى مفتاح المقاييس عبر `themeShadowKey` إن طابقت أحد القيم («select round-trip» — الاختبار موجود حرفيًا في theme-effective-mapping).

**نموذج الـ Editor**: `editConfig: ThemeConfig` هو مصدر الحقيقة الوحيد للحقول المتقدمة؛ `themeDraft` (view مشتقة عبر `toDraft`) للقرارات السبع البسيطة، وكتابة أي بسيط تمر عبر `toThemeConfig` الذي يعيد **كل** `draft.overrides` (بما فيها المجموعات) فوق القيم المشتقة — «OVERRIDES ARE NEVER DISCARDED».

---

## 3. تدفق colors.button / card / badge / category من الـ Editor إلى الـ Theme Engine

```
┌─ المحرر (الحقل الجديد) ─ setEditConfig: editConfig.colors.button.primaryBg = '#…'
│
├─ مسار الحفظ (موجود حرفًا اليوم — لا يتغير):
│   editConfig (UI shape)
│   → toServerThemePayload (BrandingSettingsView:344)          ← المحول الوحيد UI→Server
│       → colorGroupsToServer/copyGroupFields (265)            ← whitelist + تطبيع HEX6 + حذف غير الصالح
│   → PUT /manager/theme → managerThemeUpsertSchema → themeConfigSchema (strict)
│   → prisma.theme.config (JSON)
│
├─ مسار القراءة/التشغيل (المحرك):
│   resolveEffectiveTheme (themeResolver:359)                  ← deep merge + FALLBACK fill
│   → ResolvedTheme { colors: { button, card, badge, category }, rawConfig }
│   → mapEffectiveTheme → mapColorGroups/pickGroupFields (api.ts:601)  ← يحفظ المجموعات كما هي
│   → EffectiveTheme → CustomerThemeProvider → normalizeTheme (يحافظ على ...colors)
│   → buildEffectiveThemeVars (brandTheme:853):
│       '--button-bg': colors.button?.primaryBg || ''          ← '' = إزالة المتغيّر ← CSS fallback
│       '--card-radius': cards?.radius || radius.lg            ← override أو مشتق
│       '--card-shadow': resolveThemeShadow(cards?.shadow, shadows) || shadows.md
│       '--category-active-image': activeBg ? 'none' : ''      ← مشتق!
│   → buildSemanticTokens (semanticTokens:207):
│       --m-button-bg = pick(--button-bg, brand.fill)          ← override أو مشتق من الهوية
│       --m-card-bg … --m-chip-* … --m-badge-*  (نفس المنطق)
│   → style على .customer-theme-scope (+ aliases قديمة --button-bg/--card-bg/…)
│
└─ مسار المعاينة (المختصر — نفس الذيل):
    editConfig → asDraft/toDraft → toThemeConfig → normalizeTheme → …نفس الدوال حتى DOM.
    المعاينة الحالية (ThemePreview) تستهلك var(--m-*) فقط — نفس متغيّرات الإنتاج بالضبط.
```

الاستهلاك الفعلي في Customer Menu:
- `--button-bg/--button-text` → زر «تصفح كامل القائمة» في `CustomerLayout.tsx:493` (مع `var(--m-brand)` fallback)، وأزرار المعاينة عبر `--m-button-*`.
- `--card-bg/--card-border/--card-radius/--card-shadow` → `.menu-card` في `index.css:1071` (كل بطاقات الأطباق) + `--m-card-*` في المعاينة.
- `--badge-bg/--badge-text` → `.menu-badge--dark` (شارة الحساسية) + `--m-badge-*`.
- `--category-bg/--category-text/--category-active-bg/--category-active-text/--category-active-image` → `.menu-chip` / `.menu-chip[data-active='true']` (شريط التصنيفات) + `--m-chip-*`.

**الخلاصة**: كل ما يلزم هو كتابة الـ keys الحالية من الـ UI — لا adapter جديد، ولا CSS variable جديد، ولا تغيير في المسار.

---

## 4. ما يدعمه Theme Engine الآن مقابل ما ينقص في UI فقط

### 4.1 مدعوم بالكامل (Engine + Storage + CSS) — ينقصه UI فقط

| المفتاح (data model) | CSS var | الاستهلاك | حالة UI |
|---|---|---|---|
| `colors.button.primaryBg/primaryText` | `--button-bg/--button-text` (→ `--m-button-*`) | زر CTA + المعاينة | **غائب** |
| `colors.button.secondaryBg/secondaryText` | `--button-secondary-bg/-text` | المعاينة + أي استهلاك مستقبلي | **غائب** |
| `colors.card.bg/border` | `--card-bg/--card-border` | `.menu-card` | **غائب** |
| `colors.card.radius` | `--card-radius` (fallback: `radius.lg`) | `.menu-card` | **غائب** |
| `colors.card.shadow` | `--card-shadow` (fallback: `shadows.md`) | `.menu-card` | **غائب** |
| `colors.badge.bg/text` | `--badge-bg/--badge-text` | `.menu-badge--dark` | **غائب** |
| `colors.category.bg/text` | `--category-bg/--category-text` | `.menu-chip` | **غائب** |
| `colors.category.activeBg/activeText` | `--category-active-bg/-text` | chip نشط | **غائب** |

الحقول الأساسية (secondary/background/surface/border/textPrimary/textSecondary) وألوان الحالة (success/warning/error) والمقاييس (radius/ظلال) **موجودة بالفعل** في «تخصيص متقدم» — لا سلوك يتغير فيها.

### 4.2 مشتق بالكامل (لا يوجد له data key — لا حقل له)

| الظاهرة | الآلية | ملاحظة |
|---|---|---|
| `--button-radius` | `radius.md` دائمًا (brandTheme:911) | لا يوجد `colors.button.radius` — لا تعرض حقلًا |
| `--badge-radius` | `radius.full` دائمًا (brandTheme:912) | لا يوجد `colors.badge.radius` — لا تعرض حقلًا |
| **`colors.category.activeImage`** | **غير موجود في أي طبقة تخزين**. الموجود: `--category-active-image` (brandTheme:899) = `'none'` عند وجود `activeBg` (حتى يعلو اللون صورة التدرّج) و`''` عند غيابه (يرجع CSS لـ `var(--brand-fill)` — تدرّج الهوية، index.css:907) ونفسه في `--m-chip-active-image` (semanticTokens:288) | **ليس URL وليس إعداد صورة** — هو مفتاح إظهار مشتق. القرار المطلوب في القسم 6 س3 |

> تحليل `activeImage` (كما طلبت): النوع الفعلي = boolean مشتق من وجود `activeBg`. «صورة التصنيف النشط» التي يراها المستخدم هي **تدرّج الهوية** (`brand.fill`)، وتختفي تلقائيًا عند تحديد `activeBg`. إنشاء key باسم `activeImage` سيُرفض من `themeConfigSchema.strict` عند الحفظ، وينتهك «لا keys جديدة». العرض الصحيح: preview لتصنيف نشط يبيّن التدرّج/اللون + سطر توضيحي، **بلا حقل**. إن أردت صورة مخصّصة فعلية للتصنيف النشط فهذه feature جديدة (schema + engine + Customer Menu) وتحتاج موافقتك الصريحة — خارج «إظهار ما يدعمه النظام الحالي».

### 4.3 مدعوم في UI حاليًا (يبقى كما هو)

«الألوان الأساسية» الستة + «ألوان الحالة» الثلاثة + «قياسات الزوايا/الظلال» — نفس السلوك حرفيًا.

---

## 5. المخاطر واحتمالات كسر existing themes

> ⚠️ الاكتشافان أدناه أُثبتا بتشغيل probes على الدوال الحقيقية (`uiThemeConfigFromServer` → `toDraft` → `toThemeConfig` → `mapEffectiveTheme` → `normalizeTheme` → `buildCustomerThemeStyle`) خلال هذه الجلسة.

**1) [خطير — سلوك قائم] امتلاء المجموعات من السيرفر يحجب الاشتقاق التلقائي على المسار الحي.**
`DEFAULT_PLATFORM_CONFIG` (themeResolver:209) و`FALLBACK_THEME` (136) يملآن `button/card/badge/category` بقيم ذهبية/داكنة كاملة، و`resolveEffectiveTheme` يدمجها دائمًا (سطور 437–454). أي EffectiveTheme قادم من الـ API يحمل المجموعات **دائمًا** ← `pick()` في semanticTokens يأخذ القيمة المملوءة بدل `brand.fill`. Probe: مطعم أزرق (`#1C64F2`) بلا تخصيصات يحصل على `--m-button-bg: #D4AF37` و`--m-card-bg: #15171A` (بطاقة داكنة!) حتى في light mode، بينما نفس البراند بدون مجموعات (مسار legacy synthesis) يحصل على تدرّج أزرق وبطاقة فاتحة.
**الأثر على المطلوب**: حالة «تلقائي = مشتق من primary/accent/preset» **غير قابلة للتمثيل بصدق** على المسار الحي دون تعديل المحرك (إيقاف الـ fill في resolver/DEFAULT_PLATFORM_CONFIG) — وذاك **سيغيّر مظهر كل ثيم بلا مجموعات مخصّصة** (من ذهبي المنصة إلى مشتق من الهوية) = كسر existing themes المحتمل الذي حذّرت منه. لذلك خطة الـ UI (القسم 6) تعرض القيم **المطبقة فعليًا** ولا تخلق حالة «مشتق» وهمية. إن رغبت لاحقًا بتوحيد الاشتقاق فهذه قرار منفصل يحتاج موافقتك ومرحلة خاصة.

**2) [سلوك قائم] flatten-on-save**: `PUT /manager/theme` يستبدل الكونفق كاملًا، والمحرر يُهندس من `effective.rawConfig` (**الدمج الكامل** وليس صف النطاق) → أول حفظ ينسخ القيم الموروثة (scalars + المجموعات) داخل صف النطاق. هذا قائم اليوم (المجموعات تُحفظ verbatim عبر `colorGroupsToServer` — والاختبار يصرّح «a save never drops them»). حقولنا الجديدة **لن تزيد من ذلك** إن ربطناها بالقيم الموجودة كما هي؛ ومع ذلك يجب أن نُظهر بوضوح الفرق بين «مخصص» (القيمة في `stored.config` — رد الـ state الموجود `storedTheme`) و«موروث». طريقة الحفاظ الوحيدة على الوراثة لحقل = عدم إرساله (حذف المفتاح) — وهذا ما ستفعله «إزالة التخصيص» إن اعتمدناها.

**3) [موجود] الـ slot المزدوج `colors.card.radius/shadow` ↔ `cards.radius/shadow`**: بعد الـ hydration توجد القيمة في المكانين. setters الجديدة يجب أن تكتب `editConfig.cards` (المكان القياسي للاقتصاص — `toServerThemePayload` يعطيه الأولوية) وأن **تمسح التوأم** من `editConfig.colors.card` عند «الإزالة»، وإلا سيعيد `copyGroupFields` إرسال النسخة الخام (تسلسل الأسبقية في toServerThemePayload:383–396 معروف لكن لا نترك فوضى).

**4) [موجود] تثبيت overrides في `toDraft` يُعطِّل pickers الأسلوب**: بعد الـ hydration (الذي يملأ دائمًا `radius`/`shadows`/`cards`) يصبح `overrides.radius/shadows/cards` مثبّتة، وتغيير «شكل البطاقات/الزوايا» لا يغيّر سلّم الظلال/الزوايا ولا `cards.radius/shadow` (probe: تغيير cornerStyle إلى pill أبقى `radius.lg = 16px`). هذا قائم قبل عملنا (سببه: مقاييس `DEFAULT_PLATFORM_CONFIG` لا تطابق `CORNER_SCALES`/`CARD_SHADOWS` حرفياً). **لن نلمسه** (تعديل `editorModel` = تغيير سلوك)، لكن قسم «البطاقات» يجب أن يشرح العلاقة بصراحة:
   - **Card Style / Corner Style** = قالب/سلّم بصري (presets).
   - **Radius/Shadow في قسم البطاقات** = override يدوي مباشر لبطاقة الطبق يتفوق على القالب (`--card-radius = cards.radius || radius.lg`).
   - **بدون override** يستمر الاشتقاق من `radius.lg` / `shadows.md` (أو ما يملؤه السيرفر — الخطر #1).

**5) عقود اختبارية مصدرية** (`themeEditorSimplified`, `brandWritePath` — تفصيلها في 1.3): أهم قيد عملي = **لا `<details>` متداخل** + بقاء العبارات المطلوبة داخل كتلة الـ details الأولى + `allowAlpha` مرة واحدة. أي خرق = فشل الاختبارات القائمة.

**6) strict schema**: ألوان المجموعات HEX6 فقط (باستثناء `card.radius` نص حر ≤20 و`card.shadow` نص حر ≤300). `ThemeColorField` ينتج HEX6 افتراضيًا → متوافق. `copyGroupFields` يحذف غير القابل للتحليل بدل رفض الحفظ (مختبَر).

**7) light/dark و preset/بلا preset والوراثة**: لا تفاعل خاص بالحقول الجديدة — كل شيء يمر بنفس `resolveModeAwareColors`/`mergeThemeConfigs` الحالية. القيم الموروثة من المنصة داكنة المظهر تظهر في light mode كما هي (الخطر #1) — وظهورها في الـ UI (للمرة الأولى) سيساعد المدير على رؤيتها وتجاوزها يدويًا، دون تغيير المحرك.

**8) حفظ ثم reload**: مسارا الـ round-trip مغطيان باختبارات (`theme-effective-mapping`: «keeps the colour groups in the edit model so a save never drops them» + save round-trip). القيمة الوحيدة الحساسة: `cards.shadow` تُخزَّن CSS وتُقرأ كمفتاح مقياس عند المطابقة (`themeShadowKey`) — والاختبار يثبت دورة كاملة (`lg` → CSS → `lg`).

**Baseline التحقق الحالي (قبل أي تعديل)**: `tsc -b` ناجح · `oxlint`: 0 errors (166 warnings قديمة) · `vitest run`: 1249 ناجح، **فشلان قائمان قبلنا ولا علاقة لهما بالثيم**: (أ) `prismaPostgresValidation.test.ts` — لأن `prisma generate` يحجبه الشبكة في هذه البيئة (تنزيل محركات Prisma محجوب)، (ب) `production-hardening.test.ts` → اختبار redaction سجلات واحد.

---

## 6. خطة التنفيذ Minimal-Diff (المرحلة 2 — بعد موافقتك)

### البنية المقترحة للـ UI (داخل `<details> تخصيص متقدم` الحالي — طيّ داخلي بحالة React، بلا `<details>` متداخل)

```
تخصيص متقدم                     ← <details> الحالي كما هو (مطوي افتراضيًا)
├── الألوان الأساسية             ← الحقول الستة الحالية كما هي (إعادة تسمية المجموعة فقط)
├── الأزرار                       ← [خلفية الأساسي][نص الأساسي][خلفية الثانوي][نص الثانوي]
│                                   + preview زرَّين بنفس var(--m-button-*)
├── البطاقات                      ← [خلفية][حدود] + [Radius: تلقائي|مخصص px] + [Shadow: تلقائي|sm|md|lg|مخصص]
│                                   + preview بطاقة (bg/border/radius/shadow حقيقية)
│                                   + سطر توضيح العلاقة cardStyle/cornerStyle ↔ override (المقطع 5.4)
├── الشارات                       ← [خلفية][نص] + preview شارة («جديد») بنفس --m-badge-*
├── التصنيفات                     ← [خلفية][نص][خلفية النشط][نص النشط]
│                                   + preview [تصنيف عادي][تصنيف نشط] بنفس --m-chip-*
│                                   + سطر: «الخلفية النشطة تحلّ محل تدرّج الهوية تلقائيًا عند تحديدها»
│                                     (بلا حقل activeImage — راجع 4.2 وس3)
├── ألوان الحالة                  ← كما هي
└── القياسات                      ← كما هي (زوايا sm–xl + ظلال sm–lg)
```

### قواعد الربط (صفر مفاتيح جديدة، صفر منطق مكرر)

1. ألوان المجموعات تكتب مباشرة في `editConfig.colors.button/card/badge/category` على نفس نمط `setColor` الحالي — ثم يمر كل شيء عبر المسارات الموجودة (draft → preview، و`toServerThemePayload` → حفظ). **لا نمس** `editorModel`/`api`/السيرفر.
2. `card.radius/shadow` في الـ UI تكتب في `editConfig.cards` (المكان القياسي) مع مسح التوأم من `editConfig.colors.card` عند الإزالة (الخطر #3). اختيار Shadow يعتمد `themeShadowKey/resolveThemeShadow` الموجودان (select كما خطط له مصمم الـ adapter — api.ts:686 تعليق "manager select round-trips").
3. **لا fallback مخترع**: الحقول غير المحددة تعرض «تلقائي» (نص، لا لون) والقيمة المعروضة دائمًا هي القيمة **المطبقة فعلاً من `editConfig`** (الموروثة من الدمج — نفس ما يعرضه المنيو). لا `#FFFFFF/#000000` ولا أي hex جامد في الـ UI.
4. **«إزالة التخصيص»** (زر لكل حقل أو لكل مجموعة): تحذف المفتاح من `editConfig` → لا يُرسل في الحفظ (`copyGroupFields` يتخطى الحقول الفارغة) → يرث النطاق من المستوى الأعلى في المرة القادمة (الوراثة محفوظة). وصف الحقل يشرح ذلك بالعربية.
5. **Preview = نفس خط الإنتاج**: العينات المصغّرة تُصدَّر من `ThemePreview.tsx` وتستهلك `var(--m-*)` فقط داخل نفس `CustomerThemeProvider` (نفس توقيع العقود في themeEditorSimplified). كرت البطاقة يعكس background/border/radius/shadow فعليًا؛ زوج التصنيفات يعكس activeBg/التدرّج.
6. UX: أقسام بعناوين + وصف سطر واحد + كثافة الحقول الحالية (luxury/gold RTL)، طيّ داخلي بحالات `useState` (سبرنغ)، بلا ألوان خارج نظام Manager.

### سلسلة التحقق بعد التنفيذ (المطلوبة منك)

`npx tsc -b` · `npx oxlint` · `npx vitest run` (نفس الـ baseline: لا فشول جديد) · وإضافة اختبارات وحدة صغيرة (جديدة) لدورة الحفظ/القراءة لكل مجموعة + سيناريوهاتك: بلا overrides / بواحدة من كل مجموعة / الكل / light / dark / preset / بلا preset / وراثة مطعم / وراثة فرع / حفظ ثم reload. (اختبارات الدورة موجودة جزئيًا في `theme-effective-mapping.test.ts` وسنوّعها دون لمس القديمة.)

### أسئلة تحتاج قرارك مع الموافقة (س1–س3)

- **س1 — «إزالة التخصيص» (زر clear لكل حقل)**: (أ) أوصي بها — تحذف المفتاح وتحافظ على الوراثة، مع تنبيه مكتوب أن القيمة بعد الإزالة تُحسم من «الإعداد الأعلى/الافتراضي» (وهذا واقع النظام — الخطر #1). (ب) بدون clear: الحقول تعرض القيم المطبقة فقط (أبسط، أقل التباسًا).
- **س2 — توسعة `ThemeColorField` بخاصية `clearable` صغيرة** مقابل بناء الـ toggle خارجه في BrandingSettingsView (بدون لمس الملف). أوصي بالأول إن اعتمدنا س1-أ.
- **س3 — `activeImage`**: (أ) أوصي: بلا حقل — preview + سطر توضيحي فقط (مطابق لواقع المحرك). (ب) تريد صورة مخصّصة للتصنيف النشط → feature جديدة (schema/engine/customer) بموافقة صريحة ومرحلة منفصلة.

### الملفات النهائية المتوقعة في المرحلة 2

1. `src/components/manager/BrandingSettingsView.tsx` — الأقسام + setters.
2. `src/components/manager/ThemePreview.tsx` — عينات preview مصغّرة مُصدَّرة (نفس الاستهلاك `--m-*`).
3. (اختياري حسب س2) `src/components/manager/ThemeColorField.tsx` — `clearable` (~15 سطر).
4. (إضافة اختبارات جديدة فقط) ملف test جديد لدورة المجموعات — بلا تعديل اختبارات قديمة.

**لن تُلمس**: `brandTheme.ts` · `semanticTokens.ts` · `normalizeTheme.ts` · `editorModel.ts` · `CustomerThemeProvider.tsx` · `api.ts` · `server/**` (schemas/themeResolver/routes) · مكونات Customer · `index.css` · `tailwind.config.js` · أي ملف غير مدرج.

---

*نهاية تقرير المرحلة 1 — بانتظار موافقتك (وإجابات س1–س3) للانتقال للمرحلة 2.*
