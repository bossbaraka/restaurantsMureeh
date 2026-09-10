import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Derive pg_dump connection parameters from DATABASE_URL so backups always
 * target the SAME database the API writes to (the previous hard-coded
 * localhost/postgres/restaurant_saas tuple silently backed up the wrong host
 * on managed-Postgres deployments). Environment overrides (DB_HOST etc.)
 * take precedence for non-URL setups.
 */
function parsePgArgs(): { host: string; port: string; user: string; db: string } {
  const url = process.env.DATABASE_URL;
  const env = process.env;
  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const db = (parsed.pathname || '').replace(/^\//, '') || 'postgres';
      return {
        host: parsed.hostname || env.DB_HOST || 'localhost',
        port: parsed.port || env.DB_PORT || '5432',
        user: decodeURIComponent(parsed.username || '') || env.DB_USER || 'postgres',
        db,
      };
    } catch {
      /* fall through to env/hard defaults */
    }
  }
  return {
    host: env.DB_HOST || 'localhost',
    port: env.DB_PORT || '5432',
    user: env.DB_USER || 'postgres',
    db: env.DB_NAME || 'restaurant_saas',
  };
}

export async function createDatabaseBackup(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const dbPassword = process.env.DB_PASSWORD || process.env.PGPASSWORD;
  if (!dbPassword) {
    return { success: false, error: 'DB_PASSWORD is not configured — refusing to dump with default credentials' };
  }

  const { host, port, user, db } = parsePgArgs();
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
      ['-h', host, '-p', port, '-U', user, '-d', db, '-F', 'p', '-f', backupFile],
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
