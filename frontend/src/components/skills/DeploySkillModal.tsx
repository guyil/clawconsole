import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useMachines } from '../../hooks/useMachines';
import { useAgentsByMachine } from '../../hooks/useAgents';
import { useDeploySkill } from '../../hooks/useSkills';

interface Props {
  open: boolean;
  onClose: () => void;
  skillId: string;
  skillName: string;
}

export function DeploySkillModal({ open, onClose, skillId, skillName }: Props) {
  const { data: machinesData } = useMachines();
  const deploy = useDeploySkill();
  const [selectedMachine, setSelectedMachine] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');

  const { data: agentsData } = useAgentsByMachine(selectedMachine);

  const machines = machinesData?.data ?? [];
  const agents = agentsData?.data ?? [];

  useEffect(() => {
    setSelectedAgent('');
  }, [selectedMachine]);

  useEffect(() => {
    if (!open) {
      setSelectedMachine('');
      setSelectedAgent('');
    }
  }, [open]);

  const scope = selectedAgent ? 'agent' : 'global';

  const deployTarget = selectedAgent
    ? `Bot 的 workspace/skills 目录`
    : `节点的全局 skills 目录`;

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title={`部署 ${skillName}`}>
      <div className="space-y-4">
        <p className="text-sm text-claw-muted">
          将此 Skill 部署到指定节点的 OpenClaw skills 目录。
        </p>
        <div>
          <label className="block text-xs text-claw-muted mb-1">目标节点</label>
          <select
            className={inputClass}
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
          >
            <option value="">选择节点...</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.tailscaleHostname})
              </option>
            ))}
          </select>
        </div>
        {selectedMachine && (
          <div>
            <label className="block text-xs text-claw-muted mb-1">
              目标 Bot <span className="text-claw-muted/60">（可选，不选则部署到节点全局）</span>
            </label>
            <select
              className={inputClass}
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option value="">全局 (skills/)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.agentId}
                  {a.isDefault ? ' (默认)' : ''}
                  {' — '}
                  {a.workspacePath ?? 'workspace'}/skills/
                </option>
              ))}
            </select>
          </div>
        )}
        {selectedMachine && (
          <div className="rounded-lg bg-claw-input/50 border border-claw-border px-3 py-2">
            <p className="text-xs text-claw-muted">
              部署目标：<span className="text-claw-text font-medium">{deployTarget}</span>
            </p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={() =>
              deploy.mutate(
                {
                  skillId,
                  machineId: selectedMachine,
                  scope,
                  agentId: selectedAgent || undefined,
                },
                { onSuccess: onClose },
              )
            }
            loading={deploy.isPending}
            disabled={!selectedMachine}
          >
            部署
          </Button>
        </div>
      </div>
    </Modal>
  );
}
