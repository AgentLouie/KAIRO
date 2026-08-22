import { loadAppConfig } from '../config/env.js';
import { createPostgresClient, PostgresCandidateRepository, PostgresMarketSnapshotRepository } from '../database/postgres.js';
import { ActivityPruner } from '../discovery/activity-pruner.js';
const app = loadAppConfig(); if (app.storageDriver !== 'postgres' || !app.databaseUrl) throw new Error('PostgreSQL is required.');
const db = createPostgresClient(app.databaseUrl); try { console.log(JSON.stringify(await new ActivityPruner(new PostgresCandidateRepository(db), new PostgresMarketSnapshotRepository(db)).runOnce(), null, 2)); } finally { await db.end?.(); }
