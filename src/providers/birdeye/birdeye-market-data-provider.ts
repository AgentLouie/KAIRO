import type { MarketSnapshot, TokenTrade } from '../../core/market-data.js';
import type { MarketDataProvider, ProviderResult } from '../contracts.js';

const OVERVIEW_URL = 'https://public-api.birdeye.so/defi/token_overview';

interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type HttpFetcher = (url: string, init: { readonly headers: Record<string, string> }) => Promise<HttpResponse>;

export class BirdeyeApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'BirdeyeApiError';
    this.retryable = status === 429 || (status !== undefined && status >= 500);
  }
}

type OverviewData = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export class BirdeyeMarketDataProvider implements MarketDataProvider {
  readonly name = 'birdeye';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: HttpFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new BirdeyeApiError('Birdeye API key is required.');
  }

  async getTokenSnapshot(tokenMint: string): Promise<ProviderResult<MarketSnapshot>> {
    const url = new URL(OVERVIEW_URL);
    url.searchParams.set('address', tokenMint);
    url.searchParams.set('frames', '1m');
    url.searchParams.set('ui_amount_mode', 'scaled');

    const response = await this.fetcher(url.toString(), {
      headers: { 'X-API-KEY': this.apiKey, 'x-chain': 'solana' }
    });
    const payload = asRecord(await response.json());
    if (!response.ok) {
      const message = textOrUndefined(payload?.message) ?? `Birdeye request failed with HTTP ${response.status}.`;
      throw new BirdeyeApiError(message, response.status);
    }
    if (payload?.success !== true) {
      throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? 'Birdeye returned an unsuccessful response.', response.status);
    }
    const data = asRecord(payload.data);
    if (!data) throw new BirdeyeApiError('Birdeye response did not contain token overview data.', response.status);

    const fetchedAt = new Date();
    const symbol = textOrUndefined(data.symbol);
    const name = textOrUndefined(data.name);
    const priceUsd = numberOrUndefined(data.price);
    const marketCapUsd = numberOrUndefined(data.marketCap);
    const liquidityUsd = numberOrUndefined(data.liquidity);
    const volume1mUsd = numberOrUndefined(data.v1mUSD);
    const buyVolume1mUsd = numberOrUndefined(data.vBuy1mUSD);
    const sellVolume1mUsd = numberOrUndefined(data.vSell1mUSD);
    const buys1m = numberOrUndefined(data.buy1m);
    const sells1m = numberOrUndefined(data.sell1m);
    const uniqueWallets1m = numberOrUndefined(data.uniqueWallet1m);
    return {
      source: this.name,
      fetchedAt,
      data: {
        token: {
          mint: textOrUndefined(data.address) ?? tokenMint,
          ...(symbol ? { symbol } : {}),
          ...(name ? { name } : {})
        },
        observedAt: fetchedAt,
        provider: 'birdeye',
        ...(priceUsd !== undefined ? { priceUsd } : {}),
        ...(marketCapUsd !== undefined ? { marketCapUsd } : {}),
        ...(liquidityUsd !== undefined ? { liquidityUsd } : {}),
        ...(volume1mUsd !== undefined ? { volume1mUsd } : {}),
        ...(buyVolume1mUsd !== undefined ? { buyVolume1mUsd } : {}),
        ...(sellVolume1mUsd !== undefined ? { sellVolume1mUsd } : {}),
        ...(buys1m !== undefined ? { buys1m } : {}),
        ...(sells1m !== undefined ? { sells1m } : {}),
        ...(uniqueWallets1m !== undefined ? { uniqueTraders1m: uniqueWallets1m } : {})
      }
    };
  }

  async getTokenPrice(tokenMint: string): Promise<ProviderResult<number>> {
    const result = await this.getTokenSnapshot(tokenMint);
    if (result.data.priceUsd === undefined) throw new BirdeyeApiError('Birdeye did not return a price for this token.');
    return { ...result, data: result.data.priceUsd };
  }

  async getTokenLiquidity(tokenMint: string): Promise<ProviderResult<number | undefined>> {
    const result = await this.getTokenSnapshot(tokenMint);
    return { ...result, data: result.data.liquidityUsd };
  }

  async getTokenVolume(tokenMint: string, windowSeconds: number): Promise<ProviderResult<number | undefined>> {
    if (windowSeconds !== 60) {
      throw new BirdeyeApiError('The initial Birdeye adapter currently supports the verified 1-minute volume frame only.');
    }
    const result = await this.getTokenSnapshot(tokenMint);
    return { ...result, data: result.data.volume1mUsd };
  }

  async getTokenTrades(_tokenMint: string): Promise<ProviderResult<readonly TokenTrade[]>> {
    throw new BirdeyeApiError('Individual trade retrieval is not enabled in the initial overview adapter.');
  }
}
