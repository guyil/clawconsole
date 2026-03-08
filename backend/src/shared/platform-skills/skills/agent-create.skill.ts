import type { PlatformSkill, SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { cliAgentsAdd } from '../tools/openclaw-cli.tool.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:agent-create');

/**
 * Creates a new agent on a remote machine by running `openclaw agents add`.
 * Also updates the local DB record status from 'draft' to 'packaging'.
 */
export const agentCreateSkill: PlatformSkill = {
  name: 'create_agent_on_node',
  description:
    'Create a new openclaw agent on a remote machine. ' +
    'This runs "openclaw agents add" via SSH to register the agent and initialize its workspace.',
  schema: {
    machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
    agentId: { type: 'string', description: 'The agent identifier (e.g. "customer_support")' },
    dbRecordId: { type: 'string', description: 'The DB record UUID for this agent (used to update status)' },
    workspace: { type: 'string', description: 'Custom workspace path (optional, defaults to ~/.openclaw/workspace-<agentId>)' },
    model: { type: 'string', description: 'Model to assign to this agent (optional)' },
  },
  handler: async (args: Record<string, unknown>, ctx: SkillContext): Promise<string> => {
    const machineId = args.machineId as string;
    const agentId = args.agentId as string;
    const dbRecordId = args.dbRecordId as string | undefined;

    if (!machineId || !agentId) {
      return 'Error: machineId and agentId are required';
    }

    try {
      const connInfo = await resolveConnectionInfo(machineId, ctx);
      const machine = await ctx.machineRepo.findById(machineId);
      const openclawHome = machine?.openclawHome ?? '~/.openclaw';

      // Update DB status to 'packaging' if we have a DB record
      if (dbRecordId) {
        await ctx.agentRepo.update(dbRecordId, { status: 'packaging' });
      }

      // Resolve full workspace path: the CLI's resolveUserPath resolves relative
      // paths against CWD, so we must prepend openclawHome for correct placement.
      const relativeWorkspace = (args.workspace as string | undefined) ?? `workspace-${agentId}`;
      const fullWorkspace = `${openclawHome}/${relativeWorkspace}`;

      const result = await cliAgentsAdd(connInfo, agentId, ctx, {
        workspace: fullWorkspace,
        model: args.model as string | undefined,
      });

      if (!result.success) {
        log.error({ machineId, agentId, stderr: result.stderr }, 'Failed to create agent');
        // Revert status on failure
        if (dbRecordId) {
          await ctx.agentRepo.update(dbRecordId, { status: 'draft' });
        }
        return `Error creating agent: ${result.stderr || result.stdout}`;
      }

      log.info({ machineId, agentId }, 'Agent created on remote machine');

      return JSON.stringify({
        success: true,
        agentId,
        machineId,
        message: `Agent "${agentId}" created successfully on the remote machine.`,
        output: result.stdout,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (dbRecordId) {
        await ctx.agentRepo.update(dbRecordId, { status: 'draft' }).catch(() => {});
      }
      return `Error: ${message}`;
    }
  },
};
