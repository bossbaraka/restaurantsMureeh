import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();
const { prisma } = await import('./prisma');

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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

const platformAdmin = {
  email: required('PLATFORM_ADMIN_EMAIL').toLowerCase(),
  password: required('PLATFORM_ADMIN_PASSWORD'),
};

const run = async () => {
  const restaurant = await prisma.restaurant.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  if (!restaurant) {
    throw new Error('No active restaurant exists. Run the initial database seed first.');
  }

  await prisma.restaurantUser.upsert({
    where: { email: platformAdmin.email },
    update: {
      passwordHash: bcrypt.hashSync(platformAdmin.password, 12),
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
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