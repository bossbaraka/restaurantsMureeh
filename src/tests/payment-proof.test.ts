import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_PHONE_DIGITS,
  MAX_PHONE_INPUT_LENGTH,
  MIN_PHONE_DIGITS,
  isValidNormalizedPhone,
  normalizeCustomerPhone,
} from '../../server/utils/phone';
import {
  MAX_CUSTOMER_NAME_LENGTH,
  paymentConfirmSchema,
  paymentProofSchema,
  paymentRejectSchema,
  TRANSFER_CHANNELS,
} from '../../server/validation/schemas';
// Drivers/helpers are imported from their concrete modules (never the barrel):
// the barrel pulls server/config.ts, which is only importable after the test
// environment below is in place.
import { LocalStorageDriver } from '../../server/services/storage/local';
import { SupabaseStorageDriver } from '../../server/services/storage/supabase';
import {
  PAYMENT_PROOF_KEY_PREFIX,
  buildPaymentProofKey,
  paymentProofKeyBelongsToRestaurant,
} from '../../server/services/storage/helpers';
import { MAX_IMAGE_BYTES } from '../../server/services/storage/imageSniff';

// ---------------------------------------------------------------------------
// Test environment: a throwaway private directory, local driver, no network.
// Set BEFORE any module that reads server/config.ts is imported.
// ---------------------------------------------------------------------------
const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'mureeh-proof-uploads-'));
const TMP_PRIVATE = fs.mkdtempSync(path.join(os.tmpdir(), 'mureeh-proof-private-'));

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'payment-proof-test-secret-0123456789';
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.PRIVATE_UPLOAD_DIR = TMP_PRIVATE;
process.env.RETENTION_ENABLED = 'false';

/**
 * Loads the receipt service lazily: it imports storage through the barrel,
 * which evaluates server/config.ts on first import (hence the env block above).
 */
async function loadProofService(): Promise<typeof import('../../server/services/paymentProofs')> {
  return import('../../server/services/paymentProofs');
}

/**
 * Transfer payment proof — unit + contract tests.
 *
 * Covers the pure logic (phone normalization, zod contracts, private key
 * layout, private driver behaviour) and the source-level contracts a runtime
 * test cannot reach without a database/HTTP server: the guest route never
 * echoes a storage path, the cashier queue is the only phone surface, the
 * read route streams private bytes with no-store headers, confirm is an atomic
 * conditional claim, and reject discards the receipt.
 *
 * The DB-backed end-to-end path lives in payment-proof-flow.integration.test.ts
 * (skipped unless DATABASE_URL is set).
 */

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const publicTs = read('server/routes/public.ts');
const managerTs = read('server/routes/manager.ts');
const schemaPrisma = read('prisma/schema.prisma');
const migrationSql = read(
  'prisma/migrations/20260914120000_add_payment_proof_and_archive/migration.sql'
);
const identityMigrationSql = read(
  'prisma/migrations/20260914160000_add_transfer_customer_identity/migration.sql'
);

// A minimal 1×1 PNG and a JPEG header — real magic bytes, no image decoder.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const NOT_AN_IMAGE = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

describe('customer phone — optional, normalized, never a credential', () => {
  it('accepts the shapes people actually type and canonicalizes them', () => {
    expect(normalizeCustomerPhone('0599123456')).toBe('0599123456');
    expect(normalizeCustomerPhone(' 059-912-3456 ')).toBe('0599123456');
    expect(normalizeCustomerPhone('+972 59 912 3456')).toBe('+972599123456');
    expect(normalizeCustomerPhone('(059) 912.3456')).toBe('0599123456');
  });

  it('maps empty input to "no phone given" (the transfer form requires it)', () => {
    expect(normalizeCustomerPhone(undefined)).toBeNull();
    expect(normalizeCustomerPhone(null)).toBeNull();
    expect(normalizeCustomerPhone('')).toBeNull();
    expect(normalizeCustomerPhone('   ')).toBeNull();
  });

  it('rejects garbage instead of silently stripping it', () => {
    expect(normalizeCustomerPhone('call me maybe')).toBeNull();
    expect(normalizeCustomerPhone('0599123456<script>')).toBeNull();
    expect(normalizeCustomerPhone("0599123456' OR 1=1 --")).toBeNull();
    expect(normalizeCustomerPhone('05991\n23456')).toBeNull();
    expect(normalizeCustomerPhone({ phone: '0599123456' })).toBeNull();
    expect(normalizeCustomerPhone('12345')).toBeNull(); // too short to reach anyone
    expect(normalizeCustomerPhone('1'.repeat(MAX_PHONE_DIGITS + 1))).toBeNull();
  });

  it('caps the raw input length before any parsing work', () => {
    const oversized = `+${'9'.repeat(MAX_PHONE_INPUT_LENGTH)}`;
    expect(oversized.length).toBeGreaterThan(MAX_PHONE_INPUT_LENGTH);
    expect(normalizeCustomerPhone(oversized)).toBeNull();
  });

  it('recognizes its own canonical output (used by the persistence path)', () => {
    const canonical = normalizeCustomerPhone('+972 59-912-3456')!;
    expect(isValidNormalizedPhone(canonical)).toBe(true);
    expect(isValidNormalizedPhone('0599123456')).toBe(true);
    expect(isValidNormalizedPhone(`+${'1'.repeat(MIN_PHONE_DIGITS - 1)}`)).toBe(false);
    expect(isValidNormalizedPhone('not a phone')).toBe(false);
    expect(isValidNormalizedPhone('')).toBe(false);
  });
});

describe('request contracts (zod)', () => {
  const validBody = {
    restaurantId: 'rest-1',
    tableId: 'table-1',
    sessionToken: 'session-token',
    customerName: 'أحمد سالم',
    customerPhone: '0599123456',
  };

  it('requires the guest name and mobile number on a transfer notice', () => {
    // Without an attributable person the cashier cannot verify anything.
    expect(paymentProofSchema.safeParse({ ...validBody, customerName: undefined }).success).toBe(false);
    expect(paymentProofSchema.safeParse({ ...validBody, customerPhone: undefined }).success).toBe(false);
    expect(paymentProofSchema.safeParse(validBody).success).toBe(true);
  });

  it('bounds the name and refuses control characters / markup', () => {
    expect(paymentProofSchema.safeParse({ ...validBody, customerName: 'أ' }).success).toBe(false);
    expect(
      paymentProofSchema.safeParse({ ...validBody, customerName: 'x'.repeat(MAX_CUSTOMER_NAME_LENGTH + 1) })
        .success
    ).toBe(false);
    expect(paymentProofSchema.safeParse({ ...validBody, customerName: '<script>alert(1)</script>' }).success).toBe(
      false
    );
    expect(paymentProofSchema.safeParse({ ...validBody, customerName: 'أحمد\nسالم' }).success).toBe(false);
  });

  it('accepts a valid phone and rejects an invalid one', () => {
    expect(paymentProofSchema.safeParse(validBody).success).toBe(true);
    expect(paymentProofSchema.safeParse({ ...validBody, customerPhone: 'not-a-phone' }).success).toBe(false);
    expect(paymentProofSchema.safeParse({ ...validBody, customerPhone: '' }).success).toBe(false);
  });

  it('defaults the transfer channel to BANK and refuses unknown channels', () => {
    expect(TRANSFER_CHANNELS).toEqual(['BANK', 'WALLET']);
    const parsed = paymentProofSchema.safeParse(validBody);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.transferChannel).toBe('BANK');
    expect(paymentProofSchema.safeParse({ ...validBody, transferChannel: 'WALLET' }).success).toBe(true);
    expect(paymentProofSchema.safeParse({ ...validBody, transferChannel: 'CRYPTO' }).success).toBe(false);
  });

  it('rejects unknown fields on the money-adjacent endpoints', () => {
    // A client must never be able to smuggle an amount / tenant / status into
    // these requests: the schemas are strict.
    expect(paymentConfirmSchema.safeParse({}).success).toBe(true);
    expect(paymentConfirmSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(paymentConfirmSchema.safeParse({ status: 'PAID' }).success).toBe(false);
    expect(paymentRejectSchema.safeParse({ reason: 'إشعار غير واضح' }).success).toBe(true);
    expect(paymentRejectSchema.safeParse({ paymentStatus: 'UNPAID' }).success).toBe(false);
  });
});

describe('private receipt namespace — key layout and isolation', () => {
  it('scopes the key to the tenant AND the order', () => {
    const key = buildPaymentProofKey({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      ext: '.jpg',
    });
    expect(key.startsWith(`${PAYMENT_PROOF_KEY_PREFIX}restaurant/rest-A/order/order-1/`)).toBe(true);
    expect(paymentProofKeyBelongsToRestaurant(key, 'rest-A')).toBe(true);
    expect(paymentProofKeyBelongsToRestaurant(key, 'rest-B')).toBe(false);
    expect(paymentProofKeyBelongsToRestaurant(key, null)).toBe(false);
  });

  it('cannot be confused with a public asset key', () => {
    const key = buildPaymentProofKey({ restaurantId: 'rest-A', orderId: 'o', ext: '.png' });
    expect(key.startsWith('restaurants/')).toBe(false);
    expect(key.startsWith(PAYMENT_PROOF_KEY_PREFIX)).toBe(true);
  });

  it('rejects traversal / cross-tenant keys structurally', () => {
    expect(paymentProofKeyBelongsToRestaurant('../../etc/passwd', 'rest-A')).toBe(false);
    expect(paymentProofKeyBelongsToRestaurant('payment-proofs/restaurant/rest-A/../rest-B/x.png', 'rest-A')).toBe(false);
    expect(
      paymentProofKeyBelongsToRestaurant(
        'payment-proofs/restaurant/rest-A-but-longer/order/o/x.png',
        'rest-A'
      )
    ).toBe(false);
    // A tenant id is sanitized exactly like the folder it is written into.
    const key = buildPaymentProofKey({ restaurantId: 'rest/../../B', orderId: 'o', ext: '.png' });
    expect(key).toContain('/restaurant/restB/order/');
    expect(paymentProofKeyBelongsToRestaurant(key, 'restA')).toBe(false);
  });
});

describe('LocalStorageDriver — private directory is never publicly served', () => {
  const temps: string[] = [];
  const makeDriver = () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mureeh-private-'));
    temps.push(base);
    const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mureeh-private-store-'));
    temps.push(privateDir);
    return { driver: new LocalStorageDriver({ baseDir: base, privateBaseDir: privateDir }), privateDir, base };
  };

  afterEach(() => {
    while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true });
  });

  it('writes receipts outside the public /uploads directory', async () => {
    const { driver, privateDir, base } = makeDriver();
    const stored = await driver.uploadPrivate({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: PNG,
      mimeType: 'image/png',
      ext: '.png',
      size: PNG.length,
    });

    const expected = path.join(privateDir, stored.key);
    expect(fs.existsSync(expected)).toBe(true);
    // Nothing was written under the served base directory.
    expect(fs.existsSync(path.join(base, stored.key))).toBe(false);
    expect(stored.key.startsWith('payment-proofs/')).toBe(true);
  });

  it('round-trips bytes and is idempotent on delete', async () => {
    const { driver } = makeDriver();
    const stored = await driver.uploadPrivate({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: PNG,
      mimeType: 'image/png',
      ext: '.png',
      size: PNG.length,
    });

    const read = await driver.readPrivate(stored.key);
    expect(read?.body.equals(PNG)).toBe(true);

    await driver.deletePrivate(stored.key);
    expect(await driver.readPrivate(stored.key)).toBeNull();
    await driver.deletePrivate(stored.key); // second delete is a no-op
    expect(await driver.readPrivate(stored.key)).toBeNull();
  });

  it('refuses traversal keys on read and delete', async () => {
    const { driver } = makeDriver();
    await expect(driver.readPrivate('../../etc/passwd')).rejects.toThrow();
    await expect(driver.deletePrivate('/etc/passwd')).rejects.toThrow();
  });

  it('reports readiness without throwing', async () => {
    const { driver } = makeDriver();
    expect(await driver.ensureReady()).toEqual({ ok: true });
  });
});

describe('SupabaseStorageDriver — private bucket contract', () => {
  function fakeAdapter() {
    const uploaded: Array<{ key: string; contentType: string }> = [];
    const removed: string[] = [];
    const buckets: string[] = [];
    let body: Buffer | null = PNG;
    return {
      uploaded,
      removed,
      buckets,
      setBody(next: Buffer | null) {
        body = next;
      },
      adapter: {
        async upload(key: string, _data: Buffer, contentType: string) {
          uploaded.push({ key, contentType });
        },
        async remove(keys: string[]) {
          removed.push(...keys);
        },
        getPublicUrl(key: string) {
          // Deliberately returns a PUBLIC-looking URL: the private driver must
          // never hand this value to a caller.
          return `https://proj.supabase.co/storage/v1/object/public/bucket/${key}`;
        },
        async listNames() {
          return [];
        },
        async download() {
          return body ? { body, contentType: 'image/png' } : null;
        },
        async ensureBucket(name: string) {
          buckets.push(name);
        },
      },
    };
  }

  it('stores receipts in its own private bucket, not the public one', async () => {
    const fake = fakeAdapter();
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'k', bucket: 'restaurant-assets' },
      fake.adapter,
      'restaurant-assets-private',
      fake.adapter
    );
    const stored = await driver.uploadPrivate({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: PNG,
      mimeType: 'image/png',
      ext: '.png',
      size: PNG.length,
    });

    expect(driver.destination).toBe('restaurant-assets-private');
    expect(fake.uploaded).toHaveLength(1);
    expect(fake.uploaded[0].key).toBe(stored.key);
    expect(fake.uploaded[0].contentType).toBe('image/png');
    // No public URL is produced for a private object.
    expect(JSON.stringify(stored)).not.toContain('supabase.co');
    expect(JSON.stringify(stored)).not.toContain('/object/public/');
  });

  it('normalizes downloads to a Buffer and reports missing objects as null', async () => {
    const fake = fakeAdapter();
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'k', bucket: 'b' },
      fake.adapter,
      'b-private',
      fake.adapter
    );
    const stored = await driver.uploadPrivate({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: PNG,
      mimeType: 'image/png',
      ext: '.png',
      size: PNG.length,
    });

    const read = await driver.readPrivate(stored.key);
    expect(Buffer.isBuffer(read?.body)).toBe(true);
    expect(read?.body.equals(PNG)).toBe(true);

    fake.setBody(null);
    expect(await driver.readPrivate(stored.key)).toBeNull();
  });

  it('creates the private bucket idempotently at readiness check', async () => {
    const fake = fakeAdapter();
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'k', bucket: 'b' },
      fake.adapter,
      undefined, // default private bucket name
      fake.adapter
    );
    expect(await driver.ensureReady()).toEqual({ ok: true });
    expect(fake.buckets).toEqual(['b-private']);
  });

  it('propagates storage failures so callers can fail safely', async () => {
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'k', bucket: 'b' },
      fakeAdapter().adapter,
      'b-private',
      {
        async upload() {
          throw new Error('network down');
        },
        async remove() {
          throw new Error('delete rejected');
        },
        getPublicUrl: () => '',
        listNames: async () => [],
        download: async () => null,
        ensureBucket: async () => {},
      }
    );
    await expect(
      driver.uploadPrivate({
        restaurantId: 'rest-A',
        orderId: 'o',
        buffer: PNG,
        mimeType: 'image/png',
        ext: '.png',
        size: PNG.length,
      })
    ).rejects.toThrow('network down');
    await expect(driver.deletePrivate('payment-proofs/restaurant/rest-A/order/o/x.png')).rejects.toThrow(
      'delete rejected'
    );
  });
});

describe('storePaymentProof — validation reuses the existing pipeline', () => {
  it('rejects a non-image by magic bytes (client MIME/extension never trusted)', async () => {
    const { storePaymentProof } = await loadProofService();
    const result = await storePaymentProof({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: NOT_AN_IMAGE,
      size: NOT_AN_IMAGE.length,
    });
    expect(result).toEqual({ ok: false, reason: 'not_an_image' });
  });

  it('rejects an oversized payload before touching storage', async () => {
    const { MAX_PAYMENT_PROOF_BYTES, storePaymentProof } = await loadProofService();
    const result = await storePaymentProof({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: PNG,
      size: MAX_PAYMENT_PROOF_BYTES + 1,
    });
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('shares the platform image cap instead of inventing a second one', async () => {
    const { MAX_PAYMENT_PROOF_BYTES } = await loadProofService();
    expect(MAX_PAYMENT_PROOF_BYTES).toBe(MAX_IMAGE_BYTES);
    expect(MAX_PAYMENT_PROOF_BYTES).toBe(5 * 1024 * 1024);
  });

  it('accepts a real image (png magic bytes) without any DB or client metadata', async () => {
    const { storePaymentProof } = await loadProofService();
    const result = await storePaymentProof({
      restaurantId: 'rest-A',
      orderId: 'order-1',
      buffer: PNG,
      size: PNG.length,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.key.startsWith(PAYMENT_PROOF_KEY_PREFIX)).toBe(true);
      expect(paymentProofKeyBelongsToRestaurant(result.key, 'rest-A')).toBe(true);
    }
  });
});

describe('guest route contract (POST /api/public/orders/:orderId/payment-proof)', () => {
  const route = publicTs.slice(
    publicTs.indexOf("'/orders/:orderId/payment-proof'"),
    publicTs.indexOf('// POST /api/public/waiter-requests')
  );

  it('is rate limited and parses the multipart field "proof" with a hard size cap', () => {
    expect(route).toContain('paymentProofLimiter');
    expect(route).toContain("proofUpload.single('proof')");
    // multer refuses oversized payloads before the handler runs (hard cap on
    // bytes and on the number of parts), then the service re-checks.
    const multerConfig = publicTs.slice(
      publicTs.indexOf('const proofUpload = multer({'),
      publicTs.indexOf('const proofUpload = multer({') + 500
    );
    expect(multerConfig).toContain('multer.memoryStorage()');
    expect(multerConfig).toContain('fileSize: MAX_PAYMENT_PROOF_BYTES');
    expect(multerConfig).toContain('files: 1');
    expect(multerConfig).toContain('fields: 10');
    // A non-image part is refused even before magic-byte sniffing.
    expect(multerConfig).toContain("file.mimetype.startsWith('image/')");
  });

  it('never trusts client tenant hints: the order row is the source of truth', () => {
    expect(route).toContain('order.restaurantId !== restaurantId');
    expect(route).toContain('order.tableId !== tableId');
    expect(route).toContain('getQrSession(sessionToken, order.restaurantId, order.tableId)');
    expect(route).toContain('order.sessionId !== session.id');
  });

  it('refuses cancelled/paid orders and cannot be used to set PAID', () => {
    expect(route).toContain("order.status === 'CANCELLED'");
    expect(route).toContain('PAYMENT_STATUS.PAID');
    // The guest flow can only ever reach PENDING_VERIFICATION.
    expect(route).toContain('paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION');
    expect(route).not.toContain("data: { paymentStatus: 'PAID'");
  });

  it('rolls back the stored object when the conditional claim loses the race', () => {
    expect(route).toContain('if (claimed.count !== 1)');
    expect(route).toContain('await discardPaymentProof(stored.key)');
    expect(route).toContain('await discardPaymentProof(uploadedKey)');
  });

  it('never responds with the storage path or an internal identifier', () => {
    const response = route.slice(route.indexOf('return res.status(201).json({'));
    expect(response).toContain('customerPaymentProofView(updated)');
    // The success payload is the guest view only: no storage key, no phone,
    // no tenant/branch/cashier identifiers.
    expect(response).not.toMatch(/paymentProofPath/);
    expect(response).not.toMatch(/customerPhone/);
    expect(response).not.toMatch(/restaurantId/);
    expect(response).not.toMatch(/cashierId/);
  });

  it('audits the submission and notifies staff over the existing SSE channel', () => {
    expect(route).toContain("action: 'PAYMENT_PROOF_SUBMITTED'");
    expect(route).toContain("'PAYMENT_PROOF_SUBMITTED'");
    expect(route).toContain('realtimeService.broadcastToTable');
  });

  it('reports a statusCode that agrees with the HTTP status', () => {
    expect(route).toContain('const failureStatus = stored.reason === \'storage_unavailable\' ? 503 : 400');
    expect(route).toContain('statusCode: failureStatus');
  });
});

describe('cashier routes contract', () => {
  const queue = managerTs.slice(
    managerTs.indexOf("router.get('/payment-verifications'"),
    managerTs.indexOf("// GET /api/manager/orders/:orderId/payment-proof")
  );
  const proofRead = managerTs.slice(
    managerTs.indexOf("'/orders/:orderId/payment-proof'"),
    managerTs.indexOf("// POST /api/manager/orders/:orderId/payment/confirm")
  );
  const confirm = managerTs.slice(
    managerTs.indexOf("'/orders/:orderId/payment/confirm'"),
    managerTs.indexOf("// POST /api/manager/orders/:orderId/payment/reject")
  );
  const reject = managerTs.slice(
    managerTs.indexOf("'/orders/:orderId/payment/reject'"),
    managerTs.indexOf('export default router')
  );

  it('exposes the verification queue only to cashier/manager, tenant-scoped', () => {
    expect(queue).toContain("requireCashierOrManager()");
    expect(queue).toContain('restaurantId');
    expect(queue).toContain('ownTenant(req, restaurantId)');
    expect(queue).toContain('paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION');
    expect(queue).toContain('take: Math.min(take, 100)');
  });

  it('carries the guest identity and the order items the cashier must verify', () => {
    // Name + phone + channel + every item line travel in ONE response, so the
    // cashier never leaves the card to check what the transfer is paying for.
    expect(queue).toContain('customerName: o.customerName');
    expect(queue).toContain('transferChannel: o.transferChannel');
    expect(queue).toContain('orderStatus: o.status');
    expect(queue).toContain('items: o.items.map');
    expect(queue).toContain('productName: i.productNameSnapshot');
  });

  it('is the only endpoint that returns the guest phone', () => {
    expect(queue).toContain('customerPhone: o.customerPhone');
    // Exactly one line in the whole router exposes the phone.
    expect(managerTs.match(/customerPhone: o\.customerPhone/g)).toHaveLength(1);
    expect(managerTs.split('\n').filter((line) => line.includes('customerPhone'))).toHaveLength(1);
    // The generic orders list (the one every manager screen loads) is PII-free.
    const ordersListStart = managerTs.indexOf('// GET /api/manager/orders —');
    const ordersList = managerTs.slice(
      ordersListStart,
      managerTs.indexOf('router.', ordersListStart + 10)
    );
    expect(ordersList).not.toContain('customerPhone');
  });

  it('streams the private receipt with no-store headers after two isolation checks', () => {
    expect(proofRead).toContain('requireCashierOrManager()');
    expect(proofRead).toContain('paymentProofReadLimiter');
    expect(proofRead).toContain('resolveTenantOrder(req, String(req.params.orderId))');
    expect(proofRead).toContain('proofBelongsToTenant(order.paymentProofPath, order.restaurantId)');
    expect(proofRead).toContain("'PAYMENT_PROOF_ACCESS_DENIED'");
    expect(proofRead).toContain("'Cache-Control', 'private, no-store'");
    expect(proofRead).toContain("'X-Content-Type-Options', 'nosniff'");
    expect(proofRead).toContain('loadPaymentProof(order.paymentProofPath)');
  });

  it('confirms inside ONE atomic conditional claim (no double processing)', () => {
    expect(confirm).toContain('prisma.$transaction');
    expect(confirm).toContain('tx.order.updateMany');
    expect(confirm).toContain('paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION');
    expect(confirm).toContain("throw Object.assign(new Error('VERIFY_RACE')");
    expect(confirm).toContain('settledAt: now');
    expect(confirm).toContain('cashierId: req.user!.id');
    expect(confirm).toContain('paymentStatus: \'PAID\'');
    expect(confirm).toContain('paymentMethod: TRANSFER_PAYMENT_METHOD');
    expect(confirm).toContain('tx.payment.create');
    expect(confirm).toContain('generateNextReceiptNumber(restaurantId, now, attempt)');
    expect(confirm).toContain("action: 'PAYMENT_VERIFIED'");
    expect(confirm).toContain("'PAYMENT_RECORDED'");
    expect(confirm).toContain("'PAYMENT_PROOF_VERIFIED'");
  });

  it('releases the order to the kitchen instead of skipping it to SERVED', () => {
    // The old behaviour marked the order SERVED, which removed it from the KDS
    // before anything was cooked. Confirming now settles the money and leaves
    // the kitchen status alone: a still-PENDING order appears on the KDS as a
    // fresh "ready to start" ticket.
    const claimData = confirm.slice(
      confirm.indexOf('tx.order.updateMany'),
      confirm.indexOf('if (claimed.count !== 1)')
    );
    expect(claimData).not.toContain("status: 'SERVED'");
    expect(claimData).toContain("paymentStatus: 'PAID'");
    expect(confirm).toContain('const releasedStatus = order.status;');
    expect(confirm).toContain("const kitchenReleased = releasedStatus === 'PENDING';");
    // The KDS learns about the release on the existing status event.
    expect(confirm).toContain("'ORDER_STATUS_UPDATED'");
    expect(confirm).toContain('kitchenReleased,');
    expect(confirm).toContain('orderStatus: releasedStatus');
  });

  it('derives every trusted value server-side (never from the request body)', () => {
    expect(confirm).toContain('total: order.total');
    expect(confirm).toContain('subtotal: order.subtotal');
    expect(confirm).toContain('branchId: order.table?.branchId || order.branchId');
    // The only body field is a free-text note.
    expect(confirm).toContain('const { note } = req.body as { note?: string };');
    expect(reject).toContain('const { reason } = req.body as { reason?: string };');
  });

  it('rejects by returning to UNPAID and discarding the receipt first', () => {
    expect(reject).toContain('PAYMENT_STATUS.UNPAID');
    expect(reject).toContain('paymentRejectedAt: now');
    expect(reject).toContain('paymentRejectionReason: reason');
    expect(reject).toContain('await discardPaymentProof(order.paymentProofPath)');
    // Pointer kept when the object could not be removed (retention retries it).
    expect(reject).toContain('...(proofDeleted ? { paymentProofPath: null } : {})');
    expect(reject).toContain("action: 'PAYMENT_REJECTED'");
    expect(reject).toContain("'PAYMENT_PROOF_REJECTED'");
  });

  it('blocks the generic settle path while a receipt awaits verification', () => {
    expect(managerTs).toContain('PAYMENT_STATUS.PENDING_VERIFICATION');
    expect(managerTs).toContain('pendingVerification');
  });
});

describe('database schema + migration (additive, non-destructive)', () => {
  it('adds the temporary + archive columns to Order', () => {
    const order = schemaPrisma.slice(
      schemaPrisma.indexOf('model Order '),
      schemaPrisma.indexOf('model OrderItem')
    );
    for (const column of [
      'customerName',
      'customerPhone',
      'transferChannel',
      'paymentProofPath',
      'paymentRejectedAt',
      'paymentRejectionReason',
      'archivedAt',
      'retentionPurgedAt',
    ]) {
      expect(order).toContain(column);
    }
    // No new payment-status enum and no duplicate proof table.
    expect(schemaPrisma).not.toContain('model PaymentProof');
    expect(schemaPrisma).not.toContain('model ArchiveOrder');
  });

  it('migration is idempotent and never deletes data', () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
    expect(migrationSql).not.toMatch(/DROP COLUMN/i);
    expect(migrationSql).not.toMatch(/DELETE FROM/i);
    expect(migrationSql).not.toMatch(/TRUNCATE/i);
  });

  it('adds the guest identity columns in their own additive migration', () => {
    expect(identityMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "customerName" TEXT');
    expect(identityMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "transferChannel" TEXT');
    // Purely additive: no column/enum/table is dropped or rewritten.
    expect(identityMigrationSql).not.toMatch(/DROP TABLE/i);
    expect(identityMigrationSql).not.toMatch(/DROP COLUMN/i);
    expect(identityMigrationSql).not.toMatch(/DELETE FROM/i);
    expect(identityMigrationSql).not.toMatch(/TRUNCATE/i);
    expect(identityMigrationSql).not.toMatch(/ALTER COLUMN/i);
  });

  it('purges the guest name with the other temporary operational data', () => {
    const retentionTs = read('server/services/retention.ts');
    const policyTs = read('server/services/retentionPolicy.ts');
    expect(retentionTs).toContain('customerName: null');
    expect(retentionTs).toContain('{ customerName: { not: null } }');
    expect(policyTs).toContain('order.customerName || order.customerPhone');
  });

  it('indexes the two real query patterns without indexing PII', () => {
    // 1. cashier verification queue + 2. the retention sweep.
    expect(migrationSql).toContain('"Order_restaurantId_paymentStatus_idx"');
    expect(migrationSql).toContain('"Order_archivedAt_idx"');
    expect(schemaPrisma).toContain('@@index([restaurantId, paymentStatus])');
    expect(schemaPrisma).toContain('@@index([archivedAt])');
    expect(migrationSql).not.toMatch(/CREATE INDEX[^;]*customerPhone/i);
    expect(migrationSql).not.toMatch(/CREATE INDEX[^;]*paymentProofPath/i);
  });
});
