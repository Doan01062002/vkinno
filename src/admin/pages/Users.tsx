import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Field, inputClass } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { useToast } from '../components/Toast';
import { apiFetch, errorMessage, fieldErrors } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatDate } from '../lib/format';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  is_active: number | boolean;
  last_login_at: string | null;
  created_at: string;
}

const ROLE_LABELS = { ADMIN: 'Quản trị', STAFF: 'Nhân viên' } as const;
const MIN_PASSWORD = 10;

type Dialog = { kind: 'create' } | { kind: 'edit'; user: UserRow } | { kind: 'reset'; user: UserRow } | null;

function RoleSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: 'ADMIN' | 'STAFF') => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as 'ADMIN' | 'STAFF')} className={inputClass}>
      <option value="STAFF">{ROLE_LABELS.STAFF}</option>
      <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
    </select>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', name: '', role: 'STAFF' as 'ADMIN' | 'STAFF', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    // Mở thì đặt lại cả form; đóng thì xoá ngay mật khẩu khỏi state.
    setForm({ email: '', name: '', role: 'STAFF', password: '' });
    setErrors({});
    setServerError('');
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/users', { method: 'POST', json: { ...form, email: form.email.trim(), name: form.name.trim() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/users'] });
      toast.success('Đã tạo tài khoản.');
      setForm((f) => ({ ...f, password: '' }));
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      setServerError(errorMessage(e));
    },
  });

  return (
    <FormDialog
      open={open}
      title="Thêm tài khoản"
      submitLabel="Tạo tài khoản"
      submitting={create.isPending}
      onClose={onClose}
      onSubmit={() => {
        const next: Record<string, string> = {};
        if (!form.email.trim()) next.email = 'Nhập email.';
        if (!form.name.trim()) next.name = 'Nhập tên.';
        if (form.password.length < MIN_PASSWORD) next.password = `Mật khẩu tối thiểu ${MIN_PASSWORD} ký tự.`;
        setErrors(next);
        setServerError('');
        if (Object.keys(next).length === 0) create.mutate();
      }}
    >
      {serverError && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}
      <Field label="Email" htmlFor="u-email" required error={errors.email}>
        <input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} aria-invalid={!!errors.email} />
      </Field>
      <Field label="Họ tên" htmlFor="u-name" required error={errors.name}>
        <input id="u-name" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Vai trò" htmlFor="u-role">
        <RoleSelect id="u-role" value={form.role} onChange={(role) => setForm({ ...form, role })} />
      </Field>
      <Field label="Mật khẩu" htmlFor="u-password" required error={errors.password} hint={`Tối thiểu ${MIN_PASSWORD} ký tự.`}>
        <input id="u-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} aria-invalid={!!errors.password} />
      </Field>
    </FormDialog>
  );
}

function EditDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'STAFF'>('STAFF');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setActive(!!user.is_active);
      setError('');
    }
  }, [user]);

  const update = useMutation({
    mutationFn: () => apiFetch(`/users/${user?.id}`, { method: 'PUT', json: { name: name.trim(), role, is_active: active } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/users'] });
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Đã cập nhật tài khoản.');
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <FormDialog
      open={user !== null}
      title={`Sửa tài khoản ${user?.email ?? ''}`}
      submitting={update.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (!name.trim()) {
          setError('Nhập tên.');
          return;
        }
        setError('');
        update.mutate();
      }}
    >
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Field label="Họ tên" htmlFor="ue-name" required>
        <input id="ue-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Vai trò" htmlFor="ue-role">
        <RoleSelect id="ue-role" value={role} onChange={setRole} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Đang hoạt động
      </label>
    </FormDialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setPassword('');
    setError('');
  }, [user]);

  const reset = useMutation({
    mutationFn: () => apiFetch(`/users/${user?.id}/reset-password`, { method: 'POST', json: { password } }),
    onSuccess: () => {
      toast.success('Đã đặt lại mật khẩu.');
      setPassword('');
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <FormDialog
      open={user !== null}
      title={`Đặt lại mật khẩu cho ${user?.name ?? ''}`}
      submitLabel="Đặt lại mật khẩu"
      submitting={reset.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (password.length < MIN_PASSWORD) {
          setError(`Mật khẩu tối thiểu ${MIN_PASSWORD} ký tự.`);
          return;
        }
        setError('');
        reset.mutate();
      }}
    >
      <Field label="Mật khẩu mới" htmlFor="ur-password" required error={error} hint={`Tối thiểu ${MIN_PASSWORD} ký tự. Hãy báo mật khẩu cho người dùng.`}>
        <input id="ur-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} aria-invalid={!!error} />
      </Field>
    </FormDialog>
  );
}

/** Quản lý tài khoản: danh sách, thêm, sửa tên/vai trò/trạng thái, đặt lại mật khẩu. */
export function Users() {
  const { user: me } = useMe();
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useQuery({ queryKey: ['/users'], queryFn: () => apiFetch<{ items: UserRow[] }>('/users') });
  const rows = q.data?.items ?? [];
  const close = () => setDialog(null);

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Họ tên', cell: (u) => <span className="font-medium text-fg">{u.name}{u.id === me?.id ? ' (bạn)' : ''}</span> },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Vai trò', cell: (u) => ROLE_LABELS[u.role] },
    {
      key: 'is_active',
      header: 'Trạng thái',
      cell: (u) => (u.is_active ? 'Hoạt động' : <span className="text-danger">Đã khoá</span>),
    },
    { key: 'last_login_at', header: 'Đăng nhập gần nhất', cell: (u) => (u.last_login_at ? formatDate(u.last_login_at, { time: true }) : '—') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) => (
        <span className="inline-flex gap-1">
          <Button size="sm" variant="ghost" aria-label={`Sửa ${u.email}`} onClick={() => setDialog({ kind: 'edit', user: u })}>
            <Pencil size={14} aria-hidden /> Sửa
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Đặt lại mật khẩu ${u.email}`} onClick={() => setDialog({ kind: 'reset', user: u })}>
            <KeyRound size={14} aria-hidden /> Mật khẩu
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        onPageChange={() => undefined}
        loading={q.isFetching}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <Plus size={16} aria-hidden /> Thêm tài khoản
          </Button>
        }
      />
      <CreateDialog open={dialog?.kind === 'create'} onClose={close} />
      <EditDialog user={dialog?.kind === 'edit' ? dialog.user : null} onClose={close} />
      <ResetDialog user={dialog?.kind === 'reset' ? dialog.user : null} onClose={close} />
    </>
  );
}
