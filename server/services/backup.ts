import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function createDatabaseBackup(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const backupDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `backup-restaurant-saas-${timestamp}.sql`);

  const dumpCommand = `pg_dump -h localhost -U postgres -d restaurant_saas -F p -f "${backupFile}"`;

  return new Promise((resolve) => {
    exec(dumpCommand, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'postgres' } }, (error, _stdout, stderr) => {
      if (error) {
        console.error('Database backup error:', error, stderr);
        resolve({ success: false, error: stderr || error.message });
      } else {
        console.log(`✅ Database backup created successfully: ${backupFile}`);
        resolve({ success: true, filePath: backupFile });
      }
    });
  });
}
