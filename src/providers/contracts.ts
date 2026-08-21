import type { MarketSnapshot, TokenRef, TokenTrade } from '../core/market-data.js';

export interface ProviderResult<T> {
  readonly data: T;
  readonly fetchedAt: Date;
  readonly source: string;
}

export interface MarketDataProvider {
  readonly name: string;
  getTokenSnapshot(tokenMint: string): Promise<ProviderResult<MarketSnapshot>>;
  getTokenTrades(tokenMint: string, options?: { readonly limit?: number; readonly since?: Date }): Promise<ProviderResult<readonly TokenTrade[]>>;
  getTokenPrice(tokenMint: string): Promise<ProviderResult<number>>;
  getTokenLiquidity(tokenMint: string): Promise<ProviderResult<number | undefined>>;
  getTokenVolume(tokenMint: string, windowSeconds: number): Promise<ProviderResult<number | undefined>>;
}

export interface ChainDataProvider {
  readonly name: string;
  getToken(tokenMint: string): Promise<ProviderResult<TokenRef>>;
  getMintAuthorities(tokenMint: string): Promise<ProviderResult<{ readonly mintAuthority?: string; readonly freezeAuthority?: string }>>;
}
