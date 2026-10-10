/**
 * Host canonicalisation: the Render service also answers on its
 * `*.onrender.com` alias, which would expose every page at two URLs. Page
 * requests on an alias must 301 to the public origin; API/uploads/health
 * traffic and the canonical host itself must pass through untouched.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/config')>();
  return { ...actual, isProd: true };
});
vi.mock('../../server/db/prisma', () => ({ prisma: {} }));

type Handler = typeof import('../../server/seo/publicHandlers')['handleCanonicalHostRedirect'];
let handleCanonicalHostRedirect: Handler;

function run(input: { method?: string; hostname: string; path: string; originalUrl?: string }) {
  const res = {
    statusCode: 0,
    location: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    redirect(status: number, location: string) {
      this.statusCode = status;
      this.location = location;
    },
  };
  const next = vi.fn();
  handleCanonicalHostRedirect(
    {
      method: input.method ?? 'GET',
      hostname: input.hostname,
      path: input.path,
      originalUrl: input.originalUrl ?? input.path,
    } as any,
    res as any,
    next
  );
  return { res, next };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-host-redirect-secret-32-chars!';
  delete process.env.APP_URL;
  ({ handleCanonicalHostRedirect } = await import('../../server/seo/publicHandlers'));
});

describe('handleCanonicalHostRedirect (production)', () => {
  it('301s page requests on the onrender.com alias to the public origin, keeping path and query', () => {
    const { res, next } = run({
      hostname: 'restaurantsmureeh-2.onrender.com',
      path: '/r/ghosn-cafe',
      originalUrl: '/r/ghosn-cafe?qr=abc',
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(301);
    expect(res.location).toBe('https://mureehmenu.com/r/ghosn-cafe?qr=abc');
  });

  it('301s the www alias as well', () => {
    const { res } = run({ hostname: 'www.mureehmenu.com', path: '/' });
    expect(res.statusCode).toBe(301);
    expect(res.location).toBe('https://mureehmenu.com/');
  });

  it('leaves the canonical host, API, uploads and non-GET requests alone', () => {
    expect(run({ hostname: 'mureehmenu.com', path: '/r/ghosn-cafe' }).next).toHaveBeenCalled();
    expect(run({ hostname: 'restaurantsmureeh-2.onrender.com', path: '/api/health' }).next).toHaveBeenCalled();
    expect(run({ hostname: 'restaurantsmureeh-2.onrender.com', path: '/uploads/x.png' }).next).toHaveBeenCalled();
    expect(run({ hostname: 'restaurantsmureeh-2.onrender.com', path: '/r/x', method: 'POST' }).next).toHaveBeenCalled();
  });

  it('does not touch unknown hosts (future custom domains, internal probes)', () => {
    expect(run({ hostname: 'localhost', path: '/' }).next).toHaveBeenCalled();
    expect(run({ hostname: 'menu.some-venue.example', path: '/r/x' }).next).toHaveBeenCalled();
  });
});
