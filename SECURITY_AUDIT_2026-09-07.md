# تقرير التدقيق الأمني الشامل — Mureeh Menu SaaS

**تاريخ التدقيق:** 2026-09-07 (UTC)  
**النطاق:** شجرة المصدر في الفرع `arena/01a07a7b-restaurantsmureeh` المبني من `4153b66779fa72e9c9fde46e5e44acd4856f919b`، بما في ذلك React/Vite، Express، Prisma/PostgreSQL، إعدادات Docker/Render/Vercel/Netlify، والاختبارات وGit history المتاح محلياً.  
**نوع التدقيق:** مراجعة source كاملة + تحليل تدفق + فحص static + اختبارات HTTP محلية آمنة باستخدام بيانات tenant اصطناعية in-memory. لم يُرسل أي طلب إلى بيئة إنتاج أو مستخدم أو خدمة خارج النظام، ولم تُعدّل بيانات حقيقية.

## الحكم التنفيذي

**لا يُسمح بالإطلاق التجاري حالياً.** توجد مسارات تؤدي إلى الاستيلاء على حساب مدير مطعم دون بيانات اعتماد حقيقية، ترقية أي موظف إلى `PLATFORM_ADMIN`، قراءة بيانات Tenant B بواسطة User A، إنشاء جلسة QR لطاولة B دون امتلاك QR، تمرير طلب بسعر صفر/منتج أجنبي، واستضافة HTML تنفيذي على origin التطبيق عبر upload. هذه ليست مخاطر نظرية: تم تأكيد عدة حالات محلياً عبر Express handlers الفعلية.

| المجال | الدرجة /10 | ملخص |
|---|---:|---|
| Authentication | **1** | Backdoors تجريبية عامة، مفتاح JWT احتياطي hard-coded، لا rate limit أو revocation |
| Authorization / RBAC | **1** | لا يوجد RBAC خلفي فعلي؛ يمكن ترقية موظف إلى Platform Admin |
| Tenant isolation | **2** | تسريب waiter requests وCSV بين tenants وجلسة QR قابلة للتجاوز |
| API security | **2** | BOLA/BFLA، XSS upload، pricing manipulation، أخطاء validation |
| Database security | **4** | Prisma بلا raw SQL، لكن لا توجد invariants مركبة تمنع علاقات cross-tenant |
| Input validation | **2** | Zod مستخدم فقط تقريباً في login؛ بقية المدخلات غير strict وغير محدودة جيداً |
| Business logic | **1** | طلبات صفرية، إضافات غير مسعّرة، دفع غير كافٍ، plan/limits قابلة للتجاوز |
| Infrastructure / deployment | **3** | Helmet جزئي، CORS fail-open، `db push --accept-data-loss`، DB مكشوفة في Compose |
| Secrets management | **2** | fallback JWT في المصدر، أمثلة أسرار ثابتة في الدليل، لا fail-fast للبيئة |
| Dependency security | **8** | `npm audit` لم يُبلغ عن vulnerabilities حالياً؛ لا يعالج مخاطر التطبيق أعلاه |

# **Overall Security Score: 22 / 100**

---

## 1) منهجية العمل والأدلة

### ما تم فحصه

- جميع routes في `server/routes/{auth,admin,manager,public,uploads}.ts` وmiddleware وservices.
- schema في `prisma/schema.prisma`، وبنية العلاقات وقيود tenant.
- React contexts، client API، route/UI guards، تخزين token، sinks الخاصة بـ XSS والطباعة.
- إعدادات `Dockerfile`, `docker-compose.yml`, `render.yaml`, `vercel.json`, `netlify.toml`, `.env.example`, دليل النشر وGit history المتاح.
- OWASP Top 10، OWASP API Security Top 10 (2023)، OWASP ASVS، وCWE بحسب كل finding.

### أوامر ونتائج قابلة لإعادة المراجعة

| الفحص | النتيجة | الدلالة |
|---|---|---|
| `npm run build` | **نجح** | يبني الـ frontend؛ لا يـ type-check `server/**` لأن `tsconfig` لا يشمله. ليس دليلاً على صحة backend. |
| `npm test` | **29 passed / 1 skipped** | لا يثبت عزل tenants. اختبار Prisma/DB مرّ في وضع skip/fallback لأن Prisma generated client غير موجود في البيئة؛ لا توجد integration assertions حقيقية للـ API الحالي. |
| `npm run lint` | **0 errors، 156 warnings** | ليس security scanner ولا يوقف مشاكل authorization. |
| `npm audit --json` | **0 critical/high/moderate/low** | نتيجة جيدة للحزم المقفلة وقت التدقيق، ولا تغطي application logic. |
| `npm outdated --json` | Prisma 5.22 مقابل 7.10، وTailwind/TypeScript/Vitest لها major upgrades | لا تُرقّى عشوائياً؛ يلزم change plan واختبارات توافق. |
| البحث عن `$queryRaw`, `$executeRaw`, `eval`, `Function` | لا raw Prisma query ولا `eval` في source | يقلل مسار SQL/command injection، لكنه لا يعالج XSS في `document.write`. |
| فحص Git history المتاح | commit واحد grafted؛ لا `.env` أو private key tracked | النطاق لا يثبت تاريخاً محذوفاً/غير متاح في clone؛ template values فقط، مع fallback JWT الخطير في source. |

### تحقق HTTP محلي آمن (لا بيانات حقيقية)

تم تحميل **Express app الحقيقي** مع Prisma in-memory test double وTenant A/B اصطناعيين. النتائج التالية هي behavior فعلي للـ handlers وليست افتراضاً من UI:

| الاختبار المحلي | النتيجة المرصودة | المتوقع الآمن |
|---|---|---|
| User A → `GET /api/manager/waiter-requests?restaurantId=rest-b` | `200` ومعه waiter request و`reasonText` الخاص بـ B | `403` أو `404` |
| User A → `GET /api/manager/export/orders?restaurantId=rest-b` | `200` وCSV لطلب B | `403` أو `404` |
| Waiter A → `PUT /api/manager/staff/user-a` `{role:"PLATFORM_ADMIN"}` | `200`، الدور أصبح `PLATFORM_ADMIN` | `403`/`400`، الدور لا يتغير |
| Anonymous → login `demo@…` بكلمة يختارها | `200`، حساب `RESTAURANT_MANAGER` في أول tenant نشط | `401` |
| Anonymous → PIN `7788` | `200`، حساب مدير في أول tenant نشط | `401`/`429` |
| Anonymous → `POST /api/public/tables/qr/default/session` مع `restaurantId=rest-b` | `200` وsession صالح لطاولة B | `400`/`403`/`404` |
| Tenant-A QR session → unknown/foreign product بسعر `0` | `201`، total=`0` وforeign product ID محفوظ | `400`، لا order |
| `GET /api/public/restaurants/not-a-real-slug` | `200` وبيانات أول Restaurant نشط | `404` |
| `GET /api/public/restaurants/mureeh` وstatus=SUSPENDED | `200` وتم حفظ `ACTIVE` | `403`، بلا تغيير حالة |
| upload اسمُه `.html` مع MIME مزعوم `image/png` | upload `200` ثم served كـ `text/html` مع `<script>` | رفض أو raster re-encode آمن |
| bearer JWT صالح → `/api/auth/me` و`/api/auth/logout` | كلاهما `401` | `200`؛ logout يجب أن يبطل الجلسة |
| Origin عدائي مع `CORS_ORIGIN=''` | `Access-Control-Allow-Origin: https://evil.example` و`Allow-Credentials: true` | لا reflection مع credentials |
| malformed JSON | `400` مع parser detail (`position …`) | رسالة generic فقط |

> **ملاحظة تقنية:** تنزيل Prisma engine فشل بسبب انقطاع TLS إلى `binaries.prisma.sh` في بيئة التدقيق، لذلك لم تُشغَّل قاعدة PostgreSQL فعلية. تم الفصل بوضوح بين ما تأكد بالـ local handler harness وما استُنتج من trace مصدر مباشر. لا يقلل ذلك من صحة المسارات المذكورة؛ يجب إعادة تنفيذ `security-tests/` ضد PostgreSQL ephemeral بعد الإصلاح.

---

## 2) Architecture وخريطة تدفق الثقة

### Frontend

- React 19 + Vite، مع `AuthContext` و`RestaurantContext` كمصدر حالة UI.
- `src/services/api.ts` هو HTTP client؛ يستخدم `VITE_API_URL` أو relative `/api` في المتصفح.
- access JWT مخزّن في `localStorage` باسم `merar_auth_token` (`src/services/api.ts:44`, `src/context/AuthContext.tsx`).
- guards والـ tabs في `AuthContext` UI/UX فقط. لا يمكن اعتبارها security boundary لأنها قابلة للتجاوز بطلب HTTP مباشر.
- صفحة العميل تستخدم رابط QR `/r/:slug?qr=<token>` وتنشئ TableSession عامة.

### Backend / API

- Node.js + Express 5 في `server/index.ts`.
- `/api/manager`, `/api/admin`, `/api/uploads` فقط تمر عبر `authenticateToken` عند mount. **`/api/auth` لا يمر عبره**، لذلك `/me` و`/logout` لا يحصلان على `req.user`.
- JWT HS256 افتراضياً عبر `jsonwebtoken`، 7 أيام، payload يحوي `id`, `restaurantId`, `email`, `role`, `status`.
- Prisma 5 / PostgreSQL؛ لا يوجد raw SQL في source المفحوص.
- SSE in-memory في `server/services/realtime.ts`.

### Database / tenancy

- `Restaurant` هو tenant root.
- أغلب الموارد تحمل `restaurantId`: users, tables, sessions, categories, products, orders, waiter requests, offers, branches, payments, audit logs.
- توجد indexes على `restaurantId`، وقيود جيدة مثل `@@unique([restaurantId, number])` للطاولات.
- لكن علاقات مثل `Product(categoryId)`, `Order(tableId/sessionId)`, `TableSession(tableId)`, `WaiterRequest(tableId/sessionId)` لا تستخدم foreign keys مركبة تشمل `restaurantId`. DB نفسها يمكنها قبول row يتصل بوالد من tenant آخر إذا أخطأ التطبيق أو استُخدم DB credential مباشرة.

### Roles الفعلية

| المصدر | roles |
|---|---|
| Prisma enum | `PLATFORM_ADMIN`, `SUPER_ADMIN`, `RESTAURANT_MANAGER`, `STAFF`, `WAITER`, `CASHIER` |
| Frontend type/UI | يضيف `GUEST` و`KITCHEN` |
| Manager staff API | يسمح بـ `KITCHEN` رغم عدم وجوده في Prisma enum |

يوجد **drift** بين backend schema والـ frontend: إنشاء `KITCHEN` أو demo PIN `9900` قد يفشل في Prisma بدلاً من تطبيق policy معرّفة. لا يوجد role `OWNER` منفصل أو نظام permissions مركزي.

### Uploads والخدمات الخارجية والنشر

- Multer disk storage → `/uploads` static public من نفس origin.
- Google Fonts، Unsplash default images، WhatsApp links، PostgreSQL، Render/Vercel/Netlify هي integrations المرصودة. حزم Supabase موجودة لكن لا يوجد استهلاك ظاهر لها في source.
- Render يشغّل API وfrontend منفصلين. Docker Compose ينشر PostgreSQL وExpress ports علنياً على host.

### تدفق الثقة المطلوب والحالي

```text
Staff user
  → React/Vite (JWT in localStorage)
  → /api/manager/* Authorization: Bearer JWT
  → authenticateToken (signature + token claim فقط)
  → requireAuth
  → handler derives restaurantId from query/body/JWT
  → ownTenant / requireTenantAccess (غير موحد، غائب عن مسارين)
  → Prisma query / PostgreSQL

Customer
  → QR URL / public page
  → /api/public/tables/qr/:token/session
  → TableSession bearer capability
  → /api/public/orders | waiter | SSE
  → Prisma / PostgreSQL
```

### Security boundary failure points

1. **Browser → API:** JWT في localStorage + XSS من upload/print يساوي token theft.
2. **Anonymous → authentication:** demo email/password وmaster PIN يخلقان حسابات حقيقية.
3. **JWT → authorization:** key fallback معلوم، claims قديمة، لا session revocation أو DB re-check.
4. **Role → function:** backend لا يطبق permission matrix؛ UI guard قابل للتجاوز.
5. **Tenant ID → query:** `getTenantId` يثق في query/body قبل JWT ومسارا waiter/export بلا check.
6. **QR capability → session:** `default`/table ID/table number/fallback يحوّل معلومات متوقعة إلى capability.
7. **Tenant row → relational DB:** لا composite tenant FKs/RLS؛ creation product لا يتحقق من category owner.
8. **Tenant event → SSE:** restaurant-wide broadcast يصل للعميل table-scoped.
9. **Upload → same origin:** MIME/extension spoofing يعطي HTML/SVG على origin المدير.
10. **Deploy → data:** `db push --accept-data-loss` وdatabase public port.

---

## 3) Multi-tenant isolation: نتيجة الاختبار حسب المورد

`Platform Admin` استثناء مقصود فقط إذا كان الحساب حقيقياً ومُداراً بأمان. النتائج التالية تخص User A العادي في Restaurant A مقابل Restaurant B.

| المورد | قراءة B | إنشاء في B | تعديل/حذف B | الحكم الحالي |
|---|---|---|---|---|
| Restaurant/dashboard | محمي في `/dashboard/stats` | admin فقط | admin فقط | check موجود، لكن يصبح عديم القيمة بعد role escalation/JWT forge |
| Menu categories/products | GET query محمي بميدلوير `/menu` | tenant target محمي، **لكن product يمكن ربطه بـ category B** | direct resource ownership موجود | جزئي؛ لا role policy ولا DB invariant |
| Orders | list محمي | manager POS يتحقق من table/product، public order لا يرفض foreign/unknown product | status يتحقق من tenant فقط | QR bypass + zero price + أي role يستطيع status |
| Order export | **مكشوف** | N/A | N/A | `GET /manager/export/orders` بلا `ownTenant` |
| Tables | list/resource checks موجودة | target tenant check موجود | resource check موجود | QR session B ممكن دون QR؛ كل role يغيرها |
| Waiter requests | **مكشوف** | QR session مطلوب ظاهرياً | resource check موجود | `GET /manager/waiter-requests` بلا tenant check |
| Staff/users | list/resource tenant check | tenant check | tenant check فقط | كل موظف يستطيع إدارة staff وترقية نفسه إلى platform |
| Branding/settings | tenant check موجود | N/A | tenant check موجود | أي role tenant يمكنه تغيير settings/plan |
| Offers/branches/payments | tenant checks غالباً موجودة | موجودة | resource checks موجودة | لا RBAC، payment workflow ضعيف |
| QR tokens/sessions | tables GET محمي | N/A | regenerate owner check | `default`, IDs, table numbers وfallback تتجاوز capability |
| Files/images | static public إن عُرف URL | upload لأي authenticated role | لا metadata/ACL | لا tenant ownership أو private access model |
| Public slug | public by design | N/A | N/A | unknown slug يعيد tenant مختلف؛ غير مقبول كـ fallback |
| SSE/events | session/JWT ظاهرياً | N/A | N/A | table session يستقبل events لجميع طاولات نفس restaurant |

---

## 4) Permission matrix: المتوقع مقابل التطبيق الفعلي

| Resource/action | Platform admin | Restaurant manager/owner | Cashier | Waiter/Kitchen/Staff | Anonymous QR customer | **حالة backend الحالية** |
|---|---|---|---|---|---|---|
| Platform tenants, audit logs | CRUD/read platform | لا | لا | لا | لا | صحيح ظاهرياً، لكن promotion/JWT forge يفتحها |
| Restaurant branding/settings | كل tenants | own tenant | لا | لا | لا | **كل authenticated tenant role** يستطيع التعديل |
| Staff roles/passwords | كل tenants وفق workflow | own tenant، ولا platform roles | لا | لا | لا | **كل role** يستطيع create/update/delete؛ `PUT` يقبل platform roles |
| Menu/category/product | كل tenants | own tenant | read فقط أو وفق policy | لا | public read published only | **كل role** يمكنه CRUD داخل tenant |
| Tables/QR | كل tenants | own tenant | limited read/settle | limited status | QR-bound read only | **كل role** يمكنه create/update/settle/regenerate QR |
| Orders/status | كل tenants | all own orders | create/pay, limited status | kitchen status only | own session orders only | **كل role** يغير status؛ customer session ليست order-scoped |
| Payments | all | read only/approved | create/read | لا | لا | **كل role** يستطيع read/create payment |
| Subscription/plan/branches | platform/billing workflow | read/request change | لا | لا | لا | **كل role** يغيّر plan ويخلق branches؛ لا payment/entitlement enforcement |
| Public waiter call | N/A | N/A | N/A | N/A | same valid table/session | session bypass يسمح باستعمال طاولة B |

**الاستنتاج:** لا توجد `requireRole` أو `requirePermission` على manager routes. `ownTenant()` يمنع بعض cross-tenant operations لكنه لا يقرر أن actor يملك الوظيفة المطلوبة. هذا هو OWASP API5 Broken Function Level Authorization.

---

## 5) جرد الـ API المكتشف

**الاختصارات:** `Bearer` = JWT مطلوب فعلياً، `QR` = TableSession capability، `Any` = أي user مصادق عليه، `PA` = Platform/Super Admin، `T` = tenant check موجود، `Obj` = ownership check للـ row. `—` = لا ينطبق. لا توجد routes مستقلة باسم `/api/restaurants`, `/api/users`, أو `/api/events`؛ وظائفها أدناه تحت `/admin`, `/manager`, `/public`.

### Authentication, public, and uploads

| Method | Endpoint | Auth فعلي | Role فعلي | Tenant / object check | ملاحظة أمنية |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | لا | — | — | demo auto-provision/password override |
| GET | `/api/auth/me` | **مقصود Bearer لكن مكسور** | — | user ID | mount لا يستعمل `authenticateToken` |
| POST | `/api/auth/logout` | **مقصود Bearer لكن مكسور** | — | — | لا revoke حتى لو أصلح parsing |
| POST | `/api/auth/pin` | لا | — | caller-controlled restaurant | master PINs وscan عالمي |
| POST | `/api/auth/password-reset-request` | لا | — | email | generic response جيد، لكن لا reset workflow فعلي |
| GET | `/api/public/events` | QR أو JWT query/header | QR/JWT tenant | session rest+table | broadcast واسع وtoken في URL |
| GET | `/api/public/restaurants/:slug` | لا | — | slug | unknown slug → first active tenant |
| GET | `/api/public/tables/qr/:qrToken` | لا | — | token | exact QR lookup جيد هنا فقط |
| POST | `/api/public/tables/qr/:qrToken/session` | لا | — | **ضعيف** | يقبل default/table ID/number/fallback/create |
| POST | `/api/public/orders` | QR session | — | table/session، product **جزئي** | foreign/unknown product وclient price fallback |
| POST | `/api/public/orders/:orderId/cancel` | QR session | — | table-level، لا order session | session أخرى للطاولة تستطيع الإلغاء |
| PUT | `/api/public/orders/:orderId/notes` | QR session | — | table-level، لا order session | نفس المشكلة |
| POST | `/api/public/waiter-requests` | QR session | — | table/session | input unvalidated، limit فقط per-table 45s |
| POST | `/api/uploads/image` | Bearer | **Any** | لا tenant/file ownership | MIME spoof + public static serving |
| GET | `/uploads/:file` | لا | — | لا ACL | نفس origin وpublic |
| GET | `/api/health` | لا | — | — | يكشف database/version fingerprint |

### Manager API

| Method | Endpoint | Auth/role فعلي | T | Obj | ملاحظة |
|---|---|---|---:|---:|---|
| GET | `/manager/dashboard/stats` | Bearer / Any | نعم | — | direct tenant comparison |
| GET | `/manager/orders` | Bearer / Any | نعم | — | list scoped جيداً |
| POST | `/manager/orders` | Bearer / Any | نعم | table+product | لا option/add-on pricing ولا RBAC |
| PUT | `/manager/orders/:orderId/status` | Bearer / Any | نعم | نعم | state machine ضعيفة/status unvalidated |
| GET | `/manager/tables` | Bearer / Any | نعم | — | يعيد QR tokens لكل role |
| POST | `/manager/tables` | Bearer / Any | نعم | — | no role/plan/schema validation |
| PUT | `/manager/tables/:id` | Bearer / Any | عبر obj | نعم | أي role يغير status/branch |
| POST | `/manager/tables/:id/settle` | Bearer / Any | عبر obj | نعم | يسوي unpaid orders بلا payment gate |
| POST | `/manager/tables/:id/regenerate-qr` | Bearer / Any | عبر obj | نعم | `Math.random` + predictable token layout |
| GET/POST | `/manager/menu/categories` | Bearer / Any | نعم (route middleware) | — | no role/input limits |
| PUT/DELETE | `/manager/menu/categories/:id` | Bearer / Any | عبر obj | نعم | ownership موجود |
| GET/POST | `/manager/menu/products` | Bearer / Any | نعم (route middleware) | POST لا category check | product create يمكنه ربط category B |
| PUT/DELETE | `/manager/menu/products/:id` | Bearer / Any | عبر obj | نعم | update category check جيد نسبياً |
| PUT | `/manager/menu/products/:id/stock` | Bearer / Any | عبر obj | نعم | no role |
| GET | `/manager/waiter-requests` | Bearer / Any | **لا** | **لا** | confirmed BOLA data leak |
| PUT | `/manager/waiter-requests/:id/status` | Bearer / Any | عبر obj | نعم | no role/status schema |
| GET | `/manager/export/orders` | Bearer / Any | **لا** | **لا** | confirmed BOLA + CSV formula injection |
| GET/POST | `/manager/staff` | Bearer / Any | نعم | — | any role can administer staff |
| PUT/DELETE | `/manager/staff/:id` | Bearer / Any | عبر obj | نعم | arbitrary role, hashes in response |
| GET/POST | `/manager/offers` | Bearer / Any | نعم | — | no role/schema |
| PUT/DELETE | `/manager/offers/:id` | Bearer / Any | عبر obj | نعم | no role/schema |
| GET | `/manager/subscription` | Bearer / Any | نعم | — | no role |
| PUT | `/manager/subscription/plan` | Bearer / Any | نعم | — | free plan change / no billing |
| PUT | `/manager/branding` | Bearer / Any | نعم | restaurant | no role/schema |
| GET/POST | `/manager/branches` | Bearer / Any | نعم | — | no role/entitlement |
| PUT/DELETE | `/manager/branches/:id` | Bearer / Any | عبر obj | نعم | ownership موجود |
| POST | `/manager/branches/assign-tables` | Bearer / Any | نعم | branch/tables | ownership checks جيدة هنا |
| GET/POST | `/manager/payments` | Bearer / Any | نعم | table/orders جزئي | no role, no table-to-order binding, race |

### Platform admin API

| Method | Endpoint | Auth / role | Tenant/object requirement | ملاحظة |
|---|---|---|---|---|
| GET | `/api/admin/overview` | Bearer + PA | platform-wide intended | مناسب للدور الصحيح، لكن role forge يفتحه |
| POST | `/api/admin/restaurants/:id/status` | Bearer + PA | restaurant ID | status بلا strict schema |
| POST | `/api/admin/onboard-restaurant` | Bearer + PA | creates tenant | لا zod/limits/transaction كاملة؛ bcrypt cost 10 |
| GET | `/api/admin/audit-logs` | Bearer + PA | platform-wide intended | مناسب للدور الصحيح، لكن role forge يفتحه |

---

# 6) Findings مرتبة حسب الخطورة

## CRITICAL

### C-01 — Backdoors تجريبية عامة تؤدي إلى account takeover لأول tenant نشط

- **Severity:** Critical
- **CWE / OWASP:** CWE-798 (Hard-coded Credentials)، CWE-306 (Missing Authentication for Critical Function)؛ OWASP A07 Authentication Failures، OWASP API2 Broken Authentication.
- **المواضع / endpoints:** `server/routes/auth.ts:35-83`، `POST /api/auth/login`؛ `server/routes/auth.ts:209-291`، `POST /api/auth/pin`.
- **Root cause:** login ينشئ manager عند أي email يبدأ `demo@` ويربطه بأول Restaurant نشط؛ أي email يحوي `demo` يقبل أحد كلمات مرور demo الثابتة ويتجاوز bcrypt. PIN endpoint ينشئ حسابات حقيقية لدوال مختلفة عند PINs ثابتة منها `7788` الذي ينشئ `RESTAURANT_MANAGER` في أول tenant نشط.
- **Attack scenario:** مهاجم مجهول يرسل login باسم demo جديد وكلمة يختارها، أو يرسل PIN demo؛ يحصل على JWT حقيقي لمطعم عميل. لا يحتاج معرفة حساب العميل أو QR.
- **Impact:** takeover كامل للـ first active tenant، تعديل المنيو/الطلبات/الموظفين، ثم platform escalation عبر C-03.
- **Exact remediation:** احذف كل demo branches وmaster PINs وauto-provision من production source، وليس فقط إخفاء UI. إذا لزم demo، اجعله deployment منفصلاً بدومين/DB/secret منفصل أو feature محمياً بـ `NODE_ENV === 'development'` ورفض صريح في production.
- **Recommended code change:** login يجب أن ينفذ فقط `findUnique(email)` ثم `bcrypt.compare`; PIN يجب أن يبحث ضمن restaurant مثبت مسبقاً وبـ rate limit، ولا ينشئ user. لا تستخدم أي password override.
- **Verification test:** `POST /api/auth/login` لأي `demo@…` غير موجود و`POST /api/auth/pin` لكل master PIN يجب أن يعيد `401`/`429` ولا يزيد عدد users/restaurants. أدرج AU-02 وTI-01 في `security-tests/README.md` كـ release gate.

### C-02 — مفتاح JWT احتياطي hard-coded يسمح بتزوير Platform Admin عند غياب environment secret

- **Severity:** Critical
- **CWE / OWASP:** CWE-321 (Use of Hard-coded Cryptographic Key)، CWE-347؛ OWASP A02 Cryptographic Failures وA07 Authentication Failures، OWASP API2.
- **المواضع / endpoints:** `server/middleware/auth.ts:22-48`؛ نسخة ثانية في `server/routes/public.ts:35-39`. كل `/api/manager/*` و`/api/admin/*`، وSSE.
- **Root cause:** التطبيق يقع على fallback secret موجود في source بدلاً من رفض startup حين `JWT_SECRET` مفقود/قصير. role وrestaurantId من token موثوقان بعد ذلك مباشرة.
- **Attack scenario:** configuration خطأ أو secret غير محمّل في production. أي شخص يقرأ source أو artifact يوقّع JWT فيه `role=PLATFORM_ADMIN` ويرسل إلى `/api/admin/audit-logs` أو overview. تم تأكيد قبول token platform مزوّر محلياً عندما كان env فارغاً.
- **Impact:** platform-wide data disclosure/control لجميع restaurants.
- **Exact remediation:** rotate JWT secret الآن (اعتبر fallback مكشوفاً)، أبطل كل JWTs القديمة، واحذف fallback من كل موضع. افشل startup قبل listen إذا لم يوجد secret عالي entropy (32 bytes/256-bit على الأقل).
- **Recommended code change:** استخدم config module مع `z.object({JWT_SECRET: z.string().min(32), ...}).parse(process.env)`؛ حدّد `algorithms: ['HS256']`, `issuer`, `audience` عند sign/verify، ولا تكرر verification logic في public route.
- **Verification test:** process started بلا `JWT_SECRET` يجب أن ينتهي non-zero قبل فتح port. JWT signed بمفتاح سابق/خاطئ أو `alg=none` يعيد `401`; JWT صحيح له issuer/audience خاطئ يعيد `401`.

### C-03 — Broken Function-Level Authorization: أي موظف يرقّي نفسه إلى Platform Admin ويسرّب hashes

- **Severity:** Critical
- **CWE / OWASP:** CWE-269 (Improper Privilege Management)، CWE-862 (Missing Authorization)، CWE-200؛ OWASP A01 Broken Access Control وOWASP API5 Broken Function Level Authorization/API3 Broken Object Property Level Authorization.
- **المواضع / endpoints:** `server/routes/manager.ts:17-32, 977-1106`؛ خصوصاً `PUT /api/manager/staff/:id` عند `1055-1064` و`POST /api/manager/staff`؛ كل manager routes تعتمد `requireAuth`/`ownTenant` فقط.
- **Root cause:** لا يوجد `requireRole`/permission. update staff يمرّر `role` من body مباشرة إلى Prisma بلا allow-list أو منع `PLATFORM_ADMIN`/`SUPER_ADMIN`. create يسمح لأي role بإنشاء `RESTAURANT_MANAGER`. Prisma return الكامل يوضع في response عند POST/PUT، وفيه `passwordHash` و`pinHash`.
- **Attack scenario:** Waiter A يرسل `PUT /manager/staff/<own-id>` مع `{"role":"PLATFORM_ADMIN"}`؛ يسجّل دخولاً من جديد ليحصل على JWT الجديد ثم يقرأ كل tenants. أو ينشئ manager باسم يختاره. ويمكنه تعديل user آخر ليعيد hashes لاستخدام offline cracking.
- **Impact:** platform takeover، cross-tenant compromise، staff credential/PIN hash disclosure، destruction of staff/accounts.
- **Exact remediation:** أنشئ permission middleware مركزي. فقط restaurant manager/owner يستطيع إدارة staff لtenant نفسه؛ لا يستطيع أي tenant actor تعيين platform role مطلقاً. حدّد hierarchy لمن يمكنه تغيير من، امنع self-promotion وlast-manager deletion، وأعد select آمن فقط.
- **Recommended code change:** `requirePermission('staff:manage')` قبل routes؛ `StaffUpdateSchema.strict()` بroles tenant-only؛ response `select: {id, restaurantId, name, email, role, status, avatar, createdAt}` فقط. لا تعيد `passwordHash`, `pinHash`, reset/session data أبداً.
- **Verification test:** TI-09/TI-10: waiter/cashier/staff → staff POST/PUT/DELETE وbranding/plan/menu يجب `403`; manager → `role=PLATFORM_ADMIN` يجب `400/403`; response JSON لا يحتوي `passwordHash|pinHash`.

### C-04 — BOLA مؤكد: User A يقرأ waiter requests وCSV orders الخاصة بـ Restaurant B

- **Severity:** Critical
- **CWE / OWASP:** CWE-639 (Authorization Bypass Through User-Controlled Key)، CWE-862؛ OWASP A01 وOWASP API1 Broken Object Level Authorization.
- **المواضع / endpoints:** `server/routes/manager.ts:845-853` (`GET /api/manager/waiter-requests`) و`897-918` (`GET /api/manager/export/orders`).
- **Root cause:** كلا handler يأخذ `restaurantId` من `getTenantId(req)` ثم ينفذ Prisma query مباشرة بلا `ownTenant(req, restaurantId)` أو `requireTenantAccess`.
- **Attack scenario:** User A يبدل query إلى `?restaurantId=<B>` أو يعيد الطلب يدوياً. النتيجة تشمل waiter reason/note، table IDs، order IDs، timestamps، totals، notes وCSV.
- **Impact:** cross-tenant data leakage صريح؛ انتهاك أهم ضمان SaaS والعزل المطلوب.
- **Exact remediation:** لا تأخذ tenant scope للـ normal tenant من query/body. استخرجه من server-side authenticated principal. platform impersonation فقط عبر route صريح محمي بـ PA ومُسجّل audit. طبّق middleware واحد على كل manager endpoint.
- **Recommended code change:** في هذين المسارين على الأقل: `if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);` قبل أي query. الأفضل `const restaurantId = requireTenantScope(req)` حيث يعود JWT restaurantId لغير platform.
- **Verification test:** شغّل read-only runner `security-tests/api-security-smoke.mjs` مع token A وtenant B؛ TI-03 يجب `403/404`. لا يكفي اختبار client mock.

### C-05 — تجاوز QR، إنشاء session في Restaurant B دون QR، وتجاوز suspension من public endpoint

- **Severity:** Critical
- **CWE / OWASP:** CWE-306، CWE-639، CWE-285؛ OWASP A01، A04 Insecure Design، OWASP API1/API2.
- **المواضع / endpoints:** `server/routes/public.ts:296-414` (`POST /api/public/tables/qr/:qrToken/session`)؛ `69-154` (`GET /api/public/restaurants/:slug`).
- **Root cause:** session route يقبل `qrToken` كـ token أو table ID أو table number، وعند `default`/invalid token يختار أول table لمطعم supplied في body/slug، وقد ينشئ table عامة إذا لا توجد. كما يعيد تفعيل restaurant suspended خاص باسم `mureeh` من request عام. public restaurant route يعيد أول active restaurant عند slug غير موجود.
- **Attack scenario:** مهاجم يرسل `/tables/qr/default/session` مع B restaurantId (المتاح من public menu)، يحصل على B table session ثم يرسل orders/cancel/notes/waiter calls. request عام إلى slug mureeh يعيد تفعيل مطعم أوقفه platform admin.
- **Impact:** QR capability تصبح غير موجودة، abuse للطلبات وطاولات B، تجاوز قرار suspension، data integrity/availability، disclosure لمطعم خاطئ.
- **Exact remediation:** session creation يجب أن يكون lookup exact لQR opaque فقط؛ لا `id`, `number`, `default`, fallback، ولا create table من route public. slug غير الموجود = `404` دائماً. `SUSPENDED`, `MAINTENANCE`, `ONBOARDING` لا تُغيّر ولا تقبل public operations إلا policy صريحة من platform admin.
- **Recommended code change:** استبدل OR block بـ `findUnique({ where: { qrToken: opaqueToken } })` وبعده تأكد أن slug/restaurantId إن أُرسل يطابق table.restaurantId، وإلا `404`. ولّد QR بـ `randomBytes(32)`/UUID CSPRNG (والأفضل store hash) وألغِ `Math.random` regeneration في manager route.
- **Verification test:** TI-06 وAPI-01: `default`, `1`, predictable tableId، invalid token وunknown slug كلها `400/403/404` ولا تنشئ table/session ولا تغير status.

### C-06 — Price manipulation وcross-tenant product association في public orders، مع stored XSS chain في الفواتير

- **Severity:** Critical
- **CWE / OWASP:** CWE-20 (Improper Input Validation)، CWE-840/CWE-841 (Business Logic/Workflow)، CWE-79؛ OWASP A03 Injection، A04 Insecure Design، OWASP API1/API6.
- **المواضع / endpoints:** `server/routes/public.ts:417-537`, خصوصاً `468-486` و`502-512`; sinks في `src/components/manager/OrderManagement.tsx:31-35` و`src/components/manager/CashierPOSView.tsx:255-289`.
- **Root cause:** products query filters by restaurant لكنه لا يرفض item IDs غير الموجودة/foreign. عند product غير موجود يستخدم `item.unitPrice || item.price || 0` من client. `productName` snapshot أيضاً من client. print views تدخل values داخل HTML عبر `document.write` بلا HTML escaping.
- **Attack scenario:** صاحب QR session (الممكن الحصول عليه بـ C-05) يرسل product ID لـ B أو ID وهمياً مع `unitPrice: 0` واسم مثل `<img ... onerror=...>`. server ينشئ order بقيمة صفر ويربط foreign product ID. manager يطبع invoice فينفذ script على same origin ويقرأ localStorage JWT.
- **Impact:** طلبات مجانية/فواتير مزيفة، corruption لعلاقات tenant، account takeover للمدير عبر XSS، potential platform compromise.
- **Exact remediation:** strict Zod schema للطلب، IDs فقط، quantity bounded، ورفض كامل إذا `products.length !== uniqueRequestedProductIds.length` أو product غير available. server فقط يقرر name snapshot/price/options/add-ons. لا تستخدم `document.write` مع user-controlled values؛ ابن printable React DOM بـ text nodes أو escape كل value.
- **Recommended code change:** fetch products بـ `{ restaurantId, available: true, id: { in: productIds } }`; map only from DB. تحقق من option/addOn IDs التابعة لنفس product واحسب modifiers في server. استخدم `Decimal` للأموال. افصل `order.id` UUID عن human sequence.
- **Verification test:** FIN-01/TI-07 وXSS-01: foreign/unknown item أو client total/price 0 → `400` ولا row؛ HTML payload يظهر كنص في الفاتورة ولا ينفذ.

### C-07 — Unrestricted file upload يسمح باستضافة HTML/SVG تنفيذي على origin التطبيق

- **Severity:** Critical
- **CWE / OWASP:** CWE-434 (Unrestricted Upload of File with Dangerous Type)، CWE-79؛ OWASP A03 Injection وA05 Security Misconfiguration.
- **المواضع / endpoints:** `server/routes/uploads.ts:14-53`، static serving في `server/index.ts:89-97`.
- **Root cause:** يعتمد filter على client-supplied `file.mimetype.startsWith('image/')` ويحافظ على extension من `originalname`. ملف `payload.html` مع MIME مزعوم `image/png` يحفظ `.html` ويُخدم من `/uploads` كـ `text/html`. لا يوجد magic-byte verification/re-encode، tenant metadata، ACL، أو isolated origin.
- **Attack scenario:** أي authenticated role يرفع JavaScript باسم `.html` أو SVG. يرسل الرابط لmanager أو يربطه بصورة؛ فتحه ينفذ على same origin ويمكنه سرقة localStorage JWT. تم تأكيد response `Content-Type: text/html` محلياً.
- **Impact:** stored XSS، session takeover، data manipulation، انتشار cross-tenant بعد token theft.
- **Exact remediation:** allow-list JPEG/PNG/WebP فقط، افحص signature حقيقية ثم decode/re-encode باستخدام image library، تجاهل original extension/name، واستخدم random CSPRNG key وfixed `.webp`/`.png`. ضع media على origin مختلف بلا cookies/localStorage، وسجّل tenant/uploader/object metadata؛ استخدم signed URLs للصور الخاصة.
- **Recommended code change:** لا تعتمد على MIME header؛ `sharp`/equivalent decode ثم `toFormat('webp')`. ارفض SVG/HTML/GIF unless separately sanitized. `Content-Disposition: attachment` للملفات غير الموثوقة و`X-Content-Type-Options: nosniff`.
- **Verification test:** UP-01: `.html`, `.svg`, polyglot، oversized، filename traversal، fake MIME جميعها تُرفض أو تعاد rasterized؛ URL الناتج لا يخدم `text/html` ولا script.

## HIGH

### H-01 — SSE يسرب أحداث/metadata كل طاولات المطعم، وJWT/QR tokens في URL logs

- **Severity:** High
- **CWE / OWASP:** CWE-200، CWE-598 (Information Exposure Through Query Strings)؛ OWASP A01/A02، OWASP API1/API3.
- **المواضع / endpoints:** `server/routes/public.ts:24-67`; `server/services/realtime.ts:24-47`; `src/context/RestaurantContext.tsx:411-434`; `src/services/api.ts:542-552` (cancel session query).
- **Root cause:** client authenticated for one table يُسجل ضمن restaurant، لكن producers يستدعون `broadcastToRestaurant`, لا `broadcastToTable`. Event payload يحوي orderId/tableId/total، waiter reason/note وpayment data. Frontend يرسل access JWT في `?token=`، وmorgan يسجل URL/query.
- **Attack scenario:** customer at table A يفتح SSE ويستقبل ORDER_CREATED/WAITER_CALL/PAYMENT events لطاولات B داخل نفس restaurant. Proxy logs/browser history/referrer tooling قد تحفظ JWT وsessionToken.
- **Impact:** cross-table customer privacy leak، credentials leakage، unbounded SSE connection abuse.
- **Exact remediation:** افصل staff stream عن customer stream. customer يحصل فقط events الخاصة بـ `sessionId`/table وبـ minimal payload؛ لا bearer access token في URL. استخدم short-lived single-use SSE ticket أو HttpOnly cookie مع Origin checks، connection limit/heartbeat/timeout وRedis/pubsub عند scaling.
- **Recommended code change:** maintain audience type and call a table/session-specific broadcaster; verify `order.sessionId === authenticatedSession.id`. Redact query strings من access logs أو لا تضع secrets فيها.
- **Verification test:** SSE-01: event في table B لا يظهر في stream session A؛ logs لا تحتوي token/sessionToken/JWT.

### H-02 — Session lifecycle غير آمن/غير عامل: `/me` وlogout مكسوران، JWT لا يُبطل ولا يُراجع DB

- **Severity:** High
- **CWE / OWASP:** CWE-613 (Insufficient Session Expiration)، CWE-384 (Session Fixation/management weakness)؛ OWASP A07، OWASP API2.
- **المواضع / endpoints:** `server/index.ts:103-126`; `server/routes/auth.ts:161-206`; `server/middleware/auth.ts:24-57`; `src/services/api.ts:416-425`; `src/context/AuthContext.tsx:228-235`.
- **Root cause:** auth routes mount بدون `authenticateToken`; `requireAuth` يرى `req.user` فارغاً. frontend يمسح token قبل استدعاء logout. logout يسجل event فقط ولا يملك blacklist/session table. authenticateToken يثق status/role داخل JWT لمدة 7 أيام ولا يعيد query user status أو restaurant status.
- **Attack scenario:** token مسروق يبقى صالحاً حتى expiry بعد logout، password reset، user suspend/delete أو role demotion. المستخدم الحقيقي يواجه 401 عند refresh لأن `/me` مكسور.
- **Impact:** عدم القدرة على terminate sessions، delayed containment بعد incident، broken UX/session assurance.
- **Exact remediation:** أضف `authenticateToken` قبل `/me` و`/logout` (أو router-level optional auth)، وأرسل logout request قبل local clear. الأفضل short-lived access token + rotating refresh sessions مخزنة hashed مع `revokedAt`/`sessionVersion`; تحقق من user/tenant status عند كل request حساس.
- **Recommended code change:** access TTL 5–15 min، refresh cookie `HttpOnly; Secure; SameSite=Lax/Strict` مع CSRF/Origin protection، أو server-side session ID. استخدم `JWT_EXPIRES_IN` config بدلاً من hard-coded 7d.
- **Verification test:** AU-01/AU-03: valid token → `/me` 200؛ بعد logout/suspend/password change/revocation → protected API 401/403 فوراً؛ token never returns after client clears it before request.

### H-03 — لا توجد database-enforced tenant invariants؛ product creation يقبل Category من Tenant B

- **Severity:** High
- **CWE / OWASP:** CWE-863 (Incorrect Authorization)، CWE-668؛ OWASP A01/A04، OWASP API1.
- **المواضع / endpoints:** `prisma/schema.prisma:186-351` و`402-444`; `server/routes/manager.ts:682-755`.
- **Root cause:** relations تعتمد global IDs فقط. POST product لا يفحص أن `categoryId` ينتمي إلى `targetRestId`; DB FK يثبت category exists فقط. النمط يتكرر مع tables/sessions/orders/waiter requests/branches.
- **Attack scenario:** manager A ينشئ product يحمل `restaurantId=A, categoryId=B`. DB تقبله، وقد تظهر/تُعامل علاقة B في queries لاحقة. bug مستقبلي أو direct DB access قادر على تكوين cross-tenant graphs بسهولة.
- **Impact:** tenant data integrity breach، future BOLA harder to prevent، potential indirect leakage.
- **Exact remediation:** افحص owner في كل create/update relation، ثم أضف defense in depth: unique composite keys `[id, restaurantId]` على parents وعلاقات FK مركبة حيث Prisma/Postgres يسمح، أو transaction triggers/checks؛ استخدم DB role/RLS carefully for normal app connections.
- **Recommended code change:** قبل create product: `category.findFirst({where:{id: categoryId, restaurantId: targetRestId}})` ثم 400 إن غابت. اعمل هذا لكل table/session/product/order/branch association. لا تعتمد فقط على `findUnique({id})` في resource tenant-owned.
- **Verification test:** Tenant A POST product/categoryId=B، order/table/session associations cross-tenant → `400/403`; DB invariant integration test يحاول insert direct ويتوقع FK/check failure.

### H-04 — Payment/order workflow قابل للتلاعب والسباق

- **Severity:** High
- **CWE / OWASP:** CWE-841 (Improper Enforcement of Behavioral Workflow)، CWE-362 (Race Condition)؛ OWASP A04، OWASP API6.
- **المواضع / endpoints:** `server/routes/manager.ts:1473-1588`; `209-310`; schema `Order`/`Payment`.
- **Root cause:** أي role يستطيع payment. cash أقل من total ما زال يؤدي إلى `PAID`; orders المختارة لا تُقيد بـ supplied `tableId`; transaction لا يعيد شرط `paymentStatus=UNPAID` ولا row lock; receipt sequence يحسب count per tenant بينما `receiptNumber @unique` global. `orderId=#${count+1001}` global/predictable ويصطدم بين tenants/concurrency.
- **Attack scenario:** actor يدفع `cashReceived=0` ويحدد CASH فيعلّم invoices paid، أو يربط orders من table مختلفة بفواتير table مختارة. طلبا دفع متزامنان يمكن أن يسجلا inconsistent payments/double charge.
- **Impact:** خسارة مالية، fraud، reconciliations خاطئة، denial of service عند receipt/order collision.
- **Exact remediation:** فقط `CASHIER`/manager وفق policy ينفذ payment. assert كل orders لنفس restaurant **ونفس table**، require cash >= amount، whitelist methods. استخدم transaction isolation/conditional update and verify affected count، payment-to-order relation normalized، unique receipt sequence scoped per tenant atomically.
- **Recommended code change:** `updateMany({where:{id:{in}, restaurantId, tableId, paymentStatus:'UNPAID'}, ...})` داخل transaction ثم assert count equals requested; UUID order primary IDs و`@@unique([restaurantId, receiptNumber])`; Decimal for money.
- **Verification test:** FIN-01: short cash, foreign table order, repeat/concurrent payment، receipt first payment في tenant A/B → deterministic 400/409 ولا duplicate/paid corruption.

### H-05 — CORS fail-open مع credentials، CSP معطلة

- **Severity:** High
- **CWE / OWASP:** CWE-942 (Permissive CORS Policy)، CWE-693؛ OWASP A05 Security Misconfiguration، OWASP API8.
- **المواضع / endpoints:** `server/index.ts:23-48`.
- **Root cause:** عندما `CORS_ORIGIN` فارغ (أو configuration خطأ)، callback يقبل أي Origin ومع `credentials:true`. `helmet({ contentSecurityPolicy: false })` يعطل CSP صراحة.
- **Attack scenario:** أي site يرسل Origin خاصاً به؛ تم تأكيد انعكاس origin مع credentials. حالياً bearer header لا يُرسل تلقائياً، لكن cookies/credentials مستخدمة في config، وأي migration للcookies سيصبح CSRF/cross-origin data risk فوراً. غياب CSP يرفع أثر C-06/C-07.
- **Impact:** browser trust boundary ضعيف، future auth migration خطر، defense-in-depth ضد XSS معدوم.
- **Exact remediation:** في production افشل startup عندما origin allow-list فارغ. لا تفعّل credentials إن لم تستخدم cookies. استخدم exact HTTPS origins فقط، لا reflection، وCSP production مناسبة.
- **Recommended code change:** `origin: allowedOrigins` مع `credentials: usesCookieAuth`; `if (isProd && allowedOrigins.length===0) throw`. CSP مثال: `default-src 'self'; script-src 'self'; connect-src 'self' https://api.example; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` (راجع domains الفعلية قبل deploy).
- **Verification test:** hostile Origin لا يحصل على reflected ACAO+ACAC؛ response يحمل CSP وPermissions-Policy. راجع CORS preflight للـ frontend origin فقط.

### H-06 — لا توجد server-side rate limits؛ PIN brute force/CPU DoS وcredential stuffing ممكنان

- **Severity:** High
- **CWE / OWASP:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)، CWE-400؛ OWASP A07، OWASP API4/API6.
- **المواضع / endpoints:** `server/routes/auth.ts:16-159, 209-317, 319-343`; `server/index.ts` (لا rate-limit middleware). UI-only lockout في `src/context/AuthContext.tsx:40-45, 143-224`.
- **Root cause:** لا `express-rate-limit` أو Redis/IP/account counter، ولا request timeout. PIN endpoint يحضر candidates كثيرين ثم ينفذ `bcrypt.compareSync` على كل واحد؛ إذا restaurantId غائب يفحص users من كل tenants. public endpoints/SSE/orders أيضاً بلا global throttle.
- **Attack scenario:** bot يضرب login/PIN/reset أو يفتح SSE connections؛ يمكنه تجاوز localStorage UI lockout كلياً. PIN من 4 أرقام قابل للتخمين ويستهلك CPU متناسباً مع staff count.
- **Impact:** account compromise، denial of service، spam orders/waiter calls، billing/operational abuse.
- **Exact remediation:** rate limits موزعة (Redis) keyed by IP + normalized account + tenant/table where appropriate، backoff، CAPTCHA/abuse detection عند thresholds، limits للـ SSE/public orders/search. PIN يحتاج scope ثابت، digits only، minimum entropy وسياسة lockout server-side.
- **Recommended code change:** async bcrypt/argon2id، max 5 attempts/15 min per account+IP مع gradual delay، 429 generic; body size 1MB or lower للJSON، request timeout، SSE concurrent connection quota.
- **Verification test:** AU-02: after threshold، all client instances receive 429; omitted restaurantId لا يسبب all-tenant scan; public order and SSE quotas تحترم الحدود.

### H-07 — مسار النشر قد يحذف production data وقاعدة البيانات مكشوفة من Docker host

- **Severity:** High
- **CWE / OWASP:** CWE-693 (Protection Mechanism Failure)، CWE-668؛ OWASP A05.
- **المواضع / endpoints:** `package.json` scripts، `server/index.ts:219-224`, `Dockerfile:35`, `render.yaml:5-6`, `docker-compose.yml:12-13,30-31`.
- **Root cause:** `prisma db push --accept-data-loss` يعمل في Docker CMD وداخل server startup؛ Render build يشغّل `db push`. Compose يربط `5432:5432` و`3001:3001` على جميع interfaces، container يعمل root ولا يوجد TLS proxy في compose.
- **Attack scenario:** deploy schema change غير مقصود يسقط column/table أو يعيد schema؛ database reachable من الإنترنت إذا firewall غير مثالي ويصبح هدف password spraying/exploit. direct 3001 قد يكون HTTP بلا HTTPS.
- **Impact:** permanent data loss، DB compromise، credentials/network exposure.
- **Exact remediation:** استبدل كل `db push` production بـ migrations reviewed (`prisma migrate deploy`) داخل pipeline مع backup/approval؛ احذف `--accept-data-loss` بالكامل. لا تنشر PostgreSQL port خارج docker network، ضع API خلف TLS reverse proxy/load balancer، شغّل non-root/read-only where possible.
- **Recommended code change:** أضف migration directory، CI migration check، pre-deploy backup/restore test، `ports` للDB محذوف أو `127.0.0.1:5432:5432` للتطوير فقط. في prod لا expose app إلا عبر HTTPS proxy.
- **Verification test:** deploy dry-run لا يجري destructive schema sync؛ `ss`/cloud firewall يؤكد أن 5432 غير public؛ HTTPS/HSTS يمران.

### H-08 — Subscription entitlements/limits لا تُفرض server-side ويمكن تبديل الباقة مجاناً

- **Severity:** High
- **CWE / OWASP:** CWE-862، CWE-841؛ OWASP A04، OWASP API5/API6.
- **المواضع / endpoints:** `server/routes/manager.ts:1211-1262, 1319-1346, 404-449, 682-755`; frontend bypass في `src/context/RestaurantContext.tsx:444-451`.
- **Root cause:** أي authenticated role يغيّر `planId` إلى plan نشطة بلا billing authorization؛ endpoints create tables/products/categories/branches لا تطبق plan counts/entitlements. frontend يعيد `true` لأي entitlement.
- **Attack scenario:** staff يرسل `PUT /manager/subscription/plan` إلى enterprise، ثم ينشئ موارد بلا حد أو يستخدم features مدفوعة.
- **Impact:** revenue loss، abuse، tenant scope/quotas غير موثوقة.
- **Exact remediation:** plan changes يجب أن تأتي من verified billing provider/webhook أو platform billing role. server يحسب entitlements من current subscription ويضع checks transactionally قبل كل create/action.
- **Recommended code change:** `requirePermission('subscription:request')` فقط للowner؛ endpoint لا يكتب `ACTIVE` مباشرة. `enforceLimit(restaurantId,'tables')`, `requireEntitlement('CAN_CREATE_BRANCH')` server middleware؛ لا تعتمد على `checkEntitlement()` في UI.
- **Verification test:** PLAN-01: waiter/cashier لا يغير plan؛ manager لا يحصل enterprise دون approved test webhook؛ create رقم limit+1 يرد 409/403.

## MEDIUM

### M-01 — Input validation/mass assignment coverage غير كافية على معظم routes

- **Severity:** Medium
- **CWE / OWASP:** CWE-20، CWE-915 (Improperly Controlled Modification of Dynamically-Determined Object Attributes)؛ OWASP A03/A04، OWASP API3/API4.
- **المواضع / endpoints:** كل `server/routes/manager.ts` و`admin.ts` و`public.ts` تقريباً؛ Zod موجود فقط في login (`server/routes/auth.ts:10-14`).
- **Root cause:** استخدام `Number()`, casts (`as OrderStatus`, `as TableZone`)، `any`، arrays/strings غير bounded، ولا `.strict()` schemas. staff update/role هو المثال الأخطر، ولكن price/status/URLs/arrays/names/notes أيضاً غير validated.
- **Attack scenario:** request body يحوي negative/NaN/huge values، invalid enum، oversized arrays، malformed URLs/colors، unexpected role/status؛ بعضها يسبب 500 أو business corruption.
- **Impact:** DoS/storage abuse، bad data، policy bypasses، information exposure من errors.
- **Exact remediation:** schemas per endpoint، `z.object(...).strict()`، UUID/slug validation، `.max()` لكل string/array، finite positive money/int ranges، enum allow-lists، remove unknown fields، request body limit أقل.
- **Recommended code change:** validate before any DB query، return generic 400 field error; do not cast user strings directly to Prisma enums.
- **Verification test:** API-03/API-04: SQL/NoSQL-style objects, `__proto__`, huge arrays, negative/Infinity pricing, invalid role/status, malformed JSON → safe 400/413 بلا write/500.

### M-02 — CSV formula injection في order export

- **Severity:** Medium
- **CWE / OWASP:** CWE-1236؛ OWASP A03 Injection.
- **المواضع / endpoints:** `server/routes/manager.ts:897-918`.
- **Root cause:** `notes` user-controlled يضاف إلى CSV بين quotes فقط. Excel/LibreOffice قد تفسر cell يبدأ `=`, `+`, `-`, `@` كformula حتى داخل quoted CSV.
- **Attack scenario:** customer يضع note تبدأ formula؛ manager يفتح export في spreadsheet، فينفذ formula/link exfiltration بحسب client settings.
- **Impact:** workstation compromise/data exfiltration social-engineering path.
- **Exact remediation:** neutralize every untrusted CSV cell by prefixing apostrophe/space عند formula prefix، واستخدم CSV library. أصلح C-04 access control أولاً.
- **Recommended code change:** `safeCsvCell(value) { const s=String(value??''); return /^[=+\-@]/.test(s) ? "'"+s : s; }` ثم CSV escaping صحيح لكل fields.
- **Verification test:** export notes `=HYPERLINK(...)`, `+cmd`, `@…` تظهر literal text لا formula.

### M-03 — Error handler يعيد internal error messages للعميل

- **Severity:** Medium
- **CWE / OWASP:** CWE-209 (Generation of Error Message Containing Sensitive Information)؛ OWASP A05/API8.
- **المواضع / endpoints:** `server/index.ts:193-212`.
- **Root cause:** global handler يرسل `err.message` لأي error. malformed JSON أظهر parser location محلياً؛ Prisma/filesystem/driver messages قد تظهر في unhandled paths.
- **Attack scenario:** attacker يرسل malformed type/body أو يتسبب DB constraint error ويتعلم internals، paths، schema/ORM conditions.
- **Impact:** reconnaissance وتسريب معلومات يساعد exploitation.
- **Exact remediation:** log structured internal error with request ID server-side؛ response production ثابت `حدث خطأ غير متوقع` أو validation-specific safe errors فقط. Handle Multer/Prisma errors by code.
- **Recommended code change:** `const publicMessage = isExpectedClientError(err) ? err.publicMessage : 'Internal Server Error'`; لا serialize stack/message في prod.
- **Verification test:** malformed JSON, invalid enum, duplicate email, oversized upload, DB failure mocks لا تعيد `Prisma`, SQL, file paths, stack أو parser positions.

### M-04 — Password reset غير مكتمل ولا توجد password/MFA policy متماسكة

- **Severity:** Medium
- **CWE / OWASP:** CWE-640 (Weak Password Recovery Mechanism for Forgotten Password)؛ OWASP A07.
- **المواضع / endpoints:** `server/routes/auth.ts:319-343`; onboarding hash في `server/routes/admin.ts:179`.
- **Root cause:** reset request يسجل audit فقط؛ لا token hashed/expiry/single-use/email delivery/revocation. password schema login يقبل length 1 فقط، onboarding يستخدم bcrypt cost 10 بينما باقي routes غالباً 12. لا MFA للplatform.
- **Attack scenario:** لا يمكن احتواء compromise/reset password reliably؛ teams قد تعتمد workarounds أو passwords ضعيفة.
- **Impact:** account recovery غير آمن/غير عامل، delayed revocation، risk أعلى لمنصة SaaS.
- **Exact remediation:** implement standard reset: cryptographically random token، store hash only، expiry قصيرة، single use، generic response، rate limit، revoke sessions عند reset. Adopt password policy/breached-password check ومطلوب MFA/WebAuthn/TOTP لـ platform admins.
- **Recommended code change:** Argon2id preferred أو async bcrypt cost calibrated (12+)، consistent config. لا تسجل reset token أو password.
- **Verification test:** request response لا يكشف account existence؛ token expired/reused/guessed يفشل؛ successful reset invalidates sessions.

### M-05 — Public API يكشف identifiers/metadata أكثر من اللازم، وstatus policy غير كاملة

- **Severity:** Medium
- **CWE / OWASP:** CWE-200، CWE-201؛ OWASP API3/API8.
- **المواضع / endpoints:** `server/routes/public.ts:69-243, 245-294, 417-537`.
- **Root cause:** public responses تعيد `restaurantId`, category/product IDs، table ID، `sessionId`, internal status؛ order route يقبل كل status ما عدا SUSPENDED فقط، فيسمح `ONBOARDING`/`MAINTENANCE` عملياً حسب database value.
- **Attack scenario:** IDs تساعد C-05/C-06 enumeration/parameter tampering؛ maintenance restaurant قد يقبل order.
- **Impact:** unnecessary attack surface، policy bypass، privacy leakage.
- **Exact remediation:** public DTOs minimal purpose-specific؛ لا تعيد sessionId/internal IDs إلا عند الحاجة، واستعمل public opaque IDs إن أمكن. Allow public catalog/orders فقط عندما `status === ACTIVE` وsubscription policy صالحة.
- **Recommended code change:** explicit `.select`/DTO لكل public endpoint بدل returning Prisma object؛ central `isPubliclyAvailable(restaurant)`.
- **Verification test:** public response schema snapshot لا تحتوي hashes/users/orders/admin config/internal tokens؛ MAINTENANCE/ONBOARDING/SUSPENDED جميعها ترفض session/order.

### M-06 — اختبارات الإنتاج تعطي ثقة زائفة ويمكنها mutate DB مُهيأة خطأ

- **Severity:** Medium
- **CWE / OWASP:** CWE-1188 (Insecure Default Initialization of Resource) / عملية أمنية ضعيفة؛ OWASP A05.
- **المواضع / endpoints:** `src/tests/production.test.ts:41-77`، خصوصاً `seedDatabase()`؛ `tsconfig.app.json` و`tsconfig.node.json`.
- **Root cause:** test يمر عند غياب DB عبر `expect(true)`. وعند وجود `DATABASE_URL` ينفذ `seedDatabase()` الذي يحدّث plans وplatform admin، بلا guard يمنع production DB. backend خارج `npm run build` type-check.
- **Attack scenario:** engineer يشغل `npm test` ضد env production فيغير admin password/plans؛ CI يعلن passed دون أن يختبر Prisma/API.
- **Impact:** production mutation accident، missing regression detection، deployment of schema/role drift مثل `KITCHEN`.
- **Exact remediation:** tests تحتاج `NODE_ENV=test` وDB name/allow-list خاصة، ويفضل ephemeral PostgreSQL. افشل test إن DB غير متاح بدلاً من pass. أضف `tsconfig.server.json` و`typecheck:server` إلى CI.
- **Recommended code change:** assert database URL includes test identifier/CI secret before seed; no production credentials loaded. اختبر API عبر actual HTTP وtwo tenant fixtures.
- **Verification test:** `DATABASE_URL` production-like يجعل test abort قبل write؛ unavailable DB يسبب explicit skipped/failure report لا green security result.

### M-07 — QR regeneration وasset names تستخدم `Math.random`/timestamps القابلة للتنبؤ نسبياً

- **Severity:** Medium
- **CWE / OWASP:** CWE-338 (Use of Cryptographically Weak PRNG)؛ OWASP A02.
- **المواضع / endpoints:** `server/routes/manager.ts:526-552`; `server/routes/uploads.ts:18-21`.
- **Root cause:** regenerated QR token = restaurantId/table number/timestamp + 6 base36 chars من `Math.random`; upload filename مشابه. QR token هو bearer capability.
- **Attack scenario:** attacker يعرف restaurant/table/time window ويخفض مساحة البحث للـ QR الجديد؛ static public asset names قابلة للتخمين أكثر.
- **Impact:** QR enumeration/session abuse، file discovery.
- **Exact remediation:** `crypto.randomBytes(32).toString('base64url')` أو UUID v4/CSPRNG high entropy دائماً؛ hash capability at rest عند الإمكان؛ لا تعبر ID/time في token.
- **Recommended code change:** shared `generateOpaqueToken()` module؛ rotate/revoke previous QR/session atomically.
- **Verification test:** entropy test/implementation review يؤكد 256-bit CSPRNG؛ token لا يحتوي restaurant/table/time؛ old token invalid بعد rotate.

### M-08 — Audit logging غير كامل ولا يسجل محاولات access denied كما يدّعي README

- **Severity:** Medium
- **CWE / OWASP:** CWE-778 (Insufficient Logging)؛ OWASP A09 Security Logging and Monitoring Failures.
- **المواضع / endpoints:** `server/services/audit.ts`; manager routes update/delete عديدة؛ README security claim.
- **Root cause:** توجد logs لجزء من operations فقط؛ deny helper لا يكتب audit event؛ updates/deletes categories/products/offers/waiter status وغيرها لا تسجل consistently. logs mutable في نفس DB ولا retention/alerting ظاهر.
- **Attack scenario:** محاولة tenant escape أو role promotion قد لا تكون قابلة للاكتشاف مبكراً.
- **Impact:** incident response/compliance/forensics ضعيفة.
- **Exact remediation:** central audit middleware للـ authenticated mutations وdenials، immutable/append-only sink خارج primary DB أو restricted writer، request ID/IP/actor/tenant/object/outcome، alerting on repeated failures/elevation.
- **Recommended code change:** لا تسجل secrets/tokens/passwords؛ normalize action taxonomy؛ audit transactionally where required.
- **Verification test:** كل mutating route و403 cross-tenant يولد audit entry آمن؛ no token/hash appears in logs.

## LOW

### L-01 — Health endpoint وSPA fallback يكشفان fingerprint/يعيدان HTML لمسارات API GET غير معروفة

- **Severity:** Low
- **CWE / OWASP:** CWE-200؛ OWASP A05.
- **المواضع / endpoints:** `server/index.ts:133-140, 156-186`.
- **Root cause:** health يكشف `PostgreSQL 17` وversion؛ SPA catch-all يسبق JSON 404 لبعض GET `/api/*` غير الموجودة.
- **Impact:** reconnaissance وAPI behavior غير متسق، ليس compromise منفرداً.
- **Remediation/code change:** health minimal `{status}` أو internal-auth health detail؛ ضع `/api` 404 قبل SPA fallback أو exclude `/api` بوضوح.
- **Verification test:** unknown `/api/anything` → JSON 404/405؛ public health لا يكشف unnecessary stack/database version.

### L-02 — أمثلة documentation/backup defaults قد تشجع credential reuse وتشغيل backup غير صحيح

- **Severity:** Low
- **CWE / OWASP:** CWE-798/CWE-1188؛ OWASP A05.
- **المواضع / endpoints:** `DEPLOYMENT_GUIDE.md` JWT example؛ `server/services/backup.ts:13-18` default `postgres` وfixed DB connection.
- **Root cause:** static JWT-looking example قد يُنسخ كما هو؛ backup لا يستمد host/user/database safely من approved config ويقع على default password.
- **Impact:** operational secret reuse أو backups فاشلة/غير مشفرة؛ لا يوجد exposed endpoint مباشر هنا.
- **Remediation/code change:** وثّق `openssl rand -base64 48`/secret manager بدلاً من static literal؛ remove password fallback؛ use parsed DATABASE_URL or managed backup, encryption, permissions and retention.
- **Verification test:** secret scanner يسمح placeholders فقط؛ backup fails closed when config absent ولا يكتب world-readable files.

---

## 7) Authentication / authorization / input / XSS / database assessment detail

### Authentication

**إيجابي محدود:** login يستخدم Zod email parsing وbcrypt compare؛ password-reset response موحّد فلا يؤكد account existence. Password hashes ليست plain text في schema.

**غير كافٍ للإطلاق:** C-01/C-02/H-02/H-06/M-04 تعني أن login security لا يمكن الاعتماد عليها. لا refresh token rotation، لا session store، لا token `jti`, issuer/audience، لا MFA، ولا database check بعد user suspension. Cookies غير مستخدمة حالياً؛ لذلك CSRF ليس primary risk للـ current bearer-header design، لكن `credentials:true` غير مبرر. عند التحويل لـ HttpOnly cookie يجب إضافة CSRF token وOrigin/Fetch-Metadata validation و`Secure; HttpOnly; SameSite`.

### Authorization / tenant filtering

هناك checks جيدة في بعض resource routes: order status، table update/settle، category/product delete/update، branch update/delete، branch table assignment، payments يفلتر `restaurantId`. لا يكفي ذلك لأن list/export endpoints غابت عنها check، وكل roles تستطيع استدعاء نفس functions، والplatform claim قابل للتزوير/الترقية.

المعيار الصحيح: **tenant ID لا يخرج من client للـ non-platform user**؛ object query نفسها يجب أن تتضمن tenant scope، مثلاً `findFirst({ where: { id, restaurantId: req.auth.tenantId }})` أو update/delete بـ compound where. لا تستخدم `findUnique({ where: { id }})` ثم تعتمد على تذكر check في كل handler.

### Injection / XSS

- **SQL/NoSQL injection:** لم يوجد `$queryRaw`/`$executeRaw` ولا DB NoSQL. Prisma parameterization نقطة إيجابية.
- **Command injection:** `execSync` الخاص بـ `prisma db push` و`exec` للbackup لا يأخذان user input الحالي، لذلك لم يؤكد command injection عن بعد. لكنهما خطر operations/data loss كما في H-07/L-02.
- **React JSX:** أغلب restaurant/menu/title/description renders تستخدم JSX text escaping، وبالتالي لم يظهر stored XSS في هذه sinks المعتادة.
- **XSS المؤكد:** `document.write` للفواتير والإيصالات (C-06) وupload same-origin active content (C-07). CSP معطلة، لذلك لا توجد طبقة تخفيف.
- **CSS/URL fields:** image URLs/colors/bg fields غير validated ويمكنها tracking/unwanted CSS/resource requests. allow-list HTTPS URLs وhex colors، ولا تسمح `data:` إلا عند ضرورة ضيقة.
- **Prototype pollution/path traversal:** لا يوجد merge global أو user-controlled filesystem destination واضح؛ upload filename generated. بقيت الحاجة إلى strict schemas لأن raw bodies/arrays تستخدم بمرونة.

### Database

- tenant columns/indexes جيدة، و`Table.qrToken @unique` و`TableSession.sessionToken @unique` بداية جيدة.
- لا RLS أو separate DB roles أو composite tenant relationships. تكوين relation cross tenant ممكن على مستوى DB وظهر في product create app path.
- money في `Float` غير مناسب للمدفوعات؛ استخدم `Decimal`/integer minor units.
- IDs/order/receipt sequences تعرض collisions/races؛ ليس كل `findUnique(id)` خطراً وحده، لكنه خطر عندما resource tenant-owned ولا يوجد compound restriction.

---

## 8) CORS، headers، upload، deployment، secrets

### Headers الحالية (تحقق HTTP محلي من app نفسه)

| Header | الحالة |
|---|---|
| `Strict-Transport-Security` | موجود من Helmet: `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | موجود: `nosniff` |
| `X-Frame-Options` | موجود: `SAMEORIGIN` |
| `Referrer-Policy` | موجود: `no-referrer` |
| `Content-Security-Policy` | **غير موجود، معطّل صراحة** |
| `Permissions-Policy` | **غير موجود** |
| CORS عند env فارغ | **يعكس origin عدائي مع `credentials=true`** |

استعمل Helmet مع CSP reviewed، `frame-ancestors 'none'` أو allow-list مناسب، Permissions-Policy (geolocation/camera/microphone/payment حسب المنتج)، وCORS exact origins fail-closed.

### Secrets

- `.env` و`.env.*` (باستثناء example) ignored؛ لم تظهر private keys أو provider API keys في Git history المتاح.
- `VITE_API_URL` public بطبيعته، ولا تظهر secrets frontend أخرى في scan.
- **لكن** fallback JWT في source secret فعلي، ويجب تدويره/إزالته (C-02).
- Deployment guide يحتوي example JWT ثابتاً؛ تعامل معه كغير آمن إن تم نسخه (L-02).
- لا تطبع `DATABASE_URL`, JWT, QR/session tokens أو password hashes في errors/logs/audit events.

### File upload

حد 5MB موجود لكنه لا يمنع MIME spoof، HTML/SVG، image bombs أو public/private misuse. يلزم magic-byte decode/re-encode، dimension/pixel limits، object storage policy، AV scanning عند scope أكبر، ownership metadata، expiry/ACLs، وrate limit.

### Deployment

- Render secrets marked `sync:false` خطوة جيدة، لكنها لا تضمن أنها موجودة أو عالية entropy؛ أضف runtime validation.
- Vercel/Netlify ينشران frontend فقط؛ تأكد أن `VITE_API_URL` HTTPS exact وأن backend CORS يسمح بهذا origin فقط.
- DB يجب أن تكون private network فقط، TLS to managed DB، backup encrypted/restore tested.
- Docker image: شغّل non-root، لا تنسخ dev tooling إلى runtime بلا حاجة، pin base image digest، vulnerability scan image في CI، ولا expose port plain HTTP مباشرة.

---

## 9) خطة إصلاح مرتبة قبل الإطلاق

### P0 — يجب إنجازها قبل أي إطلاق أو demo على بيانات عميل

1. إزالة demo email/password/PIN auto-provision وكل master credentials، وتدوير JWT key وإبطال tokens.
2. إصلاح C-03: RBAC server-side وممنوع platform role assignment من tenant routes؛ scrub hash/PIN responses.
3. إصلاح C-04: central tenant scope؛ أضف checks للـ waiter/export وكل route inventory.
4. إصلاح C-05: QR exact capability فقط، لا fallback/default/ID/number/create/auto-reactivate.
5. إصلاح C-06/C-07: server-side order pricing/foreign product rejection وsafe print/upload isolation.
6. استبدال production `db push --accept-data-loss` بـ migrations، وإغلاق 5432 public.

### P1 — قبل قبول أول payment حقيقي

1. Payment authorization/workflow/concurrency/Decimal/receipt sequence (H-04).
2. session revocation وuser-status enforcement و`/me`/logout (H-02).
3. rate limiting/anti-abuse (H-06) وSSE audience/token URL fix (H-01).
4. server-side subscription entitlements (H-08) وvalidation schemas (M-01).
5. CORS fail-closed + CSP/Permissions-Policy (H-05).

### P2 — hardening and assurance

1. Composite DB constraints/RLS design، complete audit logging، password reset/MFA.
2. Ephemeral PostgreSQL security integration suite في CI، server typecheck، SAST/secret/image scans.
3. CSV sanitization، health/API routing cleanup، secure backups/retention.

---

## 10) Security regression suite المضافة

أُضيفت ملفات لا تختبر أو تعدل بيانات production تلقائياً:

- `security-tests/api-security-smoke.mjs` — black-box runner. الوضع الافتراضي **read-only** ويختبر auth/me، tenant A→B reads، unknown slug، method tampering، CORS، malformed JSON. يخفي tokens وresponse bodies.
- `security-tests/README.md` — fixture requirements، safety rails، أوامر التشغيل، وmatrix TI/AU/API/XSS/UP/SSE/FIN/PLAN.

شغّلها فقط على local/staging disposable tenants:

```bash
SECURITY_TEST_BASE_URL=http://127.0.0.1:3001 \
SECURITY_TEST_TOKEN_A='NON_PLATFORM_TENANT_A_JWT' \
SECURITY_TEST_TENANT_B_ID='tenant-b-id' \
node security-tests/api-security-smoke.mjs
```

الـ mutation probes تتطلب عمداً `--allow-mutations` و`SECURITY_TEST_DISPOSABLE=yes` وfixture IDs. هذا يمنع استخدامها بلا قصد ضد بيانات حقيقية. راجع `security-tests/README.md` قبل التنفيذ.

---

# Release blockers

لا تطلق Mureeh Menu تجارياً قبل أن تنجح اختبارات التحقق لكل بند أدناه على PostgreSQL ephemeral ثم staging:

1. **C-01:** لا demo/master credential أو auto-provision في production.
2. **C-02:** لا hard-coded JWT fallback؛ startup fail-closed وkey rotation/revocation تمت.
3. **C-03:** لا user tenant يستطيع role escalation أو إدارة resources خارج permission matrix؛ hashes لا تخرج.
4. **C-04:** كل User A → Tenant B read/create/update/delete returns `403/404`، خصوصاً waiter requests وCSV export.
5. **C-05:** لا QR/session/table access بتغيير URL/body/tableId/slug/default؛ suspended tenant لا يُفعّل من public route.
6. **C-06:** server يتجاهل client price/total/restaurant/user IDs، ويرفض foreign/unknown products/options؛ XSS invoice non-executable.
7. **C-07:** upload لا يستضيف active content ولا يعمل على same privileged origin.
8. **H-04/H-08:** payments/plans/entitlements لا يمكن التلاعب بها من frontend أو staff غير مخول.
9. **H-07:** لا `--accept-data-loss` في production، ولا DB public port.
10. **H-01/H-02/H-05/H-06:** session revocation، SSE isolation، exact CORS/CSP، rate limiting تعمل وتغطي APIs الحساسة.

**الخلاصة النهائية:** وجود Prisma وbcrypt وHelmet وبعض `ownTenant` checks لا يكفي لإثبات الأمان. التصميم الحالي يملك عدة اختراقات مؤكدة على boundaries الأساسية (authentication، role authorization، tenant isolation، QR capability، file origin). الإصلاح والتحقق الآلي أعلاه شرط لإطلاق SaaS متعدد المستأجرين بأمان.
