import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { MarketSnapshot } from '../core/market-data.js';
import type { Candidate } from '../core/discovery.js';
import type { CandidateRepository, HealthRepository, MarketSnapshotRepository } from './contracts.js';
import type { MomentumFeatureRepository } from './contracts.js';
import type { MomentumFeatureSet } from '../features/momentum-engine.js';
import type { RiskAssessment } from '../risk/risk-engine.js';
import type { RiskAssessmentRepository } from './contracts.js';
import type { SignalRepository } from './contracts.js';
import type { SignalDecision } from '../signals/signal-engine.js';

export interface SqlClient {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[] }>;
  end?(): Promise<void>;
}

export interface TransactionalSqlClient extends SqlClient {
  withTransaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T>;
}

class PostgresClient implements TransactionalSqlClient {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const config: PoolConfig = { connectionString, max: 5, idleTimeoutMillis: 10_000 };
    this.pool = new Pool(config);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[] }> {
    return this.pool.query(text, values as unknown[] | undefined);
  }

  async withTransaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await operation({
        query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
          return connection.query<Row>(text, values as unknown[] | undefined);
        }
      });
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export function createPostgresClient(connectionString: string): TransactionalSqlClient {
  return new PostgresClient(connectionString);
}

export class PostgresHealthRepository implements HealthRepository {
  constructor(private readonly client: SqlClient) {}

  async ping(): Promise<void> {
    await this.client.query('SELECT 1');
  }
}

export class PostgresMarketSnapshotRepository implements MarketSnapshotRepository {
  constructor(private readonly client: SqlClient) {}

  async save(snapshot: MarketSnapshot): Promise<void> {
    await this.client.query(
      `INSERT INTO tokens (mint, symbol, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (mint) DO UPDATE SET
         symbol = COALESCE(EXCLUDED.symbol, tokens.symbol),
         name = COALESCE(EXCLUDED.name, tokens.name),
         updated_at = NOW()`,
      [snapshot.token.mint, snapshot.token.symbol ?? null, snapshot.token.name ?? null]
    );
    await this.client.query(
      `INSERT INTO market_snapshots (
         token_mint, observed_at, provider, price_usd, market_cap_usd, liquidity_usd,
         volume_1m_usd, buy_volume_1m_usd, sell_volume_1m_usd, buys_1m, sells_1m,
         unique_traders_1m, unique_buyers_1m, unique_sellers_1m
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        snapshot.token.mint, snapshot.observedAt, snapshot.provider, snapshot.priceUsd ?? null,
        snapshot.marketCapUsd ?? null, snapshot.liquidityUsd ?? null, snapshot.volume1mUsd ?? null,
        snapshot.buyVolume1mUsd ?? null, snapshot.sellVolume1mUsd ?? null, snapshot.buys1m ?? null,
        snapshot.sells1m ?? null, snapshot.uniqueTraders1m ?? null, snapshot.uniqueBuyers1m ?? null,
        snapshot.uniqueSellers1m ?? null
      ]
    );
  }

  async recent(tokenMint: string, limit: number): Promise<readonly MarketSnapshot[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Snapshot limit must be a positive integer.');
    const result = await this.client.query<SnapshotRow>(
      `SELECT s.token_mint, t.symbol, t.name, s.observed_at, s.provider, s.price_usd,
              s.market_cap_usd, s.liquidity_usd, s.volume_1m_usd, s.buy_volume_1m_usd,
              s.sell_volume_1m_usd, s.buys_1m, s.sells_1m, s.unique_traders_1m,
              s.unique_buyers_1m, s.unique_sellers_1m
       FROM market_snapshots s
       JOIN tokens t ON t.mint = s.token_mint
       WHERE s.token_mint = $1
       ORDER BY s.observed_at DESC
       LIMIT $2`,
      [tokenMint, limit]
    );
    return result.rows.map(snapshotFromRow);
  }
}

export class PostgresCandidateRepository implements CandidateRepository {
  constructor(private readonly client: SqlClient) {}

  async save(candidate: Candidate): Promise<void> {
    const { token } = candidate;
    await this.client.query(
      `INSERT INTO tokens (mint, symbol, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (mint) DO UPDATE SET
         symbol = COALESCE(EXCLUDED.symbol, tokens.symbol),
         name = COALESCE(EXCLUDED.name, tokens.name),
         updated_at = NOW()`,
      [token.token.mint, token.token.symbol ?? null, token.token.name ?? null]
    );
    await this.client.query(
      `INSERT INTO candidates (token_mint, source, discovered_at, status, reason, liquidity_usd)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (token_mint) WHERE (status = 'observing') DO UPDATE SET
         source = EXCLUDED.source,
         discovered_at = EXCLUDED.discovered_at,
         reason = EXCLUDED.reason,
         liquidity_usd = EXCLUDED.liquidity_usd,
         updated_at = NOW()`,
      [token.token.mint, token.source, token.discoveredAt, candidate.status, candidate.reason ?? null, token.liquidityUsd ?? null]
    );
  }

  async observing(): Promise<readonly Candidate[]> {
    const result = await this.client.query<CandidateRow>(
      `SELECT c.token_mint, t.symbol, t.name, c.source, c.discovered_at, c.status, c.reason, c.liquidity_usd
       FROM candidates c
       JOIN tokens t ON t.mint = c.token_mint
       WHERE c.status = 'observing'
       ORDER BY c.liquidity_usd DESC NULLS LAST, c.discovered_at ASC`
    );
    return result.rows.map(candidateFromRow);
  }

  async release(tokenMint: string, reason: string): Promise<void> {
    await this.client.query("UPDATE candidates SET status='released', reason=$2, updated_at=NOW() WHERE token_mint=$1 AND status='observing'", [tokenMint, reason]);
  }
}

export class PostgresMomentumFeatureRepository implements MomentumFeatureRepository {
  constructor(private readonly client: SqlClient) {}

  async save(feature: MomentumFeatureSet): Promise<void> {
    await this.client.query(
      `INSERT INTO feature_sets (token_mint, observed_at, engine_version, status, momentum_score, metrics, reasons)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        feature.token.mint,
        feature.observedAt,
        feature.engineVersion,
        feature.status,
        feature.score ?? null,
        JSON.stringify(feature.metrics),
        JSON.stringify(feature.reasons)
      ]
    );
  }
  async latest(tokenMint: string): Promise<MomentumFeatureSet | undefined> {
    const result = await this.client.query<any>('SELECT f.observed_at, f.engine_version, f.status, f.momentum_score, f.metrics, f.reasons, t.symbol, t.name FROM feature_sets f JOIN tokens t ON t.mint=f.token_mint WHERE f.token_mint=$1 ORDER BY f.observed_at DESC LIMIT 1', [tokenMint]);
    const row = result.rows[0]; if (!row) return undefined;
    return { token: { mint: tokenMint, ...(row.symbol ? { symbol: row.symbol } : {}), ...(row.name ? { name: row.name } : {}) }, observedAt: new Date(row.observed_at), engineVersion: row.engine_version, status: row.status, ...(row.momentum_score === null ? {} : { score: Number(row.momentum_score) }), metrics: row.metrics, reasons: row.reasons };
  }
}

export class PostgresRiskAssessmentRepository implements RiskAssessmentRepository {
  constructor(private readonly client: SqlClient) {}

  async save(assessment: RiskAssessment): Promise<void> {
    await this.client.query(
      `INSERT INTO risk_assessments (token_mint, observed_at, engine_version, status, risk_score, evidence, reasons)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [assessment.token.mint, assessment.observedAt, assessment.engineVersion, assessment.status, assessment.score ?? null, JSON.stringify(assessment.evidence ?? {}), JSON.stringify(assessment.reasons)]
    );
  }
  async latest(tokenMint: string): Promise<RiskAssessment | undefined> {
    const result = await this.client.query<any>('SELECT r.observed_at, r.engine_version, r.status, r.risk_score, r.reasons, t.symbol, t.name FROM risk_assessments r JOIN tokens t ON t.mint=r.token_mint WHERE r.token_mint=$1 ORDER BY r.observed_at DESC LIMIT 1', [tokenMint]);
    const row = result.rows[0]; if (!row) return undefined;
    return { token: { mint: tokenMint, ...(row.symbol ? { symbol: row.symbol } : {}), ...(row.name ? { name: row.name } : {}) }, observedAt: new Date(row.observed_at), engineVersion: row.engine_version, status: row.status, ...(row.risk_score === null ? {} : { score: Number(row.risk_score) }), reasons: row.reasons };
  }
}

export class PostgresSignalRepository implements SignalRepository {
  constructor(private readonly client: SqlClient) {}
  async save(signal: SignalDecision): Promise<void> {
    await this.client.query('INSERT INTO signals (token_mint, observed_at, strategy_version, action, reasons) VALUES ($1,$2,$3,$4,$5::jsonb)', [signal.token.mint, signal.observedAt, signal.strategyVersion, signal.action, JSON.stringify(signal.reasons)]);
  }
}

interface SnapshotRow extends QueryResultRow {
  token_mint: string;
  symbol: string | null;
  name: string | null;
  observed_at: Date;
  provider: string;
  price_usd: string | number | null;
  market_cap_usd: string | number | null;
  liquidity_usd: string | number | null;
  volume_1m_usd: string | number | null;
  buy_volume_1m_usd: string | number | null;
  sell_volume_1m_usd: string | number | null;
  buys_1m: number | null;
  sells_1m: number | null;
  unique_traders_1m: number | null;
  unique_buyers_1m: number | null;
  unique_sellers_1m: number | null;
}

interface CandidateRow extends QueryResultRow {
  token_mint: string;
  symbol: string | null;
  name: string | null;
  source: 'pump_dot_fun';
  discovered_at: Date;
  status: 'observing';
  reason: string | null;
  liquidity_usd: string | number | null;
}

function optionalNumber(value: string | number | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function snapshotFromRow(row: SnapshotRow): MarketSnapshot {
  const priceUsd = optionalNumber(row.price_usd);
  const marketCapUsd = optionalNumber(row.market_cap_usd);
  const liquidityUsd = optionalNumber(row.liquidity_usd);
  const volume1mUsd = optionalNumber(row.volume_1m_usd);
  const buyVolume1mUsd = optionalNumber(row.buy_volume_1m_usd);
  const sellVolume1mUsd = optionalNumber(row.sell_volume_1m_usd);
  return {
    token: { mint: row.token_mint, ...(row.symbol ? { symbol: row.symbol } : {}), ...(row.name ? { name: row.name } : {}) },
    observedAt: new Date(row.observed_at),
    provider: row.provider === 'birdeye' || row.provider === 'helius' || row.provider === 'solana-rpc' ? row.provider : 'other',
    ...(priceUsd !== undefined ? { priceUsd } : {}),
    ...(marketCapUsd !== undefined ? { marketCapUsd } : {}),
    ...(liquidityUsd !== undefined ? { liquidityUsd } : {}),
    ...(volume1mUsd !== undefined ? { volume1mUsd } : {}),
    ...(buyVolume1mUsd !== undefined ? { buyVolume1mUsd } : {}),
    ...(sellVolume1mUsd !== undefined ? { sellVolume1mUsd } : {}),
    ...(row.buys_1m !== null ? { buys1m: row.buys_1m } : {}),
    ...(row.sells_1m !== null ? { sells1m: row.sells_1m } : {}),
    ...(row.unique_traders_1m !== null ? { uniqueTraders1m: row.unique_traders_1m } : {}),
    ...(row.unique_buyers_1m !== null ? { uniqueBuyers1m: row.unique_buyers_1m } : {}),
    ...(row.unique_sellers_1m !== null ? { uniqueSellers1m: row.unique_sellers_1m } : {})
  };
}

function candidateFromRow(row: CandidateRow): Candidate {
  return {
    token: {
      token: { mint: row.token_mint, ...(row.symbol ? { symbol: row.symbol } : {}), ...(row.name ? { name: row.name } : {}) },
      source: row.source,
      discoveredAt: new Date(row.discovered_at),
      ...(row.liquidity_usd === null ? {} : { liquidityUsd: Number(row.liquidity_usd) })
    },
    status: row.status,
    ...(row.reason ? { reason: row.reason } : {})
  };
}
