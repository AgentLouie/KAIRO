import { loadAppConfig } from './config/env.js';
import { loadPaperPortfolioConfig } from './config/paper-portfolio.js';
import { createLogger } from './logging/logger.js';
import { createAppServer } from './server.js';

const config = loadAppConfig();
const portfolio = loadPaperPortfolioConfig();
const logger = createLogger(config.logLevel);
const server = createAppServer(config, portfolio, logger);

server.listen(config.port, () => {
  logger.info('server.started', {
    port: config.port,
    mode: config.tradingMode,
    storage: config.storageDriver,
    monitoredTokenLimit: portfolio.maxMonitoredTokens
  });
});

function shutdown(signal: string): void {
  logger.info('server.stopping', { signal });
  server.close((error) => {
    if (error) {
      logger.error('server.stop_failed', { message: error.message });
      process.exitCode = 1;
    }
    logger.info('server.stopped');
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
