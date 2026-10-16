# تحليل تعقيد نظام السمات والألوان — وخطة التبسيط المنفَّذة

**التاريخ:** 2026-10-16
**النطاق:** `src/theme/` + `src/index.css` + طبقة استهلاك الرموز في واجهة العميل
**النتيجة:** حُذفت عائلتا الرموز المشتقّتان بالكامل (`--brand-*` و `--menu-*`) وبقيت عائلة كنوسية واحدة (`--m-*`) وقناة تجاوز واحدة موثّقة. الحزمة: 1467 اختبارًا ناجحًا، و`tsc` و`build` نظيفان.

---

## أولًا: التحليل — لماذا كان النظام معقّدًا

### بنية خط الأنابيب (7 طبقات قبل التبسيط)

```
سطر Theme في قاعدة البيانات (أعمدة legacy: primaryColor/accentColor/…)
  └─ 1. normalizeTheme()           توحيد العقد + سقوط الألوان الافتراضية
      └─ 2. toEffectiveThemeShape()  تحويل إلى شكل EffectiveTheme
          └─ 3. buildBrandTokens()   اشتقاق السطح (soft/line/glow/ink… لكل surfaceMode)
              ├─ 4a. buildEffectiveThemeVars()  إصدار عقدة الخادم (--theme-* و --bg-* و --radius-* …)
              ├─ 4b. buildCompatibilityAliases() ← محذوفة — كانت تُضاعف كل رمز باسمين
              ├─ 4c. buildSemanticTokens()      العائلة الكنوسية --m-* (المالك الوحيد اليوم)
              └─ 5. buildCustomerThemeStyle()   تجميع كائن واحد لنطاق .customer-theme-scope

كاتب ثانٍ متوازٍ: applyEffectiveTheme() على <html> ← محذوف منه إصدار --brand-* و --menu-*
ذاكرة تخزين مؤقت إضافية: localStorage (BRAND_THEME_STORAGE_KEY) ← محذوفة
```

### العائلات الأربع للرموز (قبل التبسيط)

| العائلة | المصدر | الحالة اليوم |
|---|---|---|
| `--theme-*` | أسماء عقد الخادم (ألوان مخزّنة صريحة) | **تبقى** — قناة تجاوزات المحرر المتقدم |
| `--brand-*` | مشتقّة من ألوان العلامة في JS | **محذوفة** — كل مستهلكها يقرأ `--m-brand*` |
| `--menu-*` | إعادة اشتقاق CSS-side في `[data-theme='light']` | **محذوفة** — الاشتقاق صار في `surfaceTokens()` |
| `--m-*` | العائلة الكنوسية (اشتقاق واحد لكل وضع) | **العائلة الوحيدة** للوحة الألوان |

### الأسباب الجذرية السبعة للتعقيد

1. **عائلتان مشتقّتان من مصدر واحد:** `--brand-*` و `--menu-*` كانتا تعيدان حساب ما يشتقّه `buildBrandTokens()` أصلًا — رياضيات مكرّرة يمكن أن تتباعد.
2. **كاتبان لنفس الطبقة:** `applyEffectiveTheme()` يكتب على `<html>` و `CustomerThemeProvider` يكتب على النطاق — نفس القيم في مكانين، والـ CSS المُعرِّف يهزم الآخر غالبًا.
3. **طبقة أسماء مستعارة:** `buildCompatibilityAliases()` تضاعف كل رمز باسمين، فتوجد إجابتان للسؤال «ما لون هذا العنصر؟».
4. **اشتقاق CSS جانبي:** كتلة `[data-theme='light']` تعيد اشتقاق السطح في CSS بينما JS يشتقّه أيضًا — وجهتان لنفس الحساب.
5. **تخزين مؤقت `localStorage`:** قراءة سابقة للطلبية (`getCachedBrandTheme`) تضيف طبقة حالة ثالثة لا علاقة لها بالطلبية الفعلية.
6. **خطاطيف React ميتة:** `useBrandTheme`/`useEffectiveTheme` لا يستدعيها أي منتج — كانت تعيش للاختبارات فقط.
7. **لا عائلة كنوسية واحدة:** كل طبقة كانت تسمّي اللون نفسه باسم مختلف (`--brand-primary` = `--theme-primary` = `--menu-text` في حالات السطح الداكن).

---

## ثانيًا: الحل المنفَّذ — الحذف التدريجي بقيم متطابقة حرفيًا

### المبدأ
حذف وليس إعادة تسمية مموّهة: العائلتان المشتقّتان **محذوفتان من المصدر**، وكل مستهلِك يقرأ الاسم الكنوسي مباشرة. القيم متطابقة حرفيًا (نفس الرياضيات، نفس السلاسل) فلا يوجد أي تغيّر بصري.

### جدول التحويل (21 رمزًا)

| القديم | الكنوسي |
|---|---|
| `--brand-primary-strong` / `-rgb` | `--m-brand-on-surface` / `-rgb` |
| `--brand-primary` | `--m-brand` |
| `--brand-accent-strong` | `--m-brand-accent-on-surface` |
| `--brand-accent` / `-rgb` | `--m-brand-accent` / `-rgb` |
| `--brand-ink` | `--m-brand-ink` |
| `--brand-fill` | `--m-brand-fill` |
| `--brand-soft` | `--m-brand-soft` (رُقّي إلى كنوسي) |
| `--brand-soft-strong` | `--m-brand-soft-strong` (رُقّي إلى كنوسي) |
| `--brand-line` | `--m-brand-line` (رُقّي إلى كنوسي) |
| `--brand-line-strong` | `--m-hairline-strong` |
| `--brand-glow` | `--m-brand-glow` |
| `--brand-muted` | `--m-text-subtle` |
| `--menu-surface` / `-raised` | `--m-surface` / `--m-surface-raised` |
| `--menu-hairline` | `--m-hairline` |
| `--menu-text-strong` | `--m-text` |
| `--menu-text-base` | `--m-text-muted` |
| `--menu-media-end` | `--m-media-end` |

### ما حُذف فعليًا
- `buildCompatibilityAliases()` بالكامل (طبقة التضاعف).
- كتلة إصدار `--brand-*` داخل `applyEffectiveTheme()` (البقية: `--theme-*` + سمات `data-*`).
- `BRAND_VAR_NAMES` و `tokensToCssVars()` و `applyBrandTheme()` و `useBrandTheme()` و `useEffectiveTheme()`.
- `BRAND_THEME_STORAGE_KEY` و `getCachedBrandTheme`/`setCachedBrandTheme` (طبقة التخزين المؤقت).
- كتلة `[data-theme='light']` في CSS (إعادة الاشتقاق CSS-side) — الاشتقاق صار في `semanticTokens.surfaceTokens()`.
- ~100 مرجع في `index.css` انتقلت كلها إلى `--m-*`.

### ما بقي — ولماذا (قرار واعٍ)
- **`--theme-*` و `--button-*`/`--card-*`/`--badge-*`/`--category-*`** تبقى قناة تجاوزات المحرر المتقدم: `index.css` يستهلكها بمرجعية كنوسية (`var(--theme-text-primary, var(--m-text))`). التجاوزات المخزّنة للمستأجر يجب أن تظل تفوز — سياسة «التجاوزات لا تُهدر».
- **`--m-*` في `:root`** تبقى كقيم افتراضية بلا-JS (نفس قيم المنصة الذهبية).

### رموز جديدة رُقّيت إلى كنوسية
`--m-brand-soft` و `--m-brand-soft-strong` و `--m-brand-line` (كانت `--brand-soft`/`-soft-strong`/`-line` بلا مقابل كنوسي) — صارت تُصدر من `buildSemanticTokens` ضمن مجموعة `identity` (76 رمزًا).

---

## ثالثًا: التحقق

```
npx tsc -p tsconfig.app.json --noEmit   → ناجح
npx vitest run                          → 1467 ناجح / 1 فشل (Prisma sandbox موجود مسبقًا)
npm run build                           → ناجح
grep -rn "var(--brand-|var(--menu-"     → 0 مراجع وظيفية
```

اختبارات حراسة جديدة تمنع الانحدار:
- «لا تُصدر أي عائلة قديمة» — كل خاصية مخصّصة على نطاق العميل يجب أن تكون كنوسية.
- «لا تُصدر أي رمز `--brand-*` أو `--menu-*`» في دالة البناء.
- تكافؤ رياضي: العقد المخزّن (`--theme-bg` …) وقيم `buildBrandTokens` تطابق مخرجات الخط الكنوسي حرفيًا في الأوضاع الأربعة.
- اشتقاق الوجه الفاتح صار يُختبر في JS (لا كتلة CSS ميتة مفتاحية على `data-theme`).

**صافي التغيير:** 18 ملفًا، ‎+359/−525 سطرًا (حذف صافٍ 166 سطرًا).
