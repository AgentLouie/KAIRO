import { BirdeyeHolderProvider } from '../providers/birdeye/birdeye-holder-provider.js';
import { HeliusWalletAgeProvider } from '../providers/helius/helius-wallet-age-provider.js';

export interface FreshWalletEvidence {
  /** Estimated fraction of total supply held by fresh wallets among the top-ten holder sample. */
  readonly freshWalletPct: number;
  readonly topHolderPct: number;
  readonly walletsSampled: number;
  readonly freshWallets: number;
  readonly observedAt: Date;
  readonly method: 'top-ten-holder-earliest-activity';
}

/** Conservative first pass; it does not claim to classify every wallet in the holder base. */
export class FreshWalletAnalyzer {
  constructor(
    private readonly holders: BirdeyeHolderProvider,
    private readonly walletAges: HeliusWalletAgeProvider,
    private readonly maxWalletAgeDays = 7,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isInteger(maxWalletAgeDays) || maxWalletAgeDays < 1) throw new Error('maxWalletAgeDays must be a positive integer.');
  }

  async analyze(tokenMint: string): Promise<FreshWalletEvidence> {
    const top = await this.holders.getTopWallets(tokenMint);
    const cutoff = this.now().getTime() - this.maxWalletAgeDays * 24 * 60 * 60 * 1_000;
    let totalAmount = 0;
    let freshAmount = 0;
    let freshWallets = 0;
    for (const wallet of top.wallets) {
      const earliest = await this.walletAges.getEarliestActivity(wallet.owner);
      if (!earliest) throw new Error(`Earliest indexed activity is unavailable for top holder ${wallet.owner}.`);
      totalAmount += wallet.amount;
      if (earliest.getTime() >= cutoff) {
        freshAmount += wallet.amount;
        freshWallets += 1;
      }
    }
    if (totalAmount <= 0) throw new Error('Top-holder wallet amounts cannot be zero for fresh-wallet analysis.');
    return {
      freshWalletPct: top.top10HoldPct * freshAmount / totalAmount,
      topHolderPct: top.top10HoldPct,
      walletsSampled: top.wallets.length,
      freshWallets,
      observedAt: this.now(),
      method: 'top-ten-holder-earliest-activity'
    };
  }
}
