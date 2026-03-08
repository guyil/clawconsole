import type { SSHConnectionInfo } from '../../../transport/ssh-pool.js';
import type { SkillContext, CLIResult } from '../types.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('openclaw-cli');

/**
 * Execute an openclaw CLI command on a remote machine via SSH.
 * Wraps the SSHPool to handle PATH setup and error formatting.
 */
export async function runOpenClawCLI(
  connInfo: SSHConnectionInfo,
  command: string,
  ctx: SkillContext,
  options: { timeoutMs?: number } = {},
): Promise<CLIResult> {
  // Wrap in a login shell so the user's profile (.zprofile/.zshrc/.profile)
  // is sourced and PATH is fully set up — matches interactive SSH behavior.
  const escaped = command.replace(/'/g, "'\\''");
  const fullCommand = `zsh -lc '${escaped}'`;
  const timeoutMs = options.timeoutMs ?? 60_000;

  log.info({ machineId: connInfo.machineId, command }, 'Executing openclaw CLI command');

  try {
    const result = await ctx.sshPool.executeCommand(connInfo, fullCommand, { timeoutMs });

    log.info(
      { machineId: connInfo.machineId, exitCode: result.exitCode, command },
      'CLI command completed',
    );

    return {
      success: result.exitCode === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      exitCode: result.exitCode,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ machineId: connInfo.machineId, command, error: message }, 'CLI command failed');
    return {
      success: false,
      stdout: '',
      stderr: message,
      exitCode: -1,
    };
  }
}

/**
 * Run `openclaw agents add <agentId>` on the remote machine.
 */
export async function cliAgentsAdd(
  connInfo: SSHConnectionInfo,
  agentId: string,
  ctx: SkillContext,
  options?: { workspace?: string; model?: string },
): Promise<CLIResult> {
  const workspace = options?.workspace ?? `workspace-${agentId}`;
  const parts = ['openclaw agents add', agentId, '--non-interactive', `--workspace ${workspace}`];
  if (options?.model) parts.push(`--model ${options.model}`);
  return runOpenClawCLI(connInfo, parts.join(' '), ctx, { timeoutMs: 30_000 });
}

/**
 * Run `openclaw agents bind` to add routing bindings.
 */
export async function cliAgentsBind(
  connInfo: SSHConnectionInfo,
  agentId: string,
  bindings: string[],
  ctx: SkillContext,
): Promise<CLIResult> {
  const bindFlags = bindings.map((b) => `--bind ${b}`).join(' ');
  return runOpenClawCLI(
    connInfo,
    `openclaw agents bind --agent ${agentId} ${bindFlags}`,
    ctx,
    { timeoutMs: 15_000 },
  );
}

/**
 * Run `openclaw agents list --bindings` to verify agent setup.
 */
export async function cliAgentsList(
  connInfo: SSHConnectionInfo,
  ctx: SkillContext,
): Promise<CLIResult> {
  return runOpenClawCLI(connInfo, 'openclaw agents list --bindings', ctx, { timeoutMs: 15_000 });
}

/**
 * Run `openclaw channels status --probe` to verify channels.
 */
export async function cliChannelsStatus(
  connInfo: SSHConnectionInfo,
  ctx: SkillContext,
): Promise<CLIResult> {
  return runOpenClawCLI(connInfo, 'openclaw channels status --probe', ctx, { timeoutMs: 30_000 });
}

/**
 * Restart the openclaw gateway on a remote machine.
 */
export async function cliGatewayRestart(
  connInfo: SSHConnectionInfo,
  ctx: SkillContext,
): Promise<CLIResult> {
  return runOpenClawCLI(connInfo, 'openclaw gateway restart', ctx, { timeoutMs: 30_000 });
}

/**
 * Read or write a JSON key in openclaw.json on the remote machine.
 * Uses `openclaw config set` for writes and `openclaw config get` for reads.
 */
export async function cliConfigSet(
  connInfo: SSHConnectionInfo,
  key: string,
  value: string,
  ctx: SkillContext,
): Promise<CLIResult> {
  return runOpenClawCLI(
    connInfo,
    `openclaw config set ${key} '${value.replace(/'/g, "'\\''")}'`,
    ctx,
    { timeoutMs: 10_000 },
  );
}

/**
 * Add a channel account with credentials via direct JSON patch on openclaw.json.
 * Uses jq to atomically update one or more keys on the account object.
 *
 * @param fields - key-value pairs to set (e.g. { appId: "...", appSecret: "..." })
 */
export async function cliSetChannelAccount(
  connInfo: SSHConnectionInfo,
  channelType: string,
  accountId: string,
  fields: Record<string, string>,
  openclawHome: string,
  ctx: SkillContext,
): Promise<CLIResult> {
  const configPath = `${openclawHome}/openclaw.json`;
  const base = `.channels.${channelType}.accounts.${accountId}`;
  const jqParts = Object.entries(fields).map(
    ([key, val]) => `${base}.${key} = "${val.replace(/"/g, '\\"')}"`,
  );
  const jqExpr = jqParts.join(' | ');
  const command = `jq '${jqExpr}' ${configPath} > ${configPath}.tmp && mv ${configPath}.tmp ${configPath}`;
  return runOpenClawCLI(connInfo, command, ctx, { timeoutMs: 10_000 });
}

/** @deprecated Use cliSetChannelAccount instead. Kept for backward compat. */
export async function cliSetChannelToken(
  connInfo: SSHConnectionInfo,
  channelType: string,
  accountId: string,
  token: string,
  openclawHome: string,
  ctx: SkillContext,
): Promise<CLIResult> {
  return cliSetChannelAccount(connInfo, channelType, accountId, { botToken: token }, openclawHome, ctx);
}
