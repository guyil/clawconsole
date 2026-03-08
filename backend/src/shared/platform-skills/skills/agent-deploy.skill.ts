import type { PlatformSkill, SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { cliGatewayRestart, runOpenClawCLI } from '../tools/openclaw-cli.tool.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:agent-deploy');

/**
 * Deploys an agent by ensuring its workspace exists, syncing config files
 * to the remote machine, and restarting the gateway.
 */
export const agentDeploySkill: PlatformSkill = {
  name: 'deploy_agent',
  description:
    'Deploy an agent on a remote machine. Ensures the workspace exists, ' +
    'writes default config files (SOUL.md, IDENTITY.md), and restarts the gateway. ' +
    'Updates the DB record status through the lifecycle: syncing -> online.',
  schema: {
    machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
    agentId: { type: 'string', description: 'The agent identifier (e.g. "customer_support")' },
    dbRecordId: { type: 'string', description: 'The DB record UUID (used to update status)' },
    soulContent: { type: 'string', description: 'Optional custom SOUL.md content' },
    identityName: { type: 'string', description: 'Optional display name for IDENTITY.md' },
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

      if (dbRecordId) {
        await ctx.agentRepo.update(dbRecordId, { status: 'syncing' });
      }

      // Determine workspace path
      const agent = dbRecordId ? await ctx.agentRepo.findById(dbRecordId) : null;
      const workspacePath = agent?.workspacePath ?? `workspace-${agentId}`;
      const workspaceAbsPath = `${openclawHome}/${workspacePath}`;

      // Ensure workspace directory exists
      const mkdirResult = await runOpenClawCLI(
        connInfo,
        `mkdir -p ${workspaceAbsPath}`,
        ctx,
        { timeoutMs: 10_000 },
      );
      if (!mkdirResult.success) {
        log.warn({ machineId, agentId, stderr: mkdirResult.stderr }, 'mkdir warning');
      }

      // Write default SOUL.md if it does not exist
      const soulContent = (args.soulContent as string) ||
        `# Soul\n\nYou are ${args.identityName || agentId}, a helpful AI assistant.\n`;
      await runOpenClawCLI(
        connInfo,
        `test -f ${workspaceAbsPath}/SOUL.md || cat > ${workspaceAbsPath}/SOUL.md << 'CLAWEOF'\n${soulContent}\nCLAWEOF`,
        ctx,
        { timeoutMs: 10_000 },
      );

      // Write default IDENTITY.md if it does not exist
      const identityName = (args.identityName as string) || agentId;
      await runOpenClawCLI(
        connInfo,
        `test -f ${workspaceAbsPath}/IDENTITY.md || cat > ${workspaceAbsPath}/IDENTITY.md << 'CLAWEOF'\n---\nname: "${identityName}"\n---\nCLAWEOF`,
        ctx,
        { timeoutMs: 10_000 },
      );

      // Restart gateway to pick up the new agent
      const restartResult = await cliGatewayRestart(connInfo, ctx);
      if (!restartResult.success) {
        log.warn({ machineId, stderr: restartResult.stderr }, 'Gateway restart warning');
      }

      // Update DB status to online
      if (dbRecordId) {
        await ctx.agentRepo.update(dbRecordId, { status: 'online' });
        await ctx.agentRepo.updateSyncTime(dbRecordId);
      }

      log.info({ machineId, agentId }, 'Agent deployed successfully');

      return JSON.stringify({
        success: true,
        agentId,
        machineId,
        workspacePath,
        message: `Agent "${agentId}" deployed and gateway restarted.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (dbRecordId) {
        await ctx.agentRepo.update(dbRecordId, { status: 'draft' }).catch(() => {});
      }
      return `Error deploying agent: ${message}`;
    }
  },
};
