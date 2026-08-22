import { BirdeyeApiError, type HttpFetcher } from './birdeye-market-data-provider.js';

const HOLDER_URL = 'https://public-api.birdeye.so/defi/v3/token/holder';

export interface HolderConcentration {
  readonly holderCount: number;
  /** Fraction of supply controlled by the top ten owner wallets, from 0 to 1. */
  readonly top10HoldPct: number;
  readonly observedAt: Date;
}

export interface TopHolderWallet {
  readonly owner: string;
  readonly amount: number;
}

export interface TopHolderWallets {
  readonly top10HoldPct: number;
  readonly wallets: readonly TopHolderWallet[];
  readonly observedAt: Date;
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

/** Uses Birdeye wallet-mode holders to avoid token-account concentration fragmentation. */
export class BirdeyeHolderProvider {
  readonly name = 'birdeye';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: HttpFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new BirdeyeApiError('Birdeye API key is required for holder concentration.');
  }

  async getConcentration(tokenMint: string): Promise<HolderConcentration> {
    const url = new URL(HOLDER_URL);
    url.searchParams.set('address', tokenMint);
    url.searchParams.set('offset', '0');
    url.searchParams.set('limit', '10');
    url.searchParams.set('mode', 'wallet');
    url.searchParams.set('ui_amount_mode', 'scaled');
    const response = await this.fetcher(url.toString(), { headers: { 'X-API-KEY': this.apiKey, 'x-chain': 'solana' } });
    const payload = asRecord(await response.json());
    if (!response.ok) throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? `Birdeye holder request failed with HTTP ${response.status}.`, response.status);
    if (payload?.success !== true) throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? 'Birdeye returned an unsuccessful holder response.', response.status);
    const data = asRecord(payload.data);
    const holderCount = numberOrUndefined(data?.holder);
    const top10HoldPercent = numberOrUndefined(data?.top10_hold_percent);
    if (holderCount === undefined || top10HoldPercent === undefined) {
      throw new BirdeyeApiError('Birdeye holder response did not contain holder concentration fields.', response.status);
    }
    return { holderCount, top10HoldPct: top10HoldPercent / 100, observedAt: new Date() };
  }

  async getTopWallets(tokenMint: string): Promise<TopHolderWallets> {
    const url = new URL(HOLDER_URL);
    url.searchParams.set('address', tokenMint);
    url.searchParams.set('offset', '0');
    url.searchParams.set('limit', '10');
    url.searchParams.set('mode', 'wallet');
    url.searchParams.set('ui_amount_mode', 'scaled');
    const response = await this.fetcher(url.toString(), { headers: { 'X-API-KEY': this.apiKey, 'x-chain': 'solana' } });
    const payload = asRecord(await response.json());
    if (!response.ok) throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? `Birdeye holder request failed with HTTP ${response.status}.`, response.status);
    if (payload?.success !== true) throw new BirdeyeApiError(textOrUndefined(payload?.message) ?? 'Birdeye returned an unsuccessful holder response.', response.status);
    const data = asRecord(payload.data);
    const top10HoldPercent = numberOrUndefined(data?.top10_hold_percent);
    const rows = Array.isArray(data?.items) ? data.items : undefined;
    if (top10HoldPercent === undefined || !rows) throw new BirdeyeApiError('Birdeye holder response did not contain top-wallet fields.', response.status);
    const wallets = rows.map((item) => {
      const row = asRecord(item);
      const owner = textOrUndefined(row?.owner);
      const amount = numberOrUndefined(row?.amount);
      return owner && amount !== undefined && amount >= 0 ? { owner, amount } : undefined;
    }).filter((wallet): wallet is TopHolderWallet => wallet !== undefined);
    if (wallets.length === 0) throw new BirdeyeApiError('Birdeye holder response did not contain usable wallet rows.', response.status);
    return { top10HoldPct: top10HoldPercent / 100, wallets, observedAt: new Date() };
  }
}
