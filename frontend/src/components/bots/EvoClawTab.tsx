import { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import {
  useEvoRuns,
  useEvoRules,
  useEvoCases,
  useTriggerEvolution,
  useDeleteEvoRule,
  useDeleteEvoCase,
} from '../../hooks/useEvoClaw';
import { Zap, Shield, BookOpen, Clock, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { EvoRun, EvoRule, EvoCase } from '../../api/evo-claw.api';

interface EvoClawTabProps {
  agentId: string;
  machineId: string;
}

function RunStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    completed: 'success',
    failed: 'error',
    pending: 'default',
    collecting: 'warning',
    classifying: 'warning',
    distilling: 'warning',
    applying: 'warning',
  };
  return <Badge variant={variants[status] ?? 'default'}>{status}</Badge>;
}

function RuleTypeIcon({ type }: { type: string }) {
  if (type === 'constraint') return <Shield className="w-4 h-4 text-red-500" />;
  if (type === 'procedure') return <BookOpen className="w-4 h-4 text-blue-500" />;
  return <Zap className="w-4 h-4 text-amber-500" />;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EvoClawTab({ agentId, machineId }: EvoClawTabProps) {
  const [activeSection, setActiveSection] = useState<'runs' | 'rules' | 'cases'>('rules');

  const { data: runs, isLoading: runsLoading } = useEvoRuns(agentId, machineId);
  const { data: rules, isLoading: rulesLoading } = useEvoRules(agentId, machineId);
  const { data: cases, isLoading: casesLoading } = useEvoCases(agentId, machineId);
  const triggerMutation = useTriggerEvolution();
  const deleteRuleMutation = useDeleteEvoRule();
  const deleteCaseMutation = useDeleteEvoCase();

  const activeRuleCount = rules?.length ?? 0;
  const activeCaseCount = cases?.length ?? 0;
  const lastRun = runs?.[0];

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-500">活跃规则</div>
          <div className="text-2xl font-semibold mt-1">{activeRuleCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">案例库</div>
          <div className="text-2xl font-semibold mt-1">{activeCaseCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">上次进化</div>
          <div className="text-sm font-medium mt-1">{formatDate(lastRun?.completedAt ?? null)}</div>
        </Card>
        <Card className="p-4 flex items-center justify-center">
          <Button
            onClick={() => triggerMutation.mutate({ agentId, machineId })}
            disabled={triggerMutation.isPending}
          >
            {triggerMutation.isPending ? (
              <><Spinner className="w-4 h-4 mr-2" /> 进化中...</>
            ) : (
              <><Zap className="w-4 h-4 mr-2" /> 立即进化</>
            )}
          </Button>
        </Card>
      </div>

      {/* Section Tabs */}
      <div className="flex border-b">
        {(['rules', 'cases', 'runs'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSection === section
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {section === 'rules' && `规则 (${activeRuleCount})`}
            {section === 'cases' && `案例 (${activeCaseCount})`}
            {section === 'runs' && `运行历史 (${runs?.length ?? 0})`}
          </button>
        ))}
      </div>

      {/* Rules Section */}
      {activeSection === 'rules' && (
        <RulesSection
          rules={rules ?? []}
          isLoading={rulesLoading}
          onDelete={(ruleId) => deleteRuleMutation.mutate({ agentId, ruleId })}
        />
      )}

      {/* Cases Section */}
      {activeSection === 'cases' && (
        <CasesSection
          cases={cases ?? []}
          isLoading={casesLoading}
          onDelete={(caseId) => deleteCaseMutation.mutate({ agentId, caseId })}
        />
      )}

      {/* Runs Section */}
      {activeSection === 'runs' && (
        <RunsSection runs={runs ?? []} isLoading={runsLoading} />
      )}
    </div>
  );
}

function RulesSection({
  rules,
  isLoading,
  onDelete,
}: {
  rules: EvoRule[];
  isLoading: boolean;
  onDelete: (ruleId: number) => void;
}) {
  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (rules.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-500">
        暂无活跃规则。触发进化后，系统会从对话反馈中提炼行为规则。
      </Card>
    );
  }

  const grouped = new Map<string, EvoRule[]>();
  for (const rule of rules) {
    const key = rule.targetFile;
    const list = grouped.get(key) ?? [];
    list.push(rule);
    grouped.set(key, list);
  }

  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([file, fileRules]) => (
        <Card key={file} className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="default">{file}</Badge>
            <span className="text-sm text-gray-500">{fileRules.length} 条规则</span>
          </div>
          <div className="space-y-2">
            {fileRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg group"
              >
                <RuleTypeIcon type={rule.ruleType} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{rule.content}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>置信度: {(rule.confidenceScore * 100).toFixed(0)}%</span>
                    <span>触发: {rule.triggerCount}次</span>
                    <span className="text-green-500">+{rule.positiveFeedbackCount}</span>
                    <span className="text-red-500">-{rule.negativeFeedbackCount}</span>
                  </div>
                </div>
                <button
                  onClick={() => onDelete(rule.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                  title="废弃此规则"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function CasesSection({
  cases,
  isLoading,
  onDelete,
}: {
  cases: EvoCase[];
  isLoading: boolean;
  onDelete: (caseId: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (cases.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-500">
        暂无案例。当用户在对话中提供具体纠正方向时，系统会自动生成案例。
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {cases.map((c) => (
        <Card key={c.id} className="p-4">
          <div className="flex items-start gap-3">
            <BookOpen className="w-4 h-4 mt-1 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
              >
                {expandedId === c.id ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-sm font-medium">{c.scenario}</span>
                <span className="text-xs text-gray-400 ml-auto">
                  相关次数: {c.relevanceCount}
                </span>
              </div>
              {expandedId === c.id && (
                <div className="mt-3 space-y-2 text-sm pl-6">
                  <div>
                    <span className="text-gray-500 font-medium">正确做法: </span>
                    {c.correctApproach}
                  </div>
                  <div>
                    <span className="text-gray-500 font-medium">应避免: </span>
                    {c.botWrongAnswerSummary}
                  </div>
                  <div>
                    <span className="text-gray-500 font-medium">用户纠正: </span>
                    {c.userCorrection}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => onDelete(c.id)}
              className="p-1 text-gray-400 hover:text-red-500"
              title="移除此案例"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function RunsSection({
  runs,
  isLoading,
}: {
  runs: EvoRun[];
  isLoading: boolean;
}) {
  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (runs.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-500">
        暂无进化运行记录。
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <Card key={run.id} className="p-4">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <RunStatusBadge status={run.status} />
                <Badge variant="default">{run.triggerType}</Badge>
                <span className="text-sm text-gray-500">
                  {formatDate(run.createdAt)}
                </span>
              </div>
              {run.summary && (
                <div className="text-sm text-gray-600 mt-1">{run.summary}</div>
              )}
              {run.errorMessage && (
                <div className="text-sm text-red-500 mt-1">{run.errorMessage}</div>
              )}
            </div>
            <div className="text-right text-xs text-gray-400 space-y-1">
              <div>会话: {run.sessionsAnalyzed}</div>
              <div>信号: {run.signalsFound}</div>
              <div>规则: +{run.rulesGenerated} / 案例: +{run.casesGenerated}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
