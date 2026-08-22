import type { ProviderResult } from '../contracts.js';
import { HeliusRpcError, type JsonRpcFetcher } from './helius-mayhem-mode-detector.js';

export interface MintAuthorityEvidence {
  readonly mintAuthority: 'safe' | 'unsafe';
  readonly freezeAuthority: 'safe' | 'unsafe';
  readonly supplyUi?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Verifies mint and freeze authorities using Helius-backed standard Solana RPC. */
export class HeliusMintAuthorityProvider {
  readonly name = 'helius';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: JsonRpcFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new HeliusRpcError('Helius API key is required for mint-authority verification.');
  }

  async getMintAuthorities(tokenMint: string): Promise<ProviderResult<MintAuthorityEvidence>> {
    const response = await this.fetcher(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'mint-authority-check', method: 'getAccountInfo',
        params: [tokenMint, { encoding: 'jsonParsed', commitment: 'confirmed' }]
      })
    });
    const payload = asRecord(await response.json());
    if (!response.ok) throw new HeliusRpcError(`Helius RPC failed with HTTP ${response.status}.`, response.status);
    if (payload?.error) throw new HeliusRpcError('Helius RPC returned an error for the mint-authority check.', response.status);
    const account = asRecord(asRecord(payload?.result)?.value);
    const data = asRecord(account?.data);
    const parsed = asRecord(data?.parsed);
    const info = asRecord(parsed?.info);
    if (!info || parsed?.type !== 'mint') throw new HeliusRpcError('Helius RPC did not return a parsed SPL mint account.', response.status);
    const fetchedAt = new Date();
    const rawSupply = typeof info.supply === 'string' ? Number(info.supply) : undefined;
    const decimals = typeof info.decimals === 'number' ? info.decimals : undefined;
    const supplyUi = rawSupply !== undefined && decimals !== undefined && Number.isFinite(rawSupply) && Number.isInteger(decimals)
      ? rawSupply / 10 ** decimals : undefined;
    return {
      source: this.name,
      fetchedAt,
      data: {
        mintAuthority: info.mintAuthority === null ? 'safe' : 'unsafe',
        freezeAuthority: info.freezeAuthority === null ? 'safe' : 'unsafe',
        ...(supplyUi === undefined ? {} : { supplyUi })
      }
    };
  }
}
