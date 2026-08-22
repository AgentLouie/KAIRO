import { loadAppConfig } from './config/env.js';
import { loadPaperPortfolioConfig } from './config/paper-portfolio.js';
import { createLogger } from './logging/logger.js';
import { createAppServer } from './server.js';
import { createPostgresClient, PostgresCandidateRepository, PostgresMarketSnapshotRepository } from './database/postgres.js';
import { BirdeyeDiscoveryProvider } from './providers/birdeye/birdeye-discovery-provider.js';
import { BirdeyeMarketDataProvider } from './providers/birdeye/birdeye-market-data-provider.js';
import { HeliusMayhemModeDetector } from './providers/helius/helius-mayhem-mode-detector.js';
import { CandidateFunnel } from './discovery/candidate-funnel.js';
import { DiscoveryCycle } from './discovery/discovery-cycle.js';
import { ScheduledDiscoveryTask } from './discovery/scheduled-discovery-task.js';
import { SnapshotService } from './market-data/snapshot-service.js';
import { SnapshotCycle } from './market-data/snapshot-cycle.js';
import { IntervalScheduler } from './runtime/interval-scheduler.js';
import { MomentumCycle } from './features/momentum-cycle.js';
import { ScheduledMomentumTask } from './features/scheduled-momentum-task.js';
import { PostgresMomentumFeatureRepository } from './database/postgres.js';
import { PostgresRiskAssessmentRepository } from './database/postgres.js';
import { RiskCycle } from './risk/risk-cycle.js';
import { RiskEvidenceCollector } from './risk/risk-evidence-collector.js';
import { ScheduledRiskTask } from './risk/scheduled-risk-task.js';
import { BirdeyeHolderProvider } from './providers/birdeye/birdeye-holder-provider.js';
import { BirdeyeHolderProfileProvider } from './providers/birdeye/birdeye-holder-profile-provider.js';
import { HeliusMintAuthorityProvider } from './providers/helius/helius-mint-authority-provider.js';
import { HeliusWalletAgeProvider } from './providers/helius/helius-wallet-age-provider.js';
import { FreshWalletAnalyzer } from './risk/fresh-wallet-analyzer.js';
import { ActivityPruner } from './discovery/activity-pruner.js';
import { ScheduledActivityPruner } from './discovery/scheduled-activity-pruner.js';
import { SignalCycle } from './signals/signal-cycle.js';
import { ScheduledSignalTask } from './signals/scheduled-signal-task.js';
import { PostgresSignalRepository } from './database/postgres.js';

const config = loadAppConfig();
const portfolio = loadPaperPortfolioConfig();
const logger = createLogger(config.logLevel);
const server = createAppServer(config, portfolio, logger);
const schedulers: IntervalScheduler[] = [];
let database: ReturnType<typeof createPostgresClient> | undefined;

if (config.storageDriver === 'postgres' && config.databaseUrl && config.birdeyeApiKey && config.heliusApiKey) {
  database = createPostgresClient(config.databaseUrl);
  const candidates = new PostgresCandidateRepository(database);
  const discovery = new DiscoveryCycle(
    new BirdeyeDiscoveryProvider(config.birdeyeApiKey),
    new HeliusMayhemModeDetector(config.heliusApiKey),
    new CandidateFunnel({ maxMonitoredTokens: portfolio.maxMonitoredTokens, preliminaryMinLiquidityUsd: portfolio.preliminaryMinLiquidityUsd }),
    candidates
  );
  schedulers.push(
    new IntervalScheduler(new ScheduledDiscoveryTask(discovery, logger), config.discoveryIntervalMs, logger),
    new IntervalScheduler(
      new SnapshotCycle(
        candidates,
        new SnapshotService(new BirdeyeMarketDataProvider(config.birdeyeApiKey), new PostgresMarketSnapshotRepository(database), { cacheTtlMs: 0 }),
        logger,
        config.snapshotMaxConcurrency,
        { requestSpacingMs: config.snapshotRequestSpacingMs }
      ),
      config.snapshotIntervalMs,
      logger
    ),
    new IntervalScheduler(
      new ScheduledActivityPruner(new ActivityPruner(candidates, new PostgresMarketSnapshotRepository(database)), logger),
      config.snapshotIntervalMs,
      logger
    ),
    new IntervalScheduler(
      new ScheduledMomentumTask(
        new MomentumCycle(candidates, new PostgresMarketSnapshotRepository(database), new PostgresMomentumFeatureRepository(database)),
        logger
      ),
      config.momentumIntervalMs,
      logger
    ),
    new IntervalScheduler(
      new ScheduledRiskTask(
        new RiskCycle(
          candidates,
          new RiskEvidenceCollector(
            new PostgresMarketSnapshotRepository(database), new HeliusMayhemModeDetector(config.heliusApiKey), new HeliusMintAuthorityProvider(config.heliusApiKey),
            new BirdeyeHolderProfileProvider(config.birdeyeApiKey), new FreshWalletAnalyzer(new BirdeyeHolderProvider(config.birdeyeApiKey), new HeliusWalletAgeProvider(config.heliusApiKey))
          ),
          new PostgresRiskAssessmentRepository(database)
        ),
        logger,
        config.maxRiskChecksPerCycle
      ),
      config.riskIntervalMs,
      logger
    ),
    new IntervalScheduler(
      new ScheduledSignalTask(new SignalCycle(candidates, new PostgresMomentumFeatureRepository(database), new PostgresRiskAssessmentRepository(database), new PostgresSignalRepository(database), undefined, portfolio.minMomentumScore, portfolio.maxRiskScore), logger),
      config.signalIntervalMs,
      logger
    )
  );
} else {
  logger.warn('scheduler.disabled', { reason: 'PostgreSQL, Birdeye, and Helius configuration are all required.' });
}

server.listen(config.port, () => {
  logger.info('server.started', {
    port: config.port,
    mode: config.tradingMode,
    storage: config.storageDriver,
    monitoredTokenLimit: portfolio.maxMonitoredTokens
  });
  for (const scheduler of schedulers) scheduler.start();
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.stopping', { signal });
  await Promise.all(schedulers.map((scheduler) => scheduler.stop()));
  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        logger.error('server.stop_failed', { message: error.message });
        process.exitCode = 1;
      }
      resolve();
    });
  });
  await database?.end?.();
  logger.info('server.stopped');
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
