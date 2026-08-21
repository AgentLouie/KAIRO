import type { MarketSnapshot } from '../core/market-data.js';
import type { MarketSnapshotRepository } from './contracts.js';

/** Development-only repository used before PostgreSQL is connected. */
export class InMemoryMarketSnapshotRepository implements MarketSnapshotRepository {
  private readonly snapshots = new Map<string, MarketSnapshot[]>();

  async save(snapshot: MarketSnapshot): Promise<void> {
    const rows = this.snapshots.get(snapshot.token.mint) ?? [];
    rows.push(snapshot);
    this.snapshots.set(snapshot.token.mint, rows);
  }

  async recent(tokenMint: string, limit: number): Promise<readonly MarketSnapshot[]> {
    return (this.snapshots.get(tokenMint) ?? []).slice(-limit).reverse();
  }
}
