import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FREE_TRIAL_PLAN } from '../../server/services/plans';

/**
 * Plan binding & cost-bounding regression suite.
 *
 * Two guarantees are pinned here:
 *  1. Plan features are *bound to the plan* — entitlements and usage ceilings
 *     are enforced on the server, not just hinted at in the UI.
 *  2. The enterprise ("المؤسسات") plan is bounded, never "unlimited": tables,
 *     categories, products and branches all carry real hosting/QR/print cost,
 *     so an unbounded plan would let a tenant grow platform spend without
 *     limit. Every ceiling is a finite number.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const schema = read('../../prisma/schema.prisma');
const seed = read('../../server/db/seed.ts');
const managerRoutes = read('../../server/routes/manager.ts');
const subscriptionView = read('../components/manager/SubscriptionView.tsx');
const landingPage = read('../components/common/SaaSLandingPage.tsx');
const typesFile = read('../types/restaurant.ts');

describe('plan limits are a single bounded source of truth', () => {
  it('adds a maxBranches ceiling to the Plan model', () => {
    const planModel = schema.match(/model Plan \{[\s\S]*?\n\}/)?.[0] || '';
    expect(planModel).toMatch(/maxBranches\s+Int\s+@default\(\d+\)/);
  });

  it('ships an idempotent migration for the maxBranches column', () => {
    const migrations = read('../../prisma/migrations/20260910170000_add_plan_max_branches/migration.sql');
    expect(migrations).toMatch(/ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxBranches"/);
    // The migration backfills existing rows so a live deployment is bounded
    // even without re-seeding.
    expect(migrations).toMatch(/maxBranches" = 10/);
    expect(migrations).toMatch(/maxBranches" = 1/);
    expect(migrations).toMatch(/array_remove\("entitlements", 'CAN_UNLIMITED_TABLES'\)/);
  });

  it('keeps the free trial at a single venue', () => {
    expect(FREE_TRIAL_PLAN.maxBranches).toBe(1);
  });
});

describe('starter plan table ceiling', () => {
  it('allows up to 20 tables on the basic (starter) plan', () => {
    const starter = seed.match(/id: 'plan-starter',[\s\S]*?\n    \},/)?.[0] || '';
    expect(starter).toContain('maxTables: 20');
    expect(starter).not.toContain('maxTables: 15');
  });

  it('ships a migration that bumps existing starter rows to 20 tables', () => {
    const migrations = read('../../prisma/migrations/20260910190000_bump_starter_tables/migration.sql');
    expect(migrations).toMatch(/maxTables" = 20/);
    expect(migrations).toContain("'plan-starter'");
  });
});

describe('enterprise plan is bounded, not unlimited', () => {
  it('caps tables/categories/products/branches to finite numbers', () => {
    const enterprise = seed.match(/id: 'plan-enterprise',[\s\S]*?\n    \},/)?.[0] || '';
    expect(enterprise).toContain('maxTables: 200');
    expect(enterprise).toContain('maxCategories: 40');
    expect(enterprise).toContain('maxProducts: 500');
    expect(enterprise).toContain('maxBranches: 10');
    // The old sentinel "999" (a pretend-unlimited cap) must be gone.
    expect(enterprise).not.toContain('maxTables: 999');
    expect(enterprise).not.toContain('maxProducts: 999');
  });

  it('no longer grants a fake unlimited-tables entitlement', () => {
    const enterprise = seed.match(/id: 'plan-enterprise',[\s\S]*?\n    \},/)?.[0] || '';
    expect(enterprise).not.toContain('CAN_UNLIMITED_TABLES');
    // …and the client type no longer knows that dead key.
    expect(typesFile).not.toContain('CAN_UNLIMITED_TABLES');
  });

  it('stops advertising open/unlimited capacity to prospective tenants', () => {
    expect(landingPage).not.toContain('سعة مفتوحة');
    expect(subscriptionView).not.toContain('سعة مفتوحة');
    expect(subscriptionView).not.toContain('غير محدود');
  });
});

describe('features are server-enforced by the plan', () => {
  it('rejects branch creation past the plan branch ceiling', () => {
    const createBranch = managerRoutes.match(/router\.post\(\s*'\/branches'[\s\S]*?\n  \}\s*\n\);/)?.[0] || '';
    expect(createBranch).toContain('getPlanLimits(restaurantId)');
    expect(createBranch).toContain('limits.maxBranches');
    expect(createBranch).toContain('prisma.branch.count');
  });

  it('gates the analytics KPIs endpoint behind CAN_USE_ANALYTICS', () => {
    const stats = managerRoutes.match(/router\.get\('\/dashboard\/stats'[\s\S]*?\n\);/)?.[0] || '';
    expect(stats).toContain("restaurantHasEntitlement(restaurantId, 'CAN_USE_ANALYTICS')");
  });

  it('blocks a plan downgrade/change that exceeds the target plan limits (incl. branches)', () => {
    const changePlan = managerRoutes.match(/router\.put\(\s*'\/subscription\/plan'[\s\S]*?\n\);/)?.[0] || '';
    expect(changePlan).toContain('branchesCount > plan.maxBranches');
    expect(changePlan).toContain('prisma.branch.count');
  });

  it('surfaces the branch ceiling in the subscription usage meters', () => {
    expect(subscriptionView).toContain('currentPlan?.maxBranches');
    expect(subscriptionView).toContain('branches.length');
  });
});
