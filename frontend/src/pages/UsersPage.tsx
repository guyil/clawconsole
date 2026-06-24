import { useState } from 'react';
import { Plus, Users, Pencil, Trash2, Bot } from 'lucide-react';
import { useUsers, useDeleteUser } from '../hooks/useUsers';
import { UserFormModal } from '../components/users/UserFormModal';
import { AssignBotsModal } from '../components/users/AssignBotsModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import type { ManagedUser } from '../api/users.api';

function formatDate(iso: string | null): string {
  if (!iso) return '从未';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function UsersPage() {
  const { data, isLoading } = useUsers();
  const deleteUser = useDeleteUser();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null);
  const [assignTarget, setAssignTarget] = useState<ManagedUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);

  if (isLoading) return <PageSpinner />;

  const users = data?.data ?? [];

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div className="text-[13px] text-claw-muted">共 {users.length} 个用户</div>
        <Button
          icon={<Plus size={16} />}
          onClick={() => {
            setEditTarget(null);
            setShowForm(true);
          }}
        >
          新建用户
        </Button>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={<Users size={48} />}
          title="暂无用户"
          description="创建管理员或开发者账号"
          action={
            <Button
              icon={<Plus size={16} />}
              onClick={() => {
                setEditTarget(null);
                setShowForm(true);
              }}
            >
              新建用户
            </Button>
          }
        />
      ) : (
        <div className="border border-claw-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-claw-card text-claw-muted text-xs">
                <th className="text-left font-medium px-4 py-3">用户名</th>
                <th className="text-left font-medium px-4 py-3">角色</th>
                <th className="text-left font-medium px-4 py-3">状态</th>
                <th className="text-left font-medium px-4 py-3">已分配 Bot</th>
                <th className="text-left font-medium px-4 py-3">最近登录</th>
                <th className="text-right font-medium px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-claw-border hover:bg-claw-card/50">
                  <td className="px-4 py-3 text-claw-text font-medium">{u.username}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                        u.role === 'admin'
                          ? 'bg-claw-primary/15 text-claw-primary-light'
                          : 'bg-claw-accent/15 text-claw-accent'
                      }`}
                    >
                      {u.role === 'admin' ? '管理员' : '开发者'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                        u.status === 'active'
                          ? 'bg-claw-success/15 text-claw-success'
                          : 'bg-claw-danger/15 text-claw-danger'
                      }`}
                    >
                      {u.status === 'active' ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-claw-muted">
                    {u.role === 'developer' ? `${u.assignedAgentIds.length} 个` : '全部'}
                  </td>
                  <td className="px-4 py-3 text-claw-muted text-xs">{formatDate(u.lastLoginAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {u.role === 'developer' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Bot size={13} />}
                          onClick={() => setAssignTarget(u)}
                        >
                          分配 Bot
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil size={13} />}
                        onClick={() => {
                          setEditTarget(u);
                          setShowForm(true);
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={13} />}
                        onClick={() => setDeleteTarget(u)}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditTarget(null);
        }}
        user={editTarget}
      />

      <AssignBotsModal
        open={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        user={assignTarget}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteUser.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
        title="删除用户"
        message={`确定要删除用户「${deleteTarget?.username}」吗？此操作不可恢复。`}
        confirmLabel="删除"
        loading={deleteUser.isPending}
      />
    </div>
  );
}
