// ============================================================
// Subscription expiration lifecycle (callable service).
//
// No cron is wired into the running app (minimal-change rule): entitlement
// checks evaluate the effective status lazily on every request, so expired
// plans lose paid features even if this service is never invoked. This
// service PERSISTS the status transitions (ACTIVE -> PAST_DUE -> CANCELLED,
// TRIAL -> CANCELLED) and records audit events; run it from a Render Cron
// Job, an operator CLI (`npm run subscriptions:expire`) or any scheduler.
//
// Idempotent: re-running it changes nothing when nothing is due.
// ============================================================

import { PrismaClient, TenantRole } from '@prisma/client';
import {
  DEFAULT_PAST_DUE_GRACE_DAYS,
  dueStatusTransition,
} from './plans';
import { logAuditEvent } from './audit';

export interface ExpiryResult {
  scanned: number;
  markedPastDue: string[];
  cancelled: string[];
  graceDays: number;
}

export async function processExpiringSubscriptions(
  db: PrismaClient | Pick<
    PrismaClient,
    'subscription' | 'auditLog'
  >,
  options: { now?: Date; graceDays?: number; dryRun?: boolean } = {}
): Promise<ExpiryResult> {
  const now = options.now ?? new Date();
  const graceDays = options.graceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS;
  const dryRun = options.dryRun ?? false;

  // Only rows that can still expire need to be examined.
  const rows = await db.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
    select: {
      id: true,
      restaurantId: true,
      status: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
    },
  });

  const result: ExpiryResult = {
    scanned: rows.length,
    markedPastDue: [],
    cancelled: [],
    graceDays,
  };

  for (const sub of rows) {
    const transition = dueStatusTransition(sub, now, graceDays);
    if (!transition) continue;

    if (!dryRun) {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: transition, updatedAt: now },
      });
      await logAuditEvent({
        restaurantId: sub.restaurantId,
        actor: 'SYSTEM_SCHEDULER',
        actorRole: TenantRole.PLATFORM_ADMIN,
        action:
          transition === 'PAST_DUE'
            ? 'SUBSCRIPTION_MARKED_PAST_DUE'
            : 'SUBSCRIPTION_CANCELLED_AFTER_GRACE',
        entity: 'Subscription',
        entityId: sub.id,
        details:
          transition === 'PAST_DUE'
            ? `انتهت الفترة المدفوعة للمطعم ${sub.restaurantId} — فترة سماح ${graceDays} أيام قبل إلغاء المزايا`
            : `انتهت فترة السماح للمطعم ${sub.restaurantId} — أُلغيت المزايا المدفوعة وعُاد للحدود المجانية`,
        metadata: { graceDays, transitionedAt: now.toISOString() },
      });
    }

    if (transition === 'PAST_DUE') result.markedPastDue.push(sub.id);
    else result.cancelled.push(sub.id);
  }

  return result;
}
