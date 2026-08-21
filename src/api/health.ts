import type { AppConfig } from '../config/env.js';
import type { PaperPortfolioConfig } from '../config/paper-portfolio.js';

export interface HealthReport {
  readonly status: 'ok';
  readonly mode: 'paper';
  readonly storage: string;
  readonly uptimeSeconds: number;
  readonly monitoredTokenLimit: number;
  readonly maxConcurrentPositions: number;
}

export function healthReport(config: AppConfig, portfolio: PaperPortfolioConfig, startedAt: Date, now = new Date()): HealthReport {
  return {
    status: 'ok',
    mode: config.tradingMode,
    storage: config.storageDriver,
    uptimeSeconds: Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000)),
    monitoredTokenLimit: portfolio.maxMonitoredTokens,
    maxConcurrentPositions: portfolio.maxConcurrentPositions
  };
}
