# تقرير تدقيق وتنفيذ SEO التقني — Mureeh Menu (`https://mureehmenu.com`)

- **التاريخ:** 2026-10-09 (التدقيق والتنفيذ الأساسي) · **2026-10-10** (استكمال: بطاقة مشاركة حقيقية، قسم تعريفي نصي في الرئيسية، تشديد robots، اختبارات إضافية — انظر B.7 وD.7)
- **الفرع:** `arena/46aa6e6c-restaurantsmureeh` (متفرّع من `main@292f465`)
- **النطاق:** الصفحة الرئيسية + صفحات المطاعم العامة `/r/{slug}` + robots/sitemap + البيانات المنظمة + الأداء
- **مبدأ العمل:** نفس HTML لكل العملاء (لا dynamic rendering، لا كشف user-agent)، لا تغيير إطار عمل، لا تلفيق بيانات، لا كسر لرموز QR أو الطلبات أو مسارات API.

> ملاحظة منهجية: كل ما يلي إمّا **تغيير كود تم تنفيذه واختباره محلياً**، أو **نتيجة تحقق فعلي** (طلبات HTTP على الموقع الحي أو على السيرفر المبني محلياً)، أو **توصية صريحة** تحتاج تنفيذاً يدوياً/وقتاً من Google. لم أستخدم Search Console أو Rich Results Test أو PageSpeed Insights في هذه الجلسة، ولم أطلب فهرسة أي صفحة — انظر القسم E.

---

## A. التدقيق الأولي (قبل أي تعديل)

### A.1 اكتشاف البنية (من المستودع، لا افتراضات)

| البند | ما وجدته فعلياً |
| --- | --- |
| الواجهة | Vite 8 + React 19 + TypeScript، **SPA بدون مكتبة توجيه**؛ "الصفحة" تُحدَّد من `window.location.pathname` داخل `RestaurantContext`. المسارات الحقيقية الوحيدة: `/` (صفحة الهبوط) و`/r/{slug}` (منيو المطعم). كل شاشات الإدارة/المطبخ/الأدمن حالات داخلية تحت `/` خلف تسجيل الدخول — ليست URLs. |
| الخادم | Express 5 + Prisma 5 (PostgreSQL). نفس العملية تقدّم `dist/` و`/api/*`. |
| النشر الحي | **تحققت مباشرة**: `GET https://mureehmenu.com/api/health` يعيد JSON من Express، و`GET /definitely-missing-file.xml` يعيد `{"error":"Endpoint Not Found"}` وهو حارس الـ fallback في `server/index.ts` → الموقع الحي أصل واحد يقدّمه Node (ليس static split). نفس التطبيق يجيب أيضاً على `restaurantsmureeh-2.onrender.com` (مضيف مكرر). `www.mureehmenu.com` يعيد توجيهاً إلى الجذر مسبقاً. |
| مصدر بيانات المطعم | `GET /api/public/restaurants/:slug` → مطعم `ACTIVE` فقط (404 لغير الموجود، 403 لغير ACTIVE) مع الفئات `ACTIVE` والمنتجات `available`. جدول `Restaurant` يحمل: `slug` (فريد)، `name`، `nameEn`، `description`، `phone`، `address`، `logoUrl`، `coverImageUrl`، `latitude/longitude`، `currency`، `language`، `businessType`، روابط التواصل، `status` (`ACTIVE | SUSPENDED | ONBOARDING | MAINTENANCE`)، `updatedAt`. |
| تدفق البيانات إلى المتصفح | DB → API JSON → React يرسم بعد التحميل. **HTML الأولي لأي `/r/{slug}` هو نفس `index.html` الخاص بالصفحة الرئيسية حرفياً.** |
| المطاعم الحية (`/api/public/restaurants`) | 4 مطاعم `ACTIVE`: `ghosn-cafe`، `saada-shaafout`، `bayt-al-sham` (معرّف UUID ثابت وصور Unsplash — يبدو بيانات seed تجريبية)، `hot-sauce` (معرّف UUID ثابت أيضاً). |

### A.2 قائمة المشكلات مرتبة بالأولوية

| # | الأولوية | المشكلة | الدليل | الأثر |
| --- | --- | --- | --- | --- |
| 1 | **P0** | **صفحة المطعم بدون QR كانت طريقاً مسدوداً حتى بعد تنفيذ JavaScript**: `CustomerLayout.tsx` كان يعرض بطاقة "هذا الرابط غير صالح للدخول المباشر. امسح رمز QR" لأي زيارة `/r/{slug}` بلا `activeTableId`. | `src/components/customer/CustomerLayout.tsx` (السطور 362–373 سابقاً)؛ مُوثَّق أيضاً في `docs/ux-audit-2026-09-16` كـ F-29. | لا يوجد **أي محتوى قابل للفهرسة** لصفحات المطاعم، حتى مع قدرة Google على تنفيذ JS. هذا هو السبب الجذري لعدم ظهور صفحات المطاعم. |
| 2 | **P0** | **كل صفحة مطعم تعلن canonical إلى الصفحة الرئيسية** مع عنوان/وصف/OG/JSON-LD الصفحة الرئيسية. | `index.html`: `<link rel="canonical" href="https://mureehmenu.com/">` ثابت + SPA fallback يرسل نفس الملف لكل مسار. | Google يدمج كل `/r/{slug}` في `/` (إلغاء فهرسة فعلي)، وبطاقات المشاركة الاجتماعية لكل مطعم تعرض بيانات المنصة. |
| 3 | **P0** | **لا اكتشاف لصفحات المطاعم**: `sitemap.xml` (الحي والثابت) يحوي `/` فقط، ولا يوجد **أي رابط HTML** من أي صفحة عامة إلى `/r/{slug}`. التعليقات في `platformSeo.ts` و`public/sitemap.xml` كانت تصف `/r/{slug}` خطأً بأنه "سطح خاص". | `server/seo/platformSeo.ts` (`STATIC_ENTRIES`)، `public/sitemap.xml`، `SaaSLandingPage.tsx` (روابط anchors داخلية فقط). | حتى لو كانت الصفحات قابلة للفهرسة لا طريق للزاحف إليها. |
| 4 | **P1** | **Soft-404**: أي مسار بلا امتداد غير معروف (`/dashboard`، `/r/unknown-slug`، `/r/suspended-venue`) يعيد **200** مع قشرة الصفحة الرئيسية. | `server/index.ts` SPA fallback. | ضوضاء في Search Console، نسخ مكررة من الرئيسية، إهدار crawl budget. |
| 5 | **P1** | **مضيف مكرر**: `restaurantsmureeh-2.onrender.com` يقدّم الموقع كاملاً بلا إعادة توجيه (الـ canonical الثابت كان يخفف الأثر فقط على الرئيسية). | تحقق مباشر `GET https://restaurantsmureeh-2.onrender.com/api/health` → 200. | محتوى مكرر عبر مضيفين. |
| 6 | **P1** | **بيانات الصفحة الرئيسية عامة ولا تطابق نية البحث**: العنوان "مُريح \| منصة الخدمات الإلكترونية للمطاعم" والوصف لا يحويان "منيو إلكتروني / QR"؛ `applicationSubCategory` كان "Restaurant Management Software". | `index.html`. | ضعف الملاءمة لاستعلامات الخدمة الفعلية (منيو إلكتروني، منيو QR، طلب من الطاولة). |
| 7 | **P1** | **لا بيانات منظمة على مستوى المطعم** (Restaurant/Menu). | — | لا أهلية لأي ميزات نتائج غنية للمطاعم. |
| 8 | **P1** (أداء) | **حزمة JS واحدة 1,144.58 kB (287 kB gzip)** تُحمَّل لزائر المنيو وتشمل لوحة الإدارة والمطبخ والأدمن. CSS 215 kB. | ناتج `npm run build` الأساسي. | ضغط على LCP/INP على الهواتف (قياس مخبري للحجم فقط). |
| 9 | **P2** | لا صفحة دليل عامة، ولا روابط داخلية بين الرئيسية والمطاعم. | — | ضعف بنية الروابط. |
| 10 | **P2** | `og:image` يشير إلى `/api/og?type=platform` الذي يعيد 302 إلى `favicon.svg` (ليس 1200×630). | `server/seo/ogImage.ts`. | بطاقات مشاركة ضعيفة (لا يؤثر على الفهرسة). **← عولج في 2026-10-10 (B.7).** |
| 11 | **P2** | **CSP يحجب Google Fonts فعلياً**: `style-src 'self' 'unsafe-inline'` و`font-src 'self' data:` بدون `fonts.googleapis.com`/`fonts.gstatic.com`، فالمتصفح لا يحمّل الخطوط الأربعة أصلاً (تحققت من رأس CSP على السيرفر المبني محلياً بنفس إعداد الإنتاج). كذلك سكربت الوضع الداكن المضمّن في `index.html` محجوب بـ `script-src 'self'`. | `server/index.ts` (helmet). | ليس مشكلة SEO مباشرة؛ أثره على الأداء "إيجابي بالصدفة" (لا خطوط خارجية تُحمَّل) لكنه عدم اتساق منتج. لم أغيّره — انظر F. |
| 12 | **P3** | محتوى الصفحة الرئيسية كله يُرسم بـ JS (`#root` فارغ)، مع أقسام `opacity:0` قبل الظهور (`Reveal`). المحتوى موجود في DOM فيُفهرس بعد الـ rendering؛ الرئيسية مفهرسة فعلاً. | `SaaSLandingPage.tsx`, `landing/primitives.tsx`. | منخفض. |

### A.3 ما كان سليماً ولم أغيّره

- `robots.txt` لا يحجب JS/CSS/الصور/`/api/*`، ويحجب فقط معاملات الجلسة (`?qr=`، `?sessionToken=`، `?table=`، `?tableId=`، `?t=`) — سياسة صحيحة أُبقيت كما هي.
- `/api/*` يحمل `X-Robots-Tag: noindex` دون حجب robots (لا اعتماد على الحجب + noindex معاً).
- JSON-LD الرئيسية لا يلفّق تقييمات/عناوين/هواتف؛ FAQPage يطابق أسئلة الصفحة الستة حرفياً (تحققت بالمقارنة).
- `og:locale="ar_AR"` هو رمز اللغة العربية المعتمد لدى Facebook — أُبقي.
- السيرفر يرفض إنشاء أي طلب بلا `sessionToken` صالح، والعميل (`createOrder`) يرفض بلا طاولة — لذا إزالة بوابة QR آمنة على منطق الطلبات.

---

## B. التغييرات المنفذة

### B.1 استراتيجية الـ rendering المختارة: **حقن سيرفري داخل قشرة الـ SPA نفسها (بدون SSR لإطار العمل، بدون dynamic rendering)**

المسوّغ: التطبيق بلا router ويعتمد على حالة عميل كثيفة؛ تحويله إلى SSR كامل أو إطار آخر كان سيخالف قيد "أصغر حل آمن". بدلاً من ذلك، يقرأ Express نفس الملف المبني `dist/index.html` ويستبدل فيه منطقتين لكل طلب `/r/{slug}`:

1. **`<head>`** بين علامتين جديدتين `<!-- seo:head:start -->` و`<!-- seo:head:end -->` (title, description, canonical, robots, OG, Twitter, JSON-LD) + `<html lang dir>` حسب لغة المطعم.
2. **`#root`**: لقطة HTML دلالية للمنيو (شعار، `h1` الاسم، الاسم الإنجليزي، الوصف، العنوان · الهاتف، تنقّل الأقسام، `h2` لكل قسم، `h3` لكل صنف مع الوصف والسعر). React 19 (`createRoot().render()`) يستبدلها عند التحميل بالمنيو التفاعلي نفسه — لا عقد hydration يجب صيانته.

**نفس البايتات لكل العملاء**: لا يوجد فحص user-agent في أي مكان (اختبار ثابت يمنع ذلك). القرار الوحيد المعتمد على الـ URL (لا على العميل): روابط الجلسة/الكشك (`?qr=`، `?table=`، `?view=display`…) تحصل على نفس الـ head لكن **بدون** اللقطة داخل `#root`، كي يبقى تسلسل الإقلاع بعد مسح QR مطابقاً لليوم (بدون وميض محتوى وسيط). هذه الروابط محجوبة عن الزحف أصلاً وcanonical يشير إلى `/r/{slug}`.

### B.2 الملفات الجديدة

| الملف | الدور |
| --- | --- |
| `server/seo/publicCatalog.ts` | **المسار الوحيد للقراءة من Prisma** في طبقة SEO: `getPublicVenue(slug)` (قراءة ضيقة: أعمدة عامة فقط + فئات ACTIVE + منتجات available) و`listPublishableVenues()` (استعلام واحد + تجميعان `groupBy`). سياسة الفهرسة `isVenueIndexable` (ACTIVE + قسم واحد غير فارغ على الأقل + ≥ 3 أصناف). ذاكرة مؤقتة TTL (60 ث للصفحة، 120 ث للقائمة، حد 500 مدخل). تحقق من charset الـ slug `^[a-z0-9_-]{1,80}$` قبل أي استعلام. لا كتابة إطلاقاً، ولا اختيار لأي عمود خاص (طاولات/رموز QR/جلسات/طلبات/مستخدمين — اختبار يفرض ذلك). |
| `server/seo/publicPages.ts` | دوال نقية (بلا DB/بيئة): بناء العنوان (≤ 70 حرفاً، بدون تكرار الاسم الإنجليزي إن كان ضمن العربي)، الوصف (≤ 160 حرفاً عند حدّ كلمة، مع لاحقة واقعية بعدد الأصناف/الأقسام بتصريف عربي صحيح، أو وصف مولّد من البيانات عند غيابه)، وسوم OG/Twitter، JSON-LD، اللقطة، صفحة الدليل، قشور 404/503. تهريب HTML كامل + تسلسل JSON-LD بهروب `<`/`>`/`&` كي لا يغلق نص المطعم وسم `<script>`. |
| `server/seo/publicHandlers.ts` | معالجات Express: `handleVenuePage` (`/r/:slug`)، `handleDirectoryPage` (`/restaurants`)، `handleSitemap`، `handleUnknownAppRoute` (404 صادق للمسارات المجهولة)، `handleCanonicalHostRedirect` (301 من `*.onrender.com` و`www.` إلى الأصل الرسمي لطلبات الصفحات فقط؛ `/api/*` و`/uploads/*` وفحوص الصحة لا تُمس). |
| `src/tests/seo-public-pages.test.ts` | 33 اختباراً على مستوى HTTP (Prisma مُحاكى، سيرفر Express حقيقي على منفذ عشوائي) — تفاصيل في D. |
| `src/tests/seo-host-redirect.test.ts` | 4 اختبارات لإعادة توجيه المضيف في وضع الإنتاج. |
| `public/og-image.png` *(2026-10-10)* | بطاقة المشاركة الاجتماعية للمنصة: PNG حقيقي 1200×630 (203 kB) مركّب **حصراً من أصول العلامة الموجودة في المستودع** (شعار الصقر من `favicon.svg`، الاسم "مُريح" و"Mureeh Menu" بخط Tajawal، وعنوان الصفحة الرئيسية كسطر تعريفي). رُسم مرة واحدة وقت التطوير عبر `@resvg/resvg-js` (SVG → PNG) ولم تُضف أي تبعية للمشروع. يُخدم من `https://mureehmenu.com/og-image.png`. |
| `src/tests/landing-crawlable-content.test.tsx` *(2026-10-10)* | 5 اختبارات تُصيّر **مكوّن الصفحة الرئيسية الحقيقي** إلى HTML ثابت (`renderToStaticMarkup`، بلا تأثيرات ولا متصفح) وتتحقق مما يراه الزاحف: `h1` واحد، مخطط العناوين لقسم التعريف، التسمية الصريحة للخدمة، روابط `<a href>` إلى `/restaurants` وإلى كل مطعم `ACTIVE` (ولا شيء لغير ACTIVE)، نصوص الأسئلة الشائعة مرئية، لا `undefined/null/NaN`. |

### B.3 الملفات المعدلة

| الملف | التغيير |
| --- | --- |
| `index.html` | علامتا `seo:head`؛ عنوان جديد **"مُريح — منيو إلكتروني QR وطلب من الطاولة للمطاعم والكافيهات"** ووصف يذكر الخدمة الفعلية والسعر الحقيقي (₪300 شهرياً كما في الصفحة)؛ `og:site_name` ثنائي اللغة؛ JSON-LD: `alternateName: "Mureeh Menu"` للموقع والمنظمة، `sameAs` إلى قناة تيليجرام الموجودة فعلاً في الصفحة، `applicationSubCategory` → "Digital Menu & QR Ordering for Restaurants". لم يُضف أي `Review`/`aggregateRating`/`address`/`telephone`. *(2026-10-10)* `og:image`/`twitter:image` يشيران مباشرة إلى `https://mureehmenu.com/og-image.png` (بلا قفزة redirect)، مع `og:image:type` و`og:image:alt`، وأبعاد `1200×630` المعلنة أصبحت **حقيقية** (اختبار يقرأ رأس PNG ويقارنه بالوسوم). |
| `server/index.ts` | تركيب: `app.use(handleCanonicalHostRedirect)` → `/sitemap.xml` (المعالج الديناميكي الجديد بدل المنصّي) → `/robots.txt` → `/api/og` → `/restaurants` → `/r/:slug` → `express.static` → fallback: `/` يبقى 200 بالقشرة، أي مسار آخر بلا امتداد → **404 + قشرة noindex**، الملفات المفقودة تبقى JSON 404. لم يتغير أي مسار API أو منطق أعمال. |
| `server/seo/platformSeo.ts` | تحديث التعليقات (كانت تصف `/r/{slug}` بأنه خاص)، `STATIC_ENTRIES` أصبح مُصدَّراً وبلا `changefreq/priority`، robots.txt يوثّق السطح العام الثلاثي. يبقى خالياً من Prisma. *(2026-10-10)* أُضيفت توائم `&` لمعاملات الجلسة (`/*&qr=` … `/*&t=`): أنماط robots حرفية، و`/*?qr=` لا يطابق `?lang=en&qr=…`. |
| `public/robots.txt`, `public/sitemap.xml` | نفس القواعد؛ تعليقات صحيحة. الملف الثابت للـ sitemap يبقى `/` فقط عمداً (fallback للاستضافة الثابتة التي لا تعرف أي المطاعم منشورة). *(2026-10-10)* `public/robots.txt` **مطابق بايتاً ببايت** لمخرجات `buildRobotsTxt()` واختبار يفرض ذلك. |
| `src/components/customer/CustomerLayout.tsx` | **إزالة بوابة QR** لزيارات `/r/{slug}` المباشرة → وضع تصفح فقط. الطلب يبقى مرتبطاً بالطاولة: شارة الهيدر تطلب مسح QR، سلة الدفع تفتح مطالبة QR، `createOrder` يرفض بلا جلسة، والسيرفر يفرض `sessionToken`. |
| `src/components/common/SaaSLandingPage.tsx` | قسم جديد **"منيوهات حيّة"** يعرض المطاعم `ACTIVE` التي يعيدها API العام فعلاً كروابط `<a href="/r/{slug}">` (يُخفى عند عدم وجود بيانات — لا placeholder)، ورابط `/restaurants` في القسم وفي تذييل الروابط السريعة. *(2026-10-10)* قسم تعريفي نصي **"ما هو مُريح؟"** (`#about`) مباشرة تحت الـ hero — انظر B.7. |
| `src/App.tsx` | **تقسيم كود** بـ `React.lazy` لشاشات الإدارة/المطبخ/الشاشة الحية/الأدمن/المعاينة (لا يصل إليها إلا مستخدم مسجّل). |
| `src/tests/seo-platform.test.ts`, `src/tests/seo-production.test.ts` | إعادة كتابة التأكيدات التي كانت تمنع صراحةً فهرسة المطاعم ("platform only")، وإضافة حرّاس جدد (العلامات، حدود الوحدات، منع كشف user-agent، منع تلفيق البيانات، الروابط القابلة للزحف، غياب بوابة QR). |
| `docs/SEO_PLATFORM.md` | إعادة كتابة كاملة لتوثيق المعمارية الجديدة. *(2026-10-10)* قسم "Social card"، توائم `&` في robots، قسم التعريف، إرشادات استبدال البطاقة. |
| `server/seo/ogImage.ts` *(2026-10-10)* | ثابت واحد `PLATFORM_OG_IMAGE_PATH = '/og-image.png'` تستهلكه `publicPages.ts` (fallback للمطاعم بلا غلاف/شعار، الدليل، قشور 404/503) ومعيد التوجيه القديم `/api/og?type=platform` (يبقى للتوافق: 302 إلى الملف الجديد بدل `favicon.svg`). |
| `server/seo/publicPages.ts` *(2026-10-10)* | `PLATFORM_OG_IMAGE` يُشتق من الثابت أعلاه؛ `twitter:card` أصبح `summary_large_image` دائماً لأن كل صفحة باتت تملك صورة 1200×630 فعلية. |

### B.4 سياسة الحالات (كود الاستجابة + robots)

| حالة المطعم | HTTP | `meta robots` | لقطة `#root` | في sitemap/الدليل |
| --- | --- | --- | --- | --- |
| ACTIVE وقابل للنشر (≥ 3 أصناف في أقسام ACTIVE) | 200 | `index, follow, max-image-preview:large` | نعم | نعم |
| ACTIVE لكن منيو فارغ/ضئيل | 200 | `noindex, follow` | نعم | لا |
| SUSPENDED / ONBOARDING | 404 | `noindex, follow` | لا | لا |
| MAINTENANCE | 503 + `Retry-After: 600` | `noindex, follow` | لا | لا |
| slug مجهول أو بأحرف غير مسموحة | 404 | `noindex, nofollow` | لا | لا |
| فشل قراءة قاعدة البيانات | 503 + `Retry-After: 60` + `no-store` | `noindex, nofollow` | لا | sitemap يتراجع إلى `/` فقط بـ 200 |
| `/r/{SLUG}` أو `/r/{slug}/` | 301 → `/r/{slug}` مع الاحتفاظ بـ query | — | — | — |

### B.5 الـ canonical

- الأصل: `https://mureehmenu.com` (ثابت في `PRODUCTION_ORIGIN`؛ `APP_URL` تجاوز لغير الإنتاج فقط). تحققت أن sitemap الحي يستخدم هذا الأصل فعلاً.
- `www` → الجذر (موجود مسبقاً خارج التطبيق)؛ `*.onrender.com` → 301 (جديد، للصفحات فقط).
- صفحة المطعم: canonical دائماً `https://mureehmenu.com/r/{slug}` مهما كانت المعاملات (`?qr=`، `?view=display`، `utm_*`). المحتوى الأساسي لرابط الجلسة هو نفس المنيو؛ وظيفة الطاولة تبقى في العميل.
- لا `hreflang`: لا توجد مسارات لغة منفصلة؛ `lang`/`dir` يُشتقّان من حقل `language` للمطعم (`ar`→`rtl`، `en`→`ltr`)، ولا خلط لغوي في البيانات الوصفية (نسخة إنجليزية كاملة للعناوين/الأوصاف عند `language = en`).

### B.6 البيانات المنظمة لصفحة المطعم

`@graph` من عقدتين: `Restaurant`/`CafeOrCoffeeShop`/`Bakery` (حسب `businessType`) + `WebPage` مرتبطة بـ `#website`. العقدة تحمل فقط ما أدخله المطعم: `telephone` و`address` (`PostalAddress.streetAddress`) و`geo` (فقط عند توفر الإحداثيتين) و`sameAs` (روابط https الموجودة) و`image/logo` (الأصول الفعلية) و`hasMenu → MenuSection → MenuItem` يطابق الأقسام والأصناف المعروضة، مع `offers.price/priceCurrency` **فقط عندما يُعرَف رمز العملة المخزَّن** (`₪`→ILS، `$`→USD، `€`→EUR، `SAR`…). **لا** `aggregateRating`، لا `Review`، لا `openingHours`، لا `priceRange`، لا `servesCuisine` (اختبار ثابت يمنعها). الدليل `/restaurants`: `CollectionPage` + `ItemList` + `BreadcrumbList` يطابق فتات خبز مرئية فعلاً.

---

### B.7 استكمال 2026-10-10 — ما أُضيف ولماذا

| التغيير | السبب (من التدقيق) | الحدود المتعمدة |
| --- | --- | --- |
| **قسم "ما هو مُريح؟"** في الصفحة الرئيسية (`<section id="about">`، رابط في القائمة العلوية والتذييل): `h2` "منصة منيو إلكتروني QR للمطاعم والكافيهات"، فقرة تعريفية تذكر "Mureeh Menu" مرة واحدة، ثلاث بطاقات بعناوين `h3`: **لمن صُمّم؟ / ما المشكلة التي يحلّها؟ / كيف يعمل المنيو الرقمي؟**، ثم روابط إلى `/restaurants` و`#pricing` وزر البدء. | كانت الصفحة الرئيسية تقول *ماذا تفعل المنصة* بلغة تسويقية (hero + بطاقات مزايا) دون أن تقول صراحةً *ما هي* ولمن — وهو ما تبحث عنه نيّة البحث "منيو إلكتروني للمطاعم" (كانت الفرصة #1 في F). | كل جملة مربوطة بقدرة موجودة فعلاً: أنواع الأعمال = `BusinessType` (مطعم/كافيه/مخبز)، الطلب يصل إلى شاشة المطبخ (KDS)، الأسماء العربية/الإنجليزية = حقول `nameEn` المعروضة في بطاقة الصنف، **الطلب يتطلب مسح رمز الطاولة** بينما الرابط العام للتصفح فقط (صيغ النص بهذه الدقة). لا تغيير في `h1`، لا صفحات جديدة، لا ادعاءات أرقام. |
| **بطاقة مشاركة حقيقية** `public/og-image.png` 1200×630 | `og:image` كان إعادة توجيه إلى `favicon.svg` (SVG لا تعرضه معظم شبكات المشاركة، والأبعاد المعلنة 1200×630 كانت كاذبة). | مركّبة من أصول المستودع فقط (لا صور مولّدة)؛ < 300 kB لتوافق WhatsApp؛ URL ثابت قابل للتخزين المؤقت. |
| **توائم `&` في robots.txt** | `Disallow: /*?qr=` يطابق فقط حين يكون `qr` أول معامل؛ رابط مثل `/r/x?view=display&qr=…` كان قابلاً للزحف. | لا حجب لأي مسار صفحة أو أصل ثابت؛ `/og-image.png` غير محجوب (اختبار). |
| **اختبارات جديدة (+14)** | تثبيت الضمانات أعلاه ضد التراجع. | `seo-platform.test.ts` +8: تطابق FAQPage مع قائمة `FAQS` المرئية حرفياً، وجود قسم التعريف وروابطه، صحة PNG (توقيع + أبعاد IHDR = الوسوم المعلنة + حد الحجم)، تماثل `public/robots.txt` مع المولّد، توائم `&`. `seo-public-pages.test.ts` +1: المطعم بلا صور وقشرة 404 يستخدمان البطاقة الحقيقية لا `favicon.svg`. `landing-crawlable-content.test.tsx` +5 (جديد، تصيير حقيقي). |
| **تعديل `docs/SEO_PLATFORM.md`** | توثيق البطاقة وكيفية استبدالها، وتوائم robots، وقسم التعريف. | — |

---

## C. جدول تغطية SEO

| المتطلب | الحالة | أين |
| --- | --- | --- |
| HTML خام يحمل محتوى وبيانات صفحة المطعم قبل JS | ✅ | `publicHandlers.handleVenuePage` + `publicPages.renderVenuePage`؛ اختبار `GET /r/:slug — raw HTML` |
| نفس المحتوى للزاحف والمستخدم | ✅ | لا كشف UA؛ اختبار `no user-agent detection` |
| title/description/canonical/OG/Twitter فريدة لكل مطعم من بيانات حقيقية | ✅ | `buildVenueHead`؛ وسم واحد فقط من كل نوع (اختبار العدّ) |
| معالجة الحقول الناقصة بلا `undefined` | ✅ | كل الحقول اختيارية مع حراس؛ اختبار `not.toMatch(/undefined|null|NaN/)` |
| canonical على `https://mureehmenu.com` بلا www/HTTP/trailing slash/حالة أحرف/معاملات تتبع | ✅ | 301 للحالة والشرطة؛ canonical نظيف؛ إعادة توجيه المضيف؛ www موجود مسبقاً |
| QR/table/session: canonical للصفحة العامة مع بقاء الوظيفة | ✅ | السيرفر لا يقرأ قيمة `qr`؛ العميل يستهلكها كما قبل |
| robots.txt لا يحجب JS/CSS/الصور/`/api`/الصفحات العامة | ✅ | `public/robots.txt` ≡ `platformSeo.buildRobotsTxt` (اختبار تماثل)؛ معاملات الجلسة محجوبة في أي موضع (`?`/`&`) |
| noindex للخاص/الإداري/الجلسة بلا الاعتماد على الحجب | ✅ | شاشات الإدارة ليست URLs؛ `/api` بـ `X-Robots-Tag`؛ المسارات المجهولة 404+noindex |
| sitemap ديناميكي من DB: ACTIVE وغير فارغ فقط، بلا slugs ملفّقة، HTTPS، بلا معاملات، `lastmod` من `updatedAt` الحقيقي، XML صالح، بلا تكرار، معالجة أخطاء آمنة | ✅ | `handleSitemap`/`buildSitemapEntries`؛ اختبارات sitemap الثلاثة (بما فيها "كل URL في sitemap يعيد 200") |
| روابط HTML قابلة للزحف إلى صفحات المطاعم | ✅ | قسم "منيوهات حيّة" + `/restaurants` (+ رابط الدليل داخل قسم التعريف)؛ اختبار تصيير حقيقي `landing-crawlable-content.test.tsx` |
| JSON-LD يطابق المحتوى المرئي فقط | ✅ | انظر B.6؛ اختبارات `never fabricates` |
| `lang`/`dir` صحيحان، hreflang فقط عند وجود مسارات لغة | ✅ | `injectIntoShell`؛ اختبار المطعم الإنجليزي |
| 404 حقيقي للصفحات المفقودة (لا soft-200) | ✅ | `/r/unknown` و`/dashboard` → 404؛ `/` → 200 |
| لا نطاقات تطوير في canonical الإنتاج | ✅ | `PRODUCTION_ORIGIN`؛ اختبارات تمنع `localhost/onrender/vercel/netlify` |
| QR/الطاولة/الطلبات/API تعمل كما قبل | ✅ | لا تغيير في `/api/*` أو `createOrder` أو `qrCodeGenerator`؛ مجموعة الاختبارات الكاملة خضراء |
| لا أسرار في الواجهة، لا مسارات خاصة في sitemap | ✅ | اختبار `selects only public columns`؛ اختبار `never leaks a private URL` |
| الأداء: JS أقل للصفحات العامة | ✅ (مخبري) | تقسيم الكود في `App.tsx` — انظر D.5 |
| صفحات خدمات جديدة | ⏸ لم تُنشأ | عمداً — انظر F (لا صفحات رقيقة) |
| صورة اجتماعية 1200×630 للمنصة | ✅ *(2026-10-10)* | `public/og-image.png` + `PLATFORM_OG_IMAGE_PATH`؛ الأبعاد المعلنة تُقرأ من الملف في الاختبار |
| وضوح الصفحة الرئيسية (ما هي الخدمة، لمن، كيف تعمل) بنص قابل للزحف | ✅ *(2026-10-10)* | قسم `#about` — انظر B.7 |
| بطاقة مشاركة لكل مطعم من شعاره/غلافه | ✅ جزئياً | المطاعم ذات غلاف/شعار تستخدمه؛ الباقون يرثون بطاقة المنصة — توليد بطاقة مركّبة لكل مطعم في F |

---

## D. التحقق (أوامر ونتائج فعلية)

### D.1 خط الأساس قبل التعديل (نفس البيئة)

| الأمر | النتيجة |
| --- | --- |
| `npm run lint` | 0 أخطاء / 174 تحذيراً (موجودة مسبقاً) |
| `npx tsc --noEmit -p tsconfig.app.json` | نظيف |
| `npx tsc --noEmit -p tsconfig.server-check.json` | **146 خطأ موجوداً مسبقاً** (manager.ts 98، public.ts 30، admin.ts 9، uploads.ts 3، provision-admins.ts 3، index.ts 2، auth.ts 1) — هذا الفحص "report-only" في CI |
| `npm run build` | ✓ — `index.html` 15.30 kB، CSS 214.95 kB، **JS 1,144.58 kB (286.77 kB gzip) حزمة واحدة** |
| `npx vitest run` | 93 ملفاً ناجحاً / 4 متجاوزة؛ **1438 اختباراً ناجحاً**، 82 متجاوزاً؛ خطآن غير معالَجين من `PrismaClientInitializationError` (بيئة الـ sandbox بلا محرّك Prisma — ليسا من الكود) |

### D.2 بعد التعديل

| الأمر | 2026-10-09 | 2026-10-10 (الحالة النهائية للفرع) |
| --- | --- | --- |
| `npm run lint` | **0 أخطاء / 174 تحذيراً** (لم يُضف أي تحذير) | **0 / 174** (بلا تغيير) |
| `npx tsc --noEmit -p tsconfig.app.json` | **نظيف** | **نظيف** |
| `npx tsc --noEmit -p tsconfig.server-check.json` | **146 خطأ — العدد نفسه تماماً**؛ الملفات الجديدة في `server/seo/` تضيف **0** أخطاء | **146** (بلا تغيير) |
| `npm run build` | ✓ — انظر D.5 | ✓ — `dist/og-image.png` يُنسخ (203,221 B)؛ `index.html` 16.71 kB |
| `npx vitest run` | **95 ملفاً ناجحاً** / 4 متجاوزة؛ **1483 اختباراً ناجحاً** (+45)، 82 متجاوزاً؛ نفس الخطأين البيئيين لـ Prisma فقط. المدة ≈ 47 ث | **96 ملفاً** / 4 متجاوزة؛ **1497 اختباراً ناجحاً** (+14)، 82 متجاوزاً؛ نفس الخطأين البيئيين فقط (`production-hardening.test.ts`، محرّك Prisma غير متاح في الـ sandbox) |

### D.3 ما تغطيه الاختبارات الجديدة (`seo-public-pages.test.ts` — 33 اختباراً، HTTP حقيقي، Prisma مُحاكى)

- `/r/ghosn-cafe`: 200، `<html lang="ar" dir="rtl">`، العنوان `غصن كافيه (Ghosn Cafe) — المنيو الإلكتروني والأسعار`، canonical/og:url نظيفان، robots index، `og:image` من صورة الغلاف الحقيقية، **وسم واحد فقط** من title/canonical/robots/description/JSON-LD، JSON-LD يحوي `CafeOrCoffeeShop` + `WebPage` ولا يحوي FAQPage/SoftwareApplication الخاصة بالرئيسية، لا URL تطوير في أي سمة.
- اللقطة داخل `#root`: `h1`/`h2`/`h3`، الأسعار، العنوان، `tel:`، إغفال القسم الفارغ، **تهريب** نص خطر `تشيز كيك "نيويورك" & توت <خاص>` في HTML و`</script><b>` داخل JSON-LD مع بقاء JSON قابلاً للتحليل.
- `?qr=…&utm_source=…&view=display`: نفس الـ head وcanonical نظيف ولا يظهر الرمز في HTML؛ بلا لقطة. معاملات التتبع وحدها لا تغيّر الصفحة.
- 301 لـ `/r/Ghosn-Cafe?qr=abc` و`/r/ghosn-cafe/?qr=abc` → `/r/ghosn-cafe?qr=abc`.
- مطعم ضئيل → 200 + `noindex, follow` مع لقطة؛ SUSPENDED → 404 + noindex **بدون لقطة**؛ MAINTENANCE → 503 + `Retry-After`.
- slug مجهول/مشوّه → 404 + قشرة SPA + noindex، بدون استعلام DB للمشوّه.
- فشل DB → 503 + `no-store` + noindex ولا يتسرّب نص الخطأ.
- HEAD يعمل؛ الذاكرة المؤقتة: استعلام واحد لثلاث زيارات.
- `/restaurants`: روابط `<a href="/r/…">` للمطاعم القابلة للنشر فقط، فتات خبز مرئية + `BreadcrumbList`، 301 للشرطة الزائدة، 503+noindex عند فشل DB، حالة فارغة صادقة + noindex عند صفر مطاعم.
- `/sitemap.xml`: XML صالح، `/` ثم `/restaurants` ثم المطاعم القابلة للنشر فقط، بلا تكرار، `lastmod` = أحدث `updatedAt` حقيقي (المنتج)، **بلا lastmod للرئيسية** (لا طابع زمني حقيقي لها)، بلا `changefreq/priority`، بلا `?`، بلا مسارات خاصة؛ **كل URL في sitemap يعيد 200 وrobots index**؛ التراجع إلى `/` فقط عند فشل DB.
- fallback: `/` → 200، `/dashboard` → 404 + noindex + قشرة، `/missing.xml` → JSON 404.
- سياسة الفهرسة وcharset الـ slug والأعمدة المختارة (لا `tables/orders/users/transferAccounts…`).

### D.4 تشغيل السيرفر المبني فعلياً في الـ sandbox (بلا قاعدة بيانات — يثبت سلوك الطبقة الحقيقية في `server/index.ts`)

```
$ NODE_ENV=development … npx tsx server/index.ts   # يقدّم dist/ المبني
/                      200 text/html  <title>مُريح — منيو إلكتروني QR وطلب من الطاولة للمطاعم والكافيهات</title>  robots: index
/foo                   404 text/html  <title>الصفحة غير موجودة | مُريح</title>  robots: noindex, nofollow
/r/ghosn-cafe          503 text/html  (قاعدة البيانات غير متاحة في الـ sandbox) robots: noindex, nofollow
/r/Ghosn-Cafe          301 → /r/ghosn-cafe
/r/ghosn-cafe/?qr=abc  301 → /r/ghosn-cafe?qr=abc
/restaurants           503 text/html  (DB غير متاحة)  robots: noindex, follow
/restaurants/          301 → /restaurants
/sitemap.xml           200 application/xml  (يتراجع إلى https://mureehmenu.com/ فقط)
/robots.txt            200 text/plain
/missing.xml           404 application/json
```

رأس CSP الصادر فعلياً: `style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; …` — أساس الملاحظة #11.

**إعادة التشغيل 2026-10-10** (نفس الأمر، بعد إعادة البناء وإعادة تشغيل السيرفر كي يلتقط تعديلات `server/seo/*`):

```
/og-image.png                 200 image/png  203,221 bytes
/api/og?type=platform         302 → https://mureehmenu.com/og-image.png   X-Robots-Tag: noindex   (كان → favicon.svg)
/                             og:image = https://mureehmenu.com/og-image.png ، og:image:type=image/png ، og:image:alt ، twitter:card=summary_large_image
/r/no-such-venue              503 (بلا DB) — قشرة الخطأ تحمل og:image = https://mureehmenu.com/og-image.png
/robots.txt                   يحوي Disallow: /*&qr= /*&sessionToken= /*&table= /*&tableId= /*&t=
/dashboard 404 · /r/Ghosn-Cafe 301→/r/ghosn-cafe · /r/ghosn-cafe/?qr=abc 301→/r/ghosn-cafe?qr=abc · /restaurants/ 301→/restaurants · /sitemap.xml 200 · /missing.xml 404   (كما في 10-09)
```

### D.5 الأداء (قياس مخبري للحجم فقط — ليس CWV ميداني)

| الحزمة | قبل | بعد |
| --- | --- | --- |
| JS الذي تحمّله صفحة عامة (الرئيسية أو منيو مطعم) | **1,144.58 kB / 286.77 kB gzip** (حزمة واحدة) | **625.71 kB / 172.66 kB gzip** (`index`) + 106.98 kB / 31.06 kB gzip (chunk مشترك `clock-*`، modulepreload) ≈ **204 kB gzip (−29%)**. بعد قسم التعريف (10-10): 630.25 kB / **173.43 kB gzip** (+0.8 kB gzip) |
| شاشات الإدارة (تُحمَّل عند الطلب لمستخدم مسجّل فقط) | ضمن الحزمة الواحدة | `ManagerLayout` 373 kB / 78 kB gzip، `PlatformAdminPortal` 17 kB، `LiveRestaurantScreen` 12 kB، `KitchenDisplaySystem` 9 kB، `SplitPreviewLayout` 2 kB |
| CSS | 214.95 kB / 38.75 kB gzip | 215.22 kB / 38.75 kB gzip (بلا تغيير جوهري) |
| HTML الرئيسية | 15.30 kB | 16.48 kB (العلامات + التعليقات) → 16.71 kB (10-10: وسوم `og:image:type/alt`) |
| بطاقة المشاركة `og-image.png` | — (كان redirect إلى SVG) | 203 kB PNG، تُطلب فقط من زواحف المشاركة/المعاينة لا من المتصفح العادي — لا أثر على تحميل الصفحة |

**لم أقس LCP/INP/CLS** (لا Lighthouse/Chrome في البيئة، ولا بيانات CrUX في هذه الجلسة). ما يمكن قوله بصدق: حجم JS الأولي للصفحات العامة انخفض ~29% مضغوطاً، وصفحة المطعم أصبحت تحمل محتوى مرئياً في HTML الأولي قبل تنفيذ JS (تحسين متوقع للـ FCP/LCP على الروابط المباشرة، يحتاج قياساً ميدانياً بعد النشر — انظر E).

### D.6 ما لم يُنفَّذ/يُتحقق منه في هذه الجلسة (بصراحة)

- لم أرسل sitemap ولم أطلب فهرسة ولم أفتح Search Console.
- لم أشغّل Rich Results Test أو PageSpeed Insights.
- **فحوص الموقع الحي المذكورة في A وE أُجريت في 2026-10-09 ولم تُعَد في 2026-10-10** (بيئة الجلسة الثانية بلا منفذ خارجي إلى `mureehmenu.com`)؛ كل نتائج 10-10 محلية (اختبارات + سيرفر مبني في الـ sandbox).
- لم أختبر على قاعدة بيانات حقيقية (الـ sandbox بلا محرّك Prisma)؛ الاستعلامات الجديدة مرّت من فحص الأنواع (`tsc` على مخطط Prisma) واختُبرت بمحاكاة Prisma. استعلامات `groupBy` مع مرشّحات علاقات صالحة نوعياً، لكن ينبغي التحقق من أول استجابة `/sitemap.xml` و`/restaurants` بعد النشر (انظر E).

### D.7 الاختبارات المضافة في 2026-10-10 (+14 صافياً، كلها خضراء)

| الملف | ما يثبته |
| --- | --- |
| `seo-platform.test.ts` (36 → 44) | FAQPage في JSON-LD **يطابق حرفياً** (عدد/ترتيب/نص) قائمة `FAQS` المعروضة في الصفحة (التقطت 6 أزواج)؛ قسم `#about` بعناوينه الثلاثة وروابطه و`(Mureeh Menu)` وإدراجه في القائمة؛ `og:image`/`twitter:image` تشيران مباشرة إلى `/og-image.png` مع `type`/`alt`؛ الملف موجود، توقيع PNG صحيح، **أبعاد IHDR = 1200×630 = الوسوم المعلنة**، الحجم < 300 kB؛ `PLATFORM_OG_IMAGE_PATH` مصدر الحقيقة الوحيد في `ogImage.ts`/`publicPages.ts`؛ robots يحجب معاملات الجلسة بصيغتي `?` و`&` ولا يحجب `/og-image`; `public/robots.txt` **≡** `buildRobotsTxt()` و`PUBLIC_ORIGIN` = الأصل الإنتاجي. |
| `seo-public-pages.test.ts` (33 → 34) | عبر HTTP حقيقي: المطعم بلا غلاف/شعار وقشرة 404 يحملان `og:image`/`twitter:image` = البطاقة الحقيقية، ولا يُعلن `favicon.svg` كصورة مشاركة، ولا `/api/og`. |
| `landing-crawlable-content.test.tsx` (جديد، 5) | تصيير المكوّن الحقيقي: `h1` واحد؛ `h2#about-title` + ثلاثة `h3` بالترتيب وبلا قفز مستويات؛ النص يسمّي الخدمة ("منيو إلكتروني"، "رمز QR"، "(Mureeh Menu)"، "للمطاعم والكافيهات والمخابز")؛ روابط `/restaurants` و`/r/{slug}` لكل مطعم ACTIVE من البيانات، **ولا رابط لمطعم SUSPENDED**؛ نصوص FAQ مرئية؛ لا `undefined/null/NaN/[object Object]`. |

---

## E. عمليات يدوية مطلوبة من المالك

1. **نشر الفرع** (Render يبني `dist/` ويشغّل Express؛ لا متغيرات بيئة جديدة مطلوبة). تأكد أن `APP_URL` إمّا غير مضبوط أو `https://mureehmenu.com` (sitemap الحي يؤكد ذلك حالياً).
2. **تحقق بعد النشر مباشرة** (دقيقتان):
   - `curl -sI https://mureehmenu.com/r/ghosn-cafe` → `200`; `curl -s https://mureehmenu.com/r/ghosn-cafe | grep -c '<title>'` → `1` والعنوان باسم المطعم.
   - `curl -s https://mureehmenu.com/sitemap.xml` → يحوي `/restaurants` وصفحات المطاعم مع `lastmod`.
   - `curl -sI https://restaurantsmureeh-2.onrender.com/` → `301` إلى `https://mureehmenu.com/`.
   - `curl -sI https://mureehmenu.com/r/does-not-exist` → `404`.
   - امسح رمز QR حقيقياً وتأكد أن تسلسل الدخول وإنشاء الطلب كما كانا.
   - `curl -sI https://mureehmenu.com/og-image.png` → `200` و`content-type: image/png`؛ `curl -s https://mureehmenu.com/robots.txt | grep -c '&'` → `5`.
3. **البيانات التجريبية (P1 تجاري):** المطاعم `bayt-al-sham` (صور Unsplash، UUID ثابت) وربما `hot-sauce` تبدو بيانات seed بحالة `ACTIVE`؛ **ستظهر الآن في الصفحة الرئيسية والدليل وsitemap وتُفهرس**. إن لم تكن عملاء حقيقيين: غيّر حالتها إلى `SUSPENDED` أو احذفها من لوحة الأدمن (لم أستثنِها برمجياً حتى لا أُخفي بيانات بقرار كود).
4. **Search Console:** أعد إرسال `https://mureehmenu.com/sitemap.xml`، ثم استخدم "فحص عنوان URL" على صفحة مطعم واحدة وتحقق من أن "HTML الذي تم الزحف إليه" يحوي العنوان الجديد، واطلب الفهرسة لها. راقب تقرير "الصفحات" خلال 2–6 أسابيع — الفهرسة والترتيب يحتاجان وقتاً من Google ولا يمكن ضمانهما.
5. **اختبار النتائج الغنية:** شغّل Rich Results Test على `/r/{slug}` و`/restaurants` (توقّع: Restaurant/Menu بلا أخطاء إلزامية؛ أي تحذيرات عن `address`/`telephone` تعني أن المطعم لم يُدخل هذه البيانات في لوحته — الحل إدخالها، لا تلفيقها).
6. **بيانات المطاعم:** شجّع المطاعم على إكمال الوصف والعنوان والهاتف والشعار وصورة الغلاف في لوحة التحكم — كل حقل يُعبَّأ يظهر تلقائياً في العنوان/الوصف/JSON-LD/بطاقة المشاركة. المطاعم بأقل من 3 أصناف تبقى `noindex` حتى يكتمل المنيو (العتبة `MIN_INDEXABLE_PRODUCTS` في `publicCatalog.ts`).
7. **تحديث ذاكرة بطاقات المشاركة:** شبكات المشاركة تخزّن الصورة القديمة حسب URL الصفحة. بعد النشر مرّر `https://mureehmenu.com/` (وصفحة مطعم واحدة) في Facebook Sharing Debugger ("Scrape Again") وLinkedIn Post Inspector، وأعد إرسال الرابط في واتساب/تيليجرام للتأكد من ظهور البطاقة الجديدة. لم أفعل ذلك — يحتاج حساباً وموقعاً منشوراً.
8. **القياس الميداني:** بعد أسبوعين راجع Core Web Vitals في Search Console (بيانات CrUX) وشغّل PageSpeed Insights على `/` و`/r/{slug}`؛ قارن بالأرقام المخبرية في D.5.

---

## F. فرص متبقية (مرتبة بالأثر × الثقة ÷ الجهد)

> نُفّذت في 2026-10-10 الفرصتان اللتان كانتا #1 (محتوى تعريفي نصي في الرئيسية) و#3 (بطاقة مشاركة 1200×630) من النسخة السابقة لهذا الجدول — انظر B.7. ما يلي هو المتبقي فقط.

| # | الفرصة | الأثر | الثقة | الجهد | ملاحظات |
| --- | --- | --- | --- | --- | --- |
| 1 | **صفحات خدمات مستقلة** (`/qr-menu`، `/pos`، `/kds`) **فقط إن** كُتب لكل منها محتوى أصيل (شرح، صور شاشات حقيقية، أسئلة خاصة، حالات استخدام). | متوسط–عالٍ | متوسطة | متوسط | البنية جاهزة (`publicHandlers` + sitemap)؛ بدون محتوى حقيقي ستكون doorway pages — لذلك لم أنشئها. |
| 2 | **قرار CSP/الخطوط**: إمّا السماح بـ `fonts.googleapis.com`/`fonts.gstatic.com` في CSP (فتُحمَّل الخطوط لأول مرة — راقب LCP) أو **استضافة Tajawal ذاتياً** مع `font-display: swap` وsubset عربي (الأفضل أداءً). كذلك سكربت الوضع الداكن المضمّن محجوب — انقله إلى ملف JS أو أضف hash. | متوسط (هوية + أداء) | عالية (مُتحقق محلياً) | منخفض | لم أغيّر CSP لأنه قرار أمني/منتجي. |
| 3 | **Hydration حقيقي أو إبقاء اللقطة حتى جاهزية الـ SPA** على `/r/{slug}` (بدلاً من استبدالها بالمحمّل): يلغي وميض "محتوى → محمّل → منيو" على الروابط المباشرة. | متوسط (UX/LCP) | متوسطة | متوسط–عالٍ | يتطلب `hydrateRoot` مع توافق المخرجات أو حاوية لقطة منفصلة يزيلها التطبيق عند READY. |
| 4 | **تقسيم كود إضافي**: فصل `SaaSLandingPage` عن حزمة منيو المطعم (والعكس) و`qrcode`/`canvas-confetti` عند الطلب؛ فحص الـ chunk المشترك `clock-*` (107 kB). | متوسط | عالية | منخفض–متوسط | مكسب إضافي ~50–80 kB gzip لصفحة المنيو. |
| 5 | **صور المنيو**: التأكد من أبعاد/`srcset`/تنسيق WebP من مسار الرفع (Supabase transform) وأن صورة الغلاف أعلى الصفحة تحمل `fetchpriority="high"` في الـ SPA كما في اللقطة. | متوسط (LCP) | متوسطة | متوسط | يحتاج قياساً ميدانياً أولاً. |
| 6 | **`lastmod` للصفحة الرئيسية والدليل من طابع نشر فعلي** (مثلاً وقت آخر build عبر متغير بيئة) بدل إغفاله. | منخفض | عالية | منخفض | أُغفل حالياً لعدم وجود مصدر حقيقي. |
| 7 | **نطاقات مخصصة للمطاعم** (`customDomain` موجود في المخطط بلا تنفيذ): عند تنفيذه يجب أن تصبح canonical صفحة المطعم نطاقه الخاص وأن يُعدَّل `handleCanonicalHostRedirect` (لا يلمس المضيفين المجهولين حالياً عمداً). | منخفض الآن | عالية | عالٍ | مذكور لتجنّب مفاجآت مستقبلية. |
| 8 | **تقييمات حقيقية** → `aggregateRating` فقط عند وجود نظام مراجعات فعلي مرئي على الصفحة. | متوسط | عالية | عالٍ | لا تُضف قبل ذلك. |
| 9 | **بطاقة مشاركة مركّبة لكل مطعم** (شعار + اسم + عدد الأصناف فوق خلفية المنصة) للمطاعم التي لا تملك غلافاً؛ تُولَّد عند الطلب في `/api/og?type=venue&slug=` مع cache. | منخفض–متوسط (CTR مشاركة روابط المطاعم) | عالية | متوسط | يحتاج مكتبة تصيير على السيرفر (`@resvg/resvg-js` ≈ 10 MB native) — لذلك لم أضفها كتبعية الآن؛ المطاعم بلا صور ترث بطاقة المنصة حالياً. |

---

### ملحق — خريطة الكود

```
server/index.ts                 ← ترتيب التركيب (host redirect → sitemap/robots/og → /restaurants → /r/:slug → static → fallback 404)
server/seo/platformSeo.ts       ← الأصل، canonicalUrl، escapeXml، buildSitemapXml، STATIC_ENTRIES، robots.txt (بلا Prisma)
server/seo/publicCatalog.ts     ← القراءة الوحيدة من Prisma + سياسة الفهرسة + cache
server/seo/publicPages.ts       ← head/JSON-LD/لقطة/دليل/قشور 404-503 (دوال نقية)
server/seo/publicHandlers.ts    ← معالجات Express
server/seo/ogImage.ts           ← PLATFORM_OG_IMAGE_PATH + معيد توجيه /api/og القديم
public/og-image.png             ← بطاقة المشاركة 1200×630 (أصول العلامة فقط)
index.html                      ← علامات seo:head + بيانات الرئيسية
src/components/customer/CustomerLayout.tsx   ← وضع التصفح بلا طاولة
src/components/common/SaaSLandingPage.tsx    ← قسم التعريف #about + روابط المطاعم + الدليل
src/App.tsx                     ← تقسيم كود شاشات الإدارة
src/tests/seo-public-pages.test.ts, seo-host-redirect.test.ts, seo-platform.test.ts, seo-production.test.ts, landing-crawlable-content.test.tsx
docs/SEO_PLATFORM.md            ← التوثيق المعماري المحدّث
```
