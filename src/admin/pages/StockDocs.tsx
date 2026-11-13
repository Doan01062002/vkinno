import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, statusOptions } from '../components/StatusBadge';
import { formatDate } from '../lib/format';
import { useListQuery } from '../lib/queries';
import { KhoTabs } from './kho/KhoTabs';
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType } from './kho/labels';

interface DocRow {
  id: number;
  code: string;
  type: DocType;
  status: string;
  note: string;
  line_count: number;
  created_at: string;
  posted_at: string | null;
}

/** Danh sách phiếu kho (nhập, xuất khác, điều chỉnh, kiểm kê). */
export function StockDocs() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useListQuery<DocRow>('/stock-docs', { q, type, status, page, page_size: 50 });

  const columns: Column<DocRow>[] = [
    { key: 'code', header: 'Mã phiếu', cell: (d) => <span className="font-medium text-fg">{d.code}</span> },
    { key: 'type', header: 'Loại', cell: (d) => DOC_TYPE_LABELS[d.type] ?? d.type },
    { key: 'status', header: 'Trạng thái', cell: (d) => <StatusBadge kind="doc" value={d.status} /> },
    { key: 'line_count', header: 'Số dòng', align: 'right' },
    { key: 'note', header: 'Ghi chú', cell: (d) => <span className="line-clamp-1">{d.note || '—'}</span> },
    { key: 'created_at', header: 'Ngày tạo', cell: (d) => formatDate(d.created_at, { time: true }) },
    { key: 'posted_at', header: 'Ghi sổ lúc', cell: (d) => (d.posted_at ? formatDate(d.posted_at, { time: true }) : '—') },
  ];

  const reset = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Kho" description="Tạo nháp, kiểm tra rồi ghi sổ để thay đổi tồn kho." />
      <KhoTabs />
      <DataTable
        columns={columns}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(d) => navigate(`/kho/phieu/${d.id}`)}
        search={{
          value: q,
          placeholder: 'Tìm theo mã phiếu hoặc ghi chú',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        filters={
          <>
            <select aria-label="Loại phiếu" value={type} onChange={reset(setType)} className={`${inputClass} sm:w-44`}>
              <option value="">Mọi loại</option>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select aria-label="Trạng thái phiếu" value={status} onChange={reset(setStatus)} className={`${inputClass} sm:w-40`}>
              <option value="">Mọi trạng thái</option>
              {statusOptions('doc').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          <>
            {DOC_TYPES.map((t) => (
              <Link
                key={t}
                to={`/kho/phieu/moi?type=${t}`}
                className={buttonClass(t === 'RECEIPT' ? 'primary' : 'secondary')}
              >
                <Plus size={16} aria-hidden />
                {t === 'RECEIPT' ? 'Phiếu nhập' : DOC_TYPE_LABELS[t]}
              </Link>
            ))}
          </>
        }
        empty="Chưa có phiếu kho nào"
      />
    </>
  );
}
