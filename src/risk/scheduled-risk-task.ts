import type { Logger } from '../logging/logger.js';
import { RiskCycle } from './risk-cycle.js';

export class ScheduledRiskTask {
  readonly name = 'risk-assessments';
  constructor(private readonly cycle: RiskCycle, private readonly logger: Logger, private readonly limit: number) {}
  async runOnce(): Promise<void> {
    this.logger.info('risk.cycle_completed', { ...(await this.cycle.runOnce(this.limit)) });
  }
}
