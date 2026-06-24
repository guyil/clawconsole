import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCreateUser, useUpdateUser } from '../../hooks/useUsers';
import type { ManagedUser } from '../../api/users.api';
import type { UserRole } from '../../api/auth.api';

interface Props {
  open: boolean;
  onClose: () => void;
  user?: ManagedUser | null;
}

const inputClass =
  'w-full bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary';

export function UserFormModal({ open, onClose, user }: Props) {
  const isEdit = !!user;
  const create = useCreateUser();
  const update = useUpdateUser();

  const [form, setForm] = useState({
    username: '',
    password: '',
    role: 'developer' as UserRole,
    status: 'active' as 'active' | 'disabled',
  });

  useEffect(() => {
    if (user) {
      setForm({ username: user.username, password: '', role: user.role, status: user.status });
    } else {
      setForm({ username: '', password: '', role: 'developer', status: 'active' });
    }
  }, [user, open]);

  const handleSubmit = () => {
    if (isEdit && user) {
      update.mutate(
        {
          id: user.id,
          data: {
            password: form.password || undefined,
            role: form.role,
            status: form.status,
          },
        },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        { username: form.username.trim(), password: form.password, role: form.role },
        { onSuccess: onClose },
      );
    }
  };

  const canSubmit = isEdit ? true : form.username.trim().length >= 3 && form.password.length >= 6;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `编辑用户 · ${user?.username}` : '新建用户'}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-claw-muted mb-1">用户名 *</label>
          <input
            className={inputClass}
            placeholder="developer1"
            value={form.username}
            disabled={isEdit}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          {isEdit && <p className="text-[11px] text-claw-muted mt-1">用户名创建后不可修改</p>}
        </div>

        <div>
          <label className="block text-xs text-claw-muted mb-1">
            {isEdit ? '重置密码（留空不修改）' : '密码 *（至少 6 位）'}
          </label>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            placeholder="••••••"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-claw-muted mb-1">角色</label>
            <select
              className={inputClass}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            >
              <option value="developer">开发者</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          {isEdit && (
            <div>
              <label className="block text-xs text-claw-muted mb-1">状态</label>
              <select
                className={inputClass}
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as 'active' | 'disabled' })
                }
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </div>
          )}
        </div>

        {form.role === 'developer' && (
          <p className="text-[11px] text-claw-muted">
            开发者仅能查看「Bot 管理」与「监测」，且只读已分配给 TA 的 Bot。创建后请在列表中点击「分配 Bot」。
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            loading={create.isPending || update.isPending}
            disabled={!canSubmit}
          >
            {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
