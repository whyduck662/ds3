import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

// Chỉ nhận pool của service gọi; không có danh sách credentials của service khác.
export async function migrate(pool: Pool, directory: URL) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize startup của nhiều instance trong cùng DB.
    await client.query('SELECT pg_advisory_xact_lock(730301)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (applied.rowCount) continue;
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
