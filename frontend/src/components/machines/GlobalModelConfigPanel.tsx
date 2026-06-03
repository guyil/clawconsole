import { useState, useEffect, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import {
  useMachineModelConfig,
  useRemoteModelConfig,
  useUpdateMachineModelConfig,
  useSyncMachineModelConfig,
} from '../../hooks/useModelConfig';
import { Upload, Save, ChevronDown, Check, RefreshCw } from 'lucide-react';
import type { AgentModelValue } from '../../types/agent';

interface GlobalModelConfigPanelProps {
  machineId: string;
}

interface ModelOption {
  provider: string;
  providerLabel: string;
  modelId: string;
  displayName: string;
  fullId: string;
}

const COMMON_MODELS: ModelOption[] = [
  { provider: 'anthropic', providerLabel: 'Anthropic', modelId: 'claude-opus-4-6', displayName: 'Claude Opus 4', fullId: 'anthropic/claude-opus-4-6' },
  { provider: 'anthropic', providerLabel: 'Anthropic', modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4', fullId: 'anthropic/claude-sonnet-4-6' },
  { provider: 'anthropic', providerLabel: 'Anthropic', modelId: 'claude-haiku-3', displayName: 'Claude Haiku 3', fullId: 'anthropic/claude-haiku-3' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'gpt-5.2', displayName: 'GPT-5.2', fullId: 'openai/gpt-5.2' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'gpt-4.1', displayName: 'GPT-4.1', fullId: 'openai/gpt-4.1' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'gpt-4.1-mini', displayName: 'GPT-4.1 Mini', fullId: 'openai/gpt-4.1-mini' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'o3', displayName: 'o3', fullId: 'openai/o3' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'o4-mini', displayName: 'o4 Mini', fullId: 'openai/o4-mini' },
  { provider: 'google', providerLabel: 'Google', modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', fullId: 'google/gemini-2.5-pro' },
  { provider: 'google', providerLabel: 'Google', modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', fullId: 'google/gemini-2.5-flash' },
];

function getModelPrimary(value: AgentModelValue | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.primary ?? '';
}

const groupedModels = COMMON_MODELS.reduce<Record<string, ModelOption[]>>((acc, m) => {
  if (!acc[m.provider]) acc[m.provider] = [];
  acc[m.provider].push(m);
  return acc;
}, {});

const inputClass =
  'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none';

export function GlobalModelConfigPanel({ machineId }: GlobalModelConfigPanelProps) {
  const { data: localData, isLoading: localLoading } = useMachineModelConfig(machineId);
  const { data: remoteData, isLoading: remoteLoading, refetch: refetchRemote } = useRemoteModelConfig(machineId);
  const updateModel = useUpdateMachineModelConfig();
  const syncModel = useSyncMachineModelConfig();

  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const localConfig = localData?.modelConfig;

  useEffect(() => {
    const primary = getModelPrimary(localConfig?.model);
    if (!primary && remoteData?.globalDefault) {
      const remotePrimary = getModelPrimary(remoteData.globalDefault);
      applyModel(remotePrimary);
    } else if (primary) {
      applyModel(primary);
    }
  }, [localConfig, remoteData]);

  function applyModel(primary: string) {
    const knownModel = COMMON_MODELS.find((m) => m.fullId === primary);
    if (knownModel) {
      setSelectedModel(knownModel.fullId);
      setUseCustom(false);
      setCustomModel('');
    } else if (primary) {
      setSelectedModel('');
      setUseCustom(true);
      setCustomModel(primary);
    }
  }

  const effectiveModel = useCustom ? customModel : selectedModel;

  const isDirty = useMemo(() => {
    const currentPrimary = getModelPrimary(localConfig?.model);
    return currentPrimary !== effectiveModel && !!effectiveModel;
  }, [localConfig, effectiveModel]);

  const handleSave = () => {
    if (!effectiveModel) return;
    updateModel.mutate({ machineId, model: effectiveModel });
  };

  const handleSync = () => {
    syncModel.mutate(machineId);
  };

  const handleSelectModel = (fullId: string) => {
    setSelectedModel(fullId);
    setUseCustom(false);
    setCustomModel('');
    setDropdownOpen(false);
  };

  if (localLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-claw-muted text-sm">
        <Spinner size={16} />
        加载 Model 配置...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Remote status */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-claw-text">全局默认 Model</h4>
          <div className="flex items-center gap-2">
            {localConfig?.lastSyncedAt && (
              <Badge variant="muted">
                已同步: {new Date(localConfig.lastSyncedAt).toLocaleString()}
              </Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} className={remoteLoading ? 'animate-spin' : ''} />}
              onClick={() => refetchRemote()}
              loading={remoteLoading}
            >
              读取远程
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Local config */}
          <div className="bg-claw-bg rounded-lg border border-claw-border p-4">
            <div className="text-xs text-claw-muted mb-2 font-medium">本地配置</div>
            {localConfig ? (
              <code className="text-sm text-claw-primary-light font-mono">
                {getModelPrimary(localConfig.model) || '(empty)'}
              </code>
            ) : (
              <span className="text-sm text-claw-muted">未配置</span>
            )}
          </div>

          {/* Remote config */}
          <div className="bg-claw-bg rounded-lg border border-claw-border p-4">
            <div className="text-xs text-claw-muted mb-2 font-medium">远程配置</div>
            {remoteLoading ? (
              <Spinner size={14} />
            ) : remoteData?.globalDefault ? (
              <code className="text-sm text-claw-accent font-mono">
                {getModelPrimary(remoteData.globalDefault)}
              </code>
            ) : (
              <span className="text-sm text-claw-muted">未配置 (使用内置默认)</span>
            )}
          </div>
        </div>

        {/* Agent overrides from remote */}
        {remoteData && remoteData.agentOverrides.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-claw-muted mb-2 font-medium">Agent Model 覆盖 (远程)</div>
            <div className="space-y-1">
              {remoteData.agentOverrides.map((o) => (
                <div key={o.agentId} className="flex items-center gap-2 text-sm">
                  <span className="text-claw-text">{o.agentId}:</span>
                  <code className="text-claw-primary-light font-mono text-xs">{getModelPrimary(o.model)}</code>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Model selector */}
      <Card>
        <h4 className="text-sm font-semibold text-claw-text mb-4">设置全局默认 Model</h4>
        <p className="text-xs text-claw-muted mb-4">
          此 Model 将作为该节点上所有 Bot 的默认 Model。各 Bot 可以在自己的 Model 配置中覆盖此设置。
        </p>

        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => { setUseCustom(false); setDropdownOpen(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                !useCustom
                  ? 'bg-claw-primary text-white'
                  : 'bg-claw-input text-claw-muted border border-claw-border hover:text-claw-text'
              }`}
            >
              预设 Model
            </button>
            <button
              onClick={() => { setUseCustom(true); setDropdownOpen(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                useCustom
                  ? 'bg-claw-primary text-white'
                  : 'bg-claw-input text-claw-muted border border-claw-border hover:text-claw-text'
              }`}
            >
              自定义 Model
            </button>
          </div>

          {!useCustom ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className={`${inputClass} flex items-center justify-between cursor-pointer`}
              >
                <span className={selectedModel ? 'text-claw-text' : 'text-claw-muted'}>
                  {selectedModel
                    ? COMMON_MODELS.find((m) => m.fullId === selectedModel)?.displayName ?? selectedModel
                    : '选择一个 Model...'}
                </span>
                <ChevronDown size={14} className={`text-claw-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-claw-sidebar border border-claw-border rounded-lg shadow-lg max-h-64 overflow-auto">
                  {Object.entries(groupedModels).map(([provider, models]) => (
                    <div key={provider}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-claw-muted uppercase tracking-wide bg-claw-bg/50">
                        {models[0].providerLabel}
                      </div>
                      {models.map((m) => (
                        <button
                          key={m.fullId}
                          onClick={() => handleSelectModel(m.fullId)}
                          className="w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-claw-card cursor-pointer transition-colors"
                        >
                          <span className="text-claw-text">{m.displayName}</span>
                          <div className="flex items-center gap-2">
                            <code className="text-[10px] text-claw-muted font-mono">{m.fullId}</code>
                            {selectedModel === m.fullId && <Check size={14} className="text-claw-primary-light" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <input
                className={inputClass}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="provider/model-id (e.g. anthropic/claude-opus-4-6)"
              />
              <p className="text-[11px] text-claw-muted mt-1.5">
                格式: provider/model-id，例如 anthropic/claude-opus-4-6, openai/gpt-5.2
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          icon={<Save size={14} />}
          onClick={handleSave}
          disabled={!effectiveModel || !isDirty}
          loading={updateModel.isPending}
        >
          保存配置
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload size={14} />}
          onClick={handleSync}
          disabled={!localConfig?.model}
          loading={syncModel.isPending}
        >
          同步到远程节点
        </Button>
      </div>
    </div>
  );
}
