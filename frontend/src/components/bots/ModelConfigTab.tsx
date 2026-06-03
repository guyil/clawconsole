import { useState, useEffect, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import {
  useAgentModelConfig,
  useUpdateAgentModelConfig,
  useSyncAgentModelConfig,
  useDeleteAgentModelConfig,
  useRemoteModelConfig,
} from '../../hooks/useModelConfig';
import { Upload, Save, Trash2, ChevronDown, Check, Info } from 'lucide-react';
import type { AgentModelValue } from '../../types/agent';

interface ModelConfigTabProps {
  agentId: string;
  machineId: string;
}

interface ModelOption {
  provider: string;
  providerLabel: string;
  modelId: string;
  displayName: string;
  /** Bare model ID without routing prefix, e.g. "openai/gpt-5.2" */
  bareId: string;
}

const COMMON_MODELS: ModelOption[] = [
  { provider: 'anthropic', providerLabel: 'Anthropic', modelId: 'claude-opus-4-6', displayName: 'Claude Opus 4', bareId: 'anthropic/claude-opus-4-6' },
  { provider: 'anthropic', providerLabel: 'Anthropic', modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4', bareId: 'anthropic/claude-sonnet-4-6' },
  { provider: 'anthropic', providerLabel: 'Anthropic', modelId: 'claude-haiku-3', displayName: 'Claude Haiku 3', bareId: 'anthropic/claude-haiku-3' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'gpt-5.2', displayName: 'GPT-5.2', bareId: 'openai/gpt-5.2' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'gpt-4.1', displayName: 'GPT-4.1', bareId: 'openai/gpt-4.1' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'gpt-4.1-mini', displayName: 'GPT-4.1 Mini', bareId: 'openai/gpt-4.1-mini' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'o3', displayName: 'o3', bareId: 'openai/o3' },
  { provider: 'openai', providerLabel: 'OpenAI', modelId: 'o4-mini', displayName: 'o4 Mini', bareId: 'openai/o4-mini' },
  { provider: 'google', providerLabel: 'Google', modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', bareId: 'google/gemini-2.5-pro' },
  { provider: 'google', providerLabel: 'Google', modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', bareId: 'google/gemini-2.5-flash' },
];

function getModelPrimary(value: AgentModelValue | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.primary ?? '';
}

function getFallbacks(value: AgentModelValue | null | undefined): string[] {
  if (!value || typeof value === 'string') return [];
  return value.fallbacks ?? [];
}

/**
 * Detect a routing prefix from a model string.
 * E.g. "openrouter/openai/gpt-5.4" → "openrouter"
 * "openai/gpt-5.2" → null (no routing prefix, just provider/model)
 */
function detectRoutingPrefix(modelStr: string): string | null {
  const parts = modelStr.split('/');
  // pattern: routing/provider/model → 3+ segments means there's a routing prefix
  if (parts.length >= 3) {
    return parts[0];
  }
  return null;
}

/** Strip routing prefix from a full model ID to get the bare ID */
function stripPrefix(fullId: string, prefix: string): string {
  const p = prefix + '/';
  return fullId.startsWith(p) ? fullId.slice(p.length) : fullId;
}

/** Add routing prefix to a bare model ID */
function addPrefix(bareId: string, prefix: string | null): string {
  if (!prefix) return bareId;
  return `${prefix}/${bareId}`;
}

const groupedModels = COMMON_MODELS.reduce<Record<string, ModelOption[]>>((acc, m) => {
  if (!acc[m.provider]) acc[m.provider] = [];
  acc[m.provider].push(m);
  return acc;
}, {});

const inputClass =
  'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text focus:border-claw-primary focus:outline-none';

const ROUTING_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
};

export function ModelConfigTab({ agentId, machineId }: ModelConfigTabProps) {
  const { data, isLoading } = useAgentModelConfig(agentId);
  const { data: remoteConfig } = useRemoteModelConfig(machineId);
  const updateModel = useUpdateAgentModelConfig();
  const syncModel = useSyncAgentModelConfig();
  const deleteModel = useDeleteAgentModelConfig();

  const [selectedBareId, setSelectedBareId] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [showFallbacks, setShowFallbacks] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const currentModel = data?.modelConfig;

  // Detect routing prefix from remote global default model
  const routingPrefix = useMemo(() => {
    if (!remoteConfig?.globalDefault) return null;
    const globalStr = typeof remoteConfig.globalDefault === 'string'
      ? remoteConfig.globalDefault
      : remoteConfig.globalDefault.primary;
    return detectRoutingPrefix(globalStr);
  }, [remoteConfig]);

  useEffect(() => {
    if (currentModel) {
      const primary = getModelPrimary(currentModel.model);
      // Strip routing prefix for matching against preset list
      const barePrimary = routingPrefix ? stripPrefix(primary, routingPrefix) : primary;
      const knownModel = COMMON_MODELS.find((m) => m.bareId === barePrimary);
      if (knownModel) {
        setSelectedBareId(knownModel.bareId);
        setUseCustom(false);
        setCustomModel('');
      } else {
        setSelectedBareId('');
        setUseCustom(true);
        setCustomModel(primary);
      }
      const fb = getFallbacks(currentModel.model);
      setFallbacks(fb);
      setShowFallbacks(fb.length > 0);
    }
  }, [currentModel, routingPrefix]);

  // The bare model ID selected by the user (without routing prefix)
  const effectiveBareModel = useCustom ? customModel : selectedBareId;

  // The full model ID with routing prefix applied
  const effectiveFullModel = useMemo(() => {
    if (!effectiveBareModel) return '';
    if (useCustom) return effectiveBareModel; // custom input is already fully qualified
    return addPrefix(effectiveBareModel, routingPrefix);
  }, [effectiveBareModel, useCustom, routingPrefix]);

  const isDirty = useMemo(() => {
    if (!currentModel && effectiveFullModel) return true;
    if (!currentModel && !effectiveFullModel) return false;
    const currentPrimary = getModelPrimary(currentModel?.model);
    if (currentPrimary !== effectiveFullModel) return true;
    const currentFb = getFallbacks(currentModel?.model);
    if (JSON.stringify(currentFb) !== JSON.stringify(fallbacks.filter(Boolean))) return true;
    return false;
  }, [currentModel, effectiveFullModel, fallbacks]);

  const handleSaveAndSync = () => {
    if (!effectiveFullModel) return;
    const cleanFallbacks = fallbacks.filter(Boolean);
    const model: AgentModelValue =
      cleanFallbacks.length > 0
        ? { primary: effectiveFullModel, fallbacks: cleanFallbacks }
        : effectiveFullModel;
    // Save locally, then auto-sync to remote
    updateModel.mutate(
      { agentId, model },
      {
        onSuccess: () => {
          syncModel.mutate(agentId);
        },
      },
    );
  };

  const handleSaveOnly = () => {
    if (!effectiveFullModel) return;
    const cleanFallbacks = fallbacks.filter(Boolean);
    const model: AgentModelValue =
      cleanFallbacks.length > 0
        ? { primary: effectiveFullModel, fallbacks: cleanFallbacks }
        : effectiveFullModel;
    updateModel.mutate({ agentId, model });
  };

  const handleSync = () => {
    syncModel.mutate(agentId);
  };

  const handleDelete = () => {
    deleteModel.mutate(agentId);
    setSelectedBareId('');
    setCustomModel('');
    setFallbacks([]);
    setShowFallbacks(false);
  };

  const handleSelectModel = (bareId: string) => {
    setSelectedBareId(bareId);
    setUseCustom(false);
    setCustomModel('');
    setDropdownOpen(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-claw-muted text-sm">
        <Spinner size={16} />
        加载 Model 配置...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Provider info banner */}
      {routingPrefix && (
        <div className="flex items-center gap-2 bg-claw-input/50 border border-claw-border rounded-lg px-4 py-2.5">
          <Info size={14} className="text-claw-primary-light shrink-0" />
          <span className="text-xs text-claw-muted">
            此节点通过 <span className="text-claw-text font-medium">{ROUTING_LABELS[routingPrefix] ?? routingPrefix}</span> 路由。
            选择预设 Model 时会自动添加 <code className="text-claw-primary-light bg-claw-input px-1 rounded">{routingPrefix}/</code> 前缀。
          </span>
        </div>
      )}

      {/* Current config status */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-claw-text">当前 Model 配置</h4>
          {currentModel?.lastSyncedAt && (
            <Badge variant="muted">
              已同步: {new Date(currentModel.lastSyncedAt).toLocaleString()}
            </Badge>
          )}
        </div>

        {currentModel ? (
          <div className="bg-claw-bg rounded-lg border border-claw-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-claw-muted">Primary Model:</span>
              <code className="text-sm text-claw-primary-light font-mono bg-claw-input px-2 py-0.5 rounded">
                {getModelPrimary(currentModel.model)}
              </code>
            </div>
            {getFallbacks(currentModel.model).length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-claw-muted">Fallbacks:</span>
                {getFallbacks(currentModel.model).map((fb, i) => (
                  <code key={i} className="text-xs text-claw-muted font-mono bg-claw-input px-2 py-0.5 rounded">
                    {fb}
                  </code>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-claw-muted">
            尚未配置 Model，将使用 OpenClaw 全局默认 Model
            {remoteConfig?.globalDefault && (
              <span className="ml-1">
                (<code className="text-claw-primary-light font-mono text-xs">
                  {typeof remoteConfig.globalDefault === 'string'
                    ? remoteConfig.globalDefault
                    : remoteConfig.globalDefault.primary}
                </code>)
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Model selector */}
      <Card>
        <h4 className="text-sm font-semibold text-claw-text mb-4">选择 Model</h4>

        <div className="space-y-4">
          {/* Mode toggle */}
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

          {/* Model selection */}
          {!useCustom ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className={`${inputClass} flex items-center justify-between cursor-pointer`}
              >
                <span className={selectedBareId ? 'text-claw-text' : 'text-claw-muted'}>
                  {selectedBareId
                    ? COMMON_MODELS.find((m) => m.bareId === selectedBareId)?.displayName ?? selectedBareId
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
                          key={m.bareId}
                          onClick={() => handleSelectModel(m.bareId)}
                          className="w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-claw-card cursor-pointer transition-colors"
                        >
                          <span className="text-claw-text">{m.displayName}</span>
                          <div className="flex items-center gap-2">
                            <code className="text-[10px] text-claw-muted font-mono">
                              {addPrefix(m.bareId, routingPrefix)}
                            </code>
                            {selectedBareId === m.bareId && <Check size={14} className="text-claw-primary-light" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Show effective model ID with prefix */}
              {selectedBareId && routingPrefix && (
                <p className="text-[11px] text-claw-muted mt-1.5">
                  实际 Model ID: <code className="text-claw-primary-light font-mono">{effectiveFullModel}</code>
                </p>
              )}
            </div>
          ) : (
            <div>
              <input
                className={inputClass}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder={routingPrefix
                  ? `${routingPrefix}/provider/model-id (e.g. ${routingPrefix}/openai/gpt-5.2)`
                  : 'provider/model-id (e.g. anthropic/claude-opus-4-6)'}
              />
              <p className="text-[11px] text-claw-muted mt-1.5">
                {routingPrefix
                  ? `此节点使用 ${ROUTING_LABELS[routingPrefix] ?? routingPrefix} 路由，请确保 Model ID 包含 "${routingPrefix}/" 前缀`
                  : '格式: provider/model-id，例如 anthropic/claude-opus-4-6, openai/gpt-5.2'}
              </p>
            </div>
          )}

          {/* Fallback models */}
          <div>
            <button
              onClick={() => setShowFallbacks(!showFallbacks)}
              className="text-xs text-claw-primary-light hover:text-claw-text cursor-pointer transition-colors"
            >
              {showFallbacks ? '隐藏 Fallback 配置' : '配置 Fallback Model (可选)'}
            </button>

            {showFallbacks && (
              <div className="mt-3 space-y-2">
                {fallbacks.map((fb, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      className={`${inputClass} flex-1 font-mono text-xs`}
                      value={fb}
                      onChange={(e) => {
                        const updated = [...fallbacks];
                        updated[i] = e.target.value;
                        setFallbacks(updated);
                      }}
                      placeholder={routingPrefix ? `${routingPrefix}/provider/model-id` : 'provider/model-id'}
                    />
                    <button
                      onClick={() => setFallbacks(fallbacks.filter((_, j) => j !== i))}
                      className="text-claw-muted hover:text-claw-danger cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setFallbacks([...fallbacks, ''])}
                  className="text-xs text-claw-primary-light hover:text-claw-text cursor-pointer"
                >
                  + 添加 Fallback
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            size="sm"
            icon={<Upload size={14} />}
            onClick={handleSaveAndSync}
            disabled={!effectiveFullModel || !isDirty}
            loading={updateModel.isPending || syncModel.isPending}
          >
            保存并同步
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Save size={14} />}
            onClick={handleSaveOnly}
            disabled={!effectiveFullModel || !isDirty}
            loading={updateModel.isPending}
          >
            仅保存本地
          </Button>
          {currentModel && !currentModel.lastSyncedAt && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload size={14} />}
              onClick={handleSync}
              disabled={!currentModel?.model}
              loading={syncModel.isPending}
            >
              同步到远程节点
            </Button>
          )}
        </div>
        {currentModel && (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={handleDelete}
            loading={deleteModel.isPending}
          >
            清除配置
          </Button>
        )}
      </div>
    </div>
  );
}
