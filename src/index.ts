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

function shutdown(signal: string): void {
  logger.info('server.stopping', { signal });
  for (const scheduler of schedulers) scheduler.stop();
  server.close((error) => {
    if (error) {
      logger.error('server.stop_failed', { message: error.message });
      process.exitCode = 1;
    }
    logger.info('server.stopped');
    void database?.end?.();
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
