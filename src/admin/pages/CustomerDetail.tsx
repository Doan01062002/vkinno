import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiFetch } from '../lib/api';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { CHANNEL_LABELS } from '../lib/orderFlow';
import { useListQuery } from '../lib/queries';
import { CustomerFormDialog } from './customers/CustomerFormDialog';
import { CUSTOMER_TYPE_LABELS, PRICE_TIER_LABELS, type CustomerRow } from './customers/types';

interface CustomerOrder {
  id: number;
  order_code: string;
  channel: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  paid_amount: number;
  created_at: string;
}

const COLUMNS: Column<CustomerOrder>[] = [
  { key: 'order_code', header: 'Mã đơn', cell: (o) => <span className="font-medium text-fg">{o.order_code}</span> },
  { key: 'created_at', header: 'Ngày tạo', cell: (o) => formatDate(o.created_at, { time: true }) },
  { key: 'channel', header: 'Kênh', cell: (o) => CHANNEL_LABELS[o.channel] ?? o.channel },
  { key: 'total_amount', header: 'Tổng tiền', align: 'right', cell: (o) => formatVnd(o.total_amount) },
  { key: 'payment_status', header: 'Thanh toán', cell: (o) => <StatusBadge kind="payment" value={o.payment_status} /> },
  { key: 'order_status', header: 'Trạng thái', cell: (o) => <StatusBadge kind="order" value={o.order_status} /> },
];

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-fg">{children || '—'}</dd>
    </div>
  );
}

/** Chi tiết khách: thông tin, tổng chi tiêu (không tính đơn huỷ/trả) và lịch sử đơn. */
export function CustomerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(1);
  const customer = useQuery({
    queryKey: ['/customers', 'detail', id],
    queryFn: () => apiFetch<CustomerRow>(`/customers/${id}`),
  });
  const orders = useListQuery<CustomerOrder>(`/customers/${id}/orders`, { page, page_size: 20 });

  if (customer.isPending) return <p className="text-sm text-muted">Đang tải…</p>;
  if (customer.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        Không tải được khách hàng.{' '}
        <Link to="/khach-hang" className="underline">
          Quay lại danh sách
        </Link>
      </p>
    );
  }
  const c = customer.data;
  const b2b = c.type === 'B2B';
  return (
    <>
      <PageHeader
        title={c.name}
        description={`${CUSTOMER_TYPE_LABELS[c.type] ?? c.type} · ${c.phone}`}
        actions={
          <>
            <Link to="/khach-hang" className={buttonClass('secondary')}>
              Quay lại danh sách
            </Link>
            {b2b && (
              <Link to={`/cong-no/${c.id}`} className={buttonClass('secondary')}>
                Xem công nợ
              </Link>
            )}
            <Button onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden />
              Sửa
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <section aria-label="Thông tin khách hàng" className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Tổng chi tiêu">
              <span data-testid="total-spent" className="font-semibold">
                {formatVnd(c.total_spent_vnd)}
              </span>
            </Info>
            <Info label="Số đơn">{formatNumber(c.order_count)}</Info>
            <Info label="Bảng giá">{PRICE_TIER_LABELS[c.price_tier] ?? c.price_tier}</Info>
            <Info label="Email">{c.email}</Info>
            <Info label="Địa chỉ">{c.address}</Info>
            {b2b && <Info label="Công ty">{c.company_name}</Info>}
            {b2b && <Info label="Mã số thuế">{c.tax_code}</Info>}
            {b2b && <Info label="Hạn mức công nợ">{c.credit_limit_vnd > 0 ? formatVnd(c.credit_limit_vnd) : 'Không giới hạn'}</Info>}
            {b2b && <Info label="Số ngày nợ">{`${c.payment_terms_days} ngày`}</Info>}
            <Info label="Ghi chú">{c.note}</Info>
          </dl>
          <p className="text-xs text-muted">Tổng chi tiêu không tính đơn đã huỷ hoặc đã trả hàng.</p>
        </section>
        <section aria-label="Lịch sử đơn hàng" className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">Lịch sử đơn hàng</h2>
          <DataTable
            columns={COLUMNS}
            {...listProps(orders.data)}
            page={page}
            pageSize={20}
            loading={orders.isFetching}
            onPageChange={setPage}
            onRowClick={(o) => navigate(`/don-hang/${o.id}`)}
            empty="Khách chưa có đơn hàng nào"
          />
        </section>
      </div>
      <CustomerFormDialog open={editing} customer={c} onClose={() => setEditing(false)} />
    </>
  );
}
