# 🚀 دليل النشر والتشغيل على السيرفر الإنتاجي (Production Deployment Guide)

## إضافة حساب مدير المنصة

لا تضع كلمة المرور داخل Git أو ملفات الواجهة. أضف المتغيرين التاليين إلى متغيرات البيئة في Render/الخادم، ثم شغّل أمر provisioning بعد تهيئة قاعدة البيانات:

```text
PLATFORM_ADMIN_EMAIL=your-admin@example.com
PLATFORM_ADMIN_PASSWORD=ضع-كلمة-مرور-قوية-هنا
```

```bash
npm run db:provision-admins
```

يمكن تشغيل الأمر دون إعداد حسابات المديرين الثلاثة؛ سيتم إنشاء مدير المنصة وحده عند توفر المتغيرين المطلوبين.

يوضح هذا الدليل كيفية نشر منصة **MÉRAR Multi-Tenant Restaurant SaaS** على بيئة الإنتاج الفعلية خطوة بخطوة.

---

## 📌 المحتويات
1. [المتطلبات الأساسية](#1-المتطلبات-الأساسية)
2. [الطريقة الأولى: النشر المباشر على سيرفر VPS (الأكثر استخداماً)](#2-الطريقة-الأولى-النشر-المباشر-على-سيرفر-vps)
3. [الطريقة الثانية: النشر عبر Docker & Docker Compose (الأسهل والأسرع)](#3-الطريقة-الثانية-النشر-عبر-docker--docker-compose)
4. [الطريقة الثالثة: النشر السحابي المنفصل (Render + Vercel + Supabase)](#4-الطريقة-الثالثة-النشر-السحابي-المنفصل)
5. [إعداد شهادة الأمان SSL (HTTPS) مجاناً](#5-إعداد-شهادة-الأمان-ssl-https-مجاناً)
6. [نصائح الأمان والنسخ الاحتياطي](#6-نصائح-الأمان-والنسخ-الاحتياطي)
7. [ملاحظات الترقية الأمنية](#7-ملاحظات-الترقية-الأمنية-إصدار-التحصين-2026-09-07)

---

## 1. المتطلبات الأساسية
قبل البدء في النشر، تأكد من توفر:
- خادم سحابي VPS بنظام **Ubuntu 22.04 أو 24.04** (مثلاً: Hetzner, DigitalOcean, AWS EC2, Contabo).
- اسم دومين (Domain Name) موجه إلى عنوان IP الخاص بالسيرفر (مثلاً `menu.yourdomain.com`).
- Node.js إصدار **20.x** أو أحدث.
- قاعدة بيانات **PostgreSQL 16 أو 17**.

---

## 2. الطريقة الأولى: النشر المباشر على سيرفر VPS

### الخطوة 1: تحديث السيرفر وتثبيت الحزم المطلوبة
```bash
# تحديث المستودعات
sudo apt update && sudo apt upgrade -y

# تثبيت Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx postgresql postgresql-contrib

# تثبيت مدير العمليات PM2 عالمياً
sudo npm install -g pm2
```

---

### الخطوة 2: إعداد قاعدة بيانات PostgreSQL
```bash
# الدخول إلى PostgreSQL وإنشاء المستخدم وقاعدة البيانات
sudo -u postgres psql

# داخل موجه psql نفذ الأوامر التالية (استبدل كلمة المرور بكلمة قوية):
CREATE DATABASE restaurant_saas;
CREATE USER restaurant_user WITH ENCRYPTED PASSWORD 'StrongPasswordHere123!';
GRANT ALL PRIVILEGES ON DATABASE restaurant_saas TO restaurant_user;
ALTER DATABASE restaurant_saas OWNER TO restaurant_user;
\q
```

---

### الخطوة 3: رفع ملفات المشروع وضبط المتغيرات البيئية
1. ارفع مجلد المشروع إلى المسار: `/var/www/restaurant-system`
2. ادخل إلى المجلد وثبت التبعيات:
```bash
cd /var/www/restaurant-system
npm install
```

3. أنشئ ملف البيئة الإنتاجي `.env`:
```bash
nano .env
```
أضف الإعدادات التالية:
```ini
NODE_ENV=production
PORT=3001
APP_URL=https://menu.yourdomain.com
CORS_ORIGIN=https://menu.yourdomain.com

# رابط قاعدة البيانات التي أنشأناها
DATABASE_URL="postgresql://restaurant_user:StrongPasswordHere123!@localhost:5432/restaurant_saas?schema=public"

# مفتاح تشفير JWT (32 حرف على الأقل عشوائي)
JWT_SECRET="a98f7e6d5c4b3a210987654321fedcba0123456789abcdef"
```

---

### الخطوة 4: مزامنة قاعدة البيانات وبناء الواجهة
```bash
# مزامنة جداول Prisma وتوليد الـ Client
npx prisma db push

# بذر البيانات الأولية (أطباق مِيرار، 50 طاولة، المستخدمين)
npm run db:seed

# بناء واجهة العميل واللوحة (Frontend Build)
npm run build
```

---

### الخطوة 5: تشغيل الخادم الخلفي عبر PM2
```bash
# بدء تشغيل السيرفر مع إعادة التشغيل التلقائي عند التوقف
pm2 start server/index.ts --name "merar-api" --interpreter tsx

# حفظ الإعدادات لتعمل عند إعادة تشغيل السيرفر (Reboot)
pm2 save
pm2 startup
```

---

### الخطوة 6: إعداد Nginx كخادم ويب و Reverse Proxy
أنشئ ملف إعداد الموقع في Nginx:
```bash
sudo nano /etc/nginx/sites-available/restaurant
```

ضع الإعداد التالي:
```nginx
server {
    listen 80;
    server_name menu.yourdomain.com;

    # مسار الواجهة الأمامية (Build Files)
    root /var/www/restaurant-system/dist;
    index index.html;

    # دعم ملفات الصور المرفوعة
    location /uploads {
        alias /var/www/restaurant-system/uploads;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # توجيه طلبات الـ API إلى خادم Express
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # دعم البث الحي لطلبات SSE في الوقت الفعلي
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }

    # توجيه كافة مسارات الـ SPA (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

تفعيل الإعداد وإعادة تشغيل Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/restaurant /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 3. الطريقة الثانية: النشر عبر Docker & Docker Compose

إذا كان لديك **Docker** و **Docker Compose** مثبتين على السيرفر:

1. عدل ملف `docker-compose.yml` وضع رابط الدومين وكلمات المرور الخاصة بك.
2. شغل المنظومة بالكامل بأمر واحد:
```bash
docker compose up -d --build
```
3. لتشغيل البذر الأولي لقاعدة البيانات:
```bash
docker compose exec app npx tsx server/db/seed.ts
```

---

## 4. الطريقة الثالثة: النشر السحابي المنفصل (Serverless / Managed)

- **قاعدة البيانات**: أنشئ مشروعاً على [Neon.tech](https://neon.tech) أو [Supabase](https://supabase.com) وانسخ الـ `DATABASE_URL`.
- **الخادم الخلفي (Backend)**: ارفع المشروع على [Render.com](https://render.com) أو [Railway.app](https://railway.app):
  - أمر البناء (Build Command): `npm install && npx prisma db push`
  - أمر التشغيل (Start Command): `npm run start:server`
- **الواجهة الأمامية (Frontend)**: ارفع على [Vercel](https://vercel.com) أو [Cloudflare Pages]:
  - Framework: `Vite`
  - Build Command: `npm run build`
  - Output Directory: `dist`
  - أضف متغير البيئة `VITE_API_URL` برابط الباك إند على Render/Railway.

### إعدادات Render و Vercel الجاهزة

يوجد في جذر المشروع ملفا `render.yaml` و `vercel.json` لتطبيق إعدادات النشر تلقائيًا.
إذا كان المستودع يحتوي على مجلد `restaurant-system`، اجعله **Root Directory** في إعدادات المنصة.

- **Render Static Site**: يستخدم `npm ci && npm run build` وينشر مجلد `dist`.
- **Render Web Service**: يستخدم `npm ci && npx prisma generate && npx prisma db push` ثم `npm run start:server`.
- لا تنشر الـ Backend كـ Static Site؛ ملف `render.yaml` ينشئ الخدمتين منفصلتين.
- في الواجهة، اضبط `VITE_API_URL` على رابط خدمة الـ API، مثل `https://restaurant-api.onrender.com`.
- في خدمة الـ API، اضبط `DATABASE_URL` و `JWT_SECRET` و `CORS_ORIGIN` و `APP_URL`.
- قبل تشغيل seed، اضبط أيضًا `PLATFORM_ADMIN_EMAIL` و `PLATFORM_ADMIN_PASSWORD`، بالإضافة إلى `MANAGER_1_NAME` و`MANAGER_1_EMAIL` و`MANAGER_1_PASSWORD`، ونفس الحقول للمديرين `2` و`3`.
- لإنشاء الحسابات أو تحديث كلمات مرورها دون حذف بيانات المطاعم والطلبات، شغّل من **Render Shell**: `npm run db:provision-admins`. استخدم `npm run db:seed` مرة واحدة فقط عند تهيئة قاعدة جديدة تمامًا.
- يجب أن تكون قيمة `CORS_ORIGIN` هي رابط الواجهة النهائي، مثل `https://restaurant-frontend.onrender.com` أو رابط Vercel.

---

## 5. إعداد شهادة الأمان SSL (HTTPS) مجاناً
لتشفير الموقع وقفل الأمان الأخضر عبر Let's Encrypt:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d menu.yourdomain.com
```
سيقوم Certbot تلقائياً بتهيئة شهادة SSL وتجديدها ذاتياً كل 90 يوماً.

---

## 6. نصائح الأمان والنسخ الاحتياطي في الإنتاج

1. **تغيير كلمات المرور الافتراضية**:
   - قم بتغيير كلمات مرور المدراء والمشرف العام فوراً عبر لوحة التحكم.
2. **النسخ الاحتياطي الدوري**:
   - السكريبت المدمج جاهز لتوليد نسخ SQL لقاعدة البيانات. يتطلب `DB_PASSWORD` في البيئة (لا توجد كلمة افتراضية)، ويحفظ الملف بصلاحيات `0600`:
   ```bash
   DB_PASSWORD='...' npx tsx -e "import { createDatabaseBackup } from './server/services/backup.js'; createDatabaseBackup();"
   ```
   - يمكنك جدولته يومياً في `crontab`:
   ```bash
   0 3 * * * cd /var/www/restaurant-system && DB_PASSWORD='...' npx tsx -e "import { createDatabaseBackup } from './server/services/backup.js'; createDatabaseBackup();"
   ```
   - انقل النسخ خارج الخادم (S3 مشفّر) ولا تعتمد على القرص المحلي وحده.

---

## 7. ملاحظات الترقية الأمنية (إصدار التحصين 2026-09-07)

> هذه التغييرات **كاسِرة للتوافق** مع الجلسات القديمة — وهي مقصودة: كل توكن صدر قبل الترقية يُرفض ويجب على المستخدمين تسجيل الدخول مجدداً.

1. **دوّر `JWT_SECRET`**: ولّد سراً جديداً (48 بايت على الأقل) ولا تُعد استخدام القديم أبداً:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   الخادم يرفض الإقلاع إذا كان السر أقصر من 32 حرفاً، ولا يوجد أي سر احتياطي مضمّن.
2. **حدّث قاعدة البيانات**: شغّل `npx prisma db push` (بدون `--accept-data-loss` — أُزيل من سكربتات النشر نهائياً). التغيير إضافي فقط: عمود `tokenVersion` في `RestaurantUser` + قيمة `KITCHEN` في `TenantRole`.
3. **اضبط `CORS_ORIGIN` بدقة**: أصول الإنتاج فقط مفصولة بفواصل. في الإنتاج يفشل الخادم إقلاعياً إذا تُرك فارغاً (fail-closed).
4. **اضبط `TRUST_PROXY`**: خلف Render/Nginx ضعه `1`، وعلى سيرفر مكشوف مباشرة اتركه `0` (القيمة الافتراضية).
5. **أغلق منفذ قاعدة البيانات**: في `docker-compose.yml` أصبحت PostgreSQL مربوطة على `127.0.0.1` فقط — لا تعرض `5432` للشبكة.
6. **سلوك جديد يجب إبلاغ المدراء به**:
   - الدخول بـ PIN يتطلب وجود المطعم النشط (النادل يختار مطعمه أولاً)، وشاشة الهبوط حسب الدور لا قيمة الـ PIN.
   - تسجيل الخروج يُبطل التوكن فوراً من الخادم.
   - الدفع النقدي يتطلب تسجيل مبلغ مقبوض يغطي الفاتورة كاملة.
   - رفع الصور للمدير فقط، ويُقبل PNG/JPG/WEBP/GIF الحقيقية فقط.
   - إنشاء الفروع وتصدير CSV يتطلبان الباقة المؤهلة (تُفرض من الخادم).
7. **حدود المعدل (Rate Limits)**: الدخول 20/15د، الـ PIN عشرة/15د، الطلبات العامة 120/15د، النداءات 40/15د، الرفع 60/ساعة — لكل نسخة (in-memory). عند التوسع لأكثر من نسخة استخدم مخزن Redis مشترك.
8. **تحقق بعد النشر**: شغّل مجموعة الـ regression ضد نسخة تجريبية ببيانات اصطناعية:
   ```bash
   SECURITY_TEST_BASE_URL=http://127.0.0.1:3001 \
   SECURITY_TEST_TOKEN_A='...' SECURITY_TEST_TENANT_A_ID='...' \
   SECURITY_TEST_TENANT_B_ID='...' node security-tests/api-security-smoke.mjs
   ```
