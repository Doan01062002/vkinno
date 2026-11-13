import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Clock, Hourglass, TrendingUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { STATUS_LABELS } from '../components/StatusBadge';
import { apiFetch } from '../lib/api';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';
import { SepayAssignDialog, type SepayTx } from './dashboard/SepayAssignDialog';

interface DashboardData {
  today_revenue_vnd?: number;
  month_revenue_vnd?: number;
  orders_by_status: Record<string, number>;
  pending_orders: number;
  alerts_count: number;
  sepay_unmatched: number;
  stale_web_orders?: number;
}

interface Alerts {
  low_stock: { sku: string; name: string; unit: string; min_stock: number; available: number }[];
  expiring: { sku: string; name: string; batch_code: string; expiry_date: string; qty: number; days_left: number }[];
}

const STATUS_ORDER = ['PENDING', 'PACKED', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED'];

function StatCard({ icon, label, value, to }: { icon: ReactNode; label: string; value: string; to?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm text-muted">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-fg">{value}</p>
    </>
  );
  const cls = 'rounded-xl border border-line bg-surface p-4 shadow-sm';
  return to ? (
    <Link to={to} className={`${cls} block hover:border-primary`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Tổng quan: doanh thu (chỉ ADMIN), đơn theo trạng thái, cảnh báo kho, giao dịch SePay chưa khớp. */
export function Dashboard() {
  const [assigning, setAssigning] = useState<SepayTx | null>(null);
  const dash = useQuery({ queryKey: ['/reports/dashboard'], queryFn: () => apiFetch<DashboardData>('/reports/dashboard') });
  const alerts = useQuery({ queryKey: ['/inventory/alerts'], queryFn: () => apiFetch<Alerts>('/inventory/alerts') });
  const sepay = useListQuery<SepayTx>('/sepay/unmatched', { page: 1, page_size: 10 });
  const d = dash.data;

  return (
    <>
      <PageHeader title="Tổng quan" description="Tình hình bán hàng và kho hôm nay." />
      {dash.isError && (
        <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          Không tải được số liệu tổng quan.{' '}
          <button type="button" className="underline" onClick={() => void dash.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {d?.today_revenue_vnd !== undefined && (
          <StatCard icon={<Banknote size={16} aria-hidden />} label="Doanh thu hôm nay" value={formatVnd(d.today_revenue_vnd)} />
        )}
        {d?.month_revenue_vnd !== undefined && (
          <StatCard icon={<TrendingUp size={16} aria-hidden />} label="Doanh thu tháng này" value={formatVnd(d.month_revenue_vnd)} />
        )}
        {d && (
          <>
            <StatCard
              icon={<Clock size={16} aria-hidden />}
              label="Đơn chờ xử lý"
              value={formatNumber(d.pending_orders)}
              to="/don-hang?status=PENDING"
            />
            <StatCard icon={<AlertTriangle size={16} aria-hidden />} label="Cảnh báo kho" value={formatNumber(d.alerts_count)} to="/kho" />
            {d.stale_web_orders !== undefined && (
              <StatCard
                icon={<Hourglass size={16} aria-hidden />}
                label="Đơn web chờ thanh toán quá 48 giờ"
                value={formatNumber(d.stale_web_orders)}
                to="/don-hang?stale_web=1"
              />
            )}
          </>
        )}
      </div>

      {d && (
        <section className="mt-6" aria-labelledby="dash-status">
          <h2 id="dash-status" className="mb-2 text-sm font-semibold text-fg">
            Đơn hàng theo trạng thái
          </h2>
          <div className="flex flex-wrap gap-2">
            {STATUS_ORDER.map((s) => (
              <Link
                key={s}
                to={`/don-hang?status=${s}`}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-primary"
              >
                {STATUS_LABELS.order[s]?.label ?? s}: <b>{formatNumber(d.orders_by_status[s] ?? 0)}</b>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="dash-alerts">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="dash-alerts" className="text-sm font-semibold text-fg">
              Cảnh báo kho
            </h2>
            <Link to="/kho" className="text-sm text-primary hover:underline">
              Mở Kho
            </Link>
          </div>
          {alerts.data && alerts.data.low_stock.length + alerts.data.expiring.length === 0 && (
            <p className="text-sm text-muted">Không có cảnh báo.</p>
          )}
          <ul className="space-y-1.5 text-sm">
            {alerts.data?.low_stock.map((a) => (
              <li key={`l-${a.sku}`}>
                <span className="font-medium text-fg">{a.name}</span>{' '}
                <span className="text-muted">
                  — sắp hết: còn {formatNumber(a.available)} {a.unit} (tối thiểu {formatNumber(a.min_stock)})
                </span>
              </li>
            ))}
            {alerts.data?.expiring.map((a) => (
              <li key={`e-${a.sku}-${a.batch_code}`}>
                <span className="font-medium text-fg">{a.name}</span>{' '}
                <span className="text-muted">
                  — lô {a.batch_code || '—'} hết hạn {formatDate(a.expiry_date)} (
                  {a.days_left < 0 ? 'đã quá hạn' : `còn ${a.days_left} ngày`})
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="dash-sepay">
          <h2 id="dash-sepay" className="mb-2 text-sm font-semibold text-fg">
            Giao dịch SePay chưa khớp{d ? ` (${formatNumber(d.sepay_unmatched)})` : ''}
          </h2>
          {sepay.data && sepay.data.items.length === 0 && <p className="text-sm text-muted">Không có giao dịch chờ gán.</p>}
          <ul className="divide-y divide-line">
            {sepay.data?.items.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{formatVnd(t.transfer_amount)}</p>
                  <p className="truncate text-xs text-muted">
                    {formatDate(t.received_at, { time: true })} · {t.content || t.reference_code || '—'}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setAssigning(t)}>
                  Gán đơn
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <SepayAssignDialog tx={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}
