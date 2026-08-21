import { loadAppConfig } from '../config/env.js';
import { loadPaperPortfolioConfig } from '../config/paper-portfolio.js';
import { CandidateFunnel } from '../discovery/candidate-funnel.js';
import { DiscoveryCycle } from '../discovery/discovery-cycle.js';
import { BirdeyeDiscoveryProvider } from '../providers/birdeye/birdeye-discovery-provider.js';
import { HeliusMayhemModeDetector } from '../providers/helius/helius-mayhem-mode-detector.js';
import { createPostgresClient, PostgresCandidateRepository } from '../database/postgres.js';

const app = loadAppConfig();
const portfolio = loadPaperPortfolioConfig();
if (!app.birdeyeApiKey) throw new Error('BIRDEYE_API_KEY is required for token discovery.');
if (!app.heliusApiKey) throw new Error('HELIUS_API_KEY is required: Mayhem Mode status must be verified before monitoring candidates.');

const provider = new BirdeyeDiscoveryProvider(app.birdeyeApiKey);
const mayhemDetector = new HeliusMayhemModeDetector(app.heliusApiKey);
if (app.storageDriver !== 'postgres' || !app.databaseUrl) {
  throw new Error('STORAGE_DRIVER=postgres and DATABASE_URL are required for restart-safe discovery.');
}
const database = createPostgresClient(app.databaseUrl);
const funnel = new CandidateFunnel({
  maxMonitoredTokens: portfolio.maxMonitoredTokens,
  preliminaryMinLiquidityUsd: portfolio.preliminaryMinLiquidityUsd
});
const cycle = new DiscoveryCycle(provider, mayhemDetector, funnel, new PostgresCandidateRepository(database));
try {
  const result = await cycle.runOnce(20);

  console.log(JSON.stringify({
    source: 'pump_dot_fun',
    listingsReceived: result.listingsReceived,
    skippedKnown: result.skippedKnown,
    mayhemRejected: result.mayhemRejected,
    monitoringAdded: result.observingAdded,
    monitoringTotal: result.monitored.length,
    rejected: result.rejected,
    duplicateCount: result.duplicateCount,
    monitored: result.monitored.map((candidate) => ({
      mint: candidate.token.token.mint,
      symbol: candidate.token.token.symbol,
      liquidityUsd: candidate.token.liquidityUsd
    }))
  }, null, 2));
} finally {
  await database.end?.();
}
