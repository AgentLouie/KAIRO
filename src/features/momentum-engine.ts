import type { MarketSnapshot, TokenRef } from '../core/market-data.js';

export type MomentumStatus = 'ready' | 'insufficient_data';

export interface MomentumMetrics {
  readonly marketCapReturnPct?: number;
  readonly volumeAcceleration?: number;
  readonly transactionAcceleration?: number;
  readonly buyPressure?: number;
}

export interface MomentumFeatureSet {
  readonly token: TokenRef;
  readonly observedAt: Date;
  readonly engineVersion: 'momentum-v1';
  readonly status: MomentumStatus;
  readonly score?: number;
  readonly metrics: MomentumMetrics;
  readonly reasons: readonly string[];
}

/**
 * Deliberately simple first-pass momentum scoring. It converts recent normalized
 * snapshots into an auditable 0-100 score; it is not a buy signal.
 */
export class MomentumEngine {
  evaluate(snapshots: readonly MarketSnapshot[]): MomentumFeatureSet {
    const ordered = [...snapshots].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
    const latest = ordered.at(-1);
    if (!latest) throw new Error('At least one snapshot is required to evaluate momentum.');
    const previous = ordered.at(-2);
    if (!previous) {
      return insufficient(latest.token, latest.observedAt, ['At least two snapshots are required before momentum can be measured.']);
    }

    const metrics: MomentumMetrics = {
      ...ratioChange(previous.marketCapUsd, latest.marketCapUsd, 'marketCapReturnPct'),
      ...ratioChange(previous.volume1mUsd, latest.volume1mUsd, 'volumeAcceleration'),
      ...ratioChange(transactionCount(previous), transactionCount(latest), 'transactionAcceleration'),
      ...buyPressure(latest)
    };
    const reasons: string[] = [];
    const components: number[] = [];

    if (metrics.marketCapReturnPct === undefined) reasons.push('Market-cap movement is unavailable.');
    else components.push(centeredChangeScore(metrics.marketCapReturnPct, 20));

    if (metrics.volumeAcceleration === undefined) reasons.push('Volume acceleration is unavailable.');
    else components.push(centeredChangeScore(metrics.volumeAcceleration, 1));

    if (metrics.transactionAcceleration === undefined) reasons.push('Transaction acceleration is unavailable.');
    else components.push(centeredChangeScore(metrics.transactionAcceleration, 1));

    if (metrics.buyPressure === undefined) reasons.push('Buy pressure is unavailable.');
    else components.push(metrics.buyPressure * 100);

    if (components.length < 3) {
      reasons.unshift('Fewer than three usable momentum components are available.');
      return { token: latest.token, observedAt: latest.observedAt, engineVersion: 'momentum-v1', status: 'insufficient_data', metrics, reasons };
    }

    const score = Math.round(components.reduce((sum, component) => sum + component, 0) / components.length);
    reasons.unshift(`Momentum score uses ${components.length} of 4 available components.`);
    return { token: latest.token, observedAt: latest.observedAt, engineVersion: 'momentum-v1', status: 'ready', score, metrics, reasons };
  }
}

function insufficient(token: TokenRef, observedAt: Date, reasons: readonly string[]): MomentumFeatureSet {
  return { token, observedAt, engineVersion: 'momentum-v1', status: 'insufficient_data', metrics: {}, reasons };
}

function ratioChange(previous: number | undefined, latest: number | undefined, key: 'marketCapReturnPct' | 'volumeAcceleration' | 'transactionAcceleration'): MomentumMetrics {
  if (previous === undefined || latest === undefined || previous < 0 || latest < 0) return {};
  const floor = key === 'marketCapReturnPct' ? 0.000_001 : 1;
  const change = (latest - previous) / Math.max(previous, floor);
  return key === 'marketCapReturnPct' ? { [key]: change * 100 } : { [key]: change };
}

function transactionCount(snapshot: MarketSnapshot): number | undefined {
  if (snapshot.buys1m === undefined || snapshot.sells1m === undefined) return undefined;
  return snapshot.buys1m + snapshot.sells1m;
}

function buyPressure(snapshot: MarketSnapshot): MomentumMetrics {
  const buys = snapshot.buyVolume1mUsd;
  const sells = snapshot.sellVolume1mUsd;
  if (buys !== undefined && sells !== undefined && buys + sells > 0) return { buyPressure: buys / (buys + sells) };
  if (snapshot.buys1m !== undefined && snapshot.sells1m !== undefined && snapshot.buys1m + snapshot.sells1m > 0) {
    return { buyPressure: snapshot.buys1m / (snapshot.buys1m + snapshot.sells1m) };
  }
  return {};
}

function centeredChangeScore(change: number, fullScale: number): number {
  return Math.max(0, Math.min(100, 50 + (change / fullScale) * 50));
}
