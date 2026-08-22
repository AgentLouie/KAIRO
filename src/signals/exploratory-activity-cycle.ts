import type { CandidateRepository, MarketSnapshotRepository, RiskAssessmentRepository, SignalRepository } from '../database/contracts.js';
import type { SignalDecision } from './signal-engine.js';

/** Paper-only sampling mode. Its results are labelled separately from the main strategy. */
export class ExploratoryActivityCycle {
  constructor(private readonly candidates: CandidateRepository, private readonly snapshots: MarketSnapshotRepository, private readonly risks: RiskAssessmentRepository, private readonly signals: SignalRepository, private readonly minimumVolume1mUsd: number, private readonly maxRiskScore: number) {}
  async runOnce(): Promise<{ queued: number }> {
    const eligible = [] as { token: SignalDecision['token']; volume: number }[];
    for (const candidate of await this.candidates.observing()) {
      const [snapshot] = await this.snapshots.recent(candidate.token.token.mint, 1);
      const risk = await this.risks.latest(candidate.token.token.mint);
      const volume = snapshot?.volume1mUsd ?? 0;
      const trades = (snapshot?.buys1m ?? 0) + (snapshot?.sells1m ?? 0);
      if (!snapshot || volume < this.minimumVolume1mUsd || trades === 0 || risk?.status !== 'assessed' || risk.score === undefined || risk.score > this.maxRiskScore) continue;
      eligible.push({ token: candidate.token.token, volume });
    }
    const chosen = eligible.sort((a, b) => b.volume - a.volume).slice(0, 3);
    for (const item of chosen) await this.signals.save({ token: item.token, observedAt: new Date(), strategyVersion: 'exploratory-activity-v1', action: 'paper_buy', reasons: [`Exploratory paper-only entry: ranked in the top three eligible tokens by one-minute volume ($${item.volume.toFixed(2)}).`, 'Passed the existing independent risk limit. Excluded from main-strategy evaluation.'] });
    return { queued: chosen.length };
  }
}
