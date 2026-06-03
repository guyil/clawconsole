import type { PlatformSkill, SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { cliAgentsAdd, cliAgentsList } from '../tools/openclaw-cli.tool.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:agent-create');

/**
 * Heuristic check for "agent already registered" errors from
 * `openclaw agents add`. The CLI returns non-zero in these cases but
 * conceptually the operation is a no-op for our provisioning flow
 * (workspace + openclaw.json entry are already present), so we want
 * provisioning of discovered/re-provisioned bots to proceed.
 */
function isAlreadyExistsError(stderr: string, stdout: string): boolean {
  const haystack = `${stderr}\n${stdout}`.toLowerCase();
  return (
    haystack.includes('already exists') ||
    haystack.includes('already registered') ||
    haystack.includes('agent exists')
  );
}

/**
 * Pre-check: is `agentId` already listed by `openclaw agents list`?
 * Used to short-circuit the `add` call entirely for bots that were
 * picked up by the discovery scan.
 */
async function isAgentAlreadyRegistered(
  connInfo: Awaited<ReturnType<typeof resolveConnectionInfo>>,
  agentId: string,
  ctx: SkillContext,
): Promise<boolean> {
  try {
    const list = await cliAgentsList(connInfo, ctx);
    if (!list.success) return false;
    // The CLI prints one line per agent; the agentId appears as a token
    // somewhere on its line. Match against word boundaries to avoid
    // confusing a substring match (e.g. "evo" matching "evolution").
    const re = new RegExp(`(^|\\s|"|')${agentId}($|\\s|"|':)`, 'm');
    return re.test(list.stdout);
  } catch {
    return false;
  }
}

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

      // Discovery-friendly fast path: if the agent is already registered in
      // openclaw.json (e.g. it was picked up by `POST /machines/:id/discover`
      // and the user is now provisioning it via the "配置飞书" quick action),
      // skip the `agents add` call entirely.
      if (await isAgentAlreadyRegistered(connInfo, agentId, ctx)) {
        log.info({ machineId, agentId }, 'Agent already registered, skipping create');
        return JSON.stringify({
          success: true,
          agentId,
          machineId,
          alreadyExisted: true,
          message: `Agent "${agentId}" is already registered on the remote machine; reusing existing workspace.`,
        });
      }

      const result = await cliAgentsAdd(connInfo, agentId, ctx, {
        workspace: fullWorkspace,
        model: args.model as string | undefined,
      });

      if (!result.success) {
        // Tolerant retry path: if the CLI failed because the agent already
        // exists (race with another caller, or workspace folder lingered),
        // treat as success — the rest of the provision pipeline (configure
        // channel + bind + deploy) is still meaningful.
        if (isAlreadyExistsError(result.stderr, result.stdout)) {
          log.info({ machineId, agentId }, 'Agent already exists on remote, treating add as no-op');
          return JSON.stringify({
            success: true,
            agentId,
            machineId,
            alreadyExisted: true,
            message: `Agent "${agentId}" already exists on the remote machine; continuing provision.`,
            output: result.stdout || result.stderr,
          });
        }

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
