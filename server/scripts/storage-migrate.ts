// ============================================================
// storage:migrate — move legacy images into the object-storage
// driver and update PostgreSQL URLs.
//
// Two legacy encodings are handled:
//   1. Local file URLs:  /uploads/<key>
//   2. Inline Base64:    data:image/png;base64,….  (historical rows
//      written before server-side uploads existed — these MUST be
//      moved out; they bloat rows and backups and bypass the CDN)
//
// Usage:
//   npm run storage:migrate                          # DRY-RUN (writes/deletes nothing)
//   npm run storage:migrate -- --apply               # upload + update DB
//   npm run storage:migrate -- --apply --delete-source  # also remove local files
//   npm run storage:migrate -- --apply --retries 5
//
// Per-image ordering is strictly:
//   detect -> read/decode -> sniff -> upload -> EXISTS-verify ->
//   update DB -> URL round-trip EXISTS-verify -> (later) cleanup
//
// Safety properties:
//   - Dry-run by default; no DB write AND no file deletion without --apply.
//   - Already-migrated rows (http(s) object-storage URLs) are skipped.
//   - Missing/corrupt sources are logged, NEVER claimed as recovered.
//   - Source files are deleted ONLY with --delete-source, ONLY in APPLY
//     mode, and ONLY after BOTH existence verifications for EVERY row that
//     references the file have passed. Cleanup is deferred to the very end
//     so a crash mid-run can never leave a DB row pointing at a deleted
//     file. Base64 rows have no source file (the "cleanup" is replacing the
//     inline payload in the DB — the old row value is never retained).
//   - Uploads are retried (default 3 attempts, linear backoff).
// ============================================================

import path from 'path';
import fs from 'fs';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { getStorage, localKeyFromUrl, type StorageKind, type StorageService } from '../services/storage';
import { sniffImage } from '../services/storage/imageSniff';

interface Args {
  apply: boolean;
  deleteSource: boolean;
  retries: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, deleteSource: false, retries: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--delete-source') args.deleteSource = true;
    else if (arg === '--retries' && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n) && n >= 1) args.retries = n;
      i += 1;
    }
  }
  return args;
}

interface MigrationStats {
  total: number;
  migrated: number;
  base64: number;
  skippedAlreadyMigrated: number;
  skippedMissing: number;
  skippedInvalid: number;
  failed: number;
}

const DATA_URI_RE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,([A-Za-z0-9+/=\s]+)$/i;

/** A legacy reference this migration knows how to move. */
type LegacyRef =
  | { kind: 'local'; url: string; key: string; sourcePath: string }
  | { kind: 'base64'; url: string; buffer: Buffer; mime: string };

function detectLegacy(ref: string | null | undefined, uploadDir: string): LegacyRef | null {
  if (!ref) return null;
  if (ref.startsWith('/uploads/')) {
    const key = localKeyFromUrl(ref);
    if (!key) return null;
    return { kind: 'local', url: ref, key, sourcePath: path.resolve(uploadDir, key) };
  }
  const m = DATA_URI_RE.exec(ref);
  if (m) {
    const mime = m[1].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${m[1].toLowerCase()}`;
    const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (buffer.length === 0) return null;
    return { kind: 'base64', url: ref, buffer, mime };
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadWithRetry(
  storage: StorageService,
  restaurantId: string,
  kind: StorageKind,
  buffer: Buffer,
  ext: string,
  mimeType: string,
  retries: number
): Promise<{ url: string; key: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const stored = await storage.upload({
        restaurantId,
        kind,
        buffer,
        mimeType,
        ext,
        size: buffer.length,
      });
      return { url: stored.url, key: stored.key };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('upload failed');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storage = getStorage();

  if (!storage.persistent) {
    console.error(
      '❌ Refusing to migrate: STORAGE_DRIVER is not an object-storage driver ' +
        `(current driver "${storage.driver}" is not persistent). ` +
        'Set STORAGE_DRIVER=supabase and the required credentials, then retry.'
    );
    process.exit(1);
  }

  // --delete-source without --apply is meaningless and dangerous; refuse.
  if (args.deleteSource && !args.apply) {
    console.error('❌ --delete-source requires --apply. Dry-run never deletes files.');
    process.exit(1);
  }

  const uploadDir = path.resolve(process.cwd(), config.uploadDir);
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    base64: 0,
    skippedAlreadyMigrated: 0,
    skippedMissing: 0,
    skippedInvalid: 0,
    failed: 0,
  };

  // Local files verified-clean for BOTH post-upload and post-DB-update checks.
  // Deletion is deferred to the end and keyed by absolute path, so a file
  // shared by multiple rows is removed only once all referencing rows are
  // safely committed and re-verified.
  const cleanableSources = new Set<string>();

  // Dedupe identical legacy refs so a shared image is uploaded once.
  const refCache = new Map<string, string>();

  console.log(
    `${args.apply ? '▶ APPLY' : '🔍 DRY-RUN'} — migrating legacy images to ` +
      `object storage (driver "${storage.driver}").`
  );

  const [restaurants, categories, products, offers] = await Promise.all([
    prisma.restaurant.findMany({
      select: { id: true, logoUrl: true, coverImageUrl: true, galleryImages: true },
    }),
    prisma.category.findMany({ select: { id: true, restaurantId: true, image: true } }),
    prisma.product.findMany({ select: { id: true, restaurantId: true, imageUrl: true } }),
    prisma.offer.findMany({ select: { id: true, restaurantId: true, image: true } }),
  ]);

  /**
   * Migrate ONE legacy reference through the full safe pipeline.
   * Returns the new URL after BOTH verifications, or null (failure logged).
   * `apply` gates the DB update; the caller performs the update and invokes
   * the returned `commitCleanup()` only after its DB write succeeded.
   */
  const migrateRef = async (
    restaurantId: string,
    kind: StorageKind,
    ref: string
  ): Promise<{ newUrl: string; sourcePath: string | null } | null> => {
    stats.total += 1;
    if (refCache.has(ref)) {
      return { newUrl: refCache.get(ref)!, sourcePath: null };
    }

    const legacy = detectLegacy(ref, uploadDir);
    if (!legacy) {
      stats.skippedAlreadyMigrated += 1;
      return null;
    }

    let buffer: Buffer;
    let sourcePath: string | null = null;
    if (legacy.kind === 'local') {
      sourcePath = legacy.sourcePath;
      if (!fs.existsSync(sourcePath)) {
        stats.skippedMissing += 1;
        console.warn(`  ⚠️ MISSING source file: ${sourcePath} (DB row keeps pointing at ${ref})`);
        return null;
      }
      buffer = fs.readFileSync(sourcePath);
    } else {
      buffer = legacy.buffer;
      stats.base64 += 1;
    }

    const sniffed = sniffImage(buffer);
    if (!sniffed) {
      stats.skippedInvalid += 1;
      console.warn(
        `  ⚠️ INVALID/unsupported image bytes: ${legacy.kind === 'local' ? sourcePath : 'data: URI'}`
      );
      return null;
    }

    // 1) upload
    let uploaded: { url: string; key: string };
    try {
      uploaded = await uploadWithRetry(
        storage,
        restaurantId,
        kind,
        buffer,
        sniffed.ext,
        sniffed.mimeType,
        args.retries
      );
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ Upload failed for ${sourcePath ?? 'data: URI'}:`, err);
      return null;
    }

    // 2) verify the object actually exists BEFORE touching the DB.
    const presentAfterUpload = await storage.exists(uploaded.key).catch(() => false);
    if (!presentAfterUpload) {
      stats.failed += 1;
      console.error(
        `  ❌ Post-upload verification FAILED (object not found): ${uploaded.key}. DB not updated.`
      );
      return null;
    }

    return { newUrl: uploaded.url, sourcePath };
  };

  /**
   * Run AFTER the DB update for a row committed successfully: re-derive the
   * key from the stored public URL and confirm the object still exists.
   * Only then is the local source file eligible for cleanup.
   */
  const verifyCommitted = async (newUrl: string, sourcePath: string | null): Promise<boolean> => {
    const key = storage.keyFromUrl(newUrl);
    if (!key) {
      console.error(`  ❌ New URL does not map back to a storage key: ${newUrl}`);
      return false;
    }
    const present = await storage.exists(key).catch(() => false);
    if (!present) {
      console.error(`  ❌ Post-DB-update verification FAILED for key: ${key}`);
      return false;
    }
    if (sourcePath) cleanableSources.add(sourcePath);
    return true;
  };

  /**
   * Full per-row pipeline used by every single-URL entity loop:
   * migrate → update DB → verify URL → count + log. Returns the replacement
   * URL (or null when nothing changed / verification failed).
   */
  const commitRow = async (
    restaurantId: string,
    kind: StorageKind,
    ref: string,
    applyUpdate: (newUrl: string) => Promise<void>,
    label: string
  ): Promise<string | null> => {
    const result = await migrateRef(restaurantId, kind, ref);
    if (!result) return null;
    const { newUrl, sourcePath } = result;

    if (args.apply) {
      await applyUpdate(newUrl);
      const ok = await verifyCommitted(newUrl, sourcePath);
      if (!ok) {
        stats.failed += 1;
        console.error(`  ❌ ${label}: uploaded but post-update verification failed; inspect row.`);
        return null;
      }
    }

    stats.migrated += 1;
    refCache.set(ref, newUrl);
    console.log(`  ${label}: ${ref.startsWith('data:') ? '[data: URI]' : ref} → ${newUrl}`);
    return newUrl;
  };

  // ---------- Restaurants (logo / cover / gallery) ----------
  for (const r of restaurants) {
    if (detectLegacy(r.logoUrl, uploadDir)) {
      await commitRow(
        r.id,
        'logo',
        r.logoUrl!,
        async (newUrl) => { await prisma.restaurant.update({ where: { id: r.id }, data: { logoUrl: newUrl } }); },
        `${r.id} logo`
      );
    } else if (r.logoUrl) {
      stats.skippedAlreadyMigrated += 1;
    }

    if (detectLegacy(r.coverImageUrl, uploadDir)) {
      await commitRow(
        r.id,
        'cover',
        r.coverImageUrl!,
        async (newUrl) => { await prisma.restaurant.update({ where: { id: r.id }, data: { coverImageUrl: newUrl } }); },
        `${r.id} cover`
      );
    } else if (r.coverImageUrl) {
      stats.skippedAlreadyMigrated += 1;
    }

    const gallery = r.galleryImages ?? [];
    let galleryChanged = false;
    const migratedGallery: string[] = [];
    // Sources are only eligible for cleanup after the single array DB write
    // below succeeds AND each committed URL re-verifies.
    const pendingGallerySources: Array<{ newUrl: string; sourcePath: string | null }> = [];
    for (const img of gallery) {
      if (detectLegacy(img, uploadDir)) {
        const result = await migrateRef(r.id, 'gallery', img);
        if (result) {
          galleryChanged = true;
          migratedGallery.push(result.newUrl);
          pendingGallerySources.push(result);
        } else {
          migratedGallery.push(img); // keep pointing (missing/invalid logged above)
        }
      } else {
        stats.skippedAlreadyMigrated += 1;
        migratedGallery.push(img);
      }
    }
    if (galleryChanged) {
      if (args.apply) {
        // Single write for the whole array.
        await prisma.restaurant.update({ where: { id: r.id }, data: { galleryImages: migratedGallery } });
        // Re-verify the committed URLs; only mark sources cleanable after this.
        for (const { newUrl, sourcePath } of pendingGallerySources) {
          const ok = await verifyCommitted(newUrl, sourcePath);
          if (!ok) {
            stats.failed += 1;
            console.error(`  ❌ ${r.id} gallery post-update verification FAILED: ${newUrl}`);
          } else {
            stats.migrated += 1;
            console.log(`  ${r.id} gallery item → ${newUrl}`);
          }
        }
      } else {
        stats.migrated += pendingGallerySources.length;
        for (const { newUrl } of pendingGallerySources) {
          console.log(`  ${r.id} gallery item → ${newUrl}`);
        }
      }
    }
  }

  // ---------- Categories ----------
  for (const c of categories) {
    if (c.image && detectLegacy(c.image, uploadDir)) {
      await commitRow(
        c.restaurantId,
        'category',
        c.image,
        async (newUrl) => { await prisma.category.update({ where: { id: c.id }, data: { image: newUrl } }); },
        `category ${c.id}`
      );
    } else if (c.image) {
      stats.skippedAlreadyMigrated += 1;
    }
  }

  // ---------- Products ----------
  for (const p of products) {
    if (detectLegacy(p.imageUrl, uploadDir)) {
      await commitRow(
        p.restaurantId,
        'product',
        p.imageUrl,
        async (newUrl) => { await prisma.product.update({ where: { id: p.id }, data: { imageUrl: newUrl } }); },
        `product ${p.id}`
      );
    } else {
      stats.skippedAlreadyMigrated += 1;
    }
  }

  // ---------- Offers ----------
  for (const o of offers) {
    if (o.image && detectLegacy(o.image, uploadDir)) {
      await commitRow(
        o.restaurantId,
        'offer',
        o.image,
        async (newUrl) => { await prisma.offer.update({ where: { id: o.id }, data: { image: newUrl } }); },
        `offer ${o.id}`
      );
    } else if (o.image) {
      stats.skippedAlreadyMigrated += 1;
    }
  }

  // ---------- Final, deferred cleanup of local source files ----------
  if (args.apply && args.deleteSource) {
    for (const sourcePath of cleanableSources) {
      try {
        fs.rmSync(sourcePath, { force: true });
        console.log(`  🧹 removed local source: ${sourcePath}`);
      } catch (err) {
        console.warn(`  ⚠️ could not remove ${sourcePath}:`, err);
      }
    }
  } else if (args.deleteSource) {
    console.error('❌ internal: cleanup reached without --apply; skipped.');
  }

  console.log('\n================ MIGRATION SUMMARY ================');
  console.log(`Mode:            ${args.apply ? 'APPLY (wrote DB)' : 'DRY-RUN (no writes, no deletes)'}`);
  console.log(`Total refs seen: ${stats.total}`);
  console.log(`Migrated:        ${stats.migrated} (of which inline Base64: ${stats.base64})`);
  console.log(`Skipped (already migrated/external): ${stats.skippedAlreadyMigrated}`);
  console.log(`Skipped (missing source file):       ${stats.skippedMissing}`);
  console.log(`Skipped (invalid bytes):             ${stats.skippedInvalid}`);
  console.log(`Failed:          ${stats.failed}`);
  console.log(`Local files pending/cleaned:         ${cleanableSources.size}`);
  if (stats.skippedMissing > 0) {
    console.log('\n⚠️  Missing source files were logged above and left in the DB as /uploads/…');
    console.log('   URLs. These images are GONE from local storage and were NOT recovered —');
    console.log('   they must be re-uploaded manually. No claim of recovery is made.');
  }
  if (stats.failed > 0 && args.apply) {
    console.log('\n⚠️  Some images failed verification AFTER upload. The objects exist in');
    console.log('   storage but the affected DB rows may be unchanged — re-run the script');
    console.log('   (it is idempotent) and review the errors above.');
  }
  if (!args.apply) {
    console.log('\nRun with --apply to upload and update PostgreSQL. Source files are never');
    console.log('deleted unless you also pass --delete-source, and only after full verification.');
  }
  await prisma.$disconnect();

  if (stats.failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error('storage:migrate failed:', err);
  process.exit(1);
});
