import { loadAppConfig } from '../config/env.js';
import { PostgresCandidateRepository, PostgresMarketSnapshotRepository, PostgresMomentumFeatureRepository, createPostgresClient } from '../database/postgres.js';
import { MomentumCycle } from '../features/momentum-cycle.js';

const app = loadAppConfig();
if (app.storageDriver !== 'postgres' || !app.databaseUrl) {
  throw new Error('STORAGE_DRIVER=postgres and DATABASE_URL are required for momentum evaluation.');
}
const database = createPostgresClient(app.databaseUrl);
try {
  const result = await new MomentumCycle(
    new PostgresCandidateRepository(database),
    new PostgresMarketSnapshotRepository(database),
    new PostgresMomentumFeatureRepository(database)
  ).runOnce();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await database.end?.();
}
