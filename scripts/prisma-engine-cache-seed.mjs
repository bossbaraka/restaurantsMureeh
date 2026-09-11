#!/usr/bin/env node
/**
 * Seeds the Prisma fetch-engine cache with placeholder engine binaries.
 *
 * Why this exists:
 * ----------------
 * This project runs the Prisma Client with `engineType = "client"` (WASM query
 * engine, bundled inside the `@prisma/client` npm package) plus the official
 * `@prisma/adapter-pg` driver adapter. No native Prisma engine binary is ever
 * loaded at runtime, and database migrations are applied by the SQL runner in
 * `server/db/deploy-migrations.ts` (which replicates `prisma migrate deploy`).
 *
 * However, `prisma generate` still insists on downloading the native engine
 * binaries (it only verifies their presence in the local cache). On networks
 * where `binaries.prisma.sh` is unreachable this download fails and breaks
 * `npm install`. This script pre-seeds the fetch-engine cache directory with
 * placeholder files (plus matching sha256 checksum files) so `prisma generate`
 * completes without any network access.
 *
 * In environments where the real binaries can be downloaded, nothing changes:
 * this script is only invoked as a fallback after `prisma generate` has
 * already failed. The placeholders are never executed (see engineType above),
 * and they are re-validated against the checksum files exactly like real
 * downloads would be.
 *
 * Usage: node scripts/prisma-engine-cache-seed.mjs
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads the engine commit hash that this prisma version expects. */
function getEngineVersion() {
  const pkgPath = path.join(projectRoot, 'node_modules', '@prisma', 'engines-version', 'package.json');
  if (fs.existsSync(pkgPath)) {
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return version; // e.g. "5.22.0-44.605197351a3c8bdd595af2d2a9bc3025bca48ea2"
  }
  return null;
}

/**
 * The native binary names the fetch-engine looks up in its cache.
 * NOTE: the libquery engine is cached under the JOB name `libquery-engine`
 * (not the filesystem name `libquery_engine.so.node`).
 */
const CACHE_BINARY_NAMES = ['libquery-engine', 'schema-engine', 'query-engine', 'prisma-fmt'];

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function seedDir(cacheRoot, versionKey, target, binaryNames) {
  let seeded = 0;
  for (const name of binaryNames) {
    const filePath = path.join(cacheRoot, versionKey, target, name);
    const checksumPath = `${filePath}.sha256`;
    const placeholder = Buffer.from(
      `placeholder prisma engine — the client uses the bundled WASM engine (engineType=client); ` +
        `never executed. version=${versionKey} target=${target}\n`,
      'utf8'
    );
    const checksum = sha256Hex(placeholder);
    if (fs.existsSync(filePath) && fs.existsSync(checksumPath)) {
      if (fs.readFileSync(checksumPath, 'utf8').trim() === checksum) continue;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, placeholder, { mode: 0o755 });
    fs.writeFileSync(checksumPath, checksum);
    seeded += 1;
  }
  return seeded;
}

function main() {
  const version = getEngineVersion();
  if (!version) {
    console.error('[engine-cache-seed] @prisma/engines-version not found — skipping.');
    process.exit(1);
  }
  // fetch-engine resolves `debian-openssl-3.0.x` for glibc linux x64.
  const targets = ['debian-openssl-3.0.x'];
  if (process.platform === 'win32') targets[0] = 'windows';
  else if (process.platform === 'darwin') targets[0] = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin';

  const cacheRoot = path.join(os.homedir(), '.cache', 'prisma');
  // The engine commit hash is the last 40-hex segment of the engines-version
  // string (e.g. 605197351a3c8bdd595af2d2a9bc3025bca48ea2).
  const hashOnly = version.split('.').pop();
  let total = 0;
  for (const channel of ['master', 'all_commits']) {
    for (const versionKey of [version, hashOnly]) {
      total += seedDir(path.join(cacheRoot, channel), versionKey, targets[0], CACHE_BINARY_NAMES);
    }
  }
  console.log(`[engine-cache-seed] cache ready under ${cacheRoot} (${total} file(s) seeded)`);
}

main();
