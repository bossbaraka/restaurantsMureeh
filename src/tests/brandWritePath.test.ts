import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Finding #1 — Restaurant.primaryColor/accentColor are LEGACY COMPATIBILITY
// fields derived from Theme.config (single derived sync on PUT /manager/theme).
// The branding form must not be able to overwrite them with its stale
// hydration snapshot (the proven race: dirty form → theme save syncs the
// columns → form save writes the old colors back). This guard pins:
//   1. api.saveBranding's payload carries NO color keys (W2 removed).
//   2. The THEME save still seeds the theme payload with the legacy fallback
//      (the read direction of the compat contract — untouched).
//   3. The server schema keeps the color keys OPTIONAL — the client-side
//      omission must never start failing validation.
// ============================================================================

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const brandingView = read('../components/manager/BrandingSettingsView.tsx');
const schemas = read('../../server/validation/schemas.ts');

function handleSavePayload(): string {
  const fnStart = brandingView.indexOf('const handleSave = async');
  const fnEnd = brandingView.indexOf('// ==== Theme Save ====', fnStart);
  const fn = brandingView.slice(fnStart, fnEnd);
  const callStart = fn.indexOf('api.saveBranding(');
  const callEnd = fn.indexOf('setIsSaving(false)', callStart);
  return fn.slice(callStart, callEnd);
}

describe('branding form save no longer writes the legacy brand columns', () => {
  it('api.saveBranding payload carries no primaryColor/accentColor', () => {
    const payload = handleSavePayload()
      // Strip the intent comment lines — assert on CODE, not prose.
      .replace(/^\s*\/\/.*$/gm, '');
    expect(payload).toContain('api.saveBranding(');
    expect(payload).not.toMatch(/\bprimaryColor\b/);
    expect(payload).not.toMatch(/\baccentColor\b/);
  });

  it('the document intent comment sits in the payload (guarded removal, not drift)', () => {
    expect(handleSavePayload()).toContain('DELIBERATELY NOT sent');
  });

  it('theme save keeps the legacy-fallback seed (read direction preserved)', () => {
    expect(brandingView).toContain('toServerThemePayload(editConfig, { primaryColor, accentColor })');
  });

  it('server schema keeps branding colors optional (omission must stay valid)', () => {
    const defStart = schemas.indexOf('const hexColor = z');
    const defEnd = schemas.indexOf('export const strongPassword', defStart);
    const hexColorDef = schemas.slice(defStart, defEnd);
    expect(hexColorDef).toContain('.optional()');
  });

  it('exactly one alpha-enabled field exists (the overlay) — semantic fields stay HEX6', () => {
    const matches = brandingView.match(/allowAlpha/g) || [];
    expect(matches).toHaveLength(1);
  });
});
