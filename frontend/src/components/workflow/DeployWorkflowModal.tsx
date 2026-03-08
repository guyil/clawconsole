import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useMachines } from '../../hooks/useMachines';
import { useAgentsByMachine } from '../../hooks/useAgents';
import { useDeployWorkflow } from '../../hooks/useWorkflows';

interface Props {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
}

export function DeployWorkflowModal({ open, onClose, workflowId, workflowName }: Props) {
  const { data: machinesData } = useMachines();
  const deploy = useDeployWorkflow();
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
    ? `Bot 的 workspace/workflows 目录`
    : `节点的全局 workflows 目录`;

  const inputClass =
    'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:outline-none focus:border-claw-primary';

  return (
    <Modal open={open} onClose={onClose} title={`部署工作流: ${workflowName}`}>
      <div className="space-y-4">
        <p className="text-sm text-claw-muted">
          将此工作流编译为 .lobster 文件并部署到远程节点。Agent 可通过 lobster run 命令调用此工作流。
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
              <option value="">全局 (workflows/)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.agentId}
                  {a.isDefault ? ' (默认)' : ''}
                  {' — '}
                  {a.workspacePath ?? 'workspace'}/workflows/
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
            <p className="text-xs text-claw-muted mt-1">
              文件格式：<span className="text-claw-text font-medium">.lobster (Lobster Pipeline)</span>
            </p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={() =>
              deploy.mutate(
                {
                  id: workflowId,
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
