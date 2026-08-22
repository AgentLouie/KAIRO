import { loadAppConfig } from '../config/env.js';
import { createPostgresClient } from '../database/postgres.js';

const app = loadAppConfig();
if (app.storageDriver !== 'postgres' || !app.databaseUrl) throw new Error('PostgreSQL is required to list saved signals.');
const limit = Number(process.argv[2] ?? '20');
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Signal list limit must be between 1 and 100.');
const database = createPostgresClient(app.databaseUrl);
try {
  const result = await database.query<{ token_mint: string; symbol: string | null; action: string; observed_at: Date; reasons: string[] }>(
    `SELECT s.token_mint, t.symbol, s.action, s.observed_at, s.reasons
     FROM signals s JOIN tokens t ON t.mint = s.token_mint
     ORDER BY s.observed_at DESC LIMIT $1`, [limit]
  );
  console.log(JSON.stringify(result.rows.map((row) => ({
    contractAddress: row.token_mint,
    symbol: row.symbol,
    action: row.action,
    observedAt: new Date(row.observed_at).toISOString(),
    reasons: row.reasons
  })), null, 2));
} finally { await database.end?.(); }
