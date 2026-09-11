/**
 * SSE connect helper with capped exponential backoff.
 *
 * Why this exists: when the server rejects a stream because a connection cap
 * is reached it responds HTTP 503 and closes. The native EventSource fires
 * `error` with `readyState === CLOSED` and does NOT reconnect on an HTTP error
 * status; the previous code also never retried in that case (only the slower
 * background polling kept data fresh). Naively recreating the EventSource
 * immediately would make every capped client hammer the server, so retries
 * back off exponentially (1s → 30s cap, with jitter).
 *
 * Transient network errors (readyState === CONNECTING) are left to the
 * browser's built-in reconnection; we only own the CLOSED case.
 */

export interface SseBackoffOptions {
  /** Base delay before the first manual reconnect (ms). Default 1000. */
  baseDelayMs?: number;
  /** Maximum delay between attempts (ms). Default 30000. */
  maxDelayMs?: number;
  /** Called once each time a connection becomes live (for tests/observability). */
  onOpen?: () => void;
}

export interface SseConnection {
  /** Permanently stop reconnecting and close any active stream. */
  close: () => void;
  /** Current reconnect attempt count (0 = first connection is live/pending). */
  readonly attempts: number;
}

export function openEventSourceWithBackoff(
  url: string,
  handlers: Record<string, (event: MessageEvent) => void>,
  options: SseBackoffOptions = {}
): SseConnection {
  const base = options.baseDelayMs ?? 1000;
  const max = options.maxDelayMs ?? 30_000;

  // Non-browser environments (tests/SSR) have no EventSource — degrade
  // silently; callers already run background polling.
  if (typeof globalThis === 'undefined' || typeof (globalThis as any).EventSource !== 'function') {
    return { close: () => {}, get attempts() { return 0; } };
  }

  const ES: typeof EventSource = (globalThis as any).EventSource;
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closedByCaller = false;
  let attempt = 0;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const connect = () => {
    if (closedByCaller) return;
    const stream = new ES(url);
    es = stream;

    stream.onopen = () => {
      attempt = 0;
      options.onOpen?.();
    };

    for (const [name, fn] of Object.entries(handlers)) {
      stream.addEventListener(name, fn as EventListener);
    }

    stream.onerror = () => {
      // CONNECTING = the browser is already retrying a transient network
      // error; do not duplicate that. CLOSED = fatal (e.g. HTTP 503 from the
      // connection limiter) — reconnect ourselves with backoff.
      if (stream.readyState !== ES.CLOSED) return;
      stream.close();
      if (es === stream) es = null;
      if (closedByCaller) return;

      const expo = Math.min(base * 2 ** attempt, max);
      const jitter = Math.floor(Math.random() * Math.min(1000, expo));
      const delay = expo + jitter;
      attempt += 1;
      clearTimer();
      timer = setTimeout(connect, delay);
    };
  };

  connect();

  return {
    close: () => {
      closedByCaller = true;
      clearTimer();
      if (es) {
        es.close();
        es = null;
      }
    },
    get attempts() {
      return attempt;
    },
  };
}
