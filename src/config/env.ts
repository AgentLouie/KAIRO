export type StorageDriver = 'memory' | 'postgres';

export interface AppConfig {
  readonly tradingMode: 'paper';
  readonly port: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly storageDriver: StorageDriver;
  readonly databaseUrl?: string;
  readonly heliusApiKey?: string;
  readonly birdeyeApiKey?: string;
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
    storageDriver,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(heliusApiKey ? { heliusApiKey } : {}),
    ...(birdeyeApiKey ? { birdeyeApiKey } : {})
  };
}
