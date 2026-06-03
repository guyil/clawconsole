import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('feishu-notifier');

/**
 * Minimal Feishu (Lark) OpenAPI client for one purpose: pushing interactive
 * markdown cards to a single target chat_id from a tenant (custom internal)
 * app. Token is cached in-memory and proactively refreshed 5 minutes before
 * its server-reported expiry.
 *
 * Endpoints used:
 *   POST /open-apis/auth/v3/tenant_access_token/internal
 *   POST /open-apis/im/v1/messages?receive_id_type=chat_id
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

export interface FeishuNotifierConfig {
  appId: string;
  appSecret: string;
  chatId: string;
  baseUrl?: string;
}

export interface FeishuSendOptions {
  title: string;
  markdown: string;
  // Optional subtitle / metadata line shown under the title.
  subtitle?: string;
}

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface SendMessageResponse {
  code: number;
  msg: string;
  data?: unknown;
}

export class FeishuNotifier {
  private config: FeishuNotifierConfig;
  private baseUrl: string;
  private tokenCache: TokenCache | null = null;
  // Feishu text message content has a 30KB practical upper bound; a card's
  // individual element text is also limited. We conservatively truncate the
  // markdown body to keep a comfortable margin and always append a hint.
  private static readonly MAX_MARKDOWN_CHARS = 18_000;

  constructor(config: FeishuNotifierConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl ?? 'https://open.feishu.cn').replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.config.appId && this.config.appSecret && this.config.chatId);
  }

  missingConfigHint(): string {
    const missing: string[] = [];
    if (!this.config.appId) missing.push('FEISHU_APP_ID');
    if (!this.config.appSecret) missing.push('FEISHU_APP_SECRET');
    if (!this.config.chatId) missing.push('FEISHU_SUMMARY_CHAT_ID');
    return missing.length ? `Feishu not configured: missing ${missing.join(', ')}` : '';
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - 5 * 60 * 1000 > now) {
      return this.tokenCache.token;
    }

    const url = `${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const text = await res.text();
    let parsed: TenantTokenResponse;
    try {
      parsed = JSON.parse(text) as TenantTokenResponse;
    } catch {
      throw new Error(`Feishu token endpoint returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
    }

    if (parsed.code !== 0 || !parsed.tenant_access_token) {
      throw new Error(`Feishu tenant_access_token error: code=${parsed.code} msg=${parsed.msg}`);
    }

    const expiresInS = parsed.expire ?? 7200;
    this.tokenCache = {
      token: parsed.tenant_access_token,
      expiresAt: now + expiresInS * 1000,
    };
    return this.tokenCache.token;
  }

  /**
   * Send an interactive card containing the summary. Interactive cards give
   * us readable markdown rendering (headers, lists, code) without the 150
   * byte limit of plain text posts, and they fold nicely in group feeds.
   */
  async sendSummaryCard(opts: FeishuSendOptions): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error(this.missingConfigHint());
    }

    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`;

    let body = opts.markdown.trim();
    let truncatedHint = '';
    if (body.length > FeishuNotifier.MAX_MARKDOWN_CHARS) {
      body = body.slice(0, FeishuNotifier.MAX_MARKDOWN_CHARS);
      truncatedHint = `\n\n---\n**（内容过长，已截断，完整总结请到 ClawConsole 查看）**`;
    }

    const card = {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: opts.title },
        ...(opts.subtitle
          ? { subtitle: { tag: 'plain_text', content: opts.subtitle } }
          : {}),
      },
      elements: [
        ...(opts.subtitle
          ? [{
              tag: 'div',
              text: { tag: 'lark_md', content: `**${opts.subtitle}**` },
            }]
          : []),
        {
          tag: 'div',
          text: { tag: 'lark_md', content: body + truncatedHint },
        },
      ],
    };

    const payload = {
      receive_id: this.config.chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let parsed: SendMessageResponse;
    try {
      parsed = JSON.parse(text) as SendMessageResponse;
    } catch {
      throw new Error(`Feishu send endpoint returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
    }

    if (parsed.code !== 0) {
      // Invalidate cached token on auth-ish errors so the next call refreshes.
      if (parsed.code === 99991663 || parsed.code === 99991661 || parsed.code === 99991664) {
        this.tokenCache = null;
      }
      throw new Error(`Feishu send message error: code=${parsed.code} msg=${parsed.msg}`);
    }

    log.debug({ chatId: this.config.chatId, title: opts.title }, 'Feishu summary card sent');
  }
}
