import { FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, statusOptions } from '../components/StatusBadge';
import { formatDate, formatVnd } from '../lib/format';
import { CHANNEL_LABELS } from '../lib/orderFlow';
import { useListQuery } from '../lib/queries';
import type { OrderRow } from './orders/types';

const COLUMNS: Column<OrderRow>[] = [
  {
    key: 'order_code',
    header: 'Mã đơn',
    cell: (o) => (
      <div>
        <p className="font-medium text-fg">{o.order_code}</p>
        {o.external_order_id && <p className="text-xs text-muted">{o.external_order_id}</p>}
      </div>
    ),
  },
  { key: 'created_at', header: 'Ngày tạo', cell: (o) => formatDate(o.created_at, { time: true }) },
  {
    key: 'customer',
    header: 'Khách hàng',
    cell: (o) => (
      <div>
        <p className="text-fg">{o.customer_name}</p>
        <p className="text-xs text-muted">{o.customer_phone}</p>
      </div>
    ),
  },
  { key: 'channel', header: 'Kênh', cell: (o) => CHANNEL_LABELS[o.channel] ?? o.channel },
  { key: 'item_count', header: 'Số dòng', align: 'right', cell: (o) => o.item_count },
  { key: 'total_amount', header: 'Tổng tiền', align: 'right', cell: (o) => formatVnd(o.total_amount) },
  { key: 'payment_status', header: 'Thanh toán', cell: (o) => <StatusBadge kind="payment" value={o.payment_status} /> },
  { key: 'order_status', header: 'Trạng thái', cell: (o) => <StatusBadge kind="order" value={o.order_status} /> },
];

/** Danh sách đơn mọi kênh: lọc kênh, trạng thái, thanh toán, khoảng ngày; tìm theo mã, tên, SĐT. */
export function Orders() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const [params, setParams] = useSearchParams();
  const staleWeb = params.get('stale_web') === '1';
  const [status, setStatus] = useState(() => {
    const s = params.get('status') ?? '';
    return statusOptions('order').some((o) => o.value === s) ? s : '';
  });
  const [payment, setPayment] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useListQuery<OrderRow>('/orders', {
    q,
    page,
    page_size: 50,
    channel,
    status,
    payment_status: payment,
    from,
    to,
    stale_web: staleWeb ? '1' : '',
  });
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Đơn hàng" description="Đơn từ website, sàn thương mại và đơn nhập tay." />
      {staleWeb && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-fg">
          Đang lọc: Đơn web chờ thanh toán quá 48 giờ (chưa thu tiền). Liên hệ khách hoặc huỷ đơn để trả hàng giữ về kho.
          <button
            type="button"
            className="underline"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('stale_web');
              setParams(next);
              setPage(1);
            }}
          >
            Bỏ lọc
          </button>
        </p>
      )}
      <DataTable
        columns={COLUMNS}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(o) => navigate(`/don-hang/${o.id}`)}
        search={{ value: q, placeholder: 'Tìm mã đơn, tên hoặc SĐT', onChange: reset(setQ) }}
        filters={
          <div className="flex flex-wrap gap-2">
            <select aria-label="Kênh" value={channel} onChange={(e) => reset(setChannel)(e.target.value)} className={`${inputClass} sm:w-36`}>
              <option value="">Mọi kênh</option>
              {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select aria-label="Trạng thái đơn" value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={`${inputClass} sm:w-40`}>
              <option value="">Mọi trạng thái</option>
              {statusOptions('order').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select aria-label="Thanh toán" value={payment} onChange={(e) => reset(setPayment)(e.target.value)} className={`${inputClass} sm:w-44`}>
              <option value="">Mọi thanh toán</option>
              {statusOptions('payment').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input type="date" aria-label="Từ ngày" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className={`${inputClass} sm:w-40`} />
            <input type="date" aria-label="Đến ngày" value={to} onChange={(e) => reset(setTo)(e.target.value)} className={`${inputClass} sm:w-40`} />
          </div>
        }
        actions={
          <>
            <Link to="/don-hang/nhap-file" className={buttonClass('secondary')}>
              <FileUp size={16} aria-hidden />
              Nhập file sàn
            </Link>
            <Link to="/don-hang/moi" className={buttonClass('primary')}>
              <Plus size={16} aria-hidden />
              Tạo đơn
            </Link>
          </>
        }
        empty="Chưa có đơn hàng nào"
      />
    </>
  );
}
