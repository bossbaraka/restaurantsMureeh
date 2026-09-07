import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function createDatabaseBackup(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const dbPassword = process.env.DB_PASSWORD;
  if (!dbPassword) {
    return { success: false, error: 'DB_PASSWORD is not configured — refusing to dump with default credentials' };
  }

  const backupDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `backup-restaurant-saas-${timestamp}.sql`);

  return new Promise((resolve) => {
    // execFile with an argv array: no shell, no interpolation surface.
    execFile(
      'pg_dump',
      ['-h', 'localhost', '-U', 'postgres', '-d', 'restaurant_saas', '-F', 'p', '-f', backupFile],
      { env: { ...process.env, PGPASSWORD: dbPassword } },
      (error, _stdout, stderr) => {
        if (error) {
          console.error('Database backup error:', error, stderr);
          resolve({ success: false, error: stderr || error.message });
        } else {
          try {
            fs.chmodSync(backupFile, 0o600);
          } catch {
            /* best effort */
          }
          console.log(`✅ Database backup created successfully: ${backupFile}`);
          resolve({ success: true, filePath: backupFile });
        }
      }
    );
  });
}
