import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { MachinesPage } from './pages/MachinesPage';
import { MachineDetailPage } from './pages/MachineDetailPage';
import { BotsPage } from './pages/BotsPage';
import { BotDetailPage } from './pages/BotDetailPage';
import { ChatPage } from './pages/ChatPage';
import { SkillsPage } from './pages/SkillsPage';
import { SkillDetailPage } from './pages/SkillDetailPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { AssistantPage } from './pages/AssistantPage';
import { SettingsPage } from './pages/SettingsPage';
import { MonitoringDashboardPage } from './pages/MonitoringDashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { LogsPage } from './pages/LogsPage';
import { SummariesPage } from './pages/SummariesPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage';
import { UsersPage } from './pages/UsersPage';
import { LoginPage } from './pages/LoginPage';
import { useWebSocketStore } from './stores/websocket.store';
import { useWebSocketQuerySync } from './hooks/useWebSocketQuerySync';
import { getToken, verifyMe } from './api/auth.api';
import { useAuthStore, useIsAdmin } from './stores/auth.store';
import { PageSpinner } from './components/ui/Spinner';

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

export default function App() {
  // Auth gate runs BEFORE any route mounts so data hooks never fire
  // without a token. We ping /api/auth/me once on boot to confirm the
  // cached token is still alive — covers the "token expired while the
  // tab sat idle overnight" case.
  const [authState, setAuthState] = useState<AuthState>(() =>
    getToken() ? 'checking' : 'unauthenticated',
  );
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (authState !== 'checking') return;
    let cancelled = false;
    verifyMe().then((user) => {
      if (cancelled) return;
      setUser(user);
      setAuthState(user ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      cancelled = true;
    };
  }, [authState, setUser]);

  if (authState === 'checking') {
    return <PageSpinner />;
  }
  if (authState === 'unauthenticated') {
    return <LoginPage onSuccess={() => setAuthState('authenticated')} />;
  }

  return <AuthedApp />;
}

function AuthedApp() {
  const connect = useWebSocketStore((s) => s.connect);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    connect();
  }, [connect]);

  useWebSocketQuerySync();

  // Developers are limited to Bot 管理 + 监测. Everything else is hidden from
  // the menu AND not routed here; a stray URL falls through to the redirect.
  // (The backend authz layer is the real boundary — this is UX only.)
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {isAdmin ? (
          <>
            <Route index element={<DashboardPage />} />
            <Route path="machines" element={<MachinesPage />} />
            <Route path="machines/:machineId" element={<MachineDetailPage />} />
            <Route path="bots" element={<BotsPage />} />
            <Route path="bots/:agentId" element={<BotDetailPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="skills/:skillId" element={<SkillDetailPage />} />
            <Route path="playground" element={<PlaygroundPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="credentials" element={<CredentialsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="monitoring" element={<MonitoringDashboardPage />} />
            <Route path="monitoring/sessions" element={<SessionsPage />} />
            <Route path="monitoring/logs" element={<LogsPage />} />
            <Route path="monitoring/summaries" element={<SummariesPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="workflows/:workflowId" element={<WorkflowEditorPage />} />
          </>
        ) : (
          <>
            <Route index element={<Navigate to="/bots" replace />} />
            <Route path="bots" element={<BotsPage />} />
            <Route path="bots/:agentId" element={<BotDetailPage />} />
            <Route path="chat" element={<ChatPage />} />
            {/* Skills catalog is read-only for developers (mutations are
                gated in-page + blocked by backend authz). */}
            <Route path="skills" element={<SkillsPage />} />
            <Route path="skills/:skillId" element={<SkillDetailPage />} />
            <Route path="monitoring" element={<MonitoringDashboardPage />} />
            <Route path="monitoring/sessions" element={<SessionsPage />} />
            <Route path="monitoring/logs" element={<LogsPage />} />
            <Route path="monitoring/summaries" element={<SummariesPage />} />
            <Route path="*" element={<Navigate to="/bots" replace />} />
          </>
        )}
      </Route>
    </Routes>
  );
}
