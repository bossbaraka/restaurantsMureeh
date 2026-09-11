import { Response } from 'express';

// ============================================================
// Server-Sent-Events connection registry.
//
// Hardening (resource-exhaustion / slow-loris):
//  - GLOBAL_MAX_CLIENTS: absolute process cap.
//  - MAX_PER_TENANT:     one restaurant can never consume the whole
//                        registry (noisy-neighbour / malicious tenant cap).
//  - MAX_PER_SUBJECT:    one QR session token OR one staff user may only hold
//                        a handful of concurrent streams. Without this cap a
//                        single browser/script (or a tight reconnect loop)
//                        could open thousands of EventSource connections.
//
// Every client is removed on response `close`/`finish`/`error`, so disconnects
// always free their slot in all three buckets. Counts are derived from the
// single client list on every admit, which can never drift out of sync.
// ============================================================

interface Client {
  id: string;
  restaurantId: string;
  tableId?: string;
  /**
   * Identity bucket for the per-session cap:
   *   guests -> `qr:<tableSessionToken>`, staff -> `staff:<userId>`.
   */
  subject?: string;
  res: Response;
}

export type SseRejectReason = 'global' | 'tenant' | 'subject';
export type AddClientResult =
  | { accepted: true }
  | { accepted: false; reason: SseRejectReason };

const GLOBAL_MAX_CLIENTS = 2000;
const MAX_PER_TENANT = 150;
// A guest phone holds one stream; staff a few screens (POS/KDS/manager).
// 10 comfortably covers legitimate multi-tab use, blocks connection floods.
const MAX_PER_SUBJECT = 10;

export class RealtimeService {
  private clients: Client[] = [];

  public addClient(client: Client): AddClientResult {
    if (this.clients.length >= GLOBAL_MAX_CLIENTS) {
      return { accepted: false, reason: 'global' };
    }
    if (
      this.clients.filter((c) => c.restaurantId === client.restaurantId).length >=
      MAX_PER_TENANT
    ) {
      return { accepted: false, reason: 'tenant' };
    }
    if (
      client.subject &&
      this.clients.filter(
        (c) =>
          c.subject === client.subject &&
          c.restaurantId === client.restaurantId
      ).length >= MAX_PER_SUBJECT
    ) {
      return { accepted: false, reason: 'subject' };
    }

    this.clients.push(client);

    // Cleanup on every terminal response event (normal disconnect, server
    // close, network error). Registered once; all paths lead to removal.
    const cleanup = () => this.removeClient(client.id);
    client.res.on('close', cleanup);
    client.res.on('finish', cleanup);
    client.res.on('error', cleanup);

    return { accepted: true };
  }

  public removeClient(id: string) {
    this.clients = this.clients.filter((c) => c.id !== id);
  }

  /** Test/diagnostics: live connection count (optionally per tenant). */
  public clientCount(restaurantId?: string): number {
    if (!restaurantId) return this.clients.length;
    return this.clients.filter((c) => c.restaurantId === restaurantId).length;
  }

  public broadcastToRestaurant(restaurantId: string, event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients
      .filter((c) => c.restaurantId === restaurantId)
      .forEach((c) => {
        try {
          c.res.write(payload);
        } catch {
          this.removeClient(c.id);
        }
      });
  }

  /**
   * Table-scoped broadcast. Guest streams are bound to a tableId and only
   * receive that table's events; staff streams (no tableId) receive the whole
   * tenant stream. A guest for table A can therefore never observe table B's
   * order/payment events.
   */
  public broadcastToTable(restaurantId: string, tableId: string, event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients
      .filter((c) => c.restaurantId === restaurantId && (!c.tableId || c.tableId === tableId))
      .forEach((c) => {
        try {
          c.res.write(payload);
        } catch {
          this.removeClient(c.id);
        }
      });
  }
}

export const realtimeService = new RealtimeService();
export { GLOBAL_MAX_CLIENTS, MAX_PER_TENANT, MAX_PER_SUBJECT };
