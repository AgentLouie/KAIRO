import type { Logger } from '../logging/logger.js';
import { PaperExecutionCycle } from './paper-execution-cycle.js';

export class ScheduledPaperExecutionTask {
  readonly name = 'paper-execution';
  constructor(private readonly cycle: PaperExecutionCycle, private readonly logger: Logger) {}
  async runOnce(): Promise<void> { this.logger.info('paper_execution.cycle_completed', { ...(await this.cycle.runOnce()) }); }
}
