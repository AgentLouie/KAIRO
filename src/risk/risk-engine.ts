import type { TokenRef } from '../core/market-data.js';

export type DeveloperPosition = 'holding' | 'fully_exited' | 'unknown';
export type RiskStatus = 'assessed' | 'insufficient_data' | 'rejected';

export interface RiskEvidence {
  readonly token: TokenRef;
  readonly observedAt: Date;
  readonly mayhemMode: boolean;
  readonly mintAuthority: 'safe' | 'unsafe' | 'unknown';
  readonly freezeAuthority: 'safe' | 'unsafe' | 'unknown';
  readonly liquidityUsd?: number;
  readonly marketCapUsd?: number;
  readonly topHolderPct?: number;
  readonly freshWalletPct?: number;
  readonly bundledPct?: number;
  readonly insiderPct?: number;
  readonly developerPosition: DeveloperPosition;
  readonly developerRecentSelling?: boolean;
}

export interface RiskAssessment {
  readonly token: TokenRef;
  readonly observedAt: Date;
  readonly engineVersion: 'risk-v1';
  readonly status: RiskStatus;
  /** 0 is lowest observed risk; 100 is highest observed risk. */
  readonly score?: number;
  readonly reasons: readonly string[];
}

/**
 * Independent risk evaluation. It never decides that a token is safe merely
 * because evidence is absent; incomplete evidence blocks a future paper buy.
 */
export class RiskEngine {
  evaluate(evidence: RiskEvidence): RiskAssessment {
    const hardReject = hardRejection(evidence);
    if (hardReject) {
      return { token: evidence.token, observedAt: evidence.observedAt, engineVersion: 'risk-v1', status: 'rejected', score: 100, reasons: [hardReject] };
    }

    const missing = missingEvidence(evidence);
    if (missing.length > 0) {
      return {
        token: evidence.token,
        observedAt: evidence.observedAt,
        engineVersion: 'risk-v1',
        status: 'insufficient_data',
        reasons: ['Risk is blocked until all required evidence is available.', ...missing]
      };
    }

    const liquidityRatio = evidence.liquidityUsd! / evidence.marketCapUsd!;
    const components = [
      risingRisk(evidence.topHolderPct!, 0.15, 0.5),
      risingRisk(evidence.freshWalletPct!, 0.25, 0.75),
      risingRisk(evidence.bundledPct!, 0.1, 0.4),
      risingRisk(evidence.insiderPct!, 0.1, 0.4),
      fallingRisk(liquidityRatio, 0.03, 0.2),
      developerRisk(evidence.developerPosition, evidence.developerRecentSelling ?? false)
    ];
    const score = Math.round(components.reduce((sum, value) => sum + value, 0) / components.length);
    const reasons = [
      `Top-holder concentration: ${(evidence.topHolderPct! * 100).toFixed(1)}%.`,
      `Fresh-wallet share: ${(evidence.freshWalletPct! * 100).toFixed(1)}%.`,
      `Bundler share: ${(evidence.bundledPct! * 100).toFixed(1)}%.`,
      `Insider share: ${(evidence.insiderPct! * 100).toFixed(1)}%.`,
      `Liquidity / market-cap ratio: ${(liquidityRatio * 100).toFixed(1)}%.`,
      developerReason(evidence.developerPosition, evidence.developerRecentSelling ?? false)
    ];
    return { token: evidence.token, observedAt: evidence.observedAt, engineVersion: 'risk-v1', status: 'assessed', score, reasons };
  }
}

function hardRejection(evidence: RiskEvidence): string | undefined {
  if (evidence.mayhemMode) return 'Rejected: Pump.fun Mayhem Mode token.';
  if (evidence.mintAuthority === 'unsafe') return 'Rejected: mint authority remains active.';
  if (evidence.freezeAuthority === 'unsafe') return 'Rejected: freeze authority remains active.';
  return undefined;
}

function missingEvidence(evidence: RiskEvidence): string[] {
  const missing: string[] = [];
  if (evidence.mintAuthority === 'unknown') missing.push('Mint-authority verification is unavailable.');
  if (evidence.freezeAuthority === 'unknown') missing.push('Freeze-authority verification is unavailable.');
  if (evidence.liquidityUsd === undefined || evidence.liquidityUsd <= 0) missing.push('Liquidity is unavailable.');
  if (evidence.marketCapUsd === undefined || evidence.marketCapUsd <= 0) missing.push('Market cap is unavailable.');
  if (evidence.topHolderPct === undefined) missing.push('Top-holder concentration is unavailable.');
  if (evidence.freshWalletPct === undefined) missing.push('Fresh-wallet share is unavailable.');
  if (evidence.bundledPct === undefined) missing.push('Bundler share is unavailable.');
  if (evidence.insiderPct === undefined) missing.push('Insider share is unavailable.');
  if (evidence.developerPosition === 'unknown') missing.push('Developer position is unavailable.');
  return missing;
}

function risingRisk(value: number, safe: number, dangerous: number): number {
  return clamp((value - safe) / (dangerous - safe) * 100);
}

function fallingRisk(value: number, dangerous: number, safe: number): number {
  return clamp((safe - value) / (safe - dangerous) * 100);
}

function developerRisk(position: DeveloperPosition, recentSelling: boolean): number {
  if (position === 'fully_exited') return recentSelling ? 80 : 35;
  if (position === 'holding') return recentSelling ? 65 : 20;
  return 100;
}

function developerReason(position: DeveloperPosition, recentSelling: boolean): string {
  if (position === 'fully_exited' && !recentSelling) return 'Developer is fully exited; this is not an automatic rejection, but it remains a risk factor.';
  if (position === 'fully_exited') return 'Developer is fully exited with recent selling activity.';
  if (position === 'holding' && recentSelling) return 'Developer still holds tokens and has recent selling activity.';
  return 'Developer still holds tokens without recent selling activity.';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
