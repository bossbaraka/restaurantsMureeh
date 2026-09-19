# IMPLEMENTATION_PLAN — Master Remediation & Release Hardening (2026-09-19)

**Baseline:** TEST1–4 + PRE_REMEDIATION report (كلها CONDITIONAL PASS). Verified against code this session: compression() default filter at `server/index.ts:114` (SSE gzip root cause), `Order.tableId` NOT NULL (`schema.prisma:380`) + `'__WALKIN__'` literal passed as FK (`manager.ts:601,711`), staff create accepts derived passwords (`manager.ts:2416-2424`), `/auth/pin` 4–10 digits + first-match (`auth.ts:295-415`), PIN-switch identity in `/auth/login` (`auth.ts:113-134`).

## Files likely to change
| النطاق | الملفات |
|---|---|
| Schema/Migrations | `prisma/schema.prisma` + `prisma/migrations/202609191*_employee_auth/`, `..._order_source/` (مكتوبة يدوياً — sandbox يمنع schema-engine) |
| Backend auth | `server/routes/auth.ts` (login hardening + employee-login + step-up + حذف /pin)، `server/middleware/auth.ts` (stepUp middleware)، `server/middleware/rateLimit.ts` (employeeLoginLimiter)، `server/validation/schemas.ts` (employeeLogin/username/pin6/weak-pin)، `server/routes/manager.ts` (staff create/update: username+pin6+no-derived-password+step-up) |
| Walk-in | `prisma/schema.prisma` (Order.tableId? + orderSource)، `server/routes/manager.ts:601-790` (create: tableId null + orderSource COUNTER)، عناوين KDS/الطلبات "عميل مباشر" |
| SSE | `server/index.ts:114` (compression filter يستثني text/event-stream) |
| Hooks | `src/components/customer/CustomerLayout.tsx:300-345` (نقل الـ hooks فوق early return — بلا eslint-disable) |
| Frontend auth | `src/components/auth/LoginModal.tsx` (رمز المطعم + اسم المستخدم + PIN — إسقاط القائمة العامة)، `src/components/manager/StaffManagement.tsx` (username + PIN 6 + منع Staff-{PIN}! + step-up)، StepUpModal جديد، idle timeout في `ManagerLayout.tsx`، `src/context/AuthContext.tsx` (employeeLogin + 401 interceptor مركزي)، `src/services/api.ts` |
| Tests | إصلاح `src/tests/product-image-persistence.integration.test.ts` (envelope) + `transfer-details.integration.test.ts` (parser)، جديد: `employee-auth.integration.test.ts`، `walkin-pos.integration.test.ts`، `sse-gzip.test.ts` (unidici streaming)، تحديث seed/fixtures |
| CI/DevOps | `.github/workflows/ci.yml` (install→lint→typecheck→build→unit→DB integration مع خدمة postgres)، `docker-compose.yml` (STORAGE_ALLOW_LOCAL_IN_PROD + volume)، graceful shutdown في `server/index.ts`، تعقيم أسرار الأدلة، README، cache-control للصور |

## Database changes (reversible, non-destructive)
1. `RestaurantUser`: +`username`(unique per tenant, nullable للترحيل) +`failedAuthCount`/`authLockedUntil`/`lastAuthFailAt` (ميزانية خطأ لكل حساب — AUTH-02)؛ `email` → nullable (الموظفون بلا بريد اصطناعي)؛ backfill: username = local-part للبريد الحالي (+لاحقة عند التصادم)؛ **إبطال كل PINs القديمة** (كانت 4 أرقام والسياسة الجديدة 6 — لا يمكن قراءتها من bcrypt، يعيد المديرون الإصدار) — قبل الإطلاق بلا مستخدمين إنتاج.
2. `Order`: `tableId` → nullable + `orderSource` TEXT default 'TABLE' (WALK-IN = tableId null + 'COUNTER') — العلاقات/الإيصالات/التقارير محفوظة (settle-path يعالج walk-in أصلاً في :3727).

## Authentication migration strategy
- النموذج: رمز المطعم (= slug الموجود، معرّف عام أصلاً، يُحل خادمياً — صفر تغيير مخطط للمطاعم) + اسم مستخدم فريد/مستأجر + **PIN 6 أرقام** (قائمة ضعف صغيرة موثقة) → جلسة JWT كما هي (tv/HS256/iss/aud محفوظة).
- المديرون/المنصة: بريد + كلمة مرور قوية (كما هي — أقوى عمداً)؛ **حظر password login لأدوار الوردية** = قتل AUTH-01 من الجذر (هاشات Staff-{PIN}! تصبح بلا مسار استخدام).
- حذف: `/auth/pin` (فضاء 4 أرقام + أول مطابقة) وPIN-switch في login (AUTH-06) — البديل: دخول الموظف المباشر (أسرع للتبديل).
- Step-up: `POST /auth/step-up` (كلمة مرور للمدير/PIN للكاشير) → توكن 5 دقائق audience خاص؛ إلزامي لـ: void الدفع، تغيير دور/حالة/سر موظف، حذف موظف. لا step-up للعمليات الروتينية (فتح طلب/تسوية).
- Idle timeout (واجهة): 20 دقيقة للتبويبات الإدارية، معفى KDS/POS عمداً (موثق).

## Test strategy
Layer 1 lint/typecheck/build/unit (CI blocking) · Layer 2 real-PG integration (migrations ثم suites الموجودة + الجديدة: employee-auth/walkin/sse/brute-force) · Layer 3 SSE عبر undici streaming + gzip (proxy للمتصفح — لا متصفح في sandbox، يوثَّق) · Layer 4 restart/persistence probes. ثم إعادة TEST1–4 مكثفة + تقرير بوابة نهائي.

## Implementation order (dependency-safe)
1. Schema + migrations (يدوي) → 2. Backend auth (schemas→endpoints→manager staff) → 3. Walk-in → 4. SSE → 5. Backend tests + seed/fixtures → 6. Frontend (LoginModal→StaffManagement→StepUp→hooks→idle) → 7. CI + docker + shutdown + docs → 8. P3 → 9. Full regression → 10. TEST1–4 revalidation reports.

## Risk areas
- عزل المستأجرين في مسار employee-login الجديد (اختبارات عزل صريحة A≠B بنفس اسم المستخدم)
- تراجع UX لواجهة الدخول (نفس سرعة الوردية: 3 حقول قصيرة + رمز مطعم محفوظ محلياً)
- Nullable tableId: كل استعلامات tableId (129 موضعاً) تُراجع للمواضع الجوهرية (KDS/settle/analytics)
- تسكين CI مع اختبارات DB-gated (migrations في الخدمة قبل vitest)
- عدم كسر TEST2 probes القائمة (RBAC/QR/SSE isolation) — تُعاد كاملة
