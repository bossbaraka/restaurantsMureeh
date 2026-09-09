import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import {
  SeedCredentialError,
  assertStrongSeedPassword,
  readSeedCredentials,
} from './seed-credentials';
import type {
  TenantManagerSeed,
  TenantManagerResult,
} from './seed-credentials';

// Re-exported so existing seed scripts keep a single import site.
export {
  SEED_MIN_PASSWORD_LENGTH,
  SeedCredentialError,
  assertStrongSeedPassword,
  readSeedCredentials,
} from './seed-credentials';
export type {
  TenantManagerSeed,
  TenantManagerResult,
} from './seed-credentials';

/**
 * Provisions a tenant manager from environment configuration.
 *
 * - Absent configuration  -> skipped (menu/table data still seeds).
 * - Account does not exist -> created with the configured password.
 * - Account already exists -> LEFT UNTOUCHED. passwordHash, role and status
 *   are never rewritten, so an operator's rotation or suspension survives
 *   every subsequent seed run.
 */
export async function provisionTenantManager(
  config: TenantManagerSeed
): Promise<TenantManagerResult> {
  const credentials = readSeedCredentials(
    config.emailVar,
    config.passwordVar,
    config.label
  );

  if (!credentials) {
    const reason =
      `${config.label}: no manager provisioned ` +
      `(${config.emailVar}/${config.passwordVar} not configured).`;
    console.warn(`⚠️  ${reason}`);
    return { status: 'skipped', reason };
  }

  const existing = await prisma.restaurantUser.findUnique({
    where: { email: credentials.email },
    select: { id: true },
  });

  if (existing) {
    // Deliberately a no-op on security fields. Re-running the seed must
    // not resurrect an old password or un-suspend a disabled account.
    console.log(
      `↩️  ${config.label}: manager account already exists — credentials left unchanged.`
    );
    return { status: 'preserved', userId: existing.id };
  }

  const created = await prisma.restaurantUser.create({
    data: {
      restaurantId: config.restaurantId,
      name: config.name,
      email: credentials.email,
      passwordHash: await bcrypt.hash(credentials.password, 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  console.log(`✅ ${config.label}: manager account created.`);
  return { status: 'created', userId: created.id };
}

/**
 * Guard for seed data that must never reach production (demo tenants,
 * sample menus, test accounts).
 *
 * Production is opt-OUT-proof: the flag alone is not enough, NODE_ENV must
 * also not be `production`. That way an operator who copies a staging env
 * file into production cannot accidentally seed demo tenants.
 */
export function isDemoSeedAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ALLOW_DEMO_SEED === '1';
}
