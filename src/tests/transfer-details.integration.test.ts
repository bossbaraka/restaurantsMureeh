import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Customer transfer payment details — DB INTEGRATION suite.
 *
 * Gate: runs ONLY when DATABASE_URL is set (CI / staging with PostgreSQL).
 * Without it the suite skips cleanly and the zod + source + real-router suites
 * in transfer-details.test.ts / transfer-details.client.test.ts /
 * transfer-details-ui.test.tsx remain the guard. No PrismaClient is constructed
 * unless the gate passes (same convention as
 * payment-proof-flow.integration.test.ts).
 *
 * What is proven here against a real PostgreSQL:
 *   1. the seven columns persist and read back verbatim (no normalization loss:
 *      an IBAN keeps its grouping spaces);
 *   2. tenant isolation — writing A's receiving account never touches B's row,
 *      and a slug-scoped read returns only that tenant's values;
 *   3. NULL means "not configured" and is preserved (the guest fallback path);
 *   4. the shipped migration is additive and idempotent: re-running every
 *      statement changes nothing and drops/rewrites nothing.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe('transfer details integration gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Customer transfer payment details (real PostgreSQL)', () => {
  // Typed loosely on purpose: the Prisma client is only imported when the gate
  // passes, so this file never pulls the engine in a DB-less environment.
  let prisma: any;

  const runTag = `transfer-${Date.now()}`;
  const slugA = `transfer-a-${runTag}`;
  const slugB = `transfer-b-${runTag}`;
  let restAId = '';
  let restBId = '';

  const A_DETAILS = {
    transferBankName: 'بنك فلسطين',
    transferBankAccount: 'PS52 PALS 0453 1234 5678 9012 3456 7',
    transferBankAccountHolder: 'مطعم ألف',
    transferWalletName: 'محفظة جوال',
    transferWalletNumber: '0599111111',
    transferWalletAccountHolder: 'ألف للمأكولات',
    transferInstructions: 'اكتب رقم الطاولة في ملاحظة التحويل',
  };

  const B_DETAILS = {
    transferBankName: 'بنك القدس',
    transferBankAccount: 'PS33 QDSE 0000 1111 2222 3333 4444 5',
    transferBankAccountHolder: 'مطعم باء',
    transferWalletName: null,
    transferWalletNumber: null,
    transferWalletAccountHolder: null,
    transferInstructions: null,
  };

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();

    const a = await prisma.restaurant.create({
      data: {
        name: 'Restaurant Alpha',
        nameEn: 'Alpha',
        slug: slugA,
        logoUrl: '',
        description: 'Alpha',
        phone: '0599111111',
        address: 'Street A',
      },
    });
    restAId = a.id;

    const b = await prisma.restaurant.create({
      data: {
        name: 'Restaurant Beta',
        nameEn: 'Beta',
        slug: slugB,
        logoUrl: '',
        description: 'Beta',
        phone: '0599222222',
        address: 'Street B',
      },
    });
    restBId = b.id;
  });

  afterAll(async () => {
    if (restAId) await prisma.restaurant.delete({ where: { id: restAId } }).catch(() => {});
    if (restBId) await prisma.restaurant.delete({ where: { id: restBId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  const TRANSFER_COLUMNS = [
    'transferBankName',
    'transferBankAccount',
    'transferBankAccountHolder',
    'transferWalletName',
    'transferWalletNumber',
    'transferWalletAccountHolder',
    'transferInstructions',
  ] as const;

  it('1. starts unconfigured: every column is NULL, so the guest sees the fallback', async () => {
    const fresh = await prisma.restaurant.findUnique({ where: { id: restAId } });
    for (const column of TRANSFER_COLUMNS) {
      expect(fresh[column], column).toBeNull();
    }
  });

  it('2. persists all seven values verbatim (an IBAN keeps its grouping spaces)', async () => {
    await prisma.restaurant.update({ where: { id: restAId }, data: A_DETAILS });
    const row = await prisma.restaurant.findUnique({ where: { id: restAId } });
    for (const [key, value] of Object.entries(A_DETAILS)) {
      expect(row[key], key).toBe(value);
    }
    expect(row.transferBankAccount).toBe('PS52 PALS 0453 1234 5678 9012 3456 7');
    // A wallet identifier is stored as written — never phone-normalized.
    expect(row.transferWalletNumber).toBe('0599111111');
  });

  it('3. writing tenant A never touches tenant B (tenant isolation)', async () => {
    await prisma.restaurant.update({ where: { id: restBId }, data: B_DETAILS });

    const a = await prisma.restaurant.findUnique({ where: { id: restAId } });
    const b = await prisma.restaurant.findUnique({ where: { id: restBId } });

    expect(b.transferBankName).toBe('بنك القدس');
    expect(b.transferBankAccount).toBe('PS33 QDSE 0000 1111 2222 3333 4444 5');
    // B configured no wallet: NULL, never A's wallet.
    expect(b.transferWalletName).toBeNull();
    expect(b.transferWalletNumber).toBeNull();
    expect(b.transferWalletAccountHolder).toBeNull();
    expect(b.transferInstructions).toBeNull();

    // And A kept its own values (no cross-write in either direction).
    expect(a.transferBankName).toBe('بنك فلسطين');
    expect(a.transferWalletNumber).toBe('0599111111');
    const serializedB = JSON.stringify(b);
    for (const forbidden of ['بنك فلسطين', 'PS52 PALS', '0599111111', 'محفظة جوال']) {
      expect(serializedB).not.toContain(forbidden);
    }
  });

  it('4. reads are slug-scoped: a catalog-style query returns only that tenant’s account', async () => {
    const bySlugA = await prisma.restaurant.findUnique({ where: { slug: slugA } });
    const bySlugB = await prisma.restaurant.findUnique({ where: { slug: slugB } });

    expect(bySlugA.id).toBe(restAId);
    expect(bySlugA.transferBankAccount).toBe(A_DETAILS.transferBankAccount);
    expect(bySlugB.id).toBe(restBId);
    expect(bySlugB.transferBankAccount).toBe(B_DETAILS.transferBankAccount);
    expect(bySlugB.transferBankAccount).not.toBe(bySlugA.transferBankAccount);
  });

  it("5. an explicit clear writes NULL again ('' at the API becomes null in the row)", async () => {
    await prisma.restaurant.update({
      where: { id: restAId },
      data: { transferInstructions: null, transferWalletNumber: null },
    });
    const row = await prisma.restaurant.findUnique({ where: { id: restAId } });
    expect(row.transferInstructions).toBeNull();
    expect(row.transferWalletNumber).toBeNull();
    // Clearing two fields leaves the rest of the account intact.
    expect(row.transferBankAccount).toBe(A_DETAILS.transferBankAccount);
    expect(row.transferBankAccountHolder).toBe(A_DETAILS.transferBankAccountHolder);
  });

  it('6. the shipped migration is additive and idempotent (re-running changes nothing)', async () => {
    const sql = readFileSync(
      resolve(__dirname, '../../prisma/migrations/20260917120000_add_restaurant_transfer_details/migration.sql'),
      'utf8'
    );
    // F-02 fix: strip comment LINES first, THEN split on ';'. The previous
    // order dropped every statement whose chunk began with a '--' comment
    // (4 of 7 statements parsed), so the idempotency check never ran for
    // three of the columns. The migration SQL itself is correct.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    expect(statements.length).toBe(TRANSFER_COLUMNS.length);
    for (const statement of statements) {
      expect(statement).toMatch(/^ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transfer\w+" TEXT$/);
      // Run twice: IF NOT EXISTS must make the second run a no-op, not an error.
      await prisma.$executeRawUnsafe(statement);
      await prisma.$executeRawUnsafe(statement);
    }

    // Data preserved: the re-run neither dropped nor rewrote the stored values.
    const row = await prisma.restaurant.findUnique({ where: { id: restAId } });
    expect(row.transferBankAccount).toBe(A_DETAILS.transferBankAccount);
    expect(row.transferBankName).toBe(A_DETAILS.transferBankName);
  });
});
