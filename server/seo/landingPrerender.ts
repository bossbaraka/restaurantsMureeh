/**
 * Mureeh Menu — landing-page prerender (platform SEO).
 *
 * The problem this module solves
 * ==============================
 * The platform is a client-side React SPA. A request for `/` used to
 * return an HTML shell whose body was a single empty
 * `<div id="root"></div>` — every restaurant word on the page
 * (منيو، مطعم، QR، شاشة المطبخ…) existed only inside JavaScript that a
 * crawler must execute before any content exists. Google renders JS,
 * but slowly and best-effort; other engines barely render at all. The
 * result: the page carried almost no indexable text, so it could not
 * rank for restaurant queries.
 *
 * The fix
 * =======
 * This pure module holds a STATIC mirror of the marketing landing page
 * (same copy as `SaaSLandingPage.tsx`, same anchor ids, same FAQ texts
 * the JSON-LD block declares). Two consumers use it:
 *
 *   1. `server/scripts/prerender.ts` — after `vite build`, rewrites
 *      `dist/index.html` so EVERY deploy target (Vercel, Netlify,
 *      Render static, Docker) ships crawler-complete HTML.
 *   2. `server/index.ts` — `GET /` re-emits the same injection at
 *      runtime (the deterministic re-emit pattern the sitemap and
 *      robots handlers already use), so a Node-served deploy is
 *      correct even if its dist/ was built before this module existed.
 *
 * When React boots in the browser, `createRoot(...).render()` replaces
 * the container's children — the static mirror is swapped for the live
 * app in one frame. Crawlers that never run JavaScript see the full
 * page instead of an empty shell.
 *
 * Purity contract
 * ================
 * Prisma-free, DB-free, env-free. Marketing copy is static; the public plan
 * prices and campaign label come from the shared pricing config at build or
 * process start, so crawlers see the same current offer as the React page.
 *
 * Content policy
 * ==============
 * Every word below is marketing copy the page already shows to
 * users (or a structural duplicate of it). No fabricated reviews,
 * addresses or ratings — the only contact number shown is the official
 * Mureeh WhatsApp number supplied in `shared/mureeh-contact.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { LAUNCH_OFFER, PLAN_PRICING, getDisplayedPlanPrice, isLaunchOfferActive } from '../../shared/plan-pricing';
import { buildMureehWhatsAppUrl, MUREEH_WHATSAPP_DISPLAY } from '../../shared/mureeh-contact';

/** Marker injected right after `<div id="root">` — makes the
 *  injection idempotent and testable. */
export const PRERENDER_MARKER = '<!--mureeh:landing-prerendered-->';

// Resolve the static mirror's price copy at build/process time from the same
// campaign configuration as the live React landing page.
const landingRenderedAt = Date.now();
const landingOfferActive = isLaunchOfferActive(landingRenderedAt);

type LandingPlanKey = keyof typeof PLAN_PRICING;
function renderLandingMonthlyPrice(planKey: LandingPlanKey): string {
  const pricing = PLAN_PRICING[planKey];
  const displayedPrice = getDisplayedPlanPrice(pricing, 'monthly', landingRenderedAt);
  const standardPrice = landingOfferActive
    ? `<span class="mr-2 text-sm text-slate-500 line-through">${pricing.priceMonthly}</span>`
    : '';
  const offerNote = landingOfferActive
    ? `<p class="text-[10px] font-bold text-amber-200">عرض الإطلاق حتى ${LAUNCH_OFFER.endsAtLabelAr}</p>`
    : '';
  return `<p class="text-4xl font-black text-white tabular-nums">${displayedPrice} ${standardPrice}<span class="text-sm font-bold text-slate-400">₪/شهرياً</span></p>${offerNote}`;
}

/**
 * Static mirror of `SaaSLandingPage.tsx`.
 *
 * Tailwind classes are intentional: the server/seo glob is registered
 * in `tailwind.config.js` content globs, so every class used here is
 * compiled into the CSS bundle exactly like the React source.
 *
 * Anchor ids (#how, #features, #pricing, #faq, #contact) match the
 * live page so footer/nav links work even before React hydrates.
 * FAQ items are byte-identical to the `FAQS` array in
 * SaaSLandingPage.tsx and to the FAQPage JSON-LD in index.html.
 */
export const LANDING_ROOT_HTML = `
<nav aria-label="التنقل الرئيسي" class="hidden md:flex items-center gap-7 text-[13px] font-bold text-slate-300">
  <a href="#how" class="hover:text-[#38BDF8] transition-colors">كيف يعمل</a>
  <a href="#features" class="hover:text-[#38BDF8] transition-colors">المزايا</a>
  <a href="#video" class="hover:text-[#38BDF8] transition-colors">الفيديو</a>
  <a href="#showcase" class="hover:text-[#38BDF8] transition-colors">جولة حيّة</a>
  <a href="#pricing" class="hover:text-[#38BDF8] transition-colors">الباقات</a>
  <a href="#faq" class="hover:text-[#38BDF8] transition-colors">الأسئلة الشائعة</a>
</nav>

<header class="relative">
  <section aria-labelledby="hero-title" class="relative overflow-hidden pt-28 sm:pt-40 pb-14 sm:pb-20 px-4 sm:px-6">
    <div class="max-w-6xl mx-auto relative z-10 text-center space-y-6">
      <span class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#003865]/70 border border-[#0072BC]/50 text-[#7DD3FC] text-xs font-bold">
        منظومة مُريح OS للمطاعم — إصدار 2026
      </span>
      <h1 id="hero-title" class="text-4xl sm:text-5xl xl:text-[3.6rem] font-black leading-[1.25] text-white text-balance">
        مطعمك كاملاً…
        <br />
        يُدار من
        <span class="bg-gradient-to-l from-white via-[#7DD3FC] to-[#009FE3] bg-clip-text text-transparent">
          رمز QR واحد
        </span>
      </h1>
      <p class="text-sm sm:text-lg text-slate-300/95 max-w-xl mx-auto leading-relaxed">
        منيو رقمي فاخر بدون تطبيق وبدون تسجيل، شاشة مطبخ حيّة، نداء نادل فوري،
        وتقارير مبيعات لحظية — منظومة مُريح السحابية تحوّل كل طاولة إلى مصدر ربح ذكي.
      </p>
      <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
        <a href="${buildMureehWhatsAppUrl(landingOfferActive ? 'أود الاستفادة من عرض الإطلاق' : 'أود الاستفسار عن الاشتراك')}" target="_blank" rel="noopener noreferrer" class="px-8 py-4 rounded-2xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] text-white font-bold text-sm">
          ${landingOfferActive ? 'استفد من عرض الإطلاق' : 'تواصل للاشتراك'}
        </a>
        <a href="#how" class="px-8 py-4 rounded-2xl bg-white/5 border border-white/15 text-white font-bold text-sm">
          شاهد كيف يعمل
        </a>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] sm:text-xs font-bold text-slate-300">
        <span class="inline-flex items-center gap-1.5">تفعيل خلال دقائق</span>
        <span class="inline-flex items-center gap-1.5">بدون عقود إجبارية</span>
        <span class="inline-flex items-center gap-1.5">إلغاء في أي وقت</span>
      </div>
    </div>
    <div class="max-w-6xl mx-auto relative z-10 mt-14 sm:mt-20">
      <dl class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-5 text-center">
          <dd class="text-3xl sm:text-4xl font-black text-white tabular-nums">50+</dd>
          <dt class="text-[11px] sm:text-xs text-slate-400 font-bold mt-1.5">طاولة ذكية لكل مطعم</dt>
        </div>
        <div class="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-5 text-center">
          <dd class="text-3xl sm:text-4xl font-black text-white tabular-nums">3</dd>
          <dt class="text-[11px] sm:text-xs text-slate-400 font-bold mt-1.5">ثوانٍ فقط لبدء الطلب</dt>
        </div>
        <div class="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-5 text-center">
          <dd class="text-3xl sm:text-4xl font-black text-white tabular-nums">24/7</dd>
          <dt class="text-[11px] sm:text-xs text-slate-400 font-bold mt-1.5">دعم فني عبر واتساب</dt>
        </div>
        <div class="rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-5 text-center">
          <dd class="text-3xl sm:text-4xl font-black text-white tabular-nums">100%</dd>
          <dt class="text-[11px] sm:text-xs text-slate-400 font-bold mt-1.5">بدون تطبيق أو تسجيل</dt>
        </div>
      </dl>
    </div>
  </section>
</header>

<div aria-hidden="true" class="relative border-y border-[#004B87]/40 bg-[#020A14] py-4 px-4 sm:px-6 overflow-hidden">
  <ul class="flex flex-wrap items-center justify-center gap-x-10 gap-y-2 text-[13px] font-bold text-slate-300 list-none">
    <li class="inline-flex items-center gap-2.5">منيو QR فوري</li>
    <li class="inline-flex items-center gap-2.5">شاشة مطبخ حيّة</li>
    <li class="inline-flex items-center gap-2.5">نقطة بيع متطورة</li>
    <li class="inline-flex items-center gap-2.5">تحليلات لحظية</li>
    <li class="inline-flex items-center gap-2.5">نداء نادل ذكي</li>
    <li class="inline-flex items-center gap-2.5">فواتير مرقمة</li>
    <li class="inline-flex items-center gap-2.5">هوية بصرية كاملة</li>
    <li class="inline-flex items-center gap-2.5">دعم واتساب مباشر</li>
  </ul>
</div>

<section id="how" aria-labelledby="how-title" class="relative py-16 sm:py-24 px-4 sm:px-6">
  <div class="max-w-6xl mx-auto text-center space-y-4 mb-12">
    <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">كيف يعمل النظام</p>
    <h2 id="how-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">ثلاث خطوات فقط… ومطعمك يعمل بذكاء</h2>
    <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">بدون تعقيد تقني وبدون أجهزة خاصة — من لحظة التفعيل حتى أول طلب خلال دقائق.</p>
  </div>
  <ol class="max-w-6xl mx-auto grid md:grid-cols-3 gap-5 list-none">
    <li class="relative rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-7 text-center space-y-4">
      <h3 class="text-lg font-black text-white">جهّز طاولاتك برموز QR</h3>
      <p class="text-[13px] text-slate-300 leading-relaxed">نجهّز لك بطاقات QR أنيقة ومقاومة لكل طاولة — الصقها على الطاولات وخلّص، والباقي علينا.</p>
    </li>
    <li class="relative rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-7 text-center space-y-4">
      <h3 class="text-lg font-black text-white">زبونك يمسح ويطلب فوراً</h3>
      <p class="text-[13px] text-slate-300 leading-relaxed">بدون تطبيق وبدون تسجيل: منيو تفاعلي بالصور، تخصيص كامل للوجبة، وزر استدعاء النادل.</p>
    </li>
    <li class="relative rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-7 text-center space-y-4">
      <h3 class="text-lg font-black text-white">استلم أرباحك وراقب النمو</h3>
      <p class="text-[13px] text-slate-300 leading-relaxed">الطلب يصل المطبخ لحظياً، والفاتورة تُحسم عند الكاشير، وأنت تتابع المبيعات من هاتفك.</p>
    </li>
  </ol>
</section>

<section id="features" aria-labelledby="features-title" class="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#031326] border-y border-[#004B87]/30 overflow-hidden">
  <div class="max-w-6xl mx-auto relative z-10">
    <div class="text-center space-y-4 mb-12">
      <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">منظومة متكاملة</p>
      <h2 id="features-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">كل ما يحتاجه مطعمك… في مكان واحد</h2>
      <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">ست ركائز ذكية تعمل معاً بتناغم لتغنيك عن عشرات البرامج والأجهزة المتفرقة.</p>
    </div>
    <div class="grid md:grid-cols-3 gap-4 sm:gap-5">
      <article class="md:col-span-2 rounded-3xl bg-gradient-to-br from-[#081B33] to-[#040D1A] border border-[#004B87]/40 p-6 sm:p-8">
        <h3 class="text-xl font-black text-white">شاشة مطبخ حيّة (KDS)</h3>
        <p class="text-[13px] text-slate-300 leading-relaxed mt-3">الطلبات تصل الشيف لحظياً مع تنبيه صوتي ومؤقت ملوّن لكل طلب — وقفل تلقائي للتعديل بعد بدء التحضير لمنع الهدر والخلافات.</p>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4 text-center">
        <h3 class="text-lg font-black text-white">طلب ذكي بدون تسجيل</h3>
        <p class="text-xs text-slate-300 leading-relaxed">يمسح الزبون الرمز ويطلب فوراً — بدون تطبيق وبدون حساب، مع تخصيص كامل للوجبة.</p>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4">
        <h3 class="text-lg font-black text-white">تحليلات ترفع أرباحك</h3>
        <p class="text-xs text-slate-300 leading-relaxed">مبيعات لحظية، متوسط قيمة الطلب، وساعات الذروة — قرارات مبنية على أرقام حقيقية.</p>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4">
        <h3 class="text-lg font-black text-white">هوية مطعمك الكاملة</h3>
        <p class="text-xs text-slate-300 leading-relaxed">شعارك وألوانك وصورك — موقع يعكس فخامة مطعمك وكأنه صُمم خصيصاً لك.</p>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4">
        <h3 class="text-lg font-black text-white">طاقم بصلاحيات ذكية</h3>
        <p class="text-xs text-slate-300 leading-relaxed">حسابات للنادل والشيف والكاشير بدخول سريع عبر PIN — كل موظف يرى ما يخصّه فقط.</p>
      </article>
      <article class="md:col-span-3 rounded-3xl bg-gradient-to-l from-[#003865]/50 via-[#081B33] to-[#081B33] border border-[#0072BC]/30 p-6 sm:px-8 flex flex-col sm:flex-row items-center gap-4">
        <h3 class="text-base sm:text-lg font-black text-white">نقطة بيع وفواتير وتقارير — كلها مترابطة تلقائياً</h3>
        <p class="text-xs text-slate-300">فواتير مرقمة، مشاركة عبر واتساب، وتصدير CSV — من الكاشير إلى التقارير بدون خطوة يدوية.</p>
      </article>
    </div>
  </div>
</section>

<section id="video" aria-labelledby="video-title" class="relative py-16 sm:py-24 px-4 sm:px-6 overflow-hidden">
  <div class="max-w-5xl mx-auto relative z-10 text-center space-y-4">
    <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">شاهد المنصة تعمل</p>
    <h2 id="video-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">أربعون ثانية تختصر يوم عمل كامل</h2>
    <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">من مسح رمز QR على الطاولة حتى تقرير الإيراد في لوحة المدير — جولة داخل نظام إدارة المطاعم نفسه.</p>
  </div>
</section>

<section id="showcase" aria-labelledby="showcase-title" class="relative py-16 sm:py-24 px-4 sm:px-6 overflow-hidden">
  <div class="max-w-6xl mx-auto relative z-10">
    <div class="text-center space-y-4 mb-12">
      <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">جولة حيّة داخل النظام</p>
      <h2 id="showcase-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">ثلاث شاشات… عقل واحد ذكي</h2>
      <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">تنقّل بين تجربة الزبون وشاشة المطبخ ولوحة المدير — وشاهد كيف يتكامل كل شيء لحظياً.</p>
    </div>
    <div class="grid md:grid-cols-3 gap-4 sm:gap-5">
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4">
        <h3 class="text-lg font-black text-white">هاتف الزبون — تجربة طلب يعشقها الزبائن</h3>
        <p class="text-xs text-slate-300 leading-relaxed">واجهة عربية فاخرة تعمل على أي هاتف — سريعة، واضحة، ومصممة لترفع متوسط قيمة الطلب.</p>
        <ul class="space-y-2 text-xs text-slate-300 list-none">
          <li>مسح QR والطلب فوراً بدون حساب أو تطبيق</li>
          <li>تخصيص الوجبة: إضافات وأحجام واستبعاد مكونات</li>
          <li>تتبع حي لحالة الطلب حتى لحظة التقديم</li>
          <li>استدعاء النادل وطلب الفاتورة بضغطة زر</li>
        </ul>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4">
        <h3 class="text-lg font-black text-white">شاشة المطبخ — مطبخ يعمل كخلية نحل منظمة</h3>
        <p class="text-xs text-slate-300 leading-relaxed">شاشة عرض ذكية للمطبخ تنظم الطلبات بالأولوية وتمنع الضياع والهدر نهائياً.</p>
        <ul class="space-y-2 text-xs text-slate-300 list-none">
          <li>تنبيه صوتي ومرئي فوري مع كل طلب جديد</li>
          <li>مؤقت ملوّن لكل طلب حسب الأولوية الزمنية</li>
          <li>قفل التعديل تلقائياً بعد بدء التحضير</li>
          <li>زر «جاهز» يُشعر النادل والزبون معاً</li>
        </ul>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 space-y-4">
        <h3 class="text-lg font-black text-white">لوحة المدير — كل مطعمك تحت عينك أينما كنت</h3>
        <p class="text-xs text-slate-300 leading-relaxed">لوحة قيادة شاملة للمبيعات والمنيو والطاقم — من هاتفك أو حاسوبك، لحظة بلحظة.</p>
        <ul class="space-y-2 text-xs text-slate-300 list-none">
          <li>مبيعات وطلبات لحظية من أي جهاز</li>
          <li>تعديل المنيو والأسعار في ثوانٍ معدودة</li>
          <li>تقارير CSV وسجل تدقيق أمني كامل</li>
          <li>إدارة الطاولات والصلاحيات والفروع</li>
        </ul>
      </article>
    </div>
  </div>
</section>

<section id="roi" aria-labelledby="roi-title" class="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#031326] border-y border-[#004B87]/30 overflow-hidden">
  <div class="max-w-5xl mx-auto relative z-10 text-center space-y-4">
    <p class="text-xs font-black tracking-[0.2em] text-emerald-400 uppercase">حاسبة العائد على الاستثمار</p>
    <h2 id="roi-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">كم ستربح مع مُريح؟</h2>
    <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">حرّك المؤشر حسب عدد طاولاتك وشاهد التوفير والزيادة المتوقعة شهرياً — بالأرقام.</p>
    <div class="rounded-[2rem] bg-gradient-to-br from-[#081B33] to-[#040D1A] border border-[#0072BC]/40 p-6 sm:p-10 grid lg:grid-cols-2 gap-8 text-start">
      <div class="space-y-4">
        <p class="text-xs font-bold text-slate-400">مثال: مطعم بـ 20 طاولة</p>
        <div class="rounded-2xl bg-[#040D1A]/70 border border-[#004B87]/40 p-4 flex items-center gap-3">
          <p class="text-[11px] text-slate-300 leading-relaxed">تشمل الحسبة: توفير الطباعة والعمالة + رفع متوسط الطلب عبر الإضافات + تسريع تدوير الطاولات.</p>
        </div>
      </div>
      <div class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="rounded-2xl bg-[#040D1A] border border-emerald-400/30 p-5 text-center space-y-1.5">
            <p class="text-[11px] font-bold text-slate-400">توفير التكاليف شهرياً</p>
            <p class="text-2xl sm:text-3xl font-black text-emerald-400 tabular-nums">2,400 ₪</p>
            <p class="text-[10px] text-slate-500 font-bold">شهرياً / طباعة وعمالة</p>
          </div>
          <div class="rounded-2xl bg-[#040D1A] border border-[#0072BC]/40 p-5 text-center space-y-1.5">
            <p class="text-[11px] font-bold text-slate-400">زيادة المبيعات شهرياً</p>
            <p class="text-2xl sm:text-3xl font-black text-[#38BDF8] tabular-nums">+7,000 ₪</p>
            <p class="text-[10px] text-slate-500 font-bold">شهرياً / إضافات وتدوير</p>
          </div>
        </div>
        <p class="text-[10px] text-slate-500 text-center">* أرقام تقديرية مبنية على متوسطات مطاعم مشابهة — تواصل معنا لحسبة دقيقة لمطعمك.</p>
      </div>
    </div>
  </div>
</section>

<section id="pricing" aria-labelledby="pricing-title" class="relative overflow-hidden py-16 sm:py-24 px-4 sm:px-6">
  <div class="max-w-6xl mx-auto relative z-10">
    <div class="text-center space-y-4 mb-12">
      <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">باقات الاشتراك</p>
      <h2 id="pricing-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">باقة لكل مرحلة من نموّك</h2>
      <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">ابدأ بإطلاق منيو رقمي احترافي خلال دقائق، وطوّر باقتك كلما كبر مطعمك — بدون رسوم خفية وبدون عقود إجبارية.</p>
      ${landingOfferActive ? `<div class="max-w-3xl mx-auto rounded-2xl border border-amber-400/35 bg-[#14233A] px-5 py-4"><p class="text-xs sm:text-sm font-bold text-white">عرض إطلاق لفترة محدودة للمشتركين الجدد حتى ${LAUNCH_OFFER.endsAtLabelAr}</p><p class="mt-2 mb-0 text-[10px] text-slate-300">الأسعار بالشيكل، والسعر المعتاد ظاهر بجانب سعر العرض.</p></div>` : ''}
    </div>
    <div class="grid md:grid-cols-3 gap-5">
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-7 space-y-5">
        <h3 class="text-lg font-black text-white">الباقة الأساسية</h3>
        <p class="text-xs text-slate-400">للمطاعم والكافيهات الواعدة</p>
        ${renderLandingMonthlyPrice('starter')}
        <ul class="space-y-2.5 text-xs text-slate-300 list-none">
          <li>منيو رقمي فاخر وتفاعلي عبر رمز الـ QR</li>
          <li>طلب فوري مباشر من الطاولة بدون أي تطبيق</li>
          <li>زر استدعاء النادل وإدارة طلبات الخدمة</li>
          <li>نظام كاشير أساسي وتصفية الفواتير</li>
          <li>لوحة تحكم ودعم فني من منصة مريح</li>
        </ul>
        <a href="${buildMureehWhatsAppUrl('أود الاشتراك في الباقة الأساسية من مريح.')}" target="_blank" rel="noopener noreferrer" class="block text-center px-6 py-3.5 rounded-xl bg-white/5 border border-white/15 text-white text-xs font-bold">اشترك الآن عبر واتساب</a>
      </article>
      <article class="rounded-3xl bg-gradient-to-br from-[#003865] to-[#04142B] border border-[#0072BC]/60 p-7 space-y-5 shadow-[0_24px_60px_-20px_rgba(0,114,188,0.45)]">
        <h3 class="text-lg font-black text-white">الباقة الاحترافية <span class="text-[10px] font-black text-emerald-300 bg-emerald-400/10 border border-emerald-400/30 rounded-full px-2 py-0.5 mr-2">الأكثر طلباً</span></h3>
        <p class="text-xs text-slate-400">الحل المتكامل لإدارة الصالات وشاشة المطبخ والـ POS</p>
        ${renderLandingMonthlyPrice('pro')}
        <ul class="space-y-2.5 text-xs text-slate-300 list-none">
          <li>جميع مزايا الباقة الأساسية بالكامل</li>
          <li>شاشة المطبخ الحية (KDS) بتنبيهات صوتية فورية</li>
          <li>نقطة بيع POS متطورة وتصنيفات الصالات</li>
          <li>تحليلات مبيعات تفاعلية وتخصيص الهوية البصرية</li>
          <li>إدارة العروض والكومبو وشارات الترويج</li>
        </ul>
        <a href="${buildMureehWhatsAppUrl('أود الاشتراك في الباقة الاحترافية من مريح.')}" target="_blank" rel="noopener noreferrer" class="block text-center px-6 py-3.5 rounded-xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] text-white text-xs font-black">احصل على الباقة الاحترافية عبر واتساب</a>
      </article>
      <article class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-7 space-y-5">
        <h3 class="text-lg font-black text-white">باقة المؤسسات والسلاسل</h3>
        <p class="text-xs text-slate-400">لسلاسل المطاعم والفنادق والمنتجعات والفروع المتعددة</p>
        ${renderLandingMonthlyPrice('enterprise')}
        <ul class="space-y-2.5 text-xs text-slate-300 list-none">
          <li>حتى 10 فروع و200 طاولة و500 صنف</li>
          <li>إدارة الفروع المتعددة (Multi-Branch System)</li>
          <li>ربط نطاق خاص لموقعك (Custom Domain)</li>
          <li>مدير حساب خاص ودعم أولوية قصوى 24/7</li>
        </ul>
        <a href="${buildMureehWhatsAppUrl('أود الاستفسار عن باقة المؤسسات من مريح.')}" target="_blank" rel="noopener noreferrer" class="block text-center px-6 py-3.5 rounded-xl bg-white/5 border border-white/15 text-white text-xs font-bold">تواصل مع مبيعات مريح عبر واتساب</a>
      </article>
    </div>
  </div>
</section>

<section aria-labelledby="testimonials-title" class="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#031326] border-y border-[#004B87]/30 overflow-hidden">
  <div class="max-w-6xl mx-auto relative z-10">
    <div class="text-center space-y-4 mb-12">
      <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">آراء عملائنا</p>
      <h2 id="testimonials-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">مطاعم وثقت بمُريح… ونمت معه</h2>
      <p class="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">قصص حقيقية من أصحاب مطاعم ومقاهٍ حوّلوا طاولاتهم إلى منظومة رقمية متكاملة.</p>
    </div>
    <div class="grid md:grid-cols-3 gap-4 sm:gap-5">
      <figure class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 flex flex-col gap-4">
        <blockquote class="text-[13px] text-slate-200 leading-relaxed flex-1">«استغنينا عن قوائم الورق نهائياً. الزبون يمسح الرمز ويطلب، والطلب يوصل المطبخ قبل ما يكمّل قهوته.»</blockquote>
        <figcaption class="flex items-center gap-3 pt-4 border-t border-[#004B87]/40">
          <span class="text-sm font-black text-white">أبو كريم</span>
          <span class="text-[11px] text-slate-400">مطعم عائلي · 28 طاولة</span>
        </figcaption>
      </figure>
      <figure class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 flex flex-col gap-4">
        <blockquote class="text-[13px] text-slate-200 leading-relaxed flex-1">«سرعة تدوير الطاولات ارتفعت بشكل واضح، وتقارير المبيعات اليومية وفّرت عليّ ساعات من الحسابات اليدوية.»</blockquote>
        <figcaption class="flex items-center gap-3 pt-4 border-t border-[#004B87]/40">
          <span class="text-sm font-black text-white">سارة</span>
          <span class="text-[11px] text-slate-400">مقهى مختص · 16 طاولة</span>
        </figcaption>
      </figure>
      <figure class="rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 p-6 sm:p-7 flex flex-col gap-4">
        <blockquote class="text-[13px] text-slate-200 leading-relaxed flex-1">«شاشة المطبخ غيّرت طريقة شغلنا بالكامل — لا طلبات ضائعة ولا خلافات على التعديلات بعد بدء التحضير.»</blockquote>
        <figcaption class="flex items-center gap-3 pt-4 border-t border-[#004B87]/40">
          <span class="text-sm font-black text-white">الشيف عمر</span>
          <span class="text-[11px] text-slate-400">مطعم فاخر · 40 طاولة</span>
        </figcaption>
      </figure>
    </div>
  </div>
</section>

<section id="faq" aria-labelledby="faq-title" class="relative py-16 sm:py-24 px-4 sm:px-6">
  <div class="max-w-2xl mx-auto">
    <div class="text-center space-y-4 mb-12">
      <p class="text-xs font-black tracking-[0.2em] text-[#38BDF8] uppercase">الأسئلة الشائعة</p>
      <h2 id="faq-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">كل ما تريد معرفته</h2>
    </div>
    <div class="space-y-3">
      <details class="group rounded-2xl bg-[#081B33]/60 border border-[#004B87]/40 p-5">
        <summary class="text-sm font-black text-white cursor-pointer list-none">هل يمكنني تغيير باقتي لاحقاً؟</summary>
        <p class="text-xs text-slate-300 leading-relaxed mt-3">نعم — من لوحة تحكم مطعمك (الباقة والاشتراك) يمكنك الترقية أو التخفيض فورياً، ويُطبق الفرق تلقائياً على اشتراكك بدون أي تعقيد.</p>
      </details>
      <details class="group rounded-2xl bg-[#081B33]/60 border border-[#004B87]/40 p-5">
        <summary class="text-sm font-black text-white cursor-pointer list-none">هل تتغير الأسعار مع عدد الطاولات؟</summary>
        <p class="text-xs text-slate-300 leading-relaxed mt-3">لا. سعر الباقة ثابت ويشمل كل ما هو مذكور — الطاولات داخل حدّ باقتك بدون أي رسوم إضافية مهما زاد عدد طلباتك.</p>
      </details>
      <details class="group rounded-2xl bg-[#081B33]/60 border border-[#004B87]/40 p-5">
        <summary class="text-sm font-black text-white cursor-pointer list-none">هل يمكنني تخصيص شكل موقعي وشعاري؟</summary>
        <p class="text-xs text-slate-300 leading-relaxed mt-3">بالتأكيد — في الباقة الاحترافية يمكنك اختيار طابع الألوان، رفع شعار مطعمك وصورة الغلاف، ومعاينة شكل الموقع مباشرة قبل النشر.</p>
      </details>
      <details class="group rounded-2xl bg-[#081B33]/60 border border-[#004B87]/40 p-5">
        <summary class="text-sm font-black text-white cursor-pointer list-none">هل أحتاج لشراء أجهزة أو معدات خاصة؟</summary>
        <p class="text-xs text-slate-300 leading-relaxed mt-3">لا. يعمل النظام بالكامل على الأجهزة التي تملكها أصلاً: أي هاتف أو تابلت للزبائن والطاقم، وشاشة عادية للمطبخ. نحن نجهّز لك بطاقات QR فقط.</p>
      </details>
      <details class="group rounded-2xl bg-[#081B33]/60 border border-[#004B87]/40 p-5">
        <summary class="text-sm font-black text-white cursor-pointer list-none">ماذا لو كان الإنترنت ضعيفاً في مطعمي؟</summary>
        <p class="text-xs text-slate-300 leading-relaxed mt-3">النظام مصمم ليعمل بكفاءة حتى مع اتصال إنترنت بسيط، وواجهة الزبون خفيفة وتتحمّل بسرعة. وفريق الدعم يساعدك في تجهيز الشبكة بأفضل صورة.</p>
      </details>
      <details class="group rounded-2xl bg-[#081B33]/60 border border-[#004B87]/40 p-5">
        <summary class="text-sm font-black text-white cursor-pointer list-none">كيف أستقبل المدفوعات من الزبائن؟</summary>
        <p class="text-xs text-slate-300 leading-relaxed mt-3">بكل مرونة: الدفع نقداً أو بالبطاقة عند الكاشير أو الطاولة، مع فواتير مرقمة وحساب تلقائي للمتبقي وتصفية فورية للطاولة بعد الدفع.</p>
      </details>
    </div>
  </div>
</section>

<section aria-labelledby="final-cta-title" class="relative pb-16 sm:pb-24 px-4 sm:px-6">
  <div class="max-w-5xl mx-auto">
    <div class="relative overflow-hidden rounded-[2rem] border border-[#0072BC]/40 bg-gradient-to-br from-[#06203F] via-[#04142B] to-[#020A14] px-6 py-12 sm:p-14 text-center">
      <div class="relative z-10 space-y-5">
        <h2 id="final-cta-title" class="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">جاهز تحوّل مطعمك إلى تجربة رقمية كاملة؟</h2>
        <p class="text-sm sm:text-base text-slate-300 max-w-xl mx-auto leading-relaxed">انضم إلى المطاعم التي تدير طاولاتها ومطبخها وكاشيرها من منظومة واحدة. التفعيل خلال دقائق — والدعم معك خطوة بخطوة.</p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <a href="${buildMureehWhatsAppUrl('أود التحدث مع مبيعات مريح.')}" target="_blank" rel="noopener noreferrer" class="px-8 py-4 rounded-2xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] text-white font-bold text-sm">تحدث مع المبيعات عبر واتساب</a>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-bold text-slate-400 pt-1">
          <span class="inline-flex items-center gap-1.5">بدون بطاقة ائتمانية</span>
          <span class="inline-flex items-center gap-1.5">إلغاء في أي وقت</span>
          <span class="inline-flex items-center gap-1.5">دعم بالعربية</span>
        </div>
      </div>
    </div>
  </div>
</section>

<footer id="contact" class="border-t border-[#004B87]/40 bg-[#020A14] px-4 sm:px-6 pt-12 pb-8">
  <div class="max-w-6xl mx-auto">
    <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 pb-10 border-b border-[#004B87]/30">
      <div class="space-y-4">
        <p class="text-base font-black text-white">مُريح <span class="text-[#38BDF8] text-xs font-bold">MUREEH OS</span></p>
        <p class="text-xs text-slate-400 leading-relaxed">منصة مُريح للخدمات الإلكترونية — منظومة سحابية متكاملة لإدارة المطاعم والمقاهي: منيو QR، شاشة مطبخ، ونقطة بيع في مكان واحد.</p>
        <a href="${buildMureehWhatsAppUrl('مرحباً، أود الاستفسار عن منصة مريح.')}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 text-xs font-bold">
          واتساب مريح: <span dir="ltr">${MUREEH_WHATSAPP_DISPLAY}</span>
        </a>
      </div>
      <nav aria-label="روابط سريعة">
        <h4 class="text-sm font-black text-white mb-4">روابط سريعة</h4>
        <ul class="space-y-2.5 text-xs font-bold text-slate-400 list-none">
          <li><a href="#how" class="hover:text-[#38BDF8] transition-colors">كيف يعمل</a></li>
          <li><a href="#features" class="hover:text-[#38BDF8] transition-colors">المزايا</a></li>
          <li><a href="#video" class="hover:text-[#38BDF8] transition-colors">الفيديو</a></li>
          <li><a href="#showcase" class="hover:text-[#38BDF8] transition-colors">جولة حيّة</a></li>
          <li><a href="#pricing" class="hover:text-[#38BDF8] transition-colors">الباقات</a></li>
          <li><a href="#faq" class="hover:text-[#38BDF8] transition-colors">الأسئلة الشائعة</a></li>
        </ul>
      </nav>
      <nav aria-label="الباقات">
        <h4 class="text-sm font-black text-white mb-4">الباقات</h4>
        <ul class="space-y-2.5 text-xs font-bold text-slate-400 list-none">
          <li><a href="#pricing" class="hover:text-[#38BDF8] transition-colors">الباقة الأساسية — ${getDisplayedPlanPrice(PLAN_PRICING.starter, 'monthly', landingRenderedAt)} ₪/شهرياً</a></li>
          <li><a href="#pricing" class="hover:text-[#38BDF8] transition-colors">الباقة الاحترافية — ${getDisplayedPlanPrice(PLAN_PRICING.pro, 'monthly', landingRenderedAt)} ₪/شهرياً</a></li>
          <li><a href="#pricing" class="hover:text-[#38BDF8] transition-colors">باقة المؤسسات والسلاسل — ${getDisplayedPlanPrice(PLAN_PRICING.enterprise, 'monthly', landingRenderedAt)} ₪/شهرياً</a></li>
        </ul>
      </nav>
      <div>
        <h4 class="text-sm font-black text-white mb-4">تواصل معنا</h4>
        <ul class="space-y-2.5 text-xs font-bold text-slate-400 list-none">
          <li class="flex items-center gap-2">واتساب: <a href="${buildMureehWhatsAppUrl('مرحباً، أود التواصل مع فريق مريح.')}" target="_blank" rel="noopener noreferrer" class="font-mono text-slate-300 hover:text-emerald-300" dir="ltr">${MUREEH_WHATSAPP_DISPLAY}</a></li>
          <li class="flex items-center gap-2">دعم فني يومي في أوقات العمل</li>
          <li class="flex items-center gap-2">منصة سحابية آمنة متعددة المستأجرين</li>
        </ul>
      </div>
    </div>
    <div class="pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-slate-500">
      <p>© 2026 منصة مريح للخدمات الإلكترونية (MUREEH) — جميع الحقوق محفوظة</p>
      <p>إحدى خدمات منصة مريح الإلكترونية · صُنع بشغف للمطاعم العربية</p>
    </div>
  </div>
</footer>
`;

/**
 * Injects the static landing mirror into the SPA shell's mount point.
 *
 * Idempotent: a shell that already carries the marker is returned
 * untouched, so running the prerender twice (or serving an already
 * prerendered file through the runtime handler) never nests content.
 *
 * @param spaShell the raw index.html read from dist/
 * @returns the shell with #root populated, or the original string
 *          when the mount point is not found (never corrupts a shell)
 */
export function prerenderSpaShell(spaShell: string): string {
  if (spaShell.includes(PRERENDER_MARKER)) {
    return spaShell;
  }
  const mountPoint = /<div id="root"\s*><\/div>/.exec(spaShell);
  if (!mountPoint) {
    return spaShell;
  }
  return spaShell.replace(
    mountPoint[0],
    `<div id="root">${PRERENDER_MARKER}${LANDING_ROOT_HTML}</div>`,
  );
}

/** True when the shell already carries the prerendered landing mirror. */
export function isPrerendered(html: string): boolean {
  return html.includes(PRERENDER_MARKER);
}

// ======================================================================
// RUNTIME HANDLER — GET / (defence-in-depth re-emit)
// ======================================================================

/**
 * dist/index.html, read once per process. The build step
 * (`server/scripts/prerender.ts`) already ships the prerendered
 * file, so this cache normally holds prerendered bytes; the
 * injection here is the safety net for a dist/ built before the
 * prerender step existed. Cached because the file is immutable
 * for the lifetime of the running process (a new deploy restarts
 * the process and re-reads).
 */
let cachedShell: string | null = null;

function readDistSpaShell(): string | null {
  if (cachedShell !== null) {
    return cachedShell;
  }
  const indexPath = path.resolve(process.cwd(), 'dist', 'index.html');
  try {
    if (!existsSync(indexPath)) {
      return null;
    }
    cachedShell = readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
  return cachedShell;
}

/**
 * Express handler for `GET /` — serves the landing shell with the
 * static marketing mirror inside `#root`, so crawlers that never
 * execute JavaScript still receive the full page content.
 *
 * Mounted with the other platform SEO handlers, BEFORE
 * `express.static` and the SPA fallback. Falls through to the
 * normal SPA path whenever `dist/index.html` is unavailable
 * (dev mode, partial deploy) — never blocks a request.
 */
export function handlePrerenderedLanding(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  const shell = readDistSpaShell();
  if (shell === null) {
    next();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(prerenderSpaShell(shell));
}
