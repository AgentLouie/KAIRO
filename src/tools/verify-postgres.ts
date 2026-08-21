import { loadAppConfig } from '../config/env.js';
import { createPostgresClient, PostgresMarketSnapshotRepository } from '../database/postgres.js';
import { BirdeyeMarketDataProvider } from '../providers/birdeye/birdeye-market-data-provider.js';

const config = loadAppConfig();
if (config.storageDriver !== 'postgres' || !config.databaseUrl) {
  throw new Error('Set STORAGE_DRIVER=postgres and DATABASE_URL in .env before verifying PostgreSQL.');
}
if (!config.birdeyeApiKey) {
  throw new Error('BIRDEYE_API_KEY is required to verify snapshot persistence.');
}

const client = createPostgresClient(config.databaseUrl);
try {
  const provider = new BirdeyeMarketDataProvider(config.birdeyeApiKey);
  const snapshot = (await provider.getTokenSnapshot('So11111111111111111111111111111111111111112')).data;
  const repository = new PostgresMarketSnapshotRepository(client);
  await repository.save(snapshot);
  const stored = await repository.recent(snapshot.token.mint, 1);
  const latest = stored[0];
  if (!latest || latest.token.mint !== snapshot.token.mint) {
    throw new Error('Snapshot was not returned after persistence.');
  }

  console.log(JSON.stringify({
    status: 'ok',
    token: latest.token.symbol ?? latest.token.mint,
    storedAt: latest.observedAt.toISOString(),
    priceUsd: latest.priceUsd,
    marketCapUsd: latest.marketCapUsd
  }, null, 2));
} finally {
  await client.end?.();
}
