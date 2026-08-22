import type { Logger } from '../logging/logger.js';
import { ActivityPruner } from './activity-pruner.js';

export class ScheduledActivityPruner {
  readonly name = 'inactive-candidate-pruner';
  constructor(private readonly pruner: ActivityPruner, private readonly logger: Logger) {}
  async runOnce(): Promise<void> { this.logger.info('candidate.prune_completed', { ...(await this.pruner.runOnce()) }); }
}
