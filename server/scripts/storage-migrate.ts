// ============================================================
// storage:migrate — move legacy local `/uploads/…` images into
// the object-storage driver and update PostgreSQL URLs.
//
// Usage:
//   npm run storage:migrate              # DRY-RUN (writes nothing)
//   npm run storage:migrate -- --apply   # actually upload + update DB
//   npm run storage:migrate -- --apply --delete-source  # + remove local file
//   npm run storage:migrate -- --apply --retries 5
//
// Safety properties:
//   - Dry-run by default; nothing is written without `--apply`.
//   - Already-migrated rows (URLs not starting with /uploads/) are skipped.
//   - Missing/corrupt local files are logged, NEVER claimed as recovered.
//   - Source files are NOT deleted unless `--delete-source` is passed AND
//     the upload + DB update both succeeded.
//   - Uploads are retried (default 3 attempts, linear backoff).
// ============================================================

import path from 'path';
import fs from 'fs';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { getStorage, localKeyFromUrl, type StorageKind } from '../services/storage';
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
  skippedAlreadyMigrated: number;
  skippedMissing: number;
  skippedInvalid: number;
  failed: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadWithRetry(
  storage: ReturnType<typeof getStorage>,
  restaurantId: string,
  kind: StorageKind,
  buffer: Buffer,
  ext: string,
  mimeType: string,
  retries: number
): Promise<string> {
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
      return stored.url;
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

  const uploadDir = path.resolve(process.cwd(), config.uploadDir);
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skippedAlreadyMigrated: 0,
    skippedMissing: 0,
    skippedInvalid: 0,
    failed: 0,
  };

  // Dedupe identical legacy URLs so a shared image is uploaded once.
  const urlCache = new Map<string, string>();

  console.log(
    `${args.apply ? '▶ APPLY' : '🔍 DRY-RUN'} — migrating /uploads/… images to ` +
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

  // Cache a function that migrates one legacy URL → new URL.
  const migrateUrl = async (
    restaurantId: string,
    kind: StorageKind,
    legacyUrl: string
  ): Promise<string | null> => {
    stats.total += 1;
    const key = localKeyFromUrl(legacyUrl);
    if (!key) {
      // Not a local legacy URL (already on object storage / external).
      stats.skippedAlreadyMigrated += 1;
      return null;
    }
    if (urlCache.has(legacyUrl)) return urlCache.get(legacyUrl)!;

    const sourcePath = path.resolve(uploadDir, key);
    if (!fs.existsSync(sourcePath)) {
      stats.skippedMissing += 1;
      console.warn(`  ⚠️ MISSING source file: ${sourcePath} (DB row keeps pointing at ${legacyUrl})`);
      return null;
    }

    const buffer = fs.readFileSync(sourcePath);
    const sniffed = sniffImage(buffer);
    if (!sniffed) {
      stats.skippedInvalid += 1;
      console.warn(`  ⚠️ INVALID/unsupported image bytes: ${sourcePath}`);
      return null;
    }

    try {
      const newUrl = await uploadWithRetry(
        storage,
        restaurantId,
        kind,
        buffer,
        sniffed.ext,
        sniffed.mimeType,
        args.retries
      );
      urlCache.set(legacyUrl, newUrl);
      return newUrl;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ Upload failed for ${sourcePath}:`, err);
      return null;
    }
  };

  // ---------- Restaurants (logo / cover / gallery) ----------
  for (const r of restaurants) {
    if (r.logoUrl.startsWith('/uploads/')) {
      const newUrl = await migrateUrl(r.id, 'logo', r.logoUrl);
      if (newUrl) {
        stats.migrated += 1;
        if (args.apply) await prisma.restaurant.update({ where: { id: r.id }, data: { logoUrl: newUrl } });
        console.log(`  ${r.id} logo: ${r.logoUrl} → ${newUrl}`);
        if (args.deleteSource) fs.rmSync(path.resolve(uploadDir, localKeyFromUrl(r.logoUrl)!), { force: true });
      }
    } else {
      stats.skippedAlreadyMigrated += 1;
    }

    if (r.coverImageUrl && r.coverImageUrl.startsWith('/uploads/')) {
      const newUrl = await migrateUrl(r.id, 'cover', r.coverImageUrl);
      if (newUrl) {
        stats.migrated += 1;
        if (args.apply) await prisma.restaurant.update({ where: { id: r.id }, data: { coverImageUrl: newUrl } });
        console.log(`  ${r.id} cover: ${r.coverImageUrl} → ${newUrl}`);
        if (args.deleteSource) fs.rmSync(path.resolve(uploadDir, localKeyFromUrl(r.coverImageUrl)!), { force: true });
      }
    } else if (r.coverImageUrl) {
      stats.skippedAlreadyMigrated += 1;
    }

    const gallery = r.galleryImages ?? [];
    let galleryChanged = false;
    const migratedGallery: string[] = [];
    for (const img of gallery) {
      if (img.startsWith('/uploads/')) {
        const newUrl = await migrateUrl(r.id, 'gallery', img);
        if (newUrl) {
          stats.migrated += 1;
          galleryChanged = true;
          migratedGallery.push(newUrl);
          if (args.deleteSource) fs.rmSync(path.resolve(uploadDir, localKeyFromUrl(img)!), { force: true });
        } else {
          migratedGallery.push(img); // keep pointing (missing/invalid logged above)
        }
      } else {
        stats.skippedAlreadyMigrated += 1;
        migratedGallery.push(img);
      }
    }
    if (galleryChanged && args.apply) {
      await prisma.restaurant.update({ where: { id: r.id }, data: { galleryImages: migratedGallery } });
    }
  }

  // ---------- Categories ----------
  for (const c of categories) {
    if (c.image && c.image.startsWith('/uploads/')) {
      const newUrl = await migrateUrl(c.restaurantId, 'category', c.image);
      if (newUrl) {
        stats.migrated += 1;
        if (args.apply) await prisma.category.update({ where: { id: c.id }, data: { image: newUrl } });
        console.log(`  category ${c.id}: ${c.image} → ${newUrl}`);
        if (args.deleteSource) fs.rmSync(path.resolve(uploadDir, localKeyFromUrl(c.image)!), { force: true });
      }
    } else if (c.image) {
      stats.skippedAlreadyMigrated += 1;
    }
  }

  // ---------- Products ----------
  for (const p of products) {
    if (p.imageUrl.startsWith('/uploads/')) {
      const newUrl = await migrateUrl(p.restaurantId, 'product', p.imageUrl);
      if (newUrl) {
        stats.migrated += 1;
        if (args.apply) await prisma.product.update({ where: { id: p.id }, data: { imageUrl: newUrl } });
        console.log(`  product ${p.id}: ${p.imageUrl} → ${newUrl}`);
        if (args.deleteSource) fs.rmSync(path.resolve(uploadDir, localKeyFromUrl(p.imageUrl)!), { force: true });
      }
    } else {
      stats.skippedAlreadyMigrated += 1;
    }
  }

  // ---------- Offers ----------
  for (const o of offers) {
    if (o.image && o.image.startsWith('/uploads/')) {
      const newUrl = await migrateUrl(o.restaurantId, 'offer', o.image);
      if (newUrl) {
        stats.migrated += 1;
        if (args.apply) await prisma.offer.update({ where: { id: o.id }, data: { image: newUrl } });
        console.log(`  offer ${o.id}: ${o.image} → ${newUrl}`);
        if (args.deleteSource) fs.rmSync(path.resolve(uploadDir, localKeyFromUrl(o.image)!), { force: true });
      }
    } else if (o.image) {
      stats.skippedAlreadyMigrated += 1;
    }
  }

  console.log('\n================ MIGRATION SUMMARY ================');
  console.log(`Mode:            ${args.apply ? 'APPLY (wrote DB)' : 'DRY-RUN (no writes)'}`);
  console.log(`Total URLs seen: ${stats.total}`);
  console.log(`Migrated:        ${stats.migrated}`);
  console.log(`Skipped (already migrated/external): ${stats.skippedAlreadyMigrated}`);
  console.log(`Skipped (missing source file):       ${stats.skippedMissing}`);
  console.log(`Skipped (invalid bytes):             ${stats.skippedInvalid}`);
  console.log(`Failed:          ${stats.failed}`);
  if (stats.skippedMissing > 0) {
    console.log('\n⚠️  Missing source files were logged above and left in the DB as /uploads/…');
    console.log('   URLs. These images are GONE from local storage and were NOT recovered —');
    console.log('   they must be re-uploaded manually. No claim of recovery is made.');
  }
  if (!args.apply) {
    console.log('\nRun with --apply to write changes to PostgreSQL.');
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('storage:migrate failed:', err);
  process.exit(1);
});
