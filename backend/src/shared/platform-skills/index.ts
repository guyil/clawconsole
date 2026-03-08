export { PlatformSkillRegistry } from './registry.js';
export type {
  PlatformSkill,
  SkillContext,
  CLIResult,
  ChannelType,
  ChannelConfig,
  ProvisionProgress,
} from './types.js';
export { skillToLangGraphTool, resolveConnectionInfo } from './types.js';

// Skills
export { agentCreateSkill } from './skills/agent-create.skill.js';
export { channelConfigSkill } from './skills/channel-config.skill.js';
export { channelBindSkill } from './skills/channel-bind.skill.js';
export { agentDeploySkill } from './skills/agent-deploy.skill.js';
export { agentStatusSkill, gatewayRestartSkill } from './skills/agent-status.skill.js';

// Shared tools
export { createWebFetchTool } from './tools/web-fetch.tool.js';
export { createSshExecuteTool } from './tools/ssh-command.tool.js';
export { runOpenClawCLI } from './tools/openclaw-cli.tool.js';

import type { PlatformSkill } from './types.js';
import { agentCreateSkill } from './skills/agent-create.skill.js';
import { channelConfigSkill } from './skills/channel-config.skill.js';
import { channelBindSkill } from './skills/channel-bind.skill.js';
import { agentDeploySkill } from './skills/agent-deploy.skill.js';
import { agentStatusSkill, gatewayRestartSkill } from './skills/agent-status.skill.js';

/** All built-in platform skills, ready to register in the PlatformSkillRegistry. */
export const allPlatformSkills: PlatformSkill[] = [
  agentCreateSkill,
  channelConfigSkill,
  channelBindSkill,
  agentDeploySkill,
  agentStatusSkill,
  gatewayRestartSkill,
];
