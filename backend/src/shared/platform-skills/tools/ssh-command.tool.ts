import type { LangGraphToolDef } from '../../langgraph/types.js';
import type { SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('ssh-command');

/**
 * Shared ssh_execute tool available to all platform agents.
 * Executes arbitrary shell commands on managed machines via SSH.
 */
export function createSshExecuteTool(ctx: SkillContext): LangGraphToolDef {
  return {
    name: 'ssh_execute',
    description:
      'Execute a shell command on a remote machine via SSH. ' +
      'Returns stdout, stderr, and exit code. Use for system administration.',
    schema: {
      machineId: { type: 'string', description: 'The machine ID (UUID) to execute the command on' },
      command: { type: 'string', description: 'The shell command to execute on the remote machine' },
      timeoutSeconds: { type: 'number', description: 'Command timeout in seconds (default: 30, max: 300)' },
    },
    handler: async (args) => {
      const machineId = args.machineId as string;
      const command = args.command as string;
      const timeout = Math.min(Number(args.timeoutSeconds) || 30, 300);

      try {
        const connInfo = await resolveConnectionInfo(machineId, ctx);
        log.info({ machineId, command }, 'Executing SSH command via platform skill');

        const escaped = command.replace(/'/g, "'\\''");
        const loginCommand = `zsh -lc '${escaped}'`;
        const result = await ctx.sshPool.executeCommand(connInfo, loginCommand, {
          timeoutMs: timeout * 1000,
        });

        return JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } catch (err) {
        return `Error executing command: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
