import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch } from '../lib/api';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import {
  CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
  TRANSITIONS,
  nextStatuses,
  type TransitionTarget,
} from '../lib/orderFlow';
import { OrderTimeline } from './orders/OrderTimeline';
import { PaymentDialog, type PaymentBody } from './orders/PaymentDialog';
import { PrintSection } from './orders/PrintSection';
import { ReturnDialog, type ReturnLine } from './orders/ReturnDialog';
import { ShippingForm } from './orders/ShippingForm';
import { orderKey, type OrderDetailData } from './orders/types';

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-fg">{children || '—'}</dd>
    </div>
  );
}

/** Chi tiết đơn: thông tin, chuyển trạng thái, giao hàng, thu/hoàn tiền, dòng thời gian, in phiếu. */
function OrderView({ order }: { order: OrderDetailData }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<TransitionTarget | null>(null);
  const [returning, setReturning] = useState(false);
  const [payKind, setPayKind] = useState<'RECEIPT' | 'REFUND' | null>(null);
  const [printing, setPrinting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [payError, setPayError] = useState('');

  const closed = order.order_status === 'CANCELLED' || order.order_status === 'RETURNED';
  const due = Math.max(0, order.total_amount - order.paid_amount);
  const overpaid = Math.max(0, order.paid_amount - order.total_amount);

  const refreshAfterChange = () => {
    void qc.invalidateQueries({ queryKey: ['/orders'] });
    void qc.invalidateQueries({ queryKey: ['/products'] });
    void qc.invalidateQueries({ queryKey: ['/reports/stock-movement'] });
    void qc.invalidateQueries({ queryKey: ['product-picker'] });
    void qc.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/inventory'),
    });
  };

  const onError = (e: unknown, retry: () => void) => {
    setActionError(e instanceof ApiClientError ? e.message : '');
    if (e instanceof ApiClientError && e.status === 0) {
      toast.error(e, { action: { label: 'Thử lại', onClick: retry } });
    } else toast.error(e);
  };

  const transition = useMutation({
    mutationFn: (v: { to: TransitionTarget; lines?: ReturnLine[] }) =>
      apiFetch<OrderDetailData>(`/orders/${order.id}/transition`, { method: 'POST', json: v }),
    onSuccess: (updated, v) => {
      setConfirm(null);
      setReturning(false);
      setActionError('');
      qc.setQueryData(orderKey(order.id), updated);
      refreshAfterChange();
      toast.success(`Đơn ${updated.order_code}: ${TRANSITIONS[v.to].label.toLowerCase()} thành công.`);
    },
    onError: (e, v) => {
      setConfirm(null);
      // Xung đột kho/trạng thái: tải lại để màn hình phản ánh đúng đơn hiện tại.
      void qc.invalidateQueries({ queryKey: orderKey(order.id) });
      onError(e, () => transition.mutate(v));
    },
  });

  const payment = useMutation({
    mutationFn: (body: PaymentBody) =>
      apiFetch<{ overpaid_vnd?: number }>(`/orders/${order.id}/payments`, { method: 'POST', json: body }),
    onSuccess: (res, body) => {
      setPayKind(null);
      setPayError('');
      setActionError('');
      void qc.invalidateQueries({ queryKey: orderKey(order.id) });
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      toast.success(body.kind === 'REFUND' ? 'Đã ghi nhận hoàn tiền.' : 'Đã ghi nhận thu tiền.');
      if (res?.overpaid_vnd) toast.info(`Đơn đang thu dư ${formatVnd(res.overpaid_vnd)}.`);
    },
    onError: (e, body) => {
      setPayError(e instanceof ApiClientError ? e.message : '');
      onError(e, () => payment.mutate(body));
    },
  });

  const openPay = (kind: 'RECEIPT' | 'REFUND') => {
    setPayError('');
    setPayKind(kind);
  };

  const nexts = nextStatuses(order.order_status);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {order.order_code}
            <StatusBadge kind="order" value={order.order_status} />
            <StatusBadge kind="payment" value={order.payment_status} />
          </span>
        }
        description={`${CHANNEL_LABELS[order.channel] ?? order.channel} · tạo ${formatDate(order.created_at, { time: true })}${
          order.external_order_id ? ` · mã sàn ${order.external_order_id}` : ''
        }`}
        actions={
          <>
            <Link to="/don-hang" className={buttonClass('secondary')}>
              Quay lại danh sách
            </Link>
            <Button variant="secondary" onClick={() => setPrinting((v) => !v)}>
              <Printer size={16} aria-hidden />
              In phiếu
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        {actionError && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {actionError}
          </p>
        )}
        {overpaid > 0 && (
          <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            Đơn đang thu dư {formatVnd(overpaid)}. Hãy hoàn lại cho khách hoặc kiểm tra các khoản thu.
          </p>
        )}

        {nexts.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Chuyển trạng thái">
            {nexts.map((to) => (
              <Button
                key={to}
                variant={TRANSITIONS[to].danger ? 'danger' : 'primary'}
                disabled={transition.isPending}
                onClick={() => (to === 'RETURNED' ? setReturning(true) : setConfirm(to))}
              >
                {TRANSITIONS[to].label}
              </Button>
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Section title="Sản phẩm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">Sản phẩm</th>
                      <th className="py-2 pr-3 text-right font-medium">SL</th>
                      <th className="py-2 pr-3 text-right font-medium">Đơn giá</th>
                      <th className="py-2 text-right font-medium">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((i) => (
                      <tr key={i.id} className="border-b border-line last:border-b-0">
                        <td className="py-2 pr-3">
                          <p className="text-fg">{i.product_name}</p>
                          <p className="text-xs text-muted">{i.sku}</p>
                        </td>
                        <td className="py-2 pr-3 text-right">{formatNumber(i.quantity)}</td>
                        <td className="py-2 pr-3 text-right">{formatVnd(i.unit_price)}</td>
                        <td className="py-2 text-right">{formatVnd(i.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Tạm tính</dt>
                  <dd>{formatVnd(order.subtotal_vnd)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Giảm giá</dt>
                  <dd>{order.discount_vnd > 0 ? `-${formatVnd(order.discount_vnd)}` : formatVnd(0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Phí vận chuyển</dt>
                  <dd>{formatVnd(order.shipping_fee_vnd)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-1 font-semibold text-fg">
                  <dt>Tổng cộng</dt>
                  <dd>{formatVnd(order.total_amount)}</dd>
                </div>
              </dl>
            </Section>

            <Section title="Giao hàng">
              <ShippingForm key={`${order.id}-${order.updated_at}`} order={order} readOnly={closed} />
            </Section>

            <Section
              title="Thanh toán"
              actions={
                <div className="flex gap-2">
                  {!closed && (
                    <Button size="sm" disabled={payment.isPending} onClick={() => openPay('RECEIPT')}>
                      Thu tiền
                    </Button>
                  )}
                  {order.paid_amount > 0 && (
                    <Button size="sm" variant="secondary" disabled={payment.isPending} onClick={() => openPay('REFUND')}>
                      Hoàn tiền
                    </Button>
                  )}
                </div>
              }
            >
              <dl className="grid gap-3 sm:grid-cols-3">
                <Info label="Đã thu">{formatVnd(order.paid_amount)}</Info>
                <Info label="Còn phải thu">{formatVnd(due)}</Info>
                <Info label="Phương thức">{PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method}</Info>
              </dl>
              {order.payments.length === 0 ? (
                <p className="text-sm text-muted">Chưa có khoản thu hoặc hoàn nào.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {order.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div>
                        <p className="text-fg">
                          {p.kind === 'REFUND' ? 'Hoàn tiền' : 'Thu tiền'} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDate(p.received_at, { time: true })}
                          {p.reference ? ` · ${p.reference}` : ''}
                          {p.note ? ` · ${p.note}` : ''}
                        </p>
                      </div>
                      <p className={`font-medium ${p.kind === 'REFUND' ? 'text-danger' : 'text-success'}`}>
                        {p.kind === 'REFUND' ? '-' : '+'}
                        {formatVnd(p.amount_vnd)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <Section title="Khách hàng">
              <dl className="space-y-2">
                <Info label="Tên">{order.customer_name}</Info>
                <Info label="Điện thoại">{order.customer_phone}</Info>
                <Info label="Email">{order.customer_email}</Info>
                <Info label="Địa chỉ giao hàng">{order.shipping_address}</Info>
                <Info label="Ghi chú">{order.notes}</Info>
                {order.due_date && <Info label="Hạn thanh toán">{formatDate(order.due_date)}</Info>}
              </dl>
            </Section>
            <Section title="Lịch sử đơn">
              <OrderTimeline order={order} />
            </Section>
          </div>
        </div>

        {printing && <PrintSection order={order} />}
      </div>

      {confirm && (
        <ConfirmDialog
          open
          danger={TRANSITIONS[confirm].danger}
          title={TRANSITIONS[confirm].title}
          message={TRANSITIONS[confirm].message}
          confirmLabel={TRANSITIONS[confirm].label}
          cancelLabel="Không"
          busy={transition.isPending}
          onConfirm={() => transition.mutate({ to: confirm })}
          onCancel={() => setConfirm(null)}
        />
      )}
      <ReturnDialog
        key={order.updated_at}
        open={returning}
        items={order.items}
        submitting={transition.isPending}
        onClose={() => setReturning(false)}
        onSubmit={(lines) => transition.mutate({ to: 'RETURNED', lines })}
      />
      <PaymentDialog
        kind={payKind}
        defaultAmount={payKind === 'REFUND' ? order.paid_amount : due}
        defaultMethod={order.payment_method}
        submitting={payment.isPending}
        error={payError}
        maxRefund={order.paid_amount}
        onClose={() => setPayKind(null)}
        onSubmit={(body) => payment.mutate(body)}
      />
    </>
  );
}

/** Trang `/don-hang/:id`. */
export function OrderDetail() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: orderKey(id),
    queryFn: () => apiFetch<OrderDetailData>(`/orders/${id}`),
  });
  if (query.isPending) return <p className="text-sm text-muted">Đang tải…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {query.error instanceof ApiClientError ? query.error.message : 'Không tải được đơn hàng.'}
      </p>
    );
  }
  return <OrderView order={query.data} />;
}
