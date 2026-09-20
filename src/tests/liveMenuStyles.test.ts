import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Style contract between the Live Menu components and `src/index.css`.
 * ====================================================================
 * The signage screen is styled with hand-written CSS (Tailwind cannot express
 * vmin typography, Ken Burns or the `--lm-*` identity tokens). A typo in a
 * class name — or a token emitted but never consumed — does not fail a build
 * or a type check: it silently renders an unreadable black screen on a TV.
 * So the contract is checked here.
 */

const root = resolve(__dirname, '../..');
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');

const COMPONENTS = [
  'src/components/display/LiveScenes.tsx',
  'src/components/display/LiveMenuStage.tsx',
  'src/components/display/LiveStaticMenu.tsx',
  'src/components/display/LiveReservation.tsx',
  'src/components/customer/DisplayMenu.tsx',
];

const sourceOf = (file: string) => readFileSync(resolve(root, file), 'utf8');

/** Every static class token the components ask for. */
const usedClasses = (): string[] => {
  const tokens = new Set<string>();
  for (const file of COMPONENTS) {
    const source = sourceOf(file);
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      raw
        .replace(/\$\{[^}]*\}/g, ' ') // conditional parts are asserted separately
        .split(/\s+/)
        .filter((token) => token.startsWith('display-menu') || token.startsWith('live-'))
        .forEach((token) => tokens.add(token));
    }
  }
  return [...tokens].sort();
};

/** Only the Live Menu block of `index.css` — the rest of the file is the
 * customer app's business, and its keyframes predate this work. */
const liveMenuCss = (): string => {
  const start = css.indexOf('.display-menu {');
  const end = css.indexOf('\n/* ====', start + 1);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end === -1 ? css.length : end);
};

/**
 * The body of every `@keyframes` block, matched by brace counting (the
 * stylesheet writes short keyframes on one line, so a lazy regex would
 * swallow the rules that follow them).
 */
const keyframeBodies = (cssText: string): [string, string][] => {
  const found: [string, string][] = [];
  for (const match of cssText.matchAll(/@keyframes\s+([a-z0-9-]+)\s*\{/gi)) {
    let depth = 1;
    let cursor = match.index! + match[0].length;
    while (cursor < cssText.length && depth > 0) {
      const char = cssText[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      cursor += 1;
    }
    found.push([match[1], cssText.slice(match.index! + match[0].length, cursor - 1)]);
  }
  return found;
};

/** Every `--lm-*` custom property the model emits onto the stage. */
const emittedTokens = (): string[] => {
  const source = sourceOf('src/components/display/liveMenuModel.ts');
  const names = new Set<string>();
  for (const match of source.matchAll(/'(--lm-[a-z0-9-]+)':/g)) names.add(match[1]);
  return [...names].sort();
};

describe('Live Menu ↔ index.css style contract', () => {
  const classes = usedClasses();

  it('finds a meaningful set of classes to check', () => {
    // Guards the guard: if the extraction silently matches nothing, the rest
    // of this file would pass for the wrong reason.
    expect(classes.length).toBeGreaterThan(40);
    expect(classes).toContain('display-menu');
  });

  it('defines a rule for every class the screen renders', () => {
    const missing = classes.filter((name) => !new RegExp(`\\.${name.replace(/[-]/g, '\\-')}(?![a-z0-9_-])`, 'i').test(css));
    expect(missing).toEqual([]);
  });

  it('keeps the signage system namespaced under .display-menu', () => {
    // Nothing in the Live Menu may reach for customer-menu classes: the two
    // experiences must stay visually separate.
    const offenders = COMPONENTS.flatMap((file) =>
      [...sourceOf(file).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
        .flatMap((m) => (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/))
        .filter((token) => token.startsWith('customer-menu') || token.startsWith('cart-'))
    );
    expect(offenders).toEqual([]);
  });

  it('consumes every identity token the model emits', () => {
    // A token is consumed by the stylesheet OR by an inline style in the
    // components (the dish-row stagger is set inline so it can scale per row).
    const inline = COMPONENTS.map(sourceOf).join('\n');
    const emitted = emittedTokens();
    const unused = emitted.filter(
      (name) => !css.includes(`var(${name}`) && !inline.includes(`var(${name}`)
    );
    expect(emitted.length).toBeGreaterThan(15);
    expect(unused).toEqual([]);
  });

  it('animates only compositor-friendly properties', () => {
    // Signage runs for hours: no `transition: all`, and keyframes may only
    // touch properties a TV panel can composite or repaint cheaply.
    expect(liveMenuCss()).not.toMatch(/transition:\s*all/);

    const allowed = new Set([
      'transform',
      'opacity',
      'filter',
      'background',
      'background-color',
      'background-position',
      'color',
      'border-color',
      'box-shadow',
      'clip-path',
    ]);
    for (const [name, body] of keyframeBodies(liveMenuCss())) {
      const props = [...body.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/gm)].map((m) => m[1]);
      expect(props.length, `keyframes ${name} should animate something`).toBeGreaterThan(0);
      expect(
        props.filter((prop) => !allowed.has(prop)),
        `keyframes ${name}`
      ).toEqual([]);
    }
  });
});
