// ============================================================
// Customer QR entry orchestration — the single state machine
// behind the guest flow:
//
//   INITIALIZING → VALIDATING_QR/CREATING_SESSION → LOADING_RESTAURANT
//     → LOADING_CATALOG → READY
//
// with controlled internal recovery:
//
//   transient failure → RETRYING (bounded backoff) → success → READY
//   bounded retries exhausted → RECOVERY (customer-safe retry action)
//   permanently invalid QR/venue → INVALID (customer-safe minimal state)
//
// This module owns NO React state and performs NO rendering. The
// context supplies an API adapter + run hooks; the UI component is
// presentation-only. Stale-run protection is cooperative: the caller
// increments a run identity and this module consults `isStale()`
// before every request and commit, so an older QR scan can never
// overwrite state belonging to a newer one.
// ============================================================

export type EntryPhase =
  | 'INITIALIZING'
  | 'VALIDATING_QR'
  | 'LOADING_RESTAURANT'
  | 'LOADING_CATALOG'
  | 'RETRYING'
  | 'READY'
  | 'INVALID'
  | 'RECOVERY';

export type EntryInvalidReason = 'qr' | 'restaurant';

export interface EntryApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/** Shape of `api.createTableSession(...).data` (see src/services/api.ts). */
export interface EntrySessionData {
  session: { id: string; sessionToken: string; [key: string]: unknown };
  table: { id: string; tableNumber: number; [key: string]: unknown };
  restaurant: { id: string; name?: string; slug?: string; logo?: string; [key: string]: unknown };
}

/** Shape of `api.getPublicRestaurantBySlug(...).data`. */
export interface EntryCatalogData {
  restaurant: { id: string; [key: string]: unknown };
  categories: unknown[];
  products: unknown[];
  offers: unknown[];
  tables?: unknown[];
}

export interface EntryApiAdapter {
  createTableSession(token: string, slug?: string): Promise<EntryApiResponse<EntrySessionData>>;
  getCatalog(slug: string, qrToken?: string): Promise<EntryApiResponse<EntryCatalogData>>;
}

export interface EntryRunHooks {
  /** True once a NEWER entry run has started — this run must stop committing. */
  isStale(): boolean;
  /** Injectable delay (tests substitute a no-op recorder). */
  wait(ms: number): Promise<void>;
  /** Phase transitions for the UI. Never called after the run goes stale. */
  onPhase?(phase: EntryPhase): void;
  /** Tenant identity became available (session created) — lets the loader brand itself. */
  onIdentity?(restaurant: EntrySessionData['restaurant']): void;
}

export type EntryOutcome =
  | { outcome: 'READY'; session: EntrySessionData | null; catalog: EntryCatalogData; qrToken: string | null }
  | { outcome: 'INVALID'; reason: EntryInvalidReason }
  | { outcome: 'RECOVERY' }
  | { outcome: 'STALE' };

/** Bounded recovery: initial attempt + 2 retries, then RECOVERY. */
export const ENTRY_MAX_ATTEMPTS = 3;
/** Backoff between attempts (ms). Deliberately short — guests are waiting. */
export const ENTRY_RETRY_DELAYS_MS: readonly number[] = [500, 1000];

/** Sentinel thrown internally when the run is superseded. Never leaks out. */
class EntryStaleError extends Error {
  constructor() {
    super('entry-run-stale');
  }
}

type Verdict =
  | { kind: 'ok' }
  | { kind: 'transient' }
  | { kind: 'permanent'; reason: EntryInvalidReason };

function classifySessionResponse(res: EntryApiResponse<EntrySessionData>): Verdict {
  if (res.success) return { kind: 'ok' };
  // Unknown/revoked QR token, or token that belongs to another venue.
  if (res.statusCode === 404 || res.statusCode === 400) return { kind: 'permanent', reason: 'qr' };
  // Venue exists but is not accepting guests right now.
  if (res.statusCode === 403) return { kind: 'permanent', reason: 'restaurant' };
  return { kind: 'transient' };
}

function classifyCatalogResponse(res: EntryApiResponse<EntryCatalogData>, hasQr: boolean): Verdict {
  if (res.success) return { kind: 'ok' };
  if (res.statusCode === 403) return { kind: 'permanent', reason: 'restaurant' };
  // Unknown venue link is permanent when the guest typed/followed a bare
  // slug. With a valid table session already in hand a 404 is an anomaly —
  // treat it as transient (retry, then RECOVERY; never blame the guest).
  if (res.statusCode === 404 && !hasQr) return { kind: 'permanent', reason: 'qr' };
  return { kind: 'transient' };
}

interface StageResult<T> {
  ok?: T;
  permanent?: EntryInvalidReason;
  exhausted?: boolean;
}

async function runStage<T>(
  phase: EntryPhase,
  attempt: () => Promise<EntryApiResponse<T>>,
  classify: (res: EntryApiResponse<T>) => Verdict,
  hooks: EntryRunHooks
): Promise<StageResult<T>> {
  for (let attemptIndex = 0; attemptIndex < ENTRY_MAX_ATTEMPTS; attemptIndex += 1) {
    if (hooks.isStale()) throw new EntryStaleError();
    hooks.onPhase?.(attemptIndex === 0 ? phase : 'RETRYING');
    let res: EntryApiResponse<T>;
    try {
      res = await attempt();
    } catch {
      // Network-level failure (offline, DNS, aborted) — transient by definition.
      res = { success: false, statusCode: 0 };
    }
    if (hooks.isStale()) throw new EntryStaleError();

    const verdict = classify(res);
    if (verdict.kind === 'ok') return { ok: res.data as T };
    if (verdict.kind === 'permanent') return { permanent: verdict.reason };

    const isLastAttempt = attemptIndex === ENTRY_MAX_ATTEMPTS - 1;
    if (isLastAttempt) return { exhausted: true };
    const delay = ENTRY_RETRY_DELAYS_MS[attemptIndex] ?? ENTRY_RETRY_DELAYS_MS[ENTRY_RETRY_DELAYS_MS.length - 1] ?? 1000;
    await hooks.wait(delay);
  }
  return { exhausted: true };
}

/**
 * Parse the customer entry intent out of the current URL.
 *
 *   /r/{slug}[?qr=…]         -> { slug, qrToken }
 *   /?r={slug} | ?restaurant= | ?slug=
 *   /?qr=… | ?table= | ?t= | ?tableId=   -> { slug: '', qrToken }
 *   /                        -> { slug: '', qrToken: '' }  (no customer entry)
 *
 * A bare `/` visit is the platform landing page: it must NOT be coerced into
 * a default venue slug, otherwise every root visit fires a fake customer
 * QR/entry request. Legacy brand aliases still map to the canonical slug.
 */
export function parseCustomerEntryUrl(
  location: { pathname: string; search: string } | null | undefined
): { slug: string; qrToken: string } {
  if (!location) return { slug: '', qrToken: '' };
  const params = new URLSearchParams(location.search || '');
  const pathMatch = (location.pathname || '').match(/\/r\/([a-zA-Z0-9_-]+)/);
  let slug = (
    pathMatch?.[1] ||
    params.get('r') ||
    params.get('restaurant') ||
    params.get('slug') ||
    ''
  ).toLowerCase();
  if (slug === 'marer' || slug === 'merar') slug = 'mureeh';
  const qrToken = params.get('qr') || params.get('table') || params.get('t') || params.get('tableId') || '';
  return { slug, qrToken };
}

/**
 * Merge a (possibly partial) restaurant identity payload into the restaurant
 * already in state. A field the incoming payload does not carry — or carries
 * as `undefined` / `null` / `''` / `[]` — must never erase a value that is
 * already known (theme colors, cover, logo framing, gallery, map…). When the
 * incoming identity is a DIFFERENT venue, nothing of the old one is kept.
 */
export function mergeRestaurantIdentity<T extends { id: string }>(
  prev: T | null,
  incoming: Partial<T> & { id?: string }
): T {
  if (!prev || (incoming.id && incoming.id !== prev.id)) {
    return incoming as T;
  }
  const merged: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (empty && key in merged) continue;
    merged[key] = value;
  }
  return merged as T;
}

export interface EntryInput {
  slug: string;
  /** Opaque table capability token; empty/undefined = direct venue link (browse-only). */
  qrToken?: string;
}

/**
 * Run one customer entry attempt. RESOLVES for every terminal state —
 * it never rejects (except for internal stale aborts, which it converts
 * to `{ outcome: 'STALE' }`), so callers can drive UI purely off the
 * returned outcome.
 *
 * READY is only ever returned when the catalog request genuinely
 * completed successfully. An empty product list with a successful
 * response is a legitimate READY (the venue truly published nothing);
 * an empty list caused by a failed request is RECOVERY, never READY.
 */
export async function runCustomerEntry(
  input: EntryInput,
  api: EntryApiAdapter,
  hooks: EntryRunHooks
): Promise<EntryOutcome> {
  try {
    hooks.onPhase?.('INITIALIZING');
    const slug = input.slug;
    const qrToken = input.qrToken && input.qrToken !== 'default' ? input.qrToken : '';
    const hasQr = qrToken.length > 0;

    let session: EntrySessionData | null = null;
    if (hasQr) {
      const sessionStage = await runStage(
        'VALIDATING_QR',
        () => api.createTableSession(qrToken, slug || undefined),
        classifySessionResponse,
        hooks
      );
      if (sessionStage.permanent) return { outcome: 'INVALID', reason: sessionStage.permanent };
      if (sessionStage.exhausted || sessionStage.ok === undefined) return { outcome: 'RECOVERY' };
      session = sessionStage.ok;
      if (session && hooks.onIdentity) hooks.onIdentity(session.restaurant);
    }

    // A QR-only link carries no slug in the URL; the venue is whatever the
    // validated table session resolved to (never a hard-coded default).
    const catalogSlug = slug || (typeof session?.restaurant?.slug === 'string' ? session.restaurant.slug : '');
    if (!catalogSlug) return { outcome: 'INVALID', reason: 'restaurant' };

    hooks.onPhase?.(hasQr ? 'LOADING_CATALOG' : 'LOADING_RESTAURANT');
    const catalogStage = await runStage(
      hasQr ? 'LOADING_CATALOG' : 'LOADING_RESTAURANT',
      () => api.getCatalog(catalogSlug, hasQr ? qrToken : undefined),
      (res) => classifyCatalogResponse(res, hasQr),
      hooks
    );
    if (catalogStage.permanent) return { outcome: 'INVALID', reason: catalogStage.permanent };
    if (catalogStage.exhausted || catalogStage.ok === undefined) return { outcome: 'RECOVERY' };

    return { outcome: 'READY', session, catalog: catalogStage.ok, qrToken: hasQr ? qrToken : null };
  } catch (err) {
    if (err instanceof EntryStaleError) return { outcome: 'STALE' };
    // A truly unexpected bug inside orchestration must never surface
    // technical detail to the guest — degrade to the safe recovery state.
    return { outcome: 'RECOVERY' };
  }
}
