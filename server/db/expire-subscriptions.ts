// ============================================================
// subscriptions:expire — persist subscription period transitions.
//
// Deliberately a MANUAL / scheduled-job command, NEVER part of server boot:
// booting the API must not mutate commercial state.
//
// Usage:
//   npm run subscriptions:expire               # apply transitions
//   npm run subscriptions:expire -- --dry-run  # report only, write nothing
//   npm run subscriptions:expire -- --grace-days 3
//
// Schedule it later as a Render Cron Job (daily) or any external scheduler.
// Entitlement checks already enforce the same rules lazily on every request,
// so missing a run never grants extended access — this job only persists
// statuses and records audit events.
// ============================================================

import dotenv from 'dotenv';
import { prisma } from './prisma';
import { processExpiringSubscriptions } from '../services/subscriptionLifecycle';

dotenv.config();

function parseArgs(argv: string[]): { dryRun: boolean; graceDays?: number } {
  const out: { dryRun: boolean; graceDays?: number } = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    if (arg === '--grace-days' && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 90) {
        out.graceDays = n;
        i += 1;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Checking expiring subscriptions (${args.dryRun ? 'DRY-RUN' : 'APPLY'}${
      args.graceDays !== undefined ? `, grace=${args.graceDays}d` : ''
})...`
  );
  const result = await processExpiringSubscriptions(prisma, {
    dryRun: args.dryRun,
    graceDays: args.graceDays,
  });
  console.log('================ SUBSCRIPTION EXPIRY ================');
  console.log(`Scanned active/trial/past-due rows: ${result.scanned}`);
  console.log(`Marked PAST_DUE:  ${result.markedPastDue.length}${result.markedPastDue.length ? ` (${result.markedPastDue.join(', ')})` : ''}`);
  console.log(`Cancelled after grace: ${result.cancelled.length}${result.cancelled.length ? ` (${result.cancelled.join(', ')})` : ''}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('subscriptions:expire failed:', err);
  process.exit(1);
});
