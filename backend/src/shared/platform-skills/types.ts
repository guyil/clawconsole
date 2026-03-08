import type { SSHPool, SSHConnectionInfo } from '../../transport/ssh-pool.js';
import type { MachineService } from '../../modules/machines/machine.service.js';
import type { MachineRepository } from '../../modules/machines/machine.repository.js';
import type { AgentRepository } from '../../modules/agents/agent.repository.js';
import type { LangGraphToolDef } from '../langgraph/types.js';

/**
 * Dependencies available to all platform skills at runtime.
 * Injected once at startup and shared across skill invocations.
 */
export interface SkillContext {
  sshPool: SSHPool;
  machineService: MachineService;
  machineRepo: MachineRepository;
  agentRepo: AgentRepository;
}

/**
 * A platform skill encapsulates a reusable operation (e.g. creating an agent,
 * configuring a channel) that can be exposed as a LangGraph tool to any AI agent.
 */
export interface PlatformSkill {
  name: string;
  description: string;
  /** JSON-schema-style field definitions for the tool's input parameters. */
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: SkillContext) => Promise<string>;
}

/**
 * Converts a PlatformSkill into a LangGraphToolDef by binding the SkillContext.
 */
export function skillToLangGraphTool(skill: PlatformSkill, ctx: SkillContext): LangGraphToolDef {
  return {
    name: skill.name,
    description: skill.description,
    schema: skill.schema,
    handler: (args) => skill.handler(args, ctx),
  };
}

/**
 * Result returned by SSH-based openclaw CLI operations.
 */
export interface CLIResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Channel types supported by openclaw. */
export type ChannelType = 'telegram' | 'discord' | 'slack' | 'feishu' | 'whatsapp' | 'signal';

/** Channel configuration provided during bot provisioning. */
export interface ChannelConfig {
  channelType: ChannelType;
  accountId: string;
  token?: string;
  /** Slack signing secret, or Feishu App Secret */
  signingSecret?: string;
  /** Feishu Encrypt Key (optional) */
  encryptKey?: string;
}

/** Progress event emitted during multi-step provisioning. */
export interface ProvisionProgress {
  step: string;
  status: 'running' | 'success' | 'error';
  message: string;
  detail?: string;
}

/**
 * Helper to resolve SSH connection info for a machine by its DB id.
 */
export async function resolveConnectionInfo(
  machineId: string,
  ctx: SkillContext,
): Promise<SSHConnectionInfo> {
  const machine = await ctx.machineRepo.findById(machineId);
  if (!machine) throw new Error(`Machine ${machineId} not found`);
  return ctx.machineService.toConnectionInfo(machine);
}
