import { DiscoveryCycle } from './discovery-cycle.js';
import type { Logger } from '../logging/logger.js';

export class ScheduledDiscoveryTask {
  readonly name = 'pumpfun-discovery';

  constructor(private readonly cycle: DiscoveryCycle, private readonly logger: Logger, private readonly limit = 20) {}

  async runOnce(): Promise<void> {
    const result = await this.cycle.runOnce(this.limit);
    this.logger.info('discovery.cycle_completed', {
      listingsReceived: result.listingsReceived,
      skippedKnown: result.skippedKnown,
      mayhemRejected: result.mayhemRejected,
      monitoringAdded: result.observingAdded,
      monitoringTotal: result.monitored.length,
      rejected: result.rejected
    });
  }
}
