/**
 * Test-harness-only vitest config (not product code, not picked up by
 * `npm test`). Runs the behavioural frontend permission checks against the
 * real AuthProvider in a jsdom environment:
 *
 *   npx vitest run --config e2e/vitest.guard.config.ts
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['e2e/frontend-guard.check.tsx'],
  },
});
