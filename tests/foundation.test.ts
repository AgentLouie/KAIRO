import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppConfig, ConfigError } from '../src/config/env.js';
import { loadPaperPortfolioConfig } from '../src/config/paper-portfolio.js';
import { dataQuality, type MarketSnapshot } from '../src/core/market-data.js';
import { healthReport } from '../src/api/health.js';
import { SnapshotService } from '../src/market-data/snapshot-service.js';
import { InMemoryMarketSnapshotRepository } from '../src/database/in-memory-market-snapshots.js';
import type { MarketDataProvider } from '../src/providers/contracts.js';
import { BirdeyeApiError, BirdeyeMarketDataProvider } from '../src/providers/birdeye/birdeye-market-data-provider.js';
import { applyMigrations } from '../src/database/migrations.js';
import type { SqlClient, TransactionalSqlClient } from '../src/database/postgres.js';
import { resolve } from 'node:path';
import { BirdeyeDiscoveryProvider } from '../src/providers/birdeye/birdeye-discovery-provider.js';
import { CandidateFunnel } from '../src/discovery/candidate-funnel.js';
import { excludeMayhemMode } from '../src/discovery/mayhem-mode-guard.js';
import { HeliusMayhemModeDetector } from '../src/providers/helius/helius-mayhem-mode-detector.js';

test('defaults are paper-only and match the initial portfolio', () => {
  const app = loadAppConfig({});
  const portfolio = loadPaperPortfolioConfig({});
  assert.equal(app.tradingMode, 'paper');
  assert.equal(portfolio.startingBalanceSol, 10);
  assert.equal(portfolio.riskPerTradePct, 1);
  assert.equal(portfolio.maxConcurrentPositions, 3);
  assert.equal(portfolio.maxMonitoredTokens, 20);
});

test('live trading and incomplete Postgres configuration are rejected', () => {
  assert.throws(() => loadAppConfig({ TRADING_MODE: 'live' }), ConfigError);
  assert.throws(() => loadAppConfig({ STORAGE_DRIVER: 'postgres' }), ConfigError);
});

test('portfolio risk cannot be lower than a single trade risk', () => {
  assert.throws(
    () => loadPaperPortfolioConfig({ RISK_PER_TRADE_PCT: '4', MAX_PORTFOLIO_RISK_PCT: '3' }),
    ConfigError
  );
});

test('stale snapshots are explicitly identified', () => {
  const observedAt = new Date('2026-08-22T00:00:00.000Z');
  const snapshot: MarketSnapshot = {
    token: { mint: 'mint' },
    observedAt,
    provider: 'birdeye'
  };
  const quality = dataQuality(snapshot, new Date('2026-08-22T00:00:04.000Z'), 3_000);
  assert.equal(quality.isFresh, false);
  assert.equal(quality.ageMs, 4_000);
});

test('health report exposes safe operational limits', () => {
  const report = healthReport(
    loadAppConfig({ STORAGE_DRIVER: 'memory' }),
    loadPaperPortfolioConfig({}),
    new Date('2026-08-22T00:00:00.000Z'),
    new Date('2026-08-22T00:00:05.000Z')
  );
  assert.deepEqual(report, {
    status: 'ok',
    mode: 'paper',
    storage: 'memory',
    uptimeSeconds: 5,
    monitoredTokenLimit: 20,
    maxConcurrentPositions: 3
  });
});

test('snapshot service deduplicates concurrent calls and persists one normalized snapshot', async () => {
  let calls = 0;
  const provider: MarketDataProvider = {
    name: 'fake-market',
    async getTokenSnapshot(mint) {
      calls += 1;
      return {
        source: 'fake-market',
        fetchedAt: new Date(),
        data: { token: { mint }, observedAt: new Date(), provider: 'other', priceUsd: 0.01 }
      };
    },
    async getTokenTrades() { return { source: 'fake-market', fetchedAt: new Date(), data: [] }; },
    async getTokenPrice() { return { source: 'fake-market', fetchedAt: new Date(), data: 0.01 }; },
    async getTokenLiquidity() { return { source: 'fake-market', fetchedAt: new Date(), data: undefined }; },
    async getTokenVolume() { return { source: 'fake-market', fetchedAt: new Date(), data: undefined }; }
  };
  const repository = new InMemoryMarketSnapshotRepository();
  const service = new SnapshotService(provider, repository, { cacheTtlMs: 1_000 });

  const [first, second] = await Promise.all([service.get('mint'), service.get('mint')]);
  assert.equal(first.token.mint, 'mint');
  assert.equal(second.token.mint, 'mint');
  assert.equal(calls, 1);
  assert.equal((await repository.recent('mint', 10)).length, 1);
});

test('Birdeye overview adapter normalizes documented one-minute values', async () => {
  const provider = new BirdeyeMarketDataProvider('test-key', async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        success: true,
        data: {
          address: 'mint', symbol: 'TEST', name: 'Test Token', price: 0.0001,
          marketCap: 25_000, liquidity: 4_000, v1mUSD: 600,
          vBuy1mUSD: 500, vSell1mUSD: 100, buy1m: 8, sell1m: 2, uniqueWallet1m: 9
        }
      };
    }
  }));
  const result = await provider.getTokenSnapshot('mint');
  assert.equal(result.data.token.symbol, 'TEST');
  assert.equal(result.data.marketCapUsd, 25_000);
  assert.equal(result.data.buyVolume1mUsd, 500);
  assert.equal(result.data.sells1m, 2);
  assert.equal(result.data.uniqueTraders1m, 9);
});

test('Birdeye rate limiting is marked retryable', async () => {
  const provider = new BirdeyeMarketDataProvider('test-key', async () => ({
    ok: false,
    status: 429,
    async json() { return { success: false, message: 'Too Many Requests' }; }
  }));
  await assert.rejects(() => provider.getTokenSnapshot('mint'), (error: unknown) => {
    return error instanceof BirdeyeApiError && error.retryable;
  });
});

test('migration runner records each new migration once', async () => {
  const calls: string[] = [];
  const client: TransactionalSqlClient = {
    async query(text) {
      calls.push(text);
      if (text === 'SELECT filename FROM schema_migrations') return { rows: [] };
      return { rows: [] };
    },
    async withTransaction(operation) {
      calls.push('BEGIN');
      const result = await operation(this);
      calls.push('COMMIT');
      return result;
    }
  };
  const applied = await applyMigrations(client, resolve(process.cwd(), 'database', 'migrations'));
  assert.deepEqual(applied, ['001_foundation.sql', '002_candidate_discovery.sql']);
  assert.ok(calls.includes('BEGIN'));
  assert.ok(calls.includes('COMMIT'));
});

test('Pump.fun discovery discards non-Pump sources', async () => {
  const provider = new BirdeyeDiscoveryProvider('test-key', async () => ({
    ok: true,
    status: 200,
    async json() {
      return { success: true, data: { items: [
        { address: 'pumpMint', source: 'pump_dot_fun', symbol: 'PUMP', liquidity: '1000', liquidityAddedAt: 1 },
        { address: 'otherMint', source: 'moonshot', symbol: 'OTHER', liquidity: '2000' }
      ] } };
    }
  }));
  const found = await provider.listNewPumpFunTokens(20);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.token.mint, 'pumpMint');
});

test('candidate funnel ranks by liquidity, deduplicates, and enforces the monitoring limit', () => {
  const funnel = new CandidateFunnel({ maxMonitoredTokens: 2, preliminaryMinLiquidityUsd: 500 });
  const make = (mint: string, liquidityUsd: number) => ({ token: { mint }, source: 'pump_dot_fun' as const, discoveredAt: new Date(), liquidityUsd });
  const result = funnel.ingest([make('low', 1), make('one', 1_000), make('two', 2_000), make('three', 1_500)]);
  assert.deepEqual(result.observing.map((candidate) => candidate.token.token.mint), ['two', 'three']);
  assert.equal(result.rejected.length, 2);
  assert.equal(funnel.ingest([make('two', 2_000)]).duplicateCount, 1);
  assert.equal(funnel.release('two', 'Observation timeout')?.status, 'released');
});

test('Mayhem filter removes only candidates confirmed by the detector', async () => {
  const result = await excludeMayhemMode(
    [{ token: { mint: 'safe' } }, { token: { mint: 'mayhem' } }],
    { async isMayhemMode(mint) { return mint === 'mayhem'; } }
  );
  assert.deepEqual(result.accepted.map((candidate) => candidate.token.mint), ['safe']);
  assert.deepEqual(result.rejectedMints, ['mayhem']);
});

test('Helius Mayhem detector treats an existing state account as Mayhem Mode', async () => {
  const detector = new HeliusMayhemModeDetector('test-key', async () => ({
    ok: true,
    status: 200,
    async json() { return { jsonrpc: '2.0', result: { value: { lamports: 1 } } }; }
  }));
  assert.equal(await detector.isMayhemMode('So11111111111111111111111111111111111111112'), true);
});
