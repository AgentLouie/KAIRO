import type { DiscoveredToken } from '../core/discovery.js';

export interface TokenDiscoveryProvider {
  readonly name: string;
  listNewPumpFunTokens(limit: number): Promise<readonly DiscoveredToken[]>;
}
