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
  private abortController: AbortController | undefined;

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
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const monitored = await this.candidates.observing();
    let saved = 0;
    let failed = 0;
    if (this.maxConcurrency !== 1) {
      this.logger.warn('snapshot.concurrency_limited', { requested: this.maxConcurrency, effective: 1 });
    }
    for (let index = 0; index < monitored.length; index += 1) {
      if (signal.aborted) break;
      const candidate = monitored[index];
      if (!candidate) continue;
      try {
        await this.fetchWithBackoff(candidate.token.token.mint, signal);
        saved += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn('snapshot.failed', {
          mint: candidate.token.token.mint,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      if (index < monitored.length - 1 && !await this.sleep(this.options.requestSpacingMs ?? 2_000, signal)) break;
    }
    this.abortController = undefined;
    this.logger.info('snapshot.cycle_completed', { candidates: monitored.length, saved, failed, cancelled: signal.aborted });
    return { candidates: monitored.length, saved, failed };
  }

  stop(): void {
    this.abortController?.abort();
  }

  private async fetchWithBackoff(mint: string, signal: AbortSignal): Promise<void> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal.aborted) return;
      try {
        await this.snapshots.get(mint);
        return;
      } catch (error) {
        if (!isRetryable(error) || attempt === maxAttempts) throw error;
        const delayMs = 1_000 * 2 ** (attempt - 1);
        this.logger.warn('snapshot.retrying', { mint, attempt, delayMs, message: error instanceof Error ? error.message : String(error) });
        if (!await this.sleep(delayMs, signal)) return;
      }
    }
  }

  private async sleep(milliseconds: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    if (this.options.sleep) {
      await this.options.sleep(milliseconds);
      return !signal.aborted;
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(true), milliseconds);
      const finish = (completed: boolean): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(completed);
      };
      const onAbort = (): void => finish(false);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function isRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'retryable' in error && (error as { retryable?: unknown }).retryable === true;
}
