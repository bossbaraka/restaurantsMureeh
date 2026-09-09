import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
// Static import: `assertStrongSeedPassword` is an assertion function, and TS
// requires those to be resolved statically (TS2775). seed-credentials is
// intentionally free of Prisma imports so this stays side-effect free.
import { assertStrongSeedPassword } from './seed-credentials';

dotenv.config();
const { prisma } = await import('./prisma');

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

/** Reads a password from env and refuses weak/leaked values. */
const requiredPassword = (name: string): string => {
  const value = required(name);
  assertStrongSeedPassword(value, name);
  return value;
};

const managers = [1, 2, 3]
  .map((number) => ({
    id: `user-manager-${number}`,
    name: process.env[`MANAGER_${number}_NAME`]?.trim(),
    email: process.env[`MANAGER_${number}_EMAIL`]?.trim().toLowerCase(),
    password: process.env[`MANAGER_${number}_PASSWORD`],
  }))
  .filter((manager) => manager.name && manager.email && manager.password);

// Reject weak/leaked manager passwords before any hashing happens.
for (const manager of managers) {
  assertStrongSeedPassword(manager.password as string, `MANAGER_*_PASSWORD (${manager.email})`);
}

const platformAdmin = {
  email: required('PLATFORM_ADMIN_EMAIL').toLowerCase(),
  password: requiredPassword('PLATFORM_ADMIN_PASSWORD'),
};

const run = async () => {
  const restaurant = await prisma.restaurant.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  if (!restaurant) {
    throw new Error('No active restaurant exists. Run the initial database seed first.');
  }

  // This script is the DELIBERATE credential-rotation tool, so overwriting
  // is intended here (unlike the seed, which must never touch existing
  // credentials — audit C-02). Rotating also bumps tokenVersion so every
  // previously issued JWT for the account is revoked immediately.
  await prisma.restaurantUser.upsert({
    where: { email: platformAdmin.email },
    update: {
      passwordHash: bcrypt.hashSync(platformAdmin.password, 12),
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
      tokenVersion: { increment: 1 },
    },
    create: {
      id: 'user-platform-admin',
      restaurantId: null,
      name: 'مدير المنصة',
      email: platformAdmin.email,
      passwordHash: bcrypt.hashSync(platformAdmin.password, 12),
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    },
  });

  for (const manager of managers) {
    await prisma.restaurantUser.upsert({
      where: { email: manager.email },
      update: {
        name: manager.name,
        restaurantId: restaurant.id,
        passwordHash: bcrypt.hashSync(manager.password, 12),
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
        tokenVersion: { increment: 1 },
      },
      create: {
        id: manager.id,
        restaurantId: restaurant.id,
        name: manager.name,
        email: manager.email,
        passwordHash: bcrypt.hashSync(manager.password, 12),
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });
  }

  console.log(`Provisioned platform admin and ${managers.length} restaurant managers.`);
};

run()
  .catch((error) => {
    console.error('Admin provisioning failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });