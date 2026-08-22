import type { Logger } from '../logging/logger.js';

export interface ScheduledTask {
  readonly name: string;
  runOnce(): Promise<unknown>;
}

/** Runs one task at a fixed interval without overlapping or crashing the process. */
export class IntervalScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly task: ScheduledTask,
    private readonly intervalMs: number,
    private readonly logger: Logger
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('intervalMs must be a positive integer.');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runNow(); }, this.intervalMs);
    this.logger.info('scheduler.started', { task: this.task.name, intervalMs: this.intervalMs });
    void this.runNow();
  }

  async runNow(): Promise<void> {
    if (this.running) {
      this.logger.warn('scheduler.skipped_overlap', { task: this.task.name });
      return;
    }
    this.running = true;
    try {
      await this.task.runOnce();
      this.logger.info('scheduler.completed', { task: this.task.name });
    } catch (error) {
      this.logger.error('scheduler.failed', { task: this.task.name, message: errorMessage(error) });
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.logger.info('scheduler.stopped', { task: this.task.name });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
