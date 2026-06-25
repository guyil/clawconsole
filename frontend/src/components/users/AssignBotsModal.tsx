import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Bot } from 'lucide-react';
import { useAllAgents } from '../../hooks/useAgents';
import { useSetAssignments } from '../../hooks/useUsers';
import type { ManagedUser } from '../../api/users.api';

interface Props {
  open: boolean;
  onClose: () => void;
  user: ManagedUser | null;
}

export function AssignBotsModal({ open, onClose, user }: Props) {
  const { data: agentsData, isLoading } = useAllAgents();
  const setAssignments = useSetAssignments();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(user?.assignedAgentIds ?? []));
  }, [user, open]);

  const agents = agentsData?.data ?? [];

  // Group bots by machine for a scannable list.
  const grouped = useMemo(() => {
    const map = new Map<string, { machineName: string; bots: typeof agents }>();
    for (const a of agents) {
      const key = a.machineId;
      if (!map.has(key)) map.set(key, { machineName: a.machineName, bots: [] });
      map.get(key)!.bots.push(a);
    }
    return [...map.values()];
  }, [agents]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (bots: typeof agents) => {
    const allSelected = bots.every((b) => selected.has(b.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of bots) {
        if (allSelected) next.delete(b.id);
        else next.add(b.id);
      }
      return next;
    });
  };

  const handleSave = () => {
    if (!user) return;
    setAssignments.mutate(
      { id: user.id, agentIds: [...selected] },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`分配 Bot · ${user?.username ?? ''}`}
      width="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between text-[13px] text-claw-muted">
          <span>勾选该开发者可见并可监测的 Bot</span>
          <span>已选 {selected.size} 个</span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-claw-muted">加载中…</div>
        ) : agents.length === 0 ? (
          <div className="py-8 text-center text-sm text-claw-muted">暂无可分配的 Bot</div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-1">
            {grouped.map((group) => {
              const allSelected = group.bots.every((b) => selected.has(b.id));
              return (
              <div key={group.machineName}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-claw-muted">
                    {group.machineName}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.bots)}
                    className="text-[11px] text-claw-primary hover:underline"
                  >
                    {allSelected ? '取消全选' : '全选'}
                    <span className="text-claw-muted ml-1">
                      ({group.bots.filter((b) => selected.has(b.id)).length}/{group.bots.length})
                    </span>
                  </button>
                </div>
                <div className="space-y-1">
                  {group.bots.map((bot) => {
                    const checked = selected.has(bot.id);
                    return (
                      <label
                        key={bot.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'border-claw-primary/40 bg-claw-primary/10'
                            : 'border-claw-border hover:bg-claw-card'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(bot.id)}
                          className="accent-claw-primary"
                        />
                        <Bot size={15} className="text-claw-muted shrink-0" />
                        <span className="text-sm text-claw-text truncate">
                          {bot.name || bot.agentId}
                        </span>
                        <span className="text-[11px] text-claw-muted ml-auto truncate">
                          {bot.agentId}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} loading={setAssignments.isPending}>
            保存分配
          </Button>
        </div>
      </div>
    </Modal>
  );
}
