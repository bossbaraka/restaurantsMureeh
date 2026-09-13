import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// ============================================================================
// DB INTEGRATION — theme image persistence through the REAL routers.
//
// This is the end-to-end proof of the persistence contract:
//   upload -> stable tenant-scoped path (DB source of truth)
//   -> branding save folds the upload URL back into the KEY
//   -> every fresh GET re-resolves key -> renderable URL (deterministic)
//   -> omitted = keep, '' = explicit clear, replace = new asset + old cleanup
//   -> tenant isolation on write and on delete
//
// Gate: runs ONLY when DATABASE_URL is set. Without it the suite skips
// cleanly and the pure contract unit tests (theme-asset-contract.test.ts)
// remain the guard.
//
// IMPORTANT: env vars are set BEFORE the server modules are imported
// (dynamic imports in beforeAll) because server/config.ts is fail-closed
// and reads env at import time. server/index.ts is NEVER imported (it
// calls app.listen as an import side effect) — we build a minimal app
// from the router modules, exactly the way the real server mounts them.
// ============================================================================

loadDotenv();

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN: 'on' | 'off' = hasDb ? 'on' : 'off';

// Storage layout for this suite — a throwaway directory, local driver.
const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-persist-'));

process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.NODE_ENV = 'test';
delete process.env.APP_URL; // same-origin mode: relative /uploads/… URLs
process.env.JWT_SECRET = process.env.JWT_SECRET || 'theme-persist-test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

type App = ReturnType<typeof import('express')>;
interface Ctx {
  base: string;
  idA: string;
  idB: string;
  slugA: string;
  slugB: string;
  /** Auth headers, computed in beforeAll (ctx is null at collection time). */
  authA: Record<string, string>;
  authB: Record<string, string>;
  tokenA: string;
  tokenB: string;
  prisma: {
    restaurant: {
      findUnique: (args: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => Promise<Record<string, unknown> | null>;
      deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
      user?: never;
    };
    restaurantUser: {
      deleteMany: (args: { where: { restaurantId: { in: string[] } } }) => Promise<unknown>;
    };
    $disconnect: () => Promise<unknown>;
  };
  close: () => Promise<void>;
}

let ctx: Ctx | null = null;

// A tiny valid 1×1 PNG (magic bytes satisfy the sniff check).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Mirrors the real client (api.uploadImage): `kind` travels as a FORM FIELD,
// the server derives the folder from it (never from the client filename).
function uploadForm(bytes: Buffer, name: string, kind?: string): FormData {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), name);
  if (kind) form.append('kind', kind);
  return form;
}

/** Wait until `fn` returns true (storage cleanup is best-effort/async). */
async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  if (RUN !== 'on') return;

  const { default: express } = await import('express');
  const uploadsRouter = (await import('../../server/routes/uploads')).default;
  const managerRouter = (await import('../../server/routes/manager')).default;
  const publicRouter = (await import('../../server/routes/public')).default;
  const { signToken, authenticateToken } = await import('../../server/middleware/auth');
  const { prisma } = await import('../../server/db/prisma');

  // Test tenants — created directly in the DB (no seed dependency).
  const run = `theme${Date.now().toString(36)}`;
  const idA = `rest-${run}-a`;
  const idB = `rest-${run}-b`;
  const slugA = `theme-a-${run}`;
  const slugB = `theme-b-${run}`;
  const hash = (await import('bcryptjs')).hashSync('persist-test-password', 10);

  for (const [id, slug] of [
    [idA, slugA],
    [idB, slugB],
  ] as const) {
    await prisma.restaurant.create({
      data: {
        id,
        slug,
        name: `Theme Test ${slug}`,
        logoUrl: '',
        description: 'Integration test tenant',
        phone: '0000000000',
        address: 'Test Street',
        galleryImages: [],
      },
    });
    await prisma.restaurantUser.create({
      data: {
        id: `user-${run}-${slug}`,
        restaurantId: id,
        name: `Manager ${slug}`,
        email: `${slug}@theme.test`,
        passwordHash: hash,
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });
  }

  const userA = await prisma.restaurantUser.findUniqueOrThrow({
    where: { id: `user-${run}-${slugA}` },
  });
  const userB = await prisma.restaurantUser.findUniqueOrThrow({
    where: { id: `user-${run}-${slugB}` },
  });

  const app: App = express();
  app.use(express.json({ limit: '1mb' }));
  // Static mount mirrors server/index.ts so asset GETs are verifiable.
  app.use('/uploads', express.static(TMP_UPLOADS));
  // Mirror server/index.ts mount order exactly (auth middleware app-side).
  app.use('/api/public', publicRouter);
  app.use('/api/uploads', authenticateToken, uploadsRouter);
  app.use('/api/manager', authenticateToken, managerRouter);

  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;

  const tokenA = signToken({
    id: userA.id,
    restaurantId: userA.restaurantId,
    name: userA.name,
    email: userA.email,
    role: userA.role,
    status: userA.status,
    tv: userA.tokenVersion,
  });
  const tokenB = signToken({
    id: userB.id,
    restaurantId: userB.restaurantId,
    name: userB.name,
    email: userB.email,
    role: userB.role,
    status: userB.status,
    tv: userB.tokenVersion,
  });

  ctx = {
    base: `http://127.0.0.1:${port}`,
    idA,
    idB,
    slugA,
    slugB,
    authA: { Authorization: `Bearer ${tokenA}` },
    authB: { Authorization: `Bearer ${tokenB}` },
    tokenA,
    tokenB,
    prisma: prisma as Ctx['prisma'],
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}, 60000);

afterAll(async () => {
  if (!ctx) return;
  try {
    if (ctx.idA && ctx.idB) {
      await ctx.prisma.restaurantUser.deleteMany({
        where: { restaurantId: { in: [ctx.idA, ctx.idB] } },
      });
      await ctx.prisma.restaurant.deleteMany({ where: { id: { in: [ctx.idA, ctx.idB] } } });
    }
  } finally {
    await ctx.prisma.$disconnect().catch(() => undefined);
    await ctx.close().catch(() => undefined);
    fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
  }
});

describe.skipIf(RUN !== 'on')('theme image persistence (real routers + DB)', () => {
  let logoKey1: string;
  let logoKey2: string;

  // Headers are computed in beforeAll (ctx is null at collection time).
  const authA = () => ctx!.authA;
  const authB = () => ctx!.authB;
  const json = { 'Content-Type': 'application/json' };

  const getRow = async (id: string) =>
    ctx!.prisma.restaurant.findUnique({
      where: { id },
      select: { logoUrl: true, coverImageUrl: true, galleryImages: true },
    });

  const assetPath = (key: string) => path.join(TMP_UPLOADS, key);

  it('1. upload returns a deterministic tenant-scoped stable path', async () => {
    const res = await fetch(`${ctx!.base}/api/uploads/image`, {
      method: 'POST',
      headers: authA(),
      body: uploadForm(PNG_1x1, 'logo-1.png', 'logo'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { url: string; pathUrl: string; key: string };
    };
    expect(body.success).toBe(true);
    logoKey1 = body.data.key;
    // Deterministic tenant-aware path: restaurants/{tenantId}/{folder}/{uuid}.png
    expect(logoKey1).toMatch(new RegExp(`^restaurants/${ctx!.idA}/logo/[0-9a-f-]{36}\\.png$`));
    // Renderable URL is a VIEW over the key — same origin in this deployment.
    expect(body.data.url).toBe(`/uploads/${logoKey1}`);
    // The DB must NEVER see this URL — the client persists the pathUrl/key.
    expect(body.data.pathUrl).toBe(logoKey1);
  }, 30000);

  it('2. branding save persists the STABLE KEY, response carries URL + path pair', async () => {
    const res = await fetch(`${ctx!.base}/api/manager/branding`, {
      method: 'PUT',
      headers: { ...json, ...authA() },
      body: JSON.stringify({ restaurantId: ctx!.idA, logo: `/uploads/${logoKey1}` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        restaurant: { logoUrl: string; logoStoragePath: string; primaryColor: string };
      };
    };
    expect(body.success).toBe(true);
    // Response = renderable URL in the existing field…
    expect(body.data.restaurant.logoUrl).toBe(`/uploads/${logoKey1}`);
    // …and the stable reference in the additive pair field.
    expect(body.data.restaurant.logoStoragePath).toBe(logoKey1);
    // The DATABASE holds the stable reference — not the URL, not the host.
    const row = await getRow(ctx!.idA);
    expect(row!.logoUrl).toBe(logoKey1);
    expect(String(row!.logoUrl)).not.toContain('http');
    expect(String(row!.logoUrl)).not.toContain('/uploads/');
  }, 30000);

  it('3. every fresh render re-resolves the stored key deterministically (catalog + asset)', async () => {
    const res = await fetch(`${ctx!.base}/api/public/restaurants/${ctx!.slugA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { restaurant: { logo: string; logoStoragePath: string } };
    };
    expect(body.data.restaurant.logo).toBe(`/uploads/${logoKey1}`);
    expect(body.data.restaurant.logoStoragePath).toBe(logoKey1);
    // The resolved URL actually serves the uploaded bytes.
    const asset = await fetch(`${ctx!.base}${body.data.restaurant.logo}`);
    expect(asset.status).toBe(200);
    const bytes = Buffer.from(await asset.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(PNG_1x1.subarray(0, 8));
  }, 30000);

  it('4. omitted image fields keep the existing reference (never nullified)', async () => {
    const res = await fetch(`${ctx!.base}/api/manager/branding`, {
      method: 'PUT',
      headers: { ...json, ...authA() },
      // Only a color change — no logo/cover/gallery/map fields at all.
      body: JSON.stringify({ restaurantId: ctx!.idA, primaryColor: '#10B981' }),
    });
    expect(res.status).toBe(200);
    const row = await getRow(ctx!.idA);
    expect(row!.logoUrl).toBe(logoKey1); // untouched
    // And the color actually updated (the write itself happened):
    const res2 = (await (
      await fetch(`${ctx!.base}/api/public/restaurants/${ctx!.slugA}`)
    ).json()) as { data: { restaurant: { primaryColor: string } } };
    expect(res2.data.restaurant.primaryColor).toBe('#10B981');
  }, 30000);

  it('5. replace = new asset, and the replaced asset is cleaned up', async () => {
    const up = (
      await (
        await fetch(`${ctx!.base}/api/uploads/image`, {
          method: 'POST',
          headers: authA(),
          body: uploadForm(PNG_1x1, 'logo-2.png', 'logo'),
        })
      ).json()
    ) as { data: { key: string; url: string } };
    logoKey2 = up.data.key;
    expect(logoKey2).not.toBe(logoKey1);
    expect(fs.existsSync(assetPath(logoKey2))).toBe(true);

    const res = await fetch(`${ctx!.base}/api/manager/branding`, {
      method: 'PUT',
      headers: { ...json, ...authA() },
      body: JSON.stringify({ restaurantId: ctx!.idA, logo: up.data.url }),
    });
    expect(res.status).toBe(200);
    const row = await getRow(ctx!.idA);
    expect(row!.logoUrl).toBe(logoKey2);
    // The OLD managed asset is deleted from storage (best-effort, post-commit):
    await expect(
      waitFor(() => !fs.existsSync(assetPath(logoKey1)))
    ).resolves.toBe(true);
    expect(fs.existsSync(assetPath(logoKey2))).toBe(true);
  }, 30000);

  it('6. explicit clear is a separate operation: null/"" empties the field', async () => {
    const res = await fetch(`${ctx!.base}/api/manager/branding`, {
      method: 'PUT',
      headers: { ...json, ...authA() },
      body: JSON.stringify({ restaurantId: ctx!.idA, logo: '' }),
    });
    expect(res.status).toBe(200);
    const row = await getRow(ctx!.idA);
    expect(row!.logoUrl).toBe(''); // NOT NULL column — cleared, not nulled
    await expect(
      waitFor(() => !fs.existsSync(assetPath(logoKey2)))
    ).resolves.toBe(true);
  }, 30000);

  it('7. transient payload types are rejected and never persisted', async () => {
    for (const bad of [
      'data:image/png;base64,iVBORw0KGgo',
      'blob:http://app.test/123',
      'javascript:alert(1)',
      '//evil.test/logo.png',
    ]) {
      const res = await fetch(`${ctx!.base}/api/manager/branding`, {
        method: 'PUT',
        headers: { ...json, ...authA() },
        body: JSON.stringify({ restaurantId: ctx!.idA, logo: bad }),
      });
      expect(res.status).toBe(400);
    }
    const row = await getRow(ctx!.idA);
    expect(row!.logoUrl).toBe(''); // unchanged by the rejected writes
  }, 30000);

  it('8. tenant isolation: B cannot reference or delete A assets', async () => {
    // Give A a fresh asset again:
    const up = (
      await (
        await fetch(`${ctx!.base}/api/uploads/image`, {
          method: 'POST',
          headers: authA(),
          body: uploadForm(PNG_1x1, 'cover-a.png', 'cover'),
        })
      ).json()
    ) as { data: { key: string; url: string } };
    const aCoverKey = up.data.key;

    // B tries to make A's asset its own (raw key):
    const write = await fetch(`${ctx!.base}/api/manager/branding`, {
      method: 'PUT',
      headers: { ...json, ...authB() },
      body: JSON.stringify({ restaurantId: ctx!.idB, coverImage: aCoverKey }),
    });
    expect(write.status).toBe(400);
    const rowB = await getRow(ctx!.idB);
    expect(rowB!.coverImageUrl).toBeNull(); // B untouched

    // B tries to delete A's file:
    const del = await fetch(`${ctx!.base}/api/uploads/delete`, {
      method: 'POST',
      headers: { ...json, ...authB() },
      body: JSON.stringify({ url: aCoverKey }),
    });
    expect(del.status).toBe(403);
    expect(fs.existsSync(assetPath(aCoverKey))).toBe(true); // A's file intact

    // B's public catalog never exposes A's key:
    const catB = (
      await (
        await fetch(`${ctx!.base}/api/public/restaurants/${ctx!.slugB}`)
      ).json()
    ) as { data: { restaurant: Record<string, unknown> } };
    expect(JSON.stringify(catB)).not.toContain(aCoverKey);
  }, 30000);

  it('9. legacy rows (stored /uploads URL) resolve on read and fold on write', async () => {
    // Simulate a pre-fix row: the DB holds a relative /uploads URL for an
    // asset in THIS tenant's own namespace (the realistic legacy shape).
    const legacyKey = `restaurants/${ctx!.idB}/logo/legacy.png`;
    fs.mkdirSync(path.dirname(assetPath(legacyKey)), { recursive: true });
    fs.writeFileSync(assetPath(legacyKey), PNG_1x1);
    await (ctx!.prisma.restaurant as any).update({
      where: { id: ctx!.idB },
      data: { logoUrl: `/uploads/${legacyKey}` },
    });

    // Read: resolved to a renderable URL deterministically.
    const cat = (
      await (
        await fetch(`${ctx!.base}/api/public/restaurants/${ctx!.slugB}`)
      ).json()
    ) as { data: { restaurant: { logo: string; logoStoragePath: string } } };
    expect(cat.data.restaurant.logo).toBe(`/uploads/${legacyKey}`);
    expect(cat.data.restaurant.logoStoragePath).toBe(legacyKey);

    // Write: the URL folds back into the stable key.
    const res = await fetch(`${ctx!.base}/api/manager/branding`, {
      method: 'PUT',
      headers: { ...json, ...authB() },
      body: JSON.stringify({ restaurantId: ctx!.idB, logo: `/uploads/${legacyKey}` }),
    });
    expect(res.status).toBe(200);
    const row = await getRow(ctx!.idB);
    expect(row!.logoUrl).toBe(legacyKey); // now the stable reference
    // No false "replacement" — the same key was kept, file untouched:
    expect(fs.existsSync(assetPath(legacyKey))).toBe(true);
  }, 30000);

  it('10. auth surfaces return the resolved URL + stable path pair', async () => {
    const res = await fetch(`${ctx!.base}/api/public/restaurants`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { restaurants: Array<{ slug: string; logo: string; logoStoragePath: string }> };
    };
    const rowB = body.data.restaurants.find((r) => r.slug === ctx!.slugB);
    expect(rowB).toBeDefined();
    // After test 9, B's row holds the stable key; the directory response
    // carries the renderable URL + the reference pair (fresh render works).
    const bLegacyKey = `restaurants/${ctx!.idB}/logo/legacy.png`;
    expect(rowB!.logoStoragePath).toBe(bLegacyKey);
    expect(rowB!.logo).toBe(`/uploads/${bLegacyKey}`);
  }, 30000);
});
