import { resolve } from 'node:path';
import { loadAppConfig } from '../config/env.js';
import { applyMigrations } from '../database/migrations.js';
import { createPostgresClient } from '../database/postgres.js';

const config = loadAppConfig();
if (config.storageDriver !== 'postgres' || !config.databaseUrl) {
  throw new Error('Set STORAGE_DRIVER=postgres and DATABASE_URL in .env before running migrations.');
}

const client = createPostgresClient(config.databaseUrl);
try {
  const applied = await applyMigrations(client, resolve(process.cwd(), 'database', 'migrations'));
  console.log(JSON.stringify({ status: 'ok', applied }, null, 2));
} finally {
  await client.end?.();
}
