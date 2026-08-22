import type { CandidateRepository } from '../database/contracts.js';
import type { Logger } from '../logging/logger.js';
import { SnapshotService } from './snapshot-service.js';

export interface SnapshotCycleResult {
  readonly candidates: number;
  readonly saved: number;
  readonly failed: number;
}

/** Fetches one fresh, normalized snapshot per actively monitored token. */
export class SnapshotCycle {
  readonly name = 'market-snapshots';

  constructor(
    private readonly candidates: CandidateRepository,
    private readonly snapshots: SnapshotService,
    private readonly logger: Logger,
    private readonly maxConcurrency: number,
    private readonly options: { readonly requestSpacingMs?: number; readonly maxAttempts?: number; readonly sleep?: (milliseconds: number) => Promise<void> } = {}
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error('maxConcurrency must be a positive integer.');
    if ((options.requestSpacingMs ?? 0) < 0) throw new Error('requestSpacingMs cannot be negative.');
    if (!Number.isInteger(options.maxAttempts ?? 3) || (options.maxAttempts ?? 3) < 1) throw new Error('maxAttempts must be a positive integer.');
  }

  async runOnce(): Promise<SnapshotCycleResult> {
    const monitored = await this.candidates.observing();
    let saved = 0;
    let failed = 0;
    if (this.maxConcurrency !== 1) {
      this.logger.warn('snapshot.concurrency_limited', { requested: this.maxConcurrency, effective: 1 });
    }
    for (let index = 0; index < monitored.length; index += 1) {
      const candidate = monitored[index];
      if (!candidate) continue;
      try {
        await this.fetchWithBackoff(candidate.token.token.mint);
        saved += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn('snapshot.failed', {
          mint: candidate.token.token.mint,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      if (index < monitored.length - 1) await this.sleep(this.options.requestSpacingMs ?? 2_000);
    }
    this.logger.info('snapshot.cycle_completed', { candidates: monitored.length, saved, failed });
    return { candidates: monitored.length, saved, failed };
  }

  private async fetchWithBackoff(mint: string): Promise<void> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.snapshots.get(mint);
        return;
      } catch (error) {
        if (!isRetryable(error) || attempt === maxAttempts) throw error;
        const delayMs = 1_000 * 2 ** (attempt - 1);
        this.logger.warn('snapshot.retrying', { mint, attempt, delayMs, message: error instanceof Error ? error.message : String(error) });
        await this.sleep(delayMs);
      }
    }
  }

  private async sleep(milliseconds: number): Promise<void> {
    if (this.options.sleep) return this.options.sleep(milliseconds);
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

function isRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'retryable' in error && (error as { retryable?: unknown }).retryable === true;
}
