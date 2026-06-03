import axios from 'axios';
import toast from 'react-hot-toast';
import { clearToken, getToken } from './auth.api';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Attach the cached bearer token to every outbound request. A missing
// token is fine — the request will simply 401 and the response
// interceptor below will kick us back to the login screen.
api.interceptors.request.use((req) => {
  const token = getToken();
  if (token) {
    req.headers = req.headers ?? {};
    (req.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return req;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status: number | undefined = error.response?.status;
    // On 401 the cached token is stale / wrong / expired. Drop it and
    // reload — the App boot check will then render <LoginPage/>. We
    // suppress the toast in that case to avoid stacking "Unauthorized"
    // banners on top of the login screen.
    if (status === 401) {
      clearToken();
      // Avoid an infinite reload loop if we're already on the login route
      // (e.g. a wrong-password login response also surfaces here for
      // routes that aren't /api/auth/login).
      if (window.location.pathname !== '/login' && !window.location.search.includes('relogin')) {
        window.location.reload();
      }
      return Promise.reject(error);
    }

    const msg =
      error.response?.data?.error ?? error.message ?? 'Unknown error';
    toast.error(msg);
    return Promise.reject(error);
  },
);

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}
