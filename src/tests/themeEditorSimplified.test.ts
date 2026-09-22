/**
 * FINAL STEP — guards for the simplified Theme Editor.
 *
 * These are source-level contracts. They protect the two properties that make
 * the editor trustworthy: the manager is not shown engine internals, and the
 * preview cannot disagree with the real menu.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const fromRoot = (rel: string) => path.resolve(process.cwd(), rel);
const raw = (rel: string) => fs.readFileSync(fromRoot(rel), 'utf8');
/** Source with comments stripped — prose describing the old design is not code. */
const code = (rel: string) =>
  raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const VIEW = 'src/components/manager/BrandingSettingsView.tsx';
const PREVIEW = 'src/components/manager/ThemePreview.tsx';

describe('the primary editor exposes only the simplified model', () => {
  const view = code(VIEW);
  /** The theme tab up to the Advanced disclosure. */
  const primarySection = (): string => {
    const start = view.indexOf("activeTab === 'theme'");
    const advanced = view.indexOf('<details', start);
    expect(start, 'theme tab exists').toBeGreaterThan(-1);
    expect(advanced, 'advanced section exists').toBeGreaterThan(start);
    return view.slice(start, advanced);
  };

  it('offers the seven simple decisions', () => {
    const s = primarySection();
    expect(s).toContain('appearance:');   // light / dark / auto
    expect(s).toContain('primary:');      // brand
    expect(s).toContain('accent:');
    expect(s).toContain('THEME_PRESETS'); // preset
    expect(s).toContain('cardStyle:');
    expect(s).toContain('cornerStyle:');
    expect(s).toContain('font:');
    expect(s).toContain('density:');
  });

  it('does NOT expose derived engine values as primary controls', () => {
    const s = primarySection();
    // These are derived by the semantic engine; putting them up front is what
    // made the old editor unusable for a non-technical manager.
    for (const derived of [
      "'surface'",
      "'border'",
      "'textPrimary'",
      "'textSecondary'",
      "'success'",
      "'warning'",
      "'error'",
    ]) {
      expect(s, `${derived} must not be a primary control`).not.toContain(derived);
    }
    // No free-text CSS radius/shadow boxes in the primary screen.
    expect(s).not.toContain('editConfig.radius');
    expect(s).not.toContain('editConfig.shadows');
  });

  it('keeps Advanced collapsed by default', () => {
    // <details> without `open` is collapsed.
    const details = view.slice(view.indexOf('<details'), view.indexOf('</details>'));
    expect(details).toContain('<details');
    expect(details).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it('Advanced still exposes the low-level controls (capability preserved)', () => {
    const details = view.slice(view.indexOf('<details'), view.indexOf('</details>'));
    expect(details).toContain('editConfig.radius');
    expect(details).toContain('editConfig.shadows');
    expect(details).toContain("'success'");
    expect(details).toContain('ThemeColorField');
  });

  it('uses business language, not implementation terminology', () => {
    const s = primarySection();
    for (const jargon of ['CSS', 'token', 'HSL', 'RGB', 'variable', 'resolver', 'semantic']) {
      expect(s, `"${jargon}" must not be shown to the manager`).not.toContain(jargon);
    }
  });
});

describe('the preview uses the production pipeline', () => {
  const preview = code(PREVIEW);

  it('renders through CustomerThemeProvider and the shared derivation', () => {
    expect(preview).toContain('CustomerThemeProvider');
    expect(preview).toContain('toThemeConfig');
  });

  it('contains no second theme engine — no colour arithmetic of its own', () => {
    // The old preview built colours inline from the brand hex. Any of these
    // reappearing means the preview has started deriving its own palette and
    // can drift from the customer menu.
    expect(preview).not.toMatch(/linear-gradient\([^)]*\$\{/);
    expect(preview).not.toMatch(/\$\{[^}]*primary[^}]*\}[0-9A-Fa-f]{2}/);
    expect(preview).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(preview).not.toMatch(/\bluxury-\d+|\bgold-\d+/);
  });

  it('styles itself only from canonical customer tokens', () => {
    const vars = preview.match(/var\(--[a-z-]+\)/g) || [];
    expect(vars.length).toBeGreaterThan(10);
    for (const v of vars) {
      expect(v, 'preview must consume --m-* only').toMatch(/var\(--m-/);
    }
  });

  it('never writes global appearance', () => {
    expect(preview).not.toContain('documentElement');
    expect(preview).not.toContain('applyBrandTheme');
    expect(preview).not.toContain('applyEffectiveTheme');
  });

  it('the editor renders the shared preview instead of a bespoke one', () => {
    const view = code(VIEW);
    expect(view).toContain('<ThemePreview');
    // The old inline preview markers must be gone.
    expect(view).not.toContain('previewVars');
  });
});

describe('save behaviour and legacy compatibility are unchanged', () => {
  const view = code(VIEW);

  it('saving still goes through the Theme API', () => {
    expect(view).toContain('api.upsertTheme(');
    expect(view).toContain('toServerThemePayload(editConfig, { primaryColor, accentColor })');
  });

  it('no direct DOM theme writes were reintroduced', () => {
    for (const forbidden of [
      'applyBrandTheme',
      'applyEffectiveTheme',
      'documentElement.classList',
      'documentElement.style',
      'setProperty(',
    ]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
  });

  it('no polling-based theme refresh was introduced', () => {
    expect(view).not.toContain('setInterval');
  });

  it('presetId is never inferred from stored colours', () => {
    // Correction 3. The old code hex-matched primary/accent against the preset
    // table and fell back to a cached presetId.
    expect(view).not.toContain('getCachedBrandTheme');
    expect(view).not.toMatch(/THEME_PRESETS\.find\([^)]*primary\.toLowerCase/);
  });
});
