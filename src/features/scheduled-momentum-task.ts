import type { Logger } from '../logging/logger.js';
import { MomentumCycle } from './momentum-cycle.js';

export class ScheduledMomentumTask {
  readonly name = 'momentum-features';

  constructor(private readonly cycle: MomentumCycle, private readonly logger: Logger) {}

  async runOnce(): Promise<void> {
    const result = await this.cycle.runOnce();
    this.logger.info('momentum.cycle_completed', { ...result });
  }
}
