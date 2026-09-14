import { config, isProd } from '../config';
import { prisma } from '../db/prisma';
import { runRetentionSweep } from '../services/retention';
import { getPrivateStorage } from '../services/storage';

// ============================================================
// Daily archive + temporary-data cleanup (CLI).
//
//   npm run retention:cleanup              # archive + purge (default)
//   npm run retention:cleanup -- --dry-run # report only, writes nothing
//
// Intended automation: an external scheduler / Render cron job, exactly like
// the existing `npm run subscriptions:expire`. The same service is available
// in-process behind RETENTION_ENABLED=true for deployments without a cron.
//
// Guarantees:
//   - financial history is never touched (orders/receipts/audit rows remain),
//   - only temporary operational data is removed (guest phone + receipt image),
//   - idempotent: running it twice in a row is a no-op the second time,
//   - exit code 1 on any failure so the scheduler surfaces the problem.
// ============================================================

function log(message: string) {
  // Timestamped single-line records keep cron output greppable/alertable.
  console.log(`[retention ${new Date().toISOString()}] ${message}`);
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  log(
    `start — driver=${config.storageDriver} destination=${getPrivateStorage().destination} ` +
      `graceHours=${config.archiveGraceHours} retentionHours=${config.proofRetentionHours} ` +
      `batch=${config.retentionBatchSize}${dryRun ? ' DRY-RUN' : ''}`
  );

  const { archive, purge } = await runRetentionSweep({
    graceHours: config.archiveGraceHours,
    retentionHours: config.proofRetentionHours,
    batchSize: config.retentionBatchSize,
    dryRun,
  });

  log(
    `archive: ${dryRun ? 'would archive' : 'archived'} ${dryRun ? archive.candidates.length : archive.archived} order(s)`
  );
  log(
    `purge: ${dryRun ? 'would purge' : 'purged'} ${dryRun ? purge.candidates.length : purge.purged} order(s)` +
      (purge.purgeFailures > 0 ? ` — ${purge.purgeFailures} failure(s), will retry next run` : '')
  );

  if (!dryRun && purge.purgeFailures > 0) {
    // Partial failure: the failed rows stay pointed at their object and are
    // retried, but the operator must see it (nonzero exit for schedulers).
    throw new Error(`${purge.purgeFailures} receipt object(s) could not be deleted`);
  }

  log('done');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(
      `[retention] FAILED${isProd ? '' : `: ${err?.message || err}`}`
    );
    if (isProd && err?.message) console.error(`[retention] ${err.message}`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
