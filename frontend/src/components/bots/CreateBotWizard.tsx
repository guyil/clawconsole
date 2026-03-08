import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { NodeSelectionStep } from './steps/NodeSelectionStep';
import { BotInfoStep, type BotInfoData } from './steps/BotInfoStep';
import { ChannelConfigStep, type ChannelBinding } from './steps/ChannelConfigStep';
import { ConfirmStep } from './steps/ConfirmStep';
import { useCreateAgent, useProvisionAgent } from '../../hooks/useAgents';
import { ChevronLeft, ChevronRight, Rocket } from 'lucide-react';
import type { Machine } from '../../types/machine';

interface CreateBotWizardProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = ['选择节点', 'Bot 信息', '渠道配置', '确认创建'] as const;

const defaultBotInfo: BotInfoData = {
  agentId: '',
  name: '',
  description: '',
  isDefault: false,
};

export function CreateBotWizard({ open, onClose }: CreateBotWizardProps) {
  const navigate = useNavigate();
  const createAgent = useCreateAgent();
  const provisionAgent = useProvisionAgent();

  const [step, setStep] = useState(0);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [botInfo, setBotInfo] = useState<BotInfoData>(defaultBotInfo);
  const [botInfoValid, setBotInfoValid] = useState(false);
  const [channels, setChannels] = useState<ChannelBinding[]>([]);

  const reset = () => {
    setStep(0);
    setSelectedMachine(null);
    setBotInfo(defaultBotInfo);
    setBotInfoValid(false);
    setChannels([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSelectMachine = (machine: Machine) => {
    setSelectedMachine(machine);
  };

  const handleBotInfoValidChange = useCallback((valid: boolean) => {
    setBotInfoValid(valid);
  }, []);

  const canNext = () => {
    if (step === 0) return selectedMachine !== null;
    if (step === 1) return botInfoValid;
    if (step === 2) {
      const tokenChannels = channels.filter(
        (c) => ['telegram', 'discord', 'slack', 'feishu'].includes(c.channelType),
      );
      const feishuValid = channels
        .filter((c) => c.channelType === 'feishu')
        .every((c) => c.token.length > 0 && (c.signingSecret?.length ?? 0) > 0);
      return tokenChannels.every((c) => c.token.length > 0) && feishuValid;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!selectedMachine) return;

    try {
      // Step 1: Create DB record
      const result = await createAgent.mutateAsync({
        machineId: selectedMachine.id,
        data: {
          agentId: botInfo.agentId,
          name: botInfo.name || undefined,
          description: botInfo.description || undefined,
          isDefault: botInfo.isDefault,
        },
      });

      // Step 2: Provision (create on remote, configure channels, deploy)
      await provisionAgent.mutateAsync({
        agentId: result.id,
        channels: channels.map((ch) => ({
          channelType: ch.channelType,
          accountId: ch.accountId,
          token: ch.token || undefined,
          signingSecret: ch.signingSecret,
          encryptKey: ch.encryptKey,
        })),
      });

      handleClose();
      navigate(`/bots/${result.id}`);
    } catch {
      // Error toast handled by mutation hooks
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="新建 Bot" width="max-w-2xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i === step
                  ? 'bg-claw-primary text-white'
                  : i < step
                    ? 'bg-claw-success/20 text-claw-success'
                    : 'bg-claw-border text-claw-muted'
              }`}
            >
              {i < step ? '\u2713' : i + 1}
            </div>
            <span
              className={`text-xs whitespace-nowrap ${
                i === step ? 'text-claw-text font-medium' : 'text-claw-muted'
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px ${i < step ? 'bg-claw-success/30' : 'bg-claw-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[300px]">
        {step === 0 && (
          <NodeSelectionStep
            selectedMachineId={selectedMachine?.id ?? null}
            onSelect={handleSelectMachine}
          />
        )}
        {step === 1 && selectedMachine && (
          <BotInfoStep
            machineId={selectedMachine.id}
            data={botInfo}
            onChange={setBotInfo}
            onValidChange={handleBotInfoValidChange}
          />
        )}
        {step === 2 && (
          <ChannelConfigStep
            channels={channels}
            onChange={setChannels}
            defaultAccountId={botInfo.agentId}
          />
        )}
        {step === 3 && selectedMachine && (
          <ConfirmStep machine={selectedMachine} botInfo={botInfo} channels={channels} />
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-claw-border">
        <div>
          {step > 0 && (
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} onClick={() => setStep(step - 1)}>
              上一步
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            取消
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              size="sm"
              disabled={!canNext()}
              onClick={() => setStep(step + 1)}
            >
              {step === 2 && channels.length === 0 ? '跳过' : '下一步'}
              <ChevronRight size={14} />
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<Rocket size={14} />}
              loading={createAgent.isPending || provisionAgent.isPending}
              onClick={handleCreate}
            >
              创建并部署
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
