import type { MomentumFeatureSet } from '../features/momentum-engine.js';
import type { RiskAssessment } from '../risk/risk-engine.js';
import type { TokenRef } from '../core/market-data.js';

export type SignalAction = 'paper_buy' | 'watch' | 'reject';

export interface SignalDecision {
  readonly token: TokenRef;
  readonly observedAt: Date;
  readonly strategyVersion: 'confirmed-momentum-v1';
  readonly action: SignalAction;
  readonly reasons: readonly string[];
}

export class SignalEngine {
  evaluate(input: { token: TokenRef; observedAt: Date; momentum?: MomentumFeatureSet; risk?: RiskAssessment; minMomentumScore: number; maxRiskScore: number }): SignalDecision {
    const reasons: string[] = [];
    if (!input.momentum) return watch(input, ['Waiting for momentum history.']);
    if (!input.risk) return watch(input, ['Waiting for independent risk evidence.']);
    if (input.risk.status === 'rejected') return reject(input, input.risk.reasons);
    if (input.risk.status !== 'assessed' || input.risk.score === undefined) return watch(input, input.risk.reasons);
    if (input.risk.score > input.maxRiskScore) return reject(input, [`Risk score ${input.risk.score}/100 exceeds maximum ${input.maxRiskScore}/100.`, ...input.risk.reasons]);
    if (input.momentum.status !== 'ready' || input.momentum.score === undefined) return watch(input, input.momentum.reasons);
    if (input.momentum.score < input.minMomentumScore) return watch(input, [`Momentum score ${input.momentum.score}/100 is below minimum ${input.minMomentumScore}/100.`, ...input.momentum.reasons]);
    reasons.push(`Momentum ${input.momentum.score}/100 meets minimum ${input.minMomentumScore}/100.`);
    reasons.push(`Risk ${input.risk.score}/100 is within maximum ${input.maxRiskScore}/100.`);
    reasons.push('PAPER BUY is a research signal only; no position is opened by this engine.');
    return { token: input.token, observedAt: input.observedAt, strategyVersion: 'confirmed-momentum-v1', action: 'paper_buy', reasons };
  }
}

function watch(input: { token: TokenRef; observedAt: Date }, reasons: readonly string[]): SignalDecision {
  return { token: input.token, observedAt: input.observedAt, strategyVersion: 'confirmed-momentum-v1', action: 'watch', reasons };
}
function reject(input: { token: TokenRef; observedAt: Date }, reasons: readonly string[]): SignalDecision {
  return { token: input.token, observedAt: input.observedAt, strategyVersion: 'confirmed-momentum-v1', action: 'reject', reasons };
}
