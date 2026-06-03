import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationTurn } from '../../../src/modules/evo-claw/evo-claw.types.js';

const mockInvoke = vi.fn();

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    constructor() {}
    invoke = mockInvoke;
  },
}));

const { EvoClawJudge } = await import('../../../src/modules/evo-claw/evo-claw.judge.js');

function makeTurn(overrides?: Partial<ConversationTurn>): ConversationTurn {
  return {
    sessionId: 'sess-1',
    messageIndexStart: 0,
    messageIndexEnd: 2,
    userMessage: 'What is the compensation cap?',
    botResponse: 'I suggest 100% of contract value.',
    userFollowUp: 'That is wrong. Industry standard is 6-12 months.',
    precedingContext: [],
    ...overrides,
  };
}

describe('EvoClawJudge', () => {
  let judge: InstanceType<typeof EvoClawJudge>;

  beforeEach(() => {
    mockInvoke.mockReset();
    judge = new EvoClawJudge('claude-sonnet-4-20250514');
  });

  it('classifies a negative evaluative signal correctly', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({
        signalType: 'evaluative',
        polarity: 'negative',
        reason: 'User explicitly corrected the bot',
        failurePattern: 'Gave unrealistic compensation suggestion',
      }),
    });

    const verdict = await judge.classifyTurn(makeTurn());

    expect(verdict.signalType).toBe('evaluative');
    expect(verdict.polarity).toBe('negative');
    expect(verdict.failurePattern).toContain('compensation');
  });

  it('classifies an instructive signal with hint', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({
        signalType: 'instructive',
        polarity: 'negative',
        hint: 'Always check industry conventions first',
        reason: 'User provided specific directional guidance',
      }),
    });

    const verdict = await judge.classifyTurn(makeTurn({
      userFollowUp: 'You should always check industry conventions first before suggesting numbers.',
    }));

    expect(verdict.signalType).toBe('instructive');
    expect(verdict.hint).toContain('industry conventions');
  });

  it('classifies a positive signal', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({
        signalType: 'evaluative',
        polarity: 'positive',
        reason: 'User thanked the bot and moved on',
      }),
    });

    const verdict = await judge.classifyTurn(makeTurn({
      userFollowUp: 'Great, thanks! Now let me ask about...',
    }));

    expect(verdict.signalType).toBe('evaluative');
    expect(verdict.polarity).toBe('positive');
  });

  it('returns none for unrelated follow-ups', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({
        signalType: 'none',
        reason: 'Topic change, unrelated to response quality',
      }),
    });

    const verdict = await judge.classifyTurn(makeTurn({
      userFollowUp: 'By the way, what time is it?',
    }));

    expect(verdict.signalType).toBe('none');
  });

  it('handles malformed JSON gracefully', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: 'This is not valid JSON',
    });

    const verdict = await judge.classifyTurn(makeTurn());

    expect(verdict.signalType).toBe('none');
    expect(verdict.reason).toContain('Parse error');
  });

  it('handles API errors gracefully', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('API rate limit'));

    const verdict = await judge.classifyTurn(makeTurn());

    expect(verdict.signalType).toBe('none');
    expect(verdict.reason).toContain('Classification error');
  });

  it('classifies multiple turns in batch', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        content: JSON.stringify({ signalType: 'evaluative', polarity: 'negative', reason: 'bad' }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ signalType: 'none', reason: 'neutral' }),
      });

    const verdicts = await judge.classifyTurns([makeTurn(), makeTurn()]);

    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].signalType).toBe('evaluative');
    expect(verdicts[1].signalType).toBe('none');
  });
});
