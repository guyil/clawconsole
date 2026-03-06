import { useCallback } from 'react';
import { ChatThread } from '../chat';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { RotateCcw, Upload } from 'lucide-react';
import { streamConfigChat } from '../../api/bot-config-agent.api';
import { usePendingChanges, useSyncConfig, useResetConfigSession } from '../../hooks/useBotConfigAgent';
import { useQueryClient } from '@tanstack/react-query';
import { botConfigKeys } from '../../hooks/useBotConfigAgent';

interface BotConfigChatPanelProps {
  agentId: string;
  agentName: string;
}

export function BotConfigChatPanel({ agentId, agentName }: BotConfigChatPanelProps) {
  const { data: changesData } = usePendingChanges(agentId);
  const syncMutation = useSyncConfig(agentId);
  const resetMutation = useResetConfigSession(agentId);
  const qc = useQueryClient();

  const dirtyCount = changesData?.total ?? 0;

  const handleSendMessage = useCallback(
    (message: string) => {
      const gen = streamConfigChat(agentId, message);
      return wrapWithRefresh(gen, () => {
        qc.invalidateQueries({ queryKey: botConfigKeys.changes(agentId) });
        qc.invalidateQueries({ queryKey: botConfigKeys.session(agentId) });
      });
    },
    [agentId, qc],
  );

  const header = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-claw-border bg-claw-sidebar/50">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-claw-text">AI 配置助手</span>
        <Badge variant="info">{agentName}</Badge>
      </div>

      <div className="flex items-center gap-2">
        {dirtyCount > 0 && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => syncMutation.mutate()}
            loading={syncMutation.isPending}
            icon={<Upload size={12} />}
          >
            同步 ({dirtyCount})
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => resetMutation.mutate()}
          loading={resetMutation.isPending}
          icon={<RotateCcw size={14} />}
        >
          重置
        </Button>
      </div>
    </div>
  );

  return (
    <ChatThread
      onSendMessage={handleSendMessage}
      header={header}
      placeholder="描述你想要的 Bot 人设调整..."
    />
  );
}

/**
 * Wraps an async generator to call a callback after the stream finishes.
 * Used to refresh pending changes after the AI makes tool calls.
 */
async function* wrapWithRefresh(
  gen: AsyncGenerator<{ type: string; data: Record<string, unknown> }>,
  onDone: () => void,
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  try {
    for await (const event of gen) {
      yield event;
    }
  } finally {
    onDone();
  }
}
