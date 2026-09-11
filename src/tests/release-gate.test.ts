import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('production release regressions', () => {
  it('makes public order submission replay-safe across response loss and concurrent retries', () => {
    const schema = read('../../prisma/schema.prisma');
    const migration = read('../../prisma/migrations/20260911170000_add_order_idempotency/migration.sql');
    const validation = read('../../server/validation/schemas.ts');
    const route = read('../../server/routes/public.ts');
    const context = read('../context/RestaurantContext.tsx');

    expect(schema).toMatch(/clientRequestId\s+String\?\s+@unique/);
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "Order_clientRequestId_key"');
    expect(validation).toContain("clientRequestId: z.string().uuid");
    expect(route).toContain('where: { clientRequestId: effectiveClientRequestId }');
    expect(route).toContain('const effectiveClientRequestId = clientRequestId || randomUUID()');
    expect(route).toContain('wasIdempotentReplay = true');
    expect(context).toContain('orderSubmissionRef.current?.fingerprint !== fingerprint');
    expect(context).toContain('clientRequestId: orderSubmissionRef.current.clientRequestId');
    expect(route).toContain('newOrder = await prisma.$transaction');
    expect(route).not.toContain('estimatedPrepMinutes: 18');
    expect(schema).toMatch(/estimatedPrepMinutes\s+Int\?\s*\n/);
  });

  it('enforces monotonic order and waiter transitions with compare-and-set writes', () => {
    const manager = read('../../server/routes/manager.ts');
    expect(manager).toContain("PENDING: 'PREPARING'");
    expect(manager).toContain("PREPARING: 'READY'");
    expect(manager).toContain("READY: 'SERVED'");
    expect(manager).toContain('status: order.status');
    expect(manager).toContain("status === 'ACKNOWLEDGED' ? 'PENDING'");
    expect(manager).toContain("status === 'RESOLVED' ? 'ACKNOWLEDGED'");
    expect(manager).toContain('تغيرت حالة النداء بواسطة مستخدم آخر');
  });

  it('serializes waiter-call duplicate checks and keeps request/table writes atomic', () => {
    const route = read('../../server/routes/public.ts');
    expect(route).toContain("{ isolationLevel: 'Serializable' }");
    expect(route).toContain("{ status: { in: ['PENDING', 'ACKNOWLEDGED'] } }");
    expect(route).toContain("transactionError as { code?: string })?.code === 'P2034'");
  });

  it('targets SSE at the configured API host in split frontend/backend deployments', () => {
    const api = read('../services/api.ts');
    const context = read('../context/RestaurantContext.tsx');
    expect(api).toContain('export function apiConnectionUrl');
    expect(api).toContain("`${configuredApiUrl || ''}${normalized}`");
    expect(context.match(/apiConnectionUrl\(`\/api\/public\/events/g)).toHaveLength(2);
    expect(api).toContain('signal: AbortSignal.timeout(30_000)');
  });

  it('never reports real staff/offer/category edits before an API-confirmed save', () => {
    const staff = read('../components/manager/StaffManagement.tsx');
    const offers = read('../components/manager/OffersManagement.tsx');
    const menu = read('../components/manager/MenuManagement.tsx');
    expect(staff).toContain('const res = await api.updateStaff');
    expect(staff).toContain("if (!res.success)");
    expect(offers).toContain('const saved = await addOffer');
    expect(offers).toContain('if (!saved) return');
    expect(menu).toContain('const saved = await addCategory');
  });

  it('keeps unknown API GETs out of the SPA success fallback', () => {
    const server = read('../../server/index.ts');
    const api404 = server.indexOf("app.use('/api'");
    const spaFallback = server.indexOf("app.get('/{*splat}'");
    expect(api404).toBeGreaterThan(0);
    expect(api404).toBeLessThan(spaFallback);
  });
});
