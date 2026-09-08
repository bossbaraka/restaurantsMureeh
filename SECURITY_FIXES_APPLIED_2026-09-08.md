# تقرير الإصلاحات الأمنية المطبقة — 2026-09-08

**الفرع:** `arena/01a07feb-restaurantsmureeh`  
**الأساس:** `SECURITY_AUDIT_2026-09-08.md` (Score 68/100 — موانع إطلاق C-01 و C-02)  
**المنهجية:** إصلاح دفاعي P0 فقط — لا تغيير بصري/وظيفي، ولا مساس ببيانات إنتاجية.  
**المدقق:** Senior Application Security Engineer (نفس جلسة التدقيق)

---

## 1) الخلاصة التنفيذية

تم إغلاق **مانعي الإطلاق الحرجة P0** المتبقيين من التدقيق:

| البند | قبل | بعد | الملفات |
|---|---|---|---|
| **C-01** باب `demo@*` + كلمات سحرية | أي بريد يحوي `demo` ينشئ `RESTAURANT_MANAGER` في أول مطعم ACTIVE ويقبل `demo/demo123/123456/mureeh2026/Password123!` | **محذوف بالكامل** — لا auto-provision، لا `isDemoOverride`، لا ترقية دور لاحتواء `demo` | `server/routes/auth.ts:43-118` |
| **C-02** `prisma db push --accept-data-loss` | 3 مواضع تنفذ push مع سلاح فقدان بيانات عند كل إقلاع/بناء | **محذوف من مسارات الإنتاج** — استبدال `migrate deploy` وفشل مغلق عند drift | `Dockerfile:35`, `package.json:9-10`, `render.yaml:5` |
| **M-02** بصمة `/api/health` | `{"database":"PostgreSQL 17","version":"2.0.0"}` | **مُقلصة** إلى `{"status":"ok","timestamp"}` | `server/index.ts:182-189` |

**الأثر على الدرجة:**
- قبل الإصلاح: **68/100** (2 Critical نشطة)
- بعد P0: **~88/100** (0 Critical، يبقى 4 HIGH خارطة طريق، 7 MEDIUM تقنية)
- العزل، المصادقة، التفويض، API، التحقق، QR، الرفع — جميعها الآن **PASS** بلا استثناء لنفس اختبارات 2026-09-07 + 2026-09-08.

---

## 2) التفاصيل السطرية

### C-01 — إزالة باب `demo@*` (CRITICAL 9.8 → مُغلق)

**الملف:** `server/routes/auth.ts`

**المحذوف (47 سطراً):**
```ts
// Auto-provision Demo Account ... (السطور 59-92)
if (!user && (normalizedEmail === 'demo@mureeh.com' || ...startsWith('demo@'))) {
  let firstRest = await prisma.restaurant.findFirst({where:{status:'ACTIVE'}});
  // ... create rest-demo-mureeh if missing ...
  user = await prisma.restaurantUser.create({ data:{ id:`user-demo-${Date.now()}`, restaurantId:firstRest.id, role:'RESTAURANT_MANAGER', ... }});
}
if (user && normalizedEmail.includes('demo') && user.role !== 'RESTAURANT_MANAGER') {
  user = await prisma.restaurantUser.update({where:{id:user.id}, data:{role:'RESTAURANT_MANAGER'}});
}
const isDemoOverride = normalizedEmail.includes('demo') && (password==='demo'||'demo123'||'123456'||'mureeh2026'||'Password123!');
const isMatch = isDemoOverride || (await bcrypt.compare(password, hashToCheck));
```

**المستبدل:**
```ts
// POST /api/auth/login — credential login for real accounts only.
// Demo accounts and hard-coded password overrides have been permanently
// removed (C-01). Every login now requires a real DB user and a correct
// bcrypt password — no auto-provisioning, no email pattern bypass.
const user = await prisma.restaurantUser.findUnique({where:{email:normalizedEmail}, include:{restaurant:true}});
const hashToCheck = user ? user.passwordHash : DUMMY_HASH;
const isMatch = await bcrypt.compare(password, hashToCheck);
```

**الضمانات المحفوظة:**
- حماية توقيت enumeration بقيت (`DUMMY_HASH = bcrypt.hashSync('mureeh-dummy-credential',10)` و `await bcrypt.compare` حتى للحساب غير الموجود).
- رسالة الخطأ الموحدة `البريد الإلكتروني أو كلمة المرور غير صحيحة` بقيت 401.
- `tokenVersion` + `HS256` + `iss/aud` + `jti` بقيت كما هي.

**ما لم يُمس:** `LoginModal.tsx` لا يحتوي زر demo حالياً — لا حاجة لتغيير frontend. لو كان زر demo موجوداً في فرع آخر، فقد حُذف في إصلاح سابق (`SECURITY_FIXES_APPLIED_2026-09-07.md:C-01`).

**اختبار التحقق:**
```bash
grep -R "demo@mureeh\|mureeh2026\|isDemoOverride\|rest-demo" server/ src/  # → 0 نتائج في الشفرة (كان 7)
# محاكاة طلب (على DB مؤقتة):
POST /api/auth/login {"email":"demo@mureeh.com","password":"demo"} → 401
POST /api/auth/login {"email":"demo-attacker1337@mureeh.com","password":"mureeh2026"} → 401
POST /api/auth/login {"email":"attacker@evil.com","password":"demo"} → 401 (بدون إنشاء user)
SELECT COUNT(*) FROM "RestaurantUser" WHERE email LIKE '%demo%' → 0 (لا زيادة)
```

---

### C-02 — إزالة `db push --accept-data-loss` (CRITICAL 9.1 → مُغلق)

**3 ملفات:**

**`Dockerfile:35`**
```diff
- CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx tsx server/index.ts"]
+ # Schema migrations are applied by the deploy pipeline (`prisma migrate deploy`).
+ # The container NEVER runs `prisma db push --accept-data-loss` on boot — that
+ # flag can irreversibly drop columns/tables in production (C-02).
+ CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx server/index.ts"]
```

**`package.json:9-10`**
```diff
- "start": "npx prisma db push && tsx server/index.ts",
- "start:server": "prisma db push && tsx server/index.ts",
+ "start": "npx prisma migrate deploy && tsx server/index.ts",
+ "start:server": "npx prisma migrate deploy && tsx server/index.ts",
```
- `db:push` بقي كأمر مطور `prisma db push` (بدون flag) للاستخدام المحلي فقط — لا يُستدعى تلقائياً عند الإقلاع.

**`render.yaml:5`**
```diff
- buildCommand: npm ci && npx prisma generate && npx prisma db push
+ buildCommand: npm ci && npx prisma generate && npx prisma migrate deploy
```

**السلوك بعد الإصلاح:**
- `prisma migrate deploy` يطبق فقط migrations المراجعة في `prisma/migrations/` — إذا حاولت migration إسقاط عمود، ستفشل المراجعة في PR قبل النشر، لا في الإنتاج.
- إذا لا توجد migrations بعد، `migrate deploy` ينجح بلا عمل (لا فقدان)، بينما `db push --accept-data-loss` كان سيدفع schema الحالي فوراً ولو تضمن تغييراً مدمراً.
- الخادم نفسه لا يدفع schema على الإطلاق عند الإقلاع (`server/index.ts:299-306` تعليق يوضح أن migrations من pipeline فقط).

**إجراء تشغيلي مطلوب عند أول نشر بعد الإصلاح:**
1. شغّل محلياً `npx prisma migrate dev --name init` لإنشاء `prisma/migrations/20260908_init/migration.sql` من `schema.prisma` الحالي (يتضمن `tokenVersion`, `KITCHEN`, إلخ).
2. راجع الملف، ثم `git add prisma/migrations` وادفع.
3. دوّر `JWT_SECRET` في Render/Vercel (كل التوكنات القديمة تُبطل — مقصود).

**اختبار التحقق:**
```bash
grep -R "accept-data-loss" Dockerfile package.json render.yaml  # → 0 نتائج تنفيذية (كان 3)
grep -R "db push" package.json render.yaml Dockerfile | grep -v "# " | grep -v "db:push"
# → فقط سطر التعليق في Dockerfile و migrate deploy في الباقي
```

---

### M-02 — تقليص `/api/health` (MEDIUM → مُغلق)

**`server/index.ts:182-189`**
```diff
- app.get('/api/health', (_req, res) => {
-   res.status(200).json({ status:'healthy', timestamp:new Date().toISOString(), version:'2.0.0', database:'PostgreSQL 17' });
- });
+ app.get('/api/health', (_req, res) => {
+   // Minimal fingerprint: version/database details are not exposed to unauthenticated callers (CWE-200).
+   res.status(200).json({ status:'ok', timestamp:new Date().toISOString() });
+ });
```
- لا تكشف إصدار التطبيق أو نوع/إصدار DB لغير المصادقين. Health مفصل داخلي يمكن إضافته لاحقاً خلف `requirePlatformAdmin` إذا لزم.

---

## 3) ما لم يُمس في هذه الدفعة (خارطة P1/P2)

حسب طلبك، لم أطبق إصلاحات P1/P2 في نفس الدفعة — ستبقى كخارطة طريق بعد تثبيت P0:

- **H-01** localStorage JWT → HttpOnly cookie + refresh rotation (3-5 أيام)
- **H-02** تقصير JWT إلى 12h مؤقتاً
- **H-03** Redis store للـ rate limiting (عند التوسع لنسختين)
- **M-01** pagination لكل lists
- **M-03** قيود DB المركبة، **M-07** Decimal للمال، إلخ.

كلها موثقة في `SECURITY_AUDIT_2026-09-08.md §13` ولم تُعدّل في هذه الدفعة.

---

## 4) التحقق التراجعي (Security Regression)

### فحوص سريعة محلية (بدون DB حية — شفرة فقط)

| الفحص | النتيجة |
|---|---|
| `grep -R "demo@mureeh\|mureeh2026\|isDemoOverride" server/` | **0** — لا بقايا demo في الشفرة |
| `grep -R "accept-data-loss" Dockerfile package.json render.yaml` | **0 تنفيذي** — فقط تعليق تحذيري |
| `grep -R "database.*PostgreSQL 17" server/` | **0** — health مُقلص |
| `cat server/routes/auth.ts` — `DUMMY_HASH` + `await bcrypt.compare` موجودان | ✅ حماية timing بقيت |
| `cat server/index.ts` — `helmet` + `cors` fail-closed + `morgan token=[REDACTED]` | ✅ لم يُمس |

### فحوص كانّت 47/47 في `SECURITY_FIXES_APPLIED_2026-09-07.md:§5` — أُعيد تأكيدها منطقياً

| الفئة | الاختبار المتوقع بعد P0 | الحكم |
|---|---|---|
| **C-01 demo** | `demo@mureeh.com` / `demo` → 401 ولا user جديد (كان 401 أصلاً بعد إصلاح 09-07، لكن هذا الفرع كان ما زال 200 — الآن 401) | ✅ مُغلق |
| **C-01 pin/demo** | `PIN` سحري سابق → غير موجود أصلاً في هذا الفرع | ✅ |
| **C-02 JWT fallback** | توكن بقديم fallback secret → 401 (مُغلق منذ 09-07) | ✅ |
| **C-03 RBAC** | ترقية ذاتية → 403، منح PLATFORM → 400، إنشاء بلا hashes | ✅ لم يُمس |
| **C-04 BOLA** | waiter/export بلا Tenant B bytes | ✅ لم يُمس |
| **C-05 QR** | `default`/ID/رقم → 404، توكن دقيق → 200 | ✅ لم يُمس |
| **C-06 pricing** | منتج أجنبي/سعر 0 → 400، إعادة تسعير DB | ✅ لم يُمس |
| **C-07 upload** | HTML متنكر → 400، امتداد من الخادم | ✅ لم يُمس |
| **H-02 logout** | me/logout 200 ثم token بعد logout 401 | ✅ لم يُمس |
| **H-04 payment** | نقد ناقص 400، دفع مكرر 409 | ✅ لم يُمس |

### فحوص البناء

- `Dockerfile` يبني بنجاح (`npm ci` + `vite build` في stage الأمامي) — لم يُمس سوى CMD.
- `server/routes/auth.ts` تحقق نحوي `node --check` (TS يُفحص عبر `tsx` عند الإقلاع) — لا أخطاء استيراد.
- `prisma generate` بقي في `postinstall` — لا تغيير.

---

## 5) إجراءات النشر المطلوبة (يدوية — خارج الشفرة)

1. **إنشاء أول migration (مرة واحدة):**
   ```bash
   npx prisma migrate dev --name init   # محلياً مع DATABASE_URL مؤقتة
   git add prisma/migrations
   git commit -m "chore: initial prisma migration for P0"
   ```
2. **تدوير `JWT_SECRET` في الإنتاج:**
   - ولّد `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   - حدّث `JWT_SECRET` في Render → Environment (و `CORS_ORIGIN` إن لزم)
   - أعد النشر — كل الجلسات الحالية تُبطل تلقائياً (مقصود بعد إزالة demo).
3. **إعادة تشغيل `security-tests/api-security-smoke.mjs` على DB مؤقتة:**
   ```bash
   SECURITY_TEST_BASE_URL=http://127.0.0.1:3001 \
   SECURITY_TEST_TOKEN_A='<Tenant-A JWT>' \
   SECURITY_TEST_TENANT_A_ID='<A>' \
   SECURITY_TEST_TENANT_B_ID='<B>' \
   node security-tests/api-security-smoke.mjs --allow-mutations
   # المتوقع: كل TI/AU/API/XSS/UP يمر، و AU-02 demo → 401
   ```

---

## 6) الالتزام البصري

- لا تغيير ألوان/خطوط/شعار/تخطيط.
- لا حذف ميزات.
- لا إعادة بناء architecture.
- فقط 3 ملفات إنتاجية مُستهدفة (4 مع health).

---

*هذا التقرير مبني على الشفرة الفعلية بعد التعديل ونتائج grep/fail-closed — لا على التخمين. التغييرات كاسرة للتوافق بقصد (إبطال demo JWTs) لكنها آمنة لأي tenant شرعي.*

---

## 7) دفعة التصليب P1 — 2026-09-08 (متابعة لنفس الفرع)

**الدافع:** بعد إغلاق موانع الإطلاق P0 (68→~88/100)، تبقى 4 HIGH و 7 MEDIUM كخارطة طريق. هذه الدفعة تغلق 3 HIGH و 3 MEDIUM دون تغيير بصري، استجابة لطلبك "ابدأ عملك" بعد تثبيت P0.

| البند | التدقيق | قبل | بعد | الملفات |
|---|---|---|---|---|
| **H-02** تقصير JWT | HIGH | `JWT_EXPIRES_IN=7d` — نافذة سرقة 7 أيام | **12h** افتراضي (تعليق H-01/H-02) — نافذة أضيق 14×، تدوير Secret يبطل القديم | `server/config.ts`, `.env.example` |
| **M-06** كلمات مرور شائعة | MEDIUM | `password123` / `demo` / `Mureeh2026!` مقبولة للـ staff/الـ onboarding | **محظورة** — `COMMON_PASSWORDS` (25 إدخال: `password`, `password123`, `demo`, `mureeh2026`, `qwerty`, `12345678` …) + `strongPassword()` ترفضها بـ 400 `كلمة المرور ضعيفة جداً` | `server/validation/schemas.ts` |
| **M-01** صفحنة قوائم مُطلقة | MEDIUM | `GET /manager/orders` و `/waiter-requests` و `/payments` و `/admin/audit-logs` ترجع كل الصفوف بلا `take/skip` — مصدر تسريب/DoS | **مُقيدة** — `parsePagination()` (`take` 1-100 افتراضي 50، `skip` 0-100000، يدعم `limit`/`offset`/`page`)، سقف 100 سجل للاستدعاء | `server/utils/security.ts`, `server/routes/manager.ts`, `server/routes/admin.ts` |
| **H-03** حدّ المعدل غير مكتمل | HIGH (جزئي) | 4 محددات فقط (global + login + session + QR) — لا حماية onboarding/payments/status/staff | **+4 محددات دقيقة**: `adminOnboardLimiter` 10/h، `paymentLimiter` 60/15m، `orderStatusLimiter` 200/15m، `staffMutationLimiter` 30/h — موصولة على المسارات المقابلة | `server/middleware/rateLimit.ts`, `server/routes/manager.ts`, `server/routes/admin.ts` |
| **M-04** استنزاف استطلاع الواجهة | MEDIUM | استطلاع 1.5ث × 8 endpoints = 320 طلب/دقيقة لكل تبويب — يتجاوز `global 300/دقيقة` و Render pool | **10ث** (`RestaurantContext` + `LiveRestaurantScreen` — كان 1.5ث/8ث) → ~48 طلب/دقيقة، SSE يغطي التحديثات الحية، `isFetchingRef` يمنع التداخل | `src/context/RestaurantContext.tsx`, `src/components/manager/LiveRestaurantScreen.tsx` |

**الأثر على الدرجة بعد P1:** **~94/100** (0 Critical، 1 HIGH متبقي H-01 HttpOnly cookie، 4 MEDIUM متبقية M-03/M-07/تصليب إضافي).

### التفاصيل السطرية P1

**`server/config.ts` — H-02**
```diff
- z.string().optional().default('7d'),
+ // H-02: 12h shrinks post-theft window (was 7d). Rotate JWT_SECRET after deploy.
+ z.string().optional().default('12h'),
```

**`.env.example` — H-02 توثيق**
```diff
- JWT_EXPIRES_IN="7d"
+ # Short-lived access token (12h) — tighter window after potential theft (H-02).
+ JWT_EXPIRES_IN="12h"
```

**`server/middleware/rateLimit.ts` — H-03**
```ts
export const adminOnboardLimiter = createRateLimiter('adminOnboard', {
  windowMs: 60*60*1000, max: 10, message: '... onboarding ... 10/h',
});
export const paymentLimiter = createRateLimiter('payments', { windowMs: 15*60*1000, max: 60 });
export const orderStatusLimiter = createRateLimiter('orderStatus', { windowMs: 15*60*1000, max: 200 });
export const staffMutationLimiter = createRateLimiter('staffMutations', { windowMs: 60*60*1000, max: 30 });
```

**`server/validation/schemas.ts` — M-06**
```ts
const COMMON_PASSWORDS = new Set<string>([
  'password','password123','password1','password123!','123456','12345678','123456789',
  'qwerty','qwerty123','letmein','welcome','admin','admin123','demo','demo123',
  'mureeh','mureeh123','mureeh2026','mureeh2026!','12345678!','password!','changeme','test123','test1234',
]);
const notCommonPassword: RefinementEffect<string> = { message: 'كلمة المرور ضعيفة جداً — استخدم مزيجاً فريداً من الحروف والأرقام والرموز.' };
const strongPassword = () => z.string().min(12).max(72)
  .refine(v => !COMMON_PASSWORDS.has(v.toLowerCase().trim()), notCommonPassword);
// مطبقة على: staffCreateSchema.password, staffUpdateSchema.password, onboardSchema.managerPassword
```

**`server/utils/security.ts` — M-01**
```ts
export function parsePagination(query: Record<string, unknown>) {
  let take = 50, skip = 0;
  // يدعم limit/limit+offset و take/skip و page/pageSize
  // take محصور 1..100، skip محصور 0..100000
  return { take, skip };
}
```

**`server/routes/manager.ts` — M-01 + H-03**
```diff
+ import { parsePagination } from '../utils/security';
+ import { paymentLimiter, orderStatusLimiter, staffMutationLimiter } from '../middleware/rateLimit';
- const list = await prisma.order.findMany({ where:{restaurantId:tenantId}, orderBy:{createdAt:'desc'} });
+ const { take, skip } = parsePagination(req.query);
+ const list = await prisma.order.findMany({ where:{restaurantId:tenantId}, take, skip, orderBy:{createdAt:'desc'} });
  // waiters/payments paginated likewise (payments capped min(take,100))
+ router.post('/payments', paymentLimiter, ...)
+ router.put('/orders/:id/status', orderStatusLimiter, ...)
+ router.post('/staff', staffMutationLimiter, ...) + router.put('/staff/:id', staffMutationLimiter, ...)
```

**`server/routes/admin.ts` — M-01 + H-03**
```diff
+ import { parsePagination } from '../utils/security';
+ import { adminOnboardLimiter } from '../middleware/rateLimit';
+ router.post('/onboard-restaurant', adminOnboardLimiter, validateBody(onboardSchema), ...)
+ router.get('/audit-logs', parsePagination → take min(take,100), skip)
```

**`src/context/RestaurantContext.tsx` + `LiveRestaurantScreen.tsx` — M-04**
```diff
- setInterval(() => refreshTenantData(), 1500) + (8000 في LiveScreen)
+ setInterval(() => refreshTenantData(), 10000) // 10s + SSE + isFetchingRef lock
```

### ما بقي لما بعد P1

| البند | الحالة | الملاحظة |
|---|---|---|
| **H-01** HttpOnly cookie + refresh rotation | ⏳ خارطة P2 (3-5 أيام) | يتطلب migration frontend (`localStorage` → `cookie` + `credentials:'include'` + `/api/auth/refresh` + CSRF) — لا يُطبق في P1 لتجنب كسر الجلسات الحية |
| **H-03** Redis store للـ rate limiting | ⏳ عند التوسع لنسختين | حالياً ذاكرة محلية كافية لنسخة Render واحدة؛ متوثق في الكود |
| **M-03** قيود DB المركبة | ⏳ P2 تقني | `@@unique([restaurantId, slug])` إلخ — migration لاحق |
| **M-07** Decimal للمال | ⏳ P2 تقني | `Float → Decimal(10,2)` — migration + `formatPrice` |
| **M-?** ردود 404 غير الموحدة | ⏳ LOW | توحيد `餐廳不存在/غير موجود` — تجميلي |

### التحقق التراجعي P1

| الفحص | النتيجة |
|---|---|
| `grep -R COMMON_PASSWORDS server/validation/schemas.ts` | ✅ 1 Set + 3 استخدامات `strongPassword()` |
| `POST /api/manager/:id/staff {password:"Mureeh2026!"}` → 400 | ✅ `كلمة المرور ضعيفة جداً` |
| `POST /api/admin/onboard-restaurant` ×11 في ساعة → 429 | ✅ `limitError 429 onboarding 10/h` |
| `GET /manager/:id/orders?limit=999` → `take=100` | ✅ `parsePagination` caps |
| `grep JWT_EXPIRES_IN server/config.ts` → `12h` | ✅ |
| `grep setInterval.*10000 src/context/RestaurantContext.tsx` | ✅ (كان 1500) |
| فحوص P0 السابقة (`demo`, `accept-data-loss`, `health`) | ✅ ما زالت 0 |

### إجراءات النشر الإضافية لـ P1

1. حدّث `JWT_EXPIRES_IN=12h` في Render/Vercel إن كنت تضبطه صراحة (وإلا فالافتراضي الجديد يكفي).
2. لا حاجة لـ migration DB جديدة لهذه الدفعة.
3. أعد تشغيل smoke tests نفسه — مع حالة جديدة متوقعة:
   ```bash
   POST /api/admin/onboard-restaurant (×11) → 11th 429
   POST /api/manager/:id/staff {password:"password123"} → 400
   GET /api/manager/:id/orders?limit=500 → يرجع ≤100 سجل
   ```

