# وصف النظام الشامل (System Description) — منصة مِيرار MÉRAR
### مرجع تدريب أدوات الذكاء الاصطناعي · أُعدّ بتاريخ 2026-09-11

---

## 0) أساس هذا الوصف (ما الذي تُثبته هذه الوثيقة فعلاً؟)

كل ما ورد هنا مُستخرَج من الكود الفعلي في هذا المستودع، ومن تشغيل حقيقي للنظام:

| البند | النتيجة | الدليل |
|---|---|---|
| اختبار وظائف الموظفين والصلاحيات (API حقيقي + PostgreSQL حقيقي) | **704/704 تأكيد ناجح** | `/tmp/e2e-final.log` + `e2e/employee-functional-test.mjs` |
| فحوص حماية الواجهة الأمامية (سلوكية على `AuthProvider` الحقيقي) | **6/6 ناجحة** | `e2e/frontend-guard.check.tsx` |
| اختبارات الوحدة/المكوّنات | **294 ناجح / 1 متخطّى** | `npm test` |
| فحص الأنواع + البناء الإنتاجي | ✅ ناجح | `npm run build` (`tsc -b && vite build`) |
| الفحص الساكن (lint) | ✅ 0 أخطاء | `npm run lint` |

**أخطاء حقيقية اكتُشفت وأُصلحت قبل هذا التوثيق (بتفصيل في نهاية الوثيقة):**
1. `B-1` فيض Int4 في تخصيص رقم الطلب — كان يُعطّل إنشاء الطلبات نهائياً لمستأجر واحد.
2. `B-2` دور `STAFF` محجوب عن مهامه الموثّقة (حالة الطلب/الطاولة/طلبات النادل).

---

## 1) ما هو النظام؟ (Business Overview)

**مِيرار (MÉRAR)** منصة SaaS متعددة المستأجرين (Multi-Tenant) لإدارة المطاعم والمقاهي والمخابز والطلب الرقمي:

- **الضيف (Guest):** يمسح رمز QR على الطاولة → تُفتح له جلسة مجهولة **بدون تسجيل حساب** → يتصفّح القائمة → يطلب → يتابع حالة طلبه لحظياً → ينادي النادل → يقيّم التجربة.
- **صاحب المطعم/المدير:** يدير القائمة والأقسام والعروض والطاولات والعمال والاشتراك والهوية البصرية والفروع.
- **الكاشير:** نقطة بيع (POS)، إنشاء فواتير، تسوية الطاولات، سجل الدفع والإيصالات.
- **النادل وطاقم الخدمة:** متابعة الطلبات، حالة الطاولات، وطلبات النادل.
- **المطبخ:** شاشة KDS لتحديث حالة التحضير فقط.
- **إدارة المنصة (Platform Admin):** إدارة المطاعم (تنشيط/إيقاف/تجربة مجانية/تسجيل مطعم جديد)، سجل التدقيق، حالة التخزين.

### نموذج العمل
اشتراكات شهرية/سنوية بخطط (`Plan`) لها حدود كمية (طاولات، أقسام، منتجات، فروع) ومزايا (`entitlements`) مثل `CAN_CREATE_BRANCH`, `CAN_USE_ANALYTICS`, `CAN_CUSTOM_BRANDING`, `CAN_EXPORT_REPORTS`, `CAN_USE_ADVANCED_FEATURES`.

---

## 2) الحزمة التقنية (Stack)

| الطبقة | التقنية |
|---|---|
| الواجهة | React 19 · Vite 8 · Tailwind 3 · عربي RTL · ثيم داكن فخم |
| الخادم | Node.js + Express 5 (TypeScript عبر `tsx`) |
| قاعدة البيانات | PostgreSQL 16/17 + Prisma 5.22 (24 موديل/جدول علائقي) |
| المصادقة | JWT (HS256, iss `mureeh-api`, aud `mureeh-app`) + Bcrypt (`passwordHash`) + رمز PIN مشفّر (4–10 أرقام) |
| التحقق | Zod 4 — كل الـ endpoints محميّة بمخططات صارمة (ترفض أي حقل غير معروف) |
| الرفع | Multer محلياً أو Supabase Storage (`STORAGE_DRIVER`) |
| اللحظية | Server-Sent Events (SSE) مقيّدة بغرفة الطاولة/المستأجر |
| الحماية | Helmet + CSP + CORS مغلق افتراضياً + تحديد معدل الطلبات لكل مسار + تدقيق `AuditLog` |
| النشر | Docker / docker-compose / Render / Netlify / Vercel |

### معمارية الطلب
```
الضيف/الموظف (React SPA)
        │  HTTPS / SSE
        ▼
Express API  ── authenticateToken ──► requireRole/Manager/Cashier/ServiceStaff/PlatformAdmin
        │                                    │
        │                         التحقق من تبعية المستأجر (deny + AuditLog عند التجاوز)
        ▼
Prisma ORM ──► PostgreSQL (Restaurant scoping على كل استعلام)
```

نقاط الدخول: `server/index.ts` (التجميع)، `server/routes/{auth,public,manager,admin,uploads}.ts`، الحمايات في `server/middleware/auth.ts` و`rateLimit.ts`.

---

## 3) نموذج البيانات (24 جدولاً)

**المستأجر والهوية:** `Restaurant` (slug, currency, language, timezone, ألوان العلامة, `businessType`, `logoFit/logoPosition`, `status`), `Branch` (فروع + ربط طاولات), `Offer`, `AuditLog`.

**المستخدمون والاشتراك:** `RestaurantUser` (دور, `pinHash`, `passwordHash`, `status`, `tokenVersion`, `lastLoginAt`), `Plan`, `Subscription` (`TRIAL/ACTIVE/PAST_DUE/CANCELLED/SUSPENDED`).

**القائمة:** `Category`, `Product` (سعر, وقت تحضير, سعرات, حساسية, مكونات قابلة للاستبعاد, `available`), `ProductOption`, `AddOn`.

**الخدمة:** `Table` (`qrToken`, `hasWaiterCall`, `zone`), `TableSession` (`sessionToken`, `expiresAt`), `Order` (`numericId`, `paymentStatus`, `sessionId`, `cashierId`, `settledAt`), `OrderItem` (لقطات الاسم/السعر وقت الطلب), `WaiterRequest`, `Payment` (`receiptNumber` فريد, `orderIds[]`, `cashierId`).

> ملاحظة مهمة للنماذج: معرّف الطلب يأخذ الشكل `#<رقم>` (مثال `#100231`) و`numericId` رقمي داخل نطاق Int4؛ حالات الطلب:
> `PENDING → PREPARING → READY → SERVED` (و`CANCELLED`)، وحالة الطاولة: `AVAILABLE | OCCUPIED | BILL_REQUESTED | RESERVED | MAINTENANCE`، وطلب النادل: `PENDING → ACKNOWLEDGED → RESOLVED | CANCELLED`.

---

## 4) الأدوار ومصفوفة الصلاحيات (مُستخرجة من الكود)

| الدور | الواجهات/التبويبات | الكتابة المسموحة | الممنوع جوهرياً |
|---|---|---|---|
| `PLATFORM_ADMIN` / `SUPER_ADMIN` | كل التبويبات + بوابة المنصة | كل مسارات `/api/admin/*` + تجاوز فحص الأدوار (العمليات تبقى مقيّدة بحدود المستأجر المُعلن) | لا صلاحيات داخلية إضافية غير موثّقة |
| `RESTAURANT_MANAGER` | 13 تبويباً كاملة | كل مسارات `/api/manager/*` ماعدا ما هو محجوز للمنصة | مسارات `/api/admin/*` → 403 |
| `CASHIER` | POS · الطلبات · الطاولات | إنشاء طلب POS, تسوية طاولة, إنشاء دفعة, قراءة القائمة/العروض | التحليلات, إدارة العمال, تعديل القائمة, الرفع, طلبات النادل |
| `WAITER` | الطلبات · الطاولات · طلبات النادل | تغيير حالة الطلب, تغيير حالة الطاولة (الحالة فقط), معالجة طلب النادل | POS, المدفوعات, تعديل حقول الطاولة البنيوية (رقم/سعة/منطقة) |
| `STAFF` | الطلبات · الطاولات · طلبات النادل | نفس نطاق النادل (`requireServiceStaff`) | POS, المدفوعات, القائمة, العمال, الرفع |
| `KITCHEN` | الطلبات (KDS) | تغيير حالة الطلب فقط | كل ما عدا ذلك — بما فيه تعديل الطاولة (403) |

**قواعد ثابتة:**
- `requireManager()` → الإحصاءات، إدارة القائمة/العروض/العمال/الفروع/الاشتراك/الهوية، تصدير الطلبات، إعادة توليد QR.
- `requireCashierOrManager()` → إنشاء الطلب، تسوية الطاولة، المدفوعات.
- `requireServiceStaff()` = مدير + كاشير + نادل + مطبخ + **موظف** → حالة الطلب، طلب النادل، حالة الطاولة.
- كل معالج يتحقق مرة ثانية من ملكية المستأجر للصف (`ownTenant`) قبل أي تعديل، وبلا ذلك يعيد **403** مع تسجيل `TENANT_ACCESS_DENIED`.
- الواجهة تُخفي ما لا يُسمح به (`ROLE_MANAGER_TAB_ACCESS`)، لكن **الحماية الفعلية على الخادم** — إخفاء الزر ليس أماناً.

---

## 5) مرجع الـ API الكامل (55 نقطة نهاية)

### أ) المصادقة `/api/auth`
| الطريقة | المسار | الحماية | الوظيفة |
|---|---|---|---|
| POST | `/login` | عام (محدود) | دخول بالبريد+كلمة المرور → JWT + بيانات المستخدم/المطعم |
| POST | `/pin` | عام (محدود) | دخول طاقم العمل برمز PIN داخل مستأجر محدد (`restaurantId` مطلوب) |
| GET | `/me` | JWT | إعادة قراءة المستخدم من قاعدة البيانات (التحقق عند الإقلاع) |
| POST | `/logout` | JWT | زيادة `tokenVersion` ⇒ إبطال كل الرموز السابقة |
| POST | `/password-reset-request` | عام | **غير مُنفّذ فعلياً (501)** — لا يُستخدم في التدريب كوظيفة قائمة |

### ب) العامة للضيف `/api/public`
`GET /restaurants` · `GET /restaurants/:slug` · `GET /tables/qr/:qrToken` · `POST /tables/qr/:qrToken/session` (فتح جلسة مجهولة) · `GET /tables/:tableId/orders` (يتطلب `restaurantId` + `sessionToken`) · `POST /orders` · `POST /orders/:orderId/cancel` · `PUT /orders/:orderId/notes` · `POST /waiter-requests` · `GET /events` (SSE، مقيّد بالمستأجر).

### ج) الإدارة `/api/manager`
- **إحصاءات:** `GET /dashboard/stats` (مدير فقط).
- **الطلبات:** `GET /orders` · `POST /orders` (كاشير+مدير) · `PUT /orders/:orderId/status` (كاشير/نادل/مطبخ/موظف/مدير) · `GET /export/orders` (مدير).
- **الطاولات:** `GET /tables` · `POST /tables` (مدير) · `PUT /tables/:id` (حالة للطاقم، حقول بنيوية للمدير فقط) · `POST /tables/:id/settle` (كاشير+مدير) · `POST /tables/:id/regenerate-qr` (مدير).
- **القائمة:** `GET/POST/PUT/DELETE /menu/categories` · `GET/POST/PUT/DELETE /menu/products` · `PUT /menu/products/:id/stock` (الكتابة للمدير).
- **الخدمة:** `GET /waiter-requests` · `PUT /waiter-requests/:id/status`.
- **العمال:** `GET/POST/PUT/DELETE /staff` (مدير، مع `staffMutationLimiter`).
- **العروض:** `GET/POST/PUT/DELETE /offers` · **الفروع:** `GET/POST/PUT/DELETE /branches` + `POST /branches/assign-tables` (تتطلب ميزة `CAN_CREATE_BRANCH` وحد الخطة) · **الاشتراك:** `GET /subscription` · `PUT /subscription/plan` · **الهوية:** `PUT /branding`.
- **الدفع:** `GET /payments` · `POST /payments` (كاشير+مدير، مع `paymentLimiter`).

### د) إدارة المنصة `/api/admin`
`GET /overview` · `POST /restaurants/:id/status` · `POST /restaurants/:id/activate-trial` · `POST /onboard-restaurant` · `GET /audit-logs` · `GET /storage-status` — كلها `requirePlatformAdmin`.

### هـ) الرفع `/api/uploads`
`POST /image` (مدير) · `POST /delete` (مدير؛ لا يُحذف إلا ملف يملكه نفس المستأجر).

> **شكل الاستجابة الموحّد:** نجاح `{ success: true, data: {...}, statusCode: 200 }` — خطأ `{ success: false, error: "رسالة عربية", statusCode: 4xx }`. لا تُسرّب الأخطاء أي أثر مكدّس أو تفاصيل قاعدة بيانات أو أسرار.

---

## 6) رحلات الاستخدام الأساسية (User Journeys)

**1. ضيف على الطاولة:** مسح QR → `GET /tables/qr/:token` → `POST .../session` (تنشئ `TableSession`) → تصفّح القائمة → `POST /orders` (الخادم يسعّر من قاعدة البيانات ويتجاهل أي سعر من المتصفح) → متابعة الحالة عبر SSE → `POST /waiter-requests` عند الحاجة → تسوية الكاشير → إغلاق الجلسة وتحديث الطاولة إلى `AVAILABLE`.

**2. كاشير (POS):** دخول → تبويب POS → اختيار الطاولة/الأصناف → `POST /orders` → عند التقديم `POST /tables/:id/settle` أو `POST /payments` (نقدي يتطلب `cashReceived` كافياً) → إيصال `RC-YYYY-NNNN` في سجل `Payment` داخل `$transaction` مع تحويل الطلبات إلى `PAID/SERVED`.

**3. نادل/موظف:** دخول (بريد أو PIN) → قائمة الطلبات → `PUT /orders/:id/status` → معالجة `PUT /waiter-requests/:id/status` → `PUT /tables/:id` (الحالة فقط).

**4. مطبخ:** شاشة KDS → تقدّم الطلب `PENDING → PREPARING → READY`.

**5. مدير:** إعداد القائمة والطاولات والعروض والعمال والهوية والاشتراك ومشاهدة التحليلات وتصدير الطلبات.

**6. إدارة المنصة:** `GET /overview` → تسجيل مطعم جديد (`onboard-restaurant`) أو تنشيط تجربة أو إيقاف مطعم → مراجعة `audit-logs`.

---

## 7) نموذج الأمان

- **جلسات:** JWT قصير (`JWT_EXPIRES_IN=12h`)، يُعاد التحقق من قاعدة البيانات في كل طلب (`status=ACTIVE` و`tv === tokenVersion`) ⇒ أي إيقاف حساب أو تسجيل خروج يُبطل الرموز فوراً.
- **العزل بين المستأجرين:** كل استعلام مقيّد بـ`restaurantId` من الـ JWT، وأي `restaurantId` من العميل يُقبل فقط لمستخدمي المنصة؛ محاولات التجاوز تُرفض (403/404) وتُسجَّل، وتم اختبارها بـ108 تأكيدات (جسم/استعلام/مسار/معرّف من مستأجر آخر).
- **قفل المصادقة:** حد أعلى للمحاولات الفاشلة (خادم + قفل واجهة 5 محاولات/60 ثانية) وحدود لكل مسار (دخول 20/15د، PIN 10، رفع 60/ساعة، طلبات عامة 120… إلخ).
- **الترويسات:** Helmet + CSP + `frame-ancestors` + CORS مغلق افتراضياً في الإنتاج + سقف جسم 1MB.
- **التدقيق:** `AuditLog` يوثّق تغييرات الحالة، إدارة العمال، محاولات الوصول المرفوضة… إلخ.

---

## 8) الخطط والحدود (Plan Limits & Entitlements)

يُفرض الحد على الخادم عند الإنشاء: عدد الأقسام، المنتجات، الطاولات، الفروع؛ وفوق الحد يعيد **403** مع رسالة ترقية. المزايا تقرر الميزات (التحليلات، الهوية، التصدير، الفروع). أُثبت ذلك بمرحلة اختبار مخصصة (منح/حد/ترقية) على مستأجر بخطة تجريبية.

---

## 9) التشغيل والنشر

```bash
# 1) تهيئة
cp .env.example .env         # اضبط DATABASE_URL و JWT_SECRET (32+ حرفاً) و CORS_ORIGIN
npm ci && npx prisma generate
npm run db:migrate           # ترحيلات idempotent (بدون تعديل مخطط يدوي)
npm run db:seed              # ينشئ خطة/حساب منصة (يفشل مغلقاً إن كانت كلمات المرور ضعيفة)

# 2) تطوير
npm run dev                  # الواجهة :5173 (proxy إلى :3001)
npm run server               # الـ API :3001

# 3) إنتاج
npm run build                # tsc -b && vite build  → dist/
npm start                    # ترحيل ثم تشغيل الخادم (يخدم dist/ أيضاً)
docker compose up -d --build # نشر كامل مع PostgreSQL
```

**متغيرات البيئة الأساسية:** `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `APP_URL`, `TRUST_PROXY`, `FRAME_ANCESTORS`, `STORAGE_DRIVER`/`UPLOAD_DIR`/`SUPABASE_*`, `PLATFORM_ADMIN_EMAIL/PASSWORD`, `BACKUP_ENABLED`, `SENTRY_DSN` (اختياري).

**الفحص الصحي:** `GET /api/health` → `{ status: "ok", timestamp }` (بلا أي تفاصيل داخلية).

---

## 10) الفحوص الجاهزة (للتحقق قبل كل إصدار)

```bash
npm test                                             # 294 اختبار وحدة/مكوّنات
npm run lint && npm run build                        # ساكن + أنواع + بناء
npx tsx e2e/employee-functional-test.mjs            # 704 تأكيد API شامل (يتطلب قاعدة اختبار + خادم)
npx vitest run --config e2e/vitest.guard.config.ts  # 6 فحوص حماية الواجهة
node security-tests/api-security-smoke.mjs           # فحص دخان أمني
```

---

## 11) قاموس المصطلحات (عربي ↔ إنجليزي) — مهم للتدريب

| عربي | إنجليزي/كود |
|---|---|
| مطعم / مستأجر | Restaurant / Tenant |
| فرع | Branch |
| قسم القائمة | Category |
| صنف / طبق | Product / Item |
| إضافة | AddOn |
| خيار الصنف | ProductOption |
| طاولة | Table |
| جلسة طاولة | TableSession |
| طلب | Order |
| طلب نادل / نداء | WaiterRequest / Waiter call |
| فاتورة / إيصال | Bill / Payment receipt |
| تسوية الطاولة | Settle table |
| نقطة البيع | POS (Cashier) |
| شاشة المطبخ | KDS (Kitchen Display System) |
| عرض ترويجي | Offer |
| اشتراك / خطة | Subscription / Plan |
| صلاحية/ميزة | Entitlement |
| سجل التدقيق | AuditLog |
| الواجهة الافتتاحية | Welcome / Splash screen |
| رمز الدخول للطاقم | PIN |
| المدير | RESTAURANT_MANAGER |
| الكاشير | CASHIER |
| النادل | WAITER |
| المطبخ | KITCHEN |
| موظف الخدمة | STAFF |
| إدارة المنصة | PLATFORM_ADMIN |

---

## 12) كيف تستخدم هذا الوصف لتدريب أدوات الذكاء الاصطناعي

**الاستخدامات المناسبة:**
1. **مساعد دعم عربي** يجيب عملاء المطاعم عن خطوات إدارة القائمة/الطاولات/الفواتير.
2. **وكيل عمليات (Agent)** يحوّل نية المستخدم إلى استدعاء API صحيح من الجدول أعلاه مع الدور الصحيح.
3. **مولّد سيناريوهات اختبار** يستنتج حالات الحافة من مصفوفة الصلاحيات ونموذج البيانات.
4. **مدقّق صلاحيات** يقارن طلباً مقترحاً بالقواعد (§4) ويرفض التجاوز.

**صيغة مقترحة لبيانات التدريب (JSONL):**
```json
{"messages":[{"role":"system","content":"أنت مساعد منصة مِيرار للمطاعم. تلتزم بمصفوفة الصلاحيات ولا تنفّذ عملية خارج نطاق دور المستخدم."},{"role":"user","content":"أنا الكاشير، كيف أُغلق فاتورة طاولة رقم 7؟"},{"role":"assistant","content":"افتح تبويب POS، اختر الطاولة 7، ثم «تسوية الطاولة»؛ استدعاء الخادم: POST /api/manager/tables/{tableId}/settle بجسم {\"paymentMethod\":\"CASH\"}. الدفع النقدي عبر POST /api/manager/payments يتطلب cashReceived ≥ الإجمالي، ويُصدر إيصالاً في السجل. أما تعديل القائمة أو إدارة العمال فخارج صلاحيتك (403)."}]}
```

**قواعد سلوك إلزامية للنموذج المُدرَّب:**
- لا تَعِد المستخدم بوظيفة غير موجودة (مثال: استعادة كلمة المرور غير مُنفّذة — 501).
- لا تقترح تعديلاً مباشراً في قاعدة البيانات؛ كل العمليات عبر API.
- وضّح دائماً: إخفاء الزر في الواجهة ليس تصريحاً؛ الخادم هو المرجع.
- عند طلب يتجاوز الدور، اذكر الرفض المتوقع (403) والدور المخوّل بدلاً من التنفيذ.
- لا تُصدر بيانات مستأجر آخر ولا معرّفات داخلية حسّاسة.

---

## 13) حدود معروفة (يجب تدريب النموذج عليها كـ«غير مسموح/غير موجود»)

1. **F-1 (غير مؤثر وظيفياً):** عند وجود بناء إنتاجي في `dist/`، أي `GET` على مسار `/api/*` غير موجود يُعاد كصفحة SPA (200 HTML) بدل JSON 404؛ طرق غير `GET` تُرجع 404 صحيح. الإصلاح المقترح: قصر الـ fallback على المسارات غير `/api`.
2. **`POST /api/auth/password-reset-request`** غير مُنفّذ (501).
3. **لا يوجد CI مُهيّأ** (`.github/workflows` غير موجود) — الفحوص تُشغَّل يدوياً بحسب §10.
4. **قيود بيئة الاختبار:** إنشاء عميل Prisma في هذه البيئة يعتمد على محوّل (adapter) اختباري فقط (`PRISMA_CLIENT_FORCE_WASM=1`)؛ هذا لا يخص كود المنتج في بيئات الإنتاج العادية.

---

## 14) الإصلاحات التي أُجريت في هذه الجلسة (للسجل)

| الرمز | الملف | المشكلة | الإصلاح |
|---|---|---|---|
| `B-1` | `server/routes/public.ts` + `server/routes/manager.ts` | تخصيص رقم الطلب كان يقرأ أي تسلسل أرقام من معرفات الطلبات، فمعرّف قديم مثل `order-legacy-<timestamp>` يدفع الرقم فوق نطاق Int4 ⇒ كل إنشاء طلب (POS وQR) يفشل بـ500 دائماً | يُعتمد فقط الشكل الذاتي `#<رقم>` مع تثبيت السقف عند 2,000,000,000 |
| `B-2` | `server/middleware/auth.ts` | دور `STAFF` ممنوع من مهامه الموثّقة (حالة الطلب/الطاولة/طلب النادل) رغم وجوده في الواجهة وفي قائمة `TABLE_STATUS_WRITE_ROLES` | أُضيف `'STAFF'` إلى `requireServiceStaff()` مع تحقق من النتيجة في قاعدة البيانات |

*(لم يُغيَّر أي مخطط قاعدة بيانات، ولم تُحذف بيانات حقيقية، ولم تُعدَّل المعمارية.)*
