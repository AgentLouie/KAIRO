export type StorageDriver = 'memory' | 'postgres';

export interface AppConfig {
  readonly tradingMode: 'paper';
  readonly port: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly storageDriver: StorageDriver;
  readonly databaseUrl?: string;
  readonly heliusApiKey?: string;
  readonly birdeyeApiKey?: string;
  readonly discoveryIntervalMs: number;
  readonly snapshotIntervalMs: number;
  readonly momentumIntervalMs: number;
  readonly riskIntervalMs: number;
  readonly maxRiskChecksPerCycle: number;
  readonly snapshotMaxConcurrency: number;
  readonly snapshotRequestSpacingMs: number;
}

function intervalMs(name: string, value: string | undefined, fallbackSeconds: number): number {
  const seconds = Number(value ?? String(fallbackSeconds));
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3_600) {
    throw new ConfigError(`${name} must be an integer between 30 and 3600 seconds.`);
  }
  return seconds * 1_000;
}

function positiveInteger(name: string, value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ConfigError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function spacingMs(value: string | undefined): number {
  const seconds = Number(value ?? '2');
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
    throw new ConfigError('SNAPSHOT_REQUEST_SPACING_SECONDS must be an integer between 1 and 60 seconds.');
  }
  return seconds * 1_000;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? '3000');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ConfigError('PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if ((env.TRADING_MODE ?? 'paper') !== 'paper') {
    throw new ConfigError('Only TRADING_MODE=paper is allowed in this project.');
  }

  const storageDriver = env.STORAGE_DRIVER ?? 'memory';
  if (storageDriver !== 'memory' && storageDriver !== 'postgres') {
    throw new ConfigError('STORAGE_DRIVER must be either memory or postgres.');
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError('LOG_LEVEL must be debug, info, warn, or error.');
  }

  const databaseUrl = optionalValue(env.DATABASE_URL);
  const heliusApiKey = optionalValue(env.HELIUS_API_KEY);
  const birdeyeApiKey = optionalValue(env.BIRDEYE_API_KEY);
  if (storageDriver === 'postgres' && !databaseUrl) {
    throw new ConfigError('DATABASE_URL is required when STORAGE_DRIVER=postgres.');
  }

  return {
    tradingMode: 'paper',
    port: port(env.PORT),
    logLevel: logLevel as AppConfig['logLevel'],
    discoveryIntervalMs: intervalMs('DISCOVERY_INTERVAL_SECONDS', env.DISCOVERY_INTERVAL_SECONDS, 60),
    snapshotIntervalMs: intervalMs('SNAPSHOT_INTERVAL_SECONDS', env.SNAPSHOT_INTERVAL_SECONDS, 300),
    momentumIntervalMs: intervalMs('MOMENTUM_INTERVAL_SECONDS', env.MOMENTUM_INTERVAL_SECONDS, 300),
    riskIntervalMs: intervalMs('RISK_INTERVAL_SECONDS', env.RISK_INTERVAL_SECONDS, 900),
    maxRiskChecksPerCycle: positiveInteger('MAX_RISK_CHECKS_PER_CYCLE', env.MAX_RISK_CHECKS_PER_CYCLE, 1, 3),
    snapshotMaxConcurrency: positiveInteger('SNAPSHOT_MAX_CONCURRENCY', env.SNAPSHOT_MAX_CONCURRENCY, 1, 1),
    snapshotRequestSpacingMs: spacingMs(env.SNAPSHOT_REQUEST_SPACING_SECONDS),
    storageDriver,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(heliusApiKey ? { heliusApiKey } : {}),
    ...(birdeyeApiKey ? { birdeyeApiKey } : {})
  };
}
