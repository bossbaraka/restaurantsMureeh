# تحليل نظام الدفع + تدفق «تحويل بنكي / محفظة» حتى المطبخ

> هذا المستند يشرح: (1) تحليل نظام الدفع القائم كما هو في الكود، (2) التدفق المطلوب
> بعد التعديل، (3) ما تغيّر بالضبط (ملفًّا ملفًّا)، (4) ما لم يُلمس إطلاقاً.
> المرجع التقني التفصيلي للجزء الأمني/التخزيني في
> `docs/PAYMENT-PROOF-ARCHITECTURE-ANALYSIS.md`.

---

## 1) تحليل نظام الدفع القائم (قبل التعديل)

| الطبقة | ما هو موجود فعلاً |
| --- | --- |
| حالة الطلب (المطبخ) | `Order.status`: `PENDING → PREPARING → READY → SERVED` (نفس الانتقالات مفروضة على الخادم في `PUT /api/manager/orders/:id/status`) |
| حالة الدفع | `Order.paymentStatus` (نص، ليس enum): `UNPAID → PENDING_VERIFICATION → PAID`، والرفض يعيده إلى `UNPAID` مع `paymentRejectedAt` |
| الدفع عند الكاشير | `POST /api/manager/tables/:id/settle` و `POST /api/manager/payments` — مطالبة شرطية (compare-and-set) داخل معاملة + صف في دفتر `Payment` برقم إيصال لكل مطعم (CASH / CARD / MOBILE / SPLIT) |
| إشعار التحويل | `POST /api/public/orders/:orderId/payment-proof` (يتطلب جلسة QR) — صورة الإشعار تُخزَّن في مساحة خاصة (private) ولا يوجد لها رابط عام، ورقم الهاتف كان **اختيارياً** |
| شاشة الكاشير | `GET /api/manager/payment-verifications` — طابور التحقق (CASHIER / RESTAURANT_MANAGER فقط) + `GET /api/manager/orders/:orderId/payment-proof` لبثّ الصورة بعد فحص الملكية |
| القرار | `POST .../payment/confirm` أو `POST .../payment/reject` (تأكيد/رفض ذرّي واحد، 409 عند سباق جهازين) |
| البث اللحظي | SSE: `PAYMENT_PROOF_SUBMITTED` / `PAYMENT_PROOF_VERIFIED` / `PAYMENT_PROOF_REJECTED` + `ORDER_*` |

### الفجوات التي كانت تمنع التدفق المطلوب

1. **الطلب يدخل المطبخ فوراً** بمجرد إرساله (`status=PENDING`) حتى لو كان الزبون سيدفع
   بتحويل — أي أن المطبخ يطبخ قبل التحقق من المبلغ.
2. **التأكيد كان يقفز بالطلب إلى `SERVED`**: عند تأكيد الكاشير للحوالة كان الخادم يكتب
   `status: 'SERVED'` داخل نفس المطالبة، فيسجّل الطلب «مُسلَّم» ويختفي من شاشة المطبخ بلا
   تحضير — وهذا عكس المطلوب تماماً.
3. **هوية ناقصة**: لا يوجد حقل اسم عميل، ورقم الهاتف اختياري — فلا يستطيع الكاشير مطابقة
   الإشعار لشخص معيّن.
4. **لا تمييز بين بنك ومحفظة**: كل شيء يحمل وصف «حوالة بنكية».
5. **بطاقة التحقق عند الكاشير** كانت تعرض ملخّصاً نصياً فقط، لا أصناف الطلب نفسها.

---

## 2) التدفق بعد التعديل (خطوة بخطوة)

```
الزبون يطلب ويأكل/ينتظر  ──►  status=PENDING، paymentStatus=UNPAID
      │  (إشعار تلقائي للزبون: «هل ستدفع بتحويل بنكي أو محفظة؟ أرسل إشعار التحويل»)
      ▼
نافذة الإشعار: نوع التحويل (بنكي / محفظة) + اسم العميل* + رقم الهاتف* + صورة الإشعار
      │  POST /api/public/orders/:id/payment-proof   (جلسة QR فقط)
      ▼
paymentStatus = PENDING_VERIFICATION  ──►  الطلب «محجوز» عن المطبخ (لا يظهر في KDS)
      │  SSE: PAYMENT_PROOF_SUBMITTED  →  يظهر فوراً في شاشة الكاشير مع الطلب
      ▼
الكاشير يفتح البطاقة (الاسم + الهاتف + القناة + أصناف الطلب + صورة الإشعار) ثم:
   ├── تأكيد  →  POST .../payment/confirm
   │        • مطالبة شرطية واحدة: UNPAID/PENDING_VERIFICATION → PAID (مستحيل الدفع مرتين)
   │        • صف واحد في دفتر Payment بطريقة TRANSFER ورقم إيصال
   │        • حالة المطبخ لا تُلمس: PENDING تبقى PENDING
   │        • SSE: ORDER_STATUS_UPDATED (kitchenReleased=true) + PAYMENT_RECORDED
   │                + PAYMENT_PROOF_VERIFIED
   │        • النتيجة: الطلب يظهر في شاشة المطبخ فوراً بحالة «جديدة / جاهز للبدء فوراً»
   │          (بعدها: PREPARING → READY → SERVED كما كان)
   └── رفض    →  POST .../payment/reject  →  UNPAID + سبب الرفض، تختفي الصورة الخاصة
```

`*` الاسم والهاتف **إلزاميان** الآن: إشعار لا يمكن نسبته لشخص/رقم لا يمكن التحقق منه.

### ضمانات لم تتغير

* لا يوجد رابط عام لصورة الإشعار، والتحقق من الملكية (tenant) مرتين قبل البث.
* طريقة الدفع في الدفتر تبقى `TRANSFER` (لا تُقبل من الواجهة)، والمبلغ يُقرأ من الطلب لا من العميل.
* الرفض يعيد الطلب إلى `UNPAID` فقط، فتعمل كل مسارات التحصيل النقدي القديمة بلا تغيير.
* الطلب الذي بدأ المطبخ تحضيره (`PREPARING`/`READY`) **لا يُخفى ولا يُرجَع للخلف** أبداً.

---

## 3) الملفات التي تغيّرت

### قاعدة البيانات
* `prisma/schema.prisma` — `Order.customerName` و `Order.transferChannel` (نص، nullable).
* `prisma/migrations/20260914160000_add_transfer_customer_identity/migration.sql` —
  إضافي/idempotent (`ADD COLUMN IF NOT EXISTS`)، لا حذف ولا تعديل لبيانات قائمة.

### الخادم
* `server/validation/schemas.ts` —
  `customerNameSchema` (2..60 حرفاً، رفض محارف التحكم/الأقواس)، رقم الهاتف أصبح **مطلوباً**،
  و`transferChannelSchema` (BANK/WALLET، الافتراضي BANK).
* `server/routes/public.ts` — تخزين الاسم/القناة مع الإشعار، وبثّ القناة ضمن الحدث، ورسالة
  توضح أن الطلب ينتقل للمطبخ بعد التأكيد.
* `server/routes/manager.ts` —
  * الطابور يعيد `customerName`، `transferChannel`، `orderStatus`، **وأصناف الطلب كاملة**.
  * `confirm`: **إزالة `status: 'SERVED'`**، إضافة `releasedStatus`/`kitchenReleased` وبثّ
    `ORDER_STATUS_UPDATED` ليدخل الطلب المطبخ فوراً، وسطر الدفتر يذكر القناة.
* `server/services/paymentProofs.ts` — `TRANSFER_CHANNEL` + `normalizeTransferChannel` +
  `transferChannelLabel` (تسمية للكاشير فقط).
* `server/services/retention.ts` / `retentionPolicy.ts` — الاسم يُمسح مع الهاتف والصورة عند
  انتهاء مدة الاحتفاظ (بيانات تشغيلية مؤقتة)، والأرقام المالية تبقى كاملة.

### الواجهة
* `src/components/customer/TransferPaymentModal.tsx` — اسم العميل (إلزامي)، رقم الهاتف
  (إلزامي)، اختيار بنكي/محفظة، ورسائل تؤكد أن المطبخ يبدأ بعد تأكيد الكاشير.
* `src/components/customer/OrderTrackingDrawer.tsx` — تنبيه بارز للزبون «أرسل إشعار التحويل»،
  شرح أن الطلب محجوز عن المطبخ حتى التأكيد، ومنع إلغاء الطلب أثناء انتظار التحقق.
* `src/components/manager/PaymentVerificationPanel.tsx` — الاسم والقناة وأصناف الطلب داخل
  بطاقة التحقق، ورسالة تأكيد توضح أن الطلب أُرسل للمطبخ.
* `src/components/manager/KitchenDisplaySystem.tsx` — إخفاء الطلبات بانتظار التحقق من المطبخ
  مع شريط يوضح عددها وسببها، ووسم «تحويل مؤكد — جاهز للبدء فوراً» بعد التأكيد.
* `src/context/RestaurantContext.tsx` — تمرير الاسم/القناة، تنبيه الزبون بعد الطلب، تنبيه
  الزبون عند التأكيد («أُرسل طلبك إلى المطبخ فوراً»)، ورنّة المطبخ عند إطلاق طلب مدفوع.
* `src/services/api.ts` / `src/types/restaurant.ts` — حقول الإرسال والأنواع الجديدة
  (`TransferChannel`, أسطر أصناف بطاقة التحقق).

### الاختبارات
`src/tests/payment-proof.test.ts`, `payment-proof-ui.test.tsx`, `retention.test.ts`,
`payment-proof-flow.integration.test.ts` — تم تحديثها لتثبيت العقد الجديد
(الاسم/الهاتف إلزاميان، الإفراج للمطبخ بدل `SERVED`، مسح الاسم في التنقية).

---

## 4) ما لم يُلمس

* مسارات الدفع النقدي/البطاقة/المحفظة الداخلية في نقطة البيع (`settle`, `payments`) وصيغة
  دفتر `Payment` وأرقام الإيصالات.
* آلة حالات الطلب في المطبخ (`PENDING → PREPARING → READY → SERVED`) وواجهة الطوابق والنادل.
* صلاحيات الأدوار: التحقق من التحويلات يبقى لـ CASHIER / RESTAURANT_MANAGER فقط، والمطبخ
  لا يرى هوية الزبون ولا صورة الإشعار.
* الطباعة/التقارير/الاشتراكات/الإدارة — لا تغيير.

## 5) التشغيل بعد السحب

```bash
npm install          # يشغّل prisma generate
npm run db:migrate   # يطبق الترحيل الإضافي (عمودا الاسم/القناة)
npm run server       # ثم الواجهة: npm run dev
```
