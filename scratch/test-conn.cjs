const { PrismaClient } = require('@prisma/client');

async function test(name, url) {
  console.log(`Testing ${name}...`);
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const res = await p.restaurant.findMany({ select: { id: true, name: true, slug: true } });
    console.log(`[${name}] SUCCESS! Restaurants:`, res);
    return { success: true, url, res };
  } catch(e) {
    console.error(`[${name}] FAIL:`, e.message);
    return { success: false, error: e.message };
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  await test('direct-5432', 'postgresql://postgres.uhfdkcaxftcctnitqjvo:16112004Abodybaraka@db.uhfdkcaxftcctnitqjvo.supabase.co:5432/postgres?sslmode=require');
  await test('pooler-6543', 'postgresql://postgres.uhfdkcaxftcctnitqjvo:16112004Abodybaraka@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require');
}

main();
