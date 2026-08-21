import { PublicKey } from '@solana/web3.js';
import type { MayhemModeDetector } from '../../discovery/mayhem-mode-guard.js';

// Published by Pump.fun in its Mayhem Mode documentation.
export const MAYHEM_PROGRAM_ID = new PublicKey('MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e');
const MAYHEM_STATE_SEED = Buffer.from('mayhem-state');

interface RpcResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type JsonRpcFetcher = (url: string, init: {
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: string;
}) => Promise<RpcResponse>;

export class HeliusRpcError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'HeliusRpcError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Detects a Mayhem coin through its official per-token Mayhem state PDA. */
export class HeliusMayhemModeDetector implements MayhemModeDetector {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: JsonRpcFetcher = (url, init) => fetch(url, init)
  ) {
    if (!apiKey.trim()) throw new HeliusRpcError('Helius API key is required for Mayhem Mode verification.');
  }

  async isMayhemMode(tokenMint: string): Promise<boolean> {
    const mint = new PublicKey(tokenMint);
    const [mayhemState] = PublicKey.findProgramAddressSync([MAYHEM_STATE_SEED, mint.toBytes()], MAYHEM_PROGRAM_ID);
    const response = await this.fetcher(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'mayhem-mode-check', method: 'getAccountInfo',
        params: [mayhemState.toBase58(), { encoding: 'base64', commitment: 'confirmed' }]
      })
    });
    const payload = asRecord(await response.json());
    if (!response.ok) throw new HeliusRpcError(`Helius RPC failed with HTTP ${response.status}.`, response.status);
    if (payload?.error) throw new HeliusRpcError('Helius RPC returned an error for the Mayhem check.', response.status);
    const result = asRecord(payload?.result);
    if (!result || !('value' in result)) throw new HeliusRpcError('Helius RPC returned a malformed Mayhem check response.', response.status);
    return result.value !== null;
  }
}
