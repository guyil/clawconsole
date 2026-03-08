import type { PlatformSkill, SkillContext } from '../types.js';
import { resolveConnectionInfo } from '../types.js';
import { cliSetChannelAccount, runOpenClawCLI } from '../tools/openclaw-cli.tool.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('skill:channel-config');

/**
 * Configures a channel account on a remote machine by updating openclaw.json.
 * Supports Telegram (botToken), Discord (token), Slack (token + signingSecret),
 * and Feishu (appId + appSecret + optional encryptKey).
 * WhatsApp and Signal require interactive setup after deploy.
 */
export const channelConfigSkill: PlatformSkill = {
  name: 'configure_channel',
  description:
    'Configure a messaging channel account on a remote machine. ' +
    'Sets the channel token in openclaw.json (e.g. Telegram bot token, Discord token, Feishu App ID).',
  schema: {
    machineId: { type: 'string', description: 'The machine DB ID (UUID)' },
    channelType: { type: 'string', description: 'Channel type: telegram, discord, slack, feishu, whatsapp, or signal' },
    accountId: { type: 'string', description: 'Account identifier for the channel (e.g. "default", "work")' },
    token: { type: 'string', description: 'Authentication token (bot token, or Feishu App ID)' },
    signingSecret: { type: 'string', description: 'Signing secret (Slack) or App Secret (Feishu)' },
    encryptKey: { type: 'string', description: 'Encrypt Key for Feishu event verification (optional)' },
  },
  handler: async (args: Record<string, unknown>, ctx: SkillContext): Promise<string> => {
    const machineId = args.machineId as string;
    const channelType = args.channelType as string;
    const accountId = (args.accountId as string) || 'default';
    const token = args.token as string | undefined;

    if (!machineId || !channelType) {
      return 'Error: machineId and channelType are required';
    }

    const requiresToken = ['telegram', 'discord', 'slack', 'feishu'];
    if (requiresToken.includes(channelType) && !token) {
      return `Error: ${channelType} requires a token parameter`;
    }

    if (channelType === 'feishu' && !args.signingSecret) {
      return 'Error: feishu requires an appSecret (passed as signingSecret)';
    }

    if (channelType === 'whatsapp' || channelType === 'signal') {
      return JSON.stringify({
        success: true,
        channelType,
        accountId,
        message: `${channelType} requires interactive setup (QR pairing or device link) after deployment. ` +
          `Run "openclaw channels login --channel ${channelType} --account ${accountId}" on the machine.`,
        requiresInteractiveSetup: true,
      });
    }

    try {
      const connInfo = await resolveConnectionInfo(machineId, ctx);
      const machine = await ctx.machineRepo.findById(machineId);
      const openclawHome = machine?.openclawHome ?? '~/.openclaw';

      // Build field map based on channel type
      const fields: Record<string, string> = {};
      if (channelType === 'feishu') {
        fields.appId = token!;
        fields.appSecret = args.signingSecret as string;
        if (args.encryptKey) fields.encryptKey = args.encryptKey as string;
      } else if (channelType === 'slack') {
        fields.botToken = token!;
        if (args.signingSecret) fields.signingSecret = args.signingSecret as string;
      } else {
        fields.botToken = token!;
      }

      const result = await cliSetChannelAccount(
        connInfo, channelType, accountId, fields, openclawHome, ctx,
      );

      if (!result.success) {
        // Fallback: set fields one by one via openclaw config set
        log.warn({ channelType, accountId }, 'jq patch failed, trying config set');
        for (const [key, val] of Object.entries(fields)) {
          const fallback = await runOpenClawCLI(
            connInfo,
            `openclaw config set channels.${channelType}.accounts.${accountId}.${key} '${val.replace(/'/g, "'\\''")}'`,
            ctx,
          );
          if (!fallback.success) {
            log.warn({ accountId, key }, `Failed to set ${key}`);
          }
        }
      }

      log.info({ machineId, channelType, accountId }, 'Channel configured');

      return JSON.stringify({
        success: true,
        channelType,
        accountId,
        message: `Channel "${channelType}" account "${accountId}" configured successfully.`,
      });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
