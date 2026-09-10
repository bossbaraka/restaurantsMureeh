# تقرير: نقل تخزين الصور إلى Object Storage (إنتاجي وآمن)

**التاريخ:** 2026-09-11
**النتيجة:** اكتمل نقل مسار الرفع في الإنتاج من filesystem المؤقت إلى **Supabase Storage**، مع الحفاظ على PostgreSQL لتخزين الروابط، دون كسر الـ API أو البيانات الحالية.

---

## 1) الملفات التي تم تعديلها

| الملف | التغيير |
|---|---|
| `server/config.ts` | إضافة `STORAGE_DRIVER` (`local`/`supabase`/`object`)، `UPLOAD_DIR`، `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `SUPABASE_STORAGE_BUCKET`، `STORAGE_ALLOW_LOCAL_IN_PROD` + تحقق مركزي يفشل عند غياب credentials |
| `server/routes/uploads.ts` | إعادة كتابة الرفع ليستخدم `StorageService`، إضافة تحقق الحجم، مفتاح `kind`، وإضافة مسار الحذف `POST /api/uploads/delete` مع عزل tenants |
| `server/index.ts` | جعل مسار الـ static serving يقرأ من `config.uploadDir` (يبقى فقط للتطوير وللملفات القديمة) |
| `server/routes/manager.ts` | تنظيف تلقائي للصور القديمة بعد نجاح التحديث/الحذف (شعار/غلاف/معرض/طبق/تصنيف/عرض) — حذف القديم بعد نجاح الـ DB فقط |
| `server/routes/admin.ts` | إضافة `GET /api/admin/storage-status` للتشخيص الآمن (بلا أسرار) |
| `src/services/api.ts` | `uploadImage(file, name, kind?)` + دالة `deleteImage(url)` جديدة |
| `src/components/manager/BrandingSettingsView.tsx` | تمرير `kind` (logo/cover/gallery) عند الرفع |
| `src/components/manager/ProductFormModal.tsx` | تمرير `kind=product` عند رفع صورة الطبق |
| `src/tests/security-remediation.test.ts` | تحديث اختبار الـ snapshot ليطابق مسار الرفع الجديد |
| `.env.example` | توثيق كل المتغيرات الجديدة |
| `render.yaml` | إضافة متغيرات Object Storage |
| `package.json` | إضافة `storage:migrate` |

## 2) الملفات التي تم إنشاؤها

| الملف | الوظيفة |
|---|---|
| `server/services/storage/helpers.ts` | توليد المفاتيح الآمنة + عزل tenants + استخراج key من URL (دوال نقية قابلة للاختبار) |
| `server/services/storage/index.ts` | واجهة `StorageService` + `getStorage()` (singleton) |
| `server/services/storage/local.ts` | `LocalStorageDriver` — للتطوير/الاختبار فقط (مع fsync) |
| `server/services/storage/supabase.ts` | `SupabaseStorageDriver` — التخزين الإنتاجي (S3-compatible) |
| `server/services/storage/cleanup.ts` | حذف الصور المستبدلة بأمان (لا يفشل العملية، يعزل tenants) |
| `server/services/storage/imageSniff.ts` | فحص الـ magic bytes + حد الحجم 5MB |
| `server/scripts/storage-migrate.ts` | أمر ترحيل الصور القديمة |
| `src/tests/storage.test.ts` | 15 اختبار وحدة تغطي الرفع/الحذف/الاستبدال/الفشل/العزل |

## 3) الـ Object Storage المختار ولماذا

**Supabase Storage** — لأن:
1. `@supabase/supabase-js` **موجود أصلًا** في `package.json` (لم أضف أي تبعية جديدة، ولم أستطع التثبيت لانقطاع الشبكة في البيئة).
2. **S3-compatible API** (يمكن لاحقًا تبديله إلى أي مزوّد S3 عبر نفس الـ adapter).
3. **مجاني/منخفض التكلفة** (1GB تخزين + 2GB نقل شهريًا مجانًا).
4. **إنتاجي وآمن**: كتابة عبر `service_role` key من الخادم فقط، وقراءة عامة عبر bucket عام.
5. **قابل للتوسع**: نفس مفتاح التنظيم يعمل مع أي S3 لاحقًا دون تغيير منطق الأعمال.

> لم يكن هناك Object Storage مُفعّل أصلًا في المشروع (الاعتماد موجود لكن غير مستخدم)؛ فبنيت الـ abstraction بدل إنشاء نظامين.

## 4) جميع Environment Variables المطلوبة

```
STORAGE_DRIVER="supabase"        # local | supabase | object
UPLOAD_DIR="./uploads"           # فقط لـ local (تطوير)
SUPABASE_URL="https://xxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
SUPABASE_STORAGE_BUCKET="restaurant-assets"
STORAGE_ALLOW_LOCAL_IN_PROD="false"   # لا تفعّلها إلا لخادم self-hosted بقرص دائم
```

- عند `STORAGE_DRIVER=supabase` **بدون** `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` → **يفشل الإقلاع** برسالة واضحة.
- عند `STORAGE_DRIVER=local` في `NODE_ENV=production` → **يرفض الإقلاع** ما لم يُضبط `STORAGE_ALLOW_LOCAL_IN_PROD=true` (للتطبيقات ذات القرص الدائم فقط).

## 5) تغييرات Prisma

**لا توجد.** لم أغيّر الـ schema ولا أي migration. السبب:
- الحقول الحالية (`Restaurant.logoUrl`, `coverImageUrl`, `galleryImages`, `Category.image`, `Product.imageUrl`, `Offer.image`) تكفي لتخزين الـ URL الدائم.
- مفتاح الكائن `storageKey` **قابل للاشتقاق الحتمي من الـ URL** (`keyFromUrl`)، فلا حاجة لعمود إضافي.
- إضافة أعمدة `storageKey/mimeType/size` كانت ستكون تعديلًا غير ضروري على 4 نماذج مع مخاطرة على البيانات الحالية.

## 6) طريقة إعداد Render

1. أنشئ مشروع + **Bucket عام** باسم `restaurant-assets` في Supabase (Public bucket).
2. انسخ `Project URL` و`service_role` key من Supabase → أضفهما في Render كـ Environment Variables.
3. `STORAGE_DRIVER=supabase` و`SUPABASE_STORAGE_BUCKET=restaurant-assets` (أُضيفتا بالفعل في `render.yaml`).
4. أعد نشر الخدمة — سيُرصد ذلك عبر `GET /api/admin/storage-status`.
5. **مهم:** لا تضع أي قرص دائم للصور (لم يعد مطلوبًا)؛ احتفظ بقرص دائم فقط إن أردت ملفات `backups/`.

## 7) طريقة تشغيل ترحيل الصور القديمة

```bash
npm run storage:migrate                 # DRY-RUN (لا يكتب شيئًا)
npm run storage:migrate -- --apply      # تنفيذ الرفع + تحديث قاعدة البيانات
npm run storage:migrate -- --apply --delete-source   # + حذف الملف المحلي بعد النجاح
npm run storage:migrate -- --apply --retries 5
```

- الافتراضي **dry-run** (آمن، لا يعمل تلقائيًا في الإنتاج).
- يتخطى الصور المهاجرة مسبقًا (URLs لا تبدأ بـ `/uploads/`).
- يسجّل بوضوح الملفات **المفقودة** (التي اختفت من القرص) ولا يدّعي استرجاعها.
- لا يحذف المصدر إلا بعد نجاح الرفع + تحديث الـ DB، وفقط مع `--delete-source`.

## 8) النتائج

| الفحص | النتيجة |
|---|---|
| `npm test` | ✅ **292 passed / 1 skipped** (المتخطَّى يحتاج قاعدة بيانات غير متاحة هنا) |
| `npm run lint` | ✅ **0 errors** / 152 warnings (كلها قديمة، لا تحذيرات في ملفاتي الجديدة) |
| `npx tsc --noEmit` | ✅ نظيف |
| `npm run build` | ✅ نجح (tsc -b + vite build) |

## 9) المخاطر المتبقية

1. **لا يمكن اختبار HTTP حي ضد Supabase/DB في هذه البيئة** (لا `.env` ولا اتصال شبكة موثوق، و`prisma generate` فشل لانقطاع TLS). اختبارات الـ storage مغطاة بوحدات مع mock للـ adapter.
2. **الـ Bucket يجب أن يكون Public** حتى تظهر الصور للعميل بدون signed URLs — يلزم ضبط سياسة قراءة عامة/كتابة خاصة في Supabase.
3. ملفات الخادم لا تخضع لـ `tsc -b` (تُشغَّل عبر `tsx`)، لكنها فُحصت عبر `oxlint` (0 أخطاء) واختُبر منطقها بالـ tests. هذا نمط قائم مسبقًا في المشروع.
4. الملفات القديمة التي **اختفت فعلًا** من القرص قبل الترحيل لا يمكن استرجاعها — سيسجّلها `storage:migrate` كـ MISSING ويجب إعادة رفعها يدويًا.

## 10) التأكيد النهائي

✅ **الصور الجديدة لم تعد تعتمد على filesystem المؤقت لـ Render.** مسار الإنتاج الكامل الآن:

```
POST /api/uploads/image
   → StorageService.getStorage()  (SupabaseStorageDriver في الإنتاج)
   → restaurants/{restaurantId}/{logo|cover|products|categories|gallery|offers}/{uuid}.{ext}
   → DB يخزّن الـ URL الدائم (public Supabase URL)
```

- الوحيدة التي تلمس `fs` للرفع هي `LocalStorageDriver` (تطوير/اختبار)، و`config.ts` **يرفضها في الإنتاج**.
- الـ static serving لـ `/uploads` بقي فقط لخدمة الملفات القديمة قبل الترحيل ووضع التطوير — لا يستقبل رفعات جديدة في الإنتاج.
