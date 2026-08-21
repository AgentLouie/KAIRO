import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TransactionalSqlClient } from './postgres.js';

export async function applyMigrations(client: TransactionalSqlClient, migrationsDirectory: string): Promise<readonly string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  const applied = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const appliedNames = new Set(applied.rows.map((row) => row.filename));
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  const completed: string[] = [];

  for (const name of names) {
    if (appliedNames.has(name)) continue;
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    await client.withTransaction(async (transaction) => {
      await transaction.query(sql);
      await transaction.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [name]);
    });
      completed.push(name);
  }
  return completed;
}
