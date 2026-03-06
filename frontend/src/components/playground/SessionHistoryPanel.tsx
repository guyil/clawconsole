import { formatDistanceToNow } from '../../utils/time';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Trash2 } from 'lucide-react';
import type { PlaygroundSession } from '../../types/playground';

interface SessionHistoryPanelProps {
  sessions: PlaygroundSession[];
  activeSessionId: string | null;
  onSelect: (session: PlaygroundSession) => void;
  onDelete: (id: string) => void;
}

const statusVariant: Record<string, 'success' | 'danger' | 'warning' | 'muted'> = {
  active: 'success',
  completed: 'muted',
  error: 'danger',
  timeout: 'warning',
};

export function SessionHistoryPanel({ sessions, activeSessionId, onSelect, onDelete }: SessionHistoryPanelProps) {
  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-claw-muted">
        No test sessions yet
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
      {sessions.map((session) => (
        <Card
          key={session.id}
          hover
          selected={session.id === activeSessionId}
          padding="p-3"
          onClick={() => onSelect(session)}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant[session.status] ?? 'muted'}>
                  {session.status}
                </Badge>
                <span className="text-xs text-claw-muted">{session.config.model}</span>
              </div>
              <p className="text-xs text-claw-muted mt-1 truncate">
                {session.messages.length} messages · {session.toolCallsLog.length} tool calls
              </p>
              <p className="text-[11px] text-claw-muted mt-0.5">
                {formatDistanceToNow(session.createdAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
