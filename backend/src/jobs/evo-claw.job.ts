import type { Job } from 'bullmq';
import type { EvoClawService } from '../modules/evo-claw/evo-claw.service.js';
import type { AgentRepository } from '../modules/agents/agent.repository.js';
import type { MachineRepository } from '../modules/machines/machine.repository.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('evo-claw-job');

export function createEvoClawHandler(
  ecaService: EvoClawService,
  agentRepo: AgentRepository,
  machineRepo: MachineRepository,
) {
  return async (_job: Job): Promise<void> => {
    log.info('Running scheduled evolution for all agents');

    try {
      const machines = await machineRepo.findAll();

      for (const machine of machines) {
        if (machine.status !== 'online') continue;

        const agents = await agentRepo.findByMachineId(machine.id);
        for (const agent of agents) {
          try {
            const shouldRun = await ecaService.shouldRunEvolution(machine.id, agent.agentId);
            if (!shouldRun) {
              log.debug(
                { machineId: machine.id, agentId: agent.agentId },
                'Skipping evolution — insufficient new sessions',
              );
              continue;
            }

            log.info(
              { machineId: machine.id, agentId: agent.agentId },
              'Triggering scheduled evolution',
            );
            await ecaService.triggerEvolution(machine.id, agent.agentId, 'scheduled');
          } catch (err) {
            log.error(
              { err, machineId: machine.id, agentId: agent.agentId },
              'Evolution failed for agent',
            );
          }
        }
      }

      log.info('Scheduled evolution complete');
    } catch (err) {
      log.error({ err }, 'Scheduled evolution run failed');
    }
  };
}
