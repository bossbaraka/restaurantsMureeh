import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * SSE × compression — real-PostgreSQL integration gate (SEC-01 / P1-B).
 *
 * The production failure mode: gzip compressed the event stream, so the SSE
 * endpoint "connected" (200 + headers) but the gzip buffer held every event
 * — KDS and waiter-call screens stayed frozen at 0 bytes until the buffer
 * filled. This gate pins BOTH properties on the SAME compression middleware
 * instance the server mounts (server/middleware/compression.ts — extracted
 * from index.ts so the test can never drift from production):
 *
 *   1. text/event-stream responses are NOT compressed (no Content-Encoding)
 *      and stream chunk-by-chunk (first event arrives while the connection
 *      is young, not buffered until close).
 *   2. Regular JSON responses over the gzip threshold ARE still compressed —
 *      the filter must not disable compression globally.
 */

loadDotenv();

const RUN = process.env.DATABASE_URL ? 'on' : 'off';
const hasDb = RUN === 'on';

describe('SSE compression gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('SSE streaming vs compression (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;

  beforeAll(async () => {
    const { default: express } = await import('express');
    const authRouter = (await import('../../server/routes/auth')).default;
    const publicRouter = (await import('../../server/routes/public')).default;
    const { compressionMiddleware } = await import('../../server/middleware/compression');
    const { authenticateToken, signToken } = await import('../../server/middleware/auth');
    ({ prisma } = await import('../../server/db/prisma'));
    const bcrypt = await import('bcryptjs');

    const run = `sse${Date.now().toString(36)}`;
    const idA = `rest-${run}`;
    ctx = { run, idA, slugA: `sse-${run}` };

    // galleryImages is part of the public /restaurants select — a long list
    // pushes that response past the 1kb gzip threshold so the compression
    // control case is deterministic.
    await prisma.restaurant.create({
      data: {
        id: idA, slug: ctx.slugA, name: `SSE ${run}`, logoUrl: '',
        description: 'SSE compression test tenant',
        phone: '0000000000', address: 'Test',
        galleryImages: Array.from({ length: 24 }, (_, i) =>
          `https://assets.example.test/gallery/${run}/photo-${i}-with-a-long-object-key.jpeg`
        ),
        status: 'ACTIVE',
      },
    });
    // Menu catalog fixture for the compression control case (public
    // /restaurants/:slug returns the full menu JSON — comfortably > 1kb).
    const cat = await prisma.category.create({
      data: { restaurantId: idA, name: 'مشروبات', nameEn: 'Drinks', sortOrder: 1 },
    });
    for (let i = 0; i < 6; i += 1) {
      await prisma.product.create({
        data: {
          restaurantId: idA, categoryId: cat.id,
          name: `قهوة ${i}`, nameEn: `Coffee ${i}`,
          description: 'وصف طويل للمنتج لضمان تجاوز حد الضغط '.repeat(4),
          price: 12 + i, imageUrl: '', available: true,
        },
      });
    }

    ctx.manager = await prisma.restaurantUser.create({
      data: {
        id: `mgr-${run}`, restaurantId: idA, name: 'SSE Manager',
        email: `manager@${ctx.slugA}.test`,
        passwordHash: bcrypt.hashSync('SseManager#2026pass', 10),
        role: 'RESTAURANT_MANAGER', status: 'ACTIVE',
      },
    });
    ctx.token = signToken({ id: ctx.manager.id, restaurantId: idA, role: 'RESTAURANT_MANAGER' });

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(compressionMiddleware);
    app.use('/api/auth', authenticateToken, authRouter);
    app.use('/api/public', publicRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (ctx?.run) {
      await prisma.restaurantUser.deleteMany({ where: { id: `mgr-${ctx.run}` } });
      await prisma.restaurant.deleteMany({ where: { id: ctx.idA } });
    }
    await prisma.$disconnect?.();
  });

  it('streams SSE uncompressed: headers arrive, first event arrives within seconds', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const res = await fetch(
      `${base}/api/public/events?restaurantId=${ctx.idA}&token=${ctx.token}`,
      { headers: { accept: 'text/event-stream', 'accept-encoding': 'gzip' }, signal: controller.signal },
    );
    expect(res.status).toBe(200);
    expect((res.headers.get('content-type') || '').startsWith('text/event-stream')).toBe(true);
    // THE regression: gzip must not wrap the stream.
    expect(res.headers.get('content-encoding')).toBeNull();

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const firstChunk = new TextDecoder().decode(value ?? new Uint8Array());
    const firstEventMs = Date.now() - started;
    expect(firstChunk).toContain('event: connected');
    // If gzip buffering were active, nothing would arrive until ~flush/close.
    expect(firstEventMs).toBeLessThan(3_000);
    controller.abort();
  });

  it('delivers live broadcasts to an open SSE connection', async () => {
    const { realtimeService } = await import('../../server/services/realtime');
    const controller = new AbortController();
    const res = await fetch(
      `${base}/api/public/events?restaurantId=${ctx.idA}&token=${ctx.token}`,
      { headers: { accept: 'text/event-stream', 'accept-encoding': 'gzip' }, signal: controller.signal },
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // connected event

    realtimeService.broadcastToTable(ctx.idA, 'tbl-x', 'WAITER_CALL', { table: '1' });

    // Read until the broadcast shows up (with a hard deadline).
    const deadline = Date.now() + 3_000;
    let sawBroadcast = false;
    let buffer = '';
    while (Date.now() < deadline && !sawBroadcast) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1_500)),
      ]).catch(() => ({ value: undefined, done: true }) as any);
      if (done) break;
      buffer += new TextDecoder().decode(value ?? new Uint8Array());
      if (buffer.includes('event: WAITER_CALL')) sawBroadcast = true;
    }
    controller.abort();
    expect(sawBroadcast).toBe(true);
  });

  it('still compresses regular JSON responses (filter is scoped to SSE only)', async () => {
    // undici's fetch transparently decompresses and strips Content-Encoding,
    // so the control case uses a raw HTTP request (same as a real proxy).
    const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = import('node:http').then(({ default: http }) =>
        http.get(
          {
            host: '127.0.0.1',
            port: (server.address() as import('net').AddressInfo).port,
            path: `/api/public/restaurants/${ctx.slugA}`,
            headers: { 'accept-encoding': 'gzip' },
          },
          resolve,
        ).on('error', reject),
      );
      req.catch(reject);
    });
    expect(res.statusCode).toBe(200);
    let bytes = 0;
    res.on('data', (c: Buffer) => { bytes += c.length; });
    await new Promise((r) => res.on('end', r));
    // Menu catalog is large; gzip must have been applied to it.
    expect(bytes).toBeGreaterThan(1_024);
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});
