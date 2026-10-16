/**
 * Build-time prerender for the platform landing page.
 *
 * Runs AFTER `vite build` (see the `build` script in package.json):
 *   1. reads the freshly emitted `dist/index.html` SPA shell,
 *   2. injects the static landing mirror from
 *      `server/seo/landingPrerender.ts` into `<div id="root">`,
 *   3. writes the crawler-complete HTML back to `dist/index.html`.
 *
 * Why a build step and not a runtime-only fix
 * ============================================
 * Every deploy target publishes `dist/` as static files:
 * Vercel (`vercel.json` outputDirectory), Netlify (`publish = dist`)
 * and Render's static frontend service all serve the directory
 * verbatim — no Node process rewrites anything there. Rewriting the
 * file at build time makes the prerendered HTML the artifact every
 * CDN edge serves. The Express runtime handler
 * (`handlePrerenderedLanding`) re-applies the same injection as a
 * safety net for Node-served deploys whose dist/ predates this step.
 *
 * Safety
 * ======
 * The injection is idempotent (see `prerenderSpaShell`), so a rebuild
 * never nests content, and a missing mount point leaves the file
 * untouched instead of corrupting the build.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  isPrerendered,
  prerenderSpaShell,
} from '../seo/landingPrerender';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');

function main(): void {
  if (!existsSync(INDEX_PATH)) {
    console.warn(
      '⚠️  dist/index.html not found — skipping landing prerender. ' +
        'Run `vite build` first (the `build` script does this).',
    );
    process.exit(0);
  }

  const shell = readFileSync(INDEX_PATH, 'utf8');

  if (isPrerendered(shell)) {
    console.log('🔍  Landing page already prerendered — nothing to do.');
    return;
  }

  const prerendered = prerenderSpaShell(shell);

  if (prerendered === shell) {
    console.warn(
      '⚠️  <div id="root"></div> mount point not found in dist/index.html — ' +
        'landing prerender skipped (Vite output layout may have changed).',
    );
    process.exit(0);
  }

  writeFileSync(INDEX_PATH, prerendered, 'utf8');
  console.log(
    `🔍  Landing page prerendered into dist/index.html ` +
      `(+${(prerendered.length - shell.length).toLocaleString('en-US')} bytes of crawler-visible content)`,
  );
}

main();
