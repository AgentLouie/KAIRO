import type { PaperPortfolioConfig } from '../config/paper-portfolio.js';
import type { TokenRef } from '../core/market-data.js';
import type { MarketDataProvider } from '../providers/contracts.js';
import { PaperEntryPlanner, type PaperEntryPlan } from './paper-entry-planner.js';

export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface PendingPaperBuy { readonly id: number; readonly token: TokenRef; readonly observedAt: Date; }
export interface PendingPaperBuyRepository { pending(): Promise<readonly PendingPaperBuy[]>; }
export interface PaperPortfolioState { readonly cashBalanceSol: number; readonly openPositions: number; }
export interface PaperExecutionRepository {
  state(startingBalanceSol: number): Promise<PaperPortfolioState>;
  open(signal: PendingPaperBuy, plan: Extract<PaperEntryPlan, { status: 'approved' }>, config: PaperPortfolioConfig): Promise<boolean>;
}

/** Executes only persisted PAPER BUY research signals into local PostgreSQL rows. */
export class PaperExecutionCycle {
  constructor(private readonly signals: PendingPaperBuyRepository, private readonly portfolio: PaperExecutionRepository, private readonly market: MarketDataProvider, private readonly config: PaperPortfolioConfig, private readonly planner = new PaperEntryPlanner(config)) {}
  async runOnce(): Promise<{ reviewed: number; opened: number; skipped: number; openedContracts: readonly string[] }> {
    let opened = 0; let skipped = 0; const openedContracts: string[] = [];
    const pending = await this.signals.pending();
    if (pending.length === 0) return { reviewed: 0, opened: 0, skipped: 0, openedContracts };
    const sol = await this.market.getTokenPrice(WRAPPED_SOL_MINT);
    for (const signal of pending) {
      const [state, quote] = await Promise.all([this.portfolio.state(this.config.startingBalanceSol), this.market.getTokenPrice(signal.token.mint)]);
      const plan = this.planner.plan({ token: signal.token, markPriceUsd: quote.data, solUsdPrice: sol.data, availableBalanceSol: state.cashBalanceSol, openPositions: state.openPositions, observedAt: quote.fetchedAt });
      if (plan.status !== 'approved') { skipped += 1; continue; }
      if (await this.portfolio.open(signal, plan, this.config)) { opened += 1; openedContracts.push(signal.token.mint); } else skipped += 1;
    }
    return { reviewed: opened + skipped, opened, skipped, openedContracts };
  }
}
