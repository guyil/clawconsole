import { useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useWorkflow,
  useUpdateWorkflow,
  useValidateWorkflow,
  useWorkflowVersions,
} from '../hooks/useWorkflows';
import { workflowsApi } from '../api/workflows.api';
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas';
import { NodeConfigPanel } from '../components/workflow/NodeConfigPanel';
import { WorkflowToolbar } from '../components/workflow/WorkflowToolbar';
import { ValidationPanel } from '../components/workflow/ValidationPanel';
import { YamlPreviewModal } from '../components/workflow/YamlPreviewModal';
import { DeployWorkflowModal } from '../components/workflow/DeployWorkflowModal';
import { PageSpinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { ChevronLeft, Clock, FileText } from 'lucide-react';
import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  ValidationResult,
  WorkflowVersion,
} from '../types/workflow';

let nodeCounter = 0;

function generateNodeId(type: string): string {
  nodeCounter++;
  return `${type}_${Date.now().toString(36)}_${nodeCounter}`;
}

function createDefaultNode(type: 'skill' | 'review' | 'condition'): WorkflowNodeDef {
  const id = generateNodeId(type);
  switch (type) {
    case 'skill':
      return { id, type: 'skill', name: '新 Skill 节点', command: '' };
    case 'review':
      return { id, type: 'review', name: '新审核节点' };
    case 'condition':
      return {
        id,
        type: 'condition',
        name: '新条件节点',
        expression: '',
        branches: [{ condition: '', target: '' }],
      };
  }
}

export function WorkflowEditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { data: workflow, isLoading } = useWorkflow(workflowId!);
  const updateWorkflow = useUpdateWorkflow();
  const validateWorkflow = useValidateWorkflow();
  const { data: versionsData } = useWorkflowVersions(workflowId!);

  // Local editor state
  const [localNodes, setLocalNodes] = useState<WorkflowNodeDef[] | null>(null);
  const [localEdges, setLocalEdges] = useState<WorkflowEdgeDef[] | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [yamlContent, setYamlContent] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);

  const nodes = localNodes ?? workflow?.nodes ?? [];
  const edges = localEdges ?? workflow?.edges ?? [];
  const hasChanges = localNodes !== null || localEdges !== null;

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const validationErrors = useMemo(() => {
    if (!validation || validation.valid) return {};
    const map: Record<string, string> = {};
    for (const err of validation.errors) {
      if (err.nodeId) map[err.nodeId] = err.message;
    }
    return map;
  }, [validation]);

  const handleAddNode = useCallback(
    (type: 'skill' | 'review' | 'condition', afterNodeId?: string) => {
      const newNode = createDefaultNode(type);
      const current = localNodes ?? workflow?.nodes ?? [];
      const currentEdges = localEdges ?? workflow?.edges ?? [];

      if (afterNodeId) {
        const idx = current.findIndex((n) => n.id === afterNodeId);
        const newNodes = [...current];
        newNodes.splice(idx + 1, 0, newNode);
        setLocalNodes(newNodes);

        const outEdges = currentEdges.filter((e) => e.source === afterNodeId);
        const otherEdges = currentEdges.filter((e) => e.source !== afterNodeId);
        const updatedEdges = [
          ...otherEdges,
          { source: afterNodeId, target: newNode.id },
          ...outEdges.map((e) => ({ ...e, source: newNode.id })),
        ];
        setLocalEdges(updatedEdges);
      } else {
        const newNodes = [...current, newNode];
        setLocalNodes(newNodes);

        if (current.length > 0) {
          const lastNode = current[current.length - 1];
          setLocalEdges([...currentEdges, { source: lastNode.id, target: newNode.id }]);
        }
      }

      setSelectedNodeId(newNode.id);
    },
    [localNodes, localEdges, workflow],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const current = localNodes ?? workflow?.nodes ?? [];
      const currentEdges = localEdges ?? workflow?.edges ?? [];

      const inEdges = currentEdges.filter((e) => e.target === nodeId);
      const outEdges = currentEdges.filter((e) => e.source === nodeId);
      const otherEdges = currentEdges.filter((e) => e.source !== nodeId && e.target !== nodeId);

      const reconnected: WorkflowEdgeDef[] = [];
      for (const inE of inEdges) {
        for (const outE of outEdges) {
          reconnected.push({ source: inE.source, target: outE.target });
        }
      }

      setLocalNodes(current.filter((n) => n.id !== nodeId));
      setLocalEdges([...otherEdges, ...reconnected]);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [localNodes, localEdges, workflow, selectedNodeId],
  );

  const handleNodeUpdate = useCallback(
    (updated: WorkflowNodeDef) => {
      const current = localNodes ?? workflow?.nodes ?? [];
      setLocalNodes(current.map((n) => (n.id === updated.id ? updated : n)));
    },
    [localNodes, workflow],
  );

  async function handleSave() {
    if (!workflow) return;
    const data: Record<string, unknown> = { updatedBy: 'admin' };
    if (localNodes) data.nodes = localNodes;
    if (localEdges) data.edges = localEdges;
    updateWorkflow.mutate(
      { id: workflow.id, data },
      {
        onSuccess: () => {
          setLocalNodes(null);
          setLocalEdges(null);
        },
      },
    );
  }

  async function handleValidate() {
    if (!workflow) return;
    if (hasChanges) await handleSave();
    validateWorkflow.mutate(workflow.id, {
      onSuccess: (result) => setValidation(result),
    });
  }

  async function handleYaml() {
    if (!workflow) return;
    try {
      const yaml = await workflowsApi.getYaml(workflow.id);
      setYamlContent(yaml);
      setShowYaml(true);
    } catch {
      // Error handled by interceptor
    }
  }

  if (isLoading || !workflow) return <PageSpinner />;

  const versions = versionsData?.data ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] -m-7">
      {/* Back link */}
      <div className="px-5 py-2 border-b border-claw-border bg-claw-bg">
        <Link
          to="/workflows"
          className="inline-flex items-center gap-1 text-xs text-claw-muted hover:text-claw-text transition-colors"
        >
          <ChevronLeft size={14} />
          返回工作流列表
        </Link>
      </div>

      {/* Toolbar */}
      <WorkflowToolbar
        name={workflow.name}
        status={workflow.status}
        onSave={handleSave}
        onValidate={handleValidate}
        onDeploy={() => setShowDeploy(true)}
        onYaml={handleYaml}
        onVersions={() => setShowVersions(!showVersions)}
        saving={updateWorkflow.isPending}
        validating={validateWorkflow.isPending}
        validation={validation}
        hasChanges={hasChanges}
      />

      {/* Validation panel */}
      {validation && !validation.valid && (
        <div className="px-5 pt-3">
          <ValidationPanel result={validation} onClose={() => setValidation(null)} />
        </div>
      )}

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Versions sidebar */}
        {showVersions && (
          <div className="w-64 bg-claw-sidebar border-r border-claw-border overflow-auto shrink-0">
            <div className="px-4 py-3 border-b border-claw-border">
              <span className="text-xs font-semibold text-claw-text">版本历史</span>
            </div>
            {versions.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-claw-muted">暂无版本记录</div>
            ) : (
              versions.map((v: WorkflowVersion) => (
                <div key={v.id} className="px-4 py-3 border-b border-claw-border hover:bg-claw-card transition-colors">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="info">v{v.version}</Badge>
                    <span className="text-[10px] text-claw-muted">{v.createdBy}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-claw-muted">
                    <Clock size={10} />
                    {new Date(v.createdAt).toLocaleString()}
                  </div>
                  {v.changeLog && (
                    <div className="flex items-start gap-1 mt-1 text-[10px] text-claw-muted">
                      <FileText size={10} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{v.changeLog}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Canvas (center) */}
        <div className="flex-1 overflow-auto bg-claw-bg">
          <WorkflowCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onDeleteNode={handleDeleteNode}
            onAddNode={handleAddNode}
            validationErrors={validationErrors}
          />
        </div>

        {/* Config panel (right) */}
        {selectedNode && (
          <div className="w-80 shrink-0">
            <NodeConfigPanel
              node={selectedNode}
              onSave={handleNodeUpdate}
              onClose={() => setSelectedNodeId(null)}
            />
          </div>
        )}
      </div>

      {/* YAML Preview Modal */}
      {showYaml && yamlContent && (
        <YamlPreviewModal
          open={showYaml}
          onClose={() => setShowYaml(false)}
          yaml={yamlContent}
          workflowName={workflow.name}
        />
      )}

      {/* Deploy Modal */}
      <DeployWorkflowModal
        open={showDeploy}
        onClose={() => setShowDeploy(false)}
        workflowId={workflow.id}
        workflowName={workflow.name}
      />
    </div>
  );
}
