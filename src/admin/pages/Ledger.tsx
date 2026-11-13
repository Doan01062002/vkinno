import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { Field, inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { apiFetch } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';
import { REASON_LABELS } from './kho/labels';

interface LedgerRow {
  id: number;
  delta: number;
  stock_after: number;
  reason: string;
  ref_order_code: string | null;
  doc_code: string | null;
  unit_cost_vnd?: number | null;
  created_at: string;
}

/** Sổ kho của một sản phẩm: mọi biến động tồn, mới nhất trước. */
export function Ledger() {
  const { sku = '' } = useParams();
  const { isAdmin } = useMe();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const product = useQuery({
    queryKey: ['/products', 'detail', sku],
    queryFn: () => apiFetch<{ name: string; unit: string }>(`/products/${encodeURIComponent(sku)}`),
  });
  const path = `/inventory/${encodeURIComponent(sku)}/ledger`;
  const query = useListQuery<LedgerRow>(path, { page, page_size: 50, from, to });
  const showCost = isAdmin && (query.data?.items ?? []).some((r) => r.unit_cost_vnd !== undefined);

  const columns: Column<LedgerRow>[] = [
    { key: 'created_at', header: 'Thời gian', cell: (r) => formatDate(r.created_at, { time: true }) },
    { key: 'reason', header: 'Lý do', cell: (r) => REASON_LABELS[r.reason] ?? r.reason },
    { key: 'ref', header: 'Chứng từ', cell: (r) => r.doc_code || r.ref_order_code || '—' },
    {
      key: 'delta',
      header: 'Biến động',
      align: 'right',
      cell: (r) => (
        <span className={r.delta < 0 ? 'text-danger' : 'text-success'}>
          {r.delta > 0 ? '+' : ''}
          {formatNumber(r.delta)}
        </span>
      ),
    },
    { key: 'stock_after', header: 'Tồn sau', align: 'right', cell: (r) => formatNumber(r.stock_after) },
    ...(showCost
      ? [
          {
            key: 'unit_cost_vnd',
            header: 'Giá vốn',
            align: 'right' as const,
            cell: (r: LedgerRow) => (r.unit_cost_vnd == null ? '—' : formatVnd(r.unit_cost_vnd)),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={`Sổ kho: ${product.data?.name ?? sku}`}
        description={`SKU ${sku}`}
        actions={
          <Link to="/kho" className={buttonClass('secondary')}>
            Quay lại tồn kho
          </Link>
        }
      />
      <DataTable
        columns={columns}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        filters={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Từ ngày" htmlFor="ledger-from">
              <input
                id="ledger-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Đến ngày" htmlFor="ledger-to">
              <input
                id="ledger-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className={inputClass}
              />
            </Field>
          </div>
        }
        empty="Chưa có biến động kho"
      />
    </>
  );
}
