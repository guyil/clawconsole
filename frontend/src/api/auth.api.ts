/**
 * Single-shared-password auth client. Mirrors backend ``auth.routes.ts``.
 *
 * Token lifecycle:
 *   - On successful login the bearer token is cached in localStorage
 *     under TOKEN_KEY and read back by the request interceptor in
 *     ``client.ts`` for every subsequent API call (and by
 *     ``websocket.store.ts`` for the WS query string).
 *   - On 401 (and on explicit ``logout()``) the cached token is cleared
 *     and the page is reloaded so the SPA returns to the login screen.
 *
 * We deliberately bypass the shared axios instance for the login call
 * because the shared interceptor would otherwise toast every 401 from
 * the login screen itself.
 */
import axios from 'axios';

const TOKEN_KEY = 'clawconsole_token';

export type UserRole = 'admin' | 'developer';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: number;
  user: AuthUser;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage may be disabled (private mode); the next API call will 401 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * POST /api/auth/login. Uses a bare axios call (NOT the shared
 * interceptor) so a wrong password surfaces a plain rejection that the
 * login form can render inline, instead of triggering the global toast.
 */
export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await axios.post<LoginResponse>(
    '/api/auth/login',
    { username, password },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
  );
  setToken(res.data.token);
  return res.data;
}

/**
 * POST /api/auth/logout. Server-side is a no-op (tokens are stateless);
 * we just clear the local copy and reload so the SPA returns to login.
 */
export async function logout(): Promise<void> {
  const token = getToken();
  try {
    await axios.post(
      '/api/auth/logout',
      {},
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 5_000,
      },
    );
  } catch {
    /* swallow — clearing locally is what matters */
  }
  clearToken();
}

/**
 * GET /api/auth/me — used on app boot to validate the cached token and
 * recover the current user (role drives menu/route gating). Returns the
 * user on success, ``null`` when the token is missing/invalid.
 */
export async function verifyMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await axios.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
      // Don't toast — we use the result for routing, not user-facing errors.
      validateStatus: () => true,
    });
    if (res.status === 200 && res.data?.ok && res.data.user) {
      return res.data.user as AuthUser;
    }
    return null;
  } catch {
    return null;
  }
}
