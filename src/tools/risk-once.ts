import { loadAppConfig } from '../config/env.js';
import { createPostgresClient, PostgresCandidateRepository, PostgresMarketSnapshotRepository, PostgresRiskAssessmentRepository } from '../database/postgres.js';
import { BirdeyeHolderProfileProvider } from '../providers/birdeye/birdeye-holder-profile-provider.js';
import { BirdeyeHolderProvider } from '../providers/birdeye/birdeye-holder-provider.js';
import { HeliusMayhemModeDetector } from '../providers/helius/helius-mayhem-mode-detector.js';
import { HeliusMintAuthorityProvider } from '../providers/helius/helius-mint-authority-provider.js';
import { HeliusWalletAgeProvider } from '../providers/helius/helius-wallet-age-provider.js';
import { FreshWalletAnalyzer } from '../risk/fresh-wallet-analyzer.js';
import { RiskCycle } from '../risk/risk-cycle.js';
import { RiskEvidenceCollector } from '../risk/risk-evidence-collector.js';

const app = loadAppConfig();
if (app.storageDriver !== 'postgres' || !app.databaseUrl || !app.birdeyeApiKey || !app.heliusApiKey) throw new Error('PostgreSQL, Birdeye, and Helius configuration are required for risk evaluation.');
const limit = Number(process.argv[2] ?? '1');
if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error('Risk evaluation limit must be between 1 and 3.');
const database = createPostgresClient(app.databaseUrl);
try {
  const collector = new RiskEvidenceCollector(
    new PostgresMarketSnapshotRepository(database), new HeliusMayhemModeDetector(app.heliusApiKey), new HeliusMintAuthorityProvider(app.heliusApiKey),
    new BirdeyeHolderProfileProvider(app.birdeyeApiKey), new FreshWalletAnalyzer(new BirdeyeHolderProvider(app.birdeyeApiKey), new HeliusWalletAgeProvider(app.heliusApiKey))
  );
  console.log(JSON.stringify(await new RiskCycle(new PostgresCandidateRepository(database), collector, new PostgresRiskAssessmentRepository(database)).runOnce(limit), null, 2));
} finally { await database.end?.(); }
