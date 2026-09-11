#!/usr/bin/env node
/**
 * TEST HARNESS SCAFFOLDING — not product code.
 *
 * The sandbox cannot download Prisma's native query engine (binaries.prisma.sh
 * is blocked), so the client in node_modules/.prisma/client was generated with
 * PRISMA_CLIENT_FORCE_WASM=1. A WASM client REQUIRES a driver adapter, but the
 * product constructs `new PrismaClient()` with no adapter. This script appends
 * a tiny, idempotent wrapper to the *generated artifact* (never to src/ or
 * server/) that injects a pg adapter when the caller did not supply one.
 *
 * Re-run it after ANY `npm install` / `prisma generate`:
 *     node e2e/patch-prisma-client.cjs
 *
 * The adapter/pg packages live outside the repo (in /tmp/e2e-deps) so a repo
 * `npm install` cannot prune them.
 */
const fs = require('node:fs');
const path = require('node:path');

const CLIENT = path.resolve(__dirname, '../node_modules/.prisma/client/index.js');
const MARKER = '__testAdapterInjected';

const block = `
;(function injectTestAdapter() {
  try {
    const Original = module.exports.PrismaClient;
    if (!Original || Original.${MARKER}) return;
    const ext = (name) => {
      try {
        return require('/tmp/e2e-deps/node_modules/' + name);
      } catch {
        return require(name);
      }
    };
    const { Pool } = ext('pg');
    const { PrismaPg } = ext('@prisma/adapter-pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.TEST_PG_POOL_MAX || 10),
    });
    const adapter = new PrismaPg(pool);
    const Wrapped = new Proxy(Original, {
      construct(target, args) {
        const opts = args[0] ?? {};
        if (opts.adapter) return new target(opts);
        return new target({ ...opts, adapter });
      },
    });
    Object.defineProperty(Wrapped, 'name', { value: 'PrismaClient' });
    Wrapped.${MARKER} = true;
    module.exports.PrismaClient = Wrapped;
    if (module.exports.default && module.exports.default.PrismaClient) {
      module.exports.default.PrismaClient = Wrapped;
    }
    console.log('[test-adapter] pg adapter injected into generated PrismaClient');
  } catch (err) {
    console.error('[test-adapter] injection failed:', err);
  }
})();
`;

let src = fs.readFileSync(CLIENT, 'utf8');
// strip any previous injection block so the script is idempotent
const start = src.indexOf(';(function injectTestAdapter()');
if (start !== -1) src = src.slice(0, start).replace(/\s+$/, '\n');

if (src.includes(MARKER)) {
  console.log('nothing to do — an injection is already present and could not be stripped');
  process.exit(0);
}

fs.writeFileSync(CLIENT, src + block);
console.log(`patched ${path.relative(process.cwd(), CLIENT)}`);
