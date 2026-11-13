import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch } from '../lib/api';
import { formatDate, formatVnd } from '../lib/format';
import { orderKey } from './orders/types';
import { PaymentDialog, type PaymentBody } from './orders/PaymentDialog';

interface DebtOrder {
  id: number;
  order_code: string;
  order_status: string;
  total_amount: number;
  paid_amount: number;
  outstanding_vnd: number;
  due_date: string | null;
  days_overdue: number;
}

interface DebtDetailData {
  customer: { id: number; name: string; type: string; credit_limit_vnd: number; payment_terms_days: number };
  items: DebtOrder[];
}

const debtKey = (id: string) => ['/debts', 'detail', id];

/** Chi tiết công nợ một khách: từng đơn còn nợ, tô đỏ đơn quá hạn, nút "Thu tiền" nhanh. */
export function DebtDetail() {
  const { customerId = '' } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<DebtOrder | null>(null);
  const [payError, setPayError] = useState('');

  const debt = useQuery({
    queryKey: debtKey(customerId),
    queryFn: () => apiFetch<DebtDetailData>(`/debts/${customerId}`),
  });

  const pay = useMutation({
    mutationFn: ({ order, body }: { order: DebtOrder; body: PaymentBody }) =>
      apiFetch<{ overpaid_vnd?: number }>(`/orders/${order.id}/payments`, { method: 'POST', json: body }),
    onSuccess: (_res, { order }) => {
      setPaying(null);
      setPayError('');
      void qc.invalidateQueries({ queryKey: ['/debts'] });
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      void qc.invalidateQueries({ queryKey: orderKey(order.id) });
      toast.success(`Đã ghi nhận thu tiền đơn ${order.order_code}.`);
    },
    onError: (e, v) => {
      setPayError(e instanceof ApiClientError ? e.message : '');
      if (e instanceof ApiClientError && e.status === 0) {
        toast.error(e, { action: { label: 'Thử lại', onClick: () => pay.mutate(v) } });
      } else toast.error(e);
    },
  });

  if (debt.isPending) return <p className="text-sm text-muted">Đang tải…</p>;
  if (debt.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        Không tải được công nợ.{' '}
        <Link to="/cong-no" className="underline">
          Quay lại danh sách
        </Link>
      </p>
    );
  }
  const { customer, items } = debt.data;
  const outstanding = items.reduce((s, o) => s + o.outstanding_vnd, 0);
  const overdue = items.filter((o) => o.days_overdue > 0).reduce((s, o) => s + o.outstanding_vnd, 0);
  const overLimit = customer.credit_limit_vnd > 0 && outstanding > customer.credit_limit_vnd;

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`Hạn thanh toán ${customer.payment_terms_days} ngày · Hạn mức ${
          customer.credit_limit_vnd > 0 ? formatVnd(customer.credit_limit_vnd) : 'không giới hạn'
        }`}
        actions={
          <>
            <Link to="/cong-no" className={buttonClass('secondary')}>
              Quay lại danh sách
            </Link>
            <Link to={`/khach-hang/${customer.id}`} className={buttonClass('secondary')}>
              Hồ sơ khách
            </Link>
          </>
        }
      />
      <div className="space-y-4">
        <section aria-label="Tổng công nợ" className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Còn nợ</p>
            <p data-testid="outstanding" className="text-lg font-semibold text-fg">
              {formatVnd(outstanding)}
            </p>
            {overLimit && <p className="text-xs font-medium text-danger">Vượt hạn mức công nợ</p>}
          </div>
          <div>
            <p className="text-xs text-muted">Quá hạn</p>
            <p data-testid="overdue" className={`text-lg font-semibold ${overdue > 0 ? 'text-danger' : 'text-fg'}`}>
              {formatVnd(overdue)}
            </p>
          </div>
        </section>

        <section aria-label="Đơn còn nợ" className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">Đơn còn nợ</h2>
          {items.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">Khách không còn đơn nào đang nợ.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Mã đơn</th>
                    <th className="px-3 py-2 font-medium">Trạng thái</th>
                    <th className="px-3 py-2 text-right font-medium">Tổng tiền</th>
                    <th className="px-3 py-2 text-right font-medium">Đã thu</th>
                    <th className="px-3 py-2 text-right font-medium">Còn nợ</th>
                    <th className="px-3 py-2 font-medium">Hạn thanh toán</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((o) => {
                    const late = o.days_overdue > 0;
                    return (
                      <tr
                        key={o.id}
                        data-overdue={late ? 'true' : 'false'}
                        className={`border-b border-line last:border-0 ${late ? 'bg-danger/10 text-danger' : 'text-fg'}`}
                      >
                        <td className="px-3 py-2 font-medium">
                          <Link to={`/don-hang/${o.id}`} className="underline-offset-2 hover:underline">
                            {o.order_code}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge kind="order" value={o.order_status} />
                        </td>
                        <td className="px-3 py-2 text-right">{formatVnd(o.total_amount)}</td>
                        <td className="px-3 py-2 text-right">{formatVnd(o.paid_amount)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatVnd(o.outstanding_vnd)}</td>
                        <td className="px-3 py-2">
                          {o.due_date ? formatDate(o.due_date) : '—'}
                          {late && <span className="ml-2 text-xs font-medium">Quá hạn {o.days_overdue} ngày</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            aria-label={`Thu tiền ${o.order_code}`}
                            onClick={() => {
                              setPayError('');
                              setPaying(o);
                            }}
                          >
                            Thu tiền
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <PaymentDialog
        kind={paying ? 'RECEIPT' : null}
        defaultAmount={paying?.outstanding_vnd ?? 0}
        defaultMethod="BANK_TRANSFER"
        maxRefund={0}
        submitting={pay.isPending}
        error={payError}
        onClose={() => setPaying(null)}
        onSubmit={(body) => paying && pay.mutate({ order: paying, body })}
      />
    </>
  );
}
