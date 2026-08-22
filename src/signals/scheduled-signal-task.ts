import type { Logger } from '../logging/logger.js';
import { SignalCycle } from './signal-cycle.js';

export class ScheduledSignalTask {
  readonly name = 'research-signals';
  constructor(private readonly cycle: SignalCycle, private readonly logger: Logger) {}
  async runOnce(): Promise<void> { this.logger.info('signal.cycle_completed', { ...(await this.cycle.runOnce()) }); }
}
