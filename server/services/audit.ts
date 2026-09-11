import { prisma } from '../db/prisma';
import { TenantRole } from '@prisma/client';

export async function logAuditEvent(params: {
  restaurantId?: string | null;
  userId?: string | null;
  actor: string;
  actorRole: TenantRole;
  action: string;
  entity?: string;
  entityId?: string;
  details: string;
  metadata?: any;
  /** Client IP as resolved by Express behind the trusted proxy (req.ip). */
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        restaurantId: params.restaurantId || null,
        userId: params.userId || null,
        actor: params.actor,
        actorRole: params.actorRole,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        details: params.details,
        metadata: params.metadata || undefined,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}
