import type { Candidate } from '../core/discovery.js';
import type { MarketSnapshotRepository } from '../database/contracts.js';
import { HeliusMayhemModeDetector } from '../providers/helius/helius-mayhem-mode-detector.js';
import { HeliusMintAuthorityProvider } from '../providers/helius/helius-mint-authority-provider.js';
import { BirdeyeHolderProfileProvider } from '../providers/birdeye/birdeye-holder-profile-provider.js';
import { FreshWalletAnalyzer } from './fresh-wallet-analyzer.js';
import type { RiskEvidence } from './risk-engine.js';

export class RiskEvidenceCollector {
  constructor(
    private readonly snapshots: MarketSnapshotRepository,
    private readonly mayhem: HeliusMayhemModeDetector,
    private readonly authorities: HeliusMintAuthorityProvider,
    private readonly profiles: BirdeyeHolderProfileProvider,
    private readonly freshWallets: FreshWalletAnalyzer
  ) {}

  async collect(candidate: Candidate): Promise<RiskEvidence> {
    const mint = candidate.token.token.mint;
    const snapshot = (await this.snapshots.recent(mint, 1))[0];
    if (!snapshot) throw new Error('No market snapshot is available for risk collection.');
    const [mayhemMode, authority] = await Promise.all([
      this.mayhem.isMayhemMode(mint),
      this.authorities.getMintAuthorities(mint)
    ]);
    // Birdeye risk endpoints each consume 35 CU; serialize them to respect the
    // lower-tier rate limit instead of allowing parallel calls to self-throttle.
    const profile = await retry(() => this.profiles.getProfile(mint));
    await wait(2_000);
    const fresh = await retry(() => this.freshWallets.analyze(mint));
    return {
      token: snapshot.token,
      observedAt: new Date(),
      mayhemMode,
      mintAuthority: authority.data.mintAuthority,
      freezeAuthority: authority.data.freezeAuthority,
      ...(snapshot.liquidityUsd === undefined ? {} : { liquidityUsd: snapshot.liquidityUsd }),
      ...(snapshot.marketCapUsd === undefined ? {} : { marketCapUsd: snapshot.marketCapUsd }),
      topHolderPct: fresh.topHolderPct,
      freshWalletPct: fresh.freshWalletPct,
      bundledPct: profile.bundledPct,
      insiderPct: profile.insiderPct,
      developerPosition: profile.developerPosition,
      developerRecentSelling: profile.developerRecentSelling
    };
  }
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 3) throw error;
      await wait(1_000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'retryable' in error && (error as { retryable?: unknown }).retryable === true;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
