import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { formatDate, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';

export interface DebtRow {
  customer_id: number;
  name: string;
  outstanding_vnd: number;
  overdue_vnd: number;
  oldest_due_date: string | null;
  credit_limit_vnd: number;
  over_limit: boolean;
}

const COLUMNS: Column<DebtRow>[] = [
  { key: 'name', header: 'Khách hàng', cell: (d) => <span className="font-medium text-fg">{d.name}</span> },
  { key: 'outstanding_vnd', header: 'Còn nợ', align: 'right', cell: (d) => formatVnd(d.outstanding_vnd) },
  {
    key: 'overdue_vnd',
    header: 'Quá hạn',
    align: 'right',
    cell: (d) => (
      <span className={d.overdue_vnd > 0 ? 'font-semibold text-danger' : 'text-muted'}>{formatVnd(d.overdue_vnd)}</span>
    ),
  },
  { key: 'oldest_due_date', header: 'Hạn gần nhất', cell: (d) => (d.oldest_due_date ? formatDate(d.oldest_due_date) : '—') },
  {
    key: 'credit_limit_vnd',
    header: 'Hạn mức',
    align: 'right',
    cell: (d) => (
      <span className="inline-flex flex-wrap items-center justify-end gap-2">
        {d.credit_limit_vnd > 0 ? formatVnd(d.credit_limit_vnd) : 'Không giới hạn'}
        {d.over_limit && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 ring-1 ring-red-200 ring-inset dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
            Vượt hạn mức
          </span>
        )}
      </span>
    ),
  },
];

/** Công nợ B2B theo khách: tổng còn nợ, quá hạn (đỏ), hạn gần nhất, hạn mức và cảnh báo vượt hạn mức. */
export function Debts() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const query = useListQuery<DebtRow>('/debts', { page, page_size: 50 });
  return (
    <>
      <PageHeader title="Công nợ" description="Đơn B2B đã đóng gói còn thiếu tiền, tính theo từng khách." />
      <DataTable
        columns={COLUMNS}
        rowKey={(d) => d.customer_id}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(d) => navigate(`/cong-no/${d.customer_id}`)}
        empty="Không có khách nào đang nợ"
      />
    </>
  );
}
