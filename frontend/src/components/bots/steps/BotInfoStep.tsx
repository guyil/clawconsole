import { useState, useEffect } from 'react';
import { useAgentsByMachine } from '../../../hooks/useAgents';
import { AlertCircle, CheckCircle } from 'lucide-react';

export interface BotInfoData {
  agentId: string;
  name: string;
  description: string;
  isDefault: boolean;
}

interface BotInfoStepProps {
  machineId: string;
  data: BotInfoData;
  onChange: (data: BotInfoData) => void;
  onValidChange: (valid: boolean) => void;
}

const AGENT_ID_REGEX = /^[a-z][a-z0-9_-]{1,49}$/;

export function BotInfoStep({ machineId, data, onChange, onValidChange }: BotInfoStepProps) {
  const { data: existingAgents } = useAgentsByMachine(machineId);
  const [touched, setTouched] = useState(false);

  const existingIds = (existingAgents?.data ?? []).map((a) => a.agentId);
  const isDuplicate = existingIds.includes(data.agentId);
  const isFormatValid = AGENT_ID_REGEX.test(data.agentId);
  const isIdValid = data.agentId.length > 0 && isFormatValid && !isDuplicate;
  const hasDefault = (existingAgents?.data ?? []).some((a) => a.isDefault);

  const workspacePath = data.agentId
    ? data.isDefault
      ? 'workspace'
      : `workspace-${data.agentId}`
    : '';

  useEffect(() => {
    onValidChange(isIdValid);
  }, [isIdValid, onValidChange]);

  const update = (partial: Partial<BotInfoData>) => {
    onChange({ ...data, ...partial });
  };

  return (
    <div className="space-y-5">
      {/* Bot ID */}
      <div>
        <label className="block text-sm font-medium text-claw-text mb-1.5">
          Bot ID <span className="text-claw-danger">*</span>
        </label>
        <input
          type="text"
          value={data.agentId}
          onChange={(e) => {
            update({ agentId: e.target.value.toLowerCase() });
            if (!touched) setTouched(true);
          }}
          onBlur={() => setTouched(true)}
          placeholder="例如: customer_support"
          className={`w-full px-3 py-2 text-sm bg-claw-bg border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none transition-colors ${
            touched && !isIdValid
              ? 'border-claw-danger focus:border-claw-danger'
              : 'border-claw-border focus:border-claw-primary'
          }`}
        />
        <div className="mt-1.5 min-h-[20px]">
          {touched && data.agentId.length > 0 && (
            <>
              {!isFormatValid && (
                <p className="text-xs text-claw-danger flex items-center gap-1">
                  <AlertCircle size={12} />
                  需以小写字母开头，仅含小写字母、数字、连字符、下划线（2-50 字符）
                </p>
              )}
              {isFormatValid && isDuplicate && (
                <p className="text-xs text-claw-danger flex items-center gap-1">
                  <AlertCircle size={12} />
                  该节点已存在同名 Bot
                </p>
              )}
              {isIdValid && (
                <p className="text-xs text-claw-success flex items-center gap-1">
                  <CheckCircle size={12} />
                  ID 可用
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-claw-text mb-1.5">名称</label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => update({ name: e.target.value.slice(0, 100) })}
          placeholder="例如: 客服助手"
          className="w-full px-3 py-2 text-sm bg-claw-bg border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary"
        />
        <p className="text-[11px] text-claw-muted mt-1">{data.name.length}/100</p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-claw-text mb-1.5">描述</label>
        <textarea
          value={data.description}
          onChange={(e) => update({ description: e.target.value.slice(0, 500) })}
          placeholder="Bot 的用途描述..."
          rows={3}
          className="w-full px-3 py-2 text-sm bg-claw-bg border border-claw-border rounded-lg text-claw-text placeholder:text-claw-muted focus:outline-none focus:border-claw-primary resize-none"
        />
        <p className="text-[11px] text-claw-muted mt-1">{data.description.length}/500</p>
      </div>

      {/* Is Default */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-claw-text">设为默认 Bot</div>
          <div className="text-[11px] text-claw-muted">
            {hasDefault && !data.isDefault
              ? '该节点已有默认 Bot，开启后将替换原有设置'
              : '设为该节点的默认 Agent'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={data.isDefault}
          onClick={() => update({ isDefault: !data.isDefault })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
            data.isDefault ? 'bg-claw-primary' : 'bg-claw-border'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              data.isDefault ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Workspace path (readonly) */}
      {workspacePath && (
        <div>
          <label className="block text-sm font-medium text-claw-text mb-1.5">Workspace 路径</label>
          <div className="px-3 py-2 text-sm bg-claw-bg/50 border border-claw-border rounded-lg text-claw-muted font-mono">
            {workspacePath}
          </div>
        </div>
      )}
    </div>
  );
}
