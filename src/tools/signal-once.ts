import { loadAppConfig } from '../config/env.js';
import { loadPaperPortfolioConfig } from '../config/paper-portfolio.js';
import { createPostgresClient, PostgresCandidateRepository, PostgresMomentumFeatureRepository, PostgresRiskAssessmentRepository, PostgresSignalRepository } from '../database/postgres.js';
import { SignalCycle } from '../signals/signal-cycle.js';
const app = loadAppConfig(); const portfolio = loadPaperPortfolioConfig();
if (app.storageDriver !== 'postgres' || !app.databaseUrl) throw new Error('PostgreSQL is required for signal evaluation.');
const db = createPostgresClient(app.databaseUrl); try { console.log(JSON.stringify(await new SignalCycle(new PostgresCandidateRepository(db), new PostgresMomentumFeatureRepository(db), new PostgresRiskAssessmentRepository(db), new PostgresSignalRepository(db), undefined, portfolio.minMomentumScore, portfolio.maxRiskScore).runOnce(), null, 2)); } finally { await db.end?.(); }
