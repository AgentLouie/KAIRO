import type { Logger } from '../logging/logger.js';
import { ExploratoryActivityCycle } from './exploratory-activity-cycle.js';
export class ScheduledExploratoryActivityTask {
  readonly name = 'exploratory-paper-signals';
  constructor(private readonly cycle: ExploratoryActivityCycle, private readonly logger: Logger) {}
  async runOnce(): Promise<void> { this.logger.info('exploratory.cycle_completed', { ...(await this.cycle.runOnce()) }); }
}
