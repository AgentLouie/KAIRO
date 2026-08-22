import { HeliusRpcError, type JsonRpcFetcher } from './helius-mayhem-mode-detector.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Returns the oldest indexed wallet activity, not a claim about wallet creation or funding. */
export class HeliusWalletAgeProvider {
  readonly name = 'helius';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: JsonRpcFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new HeliusRpcError('Helius API key is required for wallet-age checks.');
  }

  async getEarliestActivity(wallet: string): Promise<Date | undefined> {
    const response = await this.fetcher(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'wallet-age-check', method: 'getTransactionsForAddress',
        params: [wallet, { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1, commitment: 'confirmed' }]
      })
    });
    const payload = asRecord(await response.json());
    if (!response.ok) throw new HeliusRpcError(`Helius RPC failed with HTTP ${response.status}.`, response.status);
    if (payload?.error) throw new HeliusRpcError('Helius RPC returned an error for the wallet-age check.', response.status);
    const result = asRecord(payload?.result);
    const data = result?.data;
    if (!Array.isArray(data) || data.length === 0) return undefined;
    const blockTime = asRecord(data[0])?.blockTime;
    if (typeof blockTime !== 'number' || !Number.isFinite(blockTime)) return undefined;
    return new Date(blockTime * 1_000);
  }
}
