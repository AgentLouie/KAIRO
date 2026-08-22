import { BirdeyeApiError, type HttpFetcher } from './birdeye-market-data-provider.js';
import type { DeveloperPosition } from '../../risk/risk-engine.js';

const PROFILE_URL = 'https://public-api.birdeye.so/token/v1/holder-profile';

export interface TaggedHolderProfile {
  readonly bundledPct: number;
  readonly insiderPct: number;
  readonly developerPosition: DeveloperPosition;
  readonly developerRecentSelling: boolean;
  readonly observedAt: Date;
}

interface TagSummary {
  readonly holderCount: number;
  readonly percentOfSupply: number;
  readonly sellVolume: number;
}

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

function parseTags(value: unknown): Map<string, TagSummary> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = new Map<string, TagSummary>();
  for (const entry of value) {
    const record = asRecord(entry);
    const tag = textOrUndefined(record?.tag);
    const holderCount = numberOrUndefined(record?.holder_count);
    const percentOfSupply = numberOrUndefined(record?.percent_of_supply);
    const sellVolume = numberOrUndefined(record?.sell_volume);
    if (!tag || holderCount === undefined || percentOfSupply === undefined || sellVolume === undefined) continue;
    result.set(tag, { holderCount, percentOfSupply, sellVolume });
  }
  return result;
}

/** Reads Birdeye's labeled cohort summaries; tag coverage remains provider-derived evidence. */
export class BirdeyeHolderProfileProvider {
  readonly name = 'birdeye';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: HttpFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new BirdeyeApiError('Birdeye API key is required for tagged holder profiles.');
  }

  async getProfile(tokenMint: string): Promise<TaggedHolderProfile> {
    const url = new URL(PROFILE_URL);
    url.searchParams.set('token_address', tokenMint);
    url.searchParams.set('interval', '1h');
    url.searchParams.set('ui_amount_mode', 'scaled');
    url.searchParams.set('include_zero_balance', 'true');
    const response = await this.fetcher(url.toString(), { headers: { 'X-API-KEY': this.apiKey, 'x-chain': 'solana' } });
    const payload = asRecord(await response.json());
    if (!response.ok) throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? `Birdeye holder-profile request failed with HTTP ${response.status}.`, response.status);
    if (payload?.success !== true) throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? 'Birdeye returned an unsuccessful holder-profile response.', response.status);
    const tags = parseTags(asRecord(payload.data)?.tags);
    const bundler = tags?.get('bundler');
    const insider = tags?.get('insider');
    const developer = tags?.get('dev');
    if (!bundler || !insider || !developer) {
      throw new BirdeyeApiError('Birdeye holder profile did not include the required bundler, insider, and developer cohorts.', response.status);
    }
    return {
      bundledPct: bundler.percentOfSupply / 100,
      insiderPct: insider.percentOfSupply / 100,
      developerPosition: developer.holderCount > 0 && developer.percentOfSupply === 0 ? 'fully_exited' : 'holding',
      developerRecentSelling: developer.sellVolume > 0,
      observedAt: new Date()
    };
  }
}
