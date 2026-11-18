import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { expect, it } from 'vitest';
import { migrate } from '../src/common/src/migrate.js';

it.each([false, true])('loads migration inside directory URL (trailing slash=%s)', async trailingSlash => {
  const directory = await mkdtemp(join(tmpdir(), 'ds03-migrate-'));
  const statements: string[] = [];
  let released = false;
  try {
    await writeFile(join(directory, '001_init.sql'), 'SELECT 42 AS migration_fixture;');
    const client = { query: async (sql: string) => { statements.push(sql); return { rowCount: 0, rows: [] }; }, release: () => { released = true; } };
    const pool = { connect: async () => client } as unknown as Pool;
    const url = pathToFileURL(directory);
    if (trailingSlash) url.pathname += '/';
    await migrate(pool, url);
    expect(statements).toContain('SELECT 42 AS migration_fixture;');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(released).toBe(true);
  } finally { await unlink(join(directory, '001_init.sql')); await rmdir(directory); }
});
