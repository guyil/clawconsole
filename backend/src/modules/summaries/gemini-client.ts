import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('gemini-client');

/**
 * Thin wrapper over the Google Gemini REST API (generativelanguage.googleapis.com).
 *
 * Why raw fetch instead of a SDK:
 *   - No extra langchain/SDK dep required, avoids peer-range churn.
 *   - The only call we make is a single-shot `generateContent`, which the
 *     REST surface handles cleanly with system_instruction + contents.
 *
 * Endpoint reference (v1beta):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
 */

export interface GeminiGenerateOptions {
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  // Absolute timeout for the HTTP call. Gemini 3-flash usually returns in
  // seconds, but long-context inputs can take >30s; default 60s.
  timeoutMs?: number;
}

export interface GeminiUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface GeminiResponse {
  text: string;
  usage: GeminiUsage;
  model: string;
  finishReason: string | null;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
      role?: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  promptFeedback?: {
    blockReason?: string;
  };
}

export class GeminiClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string, baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  getModel(): string {
    return this.model;
  }

  async generate(opts: GeminiGenerateOptions): Promise<GeminiResponse> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: opts.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      },
    };

    if (opts.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: opts.systemInstruction }],
      };
    }

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: GeminiApiResponse;
      try {
        parsed = JSON.parse(text) as GeminiApiResponse;
      } catch {
        throw new Error(`Gemini returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
      }

      if (!res.ok || parsed.error) {
        const msg = parsed.error?.message ?? `HTTP ${res.status}`;
        log.warn({ status: res.status, model: this.model, error: parsed.error }, 'Gemini API error');
        throw new Error(`Gemini API error: ${msg}`);
      }

      const blockReason = parsed.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Gemini blocked the prompt: ${blockReason}`);
      }

      const candidate = parsed.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const outputText = parts.map((p) => p.text ?? '').join('').trim();

      if (!outputText) {
        throw new Error(`Gemini returned empty response (finishReason=${candidate?.finishReason ?? 'unknown'})`);
      }

      return {
        text: outputText,
        usage: {
          promptTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
          candidatesTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: parsed.usageMetadata?.totalTokenCount ?? 0,
        },
        model: this.model,
        finishReason: candidate?.finishReason ?? null,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
