/**
 * Production Storage Guard — regression suite (2026-09-17).
 *
 * Bug class being closed: `STORAGE_DRIVER=local` is only dangerous when the
 * filesystem is EPHEMERAL, and the boot guard used to be keyed on
 * `NODE_ENV === 'production'` alone. A Render service whose NODE_ENV was
 * missing or overridden therefore booted happily on the local filesystem,
 * wrote every tenant logo/cover/gallery image next to the process, and lost
 * all of them on the next redeploy.
 *
 * The guard now also honours the variables Render itself injects into every
 * service (RENDER / RENDER_SERVICE_ID / RENDER_EXTERNAL_HOSTNAME). These are
 * the platform's documented default variables — no invented names — and they
 * are only ever READ (never defaulted to "production"), so a plain local clone
 * or any non-Render host keeps exactly the behaviour it has today.
 *
 * Required matrix (all asserted below, offline: no DB, no network):
 *   development + local                          -> BOOT OK
 *   production  + local                          -> BOOT REFUSED
 *   Render indicator + local                     -> BOOT REFUSED  (NODE_ENV irrelevant)
 *   production  + supabase + valid credentials   -> BOOT OK
 *   production  + supabase + missing credentials -> BOOT REFUSED
 *
 * Style follows production-hardening.test.ts: `vi.resetModules()` + a real
 * import of server/config.ts, so the actual shipped validation runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VALID_SECRET = 'x'.repeat(40);
/** Only needed to get past the unrelated CORS/DB production checks when NODE_ENV=production. */
const PROD_ONLY_VARS = {
  CORS_ORIGIN: 'https://mureeh.example',
  DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
};
/** Render's documented platform variables (read-only inputs for this guard). */
const RENDER_VARS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'RENDER_EXTERNAL_HOSTNAME',
  'RENDER_EXTERNAL_URL',
];
const STORAGE_VARS = [
  'STORAGE_DRIVER',
  'STORAGE_ALLOW_LOCAL_IN_PROD',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'APP_URL',
];

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Import a FRESH copy of the real config module (its guards run at import). */
async function loadConfig(): Promise<any> {
  vi.resetModules();
  return vi.importActual('../../server/config.ts') as Promise<any>;
}

async function loadConfigError(): Promise<string> {
  try {
    await loadConfig();
  } catch (err) {
    return String((err as Error).message);
  }
  return '';
}

describe('Production Storage Guard — durability without relying on NODE_ENV', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'test',
      JWT_SECRET: VALID_SECRET,
      ...Object.fromEntries([...RENDER_VARS, ...STORAGE_VARS].map((k) => [k, undefined])),
    });
  });

  afterEach(() => {
    setEnv({
      NODE_ENV: 'test',
      ...Object.fromEntries([...RENDER_VARS, ...STORAGE_VARS].map((k) => [k, undefined])),
    });
  });

  // --------------------------------------------------------------- 1. dev OK
  it('allows local storage in development (developer machines keep working)', async () => {
    setEnv({ NODE_ENV: 'development', STORAGE_DRIVER: 'local' });
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
    expect(mod.isRenderInfra).toBe(false);
    expect(mod.isProductionInfra).toBe(false);
  });

  it('allows local storage when NODE_ENV is unset and no host indicator exists', async () => {
    setEnv({ NODE_ENV: undefined, STORAGE_DRIVER: 'local' });
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
  });

  // -------------------------------------------------------- 2. prod refused
  it('refuses local storage in production (NODE_ENV=production, no opt-in)', async () => {
    setEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 'local', ...PROD_ONLY_VARS });
    const message = await loadConfigError();
    expect(message).toMatch(/STORAGE_DRIVER=local is selected in production/);
    expect(message).toMatch(/STORAGE_ALLOW_LOCAL_IN_PROD/);
  });

  // ------------------------- 3. the regression: Render + wrong NODE_ENV ----
  it('REFUSES local storage on Render even when NODE_ENV=development', async () => {
    setEnv({ NODE_ENV: 'development', STORAGE_DRIVER: 'local', RENDER: 'true' });
    const message = await loadConfigError();
    expect(message).toMatch(/STORAGE_DRIVER=local is selected/);
    expect(message).toMatch(/Render service/);
    expect(message).toMatch(/no persistent disk/);
  });

  it('REFUSES local storage on Render when NODE_ENV is unset entirely', async () => {
    setEnv({ NODE_ENV: undefined, STORAGE_DRIVER: 'local', RENDER: 'true' });
    const message = await loadConfigError();
    expect(message).toMatch(/STORAGE_DRIVER=local is selected/);
  });

  it('detects Render from every documented indicator, not only RENDER', async () => {
    for (const indicator of ['RENDER_SERVICE_ID', 'RENDER_EXTERNAL_HOSTNAME']) {
      setEnv({ NODE_ENV: 'development', STORAGE_DRIVER: 'local', [indicator]: 'svc-1' });
      const message = await loadConfigError();
      expect(message, indicator).toMatch(/STORAGE_DRIVER=local is selected/);
    }
  });

  it('ignores a non-"true" RENDER value (only the documented one counts)', async () => {
    setEnv({ NODE_ENV: 'development', STORAGE_DRIVER: 'local', RENDER: 'yes' });
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
    expect(mod.isRenderInfra).toBe(false);
  });

  it('does not let the self-hosted opt-in unlock local storage ON RENDER', async () => {
    setEnv({
      NODE_ENV: 'development',
      STORAGE_DRIVER: 'local',
      STORAGE_ALLOW_LOCAL_IN_PROD: 'true',
      RENDER: 'true',
    });
    const message = await loadConfigError();
    expect(message).toMatch(/STORAGE_ALLOW_LOCAL_IN_PROD is ignored/);
  });

  it('still lets a SELF-HOSTED production box opt into a mounted volume', async () => {
    setEnv({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      STORAGE_ALLOW_LOCAL_IN_PROD: 'true',
      ...PROD_ONLY_VARS,
    });
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
    expect(mod.config.storageAllowLocalInProd).toBe(true);
  });

  // -------------------------------------- 4. supabase + valid config OK ----
  it('boots production with supabase storage and valid credentials', async () => {
    setEnv({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_STORAGE_BUCKET: 'restaurant-assets',
      ...PROD_ONLY_VARS,
    });
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('supabase');
  });

  it('boots a Render service with supabase storage even when NODE_ENV is unset', async () => {
    setEnv({
      NODE_ENV: undefined,
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      RENDER: 'true',
    });
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('supabase');
    expect(mod.isRenderInfra).toBe(true);
    expect(mod.isProductionInfra).toBe(true);
  });

  // ------------------------------- 5. supabase + missing creds refused ----
  it('refuses production boot when supabase is selected without credentials', async () => {
    setEnv({ NODE_ENV: 'production', STORAGE_DRIVER: 'supabase', ...PROD_ONLY_VARS });
    const message = await loadConfigError();
    expect(message).toMatch(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('refuses a Render service that selected supabase without credentials', async () => {
    setEnv({
      NODE_ENV: 'development',
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      RENDER: 'true',
    });
    const message = await loadConfigError();
    expect(message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(message).toMatch(/detected as a Render service/);
  });

  // ------------------------------------------- source/config invariants ----
  it('never infers production from an invented environment variable', () => {
    const src = readFileSync(resolve(__dirname, '../../server/config.ts'), 'utf8');
    const read = [...src.matchAll(/platformVar\(process\.env\.([A-Z0-9_]+)\)/g)].map(
      (m) => m[1]
    );
    // Exactly Render's documented variables — and nothing defaulted to prod.
    expect([...new Set(read)]).toEqual([
      'RENDER',
      'RENDER_SERVICE_ID',
      'RENDER_EXTERNAL_HOSTNAME',
    ]);
    // Detection only READS the platform variables — nothing is written or forced.
    expect(src).not.toMatch(/process\.env\.RENDER[_A-Z]*\s*=/);
  });

  it('keys the storage guard on the infrastructure, not on NODE_ENV alone', () => {
    const src = readFileSync(resolve(__dirname, '../../server/config.ts'), 'utf8');
    const guard = src.slice(src.indexOf('let resolvedStorageDriver'));
    expect(guard.startsWith('let resolvedStorageDriver')).toBe(true);
    expect(guard).toMatch(/if \(isProductionInfra\) \{/);
    expect(guard).not.toMatch(/^if \(isProd\) \{/m);
  });

  it('render.yaml still pins the durable production configuration', () => {
    const yaml = readFileSync(resolve(__dirname, '../../render.yaml'), 'utf8');
    expect(yaml).toMatch(/STORAGE_DRIVER[\s\S]*?value:\s*supabase/);
    expect(yaml).toMatch(/NODE_ENV[\s\S]*?value:\s*production/);
    // The escape hatch stays self-hosted-only: no value is shipped for it.
    expect(yaml).toMatch(/STORAGE_ALLOW_LOCAL_IN_PROD\n\s+sync:\s*false/);
  });
});
