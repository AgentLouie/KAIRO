export type ProviderName = 'birdeye' | 'helius' | 'solana-rpc' | 'other';

export interface TokenRef {
  readonly mint: string;
  readonly symbol?: string;
  readonly name?: string;
}

export interface TokenTrade {
  readonly tokenMint: string;
  readonly observedAt: Date;
  readonly side: 'buy' | 'sell' | 'unknown';
  readonly priceUsd?: number;
  readonly valueUsd?: number;
  readonly trader?: string;
  readonly provider: ProviderName;
}

export interface MarketSnapshot {
  readonly token: TokenRef;
  readonly observedAt: Date;
  readonly provider: ProviderName;
  readonly priceUsd?: number;
  readonly marketCapUsd?: number;
  readonly liquidityUsd?: number;
  readonly volume1mUsd?: number;
  readonly buyVolume1mUsd?: number;
  readonly sellVolume1mUsd?: number;
  readonly buys1m?: number;
  readonly sells1m?: number;
  readonly uniqueTraders1m?: number;
  readonly uniqueBuyers1m?: number;
  readonly uniqueSellers1m?: number;
}

export interface DataQuality {
  readonly isFresh: boolean;
  readonly ageMs: number;
  readonly reason?: string;
}

export function dataQuality(snapshot: MarketSnapshot, now: Date, maximumAgeMs: number): DataQuality {
  const ageMs = Math.max(0, now.getTime() - snapshot.observedAt.getTime());
  if (ageMs > maximumAgeMs) {
    return { isFresh: false, ageMs, reason: 'Snapshot exceeds freshness limit.' };
  }
  return { isFresh: true, ageMs };
}
