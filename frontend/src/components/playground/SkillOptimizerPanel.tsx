import { useCallback } from 'react';
import { ChatThread } from '../chat';
import { Badge } from '../ui/Badge';
import { Sparkles } from 'lucide-react';
import { streamOptimizerChat } from '../../api/playground.api';
import type { PlaygroundSession } from '../../types/playground';

interface SkillOptimizerPanelProps {
  session: PlaygroundSession | null;
}

export function SkillOptimizerPanel({ session }: SkillOptimizerPanelProps) {
  const handleSendMessage = useCallback(
    (message: string) => {
      if (!session) {
        throw new Error('No active session');
      }
      return streamOptimizerChat(session.id, message);
    },
    [session],
  );

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-4">
          <Sparkles size={24} className="text-amber-400" />
        </div>
        <h3 className="text-base font-semibold text-claw-text mb-2">Skill Optimizer</h3>
        <p className="text-xs text-claw-muted max-w-[200px] leading-relaxed">
          Start a session to use the AI optimizer. It can improve your SKILL.md, create reference files, and tune instructions.
        </p>
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between px-3 py-2 border-b border-claw-border bg-claw-sidebar/50">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-amber-400" />
        <span className="text-sm font-medium text-claw-text">Optimizer</span>
        <Badge variant={session.status === 'active' ? 'success' : 'muted'}>
          {session.status === 'active' ? 'ready' : session.status}
        </Badge>
      </div>
    </div>
  );

  return (
    <ChatThread
      onSendMessage={handleSendMessage}
      header={header}
      disabled={session.status !== 'active'}
      placeholder={
        session.status === 'active'
          ? 'Ask the optimizer to improve your skill...'
          : 'Session ended'
      }
    />
  );
}
