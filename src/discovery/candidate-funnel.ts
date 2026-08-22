import type { Candidate, DiscoveredToken } from '../core/discovery.js';

export interface CandidateFunnelOptions {
  readonly maxMonitoredTokens: number;
  readonly preliminaryMinLiquidityUsd: number;
}

export interface IngestResult {
  readonly observing: readonly Candidate[];
  readonly rejected: readonly Candidate[];
  readonly duplicateCount: number;
}

/** A bounded, deterministic in-memory queue for the early discovery phase. */
export class CandidateFunnel {
  private readonly known = new Set<string>();
  private readonly active = new Map<string, Candidate>();

  constructor(private readonly options: CandidateFunnelOptions) {
    if (!Number.isInteger(options.maxMonitoredTokens) || options.maxMonitoredTokens < 1) {
      throw new Error('maxMonitoredTokens must be a positive integer.');
    }
  }

  ingest(tokens: readonly DiscoveredToken[]): IngestResult {
    const observing: Candidate[] = [];
    const rejected: Candidate[] = [];
    let duplicateCount = 0;
    const ranked = [...tokens].sort((left, right) => (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0));

    for (const token of ranked) {
      if (this.known.has(token.token.mint)) {
        duplicateCount += 1;
        continue;
      }
      this.known.add(token.token.mint);
      if ((token.liquidityUsd ?? 0) < this.options.preliminaryMinLiquidityUsd) {
        rejected.push({ token, status: 'rejected', reason: 'Preliminary liquidity below configured minimum.' });
        continue;
      }
      if (this.active.size >= this.options.maxMonitoredTokens) {
        rejected.push({ token, status: 'rejected', reason: 'Deep-monitoring capacity is full.' });
        continue;
      }
      const candidate: Candidate = { token, status: 'observing' };
      this.active.set(token.token.mint, candidate);
      observing.push(candidate);
    }
    return { observing, rejected, duplicateCount };
  }

  restore(candidates: readonly Candidate[]): void {
    for (const candidate of candidates) {
      if (candidate.status !== 'observing' || this.active.has(candidate.token.token.mint)) continue;
      if (this.active.size >= this.options.maxMonitoredTokens) {
        throw new Error('Persisted observing candidates exceed the configured monitoring limit.');
      }
      this.known.add(candidate.token.token.mint);
      this.active.set(candidate.token.token.mint, candidate);
    }
  }

  /** Keeps the process-local capacity counter aligned with persisted releases. */
  synchronize(candidates: readonly Candidate[]): void {
    const observing = new Set(candidates.filter((candidate) => candidate.status === 'observing').map((candidate) => candidate.token.token.mint));
    for (const mint of this.active.keys()) {
      if (!observing.has(mint)) this.active.delete(mint);
    }
    this.restore(candidates);
  }

  isKnown(tokenMint: string): boolean {
    return this.known.has(tokenMint);
  }

  release(tokenMint: string, reason: string): Candidate | undefined {
    const active = this.active.get(tokenMint);
    if (!active) return undefined;
    this.active.delete(tokenMint);
    return { ...active, status: 'released', reason };
  }

  monitoring(): readonly Candidate[] {
    return [...this.active.values()];
  }
}
