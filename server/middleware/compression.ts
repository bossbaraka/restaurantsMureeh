import compression from 'compression';
import type { Request, RequestHandler, Response } from 'express';

/**
 * Shared response-compression middleware.
 *
 * SSE must never be buffered by the compression layer: with gzip the stream
 * "connects" but no decompressed byte reaches the browser until the gzip
 * buffer fills — realtime events (KDS, waiter calls, order tracking) arrive
 * as 0 bytes (SEC-01 / P1-B). Exclude text/event-stream responses explicitly;
 * proxies are additionally hinted via X-Accel-Buffering on the SSE route
 * itself.
 *
 * Exported as a single configured instance so the server and the integration
 * tests exercise the SAME filter (no drift between prod config and tests).
 */
export const compressionMiddleware: RequestHandler = compression({
  filter: (req: Request, res: Response) => {
    const contentType = res.getHeader('Content-Type');
    if (
      typeof contentType === 'string' &&
      contentType.startsWith('text/event-stream')
    ) {
      return false;
    }
    if (
      Array.isArray(contentType) &&
      contentType[0]?.startsWith('text/event-stream')
    ) {
      return false;
    }
    return compression.filter(req, res);
  },
});
