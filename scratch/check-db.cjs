const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, slug: true, _count: { select: { categories: true, products: true, tables: true } } }
  });
  console.log('Current Restaurants:', JSON.stringify(restaurants, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
