import type { PlatformSkill, SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { cliAgentsBind } from '../tools/openclaw-cli.tool.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:channel-bind');

/**
 * Binds one or more channel accounts to an agent on a remote machine.
 * Runs `openclaw agents bind --agent <agentId> --bind <channel>:<accountId>`.
 */
export const channelBindSkill: PlatformSkill = {
  name: 'bind_channel_to_agent',
  description:
    'Bind messaging channels to an agent on a remote machine. ' +
    'This adds routing bindings so messages from a channel account are routed to the specified agent.',
  schema: {
    machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
    agentId: { type: 'string', description: 'The agent identifier (e.g. "customer_support")' },
    bindings: { type: 'string', description: 'Comma-separated list of bindings in format "channel:accountId" (e.g. "telegram:work,discord:guild-a")' },
  },
  handler: async (args: Record<string, unknown>, ctx: SkillContext): Promise<string> => {
    const machineId = args.machineId as string;
    const agentId = args.agentId as string;
    const bindingsRaw = args.bindings as string;

    if (!machineId || !agentId || !bindingsRaw) {
      return 'Error: machineId, agentId, and bindings are required';
    }

    const bindings = bindingsRaw.split(',').map((b) => b.trim()).filter(Boolean);
    if (bindings.length === 0) {
      return 'Error: at least one binding is required';
    }

    try {
      const connInfo = await resolveConnectionInfo(machineId, ctx);
      const result = await cliAgentsBind(connInfo, agentId, bindings, ctx);

      if (!result.success) {
        log.error({ machineId, agentId, stderr: result.stderr }, 'Failed to bind channels');
        return `Error binding channels: ${result.stderr || result.stdout}`;
      }

      log.info({ machineId, agentId, bindings }, 'Channels bound to agent');

      return JSON.stringify({
        success: true,
        agentId,
        bindings,
        message: `Bound ${bindings.length} channel(s) to agent "${agentId}".`,
      });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
