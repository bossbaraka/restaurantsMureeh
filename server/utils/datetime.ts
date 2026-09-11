// ============================================================
// Date helpers for analytics.
//
// "Today" must mean the restaurant's own local day (venues run on
// Asia/Jerusalem by default), not the server's UTC day — an order placed at
// 11pm local would otherwise be attributed to the wrong day in the dashboard.
// ============================================================

/**
 * UTC Date for the start of the calendar day containing `date` in `timeZone`.
 * Falls back to UTC when the timezone string is invalid.
 */
export function startOfDayInTimezone(date: Date, timeZone?: string | null): Date {
  const tz = timeZone || 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = Number(p.value);
    }
    // Re-interpret the wall-clock midnight in UTC and then shift back by the
    // zone offset observed at that instant.
    let localMidnightAsUtc = Date.UTC(
      map.year,
      map.month - 1,
      map.day,
      0,
      0,
      0
    );
    const probe = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const probeParts = probe.formatToParts(new Date(localMidnightAsUtc));
    const pmap: Record<string, number> = {};
    for (const p of probeParts) {
      if (p.type !== 'literal') pmap[p.type] = Number(p.value) % 24;
    }
    const asUtcMs = Date.UTC(1970, 0, 1, pmap.hour, pmap.minute, pmap.second);
    const offsetMs = asUtcMs - Date.UTC(1970, 0, 1, 0, 0, 0);
    localMidnightAsUtc -= offsetMs;
    return new Date(localMidnightAsUtc);
  } catch {
    // Invalid IANA zone: fall back to UTC day boundary.
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
  }
}
