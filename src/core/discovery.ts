import type { TokenRef } from './market-data.js';

export type CandidateStatus = 'observing' | 'rejected' | 'released';

export interface DiscoveredToken {
  readonly token: TokenRef;
  readonly source: 'pump_dot_fun';
  readonly discoveredAt: Date;
  readonly liquidityUsd?: number;
}

export interface Candidate {
  readonly token: DiscoveredToken;
  readonly status: CandidateStatus;
  readonly reason?: string;
}
