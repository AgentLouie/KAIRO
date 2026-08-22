import { ConfigError } from './env.js';

export interface PaperPortfolioConfig {
  readonly startingBalanceSol: number;
  readonly riskPerTradePct: number;
  readonly maxConcurrentPositions: number;
  readonly maxMonitoredTokens: number;
  readonly preliminaryMinLiquidityUsd: number;
  readonly maxPortfolioRiskPct: number;
  readonly maxDailyDrawdownPct: number;
  readonly maxAccountDrawdownPct: number;
  readonly maxRiskScore: number;
  readonly minMomentumScore: number;
}

function positiveNumber(value: string | undefined, name: string, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive number.`);
  }
  return parsed;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const parsed = positiveNumber(value, name, fallback);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`${name} must be an integer.`);
  }
  return parsed;
}

function score(value: string | undefined, name: string, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new ConfigError(`${name} must be an integer between 0 and 100.`);
  }
  return parsed;
}

export function loadPaperPortfolioConfig(env: NodeJS.ProcessEnv = process.env): PaperPortfolioConfig {
  const config = {
    startingBalanceSol: positiveNumber(env.STARTING_BALANCE_SOL, 'STARTING_BALANCE_SOL', 10),
    riskPerTradePct: positiveNumber(env.RISK_PER_TRADE_PCT, 'RISK_PER_TRADE_PCT', 1),
    maxConcurrentPositions: positiveInteger(env.MAX_CONCURRENT_POSITIONS, 'MAX_CONCURRENT_POSITIONS', 3),
    maxMonitoredTokens: positiveInteger(env.MAX_MONITORED_TOKENS, 'MAX_MONITORED_TOKENS', 20),
    preliminaryMinLiquidityUsd: positiveNumber(env.PRELIMINARY_MIN_LIQUIDITY_USD, 'PRELIMINARY_MIN_LIQUIDITY_USD', 500),
    maxPortfolioRiskPct: positiveNumber(env.MAX_PORTFOLIO_RISK_PCT, 'MAX_PORTFOLIO_RISK_PCT', 3),
    maxDailyDrawdownPct: positiveNumber(env.MAX_DAILY_DRAWDOWN_PCT, 'MAX_DAILY_DRAWDOWN_PCT', 5),
    maxAccountDrawdownPct: positiveNumber(env.MAX_ACCOUNT_DRAWDOWN_PCT, 'MAX_ACCOUNT_DRAWDOWN_PCT', 15),
    maxRiskScore: score(env.MAX_RISK_SCORE, 'MAX_RISK_SCORE', 55)
    , minMomentumScore: score(env.MIN_MOMENTUM_SCORE, 'MIN_MOMENTUM_SCORE', 70)
  };

  if (config.maxPortfolioRiskPct < config.riskPerTradePct) {
    throw new ConfigError('MAX_PORTFOLIO_RISK_PCT cannot be less than RISK_PER_TRADE_PCT.');
  }
  return config;
}
