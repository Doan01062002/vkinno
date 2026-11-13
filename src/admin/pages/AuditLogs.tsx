import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { inputClass } from '../components/Field';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/format';
import { useListQuery } from '../lib/queries';
import type { UserRow } from './Users';

interface AuditRow {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail_json: string | null;
  created_at: string;
}

function prettyJson(raw: string | null): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const COLUMNS: Column<AuditRow>[] = [
  { key: 'created_at', header: 'Thời gian', cell: (r) => formatDate(r.created_at, { time: true }) },
  { key: 'user_name', header: 'Người thực hiện', cell: (r) => r.user_name ?? 'Hệ thống' },
  { key: 'action', header: 'Thao tác', cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
  { key: 'entity', header: 'Đối tượng', cell: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` },
  {
    key: 'detail_json',
    header: 'Chi tiết',
    cell: (r) =>
      r.detail_json ? (
        <details>
          <summary className="cursor-pointer text-primary">Xem</summary>
          <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-subtle p-2 text-xs whitespace-pre-wrap">{prettyJson(r.detail_json)}</pre>
        </details>
      ) : (
        '—'
      ),
  },
];

/** Nhật ký thao tác (ADMIN): lọc theo người dùng, đối tượng, ngày. */
export function AuditLogs() {
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const users = useQuery({ queryKey: ['/users'], queryFn: () => apiFetch<{ items: UserRow[] }>('/users') });
  const query = useListQuery<AuditRow>('/audit-logs', { page, page_size: 50, user_id: userId, entity: entity.trim(), from, to });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <DataTable
      columns={COLUMNS}
      {...listProps(query.data)}
      page={page}
      loading={query.isFetching}
      onPageChange={setPage}
      filters={
        <>
          <select aria-label="Người dùng" value={userId} onChange={(e) => reset(setUserId)(e.target.value)} className={`${inputClass} sm:w-48`}>
            <option value="">Mọi người dùng</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input aria-label="Đối tượng" placeholder="Đối tượng (vd. order)" value={entity} onChange={(e) => reset(setEntity)(e.target.value)} className={`${inputClass} sm:w-48`} />
          <input aria-label="Từ ngày" type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} className={`${inputClass} sm:w-40`} />
          <input aria-label="Đến ngày" type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} className={`${inputClass} sm:w-40`} />
        </>
      }
    />
  );
}
