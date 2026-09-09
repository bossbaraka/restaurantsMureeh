const { PrismaClient } = require('@prisma/client');

async function test(name, url) {
  console.log(`Testing ${name}...`);
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const res = await p.restaurant.findMany({ select: { id: true, name: true, slug: true } });
    console.log(`[${name}] SUCCESS! Restaurants:`, res);
    return true;
  } catch(e) {
    console.error(`[${name}] FAIL:`, e.message);
    return false;
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  await test('encoded-5432', 'postgresql://postgres%2Euhfdkcaxftcctnitqjvo:16112004Abodybaraka@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true&sslmode=require');
  await test('encoded-6543', 'postgresql://postgres%2Euhfdkcaxftcctnitqjvo:16112004Abodybaraka@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require');
}

main();
