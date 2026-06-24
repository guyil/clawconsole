import { create } from 'zustand';
import type { AuthUser } from '../api/auth.api';

/**
 * Current authenticated user. Populated once on boot (App's verifyMe) and
 * after login. Role drives the menu/route gating — the backend authz layer
 * is the real security boundary, this is purely UX.
 */
interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));

/** True for admins (or when the role is somehow unknown — fail open to admin
 * UX only; the backend still enforces real access). */
export function useIsAdmin(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  return role !== 'developer';
}
