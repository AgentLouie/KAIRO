import type { MarketSnapshot } from '../core/market-data.js';
import type { Candidate } from '../core/discovery.js';
import type { MomentumFeatureSet } from '../features/momentum-engine.js';
import type { RiskAssessment } from '../risk/risk-engine.js';

export interface HealthRepository {
  ping(): Promise<void>;
}

export interface MarketSnapshotRepository {
  save(snapshot: MarketSnapshot): Promise<void>;
  recent(tokenMint: string, limit: number): Promise<readonly MarketSnapshot[]>;
}

export interface CandidateRepository {
  save(candidate: Candidate): Promise<void>;
  observing(): Promise<readonly Candidate[]>;
}

export interface MomentumFeatureRepository {
  save(feature: MomentumFeatureSet): Promise<void>;
}

export interface RiskAssessmentRepository {
  save(assessment: RiskAssessment): Promise<void>;
}
