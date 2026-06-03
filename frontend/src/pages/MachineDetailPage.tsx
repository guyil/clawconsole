import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMachine, useHealthCheck, useDiscover } from '../hooks/useMachines';
import { useAgentsByMachine } from '../hooks/useAgents';
import { AgentCard } from '../components/machines/AgentCard';
import { AgentFileEditor } from '../components/machines/AgentFileEditor';
import { EditMachineModal } from '../components/machines/EditMachineModal';
import { SyncPanel } from '../components/machines/SyncPanel';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageSpinner } from '../components/ui/Spinner';
import { Card } from '../components/ui/Card';
import { GlobalModelConfigPanel } from '../components/machines/GlobalModelConfigPanel';
import { ChevronLeft, HeartPulse, Search, Sparkles, Settings, Cpu } from 'lucide-react';

type Tab = 'agents' | 'skills' | 'model' | 'files' | 'sync';

export function MachineDetailPage() {
  const { machineId } = useParams<{ machineId: string }>();
  const navigate = useNavigate();
  const { data: machine, isLoading } = useMachine(machineId!);
  const { data: agentsData } = useAgentsByMachine(machineId!);
  const healthCheck = useHealthCheck();
  const autoHealthCheck = useHealthCheck({ silent: true });
  const discover = useDiscover();
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [showEdit, setShowEdit] = useState(false);

  // Background health-check job is disabled by default; run a fresh check
  // (silently) on mount so the page reflects the current machine state.
  // Each machineId is only auto-checked once per session to avoid
  // double-firing on re-renders.
  const autoCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!machineId) return;
    if (autoCheckedRef.current === machineId) return;
    autoCheckedRef.current = machineId;
    autoHealthCheck.mutate(machineId);
    // mutate identity is stable; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  if (isLoading || !machine) return <PageSpinner />;

  const agents = agentsData?.data ?? [];

  const discoveredSkills = machine.discoveredSkills ?? [];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'agents', label: 'Agents', count: agents.length },
    { id: 'skills', label: 'Skills', count: discoveredSkills.length },
    { id: 'model', label: 'Model 配置' },
    { id: 'files', label: '文件管理' },
    { id: 'sync', label: '同步管理' },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <Link
        to="/machines"
        className="inline-flex items-center gap-1 text-sm text-claw-muted hover:text-claw-text mb-4 transition-colors"
      >
        <ChevronLeft size={16} />
        返回节点列表
      </Link>

      {/* Machine Header */}
      <Card className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-claw-primary/25 to-claw-accent/25 flex items-center justify-center text-2xl">
              🦞
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-claw-text">{machine.name}</h2>
                <StatusDot status={machine.status} />
              </div>
              <div className="text-sm text-claw-muted mt-0.5">
                {machine.tailscaleHostname}
                {machine.tailscaleIp && ` · ${machine.tailscaleIp}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right mr-4">
              <div className="text-xs text-claw-muted">OpenClaw</div>
              <div className="text-sm font-medium text-claw-text">
                {machine.openclawVersion ?? '-'}
              </div>
            </div>
            {machine.tags?.map((tag) => (
              <Badge key={tag} variant="muted">{tag}</Badge>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings size={14} />}
              onClick={() => setShowEdit(true)}
            >
              编辑
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<HeartPulse size={14} />}
              onClick={() => healthCheck.mutate(machine.id)}
              loading={healthCheck.isPending}
            >
              健康检查
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Search size={14} />}
              onClick={() => discover.mutate(machine.id)}
              loading={discover.isPending}
            >
              扫描节点
            </Button>
          </div>
        </div>

        {/* Machine info row */}
        <div className="flex gap-6 mt-4 pt-4 border-t border-claw-border text-sm">
          <div>
            <span className="text-claw-muted">SSH: </span>
            <span className="text-claw-text">{machine.sshUser}@{machine.tailscaleHostname}:{machine.sshPort}</span>
          </div>
          <div>
            <span className="text-claw-muted">Home: </span>
            <span className="text-claw-text">{machine.openclawHome}</span>
          </div>
          <div>
            <span className="text-claw-muted">认证: </span>
            <span className="text-claw-text">{machine.sshPassword ? '密码' : 'SSH Key'}</span>
          </div>
          <div>
            <span className="text-claw-muted">OS: </span>
            <span className="text-claw-text">{machine.osInfo ?? '-'}</span>
          </div>
          {machine.lastHealthCheckAt && (
            <div>
              <span className="text-claw-muted">最后检查: </span>
              <span className="text-claw-text">
                {new Date(machine.lastHealthCheckAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 bg-claw-card rounded-lg p-1 w-fit mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'bg-claw-primary text-white'
                : 'text-claw-muted hover:text-claw-text'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && ` (${tab.count})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'agents' && (
        <div>
          {agents.length === 0 ? (
            <div className="text-claw-muted text-sm py-8 text-center">
              暂无 Agent，请点击"发现 Agents"按钮
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => navigate(`/bots/${agent.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'skills' && (
        <div>
          {discoveredSkills.length === 0 ? (
            <div className="text-claw-muted text-sm py-8 text-center">
              暂无 Skills，请点击"发现 Agents"按钮扫描节点
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {discoveredSkills.map((skillKey) => (
                <div
                  key={skillKey}
                  className="bg-claw-card rounded-xl border border-claw-border p-4 transition-all hover:bg-claw-card-hover"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-500/30 to-orange-500/30 flex items-center justify-center">
                      <Sparkles size={16} className="text-yellow-400" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-claw-text">{skillKey}</div>
                      <div className="text-xs text-claw-muted">全局 Skill</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'model' && <GlobalModelConfigPanel machineId={machineId!} />}

      {activeTab === 'files' && <AgentFileEditor machineId={machineId!} />}

      {activeTab === 'sync' && <SyncPanel machineId={machineId!} />}

      <EditMachineModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        machine={machine}
      />
    </div>
  );
}
