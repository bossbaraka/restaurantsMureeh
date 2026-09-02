# 🚀 دليل النشر والتشغيل على السيرفر الإنتاجي (Production Deployment Guide)

يوضح هذا الدليل كيفية نشر منصة **MÉRAR Multi-Tenant Restaurant SaaS** على بيئة الإنتاج الفعلية خطوة بخطوة.

---

## 📌 المحتويات
1. [المتطلبات الأساسية](#1-المتطلبات-الأساسية)
2. [الطريقة الأولى: النشر المباشر على سيرفر VPS (الأكثر استخداماً)](#2-الطريقة-الأولى-النشر-المباشر-على-سيرفر-vps)
3. [الطريقة الثانية: النشر عبر Docker & Docker Compose (الأسهل والأسرع)](#3-الطريقة-الثانية-النشر-عبر-docker--docker-compose)
4. [الطريقة الثالثة: النشر السحابي المنفصل (Render + Vercel + Supabase)](#4-الطريقة-الثالثة-النشر-السحابي-المنفصل)
5. [إعداد شهادة الأمان SSL (HTTPS) مجاناً](#5-إعداد-شهادة-الأمان-ssl-https-مجاناً)
6. [نصائح الأمان والنسخ الاحتياطي](#6-نصائح-الأمان-والنسخ-الاحتياطي)

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
   - السكريبت المدمج جاهز لتوليد نسخ SQL لقاعدة البيانات عبر الأمر:
   ```bash
   npx tsx -e "import { createDatabaseBackup } from './server/services/backup.js'; createDatabaseBackup();"
   ```
   - يمكنك جدولته يومياً في `crontab`:
   ```bash
   0 3 * * * cd /var/www/restaurant-system && npx tsx -e "import { createDatabaseBackup } from './server/services/backup.js'; createDatabaseBackup();"
   ```
