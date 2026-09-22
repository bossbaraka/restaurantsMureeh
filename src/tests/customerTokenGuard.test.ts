/**
 * PHASE 4 GUARD — the customer visual layer consumes canonical `--m-*` tokens.
 *
 * WHAT THIS PREVENTS
 * ------------------
 * The customer UI used to paint itself from the fixed `luxury-*` dark ramp and
 * the tenant `--brand-*` aliases. That is why a light restaurant theme still
 * rendered dark panels: `bg-luxury-950` is literally `#0A0B0D` regardless of
 * mode or tenant. Those usages are now migrated, and this guard keeps them
 * from coming back.
 *
 * WHY IT IS NOT "NO # ANYWHERE"
 * -----------------------------
 * A naive rule makes legitimate code impossible. Colours are classified by
 * what they DO:
 *
 *   - Canvas / rasterization  A <canvas> 2D context cannot read CSS custom
 *                             properties, so it must use resolved values.
 *   - Illustration / loading  Self-contained decorative components that do not
 *                             represent restaurant theming.
 *   - Documented exemption    An explicit `THEME-EXEMPT` marker with a reason.
 *   - Comments                Prose describing colours is not styling.
 *
 * Everything else must consume a semantic token.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CUSTOMER_DIR = path.resolve(process.cwd(), 'src/components/customer');

/**
 * Files exempt from the hardcoded-colour rule, each with a recorded reason.
 * Adding an entry is a deliberate, reviewable act.
 */
const COLOR_EXEMPT_FILES: Record<string, string> = {
  'CustomerLoadingExperience.tsx':
    'Canvas: paints the loading animation via ctx.fillStyle, which cannot read CSS variables.',
  'customerLoadingExperience.css':
    'Illustration: a self-contained loading experience with its own fixed art direction.',
  'LuxuryWelcomeScreen.tsx':
    'Canvas: the splash is drawn into a <canvas>; colours come from the pure buildBrandTokens derivation.',
};

function customerFiles(ext: RegExp): string[] {
  return fs
    .readdirSync(CUSTOMER_DIR)
    .filter((f) => ext.test(f))
    .map((f) => path.join(CUSTOMER_DIR, f));
}

/** Source with comments removed — prose about colours is not styling. */
function code_from(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function code(file: string): string {
  return code_from(fs.readFileSync(file, 'utf8'));
}

const tsxFiles = customerFiles(/\.tsx$/);

describe('customer layer consumes canonical semantic tokens', () => {
  it('has customer components to check', () => {
    expect(tsxFiles.length).toBeGreaterThan(15);
  });

  it('no customer component uses the fixed luxury-* / gold-* platform ramps', () => {
    // These are PLATFORM palettes: fixed dark greys and a fixed gold. They
    // cannot respond to restaurant theme or light mode, which is exactly the
    // leak this phase removed. Platform/admin code may still use them.
    const offenders = tsxFiles
      .map((f) => [path.basename(f), code(f).match(/\b[a-z-]*(?:luxury|gold)-\d+\b/g) ?? []] as const)
      .filter(([, hits]) => hits.length > 0);
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it('no customer component consumes legacy token families', () => {
    // --brand-* / --theme-* / --menu-* remain defined as compatibility
    // aliases, but nothing in the customer layer may read them any more.
    const offenders = tsxFiles
      .map(
        (f) =>
          [path.basename(f), code(f).match(/var\(\s*--(?:brand|theme|menu)-[a-z-]+/g) ?? []] as const
      )
      .filter(([, hits]) => hits.length > 0);
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it('no semantic token is consumed with a hardcoded fallback', () => {
    // `var(--m-brand, #D4AF37)` moves the problem instead of solving it: the
    // fallback silently wins whenever the provider fails to emit the token,
    // hiding the bug. The provider guarantees presence (asserted below), so
    // consumers must not carry a colour fallback.
    const offenders = tsxFiles
      .map(
        (f) =>
          [
            path.basename(f),
            code(f).match(/var\(\s*--m-[a-z-]+\s*,\s*(?:#|rgb|hsl)[^)]*\)/g) ?? [],
          ] as const
      )
      .filter(([, hits]) => hits.length > 0);
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it('no hardcoded colour values outside classified exemptions', () => {
    const offenders: Record<string, string[]> = {};
    for (const file of tsxFiles) {
      const name = path.basename(file);
      if (COLOR_EXEMPT_FILES[name]) continue;
      // Exemption is resolved on the RAW source, because code() strips
      // comments and would remove the markers first. Rule: a THEME-EXEMPT
      // marker exempts the colours on its own line and on the next
      // non-blank line, so a marker may sit directly above the value.
      const raw = fs.readFileSync(file, 'utf8').split('\n');
      const exempt = new Set<number>();
      raw.forEach((line, i) => {
        if (!line.includes('THEME-EXEMPT')) return;
        exempt.add(i);
        for (let j = i + 1; j < raw.length; j += 1) {
          if (!raw[j].trim()) continue;
          exempt.add(j);
          break;
        }
      });
      const body = code_from(raw.filter((_, i) => !exempt.has(i)).join('\n'));

      // Strip legitimate token references FIRST — `rgb(var(--m-x) / 0.5)` is
      // correct usage. Removing just the reference (not the whole line) keeps
      // a real literal on the same line detectable, which an earlier version
      // of this guard missed: a hardcoded gold glow sat beside a token ref.
      const scanned = body.replace(/\b(?:rgba?|hsla?)\(\s*var\(--m-[a-z-]+\)[^)]*\)/g, '');
      // Neutral black/white shadow & scrim values are an ELEVATION effect,
      // not restaurant theming: a shadow is the absence of light and stays
      // neutral in both light and dark mode. Tokenising them would imply a
      // tenant-tinted shadow, which is not the design. Only pure
      // black/white-with-alpha qualifies; any other colour still fails.
      const withoutNeutralShadows = scanned.replace(
        /(?:box-)?shadow-\[[^\]]*\]|drop-shadow-\[[^\]]*\]/g,
        (m) => (/rgba?\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)[\s\d.,]*\)/.test(m) ? '' : m)
      );
      const hits = [
        ...(withoutNeutralShadows.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
        // NOTE: no \b before the function name. Tailwind arbitrary values join
        // tokens with underscores (`shadow-[0_0_8px_rgba(212,175,55,0.5)]`),
        // and `_` is a word character, so a leading \b silently skipped every
        // colour hidden inside an arbitrary value — a real leak escaped that way.
        ...(withoutNeutralShadows.match(/(?:rgba?|hsla?)\([\s\d.,%]+\)/g) ?? []),
      ];
      if (hits.length) offenders[name] = hits;
    }
    expect(offenders).toEqual({});
  });

  it('every exemption records a reason', () => {
    for (const [file, reason] of Object.entries(COLOR_EXEMPT_FILES)) {
      expect(fs.existsSync(path.join(CUSTOMER_DIR, file)), `${file} exists`).toBe(true);
      expect(reason.length, `${file} reason`).toBeGreaterThan(30);
    }
  });

  it('canvas paths stay pure — no CSS-variable reads in rasterization code', () => {
    // The rule is: DOM UI -> semantic CSS tokens, canvas -> pure resolved
    // values. Canvas code must not start reaching into the document.
    for (const name of ['CustomerLoadingExperience.tsx', 'LuxuryWelcomeScreen.tsx']) {
      const src = code(path.join(CUSTOMER_DIR, name));
      expect(src, name).not.toContain('getComputedStyle');
      expect(src, name).not.toContain('documentElement');
    }
  });

  it('the customer layer actually consumes --m-* tokens', () => {
    const consumers = tsxFiles.filter((f) => /(?:var\(--m-|-m-(?:bg|surface|text|hairline|brand))/.test(code(f)));
    // Migration is broad, not token-washing one file.
    expect(consumers.length).toBeGreaterThanOrEqual(15);
  });
});
