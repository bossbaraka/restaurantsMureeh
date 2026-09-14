/**
 * Test-harness-only vitest config for the LIVE PREVIEW (not product code, not
 * picked up by `npm test`):
 *
 *   npx vitest run --config e2e/live-preview/vitest.live.config.ts
 *
 * It renders the real application in jsdom against the in-memory world in
 * `./world.ts` and writes the captured scenes to `./scenes.html`.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['e2e/live-preview/order-lifecycle.check.tsx'],
    testTimeout: 120_000,
    // The story is one ordered run: no parallelism, no shuffling.
    pool: 'forks',
    maxWorkers: 1,
    sequence: { shuffle: false },
  },
});
