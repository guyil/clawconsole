import type { PlatformSkill, SkillContext } from '../types.js';
import type { EvoClawService } from '../../../modules/evo-claw/evo-claw.service.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:trigger-evolution');

/**
 * Factory that creates the trigger-evolution platform skill.
 * The ecaService is captured via closure since it's not part of the
 * standard SkillContext (which only has SSH/machine/agent infra).
 */
export function createTriggerEvolutionSkill(ecaService: EvoClawService): PlatformSkill {
  return {
    name: 'trigger_evolution',
    description:
      'Trigger an ECA (evoClawAssociation) evolution run for a specific agent. ' +
      'Analyzes recent session transcripts, extracts feedback signals, distills behavior rules ' +
      'and case examples, and writes them back into the bot\'s config files. ' +
      'Use when the user says "/evo" or asks to evolve/improve a bot based on conversation history.',
    schema: {
      machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
      agentId: { type: 'string', description: 'The agent ID (e.g. "pm", "main")' },
    },
    handler: async (args: Record<string, unknown>, _ctx: SkillContext): Promise<string> => {
      const machineId = args.machineId as string;
      const agentId = args.agentId as string;

      if (!machineId) return 'Error: machineId is required';
      if (!agentId) return 'Error: agentId is required';

      try {
        log.info({ machineId, agentId }, 'Evolution triggered via platform skill');
        const run = await ecaService.triggerEvolution(machineId, agentId, 'skill');

        return JSON.stringify({
          success: run.status === 'completed',
          runId: run.id,
          status: run.status,
          sessionsAnalyzed: run.sessionsAnalyzed,
          signalsFound: run.signalsFound,
          rulesGenerated: run.rulesGenerated,
          casesGenerated: run.casesGenerated,
          summary: run.summary,
          errorMessage: run.errorMessage,
        }, null, 2);
      } catch (err) {
        log.error({ err, machineId, agentId }, 'Evolution trigger failed');
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
