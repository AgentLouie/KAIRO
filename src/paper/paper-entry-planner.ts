import type { PaperPortfolioConfig } from '../config/paper-portfolio.js';
import type { TokenRef } from '../core/market-data.js';

export interface PaperEntryRequest {
  readonly token: TokenRef;
  readonly markPriceUsd: number;
  readonly solUsdPrice: number;
  readonly availableBalanceSol: number;
  readonly openPositions: number;
  readonly observedAt: Date;
}

export type PaperEntryPlan =
  | { readonly status: 'rejected'; readonly token: TokenRef; readonly observedAt: Date; readonly reason: string }
  | {
      readonly status: 'approved'; readonly token: TokenRef; readonly observedAt: Date;
      readonly riskBudgetSol: number; readonly entryPriceUsd: number; readonly notionalSol: number;
      readonly solUsdPrice: number;
      readonly entryFeeSol: number; readonly estimatedExitFeeSol: number; readonly cashDebitSol: number;
      readonly tokenQuantity: number; readonly stopLossPriceUsd: number; readonly intendedLossSol: number;
    };

/**
 * A deterministic paper-only entry model. Fee and slippage assumptions are
 * explicit configuration values, not claims about any exchange's live fees.
 */
export class PaperEntryPlanner {
  constructor(private readonly config: PaperPortfolioConfig) {}

  plan(request: PaperEntryRequest): PaperEntryPlan {
    if (!positive(request.markPriceUsd) || !positive(request.solUsdPrice) || !positive(request.availableBalanceSol)) {
      return reject(request, 'A positive token price, SOL price, and available SOL balance are required.');
    }
    if (request.openPositions >= this.config.maxConcurrentPositions) {
      return reject(request, `Maximum concurrent paper positions (${this.config.maxConcurrentPositions}) has been reached.`);
    }

    const stopLossFraction = this.config.stopLossPct / 100;
    const feeFraction = this.config.tradingFeeBps / 10_000;
    const riskBudgetSol = request.availableBalanceSol * (this.config.riskPerTradePct / 100);
    const riskPerNotionalSol = stopLossFraction + feeFraction * 2;
    const cashLimitedNotionalSol = request.availableBalanceSol / (1 + feeFraction);
    const notionalSol = Math.min(riskBudgetSol / riskPerNotionalSol, cashLimitedNotionalSol);
    if (!positive(notionalSol)) return reject(request, 'Risk budget is too small to form a paper position.');

    const entryPriceUsd = request.markPriceUsd * (1 + this.config.entrySlippageBps / 10_000);
    const entryFeeSol = notionalSol * feeFraction;
    const estimatedExitFeeSol = notionalSol * feeFraction;
    const tokenQuantity = (notionalSol * request.solUsdPrice) / entryPriceUsd;
    const stopLossPriceUsd = entryPriceUsd * (1 - stopLossFraction);
    const intendedLossSol = notionalSol * stopLossFraction + entryFeeSol + estimatedExitFeeSol;
    return {
      status: 'approved', token: request.token, observedAt: request.observedAt, riskBudgetSol,
      entryPriceUsd, solUsdPrice: request.solUsdPrice, notionalSol, entryFeeSol, estimatedExitFeeSol,
      cashDebitSol: notionalSol + entryFeeSol, tokenQuantity, stopLossPriceUsd, intendedLossSol
    };
  }
}

function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function reject(request: PaperEntryRequest, reason: string): PaperEntryPlan {
  return { status: 'rejected', token: request.token, observedAt: request.observedAt, reason };
}
