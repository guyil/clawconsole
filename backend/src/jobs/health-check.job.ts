import type { Job } from 'bullmq';
import type { MachineService } from '../modules/machines/machine.service.js';
import type { GatewayConnectorPool } from '../modules/monitoring/gateway-connector.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('health-check-job');

export function createHealthCheckHandler(
  machineService: MachineService,
  gatewayPool?: GatewayConnectorPool,
) {
  return async (_job: Job): Promise<void> => {
    const machines = await machineService.listMachines();

    log.info({ count: machines.length }, 'Running health checks');

    for (const machine of machines) {
      if (machine.status === 'archived' as any) continue;

      try {
        const result = await machineService.healthCheck(machine.id);
        if (gatewayPool) {
          if (result.status === 'online' && !gatewayPool.isConnected(machine.id)) {
            gatewayPool.addMachine({
              machineId: machine.id,
              host: machine.tailscaleHostname,
              port: config.gateway.defaultPort,
            });
          } else if (result.status === 'offline') {
            gatewayPool.removeMachine(machine.id);
          }
        }
      } catch (err) {
        log.error({ machineId: machine.id, err }, 'Health check failed');
      }
    }
  };
}
