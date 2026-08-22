import type { CandidateRepository, MarketSnapshotRepository } from '../database/contracts.js';

/** Releases candidates that have two consecutive empty one-minute activity readings. */
export class ActivityPruner {
  constructor(private readonly candidates: CandidateRepository, private readonly snapshots: MarketSnapshotRepository) {}
  async runOnce(): Promise<{ reviewed: number; released: number }> {
    const candidates = await this.candidates.observing(); let released = 0;
    for (const candidate of candidates) {
      const recent = await this.snapshots.recent(candidate.token.token.mint, 2);
      if (recent.length < 2 || !recent.every((snapshot) => (snapshot.volume1mUsd ?? 0) === 0 && (snapshot.buys1m ?? 0) + (snapshot.sells1m ?? 0) === 0)) continue;
      await this.candidates.release(candidate.token.token.mint, 'Released: two consecutive snapshots had zero one-minute volume and zero trades.');
      released += 1;
    }
    return { reviewed: candidates.length, released };
  }
}
