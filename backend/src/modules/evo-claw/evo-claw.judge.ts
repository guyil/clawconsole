import { ChatAnthropic } from '@langchain/anthropic';
import { createChildLogger } from '../../shared/logger.js';
import type { ConversationTurn, JudgeVerdict } from './evo-claw.types.js';

const log = createChildLogger('evo-judge');

const JUDGE_SYSTEM_PROMPT = `You are a conversation quality judge for an AI assistant system.
Your task is to analyze a conversation turn (user message → bot response → user follow-up)
and classify the feedback signal embedded in the user's follow-up.

## Signal Types

1. **evaluative** — The user's follow-up is a reaction to the bot's quality:
   - **negative**: User re-asks the same question differently, explicitly corrects, expresses frustration,
     abandons the topic, says "that's wrong/not what I meant", or the follow-up implies dissatisfaction.
   - **positive**: User thanks, confirms, builds on the answer naturally, expresses satisfaction.
   - **neutral**: User continues the conversation normally without evaluating the response.

2. **instructive** — The user provides specific directional guidance:
   "You should have done X", "Next time do Y first", "The correct approach is Z".
   Extract the hint (the specific direction the user gave).
   An instructive signal can also carry negative evaluative polarity.

3. **none** — The follow-up is unrelated to the bot's response quality (topic change, greeting, etc.).

## Output Format (JSON)

{
  "signalType": "evaluative" | "instructive" | "none",
  "polarity": "positive" | "negative" | "neutral",  // only for evaluative/instructive
  "hint": "extracted directional hint",               // only for instructive
  "reason": "brief explanation of classification",
  "failurePattern": "what the bot did wrong"           // only for negative evaluative
}

Respond ONLY with valid JSON, no markdown fencing.`;

export class EvoClawJudge {
  private model: ChatAnthropic;

  constructor(modelName: string) {
    this.model = new ChatAnthropic({
      model: modelName,
      maxTokens: 1024,
      temperature: 0,
    });
  }

  async classifyTurn(turn: ConversationTurn): Promise<JudgeVerdict> {
    const contextLines = turn.precedingContext
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    const userPrompt = [
      '## Preceding Context',
      contextLines || '(no prior context)',
      '',
      '## User Message',
      turn.userMessage,
      '',
      '## Bot Response',
      turn.botResponse,
      '',
      '## User Follow-Up',
      turn.userFollowUp,
    ].join('\n');

    try {
      const response = await this.model.invoke([
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseVerdict(text);
    } catch (err) {
      log.error({ err, sessionId: turn.sessionId }, 'Judge classification failed');
      return { signalType: 'none', reason: `Classification error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async classifyTurns(turns: ConversationTurn[]): Promise<JudgeVerdict[]> {
    const results: JudgeVerdict[] = [];
    for (const turn of turns) {
      const verdict = await this.classifyTurn(turn);
      results.push(verdict);
    }
    return results;
  }

  private parseVerdict(text: string): JudgeVerdict {
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      return {
        signalType: (parsed.signalType as JudgeVerdict['signalType']) ?? 'none',
        polarity: parsed.polarity as JudgeVerdict['polarity'],
        hint: parsed.hint as string | undefined,
        reason: (parsed.reason as string) ?? '',
        failurePattern: parsed.failurePattern as string | undefined,
      };
    } catch (err) {
      log.warn({ err, text: text.slice(0, 200) }, 'Failed to parse judge verdict');
      return { signalType: 'none', reason: `Parse error: ${text.slice(0, 100)}` };
    }
  }
}
