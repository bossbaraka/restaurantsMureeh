# إصلاح بوابة الدفع — 2026-09-14

**المهمّتان:** (1) خطأ «تعذر تأكيد الدفع» وفشل «رفض الإشعار» عند الكاشير، (2) ألّا يظهر الطلب لدى
المطبخ إلا بعد التأكيد.
**الفرع:** `arena/01a09f52-restaurantsmureeh` · **الأساس:** `0ccae66`
**الحالة:** مُطبَّق، 649 اختبار وحدة ناجح، 0 أخطاء lint، `tsc -b` و`vite build` نظيفان، وسيناريو
البوابة الكامل في `npm run preview:gate` ناجح.

---

## 1) السبب الجذري لخطأ «تعذر تأكيد الدفع» / «تعذر رفض الإشعار»

العميل المشترك `src/services/api.ts` يُرسل **معرّف المطعم في جسم كل طلب إداري**
(`{ restaurantId, … }`) — وهذا اتفاق متَّبع في المشروع: كل مخطّطات `server/validation/schemas.ts`
للمسارات الإدارية تعلن `restaurantId: idSchema.optional()` ثم تتجاهله المسارات (المستأجَر يُحسم من
JWT وحده).

ثلاثة مخطّطات نسيت هذا الإعلان، وهي `.strict()` — وأي مفتاح مجهول في `.strict()` يعني **رفضًا**:

| المسار | المخطّط | كان يقبل | أرسل العميل | النتيجة |
|---|---|---|---|---|
| `POST /api/manager/orders/:id/payment/confirm` | `paymentConfirmSchema` | `note` | `{restaurantId}` | **400** `Unrecognized key: "restaurantId"` |
| `POST /api/manager/orders/:id/payment/reject` | `paymentRejectSchema` | `reason` | `{restaurantId, reason}` | **400** |
| `POST /api/manager/tables/:id/settle` | `tableSettleSchema` | `paymentMethod…` | `{restaurantId, paymentMethod}` | **400** |

`validateBody` يُجيب قبل أن تصل المعالجة، فلا يتغيّر شيء في الطلب، وتعرض اللوحة
`showToast('error', 'تعذر تأكيد الدفع' / 'تعذر رفض الإشعار', res.error)`. لذلك: الإشعار لا يُقبل
ولا يُرفض، والطلب يبقى محجوزًا عن المطبخ إلى الأبد، ويظهر للكاشير أن التطبيق «يرفض» دائمًا.

**الإصلاح (على الخادم، لأنه يشفي كل العملاء):** إعلان `restaurantId: idSchema.optional()` في
المخطّطات الثلاثة — يُقبل ويُتجاهَل، ولا يُقرأ للمستأجَر أو للمبلغ أو للحالة. لم تُرخَخ `.strict()`
ولم تُضاف أي استثناءات: البنية صريحة الآن كبقية المسارات، والـ 400 اختفى.

لماذا لا نكتفي بإزالة المفتاح من العميل؟ لأن أي حزمة محفوظة في متصفح صندوق (bundle قديم) ستبقى
مكسورة؛ إصلاح الخادم يعالج الجميع دفعة واحدة.

### سبب إضافي كان يحوّل نجاحًا إلى «فشل»
لوحة التحقق كانت تنجح فقط إذا وجد إيصال في الرد:

```ts
if (res.success && res.data) { … res.data.payment.receiptNumber … }
showToast('error', 'تعذر تأكيد الدفع', res.error);
```

وردّ `200 { success: true, alreadyConfirmed: true, payment: null }` (إعادة تأكيد نفس الإشعار من
جهاز آخر) يسقط في فرع الخطأ — أي أن **الطلب مدفوع والمطبخ أُفرِج له، والصندوق يرى «تعذر تأكيد
الدفع»**، فيُعاد الضغط مرة أخرى. الآن: `confirmTransferPayment` يعتبر قرار الخادم هو الحكم
ويُرجع `payment: PaymentRecord | null`، واللوحة تقرأ الإيصال باحتياط وتفرّق بين
«تم التأكيد» و«كان هذا الإشعار مؤكداً مسبقاً»، وتمرّر سبب الخادم العربي كما هو في الخطأ الحقيقي.

---

## 2) «لا يظهر الطلب في المطبخ إلا بعد التأكيد»

بوابة `Order.fulfillmentState` موجودة ومطبَّقة على الخادم (الإنشاء من الزبون `AWAITING_PAYMENT`،
الإشعار `PAYMENT_VERIFICATION_PENDING`، القبول `RELEASED` في نفس معاملة الدفع، الرفض
`PAYMENT_REJECTED`، `PUT /orders/:id/status` يرفض 409 للمحجوز، و`?operational=` للتصفية).
**الفجوات كانت في الشاشات التي تتغذّى على قائمة الطلبات نفسها** — أي أن المطبخ كان يرى الطلب قبل
التأكيد فعليًا:

| السطح | ما كان يحدث | الآن |
|---|---|---|
| `OrderManagement` — **وهي الشاشة التي يفتحها حساب المطبخ مباشرة** (`KITCHEN: 'ORDERS'`) | تعرض الطلبات المحجوزة مع زر «قبول وبدء التحضير» ← 409 من الخادم | تُصفّى عبر `isOrderOperational`، وشريط يوضّح السبب وعدده، ولا أزرار تحضير للمحجوز |
| `DashboardOverview` — لوحة «بانتظار الموافقة» + عدّادات «طلبات قيد المطبخ» | تعدّ وتعرض المحجوز كعمل مطبخ | المُفرَج فقط؛ والمحجوز سطر مستقل «N طلب بانتظار تأكيد الدفع» |
| `TableAggregationModal` | أزرار حالة على كل طلب فاتورة | لا أزرار على المحجوز + «بانتظار تأكيد الدفع — لا يبدأ التحضير قبله» |
| شارات التنقّل (`ManagerLayout`, `ViewSwitcher`) | تعدّ المحجوز كعمل معلّق | عدّ المُفرَج فقط |
| `GET /api/manager/dashboard/stats` | `pending/preparing/ready` تشمل المحجوز | تُحسب على `fulfillmentState = RELEASED` + حقل جديد `heldForPaymentCount` |
| `GET /api/manager/orders` | لا يفسّر سبب الحجز | يضيف `paymentRejected` + `paymentRejectedReason` (مشتقة من المؤشر المخزَّن، لا من العميل) |

إضافة مرتبطة بنفس الشكوى: **شارة على تبويب الكاشير (POS)** بعدد الإشعارات التي تنتظر قرارًا
(`isPaymentVerificationPending`) — بلا شارة كان الإشعار ينتظر بلا أحد، فيبدو للمستخدم أن «الإشعار
يُرفض/يُهمَل». الرسالة التوضيحية في شاشة المطبخ باتت صريحة: «قبل التأكيد لا يبدأ أي تحضير».

---

## 3) لمَ لم تكتشف الاختبارات هذا؟ (وأُصلح)

`src/tests/*` تفحص نصّ الملفات، وعالم المعاينة `e2e/live-preview/world.ts` كان **يزيف HTTP ويتخطى
المخطّطات** — بتعليق صريح: «schemas.ts not needed (the client sends only what the schemas accept)»،
وهو افتراض خاطئ.

* `e2e/live-preview/world.ts`: جدول `BODY_CONTRACTS` يشغّل **مخطّطات zod الحقيقية** على كل جسم يرسله
  العميل للمسارات الأحد عشر الحسّاسة (الطلب، الإشعار، الإلغاء، الملاحظات، نداء النادل، POS، تغيير
  الحالة، **تأكيد/رفض الدفع**، الدفع، تسوية الطاولة) ويردّ 400 كما يرد المسار الحقيقي.
* **التجربة العكسية موثَّقة:** بإزالة السطر المُصلَّح من `paymentConfirmSchema` تفشل المعاينة
  فورًا بـ `[contract] ✗ … Unrecognized key: "restaurantId"`، وبالإصلاح تنجح.
* `src/tests/cashier-notification-contract.test.ts` (10 اختبارات): يجبر fetch الوهمي، ويأخذ الجسم
  **المسلسل فعليًا من `api.ts`** ويمرّره على المخطّط الحقيقي، ويثبت أن نجاح `alreadyConfirmed` بلا
  إيصال **ليس فشلًا**، وأن سبب الخادم يصل نصًّا للّوحة.
* `src/tests/kitchen-gate-screens.test.ts` (9 اختبارات): كل سطح مطبخي يشتق من `utils/orderLifecycle`
  (لا منطق بوابة خاص به)، وعدّادات اللوحة والشارات ومحقّقات `/dashboard/stats` على المُفرَج فقط.

---

## 4) الملفات

| ملف | التغيير |
|---|---|
| `server/validation/schemas.ts` | `restaurantId` اختياري معلن في `paymentConfirmSchema` / `paymentRejectSchema` / `tableSettleSchema` |
| `src/services/api.ts` | نجاح التأكيد = قرار الخادم؛ `payment` قد يكون `null`؛ `heldForPaymentCount` |
| `src/components/manager/PaymentVerificationPanel.tsx` | قراءة آمنة للإيصال، تمييز إعادة التأكيد، سبب الخادم ظاهر، نص الرفض يوضّح بقاء الطلب خارج المطبخ |
| `server/routes/manager.ts` | عدّادات المطبخ محجوزة بالبواب + `heldForPaymentCount` + تفسير الحجز في `/orders` |
| `OrderManagement` · `DashboardOverview` · `TableAggregationModal` · `ManagerLayout` · `ViewSwitcher` · `KitchenDisplaySystem` | إغلاق فجوات البوابة + صياغة توضيحية + شارة POS |
| `e2e/live-preview/world.ts` · `order-lifecycle.check.tsx` | تعاقد الأجسام بالمخطّطات الحقيقية |
| اختباران جديدان | 19 اختبارًا يثبّت السببين |

لم يُمَسّ: المخطّط والهجرات (لا حاجة لعمود جديد — `fulfillmentState` موجود)، المصادقة، التسعير،
تصميم الهوية، المسارات غير المعنية.

## 5) التحقق / ما تبقّى

```bash
npx vitest run                    # 649 ناجحًا — الفشل الوحيد production-hardening.test.ts
                                  # (يحتاج prisma generate؛ مستحيل هنا: لا شبكة لـ binaries.prisma.sh)
npm run preview:gate              # سيناريو الزبون ← الكاشير ← المطبخ كاملًا على واجهة حقيقية
npm run lint                      # 0 أخطاء (155 تحذيرًا مقابل 156 قبل الإصلاح)
npx tsc -b && npm run build       # نظيف
```

* لا حاجة لتشغيل هجرة جديدة؛ يكفي نشر النسخة المحدَّثة من الخادم والواجهة معًا (العميل القديم يبقى
  عاملاً: المفتاح صار مقبولًا لا مطلوبًا).
* موصى به بعد النشر: تجربة حقيقية على جهازين — إرسال إشعار → تأكيده → ظهور التذكرة في المطبخ.
