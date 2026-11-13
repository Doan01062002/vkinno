import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field, inputClass } from '../../components/Field';
import { FormDialog } from '../../components/FormDialog';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { ApiClientError, apiFetch, errorMessage, type ListResult } from '../../lib/api';
import { formatVnd } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import type { OrderRow } from '../orders/types';

export interface SepayTx {
  id: number;
  sepay_tx_id: number;
  gateway: string | null;
  account_number: string | null;
  transfer_amount: number;
  reference_code: string | null;
  content: string | null;
  received_at: string;
}

/** Gán một giao dịch SePay chưa khớp vào đơn: tìm đơn theo mã/tên/SĐT, chọn, xác nhận. */
export function SepayAssignDialog({ tx, onClose }: { tx: SepayTx | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<OrderRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const term = useDebounced(search.trim(), 300);

  useEffect(() => {
    if (tx) {
      setSearch('');
      setPicked(null);
      setConfirming(false);
      setError('');
    }
  }, [tx]);

  const orders = useQuery({
    queryKey: ['/orders', 'sepay-assign', term],
    enabled: !!tx && term.length > 0,
    queryFn: ({ signal }) => apiFetch<ListResult<OrderRow>>('/orders', { query: { q: term, page_size: 8 }, signal }),
  });

  const assign = useMutation({
    mutationFn: (orderId: number) =>
      apiFetch(`/sepay/${tx?.sepay_tx_id}/assign`, { method: 'POST', json: { order_id: orderId } }),
    onSuccess: (_d, orderId) => {
      void qc.invalidateQueries({ queryKey: ['/sepay/unmatched'] });
      void qc.invalidateQueries({ queryKey: ['/reports/dashboard'] });
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      void qc.invalidateQueries({ queryKey: ['/orders', orderId] });
      toast.success(`Đã gán giao dịch vào đơn ${picked?.order_code ?? ''}.`);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && (e.code === 'SEPAY_ALREADY_HANDLED' || e.code === 'SEPAY_TX_NOT_FOUND')) {
        void qc.invalidateQueries({ queryKey: ['/sepay/unmatched'] });
        void qc.invalidateQueries({ queryKey: ['/reports/dashboard'] });
      }
      setConfirming(false);
      setError(errorMessage(e));
    },
  });

  return (
    <>
      <FormDialog
        open={tx !== null && !confirming}
        title="Gán giao dịch vào đơn"
        submitLabel="Gán đơn"
        submitDisabled={!picked}
        onClose={onClose}
        onSubmit={() => picked && setConfirming(true)}
      >
        {tx && (
          <div className="space-y-4">
            <div className="rounded-lg bg-subtle px-3 py-2 text-sm">
              <p className="font-semibold text-fg">{formatVnd(tx.transfer_amount)}</p>
              <p className="text-muted">{tx.content || 'Không có nội dung chuyển khoản'}</p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Field label="Tìm đơn hàng" htmlFor="sepay-order-q" hint="Nhập mã đơn, tên hoặc SĐT khách.">
              <input
                id="sepay-order-q"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPicked(null);
                  setError('');
                }}
                className={inputClass}
                autoComplete="off"
              />
            </Field>
            {term && orders.data && (
              <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Kết quả tìm đơn">
                {orders.data.items.length === 0 && <li className="px-3 py-3 text-sm text-muted">Không tìm thấy đơn.</li>}
                {orders.data.items.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      aria-pressed={picked?.id === o.id}
                      onClick={() => {
                        setPicked(o);
                        setError('');
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-subtle ${
                        picked?.id === o.id ? 'bg-primary/10' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-fg">{o.order_code}</span>
                        <span className="block truncate text-xs text-muted">
                          {o.customer_name} · {formatVnd(o.total_amount)}
                        </span>
                      </span>
                      <StatusBadge kind="order" value={o.order_status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </FormDialog>
      <ConfirmDialog
        open={tx !== null && confirming && !!picked}
        title="Xác nhận gán giao dịch"
        message={`Ghi nhận ${formatVnd(tx?.transfer_amount)} vào đơn ${picked?.order_code ?? ''}? Khoản thu sẽ được thêm vào đơn và không thể hoàn tác tại đây.`}
        confirmLabel="Gán đơn"
        busy={assign.isPending}
        onConfirm={() => picked && assign.mutate(picked.id)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
