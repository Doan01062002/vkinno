import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, statusOptions } from '../components/StatusBadge';
import { formatDate, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';
import type { QuoteRow } from './quotes/types';

const COLUMNS: Column<QuoteRow>[] = [
  { key: 'code', header: 'Mã báo giá', cell: (q) => <span className="font-medium text-fg">{q.code}</span> },
  { key: 'customer_name', header: 'Khách hàng', cell: (q) => q.customer_name || '—' },
  { key: 'status', header: 'Trạng thái', cell: (q) => <StatusBadge kind="quote" value={q.status} /> },
  { key: 'valid_until', header: 'Hiệu lực đến', cell: (q) => (q.valid_until ? formatDate(q.valid_until) : '—') },
  { key: 'total_amount', header: 'Tổng tiền', align: 'right', cell: (q) => formatVnd(q.total_amount) },
  { key: 'created_at', header: 'Ngày tạo', cell: (q) => formatDate(q.created_at, { time: true }) },
];

/** Danh sách báo giá B2B: lọc theo trạng thái (kể cả "Hết hạn"), tìm theo mã hoặc tên khách. */
export function Quotes() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useListQuery<QuoteRow>('/quotes', { q, status, page, page_size: 50 });

  return (
    <>
      <PageHeader title="Báo giá" description="Báo giá cho khách sỉ; chấp nhận rồi chuyển thành đơn hàng." />
      <DataTable
        columns={COLUMNS}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(r) => navigate(`/bao-gia/${r.id}`)}
        search={{
          value: q,
          placeholder: 'Tìm mã báo giá hoặc tên khách',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        filters={
          <select
            aria-label="Trạng thái báo giá"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className={`${inputClass} sm:w-44`}
          >
            <option value="">Mọi trạng thái</option>
            {statusOptions('quote').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        }
        actions={
          <Link to="/bao-gia/moi" className={buttonClass('primary')}>
            <Plus size={16} aria-hidden />
            Tạo báo giá
          </Link>
        }
        empty="Chưa có báo giá nào"
      />
    </>
  );
}
