import type { CandidateRepository, RiskAssessmentRepository } from '../database/contracts.js';
import { RiskEngine, type RiskAssessment } from './risk-engine.js';
import { RiskEvidenceCollector } from './risk-evidence-collector.js';

export class RiskCycle {
  private cursor = 0;
  constructor(private readonly candidates: CandidateRepository, private readonly collector: RiskEvidenceCollector, private readonly assessments: RiskAssessmentRepository, private readonly engine = new RiskEngine()) {}

  async runOnce(limit: number): Promise<{ evaluated: number; assessed: number; blocked: number }> {
    const allCandidates = await this.candidates.observing();
    const candidates = allCandidates.length === 0 ? [] : Array.from({ length: Math.min(limit, allCandidates.length) }, (_, index) => allCandidates[(this.cursor + index) % allCandidates.length]).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
    this.cursor = allCandidates.length === 0 ? 0 : (this.cursor + candidates.length) % allCandidates.length;
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
