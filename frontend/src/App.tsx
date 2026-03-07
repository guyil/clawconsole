import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { MachinesPage } from './pages/MachinesPage';
import { MachineDetailPage } from './pages/MachineDetailPage';
import { BotsPage } from './pages/BotsPage';
import { BotDetailPage } from './pages/BotDetailPage';
import { SkillsPage } from './pages/SkillsPage';
import { SkillDetailPage } from './pages/SkillDetailPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { AssistantPage } from './pages/AssistantPage';
import { SettingsPage } from './pages/SettingsPage';
import { MonitoringDashboardPage } from './pages/MonitoringDashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { LogsPage } from './pages/LogsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage';
import { WorkflowRunsPage } from './pages/WorkflowRunsPage';
import { WorkflowRunDetailPage } from './pages/WorkflowRunDetailPage';
import { ReviewInboxPage } from './pages/ReviewInboxPage';
import { useWebSocketStore } from './stores/websocket.store';
import { useWebSocketQuerySync } from './hooks/useWebSocketQuerySync';

export default function App() {
  const connect = useWebSocketStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  useWebSocketQuerySync();

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="machines" element={<MachinesPage />} />
        <Route path="machines/:machineId" element={<MachineDetailPage />} />
        <Route path="bots" element={<BotsPage />} />
        <Route path="bots/:agentId" element={<BotDetailPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="skills/:skillId" element={<SkillDetailPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="credentials" element={<CredentialsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="monitoring" element={<MonitoringDashboardPage />} />
        <Route path="monitoring/sessions" element={<SessionsPage />} />
        <Route path="monitoring/logs" element={<LogsPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="workflows/:workflowId" element={<WorkflowEditorPage />} />
        <Route path="workflows/runs" element={<WorkflowRunsPage />} />
        <Route path="workflows/runs/:runId" element={<WorkflowRunDetailPage />} />
        <Route path="reviews" element={<ReviewInboxPage />} />
      </Route>
    </Routes>
  );
}
