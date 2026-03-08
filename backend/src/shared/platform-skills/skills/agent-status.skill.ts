import type { PlatformSkill, SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { cliAgentsList, cliChannelsStatus, cliGatewayRestart } from '../tools/openclaw-cli.tool.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:agent-status');

/**
 * Checks the status of agents and channels on a remote machine.
 */
export const agentStatusSkill: PlatformSkill = {
  name: 'check_agent_status',
  description:
    'Check the status of agents and channels on a remote machine. ' +
    'Runs "openclaw agents list --bindings" and "openclaw channels status --probe".',
  schema: {
    machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
  },
  handler: async (args: Record<string, unknown>, ctx: SkillContext): Promise<string> => {
    const machineId = args.machineId as string;
    if (!machineId) return 'Error: machineId is required';

    try {
      const connInfo = await resolveConnectionInfo(machineId, ctx);

      const [agentsResult, channelsResult] = await Promise.all([
        cliAgentsList(connInfo, ctx),
        cliChannelsStatus(connInfo, ctx),
      ]);

      return JSON.stringify({
        agents: {
          success: agentsResult.success,
          output: agentsResult.stdout,
          error: agentsResult.success ? undefined : agentsResult.stderr,
        },
        channels: {
          success: channelsResult.success,
          output: channelsResult.stdout,
          error: channelsResult.success ? undefined : channelsResult.stderr,
        },
      }, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Restarts the openclaw gateway on a remote machine.
 */
export const gatewayRestartSkill: PlatformSkill = {
  name: 'restart_gateway',
  description: 'Restart the openclaw gateway on a remote machine to apply configuration changes.',
  schema: {
    machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
  },
  handler: async (args: Record<string, unknown>, ctx: SkillContext): Promise<string> => {
    const machineId = args.machineId as string;
    if (!machineId) return 'Error: machineId is required';

    try {
      const connInfo = await resolveConnectionInfo(machineId, ctx);
      const result = await cliGatewayRestart(connInfo, ctx);

      if (!result.success) {
        log.error({ machineId, stderr: result.stderr }, 'Gateway restart failed');
        return `Error restarting gateway: ${result.stderr || result.stdout}`;
      }

      log.info({ machineId }, 'Gateway restarted');
      return JSON.stringify({
        success: true,
        message: 'Gateway restarted successfully.',
        output: result.stdout,
      });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
