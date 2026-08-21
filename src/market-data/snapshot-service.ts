import type { MarketSnapshot } from '../core/market-data.js';
import type { MarketSnapshotRepository } from '../database/contracts.js';
import type { MarketDataProvider } from '../providers/contracts.js';

interface CacheEntry {
  readonly snapshot: MarketSnapshot;
  readonly cachedAt: Date;
}

export interface SnapshotServiceOptions {
  readonly cacheTtlMs: number;
  readonly now?: () => Date;
}

/**
 * The only code allowed to request on-demand snapshots. It prevents separate
 * token loops from making duplicate provider calls for the same mint.
 */
export class SnapshotService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<MarketSnapshot>>();
  private readonly now: () => Date;

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repository: MarketSnapshotRepository,
    options: SnapshotServiceOptions
  ) {
    this.now = options.now ?? (() => new Date());
    if (options.cacheTtlMs < 0) throw new Error('cacheTtlMs cannot be negative.');
    this.cacheTtlMs = options.cacheTtlMs;
  }

  private readonly cacheTtlMs: number;

  async get(tokenMint: string): Promise<MarketSnapshot> {
    const now = this.now();
    const cached = this.cache.get(tokenMint);
    if (cached && now.getTime() - cached.cachedAt.getTime() <= this.cacheTtlMs) {
      return cached.snapshot;
    }

    const pending = this.inFlight.get(tokenMint);
    if (pending) return pending;

    const request = this.fetchAndPersist(tokenMint);
    this.inFlight.set(tokenMint, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(tokenMint);
    }
  }

  private async fetchAndPersist(tokenMint: string): Promise<MarketSnapshot> {
    const result = await this.provider.getTokenSnapshot(tokenMint);
    if (result.data.token.mint !== tokenMint) {
      throw new Error(`Provider ${this.provider.name} returned a snapshot for a different token.`);
    }
    await this.repository.save(result.data);
    this.cache.set(tokenMint, { snapshot: result.data, cachedAt: this.now() });
    return result.data;
  }
}
