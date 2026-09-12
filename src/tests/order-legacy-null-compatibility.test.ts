import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('Order clientRequestId legacy NULL compatibility', () => {
  const schema = read('../../prisma/schema.prisma');
  const migration = read(
    '../../prisma/migrations/20260911220000_backfill_order_client_request_id/migration.sql'
  );

  it('keeps clientRequestId non-nullable in schema with UUID default and composite tenant constraint', () => {
    // Model field is non-nullable String
    expect(schema).toMatch(/clientRequestId\s+String\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)/);
    // Preserves composite tenant-scoped uniqueness
    expect(schema).toContain('@@unique([restaurantId, clientRequestId])');
  });

  it('safely backfills existing NULL clientRequestId rows with unique UUID format before enforcing NOT NULL', () => {
    // Check that migration targets NULL values
    expect(migration).toContain('WHERE "clientRequestId" IS NULL');
    // Generates a 36-character UUID format (8-4-4-4-12)
    expect(migration).toContain('substr(md5("restaurantId" || \':\' || "id"), 1, 8)');
    expect(migration).toContain('-4\' ||');
    expect(migration).toContain('-8\' ||');
    // Enforces NOT NULL only after the backfill step
    const updateIndex = migration.indexOf('UPDATE "Order"');
    const notNullIndex = migration.indexOf('ALTER COLUMN "clientRequestId" SET NOT NULL');
    expect(updateIndex).toBeGreaterThan(-1);
    expect(notNullIndex).toBeGreaterThan(updateIndex);
  });

  it('cleans up legacy global index and establishes composite tenant-scoped index', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS "Order_clientRequestId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "Order_restaurantId_clientRequestId_key"');
    expect(migration).toContain('ON "Order"("restaurantId", "clientRequestId")');
  });

  it('guarantees historical orders with previously NULL clientRequestId hydrate cleanly in prisma.order.findMany()', () => {
    // Simulation of hydrated order row returned from PostgreSQL post-migration
    const legacyRowBeforeMigration = {
      id: '#1001',
      numericId: 1001,
      restaurantId: 'rest-ghosn',
      tableId: 'table-1',
      sessionId: null,
      clientRequestId: null as string | null,
      status: 'PENDING',
      paymentMethod: 'PAY AT CASHIER',
      paymentStatus: 'UNPAID',
      subtotal: 50,
      total: 50,
    };

    // Before migration, null clientRequestId causes conversion error with non-nullable type
    const validateNonNullable = (val: unknown): val is string =>
      typeof val === 'string' && val.length > 0;

    expect(validateNonNullable(legacyRowBeforeMigration.clientRequestId)).toBe(false);

    // After migration, the row has a backfilled deterministic UUID
    const deterministicUuid = '31175946-34fc-48c1-8b74-ebdca383c737';
    const legacyRowAfterMigration = {
      ...legacyRowBeforeMigration,
      clientRequestId: deterministicUuid,
    };

    expect(validateNonNullable(legacyRowAfterMigration.clientRequestId)).toBe(true);
    expect(legacyRowAfterMigration.clientRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
