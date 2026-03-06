import { useCallback } from 'react';
import { ChatThread } from '../chat';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Square, RotateCcw } from 'lucide-react';
import { streamChat } from '../../api/playground.api';
import type { PlaygroundSession } from '../../types/playground';

interface SkillChatPanelProps {
  session: PlaygroundSession | null;
  onStop: () => void;
  onNewSession: () => void;
  stopping: boolean;
}

export function SkillChatPanel({ session, onStop, onNewSession, stopping }: SkillChatPanelProps) {
  const handleSendMessage = useCallback(
    (message: string) => {
      if (!session) {
        throw new Error('No active session');
      }
      return streamChat(session.id, message);
    },
    [session],
  );

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-claw-primary/10 flex items-center justify-center mb-4">
          <span className="text-3xl">💬</span>
        </div>
        <h3 className="text-lg font-semibold text-claw-text mb-2">Start Testing</h3>
        <p className="text-sm text-claw-muted max-w-xs">
          Write or select a skill in the editor, then click "Start Session" to begin chatting with the agent.
        </p>
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-claw-border bg-claw-sidebar/50">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-claw-text">Chat</span>
        <Badge variant={session.status === 'active' ? 'success' : 'muted'}>
          {session.status}
        </Badge>
        <span className="text-xs text-claw-muted">{session.config.model}</span>
      </div>

      <div className="flex items-center gap-2">
        {session.status === 'active' && (
          <Button size="sm" variant="danger" onClick={onStop} loading={stopping}>
            <Square size={12} />
            Stop
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onNewSession}>
          <RotateCcw size={14} />
          New
        </Button>
      </div>
    </div>
  );

  return (
    <ChatThread
      onSendMessage={handleSendMessage}
      header={header}
      disabled={session.status !== 'active'}
      placeholder={session.status === 'active' ? '输入消息测试 Skill...' : 'Session ended'}
    />
  );
}
