import type { CandidateRepository, MarketSnapshotRepository, MomentumFeatureRepository } from '../database/contracts.js';
import { MomentumEngine } from './momentum-engine.js';

export interface MomentumCycleResult {
  readonly evaluated: number;
  readonly ready: number;
  readonly insufficientData: number;
}

export class MomentumCycle {
  constructor(
    private readonly candidates: CandidateRepository,
    private readonly snapshots: MarketSnapshotRepository,
    private readonly features: MomentumFeatureRepository,
    private readonly engine = new MomentumEngine()
  ) {}

  async runOnce(): Promise<MomentumCycleResult> {
    const monitored = await this.candidates.observing();
    let ready = 0;
    let insufficientData = 0;
    for (const candidate of monitored) {
      const snapshots = await this.snapshots.recent(candidate.token.token.mint, 2);
      // A token can be discovered after the snapshot cycle has already begun.
      // There is no timestamp from which to create a meaningful feature yet, so
      // wait for its first stored observation instead of failing the scheduler.
      if (snapshots.length === 0) {
        insufficientData += 1;
        continue;
      }
      const feature = this.engine.evaluate(snapshots);
      await this.features.save(feature);
      if (feature.status === 'ready') ready += 1;
      else insufficientData += 1;
    }
    return { evaluated: monitored.length, ready, insufficientData };
  }
}
