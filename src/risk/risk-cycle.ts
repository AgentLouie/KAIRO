import type { CandidateRepository, RiskAssessmentRepository } from '../database/contracts.js';
import { RiskEngine, type RiskAssessment } from './risk-engine.js';
import { RiskEvidenceCollector } from './risk-evidence-collector.js';

export class RiskCycle {
  constructor(private readonly candidates: CandidateRepository, private readonly collector: RiskEvidenceCollector, private readonly assessments: RiskAssessmentRepository, private readonly engine = new RiskEngine()) {}

  async runOnce(limit: number): Promise<{ evaluated: number; assessed: number; blocked: number }> {
    const allCandidates = await this.candidates.observing();
    const candidates = (await Promise.all(allCandidates.map(async (candidate) => ({
      candidate,
      latest: await this.assessments.latest(candidate.token.token.mint)
    }))))
      // Unknown risk is the most important state to resolve. Once every token has
      // an assessment, revisit the oldest evidence first.
      .sort((left, right) => {
        if (!left.latest && right.latest) return -1;
        if (left.latest && !right.latest) return 1;
        return (left.latest?.observedAt.getTime() ?? 0) - (right.latest?.observedAt.getTime() ?? 0);
      })
      .slice(0, limit)
      .map(({ candidate }) => candidate);
    let assessed = 0;
    let blocked = 0;
    for (const candidate of candidates) {
      let assessment: RiskAssessment;
      try {
        assessment = this.engine.evaluate(await this.collector.collect(candidate));
      } catch (error) {
        assessment = { token: candidate.token.token, observedAt: new Date(), engineVersion: 'risk-v1', status: 'insufficient_data', reasons: [`Risk data collection failed: ${error instanceof Error ? error.message : String(error)}`] };
      }
      await this.assessments.save(assessment);
      if (assessment.status === 'assessed') assessed += 1;
      else blocked += 1;
    }
    return { evaluated: candidates.length, assessed, blocked };
  }
}
