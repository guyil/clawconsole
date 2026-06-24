import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { login } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';

/**
 * Username + password login screen. Rendered by ``App`` whenever there is
 * no valid token in localStorage. On success we cache the user (role drives
 * menu gating) and flip ``App``'s auth state so the real routes mount; data
 * hooks then fetch with the new token attached by the axios interceptor.
 */
interface LoginPageProps {
  onSuccess?: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await login(username, password);
      setUser(res.user);
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch (err) {
      const status = (err as { response?: { status?: number }; message?: string }).response?.status;
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      if (status === 401) setError(msg ?? '用户名或密码错误');
      else if (status === 503) setError(msg ?? '服务端未配置认证密钥');
      else setError(msg ?? (err as Error).message ?? '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-claw-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-claw-sidebar border border-claw-border rounded-xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-claw-primary to-claw-accent flex items-center justify-center text-white mb-3">
            <Lock size={22} />
          </div>
          <h1 className="text-lg font-bold text-claw-text">ClawConsole</h1>
          <p className="text-xs text-claw-muted mt-1">请输入用户名和密码</p>
        </div>

        <label className="block text-xs text-claw-muted mb-2" htmlFor="username">
          用户名
        </label>
        <input
          id="username"
          type="text"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (error) setError(null);
          }}
          disabled={loading}
          className="w-full px-3 py-2 mb-3 rounded-lg bg-claw-bg border border-claw-border text-claw-text text-sm focus:outline-none focus:border-claw-primary disabled:opacity-50"
        />

        <label className="block text-xs text-claw-muted mb-2" htmlFor="password">
          密码
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          disabled={loading}
          className="w-full px-3 py-2 mb-1 rounded-lg bg-claw-bg border border-claw-border text-claw-text text-sm focus:outline-none focus:border-claw-primary disabled:opacity-50"
        />

        <div className="min-h-[20px] mb-3">
          {error && <p className="text-xs text-claw-danger">{error}</p>}
        </div>

        <Button type="submit" loading={loading} className="w-full">
          登录
        </Button>
      </form>
    </div>
  );
}
