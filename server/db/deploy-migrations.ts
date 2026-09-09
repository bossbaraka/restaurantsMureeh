import { execSync } from 'child_process';

function runMigrations() {
  console.log('[Migrate] Executing database migration deployment...');

  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('[Migrate] Migration deployment successful.');
  } catch (_firstErr) {
    console.warn('[Migrate] Initial migrate deploy failed. Checking for P3005 unbaselined schema...');
    try {
      execSync('npx prisma migrate deploy', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: any) {
      const stderr = err?.stderr?.toString() || '';
      const stdout = err?.stdout?.toString() || '';
      const message = err?.message || '';
      const combinedOutput = `${stderr}\n${stdout}\n${message}`;

      if (combinedOutput.includes('P3005') || combinedOutput.includes('schema is not empty')) {
        console.log('[Migrate] Detected P3005 (existing unbaselined schema). Baselining migration 20260908104200_init...');
        execSync('npx prisma migrate resolve --applied 20260908104200_init', { stdio: 'inherit' });
        console.log('[Migrate] Migration 20260908104200_init baselined. Re-executing migrate deploy...');
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        console.log('[Migrate] Migration deployment completed successfully after baseline.');
        return;
      }

      console.error('[Migrate] Migration deployment failed with unhandled error:\n', combinedOutput);
      process.exit(1);
    }
  }
}

runMigrations();
