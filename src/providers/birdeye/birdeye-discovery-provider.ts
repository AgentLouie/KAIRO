import type { DiscoveredToken } from '../../core/discovery.js';
import type { TokenDiscoveryProvider } from '../../discovery/contracts.js';
import { BirdeyeApiError, type HttpFetcher } from './birdeye-market-data-provider.js';

const NEW_LISTINGS_URL = 'https://public-api.birdeye.so/defi/v2/tokens/new_listing';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export class BirdeyeDiscoveryProvider implements TokenDiscoveryProvider {
  readonly name = 'birdeye';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: HttpFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new BirdeyeApiError('Birdeye API key is required.');
  }

  async listNewPumpFunTokens(limit: number): Promise<readonly DiscoveredToken[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BirdeyeApiError('Birdeye new listings limit must be an integer from 1 to 20.');
    }
    const url = new URL(NEW_LISTINGS_URL);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('meme_platform_enabled', 'true');
    const response = await this.fetcher(url.toString(), {
      headers: { 'X-API-KEY': this.apiKey, 'x-chain': 'solana' }
    });
    const payload = record(await response.json());
    if (!response.ok || payload?.success !== true) {
      throw new BirdeyeApiError(text(payload?.message) ?? `Birdeye discovery request failed with HTTP ${response.status}.`, response.status);
    }
    const data = record(payload.data);
    const rows = Array.isArray(data?.items) ? data.items : [];
    return rows.flatMap((row): DiscoveredToken[] => {
      const item = record(row);
      const mint = text(item?.address);
      // `meme_platform_enabled` includes several launch venues. Keep only the
      // documented Pump.fun source; all other launches are discarded here.
      if (!mint || item?.source !== 'pump_dot_fun') return [];
      const addedAt = number(item.liquidityAddedAt);
      const liquidityUsd = number(item.liquidity);
      const symbol = text(item.symbol);
      const name = text(item.name);
      return [{
        token: {
          mint,
          ...(symbol ? { symbol } : {}),
          ...(name ? { name } : {})
        },
        source: 'pump_dot_fun',
        discoveredAt: addedAt ? new Date(addedAt * 1_000) : new Date(),
        ...(liquidityUsd !== undefined ? { liquidityUsd } : {})
      }];
    });
  }
}
