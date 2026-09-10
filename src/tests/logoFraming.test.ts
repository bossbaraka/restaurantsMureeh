import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Logo framing regression coverage.
 *
 * A manager uploads a logo and it used to be force-cropped (`object-cover`,
 * centered) inside a fixed square, so wide/horizontal or tall logos appeared
 * cut off. The fix persists two framing controls — `logoFit` (cover/contain)
 * and `logoPosition` (a 9-point object-position anchor) — and applies them to
 * every surface that renders the tenant logo.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const schema = read('../../prisma/schema.prisma');
const validation = read('../../server/validation/schemas.ts');
const brandingView = read('../components/manager/BrandingSettingsView.tsx');
const customerHeader = read('../components/customer/CustomerHeader.tsx');
const managerLayout = read('../components/manager/ManagerLayout.tsx');
const printMenu = read('../components/manager/PrintMenuModal.tsx');
const welcome = read('../components/customer/LuxuryWelcomeScreen.tsx');

describe('logo framing is stored and validated', () => {
  it('adds logoFit + logoPosition columns to the Restaurant model', () => {
    const model = schema.match(/model Restaurant \{[\s\S]*?\n\}/)?.[0] || '';
    expect(model).toMatch(/logoFit\s+String\s+@default\("cover"\)/);
    expect(model).toMatch(/logoPosition\s+String\s+@default\("50% 50%"\)/);
  });

  it('ships an idempotent migration for both columns', () => {
    const migrations = read('../../prisma/migrations/20260910180000_add_logo_position/migration.sql');
    expect(migrations).toMatch(/ADD COLUMN IF NOT EXISTS "logoFit"/);
    expect(migrations).toMatch(/ADD COLUMN IF NOT EXISTS "logoPosition"/);
  });

  it('restricts the values to cover/contain and a 9-point anchor grid', () => {
    expect(validation).toContain("z.enum(['cover', 'contain'])");
    expect(validation).toContain("'0% 0%', '50% 0%', '100% 0%'");
    expect(validation).toContain("'0% 100%', '50% 100%', '100% 100%'");
  });
});

describe('logo framing is honoured at render time', () => {
  it('exposes a fit toggle + position grid in branding settings', () => {
    expect(brandingView).toContain('setLogoFit');
    expect(brandingView).toContain('LOGO_POSITION_GRID');
    expect(brandingView).toContain('objectPosition: logoPosition');
  });

  it('sends the controls with the branding payload', () => {
    expect(brandingView).toContain('logoFit,');
    expect(brandingView).toContain('logoPosition,');
  });

  it('applies framing in the customer header, manager sidebar and print menu', () => {
    expect(customerHeader).toContain('objectPosition: currentRestaurant.logoPosition');
    expect(managerLayout).toContain('objectPosition: currentRestaurant.logoPosition');
    expect(printMenu).toContain('objectPosition: currentRestaurant.logoPosition');
    expect(welcome).toContain('objectPosition: currentRestaurant?.logoPosition');
  });
});
