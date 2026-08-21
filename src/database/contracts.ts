import type { MarketSnapshot } from '../core/market-data.js';

export interface HealthRepository {
  ping(): Promise<void>;
}

export interface MarketSnapshotRepository {
  save(snapshot: MarketSnapshot): Promise<void>;
  recent(tokenMint: string, limit: number): Promise<readonly MarketSnapshot[]>;
}

// PostgreSQL will implement these contracts in the database milestone; no live
// persistence is claimed while STORAGE_DRIVER=memory.
