// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Order, Restaurant } from '../types/restaurant';

/**
 * Customer transfer payment details — UI contract.
 *
 * The guest must be told WHERE to send the money, per channel, from the venue's
 * own settings — and must never face an empty card, an "undefined" or an
 * invented account number when the venue configured nothing.
 *
 * Rendered interactively (createRoot + act) so the channel switch and the
 * "open on the channel the venue configured" behaviour are actually exercised,
 * not just asserted against source text.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const modalSource = source('../components/customer/TransferPaymentModal.tsx');
const customerLayoutSource = source('../components/customer/CustomerLayout.tsx');
const trackingDrawerSource = source('../components/customer/OrderTrackingDrawer.tsx');
const settingsSource = source('../components/manager/BrandingSettingsView.tsx');

const TRANSFER = {
  bankName: 'بنك فلسطين',
  bankAccount: 'PS52 PALS 0453 1234 5678 9012 3456 7',
  bankAccountHolder: 'مطعم الأوركيد',
  walletName: 'محفظة جوال',
  walletNumber: '0599222222',
  walletAccountHolder: 'الأوركيد للمأكولات',
  instructions: 'اكتب رقم الطاولة في ملاحظة التحويل',
};

// Mutable context: each test sets the tenant it wants to render against.
const ctx: {
  currentRestaurant: Partial<Restaurant> | null;
  submitTransferPaymentProof: ReturnType<typeof vi.fn>;
} = {
  currentRestaurant: null,
  submitTransferPaymentProof: vi.fn(async () => ({ success: true })),
};

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      currentRestaurant: ctx.currentRestaurant,
      submitTransferPaymentProof: ctx.submitTransferPaymentProof,
      setCurrentRestaurant: vi.fn(),
      refreshTenantData: vi.fn(),
      showToast: vi.fn(),
    }),
  };
});

const { TransferPaymentModal } = await import(
  '../components/customer/TransferPaymentModal'
);
const { BrandingSettingsView } = await import(
  '../components/manager/BrandingSettingsView'
);

const order: Order = {
  id: 'order-1',
  numericId: 42,
  restaurantId: 'rest-1',
  tableId: 'table-1',
  tableNumber: 7,
  items: [],
  subtotal: 68,
  total: 68,
  status: 'PENDING',
  paymentMethod: 'PAY AT CASHIER',
  paymentStatus: 'UNPAID',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const venue = (transfer?: unknown, phone = '0599111111') =>
  ({
    id: 'rest-1',
    name: 'مطعم الأوركيد',
    slug: 'orchid',
    currency: '₪',
    phone,
    ...(transfer === undefined ? {} : { transfer }),
  }) as Partial<Restaurant>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Mount the modal and return its rendered text. */
async function mountModal(): Promise<string> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <TransferPaymentModal isOpen onClose={() => {}} order={order} />
    );
  });
  return host.textContent || '';
}

/** Click the channel radio (BANK | WALLET) and return the new text. */
async function pickChannel(channel: 'حوالة بنكية' | 'محفظة إلكترونية'): Promise<string> {
  const buttons = [...(host!.querySelectorAll('[role="radio"]') as NodeListOf<HTMLButtonElement>)];
  const target = buttons.find((b) => (b.textContent || '').includes(channel));
  expect(target, `channel button ${channel}`).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  return host!.textContent || '';
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
  ctx.currentRestaurant = null;
  vi.clearAllMocks();
});

// ===========================================================================
// Guest modal — the configured channel
// ===========================================================================
describe('guest transfer modal — shows the venue’s receiving account', () => {
  it('renders the BANK details (bank name, IBAN, holder) and the instructions', async () => {
    ctx.currentRestaurant = venue(TRANSFER);
    const text = await mountModal();

    expect(text).toContain('حوّل إلى حساب المطعم البنكي');
    expect(text).toContain('بنك فلسطين');
    expect(text).toContain('PS52 PALS 0453 1234 5678 9012 3456 7');
    expect(text).toContain('مطعم الأوركيد');
    expect(text).toContain('رقم الحساب / IBAN');
    expect(text).toContain('اسم صاحب الحساب');
    expect(text).toContain('اكتب رقم الطاولة في ملاحظة التحويل');
    // The wallet account is NOT shown while the bank channel is selected.
    expect(text).not.toContain('0599222222');
    expect(text).not.toContain('الأوركيد للمأكولات');
    // The order amount stays the single money surface.
    expect(text).toContain('68');
  });

  it('switches to the WALLET details when the guest picks the wallet channel', async () => {
    ctx.currentRestaurant = venue(TRANSFER);
    await mountModal();
    const text = await pickChannel('محفظة إلكترونية');

    expect(text).toContain('حوّل إلى محفظة المطعم');
    expect(text).toContain('محفظة جوال');
    expect(text).toContain('0599222222');
    expect(text).toContain('الأوركيد للمأكولات');
    expect(text).toContain('رقم المحفظة');
    // Instructions are shared by both channels.
    expect(text).toContain('اكتب رقم الطاولة في ملاحظة التحويل');
    // The bank account disappears with the channel — one account at a time.
    expect(text).not.toContain('PS52 PALS 0453 1234 5678 9012 3456 7');
  });

  it('opens on the channel the venue actually configured (wallet-only venue)', async () => {
    ctx.currentRestaurant = venue({
      walletName: 'محفظة جوال',
      walletNumber: '0599222222',
      walletAccountHolder: 'الأوركيد للمأكولات',
    });
    const text = await mountModal();

    // No bank account exists, so the guest must not land on an empty bank card.
    expect(text).toContain('حوّل إلى محفظة المطعم');
    expect(text).toContain('0599222222');
    expect(text).not.toContain('لم يعلن المطعم بيانات');
    const checked = host!.querySelector('[role="radio"][aria-checked="true"]');
    expect(checked?.textContent).toContain('محفظة إلكترونية');
  });

  it('renders a partial configuration without inventing the missing values', async () => {
    ctx.currentRestaurant = venue({ bankAccount: 'PS33 QDSE 0000 1111 2222 3333 4444 5' });
    const text = await mountModal();

    expect(text).toContain('PS33 QDSE 0000 1111 2222 3333 4444 5');
    expect(text).not.toContain('اسم البنك');
    expect(text).not.toContain('اسم صاحب الحساب');
    expect(text).not.toContain('undefined');
  });

  it('keeps the account value selectable and offers a copy action', async () => {
    ctx.currentRestaurant = venue(TRANSFER);
    await mountModal();
    const value = host!.querySelector('[dir="ltr"].select-all');
    expect(value?.textContent).toBe('PS52 PALS 0453 1234 5678 9012 3456 7');
    const copy = host!.querySelector('button[aria-label^="نسخ"]');
    expect(copy).toBeTruthy();
  });
});

// ===========================================================================
// Guest modal — the fallback (nothing configured)
// ===========================================================================
describe('guest transfer modal — safe fallback when the venue configured nothing', () => {
  it('shows a safe message with the venue phone, and never an empty card or "undefined"', async () => {
    ctx.currentRestaurant = venue(undefined, '0599111111');
    const text = await mountModal();

    expect(text).toContain('لم يعلن المطعم بيانات حسابه البنكي بعد');
    expect(text).toContain('0599111111');
    expect(text).toContain('ادفع نقداً عند الكاشير');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).not.toContain('رقم الحساب / IBAN');
    // The rest of the flow is untouched: the guest can still submit a receipt.
    expect(text).toContain('إرسال إشعار التحويل');
    expect(text).toContain('المبلغ المطلوب تحويله');
  });

  it('omits the phone from the message when the venue has no phone', async () => {
    ctx.currentRestaurant = venue(undefined, '');
    const text = await mountModal();

    expect(text).toContain('لم يعلن المطعم بيانات حسابه البنكي بعد');
    expect(text).toContain('تواصل مع طاقم المطعم للحصول على بيانات التحويل');
    expect(text).not.toContain('تواصل مع المطعم على');
    expect(text).not.toContain('undefined');
  });

  it('points the guest to the channel that IS configured', async () => {
    ctx.currentRestaurant = venue({ walletName: 'محفظة جوال', walletNumber: '0599222222' });
    await mountModal();
    // The auto-select already moved the guest to the wallet; force the bank
    // channel to exercise the cross-channel hint.
    ctx.currentRestaurant = venue({ bankName: 'بنك فلسطين', bankAccount: 'PS52PALS0453123456' });
    await act(async () => {
      root!.unmount();
    });
    if (host) host.remove();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<TransferPaymentModal isOpen onClose={() => {}} order={order} />);
    });
    const text = await pickChannel('محفظة إلكترونية');

    expect(text).toContain('لم يعلن المطعم بيانات محفظته الإلكترونية بعد');
    expect(text).toContain('يستقبل المطعم التحويل البنكي');
    expect(text).not.toContain('undefined');
  });

  it('survives a legacy payload with no transfer key at all', async () => {
    ctx.currentRestaurant = venue(undefined);
    const html = renderToStaticMarkup(
      <TransferPaymentModal isOpen onClose={() => {}} order={order} />
    );
    expect(html).toContain('لم يعلن المطعم بيانات حسابه البنكي بعد');
    expect(html).not.toContain('undefined');
  });
});

// ===========================================================================
// Contract guards — nothing else in the payment flow moved
// ===========================================================================
describe('transfer details — wiring contract', () => {
  it('reads the venue from context: no new props, no new request', () => {
    // The modal signature is unchanged, so both mount points keep working.
    expect(modalSource).toContain('interface TransferPaymentModalProps {\n  isOpen: boolean;\n  onClose: () => void;\n  order: Order;\n}');
    expect(modalSource).toContain('currentRestaurant?.transfer');
    expect(modalSource).not.toMatch(/fetch\(|api\.get|XMLHttpRequest/);
    expect(customerLayoutSource).toContain('<TransferPaymentModal');
    expect(trackingDrawerSource).toContain('<TransferPaymentModal');
    // Both mount points still pass only the original three props (no transfer
    // payload prop was added — the modal reads the venue from context).
    for (const src of [customerLayoutSource, trackingDrawerSource]) {
      const block = src.slice(
        src.indexOf('<TransferPaymentModal'),
        src.indexOf('/>', src.indexOf('<TransferPaymentModal'))
      );
      expect(block).toMatch(/order=/);
      expect(block).toMatch(/onClose=/);
      expect(block).toMatch(/isOpen/);
      // No transfer payload was threaded through as a prop.
      expect(block).not.toMatch(/transfer\w*\s*=/);
      expect(block).not.toMatch(/bankAccount|walletNumber|instructions=/);
    }
  });

  it('never submits the venue account with the payment proof', () => {
    const submitBlock = modalSource.slice(
      modalSource.indexOf('const result = await submitTransferPaymentProof('),
      modalSource.indexOf('if (result.success) {')
    );
    expect(submitBlock).toContain('customerName: customerName.trim()');
    expect(submitBlock).toContain('phone: phone.trim()');
    expect(submitBlock).toContain('channel');
    expect(submitBlock).not.toMatch(/transfer\??\.(bank|wallet|instructions)/);
    expect(submitBlock).not.toContain('activeView');
  });

  it('keeps the existing guest flow copy and validation intact', () => {
    expect(modalSource).toContain("useState<TransferChannel>('BANK')");
    expect(modalSource).toContain('لا يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع');
    expect(modalSource).toContain('تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.');
    expect(modalSource).toContain('اسم العميل');
    expect(modalSource).toContain('رقم الهاتف المحمول');
  });
});

// ===========================================================================
// Manager settings — Restaurant Settings → Payment Configuration
// ===========================================================================
describe('manager settings — Customer Transfer Payment section', () => {
  /** Mount the settings screen so its sync effect actually runs. */
  async function mountSettings(): Promise<HTMLElement> {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<BrandingSettingsView />);
    });
    return host;
  }

  const valueOf = (id: string) =>
    (host!.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement | null)?.value;

  /**
   * A realistic MAPPED restaurant row (what `mapRestaurantRow` always hands the
   * manager screens: `nameEn`/`description`/`galleryImages` are never undefined).
   */
  const settingsVenue = (transfer?: unknown) =>
    ({
      ...venue(transfer),
      nameEn: 'Orchid',
      description: 'وصف المطعم',
      address: 'شارع الاستقلال',
      logo: '',
      coverImage: '',
      mapImageUrl: '',
      galleryImages: [],
      primaryColor: '#D4AF37',
      accentColor: '#C5A880',
      businessType: 'RESTAURANT',
      promoVideoUrl: '',
      updatedAt: '2026-09-17T00:00:00.000Z',
    }) as Partial<Restaurant>;

  it('renders the seven inputs, pre-filled from the tenant’s own settings', async () => {
    ctx.currentRestaurant = settingsVenue(TRANSFER);
    const el = await mountSettings();
    const text = el.textContent || '';

    const ids = [
      'brandingsettingsview-transfer-bank-name',
      'brandingsettingsview-transfer-bank-account',
      'brandingsettingsview-transfer-bank-holder',
      'brandingsettingsview-transfer-wallet-name',
      'brandingsettingsview-transfer-wallet-number',
      'brandingsettingsview-transfer-wallet-holder',
      'brandingsettingsview-transfer-instructions',
    ];
    for (const id of ids) expect(el.querySelector(`#${id}`), id).toBeTruthy();

    // Pre-filled from the tenant's stored settings (the sync effect ran).
    expect(valueOf('brandingsettingsview-transfer-bank-name')).toBe(TRANSFER.bankName);
    expect(valueOf('brandingsettingsview-transfer-bank-account')).toBe(TRANSFER.bankAccount);
    expect(valueOf('brandingsettingsview-transfer-bank-holder')).toBe(TRANSFER.bankAccountHolder);
    expect(valueOf('brandingsettingsview-transfer-wallet-name')).toBe(TRANSFER.walletName);
    expect(valueOf('brandingsettingsview-transfer-wallet-number')).toBe(TRANSFER.walletNumber);
    expect(valueOf('brandingsettingsview-transfer-wallet-holder')).toBe(TRANSFER.walletAccountHolder);
    expect(valueOf('brandingsettingsview-transfer-instructions')).toBe(TRANSFER.instructions);

    expect(text).toContain('إعدادات الدفع — تحويل العميل');
    expect(text).toContain('حوالة بنكية');
    expect(text).toContain('محفظة إلكترونية');
    // The section states that verification is still receipt-based.
    expect(text).toContain('الكاشير يؤكد');
    // Account numbers are LTR islands inside the RTL screen.
    expect(
      (el.querySelector('#brandingsettingsview-transfer-bank-account') as HTMLInputElement).dir
    ).toBe('ltr');
  });

  it('renders empty inputs (never "undefined") when nothing is configured', async () => {
    ctx.currentRestaurant = settingsVenue(undefined);
    const el = await mountSettings();

    expect(el.querySelector('#brandingsettingsview-transfer-bank-account')).toBeTruthy();
    expect(valueOf('brandingsettingsview-transfer-bank-account')).toBe('');
    expect(valueOf('brandingsettingsview-transfer-wallet-number')).toBe('');
    expect(valueOf('brandingsettingsview-transfer-instructions')).toBe('');
    expect(el.textContent).not.toContain('undefined');
    expect(el.innerHTML).not.toContain('>null<');
  });

  it('saves through the EXISTING branding form and endpoint (no new endpoint, no entitlement gate)', () => {
    // One form, one save button, one endpoint.
    expect(settingsSource).toContain('onSubmit={handleSave}');
    expect(settingsSource).toMatch(/api\.saveBranding\(currentRestaurant\.id, \{/);
    const saveBlock = settingsSource.slice(
      settingsSource.indexOf('const res = await api.saveBranding('),
      settingsSource.indexOf('setIsSaving(false);')
    );
    for (const key of [
      'bankName: transferBankName.trim()',
      'bankAccount: transferBankAccount.trim()',
      'bankAccountHolder: transferBankAccountHolder.trim()',
      'walletName: transferWalletName.trim()',
      'walletNumber: transferWalletNumber.trim()',
      'walletAccountHolder: transferWalletAccountHolder.trim()',
      'instructions: transferInstructions.trim()',
    ]) {
      expect(saveBlock).toContain(key);
    }
    // Input bounds mirror the server schema so a save cannot be 400-ed by a
    // value the form itself allowed.
    expect(settingsSource).toContain('maxLength={80}');
    expect(settingsSource).toContain('maxLength={40}');
    expect(settingsSource).toContain('maxLength={500}');
  });
});
