/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { api, mapRestaurantRow } from '../services/api';

// ============================================================================
// Customer transfer payment details — FRONTEND data layer.
//
// `mapRestaurantRow` is the single projection choke point every restaurant
// payload passes through, and it must understand BOTH server shapes:
//   - nested `transfer: { bankName, … }` → GET /api/public/restaurants/:slug
//   - flat   `transferBankName`, …       → /auth/login, /auth/me, PUT /branding
//
// `saveBranding` must flatten back to the server's column names while keeping
// the write contract: an omitted field is dropped from the JSON body (column
// untouched) and '' is an explicit clear.
// ============================================================================

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const baseRow = {
  id: TENANT_ID,
  name: 'مطعم الأوركيد',
  nameEn: 'Orchid',
  slug: 'orchid',
  status: 'ACTIVE',
  currency: '₪',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const TRANSFER = {
  bankName: 'بنك فلسطين',
  bankAccount: 'PS52 PALS 0453 1234 5678 9012 3456 7',
  bankAccountHolder: 'مطعم الأوركيد',
  walletName: 'محفظة جوال',
  walletNumber: '0599222222',
  walletAccountHolder: 'الأوركيد للمأكولات',
  instructions: 'اكتب رقم الطاولة في ملاحظة التحويل',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapRestaurantRow — transfer details (both server shapes)', () => {
  it('maps the NESTED guest-catalog payload', () => {
    const mapped = mapRestaurantRow({ ...baseRow, transfer: TRANSFER });
    expect(mapped.transfer).toEqual(TRANSFER);
  });

  it('maps the FLAT row shape returned by /auth/login, /auth/me and PUT /branding', () => {
    const mapped = mapRestaurantRow({
      ...baseRow,
      transferBankName: TRANSFER.bankName,
      transferBankAccount: TRANSFER.bankAccount,
      transferBankAccountHolder: TRANSFER.bankAccountHolder,
      transferWalletName: TRANSFER.walletName,
      transferWalletNumber: TRANSFER.walletNumber,
      transferWalletAccountHolder: TRANSFER.walletAccountHolder,
      transferInstructions: TRANSFER.instructions,
    });
    expect(mapped.transfer).toEqual(TRANSFER);
  });

  it('returns undefined when the venue configured nothing (legacy payloads included)', () => {
    expect(mapRestaurantRow({ ...baseRow }).transfer).toBeUndefined();
    expect(
      mapRestaurantRow({
        ...baseRow,
        transferBankName: null,
        transferBankAccount: null,
        transferWalletNumber: null,
        transferInstructions: null,
      }).transfer
    ).toBeUndefined();
  });

  it('drops empty / whitespace-only / non-string values instead of rendering them', () => {
    const mapped = mapRestaurantRow({
      ...baseRow,
      transfer: {
        bankName: '  بنك فلسطين  ',
        bankAccount: '   ',
        bankAccountHolder: '',
        walletName: null,
        walletNumber: 555,
        instructions: 'تعليمات',
      },
    });
    expect(mapped.transfer).toEqual({
      bankName: 'بنك فلسطين',
      instructions: 'تعليمات',
    });
    expect(mapped.transfer!.bankAccount).toBeUndefined();
    expect(mapped.transfer!.walletNumber).toBeUndefined();
  });

  it('keeps a partially configured channel (bank only) without inventing wallet values', () => {
    const mapped = mapRestaurantRow({
      ...baseRow,
      transferBankName: 'بنك القدس',
      transferBankAccount: 'PS33 QDSE 0000 1111 2222 3333 4444 5',
      transferBankAccountHolder: 'مطعم غصن',
      transferWalletName: null,
      transferWalletNumber: null,
      transferWalletAccountHolder: null,
    });
    expect(mapped.transfer).toEqual({
      bankName: 'بنك القدس',
      bankAccount: 'PS33 QDSE 0000 1111 2222 3333 4444 5',
      bankAccountHolder: 'مطعم غصن',
    });
    expect(mapped.transfer!.walletName).toBeUndefined();
    expect(mapped.transfer!.walletNumber).toBeUndefined();
  });

  it('never mutates the rest of the restaurant mapping', () => {
    const mapped = mapRestaurantRow({ ...baseRow, transfer: TRANSFER });
    expect(mapped.id).toBe(TENANT_ID);
    expect(mapped.slug).toBe('orchid');
    expect(mapped.currency).toBe('₪');
    expect(mapped.name).toBe('مطعم الأوركيد');
  });
});

describe('api.saveBranding — transfer details are flattened to the server columns', () => {
  const stubFetch = (body: unknown = { success: true, data: { restaurant: baseRow }, statusCode: 200 }) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return calls;
  };

  it('sends the seven flat column names on PUT /manager/branding', async () => {
    const calls = stubFetch();
    const res = await api.saveBranding(TENANT_ID, { transfer: TRANSFER });
    expect(res.success).toBe(true);

    const sent = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toContain('/manager/branding');
    expect(calls[0].init.method).toBe('PUT');
    expect(sent.transferBankName).toBe(TRANSFER.bankName);
    expect(sent.transferBankAccount).toBe(TRANSFER.bankAccount);
    expect(sent.transferBankAccountHolder).toBe(TRANSFER.bankAccountHolder);
    expect(sent.transferWalletName).toBe(TRANSFER.walletName);
    expect(sent.transferWalletNumber).toBe(TRANSFER.walletNumber);
    expect(sent.transferWalletAccountHolder).toBe(TRANSFER.walletAccountHolder);
    expect(sent.transferInstructions).toBe(TRANSFER.instructions);
    // The nested object itself is NOT part of the contract (`.strict()` would 400).
    expect(sent.transfer).toBeUndefined();
  });

  it("sends '' for a cleared field so the server writes NULL", async () => {
    const calls = stubFetch();
    await api.saveBranding(TENANT_ID, {
      transfer: { bankName: '', bankAccount: '', instructions: '' },
    });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.transferBankName).toBe('');
    expect(sent.transferBankAccount).toBe('');
    expect(sent.transferInstructions).toBe('');
    // A field the caller did not mention is dropped from the JSON body entirely,
    // so the server leaves that column untouched.
    expect('transferWalletName' in sent).toBe(false);
    expect('transferWalletNumber' in sent).toBe(false);
  });

  it('changes nothing about transfer columns when the caller omits `transfer`', async () => {
    const calls = stubFetch();
    await api.saveBranding(TENANT_ID, { name: 'مطعم الأوركيد' });
    const sent = JSON.parse(String(calls[0].init.body));
    const body = String(calls[0].init.body);
    expect(sent.name).toBe('مطعم الأوركيد');
    for (const column of [
      'transferBankName',
      'transferBankAccount',
      'transferBankAccountHolder',
      'transferWalletName',
      'transferWalletNumber',
      'transferWalletAccountHolder',
      'transferInstructions',
    ]) {
      expect(column in sent).toBe(false);
      expect(body).not.toContain(column);
    }
  });

  it('maps the saved row back through the same projection (round trip)', async () => {
    stubFetch({
      success: true,
      data: { restaurant: { ...baseRow, ...{
        transferBankName: TRANSFER.bankName,
        transferBankAccount: TRANSFER.bankAccount,
        transferBankAccountHolder: TRANSFER.bankAccountHolder,
        transferWalletName: TRANSFER.walletName,
        transferWalletNumber: TRANSFER.walletNumber,
        transferWalletAccountHolder: TRANSFER.walletAccountHolder,
        transferInstructions: TRANSFER.instructions,
      } } },
      statusCode: 200,
    });
    const res = await api.saveBranding(TENANT_ID, { transfer: TRANSFER });
    expect(res.data!.restaurant.transfer).toEqual(TRANSFER);
  });
});

describe('the guest proof submission never carries transfer details', () => {
  it('POST payment-proof sends identity + channel + the receipt only', () => {
    // The API client builds the multipart body itself; assert its exact field
    // list so a future edit cannot smuggle the venue's account back to the
    // server (where nothing would validate it as money).
    const appends: string[] = [];
    const OriginalFormData = globalThis.FormData;
    class SpyFormData {
      append(name: string) {
        appends.push(name);
      }
    }
    (globalThis as any).FormData = SpyFormData;
    const OriginalXHR = (globalThis as any).XMLHttpRequest;
    (globalThis as any).XMLHttpRequest = class {
      timeout = 0;
      upload = { onprogress: null };
      onload = null;
      onerror = null;
      ontimeout = null;
      open() {}
      setRequestHeader() {}
      send() {}
    };
    try {
      void api.submitPaymentProof({
        restaurantId: TENANT_ID,
        tableId: 'table-1',
        sessionToken: 'tok',
        orderId: 'order-1',
        customerName: 'ليلى أبو أحمد',
        phone: '0599123456',
        channel: 'WALLET',
        file: new Blob(['x'], { type: 'image/png' }),
      });
    } finally {
      (globalThis as any).FormData = OriginalFormData;
      (globalThis as any).XMLHttpRequest = OriginalXHR;
    }

    expect(appends).toEqual([
      'proof',
      'restaurantId',
      'tableId',
      'sessionToken',
      'customerName',
      'customerPhone',
      'transferChannel',
    ]);
    expect(appends.join(',')).not.toContain('transferBank');
    expect(appends.join(',')).not.toContain('transferWallet');
    expect(appends.join(',')).not.toContain('transferInstructions');
  });
});
