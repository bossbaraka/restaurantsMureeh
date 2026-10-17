# تشخيص فشل نشر Render (خدمة Web / API)

## حدود التحقيق في إشعار الدمج رقم 71 — 17 أكتوبر 2026

- الدمج `d998141` اجتاز CI في GitHub (بناء الواجهة، اختبارات الوحدة، ترحيلات PostgreSQL واختبارات التكامل). نشر Vercel للواجهة مسجّل ناجحًا. **لا يعني ذلك نجاح خدمة Render المنفصلة.**
- لم يتضمن إشعار «RestaurantsMureeh-2» نص السجل أو رابط نشر يمكن الوصول إليه، ولا تظهر حالة Render ضمن حالات GitHub لهذا الـcommit. لا يمكن الجزم بسبب فشل Render، أو الادعاء بإصلاحه/إعادة نشره، دون أول خطأ في سجلات الخدمة.
- الـBlueprint في `render.yaml` يعرّف `restaurant-api` و`restaurant-frontend`. إذا كانت الخدمة المسماة `RestaurantsMureeh-2` أُنشئت **يدويًا**، فلن يغيّر تعديل هذا الملف إعداداتها تلقائيًا. افحص إعداداتها الفعلية في لوحة Render.

## إعدادات خدمة API الصحيحة

| الإعداد | القيمة المتوقعة لخدمة Web |
| --- | --- |
| Root Directory | جذر المستودع (اتركه فارغًا في Render؛ `package.json` في الجذر) |
| Node | 22.22.3؛ لا تثبّت `NODE_VERSION` في لوحة الخدمة على إصدار أقدم من 22.12 |
| Build Command | `npm ci && npx prisma generate` |
| Start Command | `npm run start:server` |
| Health Check Path | `/api/health` |
| Port | اترك `PORT` الذي توفره Render، ولا تستخدم منفذًا ثابتًا في اللوحة |

تبدأ خدمة API بتطبيق ترحيلات `prisma migrate deploy` الملتزم بها **قبل** بدء Express؛ لا تشغّل `db push` أو `db:seed` في Build/Start. البذر يدوي عند إنشاء قاعدة جديدة فقط. عند استخدام Render Web مع واجهة Vercel/Render Static منفصلة، لا يلزم وجود `dist/` في خدمة API؛ بناء الواجهة يتم في خدمتها الثابتة.

راجع **وجود الأسماء** التالية في بيئة Web دون طباعة قيمها أو وضعها في Git: `NODE_ENV=production`، `DATABASE_URL` (اتصال PostgreSQL صالح وقابل للترحيل)، `JWT_SECRET` (32 حرفًا على الأقل)، `CORS_ORIGIN` (أصل الواجهة الدقيق)، `APP_URL` (أصل خدمة API عند استخدام نطاقين)، `TRUST_PROXY=1`، `STORAGE_DRIVER=supabase`، `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، ودلو الصور العام `SUPABASE_STORAGE_BUCKET`. خادم Render يرفض التخزين المحلي المؤقت حتى لو ضُبط `STORAGE_ALLOW_LOCAL_IN_PROD`؛ لا تعطّل هذا الفحص لإجبار الخدمة على الإقلاع. لمستندات التحويلات يوجد دلو خاص `SUPABASE_PRIVATE_BUCKET`؛ لا تجعله عامًا.

## تحديد أول فشل، لا آخر رسالة في السجل

من **Render → RestaurantsMureeh-2 → Events → النشر الفاشل → View logs**، حدد أول `ERROR` والسطر الذي سبقه/تلاه. افصل بين **Build logs** و**Deploy/Runtime logs**. إذا لم تكن لديك صلاحية لعرضها، اطلب من مالك مساحة عمل Render إرسال 30–60 سطرًا حول أول خطأ بعد حجب رابط قاعدة البيانات والمفاتيح وكلمات المرور.

| المرحلة / الرسالة | الفحص الآمن |
| --- | --- |
| Build: `EBADENGINE`، `Unsupported engine`، Vite/Node | راجع `node --version` و`NODE_VERSION` في إعدادات **الخدمة اليدوية**؛ الملفان `.node-version` و`package.json` يحددان Node 22، لكن متغير اللوحة قد يتجاوزهما. |
| Build: تعذّر تنزيل Prisma engine / `prisma generate` | افحص اتصال Render أثناء البناء إلى خوادم Prisma واتساق `npm ci` مع `package-lock.json`؛ لا تُزل توليد Prisma من Web Service لأن API يحتاجه. |
| Start: `P1001` / تعذّر الوصول إلى PostgreSQL | راجع `DATABASE_URL` والاتصال المباشر، حالة قاعدة البيانات وشبكتها وصلاحيات مستخدم الترحيل؛ لا تُطبع قيمة الرابط في السجلات. |
| Start: `P3005` / `P3009` / خطأ SQL | راجع سجل الترحيل الفاشل ونتيجة `npx prisma migrate status` من Render Shell بعد أخذ نسخة احتياطية. لا تستخدم `migrate reset` أو `db push --accept-data-loss` ولا تُعلّم ترحيلًا أنه مطبّق دون التحقق من البيانات. |
| Start: `Invalid environment configuration` / `[STORAGE]` | أضف المتغيرات المفقودة الصحيحة في لوحة Render (بدون نشر أسرار)؛ لا تُبدّل التخزين إلى القرص المحلي المؤقت. |
| Health check: الخدمة لم تفتح المنفذ | تأكد من أمر التشغيل و`PORT` وظهور رسالة الاستماع؛ `/api/health` وحده لا يختبر PostgreSQL. بعد النجاح اختبر `GET /api/public/restaurants` للتحقق من القراءة من قاعدة البيانات. |
| `/` لا يعمل لكن `/api/health` يعمل | خدمة Web في هذا الـBlueprint هي API فقط؛ افتح نطاق الواجهة المنفصل، ولا تخلط بين غياب `dist/` وبين فشل نشر API. |

**استعادة الخدمة:** إن لزم، تراجع عن نسخة التطبيق من Render إلى آخر نشر ناجح بعد التحقق من توافقها مع الترحيلات الإضافية. لا تعكس ترحيلات الإنتاج تلقائيًا ولا تمسح بيانات القاعدة. لا تُعلن زوال الحادث إلا بعد نجاح نشر Render نفسه وفحص الصحة ومسار يعتمد على قاعدة البيانات.
