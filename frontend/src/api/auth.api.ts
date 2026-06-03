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

export interface LoginResponse {
  token: string;
  expiresAt: number;
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
export async function login(password: string): Promise<LoginResponse> {
  const res = await axios.post<LoginResponse>(
    '/api/auth/login',
    { password },
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
 * GET /api/auth/me — used on app boot to validate the cached token. We
 * route this through the shared axios instance so a 401 also trips the
 * global response interceptor and clears the bad token in one shot.
 */
export async function verifyMe(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await axios.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
      // Don't toast — we use the result for routing, not user-facing errors.
      validateStatus: () => true,
    });
    return res.status === 200 && Boolean(res.data?.ok);
  } catch {
    return false;
  }
}
