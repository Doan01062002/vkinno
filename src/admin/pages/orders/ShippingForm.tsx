import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Field, inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { ApiClientError, apiFetch } from '../../lib/api';
import { orderKey, type OrderDetailData } from './types';

/**
 * Thông tin giao hàng: hãng vận chuyển, mã vận đơn, phí ship (đổi phí làm đổi tổng tiền đơn).
 * Đơn đã hoàn tất: tổng tiền đã chốt nên khoá phí ship (máy chủ trả 409 ORDER_CLOSED nếu đổi).
 */
export function ShippingForm({ order, readOnly }: { order: OrderDetailData; readOnly: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [carrier, setCarrier] = useState(order.shipping_carrier);
  const [tracking, setTracking] = useState(order.shipping_tracking_code);
  const [fee, setFee] = useState<number | null>(order.shipping_fee_vnd);
  const feeLocked = readOnly || order.order_status === 'COMPLETED';

  const save = useMutation({
    mutationFn: () =>
      apiFetch<OrderDetailData>(`/orders/${order.id}/shipping`, {
        method: 'PUT',
        json: { shipping_carrier: carrier.trim(), shipping_tracking_code: tracking.trim(), shipping_fee_vnd: fee ?? 0 },
      }),
    onSuccess: (updated) => {
      qc.setQueryData(orderKey(order.id), updated);
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      toast.success('Đã lưu thông tin giao hàng.');
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 0) {
        toast.error(e, { action: { label: 'Thử lại', onClick: () => save.mutate() } });
      } else toast.error(e);
    },
  });

  return (
    <form
      aria-label="Thông tin giao hàng"
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Hãng vận chuyển" htmlFor="ship-carrier">
        <input id="ship-carrier" value={carrier} disabled={readOnly} maxLength={100} onChange={(e) => setCarrier(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Mã vận đơn" htmlFor="ship-tracking">
        <input id="ship-tracking" value={tracking} disabled={readOnly} maxLength={100} onChange={(e) => setTracking(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Phí vận chuyển" htmlFor="ship-fee">
        <MoneyInput id="ship-fee" value={fee} disabled={feeLocked} onChange={setFee} />
      </Field>
      {!readOnly && (
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={save.isPending}>
            Lưu thông tin giao hàng
          </Button>
        </div>
      )}
    </form>
  );
}
