import { loadAppConfig } from '../config/env.js';
import { loadPaperPortfolioConfig } from '../config/paper-portfolio.js';
import { CandidateFunnel } from '../discovery/candidate-funnel.js';
import { excludeMayhemMode } from '../discovery/mayhem-mode-guard.js';
import { BirdeyeDiscoveryProvider } from '../providers/birdeye/birdeye-discovery-provider.js';
import { HeliusMayhemModeDetector } from '../providers/helius/helius-mayhem-mode-detector.js';

const app = loadAppConfig();
const portfolio = loadPaperPortfolioConfig();
if (!app.birdeyeApiKey) throw new Error('BIRDEYE_API_KEY is required for token discovery.');
if (!app.heliusApiKey) throw new Error('HELIUS_API_KEY is required: Mayhem Mode status must be verified before monitoring candidates.');

const provider = new BirdeyeDiscoveryProvider(app.birdeyeApiKey);
const mayhemDetector = new HeliusMayhemModeDetector(app.heliusApiKey);
const funnel = new CandidateFunnel({
  maxMonitoredTokens: portfolio.maxMonitoredTokens,
  preliminaryMinLiquidityUsd: portfolio.preliminaryMinLiquidityUsd
});
const received = await provider.listNewPumpFunTokens(20);
const mayhemFilter = await excludeMayhemMode(received, mayhemDetector);
const result = funnel.ingest(mayhemFilter.accepted);

console.log(JSON.stringify({
  source: 'pump_dot_fun',
  listingsReceived: received.length,
  mayhemRejected: mayhemFilter.rejectedMints.length,
  monitoring: result.observing.length,
  rejected: result.rejected.length,
  duplicateCount: result.duplicateCount,
  monitored: funnel.monitoring().map((candidate) => ({
    mint: candidate.token.token.mint,
    symbol: candidate.token.token.symbol,
    liquidityUsd: candidate.token.liquidityUsd
  }))
}, null, 2));
