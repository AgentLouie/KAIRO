import type { CandidateRepository, MomentumFeatureRepository, RiskAssessmentRepository, SignalRepository } from '../database/contracts.js';
import { SignalEngine } from './signal-engine.js';

export class SignalCycle {
  constructor(private readonly candidates: CandidateRepository, private readonly momentum: MomentumFeatureRepository, private readonly risk: RiskAssessmentRepository, private readonly signals: SignalRepository, private readonly engine = new SignalEngine(), private readonly minMomentumScore = 70, private readonly maxRiskScore = 55) {}
  async runOnce(): Promise<{ evaluated: number; paperBuy: number; watch: number; reject: number }> {
    let paperBuy = 0, watch = 0, reject = 0;
    for (const candidate of await this.candidates.observing()) {
      const momentum = await this.momentum.latest(candidate.token.token.mint);
      const risk = await this.risk.latest(candidate.token.token.mint);
      const decision = this.engine.evaluate({ token: candidate.token.token, observedAt: new Date(), ...(momentum ? { momentum } : {}), ...(risk ? { risk } : {}), minMomentumScore: this.minMomentumScore, maxRiskScore: this.maxRiskScore });
      await this.signals.save(decision);
      if (decision.action === 'paper_buy') paperBuy += 1; else if (decision.action === 'watch') watch += 1; else reject += 1;
    }
    return { evaluated: paperBuy + watch + reject, paperBuy, watch, reject };
  }
}
