import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('POS durable request idempotency regressions', () => {
  const schema = read('../../prisma/schema.prisma');
  const migration = read('../../prisma/migrations/20260911170000_add_order_idempotency/migration.sql');
  const validation = read('../../server/validation/schemas.ts');
  const manager = read('../../server/routes/manager.ts');
  const customer = read('../../server/routes/public.ts');
  const api = read('../services/api.ts');
  const pos = read('../components/manager/CashierPOSView.tsx');

  it('carries one validated client UUID from a logical checkout to the database row', () => {
    expect(validation).toContain("clientRequestId: z.string().uuid");
    expect(api).toContain('body: { restaurantId, tableId, items, clientRequestId, notes }');
    expect(pos).toContain('checkoutRequestRef.current?.fingerprint !== fingerprint');
    expect(pos).toContain('checkoutRequestRef.current.id');
    expect(pos).toContain('checkoutRequestRef.current = null');
    expect(manager).toContain('clientRequestId: effectiveClientRequestId');
  });

  it('scopes durable uniqueness and replay lookup to the restaurant tenant', () => {
    expect(schema).toContain('@@unique([restaurantId, clientRequestId])');
    expect(schema).toMatch(/clientRequestId\s+String\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)/);
    expect(migration).toContain('DROP INDEX IF EXISTS "Order_clientRequestId_key"');
    expect(migration).toContain('"Order_restaurantId_clientRequestId_key"');
    expect(migration).toContain('("restaurantId", "clientRequestId")');
    expect(manager).toContain('restaurantId_clientRequestId');
    expect(manager).toContain('restaurantId,\n            clientRequestId: effectiveClientRequestId');
  });

  it('returns an authoritative normal/retry result and rejects key reuse for another request', () => {
    expect(manager).toContain('const existingRequest = await findReplay()');
    expect(manager).toContain('isSameLogicalRequest(existingRequest)');
    expect(manager).toContain("res.status(409)");
    expect(manager).toContain("res.status(200).json({ success: true, data: { order: existingRequest }");
    expect(manager).toContain("res.status(201).json({ success: true, data: { order: newOrder }");
  });

  it('recovers a concurrent duplicate after the database unique violation', () => {
    const collision = manager.indexOf("code?: string })?.code !== 'P2002'");
    const recovery = manager.indexOf('const concurrentRequest = await findReplay()', collision);
    const replayReturn = manager.indexOf('if (replayed)', recovery);
    const audit = manager.indexOf('await logAuditEvent', replayReturn);
    expect(collision).toBeGreaterThan(-1);
    expect(recovery).toBeGreaterThan(collision);
    expect(replayReturn).toBeGreaterThan(recovery);
    expect(audit).toBeGreaterThan(replayReturn);
  });

  it('commits the POS order, items, and table occupancy atomically', () => {
    const transaction = manager.indexOf('prisma.$transaction(async (tx)');
    const orderCreate = manager.indexOf('await tx.order.create', transaction);
    const tableUpdate = manager.indexOf('await tx.table.update', orderCreate);
    expect(transaction).toBeGreaterThan(-1);
    expect(orderCreate).toBeGreaterThan(transaction);
    expect(tableUpdate).toBeGreaterThan(orderCreate);
  });

  it('preserves customer idempotency on the same tenant-scoped constraint', () => {
    expect(customer.match(/restaurantId_clientRequestId/g)?.length).toBeGreaterThanOrEqual(2);
    expect(customer).toContain('wasIdempotentReplay = true');
  });
});
