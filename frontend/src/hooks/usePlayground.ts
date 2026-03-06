import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { playgroundApi } from '../api/playground.api';

const KEYS = {
  sessions: ['playground-sessions'] as const,
  session: (id: string) => ['playground-session', id] as const,
  skillFiles: (sessionId: string) => ['playground-skill-files', sessionId] as const,
  templates: ['playground-templates'] as const,
  versions: (skillId: string) => ['skill-versions', skillId] as const,
};

export function usePlaygroundSessions(filters?: { status?: string; skillCatalogId?: string }) {
  return useQuery({
    queryKey: [...KEYS.sessions, filters],
    queryFn: () => playgroundApi.listSessions(filters),
  });
}

export function usePlaygroundSession(id: string | null) {
  return useQuery({
    queryKey: KEYS.session(id ?? ''),
    queryFn: () => playgroundApi.getSession(id!),
    enabled: !!id,
  });
}

export function useCreatePlaygroundSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: playgroundApi.createSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.sessions }),
  });
}

export function useDeletePlaygroundSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: playgroundApi.deleteSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.sessions }),
  });
}

export function useStopPlaygroundSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: playgroundApi.stopSession,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: KEYS.session(id) });
      qc.invalidateQueries({ queryKey: KEYS.sessions });
    },
  });
}

export function useValidateSkill() {
  return useMutation({ mutationFn: playgroundApi.validate });
}

export function useScanSkill() {
  return useMutation({ mutationFn: playgroundApi.scan });
}

export function useParseSkill() {
  return useMutation({ mutationFn: playgroundApi.parse });
}

export function usePlaygroundTemplates() {
  return useQuery({
    queryKey: KEYS.templates,
    queryFn: playgroundApi.getTemplates,
    staleTime: Infinity,
  });
}

export function useSkillVersions(skillId: string | null) {
  return useQuery({
    queryKey: KEYS.versions(skillId ?? ''),
    queryFn: () => playgroundApi.listVersions(skillId!),
    enabled: !!skillId,
  });
}

export function useCreateSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, ...data }: { skillId: string; version: string; skillMdContent: string; changeNote?: string }) =>
      playgroundApi.createVersion(skillId, data),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: KEYS.versions(vars.skillId) }),
  });
}

// --- Skill Files ---

export function useSkillFiles(sessionId: string | null) {
  return useQuery({
    queryKey: KEYS.skillFiles(sessionId ?? ''),
    queryFn: () => playgroundApi.listSkillFiles(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 3000,
  });
}

export function useUpdateSkillFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, filePath, content }: { sessionId: string; filePath: string; content: string }) =>
      playgroundApi.updateSkillFile(sessionId, filePath, content),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: KEYS.skillFiles(vars.sessionId) }),
  });
}

export function useDeleteSkillFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, filePath }: { sessionId: string; filePath: string }) =>
      playgroundApi.deleteSkillFile(sessionId, filePath),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: KEYS.skillFiles(vars.sessionId) }),
  });
}
