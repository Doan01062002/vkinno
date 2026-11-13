import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { apiFetch } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';
import { KhoTabs } from './kho/KhoTabs';

export interface InventoryRow {
  sku: string;
  name: string;
  unit: string;
  min_stock: number;
  is_combo: number;
  stock: number;
  reserved: number;
  available: number;
  cost_avg_vnd?: number;
}

interface Alerts {
  low_stock: { sku: string; name: string; unit: string; min_stock: number; available: number }[];
  expiring: { sku: string; name: string; batch_code: string; expiry_date: string; qty: number; days_left: number }[];
}

const SHOWN = 5;

function AlertsPanel() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['/inventory', 'alerts'], queryFn: () => apiFetch<Alerts>('/inventory/alerts') });
  const low = q.data?.low_stock ?? [];
  const exp = q.data?.expiring ?? [];
  if (!q.data || (low.length === 0 && exp.length === 0)) return null;

  return (
    <section aria-label="Cảnh báo kho" className="mb-4 grid gap-3 md:grid-cols-2">
      {low.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <AlertTriangle size={16} className="text-warning" aria-hidden />
            Sắp hết hàng ({low.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {low.slice(0, SHOWN).map((i) => (
              <li key={i.sku}>
                <button
                  type="button"
                  onClick={() => navigate(`/kho/so-kho/${encodeURIComponent(i.sku)}`)}
                  className="flex w-full justify-between gap-2 text-left hover:underline"
                >
                  <span className="truncate">{i.name}</span>
                  <span className="shrink-0 text-muted">
                    còn {formatNumber(i.available)} / tối thiểu {formatNumber(i.min_stock)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {low.length > SHOWN && <p className="mt-1 text-xs text-muted">và {low.length - SHOWN} sản phẩm khác</p>}
        </div>
      )}
      {exp.length > 0 && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <Clock size={16} className="text-danger" aria-hidden />
            Lô sắp hết hạn ({exp.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {exp.slice(0, SHOWN).map((l) => (
              <li key={`${l.sku}-${l.batch_code}-${l.expiry_date}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {l.name}
                  {l.batch_code ? ` · lô ${l.batch_code}` : ''}
                </span>
                <span className="shrink-0 text-muted">
                  {formatNumber(l.qty)} · HSD {formatDate(l.expiry_date)}
                  {l.days_left < 0 ? ' (đã hết hạn)' : ` (còn ${l.days_left} ngày)`}
                </span>
              </li>
            ))}
          </ul>
          {exp.length > SHOWN && <p className="mt-1 text-xs text-muted">và {exp.length - SHOWN} lô khác</p>}
        </div>
      )}
    </section>
  );
}

/** Tồn kho: thực tế, đang giữ, có thể bán; lọc sắp hết hàng; bấm dòng để xem sổ kho. */
export function Inventory() {
  const navigate = useNavigate();
  const { isAdmin } = useMe();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [low, setLow] = useState(false);
  const query = useListQuery<InventoryRow>('/inventory', { q, page, page_size: 50, low: low ? 1 : undefined });
  const showCost = isAdmin && (query.data?.items ?? []).some((r) => r.cost_avg_vnd !== undefined);

  const columns: Column<InventoryRow>[] = [
    {
      key: 'name',
      header: 'Sản phẩm',
      cell: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium break-words text-fg">{r.name}</p>
          <p className="text-xs text-muted">
            {r.sku}
            {r.is_combo ? ' · Combo' : ''}
          </p>
        </div>
      ),
    },
    { key: 'stock', header: 'Tồn thực tế', align: 'right', cell: (r) => formatNumber(r.stock) },
    { key: 'reserved', header: 'Đang giữ', align: 'right', cell: (r) => formatNumber(r.reserved) },
    {
      key: 'available',
      header: 'Có thể bán',
      align: 'right',
      cell: (r) => (
        <span className={r.available < r.min_stock ? 'font-semibold text-danger' : 'font-medium text-fg'}>
          {formatNumber(r.available)}
        </span>
      ),
    },
    { key: 'min_stock', header: 'Tồn tối thiểu', align: 'right', cell: (r) => formatNumber(r.min_stock) },
    ...(showCost
      ? [
          {
            key: 'cost_avg_vnd',
            header: 'Giá vốn BQ',
            align: 'right' as const,
            cell: (r: InventoryRow) => (r.cost_avg_vnd === undefined ? '—' : formatVnd(r.cost_avg_vnd)),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title="Kho" description="Tồn kho theo sản phẩm, phiếu kho và báo cáo nhập-xuất-tồn." />
      <KhoTabs />
      <AlertsPanel />
      <DataTable
        columns={columns}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        rowKey={(r) => r.sku}
        onPageChange={setPage}
        onRowClick={(r) => navigate(`/kho/so-kho/${encodeURIComponent(r.sku)}`)}
        search={{
          value: q,
          placeholder: 'Tìm theo tên hoặc SKU',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        filters={
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={low}
              onChange={(e) => {
                setLow(e.target.checked);
                setPage(1);
              }}
            />
            Sắp hết hàng
          </label>
        }
        empty="Không có sản phẩm nào"
      />
    </>
  );
}
