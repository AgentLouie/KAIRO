import type { Candidate, DiscoveredToken } from '../core/discovery.js';
import type { CandidateRepository } from '../database/contracts.js';
import type { TokenDiscoveryProvider } from './contracts.js';
import { CandidateFunnel } from './candidate-funnel.js';
import { excludeMayhemMode, type MayhemModeDetector } from './mayhem-mode-guard.js';

export interface DiscoveryCycleResult {
  readonly listingsReceived: number;
  readonly skippedKnown: number;
  readonly mayhemRejected: number;
  readonly observingAdded: number;
  readonly rejected: number;
  readonly duplicateCount: number;
  readonly monitored: readonly Candidate[];
}

/** Coordinates one discovery pass while preserving its bounded queue in storage. */
export class DiscoveryCycle {
  private initialized = false;

  constructor(
    private readonly provider: TokenDiscoveryProvider,
    private readonly mayhemDetector: MayhemModeDetector,
    private readonly funnel: CandidateFunnel,
    private readonly candidates: CandidateRepository
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.funnel.restore(await this.candidates.observing());
    this.initialized = true;
  }

  async runOnce(limit: number): Promise<DiscoveryCycleResult> {
    await this.initialize();
    // The pruner can release candidates in a separate scheduler. Refresh capacity
    // from PostgreSQL before each discovery pass so freed slots are reusable.
    this.funnel.synchronize(await this.candidates.observing());
    const listings = await this.provider.listNewPumpFunTokens(limit);
    const fresh = listings.filter((listing) => !this.funnel.isKnown(listing.token.mint));
    const mayhem = await excludeMayhemMode(fresh, this.mayhemDetector);
    const result = this.funnel.ingest(mayhem.accepted);
    await this.persist(result.observing);
    await this.persist(result.rejected);
    await this.persistMayhemRejections(listings, mayhem.rejectedMints);
    return {
      listingsReceived: listings.length,
      skippedKnown: listings.length - fresh.length,
      mayhemRejected: mayhem.rejectedMints.length,
      observingAdded: result.observing.length,
      rejected: result.rejected.length,
      duplicateCount: result.duplicateCount,
      monitored: this.funnel.monitoring()
    };
  }

  private async persist(candidates: readonly Candidate[]): Promise<void> {
    for (const candidate of candidates) await this.candidates.save(candidate);
  }

  private async persistMayhemRejections(listings: readonly DiscoveredToken[], rejectedMints: readonly string[]): Promise<void> {
    const rejected = new Set(rejectedMints);
    for (const token of listings) {
      if (!rejected.has(token.token.mint)) continue;
      await this.candidates.save({ token, status: 'rejected', reason: 'Pump.fun Mayhem Mode token.' });
    }
  }
}
