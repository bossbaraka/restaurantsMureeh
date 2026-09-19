import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  brandingSchema,
  paymentProofSchema,
  MAX_TRANSFER_ACCOUNT_LENGTH,
  MAX_TRANSFER_INSTRUCTIONS_LENGTH,
  MAX_TRANSFER_NAME_LENGTH,
  MAX_TRANSFER_WALLET_DIGITS,
  MIN_TRANSFER_ACCOUNT_LENGTH,
  MIN_TRANSFER_NAME_LENGTH,
  MIN_TRANSFER_WALLET_DIGITS,
  transferDetailsShape,
} from '../../server/validation/schemas';

// ============================================================================
// Customer transfer payment details — the venue's RECEIVING account.
//
// Restaurant Settings → Payment Configuration → Customer Transfer Payment →
// what the guest sees in TransferPaymentModal.
//
// Three layers, matching the repo convention:
//   1. the zod contract of the seven settings fields (bounds, characters,
//      omitted-vs-'' semantics, `.strict()` still rejecting unknown keys);
//   2. the source-level contracts a runtime test cannot reach (no entitlement
//      gate, no IBAN in the audit log, the guest proof submission unchanged,
//      the public directory never carries the details);
//   3. the REAL public router over a mocked DB: the catalog exposes exactly the
//      requested tenant's details, never another tenant's, and omits the whole
//      block when the venue configured nothing.
//
// Env is fixed BEFORE any server module loads (server/config.ts is fail-closed
// and reads env at import time). No network, no database.
// ============================================================================

const TMP_UPLOADS = mkdtempSync(path.join(os.tmpdir(), 'transfer-details-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'transfer-details-test-secret-0123456789';
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.SUPABASE_STORAGE_BUCKET = 'restaurant-assets';
delete process.env.APP_URL;

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const managerRoute = read('server/routes/manager.ts');
const publicRoute = read('server/routes/public.ts');
const validationSchemas = read('server/validation/schemas.ts');
const apiClient = read('src/services/api.ts');
const schemaPrisma = read('prisma/schema.prisma');
const migrationSql = read(
  'prisma/migrations/20260917120000_add_restaurant_transfer_details/migration.sql'
);

// ---------------------------------------------------------------------------
// Mocked DB: two tenants with DIFFERENT receiving accounts, plus one that
// configured nothing at all. Only what GET /api/public/restaurants* touches.
// ---------------------------------------------------------------------------
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const TENANT_EMPTY = '33333333-3333-4333-8333-333333333333';

const baseRow = (id: string, slug: string, phone: string) => ({
  id,
  slug,
  name: `مطعم ${slug}`,
  nameEn: slug,
  status: 'ACTIVE',
  description: '',
  phone,
  address: 'Test Street',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Jerusalem',
  businessType: 'RESTAURANT',
  primaryColor: '#111111',
  accentColor: '#222222',
  logoUrl: `restaurants/${id}/logo/logo.png`,
  coverImageUrl: null,
  mapImageUrl: null,
  galleryImages: [] as string[],
  logoFit: 'cover',
  logoPosition: '50% 50%',
  promoVideoUrl: null,
  latitude: null,
  longitude: null,
  mapUrl: null,
  categories: [],
  products: [],
  offers: [],
  tables: [],
});

const tenantA = {
  ...baseRow(TENANT_A, 'orchid', '0599111111'),
  transferBankName: 'بنك فلسطين',
  transferBankAccount: 'PS52 PALS 0453 1234 5678 9012 3456 7',
  transferBankAccountHolder: 'مطعم الأوركيد',
  transferWalletName: 'محفظة جوال',
  transferWalletNumber: '0599222222',
  transferWalletAccountHolder: 'الأوركيد للمأكولات',
  transferInstructions: 'اكتب رقم الطاولة في ملاحظة التحويل',
};

const tenantB = {
  ...baseRow(TENANT_B, 'ghosn', '0599333333'),
  transferBankName: 'بنك القدس',
  transferBankAccount: 'PS33 QDSE 0000 1111 2222 3333 4444 5',
  transferBankAccountHolder: 'مطعم غصن',
  // Wallet deliberately unconfigured: a venue may receive through one channel.
  transferWalletName: null,
  transferWalletNumber: null,
  transferWalletAccountHolder: null,
  transferInstructions: null,
};

// Configured nothing, and one column holds whitespace only.
const tenantEmpty = {
  ...baseRow(TENANT_EMPTY, 'blank', ''),
  transferBankName: null,
  transferBankAccount: '   ',
  transferBankAccountHolder: null,
  transferWalletName: null,
  transferWalletNumber: null,
  transferWalletAccountHolder: null,
  transferInstructions: null,
};

const bySlug: Record<string, unknown> = {
  orchid: tenantA,
  ghosn: tenantB,
  blank: tenantEmpty,
};

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    restaurant: {
      findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) => {
        if (where?.slug) return bySlug[where.slug] ?? null;
        return null;
      }),
      // The directory route selects a narrow projection in production; the mock
      // returns FULL rows on purpose, so the test proves the response mapping —
      // not the query — is what keeps transfer details out of the directory.
      findMany: vi.fn(async () => [tenantA, tenantB]),
    },
  },
}));

let server: http.Server | null = null;
let base = '';

beforeAll(async () => {
  const express = (await import('express')).default;
  const { default: publicRouter } = await import('../../server/routes/public');
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  rmSync(TMP_UPLOADS, { recursive: true, force: true });
});

const catalogRestaurant = async (slug: string) => {
  const res = await fetch(`${base}/api/public/restaurants/${slug}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data.restaurant as Record<string, any>;
};

// ===========================================================================
// 1. Schema: seven nullable columns on Restaurant, additive migration
// ===========================================================================
describe('transfer details — schema + migration', () => {
  const COLUMNS = [
    'transferBankName',
    'transferBankAccount',
    'transferBankAccountHolder',
    'transferWalletName',
    'transferWalletNumber',
    'transferWalletAccountHolder',
    'transferInstructions',
  ];

  it('declares exactly seven nullable columns on Restaurant (per-tenant, not per-branch)', () => {
    const restaurantModel = schemaPrisma.slice(
      schemaPrisma.indexOf('model Restaurant {'),
      schemaPrisma.indexOf('model RestaurantUser {')
    );
    for (const column of COLUMNS) {
      expect(restaurantModel).toMatch(new RegExp(`${column}\\s+String\\?`));
    }
    // Scope is the restaurant: nothing was added to Branch.
    const branchModel = schemaPrisma.slice(
      schemaPrisma.indexOf('model Branch {'),
      schemaPrisma.indexOf('model Payment {')
    );
    for (const column of COLUMNS) {
      expect(branchModel).not.toContain(column);
    }
  });

  it('ships as an additive, idempotent, data-preserving migration', () => {
    for (const column of COLUMNS) {
      expect(migrationSql).toContain(
        `ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "${column}" TEXT;`
      );
    }
    expect(migrationSql).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(migrationSql).not.toMatch(/ALTER\s+COLUMN[^;]*TYPE/i);
    expect(migrationSql).not.toMatch(/CREATE\s+TYPE/i);
    expect(migrationSql).not.toMatch(/DELETE\s+FROM/i);
    expect(migrationSql).not.toMatch(/UPDATE\s+"Restaurant"/i);
    // No NOT NULL / DEFAULT: an existing tenant keeps working untouched.
    expect(migrationSql).not.toMatch(/ADD COLUMN IF NOT EXISTS "transfer\w+" TEXT\s+NOT NULL/i);
  });
});

// ===========================================================================
// 2. Zod contract — bounds, characters, omitted vs ''
// ===========================================================================
describe('transfer details — zod contract (brandingSchema)', () => {
  it('accepts a fully configured venue and trims the values', () => {
    const parsed = brandingSchema.parse({
      transferBankName: '  بنك فلسطين  ',
      transferBankAccount: 'PS52 PALS 0453 1234 5678 9012 3456 7',
      transferBankAccountHolder: 'مطعم الأوركيد',
      transferWalletName: 'محفظة جوال',
      transferWalletNumber: '+972 599 222 222',
      transferWalletAccountHolder: 'الأوركيد للمأكولات',
      transferInstructions: '  اكتب رقم الطاولة في ملاحظة التحويل  ',
    }) as Record<string, unknown>;
    expect(parsed.transferBankName).toBe('بنك فلسطين');
    expect(parsed.transferInstructions).toBe('اكتب رقم الطاولة في ملاحظة التحويل');
    expect(parsed.transferWalletNumber).toBe('+972 599 222 222');
  });

  it('treats an omitted field as ABSENT (the route must leave the column untouched)', () => {
    const parsed = brandingSchema.parse({ name: 'مطعم' }) as Record<string, unknown>;
    for (const key of Object.keys(transferDetailsShape)) {
      expect(parsed[key]).toBeUndefined();
      expect(key in parsed).toBe(false);
    }
  });

  it("treats '' as an explicit clear (a real, empty value — not undefined)", () => {
    const parsed = brandingSchema.parse({
      transferBankName: '',
      transferBankAccount: '',
      transferWalletNumber: '',
      transferInstructions: '',
    }) as Record<string, unknown>;
    expect(parsed.transferBankName).toBe('');
    expect(parsed.transferBankAccount).toBe('');
    expect(parsed.transferWalletNumber).toBe('');
    expect(parsed.transferInstructions).toBe('');
  });

  it('refuses markup and control characters in every rendered field', () => {
    for (const field of [
      'transferBankName',
      'transferBankAccountHolder',
      'transferWalletName',
      'transferWalletAccountHolder',
    ]) {
      expect(brandingSchema.safeParse({ [field]: '<script>alert(1)</script>' }).success).toBe(false);
      expect(brandingSchema.safeParse({ [field]: 'name\twith\ttabs' }).success).toBe(false);
      expect(brandingSchema.safeParse({ [field]: 'name\nwith\nnewlines' }).success).toBe(false);
    }
    // Instructions may carry newlines (a venue writes two lines), never markup.
    expect(
      brandingSchema.safeParse({ transferInstructions: 'السطر الأول\nالسطر الثاني' }).success
    ).toBe(true);
    expect(
      brandingSchema.safeParse({ transferInstructions: '<img src=x onerror=alert(1)>' }).success
    ).toBe(false);
  });

  it('bounds the account number to bank-acceptable characters and length', () => {
    expect(
      brandingSchema.safeParse({ transferBankAccount: 'PS52PALS0453123456789012345 67' }).success
    ).toBe(true);
    // Too short / too long.
    expect(brandingSchema.safeParse({ transferBankAccount: '12345' }).success).toBe(false);
    expect(
      brandingSchema.safeParse({ transferBankAccount: 'A'.repeat(MAX_TRANSFER_ACCOUNT_LENGTH + 1) })
        .success
    ).toBe(false);
    // Punctuation and non-Latin letters no bank accepts.
    expect(brandingSchema.safeParse({ transferBankAccount: '12-345678' }).success).toBe(false);
    expect(brandingSchema.safeParse({ transferBankAccount: 'حساب 123456' }).success).toBe(false);
    expect(brandingSchema.safeParse({ transferBankAccount: '1234<script>' }).success).toBe(false);
  });

  it('accepts a wallet PHONE or a wallet ACCOUNT id — without phone normalization', () => {
    // Phone-shaped, international, and a plain account id are all valid.
    expect(brandingSchema.safeParse({ transferWalletNumber: '0599222222' }).success).toBe(true);
    expect(brandingSchema.safeParse({ transferWalletNumber: '+972599222222' }).success).toBe(true);
    expect(brandingSchema.safeParse({ transferWalletNumber: '123456789012' }).success).toBe(true);
    // Letters are refused (it is a number/identifier, not a name).
    expect(brandingSchema.safeParse({ transferWalletNumber: 'wallet123' }).success).toBe(false);
    // Bounded digit count.
    expect(
      brandingSchema.safeParse({ transferWalletNumber: '9'.repeat(MAX_TRANSFER_WALLET_DIGITS + 1) })
        .success
    ).toBe(false);
    expect(brandingSchema.safeParse({ transferWalletNumber: '12345' }).success).toBe(false);
  });

  it('enforces the published bounds and keeps brandingSchema strict', () => {
    expect(MIN_TRANSFER_NAME_LENGTH).toBe(2);
    expect(MAX_TRANSFER_NAME_LENGTH).toBe(80);
    expect(MIN_TRANSFER_ACCOUNT_LENGTH).toBe(6);
    expect(MAX_TRANSFER_ACCOUNT_LENGTH).toBe(40);
    expect(MIN_TRANSFER_WALLET_DIGITS).toBe(6);
    expect(MAX_TRANSFER_WALLET_DIGITS).toBe(32);
    expect(MAX_TRANSFER_INSTRUCTIONS_LENGTH).toBe(500);

    expect(
      brandingSchema.safeParse({ transferBankName: 'x'.repeat(MAX_TRANSFER_NAME_LENGTH + 1) }).success
    ).toBe(false);
    expect(
      brandingSchema.safeParse({ transferInstructions: 'x'.repeat(MAX_TRANSFER_INSTRUCTIONS_LENGTH + 1) })
        .success
    ).toBe(false);
    // `.strict()` still rejects unknown keys (mass-assignment guard intact)…
    expect(brandingSchema.safeParse({ transferBankName: 'بنك', notAField: 'x' }).success).toBe(false);
    // …and the seven fields are genuinely declared inside it (an undeclared
    // field would 400 the WHOLE branding save).
    expect(validationSchemas).toContain('...transferDetailsShape,');
    for (const key of Object.keys(transferDetailsShape)) {
      expect(brandingSchema.safeParse({ [key]: '' }).success).toBe(true);
    }
  });

  it('never widens the guest proof contract (payment-proof submission unchanged)', () => {
    // The guest still submits only identity + channel + the receipt image: no
    // account data travels back, so nothing client-supplied can influence
    // settlement or verification.
    expect(paymentProofSchema.safeParse({
      restaurantId: TENANT_A,
      tableId: 'table-1',
      sessionToken: 'tok',
      customerName: 'ليلى أبو أحمد',
      customerPhone: '0599123456',
      transferChannel: 'WALLET',
    }).success).toBe(true);
    expect(paymentProofSchema.safeParse({
      restaurantId: TENANT_A,
      tableId: 'table-1',
      sessionToken: 'tok',
      customerName: 'ليلى أبو أحمد',
      customerPhone: '0599123456',
      transferBankAccount: 'PS52PALS0453',
    }).success).toBe(false);

    const proofBlock = apiClient.slice(
      apiClient.indexOf('public submitPaymentProof('),
      apiClient.indexOf('public async fetchPaymentProofObjectUrl(')
    );
    const appended = [...proofBlock.matchAll(/form\.append\('([^']+)'/g)].map((m) => m[1]);
    expect(appended).toEqual([
      'proof',
      'restaurantId',
      'tableId',
      'sessionToken',
      'customerName',
      'customerPhone',
      'transferChannel',
    ]);
  });
});

// ===========================================================================
// 3. Source contracts a runtime test cannot reach
// ===========================================================================
describe('transfer details — server source contracts', () => {
  it('writes all seven columns with the omitted/\'\' convention', () => {
    for (const column of [
      'transferBankName',
      'transferBankAccount',
      'transferBankAccountHolder',
      'transferWalletName',
      'transferWalletNumber',
      'transferWalletAccountHolder',
      'transferInstructions',
    ]) {
      expect(managerRoute).toContain(`${column}: transferColumn(b.${column})`);
    }
    // '' → NULL, omitted → undefined (column untouched).
    const helper = managerRoute.slice(
      managerRoute.indexOf('const transferColumn ='),
      managerRoute.indexOf('const updated = await prisma.restaurant.update({')
    );
    expect(helper).toContain('if (value === undefined) return undefined;');
    expect(helper).toContain("if (value.trim() === '') return null;");
  });

  it('is NOT behind a paid entitlement (a venue publishes its own account on any plan)', () => {
    const gate = managerRoute.slice(
      managerRoute.indexOf('const hasCustomBrandingFields ='),
      managerRoute.indexOf('if (\n        hasCustomBrandingFields &&')
    );
    expect(gate).toContain('b.promoVideoUrl');
    expect(gate).toContain('b.galleryImages');
    expect(gate).not.toMatch(/transfer(Bank|Wallet|Instructions)/);
  });

  it('never writes an IBAN / wallet number / holder name into the audit log', () => {
    const auditBlock = managerRoute.slice(
      managerRoute.indexOf("action: 'TRANSFER_DETAILS_UPDATED'"),
      managerRoute.indexOf('Best-effort cleanup of replaced/deleted managed assets')
    );
    expect(auditBlock.length).toBeGreaterThan(0);
    // Field LABELS only — no interpolation of any submitted value. The single
    // allowed interpolation is the label list itself.
    expect(auditBlock).toContain('touchedTransferFields.join');
    expect(auditBlock).not.toMatch(/b\.transfer\w+/);
    const interpolations = [...auditBlock.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    expect(interpolations).toEqual(["touchedTransferFields.join('، ')"]);
    // The touched-field list is derived from key PRESENCE, never from values.
    const touched = managerRoute.slice(
      managerRoute.indexOf('const touchedTransferFields ='),
      managerRoute.indexOf("action: 'TRANSFER_DETAILS_UPDATED'")
    );
    expect(touched).toContain('.filter(([key]) => b[key] !== undefined)');
    expect(touched).not.toMatch(/details:/);
  });

  it('exposes the details on the guest catalog projection only', () => {
    // Catalog: present, built from this restaurant's own row.
    const catalogBlock = publicRoute.slice(
      publicRoute.indexOf('const transferDetails = {'),
      publicRoute.indexOf('categories: restaurant.categories.map')
    );
    expect(catalogBlock).toContain('transfer: hasTransferDetails ? transferDetails : undefined');
    expect(catalogBlock).toMatch(/restaurant\.transferBankName\?\.trim\(\)/);
    expect(catalogBlock).toMatch(/restaurant\.transferWalletNumber\?\.trim\(\)/);

    // Directory + QR/session payloads: never touched (partial identity only).
    const directoryBlock = publicRoute.slice(
      publicRoute.indexOf("router.get('/restaurants',"),
      publicRoute.indexOf("router.get('/restaurants/:slug'")
    );
    expect(directoryBlock).not.toMatch(/transfer(Bank|Wallet|Instructions|:)/);
    const qrBlock = publicRoute.slice(
      publicRoute.indexOf("router.get('/tables/qr/:qrToken'"),
      publicRoute.indexOf("'/tables/qr/:qrToken/session'")
    );
    expect(qrBlock).not.toMatch(/transfer(Bank|Wallet|Instructions)/);
  });
});

// ===========================================================================
// 4. Real router over a mocked DB — tenant scoping + empty fallback
// ===========================================================================
describe('GET /api/public/restaurants/:slug — transfer details (real router)', () => {
  it("returns the requested tenant's own bank AND wallet details", async () => {
    const restaurant = await catalogRestaurant('orchid');
    expect(restaurant.transfer).toEqual({
      bankName: 'بنك فلسطين',
      bankAccount: 'PS52 PALS 0453 1234 5678 9012 3456 7',
      bankAccountHolder: 'مطعم الأوركيد',
      walletName: 'محفظة جوال',
      walletNumber: '0599222222',
      walletAccountHolder: 'الأوركيد للمأكولات',
      instructions: 'اكتب رقم الطاولة في ملاحظة التحويل',
    });
  });

  it('never leaks another tenant’s account: B sees B, and none of A', async () => {
    const b = await catalogRestaurant('ghosn');
    expect(b.transfer.bankName).toBe('بنك القدس');
    expect(b.transfer.bankAccount).toBe('PS33 QDSE 0000 1111 2222 3333 4444 5');
    expect(b.transfer.bankAccountHolder).toBe('مطعم غصن');

    const serialized = JSON.stringify(b.transfer);
    for (const forbidden of [
      'بنك فلسطين',
      'PS52 PALS 0453 1234 5678 9012 3456 7',
      'مطعم الأوركيد',
      '0599222222',
      'محفظة جوال',
      'الأوركيد للمأكولات',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('omits an unconfigured channel instead of inventing values', async () => {
    const b = await catalogRestaurant('ghosn');
    // B receives by bank only: the wallet keys are absent, never '' or null.
    expect('walletName' in b.transfer).toBe(false);
    expect('walletNumber' in b.transfer).toBe(false);
    expect('walletAccountHolder' in b.transfer).toBe(false);
    expect('instructions' in b.transfer).toBe(false);
    expect(JSON.stringify(b.transfer)).not.toContain('null');
  });

  it('omits the whole transfer block when the venue configured nothing (no empty card, no "undefined")', async () => {
    const blank = await catalogRestaurant('blank');
    expect('transfer' in blank).toBe(false);
    expect(blank.transfer).toBeUndefined();
    // Whitespace-only storage is dropped, not served as a blank value.
    expect(JSON.stringify(blank)).not.toContain('transferBank');
  });

  it('keeps the rest of the guest payload intact (no regression to the catalog)', async () => {
    const restaurant = await catalogRestaurant('orchid');
    expect(restaurant.id).toBe(TENANT_A);
    expect(restaurant.slug).toBe('orchid');
    expect(restaurant.currency).toBe('₪');
    expect(restaurant.phone).toBe('0599111111');
    expect(typeof restaurant.logo).toBe('string');
  });

  it('never carries transfer details in the public restaurant DIRECTORY', async () => {
    const res = await fetch(`${base}/api/public/restaurants`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body.data.restaurants);
    // The mock returns full rows, so this proves the response mapping (not the
    // query) keeps the receiving account out of the venue directory.
    expect(serialized).not.toContain('transfer');
    expect(serialized).not.toContain('PS52 PALS');
    expect(serialized).not.toContain('بنك فلسطين');
    for (const row of body.data.restaurants as Record<string, any>[]) {
      expect(row.transfer).toBeUndefined();
      expect(row.transferBankAccount).toBeUndefined();
      expect(row.transferWalletNumber).toBeUndefined();
    }
  });

  it('is ordered by directory name after the gate + H-02 migrations (deploy order)', () => {
    const dirs = readdirSync(resolve(repoRoot, 'prisma/migrations')).sort();
    // The transfer migration must come after the payment-void migration, and
    // everything after it is a known additive migration (auth redesign +
    // counter orderSource — both verified on real PostgreSQL).
    expect(dirs.indexOf('20260915120000_staff_cancel_and_payment_void')).toBeLessThan(
      dirs.indexOf('20260917120000_add_restaurant_transfer_details')
    );
    expect(dirs.filter((d) => d > '20260917120000_add_restaurant_transfer_details')).toEqual([
      '20260919120000_employee_auth_redesign',
      '20260919120100_order_source_counter',
    ]);
  });
});
