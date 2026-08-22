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
import { DiscoveryCycle } from '../src/discovery/discovery-cycle.js';
import type { CandidateRepository } from '../src/database/contracts.js';
import type { Candidate } from '../src/core/discovery.js';
import { SnapshotCycle } from '../src/market-data/snapshot-cycle.js';
import { createLogger } from '../src/logging/logger.js';
import { IntervalScheduler } from '../src/runtime/interval-scheduler.js';
import { MomentumEngine } from '../src/features/momentum-engine.js';
import { MomentumCycle } from '../src/features/momentum-cycle.js';
import { RiskEngine } from '../src/risk/risk-engine.js';
import { HeliusMintAuthorityProvider } from '../src/providers/helius/helius-mint-authority-provider.js';
import { BirdeyeHolderProvider } from '../src/providers/birdeye/birdeye-holder-provider.js';
import { BirdeyeHolderProfileProvider } from '../src/providers/birdeye/birdeye-holder-profile-provider.js';
import { HeliusWalletAgeProvider } from '../src/providers/helius/helius-wallet-age-provider.js';
import { FreshWalletAnalyzer } from '../src/risk/fresh-wallet-analyzer.js';
import { SignalEngine } from '../src/signals/signal-engine.js';
import { RiskCycle } from '../src/risk/risk-cycle.js';
import type { RiskEvidenceCollector } from '../src/risk/risk-evidence-collector.js';

test('defaults are paper-only and match the initial portfolio', () => {
  const app = loadAppConfig({});
  const portfolio = loadPaperPortfolioConfig({});
  assert.equal(app.tradingMode, 'paper');
  assert.equal(portfolio.startingBalanceSol, 10);
  assert.equal(portfolio.riskPerTradePct, 1);
  assert.equal(portfolio.maxConcurrentPositions, 3);
  assert.equal(portfolio.maxMonitoredTokens, 20);
  assert.equal(portfolio.maxRiskScore, 55);
  assert.equal(portfolio.minMomentumScore, 70);
  assert.equal(app.momentumIntervalMs, 300_000);
  assert.equal(app.riskIntervalMs, 300_000);
  assert.equal(app.signalIntervalMs, 60_000);
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
  assert.deepEqual(applied, ['001_foundation.sql', '002_candidate_discovery.sql', '003_momentum_features.sql', '004_risk_assessments.sql', '005_signals.sql']);
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

test('discovery cycle restores observing candidates and avoids rediscovering them after restart', async () => {
  const make = (mint: string, liquidityUsd: number) => ({ token: { mint }, source: 'pump_dot_fun' as const, discoveredAt: new Date(), liquidityUsd });
  const stored: import('../src/core/discovery.js').Candidate[] = [{ token: make('existing', 1_000), status: 'observing' }];
  const repository: CandidateRepository = {
    async save(candidate) { stored.push(candidate); },
    async observing() { return stored.filter((candidate) => candidate.status === 'observing'); },
    async release() {}
  };
  const cycle = new DiscoveryCycle(
    { name: 'fake', async listNewPumpFunTokens() { return [make('existing', 1_000), make('new', 2_000)]; } },
    { async isMayhemMode() { return false; } },
    new CandidateFunnel({ maxMonitoredTokens: 2, preliminaryMinLiquidityUsd: 500 }),
    repository
  );
  const result = await cycle.runOnce(20);
  assert.equal(result.skippedKnown, 1);
  assert.equal(result.observingAdded, 1);
  assert.deepEqual(result.monitored.map((candidate) => candidate.token.token.mint), ['existing', 'new']);
});

test('discovery cycle reuses a slot after a persisted candidate is released', async () => {
  const make = (mint: string) => ({ token: { mint }, source: 'pump_dot_fun' as const, discoveredAt: new Date(), liquidityUsd: 1_000 });
  const stored: import('../src/core/discovery.js').Candidate[] = [{ token: make('old'), status: 'observing' }];
  const repository: CandidateRepository = {
    async save(candidate) { stored.push(candidate); },
    async observing() { return stored.filter((candidate) => candidate.status === 'observing'); },
    async release(mint) { const active = stored.find((candidate) => candidate.token.token.mint === mint && candidate.status === 'observing'); if (active) Object.assign(active, { status: 'released' }); }
  };
  const cycle = new DiscoveryCycle(
    { name: 'fake', async listNewPumpFunTokens() { return [make('fresh')]; } },
    { async isMayhemMode() { return false; } },
    new CandidateFunnel({ maxMonitoredTokens: 1, preliminaryMinLiquidityUsd: 500 }),
    repository
  );

  await cycle.initialize();
  await repository.release('old', 'inactive');
  const result = await cycle.runOnce(20);
  assert.deepEqual(result.monitored.map((candidate) => candidate.token.token.mint), ['fresh']);
  assert.equal(result.observingAdded, 1);
});

test('snapshot cycle saves one fresh snapshot per monitored candidate while isolating failures', async () => {
  const stored: import('../src/core/discovery.js').Candidate[] = [
    { token: { token: { mint: 'good' }, source: 'pump_dot_fun', discoveredAt: new Date() }, status: 'observing' },
    { token: { token: { mint: 'bad' }, source: 'pump_dot_fun', discoveredAt: new Date() }, status: 'observing' }
  ];
  const repository: CandidateRepository = { async save() {}, async observing() { return stored; }, async release() {} };
  const snapshots = new SnapshotService({
    name: 'fake',
    async getTokenSnapshot(mint) {
      if (mint === 'bad') throw new Error('provider down');
      return { source: 'fake', fetchedAt: new Date(), data: { token: { mint }, observedAt: new Date(), provider: 'other' } };
    },
    async getTokenTrades() { return { source: 'fake', fetchedAt: new Date(), data: [] }; },
    async getTokenPrice() { return { source: 'fake', fetchedAt: new Date(), data: 1 }; },
    async getTokenLiquidity() { return { source: 'fake', fetchedAt: new Date(), data: undefined }; },
    async getTokenVolume() { return { source: 'fake', fetchedAt: new Date(), data: undefined }; }
  }, new InMemoryMarketSnapshotRepository(), { cacheTtlMs: 0 });
  const result = await new SnapshotCycle(repository, snapshots, createLogger('error'), 1, { maxAttempts: 1, requestSpacingMs: 0 }).runOnce();
  assert.deepEqual(result, { candidates: 2, saved: 1, failed: 1 });
});

test('scheduler prevents overlapping runs of the same task', async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = new IntervalScheduler({
    name: 'slow-task',
    async runOnce() { calls += 1; await waiting; }
  }, 1_000, createLogger('error'));
  const first = scheduler.runNow();
  await Promise.resolve();
  await scheduler.runNow();
  assert.equal(calls, 1);
  release?.();
  await first;
});

test('stopping an active snapshot cycle cancels its remaining pacing delay', async () => {
  const stored: import('../src/core/discovery.js').Candidate[] = [
    { token: { token: { mint: 'one' }, source: 'pump_dot_fun', discoveredAt: new Date() }, status: 'observing' },
    { token: { token: { mint: 'two' }, source: 'pump_dot_fun', discoveredAt: new Date() }, status: 'observing' }
  ];
  const repository: CandidateRepository = { async save() {}, async observing() { return stored; }, async release() {} };
  const snapshots = new SnapshotService({
    name: 'fake',
    async getTokenSnapshot(mint) { return { source: 'fake', fetchedAt: new Date(), data: { token: { mint }, observedAt: new Date(), provider: 'other' } }; },
    async getTokenTrades() { return { source: 'fake', fetchedAt: new Date(), data: [] }; },
    async getTokenPrice() { return { source: 'fake', fetchedAt: new Date(), data: 1 }; },
    async getTokenLiquidity() { return { source: 'fake', fetchedAt: new Date(), data: undefined }; },
    async getTokenVolume() { return { source: 'fake', fetchedAt: new Date(), data: undefined }; }
  }, new InMemoryMarketSnapshotRepository(), { cacheTtlMs: 0 });
  const cycle = new SnapshotCycle(repository, snapshots, createLogger('error'), 1, { requestSpacingMs: 1_000 });
  const run = cycle.runOnce();
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  cycle.stop();
  const result = await run;
  assert.equal(result.saved, 1);
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

test('momentum engine produces an explainable score from two complete snapshots', () => {
  const engine = new MomentumEngine();
  const result = engine.evaluate([
    { token: { mint: 'mint' }, observedAt: new Date('2026-08-22T00:00:00Z'), provider: 'other', marketCapUsd: 10_000, volume1mUsd: 100, buyVolume1mUsd: 50, sellVolume1mUsd: 50, buys1m: 5, sells1m: 5 },
    { token: { mint: 'mint' }, observedAt: new Date('2026-08-22T00:05:00Z'), provider: 'other', marketCapUsd: 12_000, volume1mUsd: 300, buyVolume1mUsd: 240, sellVolume1mUsd: 60, buys1m: 16, sells1m: 4 }
  ]);
  assert.equal(result.status, 'ready');
  assert.equal(result.score, 95);
  assert.equal(result.metrics.marketCapReturnPct, 20);
  assert.equal(result.metrics.buyPressure, 0.8);
});

test('momentum engine marks incomplete history as insufficient data', () => {
  const result = new MomentumEngine().evaluate([{ token: { mint: 'mint' }, observedAt: new Date(), provider: 'other' }]);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.score, undefined);
});

test('momentum cycle waits cleanly for a newly discovered token without snapshots', async () => {
  const saved: unknown[] = [];
  const cycle = new MomentumCycle(
    {
      async save() {},
      async observing() {
        return [{ token: { token: { mint: 'new-mint' }, source: 'pump_dot_fun', discoveredAt: new Date() }, status: 'observing' as const }];
      },
      async release() {}
    },
    new InMemoryMarketSnapshotRepository(),
    {
      async save(feature) { saved.push(feature); },
      async latest() { return undefined; }
    }
  );

  assert.deepEqual(await cycle.runOnce(), { evaluated: 1, ready: 0, insufficientData: 1 });
  assert.equal(saved.length, 0);
});

test('risk engine can assess a fully exited developer without treating it as an automatic rejection', () => {
  const result = new RiskEngine().evaluate({
    token: { mint: 'mint' }, observedAt: new Date(), mayhemMode: false,
    mintAuthority: 'safe', freezeAuthority: 'safe', liquidityUsd: 25_000, marketCapUsd: 100_000,
    topHolderPct: 0.2, freshWalletPct: 0.2, bundledPct: 0.05, insiderPct: 0.05,
    developerPosition: 'fully_exited', developerRecentSelling: false
  });
  assert.equal(result.status, 'assessed');
  assert.ok((result.score ?? 100) < 55);
  assert.match(result.reasons.at(-1) ?? '', /not an automatic rejection/);
});

test('risk engine rejects an active freeze authority and fails closed for missing wallet evidence', () => {
  const engine = new RiskEngine();
  const rejected = engine.evaluate({ token: { mint: 'mint' }, observedAt: new Date(), mayhemMode: false, mintAuthority: 'safe', freezeAuthority: 'unsafe', developerPosition: 'unknown' });
  assert.equal(rejected.status, 'rejected');
  const incomplete = engine.evaluate({ token: { mint: 'mint' }, observedAt: new Date(), mayhemMode: false, mintAuthority: 'safe', freezeAuthority: 'safe', developerPosition: 'unknown' });
  assert.equal(incomplete.status, 'insufficient_data');
});

test('risk cycle prioritizes tokens without an existing assessment', async () => {
  const visited: string[] = [];
  const candidate = (mint: string) => ({ token: { token: { mint }, source: 'pump_dot_fun' as const, discoveredAt: new Date() }, status: 'observing' as const });
  const cycle = new RiskCycle(
    { async save() {}, async observing() { return [candidate('already-reviewed'), candidate('unreviewed')]; }, async release() {} },
    {
      async collect(item: Candidate) {
        visited.push(item.token.token.mint);
        return { token: item.token.token, observedAt: new Date(), mayhemMode: false, mintAuthority: 'safe' as const, freezeAuthority: 'safe' as const, liquidityUsd: 25_000, marketCapUsd: 100_000, topHolderPct: 0.2, freshWalletPct: 0.1, bundledPct: 0.05, insiderPct: 0.05, developerPosition: 'fully_exited' as const, developerRecentSelling: false };
      }
    } as unknown as RiskEvidenceCollector,
    {
      async save() {},
      async latest(mint) { return mint === 'already-reviewed' ? { token: { mint }, observedAt: new Date('2026-08-22T00:00:00Z'), engineVersion: 'risk-v1' as const, status: 'assessed' as const, score: 10, reasons: [] } : undefined; }
    }
  );

  await cycle.runOnce(1);
  assert.deepEqual(visited, ['unreviewed']);
});

test('Helius mint-authority provider maps null authorities to safe', async () => {
  const provider = new HeliusMintAuthorityProvider('test-key', async () => ({
    ok: true, status: 200,
    async json() { return { jsonrpc: '2.0', result: { value: { data: { parsed: { type: 'mint', info: { mintAuthority: null, freezeAuthority: null } } } } } }; }
  }));
  assert.deepEqual((await provider.getMintAuthorities('mint')).data, { mintAuthority: 'safe', freezeAuthority: 'safe' });
});

test('Birdeye holder provider normalizes top-ten percentage as a fraction', async () => {
  const provider = new BirdeyeHolderProvider('test-key', async () => ({
    ok: true, status: 200,
    async json() { return { success: true, data: { holder: 123, top10_hold_percent: 42.5 } }; }
  }));
  const result = await provider.getConcentration('mint');
  assert.equal(result.holderCount, 123);
  assert.equal(result.top10HoldPct, 0.425);
});

test('Birdeye holder profile maps labeled exposure and a fully exited developer', async () => {
  const provider = new BirdeyeHolderProfileProvider('test-key', async () => ({
    ok: true, status: 200,
    async json() { return { success: true, data: { tags: [
      { tag: 'bundler', holder_count: 2, percent_of_supply: 12, sell_volume: '0' },
      { tag: 'insider', holder_count: 1, percent_of_supply: 3, sell_volume: '0' },
      { tag: 'dev', holder_count: 1, percent_of_supply: 0, sell_volume: '20' }
    ] } }; }
  }));
  const result = await provider.getProfile('mint');
  assert.equal(result.bundledPct, 0.12);
  assert.equal(result.insiderPct, 0.03);
  assert.equal(result.developerPosition, 'fully_exited');
  assert.equal(result.developerRecentSelling, true);
});

test('fresh-wallet analyzer estimates supply share from the top-holder wallet sample', async () => {
  const holders = new BirdeyeHolderProvider('test-key', async () => ({
    ok: true, status: 200,
    async json() { return { success: true, data: { top10_hold_percent: 40, items: [{ owner: 'old', amount: 75 }, { owner: 'fresh', amount: 25 }] } }; }
  }));
  const ages = new HeliusWalletAgeProvider('test-key', async (_url, init) => ({
    ok: true, status: 200,
    async json() {
      const wallet = (JSON.parse(init.body) as { params: [string] }).params[0];
      const blockTime = wallet === 'fresh' ? 172_800 : 0;
      return { jsonrpc: '2.0', result: { data: [{ blockTime }] } };
    }
  }));
  const result = await new FreshWalletAnalyzer(holders, ages, 1, () => new Date(172_800 * 1_000)).analyze('mint');
  assert.equal(result.freshWalletPct, 0.1);
  assert.equal(result.freshWallets, 1);
});

test('signal engine only emits a paper buy when momentum and independent risk both pass', () => {
  const decision = new SignalEngine().evaluate({
    token: { mint: 'mint' }, observedAt: new Date(), minMomentumScore: 70, maxRiskScore: 55,
    momentum: { token: { mint: 'mint' }, observedAt: new Date(), engineVersion: 'momentum-v1', status: 'ready', score: 80, metrics: {}, reasons: [] },
    risk: { token: { mint: 'mint' }, observedAt: new Date(), engineVersion: 'risk-v1', status: 'assessed', score: 35, reasons: [] }
  });
  assert.equal(decision.action, 'paper_buy');
  const blocked = new SignalEngine().evaluate({ token: { mint: 'mint' }, observedAt: new Date(), minMomentumScore: 70, maxRiskScore: 55, risk: { token: { mint: 'mint' }, observedAt: new Date(), engineVersion: 'risk-v1', status: 'insufficient_data', reasons: ['Missing data.'] } });
  assert.equal(blocked.action, 'watch');
});
