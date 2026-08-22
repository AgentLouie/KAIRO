import { loadAppConfig } from '../config/env.js';
import { createPostgresClient, PostgresCandidateRepository, PostgresMarketSnapshotRepository } from '../database/postgres.js';
import { SnapshotService } from '../market-data/snapshot-service.js';
import { SnapshotCycle } from '../market-data/snapshot-cycle.js';
import { BirdeyeMarketDataProvider } from '../providers/birdeye/birdeye-market-data-provider.js';
import { createLogger } from '../logging/logger.js';

const app = loadAppConfig();
if (app.storageDriver !== 'postgres' || !app.databaseUrl || !app.birdeyeApiKey) {
  throw new Error('STORAGE_DRIVER=postgres, DATABASE_URL, and BIRDEYE_API_KEY are required for snapshot monitoring.');
}
const database = createPostgresClient(app.databaseUrl);
try {
  const cycle = new SnapshotCycle(
    new PostgresCandidateRepository(database),
    new SnapshotService(new BirdeyeMarketDataProvider(app.birdeyeApiKey), new PostgresMarketSnapshotRepository(database), { cacheTtlMs: 0 }),
    createLogger(app.logLevel),
    app.snapshotMaxConcurrency,
    { requestSpacingMs: app.snapshotRequestSpacingMs }
  );
  console.log(JSON.stringify(await cycle.runOnce(), null, 2));
} finally {
  await database.end?.();
}
