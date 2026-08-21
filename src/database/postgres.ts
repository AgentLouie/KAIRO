import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { MarketSnapshot } from '../core/market-data.js';
import type { HealthRepository, MarketSnapshotRepository } from './contracts.js';

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
