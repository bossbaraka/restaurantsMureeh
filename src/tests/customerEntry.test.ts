/**
 * Behavioral tests for the customer QR entry state machine
 * (src/services/customerEntry.ts).
 *
 * These exercise the REAL orchestration with a scripted fake API — no
 * source-string assertions. Covered invariants:
 *
 *  - valid QR → session + catalog → READY
 *  - READY requires a genuinely successful catalog response (never
 *    inferred from empty arrays) — an empty catalog IS a valid READY
 *  - invalid QR (404/400) → INVALID, catalog never requested
 *  - inactive venue (403) → INVALID 'restaurant'
 *  - transient failures → bounded internal retry with backoff → READY
 *  - retry exhaustion → RECOVERY, and NEVER an infinite loop
 *  - direct slug link (no QR) skips the session stage
 *  - stale run identity aborts further requests and commits nothing
 */
import { describe, expect, it } from 'vitest';
import {
  ENTRY_MAX_ATTEMPTS,
  ENTRY_RETRY_DELAYS_MS,
  runCustomerEntry,
  type EntryApiResponse,
  type EntryCatalogData,
  type EntryPhase,
  type EntrySessionData,
} from '../services/customerEntry';

interface FakeOptions {
  sessionResponses?: Array<Partial<EntryApiResponse<EntrySessionData>>>;
  catalogResponses?: Array<Partial<EntryApiResponse<EntryCatalogData>>>;
  staleAfterCalls?: number;
}

function makeFakes(options: FakeOptions = {}) {
  const sessionQueue = [...(options.sessionResponses || [])];
  const catalogQueue = [...(options.catalogResponses || [])];
  const calls: Array<{ api: 'session' | 'catalog'; token?: string; slug: string }> = [];
  const phases: EntryPhase[] = [];
  const waits: number[] = [];
  let apiCalls = 0;
  let stale = false;

  const okSession = (): EntryApiResponse<EntrySessionData> => ({
    success: true,
    statusCode: 200,
    data: {
      session: { id: 'sess-1', sessionToken: 'tok-1' },
      table: { id: 'rest-1-T01', tableNumber: 1 },
      restaurant: { id: 'rest-1', name: 'مطعم الاختبار', slug: 'test' },
    },
  });
  const okCatalog = (products: unknown[] = [{ id: 'p1' }]): EntryApiResponse<EntryCatalogData> => ({
    success: true,
    statusCode: 200,
    data: {
      restaurant: { id: 'rest-1', slug: 'test' },
      categories: [{ id: 'c1' }],
      products,
      offers: [],
      tables: [],
    },
  });

  const api = {
    createTableSession: async (token: string, slug?: string) => {
      apiCalls += 1;
      calls.push({ api: 'session', token, slug: slug || '' });
      if (options.staleAfterCalls !== undefined && apiCalls >= options.staleAfterCalls) stale = true;
      const next = sessionQueue.shift();
      return { ...(next || okSession()), statusCode: next?.statusCode ?? 200 } as EntryApiResponse<EntrySessionData>;
    },
    getCatalog: async (slug: string, qrToken?: string) => {
      apiCalls += 1;
      calls.push({ api: 'catalog', slug, token: qrToken });
      if (options.staleAfterCalls !== undefined && apiCalls >= options.staleAfterCalls) stale = true;
      const next = catalogQueue.shift();
      return { ...(next || okCatalog()), statusCode: next?.statusCode ?? 200 } as EntryApiResponse<EntryCatalogData>;
    },
  };

  const hooks = {
    isStale: () => stale,
    wait: async (ms: number) => {
      waits.push(ms);
    },
    onPhase: (phase: EntryPhase) => {
      phases.push(phase);
    },
  };

  return { api, hooks, calls, phases, waits };
}

describe('customer entry — happy path', () => {
  it('valid QR reaches READY with session + catalog committed', async () => {
    const { api, hooks, calls, phases } = makeFakes();
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-abc' }, api, hooks);

    expect(outcome.outcome).toBe('READY');
    if (outcome.outcome !== 'READY') return;
    expect(outcome.session?.table.id).toBe('rest-1-T01');
    expect(outcome.qrToken).toBe('qr-abc');
    expect(calls.map((c) => c.api)).toEqual(['session', 'catalog']);
    // Identity is surfaced for the branded loader before the catalog lands.
    expect(phases[0]).toBe('INITIALIZING');
    expect(phases).toContain('VALIDATING_QR');
    expect(phases).toContain('LOADING_CATALOG');
  });

  it('a genuinely empty catalog is a LEGITIMATE READY (server confirmed success)', async () => {
    const { api, hooks } = makeFakes({
      catalogResponses: [
        {
          success: true,
          statusCode: 200,
          data: { restaurant: { id: 'r' }, categories: [], products: [], offers: [] },
        },
      ],
    });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-abc' }, api, hooks);
    expect(outcome.outcome).toBe('READY');
    if (outcome.outcome === 'READY') expect(outcome.catalog.products).toEqual([]);
  });
});

describe('customer entry — permanently invalid states', () => {
  it('unknown QR token (404) → INVALID qr, catalog never requested', async () => {
    const { api, hooks, calls } = makeFakes({
      sessionResponses: [{ success: false, statusCode: 404 }],
    });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'bad-token' }, api, hooks);
    expect(outcome).toEqual({ outcome: 'INVALID', reason: 'qr' });
    expect(calls.map((c) => c.api)).toEqual(['session']); // no retry, no catalog
  });

  it('QR / venue mismatch (400) → INVALID qr without retrying', async () => {
    const { api, hooks, calls } = makeFakes({
      sessionResponses: [{ success: false, statusCode: 400 }],
    });
    const outcome = await runCustomerEntry({ slug: 'other', qrToken: 'qr-abc' }, api, hooks);
    expect(outcome).toEqual({ outcome: 'INVALID', reason: 'qr' });
    expect(calls).toHaveLength(1);
  });

  it('inactive restaurant (403 on session) → INVALID restaurant', async () => {
    const { api, hooks } = makeFakes({
      sessionResponses: [{ success: false, statusCode: 403 }],
    });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-abc' }, api, hooks);
    expect(outcome).toEqual({ outcome: 'INVALID', reason: 'restaurant' });
  });

  it('direct slug link with unknown venue (404 on catalog) → INVALID qr', async () => {
    const { api, hooks, calls } = makeFakes({
      catalogResponses: [{ success: false, statusCode: 404 }],
    });
    const outcome = await runCustomerEntry({ slug: 'ghost' }, api, hooks);
    expect(outcome).toEqual({ outcome: 'INVALID', reason: 'qr' });
    expect(calls.map((c) => c.api)).toEqual(['catalog']); // session skipped
  });

  it('inactive venue on catalog (403) → INVALID restaurant', async () => {
    const { api, hooks } = makeFakes({
      catalogResponses: [{ success: false, statusCode: 403 }],
    });
    const outcome = await runCustomerEntry({ slug: 'test' }, api, hooks);
    expect(outcome).toEqual({ outcome: 'INVALID', reason: 'restaurant' });
  });
});

describe('customer entry — bounded recovery', () => {
  it('transient session failure retries with backoff then READY', async () => {
    const { api, hooks, waits, phases } = makeFakes({
      sessionResponses: [
        { success: false, statusCode: 500 },
        { success: false, statusCode: 0 }, // network-level failure
      ], // third attempt falls through to success
    });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-abc' }, api, hooks);
    expect(outcome.outcome).toBe('READY');
    expect(waits).toEqual([ENTRY_RETRY_DELAYS_MS[0], ENTRY_RETRY_DELAYS_MS[1]]);
    expect(phases).toContain('RETRYING');
  });

  it('transient catalog failure once then success → READY', async () => {
    const { api, hooks } = makeFakes({
      catalogResponses: [{ success: false, statusCode: 502 }],
    });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-abc' }, api, hooks);
    expect(outcome.outcome).toBe('READY');
  });

  it('exhausted retries → RECOVERY, and attempts are strictly bounded (no infinite loop)', async () => {
    const { api, hooks, calls } = makeFakes({
      catalogResponses: [
        { success: false, statusCode: 500 },
        { success: false, statusCode: 500 },
        { success: false, statusCode: 500 },
        // If the machine kept looping, these would be consumed:
        { success: false, statusCode: 500 },
        { success: false, statusCode: 500 },
      ],
    });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-abc' }, api, hooks);
    expect(outcome.outcome).toBe('RECOVERY');
    const catalogAttempts = calls.filter((c) => c.api === 'catalog').length;
    expect(catalogAttempts).toBe(ENTRY_MAX_ATTEMPTS);
  });

  it('a thrown fetch error is transient, not a customer-visible failure', async () => {
    const failingThenOk = {
      session: 0,
      catalog: 0,
    };
    const api = {
      createTableSession: async () => {
        failingThenOk.session += 1;
        if (failingThenOk.session === 1) throw new TypeError('Failed to fetch');
        return {
          success: true,
          statusCode: 200,
          data: {
            session: { id: 's', sessionToken: 't' },
            table: { id: 'T1', tableNumber: 1 },
            restaurant: { id: 'r' },
          },
        } as EntryApiResponse<EntrySessionData>;
      },
      getCatalog: async () =>
        ({
          success: true,
          statusCode: 200,
          data: { restaurant: { id: 'r' }, categories: [], products: [{ id: 'p' }], offers: [] },
        }) as EntryApiResponse<EntryCatalogData>,
    };
    const outcome = await runCustomerEntry(
      { slug: 'test', qrToken: 'qr' },
      api,
      { isStale: () => false, wait: async () => {} }
    );
    expect(outcome.outcome).toBe('READY');
  });
});

describe('customer entry — stale-run protection', () => {
  it('a superseded run stops issuing requests and reports STALE', async () => {
    // Run goes stale right after the FIRST api call resolves — simulating a
    // newer QR scan starting while the older request was still in flight.
    const { api, hooks, calls } = makeFakes({ staleAfterCalls: 1 });
    const outcome = await runCustomerEntry({ slug: 'test', qrToken: 'qr-old' }, api, hooks);
    expect(outcome.outcome).toBe('STALE');
    // The catalog stage must never have started for the stale run.
    expect(calls.filter((c) => c.api === 'catalog')).toHaveLength(0);
  });

  it('isStale is consulted before the catalog stage even if session succeeded', async () => {
    let staleFlag = false;
    const api = {
      createTableSession: async () => {
        staleFlag = true; // newer run starts while this one is mid-flight
        return {
          success: true,
          statusCode: 200,
          data: {
            session: { id: 's', sessionToken: 't' },
            table: { id: 'T1', tableNumber: 1 },
            restaurant: { id: 'r' },
          },
        } as EntryApiResponse<EntrySessionData>;
      },
      getCatalog: async () => {
        throw new Error('catalog must not be requested by a stale run');
      },
    };
    const outcome = await runCustomerEntry(
      { slug: 'test', qrToken: 'qr-old' },
      api,
      { isStale: () => staleFlag, wait: async () => {} }
    );
    expect(outcome.outcome).toBe('STALE');
  });
});
