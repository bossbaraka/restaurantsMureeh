/* eslint-disable react/only-export-components -- this is a one-file harness:
   the components below are the preview's scene switch, not app exports. */
/* eslint-disable react/immutability -- the controller ref is deliberately
   assigned during render so the test can drive the real contexts. */
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { RestaurantProvider, useRestaurant } from '../../src/context/RestaurantContext';
import { CustomerLayout } from '../../src/components/customer/CustomerLayout';
import { KitchenDisplaySystem } from '../../src/components/manager/KitchenDisplaySystem';
import { PaymentVerificationPanel } from '../../src/components/manager/PaymentVerificationPanel';
import { ToastContainer } from '../../src/components/common/Toast';
import { api } from '../../src/services/api';
import { CASHIER, KITCHEN_STAFF, SESSION, TABLE, TENANT, createWorld, receiptFile, section, say, transcript } from './world';

/**
 * ============================================================================
 * LIVE PREVIEW — «كيف يتم الأمر»: طلب الزبون → التحقق من الدفع → الكاشير → المطبخ
 * ============================================================================
 * Run:  npx vitest run --config e2e/live-preview/vitest.live.config.ts
 *
 * It boots the REAL application (contexts + shipped components + API client) in
 * a DOM, against an in-memory stand-in for the Express/PostgreSQL backend, and
 * plays the whole fulfilment-gate story the way the three devices experience
 * it. Every step prints an HTTP/SSE/audit line, every scene asserts the Arabic
 * copy the user actually sees, and the rendered screens are written to
 * `e2e/live-preview/scenes.html` (with the compiled stylesheet inlined) so the
 * flow can be reviewed in a browser.
 *
 * What is REAL here: src/context/*, src/components/*, src/services/api.ts,
 * src/utils/orderLifecycle.ts, server/services/orderLifecycle.ts,
 * server/services/storage/imageSniff.ts.
 * What is STAND-IN: HTTP transport, Postgres, object storage and the four
 * browser APIs jsdom lacks (EventSource/XHR/createObjectURL/Image decode).
 */

type Scene = 'CUSTOMER' | 'KITCHEN' | 'CASHIER';

interface Controller {
  auth: ReturnType<typeof useAuth>;
  restaurant: ReturnType<typeof useRestaurant>;
  setScene: (scene: Scene) => void;
}

/** Inside the providers: reads the real contexts and renders one scene. */
const Scenes: React.FC<{ ctl: { current: Controller | null } }> = ({ ctl }) => {
  const auth = useAuth();
  const restaurant = useRestaurant();
  const [scene, setScene] = useState<Scene>('CUSTOMER');
  ctl.current = { auth, restaurant, setScene };

  return (
    <>
      <div id="scene" data-scene={scene}>
        {scene === 'CUSTOMER' && <CustomerLayout />}
        {scene === 'KITCHEN' && <KitchenDisplaySystem />}
        {scene === 'CASHIER' && (
          <div className="min-h-screen bg-[#040D1A] p-6">
            <PaymentVerificationPanel />
          </div>
        )}
      </div>
      {/* the real toast layer: kept OUTSIDE #scene so a scene assertion can
          never accidentally match a lingering notification */}
      <ToastContainer />
    </>
  );
};

const Harness: React.FC<{ ctl: { current: Controller | null } }> = ({ ctl }) => (
  <AuthProvider>
    <RestaurantProvider>
      <Scenes ctl={ctl} />
    </RestaurantProvider>
  </AuthProvider>
);

const world = createWorld();
const ctl: { current: Controller | null } = { current: null };
const scenes: Array<{ title: string; note: string; log: string[]; html: string }> = [];

let container: HTMLDivElement;
let root: Root;
let logMark = 0;

const flush = async (rounds = 4) => {
  for (let index = 0; index < rounds; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const text = () => container.textContent || '';
/** Text of the mounted scene only (toasts live outside #scene). */
const screen = () => container.querySelector('#scene')?.textContent || '';

const waitFor = async (
  label: string,
  predicate: () => boolean,
  timeoutMs = 4000,
  refresh = false
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    // The context coalesces concurrent reads (in-flight lock), so a burst of
    // SSE events can leave one refresh dropped — this re-reads the server the
    // same way the app's own 10s poll would.
    if (refresh && ctl.current) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        ctl.current!.restaurant.refreshTenantData();
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await flush(1);
  }
  throw new Error(`timed out waiting for: ${label}\n--- screen text ---\n${text().slice(0, 1200)}`);
};

const capture = (title: string, note: string) => {
  scenes.push({ title, note, log: transcript.slice(logMark), html: container.innerHTML });
  logMark = transcript.length;
  say(`\n[screen]  ${title}\n          ${note}`);
};

const showScene = async (scene: Scene, label: string) => {
  await act(async () => ctl.current!.setScene(scene));
  await flush(2);
  say(`\n[device]  ${label}`);
};

/** React-controlled inputs ignore direct value assignment; go through the setter. */
const typeInto = async (element: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush(1);
};

/** The tracker collapses every card but one; expand the card we assert on. */
const expandOrderCard = async (orderId: string) => {
  const card = [...container.querySelectorAll<HTMLElement>('div')].find(
    (node) =>
      (node.className || '').toString().includes('bg-luxury-850/90') &&
      (node.textContent || '').includes(`طلب ${orderId}`)
  );
  expect(card, `order card ${orderId}`).toBeTruthy();
  const toggle = [...card!.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => (node.textContent || '').trim() === ''
  );
  expect(toggle, 'the card expand toggle').toBeTruthy();
  await act(async () => {
    toggle!.click();
  });
  await flush(2);
};

const clickByText = async (selector: string, needle: string) => {
  const target = [...container.querySelectorAll<HTMLElement>(selector)].find((node) =>
    (node.textContent || '').includes(needle)
  );
  expect(target, `button containing «${needle}»`).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await flush(2);
  return target!;
};

it('plays the whole fulfilment-gate flow (guest → cashier → KDS) on the real UI', async () => {
  world.reset();
  world.install();

  // ------------------------------------------------------------------ boot
  section('٠) تشغيل التطبيق الحقيقي في DOM مع خادم وهمي في الذاكرة');
  window.history.replaceState({}, '', `/r/${TENANT.slug}?qr=${TABLE.qrToken}`);
  window.localStorage.clear();
  container = document.createElement('div');
  container.id = 'app-root';
  document.body.appendChild(container);

  await act(async () => {
    root = createRoot(container);
    root.render(<Harness ctl={ctl} />);
  });
  await waitFor('the guest menu is ready', () => text().includes('كبسة لحم'));

  const restaurant = () => ctl.current!.restaurant;
  say(`[guest]   مسح رمز QR للطاولة ${TABLE.number} → الجلسة ${SESSION.id} جاهزة، والقائمة محمّلة من الخادم`);

  // ============================================================ 1. the order
  section('١) الزبون يرسل الطلب — الطلب يُنشأ خارج مسار المطبخ (AWAITING_PAYMENT)');
  const product = restaurant().products.find((item) => item.id === 'prod-kabsa')!;
  expect(product).toBeTruthy();
  await act(async () => {
    restaurant().addToCart(product, 2, {});
  });
  await flush(1);

  let created: { success: boolean; order?: any; error?: string } = { success: false };
  await act(async () => {
    created = await restaurant().createOrder('بدون بصل');
  });
  await flush(3);

  expect(created.success).toBe(true);
  const order1 = created.order!;
  const row1 = () => world.state.orders.get(order1.id)!;
  expect(row1().fulfillmentState).toBe('AWAITING_PAYMENT');
  expect(row1().paymentStatus).toBe('UNPAID');
  expect(row1().status).toBe('PENDING');
  expect(row1().releasedAt).toBeNull();

  expect(text()).toContain('تم إرسال طلبك، يرجى تأكيد عملية الدفع لإتمام الطلب.');
  await waitFor('the mandatory payment step is on screen', () =>
    screen().includes('لا يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع')
  );
  expect(screen()).toContain('اسم العميل');
  expect(screen()).toContain('صورة إشعار التحويل');
  capture(
    '١ — الزبون: خطوة الدفع الإلزامية بعد إرسال الطلب',
    'الطلب #' +
      order1.numericId +
      ' أُنشئ بحالة AWAITING_PAYMENT: نافذة تأكيد الدفع (الاسم + الهاتف + صورة الإشعار) مفتوحة، والمطبخ لم يستلم شيئاً.'
  );

  // ================================================== 2. the kitchen sees none
  section('٢) شاشة المطبخ: الطلب غير موجود — ومحاولة بدئه تُرفض من الخادم');
  world.setStaffUser(KITCHEN_STAFF);
  window.localStorage.setItem('merar_auth_token', 'fake-jwt-kitchen');
  window.localStorage.setItem('merar_user_session', JSON.stringify(KITCHEN_STAFF));
  window.localStorage.setItem('merar_manager_restaurant', JSON.stringify(TENANT));
  await act(async () => {
    ctl.current!.auth.setCurrentUser({ ...KITCHEN_STAFF, restaurantId: TENANT.id } as any);
    ctl.current!.auth.switchManagerRestaurant(TENANT.id);
    restaurant().setCurrentRestaurant({ ...TENANT, primaryColor: '#D4AF37', accentColor: '#0EA5E9' } as any);
    restaurant().setViewMode('KITCHEN_KDS');
  });
  await flush(3);
  await act(async () => {
    restaurant().refreshTenantData();
  });
  await flush(3);

  await showScene('KITCHEN', 'شاشة المطبخ (KDS) — الجهاز الثاني في المطعم');
  expect(screen()).toContain('بانتظار تأكيد الكاشير');
  expect(screen()).not.toContain(`#${order1.numericId}`);
  say(`[kds]     العدد المعروض في اللافتة: طلب محجوز واحد، ولا يوجد تكت داخل لوحة التحضير`);

  const advance = await api.updateOrderStatus(
    { ...KITCHEN_STAFF, restaurantId: TENANT.id } as any,
    TENANT.id,
    order1.id,
    'PREPARING'
  );
  expect(advance.success).toBe(false);
  expect(advance.statusCode).toBe(409);
  expect(advance.error).toContain('لا يمكن بدء تحضيره قبل تأكيد الدفع');
  expect(row1().status).toBe('PENDING');
  capture(
    '٢ — المطبخ: الطلب محجوز ولا يظهر كتكت',
    'لافتة «بانتظار تأكيد الكاشير للدفع» تعرض العدد فقط، وطلب تغيير الحالة إلى PREPARING يُرفض من الخادم (409).'
  );

  // ============================================ 3. cashier queue: awaiting guest
  section('٣) الكاشير: الطلب يظهر في قائمة «بانتظار دفع الزبون» (لا إشعار للتحقق بعد)');
  world.setStaffUser(CASHIER);
  window.localStorage.setItem('merar_user_session', JSON.stringify(CASHIER));
  await act(async () => {
    ctl.current!.auth.setCurrentUser({ ...CASHIER, restaurantId: TENANT.id } as any);
  });
  await flush(2);
  await showScene('CASHIER', 'شاشة الكاشير — قائمة التحقق من الدفع');
  await waitFor('the awaiting-payment group', () => screen().includes('بانتظار دفع الزبون'));
  expect(screen()).toContain('لا يوجد إشعار للتحقق بعد');
  await waitFor('the order card', () => screen().includes(`#${order1.numericId}`));
  const hasConfirmButton = () =>
    [...container.querySelectorAll('button')].some((node) => (node.textContent || '').includes('تأكيد'));
  expect(hasConfirmButton()).toBe(false);
  const queue1 = await api.getPaymentVerifications(CASHIER as any, TENANT.id, { includeAwaiting: true });
  expect(queue1.data?.find((item) => item.orderId === order1.id)?.state).toBe('WAITING_RECEIPT');
  capture(
    '٣ — الكاشير: قسم «بانتظار دفع الزبون»',
    'الطلب ظاهر للكاشير بحالة WAITING_RECEIPT (لا يوجد إشعار ليتحقق منه) — لا يوجد زر تأكيد، والمطبخ ما زال لا يرى الطلب.'
  );

  // ================================================ 4. the guest sends receipt
  section('٤) الزبون يرسل إشعار التحويل من نفس النافذة (اسم + هاتف + صورة الإشعار)');
  await act(async () => {
    ctl.current!.auth.setCurrentUser(null);
  });
  await flush(1);
  await showScene('CUSTOMER', 'جهاز الزبون — نافذة تأكيد الدفع');
  await waitFor('the transfer modal', () => screen().includes('صورة إشعار التحويل'));
  await typeInto(container.querySelector<HTMLInputElement>('#transfer-name')!, 'ليلى أبو أحمد');
  await typeInto(container.querySelector<HTMLInputElement>('#transfer-phone')!, '0599123456');

  const fileInput = container.querySelector<HTMLInputElement>('#transfer-proof-file')!;
  const file = receiptFile();
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(2);

  await clickByText('button', 'إرسال');
  await waitFor('the upload to be acknowledged', () =>
    screen().includes('تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.')
  );
  expect(row1().paymentStatus).toBe('PENDING_VERIFICATION');
  expect(row1().fulfillmentState).toBe('PAYMENT_VERIFICATION_PENDING');
  expect(row1().paymentProofPath).toContain(`restaurants/${TENANT.id}/payment-proofs/`);
  expect(row1().paymentProofPath).toMatch(/\.png$/);
  expect(world.state.audits.some((row) => row.action === 'PAYMENT_PROOF_SUBMITTED')).toBe(true);
  capture(
    '٤ — الزبون: «تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.»',
    'الرفع مرّ عبر مسار النافذة الحقيقي (تصغير الصورة ثم XMLHttpRequest multipart)، والخادم تحقق من الحجم والتوقيع الثنائي (magic bytes).'
  );

  // ==================================================== 5. cashier can decide
  section('٥) الكاشير: الإشعار انتقل إلى قسم «التحقق» مع صورة الإشعار وبيانات الزبون');
  await act(async () => {
    ctl.current!.auth.setCurrentUser({ ...CASHIER, restaurantId: TENANT.id } as any);
  });
  await flush(1);
  await showScene('CASHIER', 'شاشة الكاشير — القائمة المحدّثة لحظياً (SSE)');
  await waitFor(
    'the receipt to move into the actionable verification group',
    () => screen().includes('ليلى أبو أحمد') && hasConfirmButton()
  );
  expect(screen()).toContain('0599123456');
  expect(screen()).toContain('حوالة بنكية');
  // The waiting-for-the-guest group is now empty (the receipt arrived).
  expect(screen()).not.toContain('لا يوجد إشعار للتحقق بعد');
  const queue2 = await api.getPaymentVerifications(CASHIER as any, TENANT.id, { includeAwaiting: true });
  const queued = queue2.data!.find((item) => item.orderId === order1.id)!;
  expect(queued.state).toBe('WAITING_VERIFICATION');
  expect(queued.fulfillmentState).toBe('PAYMENT_VERIFICATION_PENDING');
  expect(queued.hasPaymentProof).toBe(true);
  // The receipt image itself: Bearer-authenticated fetch of private bytes.
  const objectUrl = await api.fetchPaymentProofObjectUrl(TENANT.id, order1.id);
  expect(objectUrl.success).toBe(true);
  expect(objectUrl.data?.objectUrl).toContain('blob:');
  capture(
    '٥ — الكاشير: قسم التحقق (WAITING_VERIFICATION)',
    'الصورة والاسم والهاتف والطلب كامل الأصناف أمام الكاشير، والطلب ما زال خارج المطبخ حتى يقرر.'
  );

  // ==================================================== 6. KDS still hides it
  section('٦) المطبخ مرة أخرى: الإشعار المرسل لا يحرّك الطلب — البوابة ما زالت مغلقة');
  await showScene('KITCHEN', 'شاشة المطبخ — قبل قرار الكاشير');
  expect(screen()).toContain('بانتظار تأكيد الكاشير');
  expect(screen()).not.toContain(`#${order1.numericId}`);
  say('[kds]     إشعار التحويل وحده لم يُدخل الطلب إلى المطبخ');

  // ================================================= 7. cashier confirms payment
  section('٧) الكاشير يؤكد الدفع — المال والبوابة يُكتبان في عبارة واحدة (نفس المعاملة)');
  await act(async () => {
    ctl.current!.auth.setCurrentUser(null);
  });
  await flush(1);
  await showScene('CUSTOMER', 'جهاز الزبون ينتظر إشعار التأكيد (بدون تحديث الصفحة)');
  const before = transcript.length;

  const confirm = await api.confirmTransferPayment({ ...CASHIER, restaurantId: TENANT.id } as any, TENANT.id, order1.id);
  expect(confirm.success).toBe(true);
  expect(confirm.statusCode).toBe(201);
  expect(confirm.data?.kitchenReleased).toBe(true);
  expect(confirm.data?.orderStatus).toBe('PENDING');
  // `payment` is nullable in the client contract (a replay may not resend the
  // ledger row), so the receipt number is read defensively here too.
  expect(confirm.data?.payment?.receiptNumber).toBe('R-5001');
  expect(row1().paymentStatus).toBe('PAID');
  expect(row1().fulfillmentState).toBe('RELEASED');
  expect(row1().releasedAt).toBeTruthy();
  expect(row1().status).toBe('PENDING'); // still a fresh ticket for the kitchen
  expect(world.state.payments).toHaveLength(1);
  expect(world.state.payments[0].method).toBe('TRANSFER');
  expect(world.state.audits.map((row) => row.action)).toEqual(
    expect.arrayContaining(['PAYMENT_VERIFIED', 'ORDER_RELEASED_TO_KDS'])
  );
  expect(transcript.slice(before).some((line) => line.includes('ORDER_RELEASED_TO_KITCHEN'))).toBe(true);

  // The toast is the live notification; the tracker banner is the same copy.
  await waitFor('the guest toast after the release', () =>
    text().includes('تم تأكيد الدفع، وجارٍ تجهيز طلبك.')
  );
  await waitFor(
    'the guest tracker banner after the release',
    () => screen().includes('تم تأكيد الدفع، وجارٍ تجهيز طلبك.'),
    4000,
    true
  );
  expect(screen()).toContain('(تحويل بنكي/محفظة)');
  capture(
    '٧ — الزبون: «تم تأكيد الدفع، وجارٍ تجهيز طلبك.» بدون تحديث الصفحة',
    'تأكيد الكاشير بثّ ORDER_RELEASED_TO_KITCHEN عبر SSE، فحدّث جهاز الزبون نفسه وظهرت البطاقة الخضراء.'
  );

  // ============================================ 8. the ticket appears in the KDS
  section('٨) المطبخ: التكت يظهر فوراً بحالة «جاهز للبدء» ثم يبدأ التحضير');
  // back to the kitchen device (its own JWT + view, exactly like its tablet)
  await act(async () => {
    ctl.current!.auth.setCurrentUser({ ...KITCHEN_STAFF, restaurantId: TENANT.id } as any);
    ctl.current!.restaurant.setViewMode('KITCHEN_KDS');
  });
  await flush(2);
  await showScene('KITCHEN', 'شاشة المطبخ — بعد تأكيد الكاشير');
  await waitFor('the released ticket', () => screen().includes(`#${order1.numericId}`));
  expect(screen()).toContain('تحويل مؤكد — جاهز للبدء فوراً');
  expect(screen()).not.toContain('بانتظار تأكيد الكاشير');
  await clickByText('button', 'بدء التحضير');
  await waitFor('the ticket to move to PREPARING', () => row1().status === 'PREPARING');
  say('[kds]     الطلب انتقل إلى PREPARING — التحضير بدأ فعلياً بعد التحقق من الدفع فقط');
  capture(
    '٨ — المطبخ: تكت جديد يظهر بدون تحديث يدوي',
    'الطلب صار PAID + RELEASED في نفس العبارة، ووصل إلى اللوحة كتكت جديد (PENDING) ثم انتقل إلى PREPARING بضغطة واحدة.'
  );

  // ================================================= 9. double confirm / race
  section('٩) طلبٌ ثانٍ: محاولتا تأكيد متزامنتان → إيصال واحد فقط');
  await act(async () => {
    ctl.current!.auth.setCurrentUser(null);
  });
  await flush(1);
  await showScene('CUSTOMER', 'جهاز الزبون الثاني');
  await act(async () => {
    restaurant().addToCart(product, 1, {});
  });
  await flush(1);
  let created2: any;
  await act(async () => {
    created2 = (await restaurant().createOrder('')) as any;
  });
  await flush(2);
  const order2 = created2.order;
  const row2 = () => world.state.orders.get(order2.id)!;
  const upload = await api.submitPaymentProof(
    {
      orderId: order2.id,
      restaurantId: TENANT.id,
      tableId: TABLE.id,
      sessionToken: SESSION.sessionToken,
      customerName: 'مراد سليم',
      phone: '0568001122',
      channel: 'WALLET',
      file: receiptFile('wallet.png'),
    },
    () => undefined
  );
  expect(upload.success).toBe(true);
  expect(row2().paymentStatus).toBe('PENDING_VERIFICATION');

  const receiptsBefore = world.state.payments.length;
  const [first, second] = await Promise.all([
    api.confirmTransferPayment({ ...CASHIER, restaurantId: TENANT.id } as any, TENANT.id, order2.id),
    api.confirmTransferPayment({ ...CASHIER, restaurantId: TENANT.id } as any, TENANT.id, order2.id),
  ]);
  const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
  expect(statuses).toEqual([200, 201]);
  const replay = [first, second].find((res) => res.statusCode === 200)!;
  expect(replay.data?.alreadyConfirmed).toBe(true);
  expect(replay.data?.kitchenReleased).toBe(true);
  expect(world.state.payments.length).toBe(receiptsBefore + 1);
  say('[server]  الطلب مدفوع مرة واحدة فقط: محاولة واحدة 201، والأخرى 200 alreadyConfirmed (بدون إيصال ثانٍ)');

  // ================================================== 10. reject the receipt
  section('١٠) الكاشير يرفض إشعاراً آخر: الطلب يبقى خارج المطبخ والزبون يُبلَّغ');
  await act(async () => {
    restaurant().addToCart(product, 3, {});
  });
  await flush(1);
  let created3: any;
  await act(async () => {
    created3 = (await restaurant().createOrder('')) as any;
  });
  await flush(2);
  const order3 = created3.order;
  const row3 = () => world.state.orders.get(order3.id)!;
  await api.submitPaymentProof(
    {
      orderId: order3.id,
      restaurantId: TENANT.id,
      tableId: TABLE.id,
      sessionToken: SESSION.sessionToken,
      customerName: 'سامي ناصر',
      phone: '0599000111',
      channel: 'BANK',
      file: receiptFile('blurry.png'),
    },
    () => undefined
  );
  expect(row3().paymentStatus).toBe('PENDING_VERIFICATION');

  const reject = await api.rejectTransferPayment(
    { ...CASHIER, restaurantId: TENANT.id } as any,
    TENANT.id,
    order3.id,
    'الإشعار غير واضح — يرجى إرسال صورة أوضح'
  );
  expect(reject.success).toBe(true);
  expect(reject.data?.fulfillmentState).toBe('PAYMENT_REJECTED');
  expect(reject.data?.paymentStatus).toBe('UNPAID');
  expect(row3().paymentStatus).toBe('UNPAID');
  expect(row3().fulfillmentState).toBe('PAYMENT_REJECTED');
  expect(row3().paymentProofPath).toBeNull();
  expect(world.state.audits.some((row) => row.action === 'PAYMENT_REJECTED')).toBe(true);

  await waitFor('the guest rejection banner', () => screen().includes('لم يتم التحقق من إشعار الحوالة'));
  await expandOrderCard(order3.id);
  expect(screen()).toContain('إرسال إشعار حوالة جديد');
  expect(screen()).toContain('يمكنك إرسال إشعار جديد أو الدفع عند الكاشير');
  capture(
    '١٠ — الزبون: «لم يتم التحقق من إشعار الحوالة …» + زر إرسال إشعار جديد',
    'الرفض أعاد المال إلى UNPAID وثبّت البوابة على PAYMENT_REJECTED، وحُذف ملف الإشعار، والزبون يرى السبب ويستطيع الدفع عند الكاشير.'
  );

  await showScene('KITCHEN', 'شاشة المطبخ — الطلب المرفوض غير موجود');
  expect(screen()).not.toContain(`#${order3.numericId}`);
  say('[kds]     الطلب المرفوض لم يصل إلى لوحة التحضير');

  // ============================================ 11. cancel after confirmation
  section('١١) محاولة إلغاء الزبون بعد تأكيد الدفع → 409 (المال محسوم)');
  await act(async () => {
    ctl.current!.auth.setCurrentUser(null);
  });
  await flush(1);
  await showScene('CUSTOMER', 'جهاز الزبون — محاولة إلغاء الطلب المؤكد');
  const cancel = await api.cancelOrder(TENANT.id, order1.id, SESSION.sessionToken);
  expect(cancel.success).toBe(false);
  expect(cancel.statusCode).toBe(409);
  expect(cancel.error).toContain('تم تأكيد دفع هذا الطلب');
  expect(row1().status).toBe('PREPARING');
  say('[server]  الإلغاء مرفوض: الطلب مدفوع، والتغيير العشوائي للحالة مستحيل من الواجهة');

  // ============================================================ 12. the summary
  section('١٢) الخلاصة: أين وصل كل طلب في قاعدة البيانات');
  for (const order of world.state.orders.values()) {
    say(
      `[db]      ${order.id} · status=${order.status} · paymentStatus=${order.paymentStatus} · gate=${order.fulfillmentState} · releasedAt=${order.releasedAt ?? '—'}`
    );
  }
  say(`\n[audit]   سجل التدقيق الكامل:\n${world.state.audits.map((row, index) => `          ${String(index + 1).padStart(2, '0')}. ${row.action} ${JSON.stringify(row.metadata ?? {})}`).join('\n')}`);
  say(
    `\n[events]  الأحداث المبثوثة:\n${world.state.emitted
      .map((event) => `          ${event.event} → ${event.deliveredTo}`)
      .join('\n')}`
  );

  // ------------------------------------------------------------------ output
  const compiledCss = (() => {
    // The production stylesheet (npm run build) so the snapshots render with
    // the real design tokens instead of unstyled markup.
    const distAssets = resolve(process.cwd(), 'dist/assets');
    if (!existsSync(distAssets)) return '';
    const cssFile = readdirSync(distAssets).find((name) => name.endsWith('.css'));
    return cssFile ? readFileSync(resolve(distAssets, cssFile), 'utf8') : '';
  })();

  const page = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>معاينة حية — دورة حياة الطلب: الزبون → التحقق من الدفع → الكاشير → المطبخ</title>
${compiledCss ? `<style>${compiledCss}</style>` : '<style>body{font-family:system-ui;background:#040D1A;color:#e2e8f0}</style>'}
<style>
  body { background:#040D1A; color:#e2e8f0; margin:0; padding:24px; font-family: system-ui, "Segoe UI", sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  .log { background:#0b1220; border:1px solid #1e293b; border-radius:12px; padding:16px; font-family: ui-monospace, monospace;
         font-size:12px; line-height:1.7; white-space:pre-wrap; direction:ltr; text-align:left; }
  .card { border:1px solid #1e293b; border-radius:16px; margin:24px 0; overflow:hidden; background:#020617; }
  .card h3 { margin:0; padding:12px 16px; background:#0b1220; font-size:14px; }
  .card p { margin:0; padding:8px 16px 12px; color:#94a3b8; font-size:12px; line-height:1.7; }
  /* translateZ(0) makes the card the containing block for the app's fixed
     modals/toasts, so every scene stays inside its own snapshot. */
  .shot { border-top:1px solid #1e293b; padding:12px; position:relative; max-height:680px; overflow:auto;
          background:#040D1A; transform: translateZ(0); }
  .shot::before { content:''; }
  h1 { font-size:22px; } h2 { font-size:16px; margin-top:32px; }
  .meta { color:#94a3b8; font-size:13px; line-height:1.9; }
  code { color:#e2e8f0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>معاينة حية — كيف يتم الأمر؟</h1>
  <p class="meta">
    هذه اللقطات التُقطت من التطبيق الحقيقي (نفس مكوّنات React وحالات السياق وعميل الـAPI وسياسة البوابة على الخادم)
    وهي تعمل في DOM مع خادم في الذاكرة (لا قاعدة بيانات في هذه البيئة).
    لتشغيل المعاينة بنفسك: <code>npx vitest run --config e2e/live-preview/vitest.live.config.ts</code>
  </p>
  <h2>سجل التشغيل (HTTP / SSE / Audit)</h2>
  <div class="log">${transcript.join('\n').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))}</div>
  ${scenes
    .map(
      (scene) => `<div class="card">
    <h3>${scene.title}</h3>
    <p>${scene.note}</p>
    <div class="shot">${scene.html}</div>
  </div>`
    )
    .join('\n')}
</div>
</body>
</html>`;

  const outPath = resolve(process.cwd(), 'e2e/live-preview/scenes.html');
  writeFileSync(outPath, page, 'utf8');
  say(`\n[output]  كُتبت اللقطات والسجل إلى: e2e/live-preview/scenes.html (${scenes.length} مشهد)`);

  await act(async () => {
    root.unmount();
  });
}, 120000);
