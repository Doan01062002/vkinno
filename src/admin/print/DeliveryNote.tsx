import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { PAYMENT_METHOD_LABELS } from '../lib/orderFlow';
import type { OrderDetailData } from '../pages/orders/types';
import type { CompanyInfo } from './types';

/** Phiếu giao hàng: có giá, tổng tiền và số tiền shipper cần thu (COD = còn phải thu). */
export function DeliveryNote({ order, company }: { order: OrderDetailData; company: CompanyInfo }) {
  const due = Math.max(0, order.total_amount - order.paid_amount);
  return (
    <article aria-label="Phiếu giao hàng" className="space-y-4 text-sm leading-relaxed">
      <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
        <div>
          <p className="text-lg font-bold">{company.name}</p>
          {company.address && <p>{company.address}</p>}
          {company.phone && <p>ĐT: {company.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase">Phiếu giao hàng</p>
          <p>Mã đơn: {order.order_code}</p>
          <p>Ngày: {formatDate(order.created_at, { time: true })}</p>
        </div>
      </header>
      <section className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <p>
          <strong>Người nhận:</strong> {order.customer_name}
        </p>
        <p>
          <strong>Điện thoại:</strong> {order.customer_phone}
        </p>
        <p className="sm:col-span-2">
          <strong>Địa chỉ:</strong> {order.shipping_address || '—'}
        </p>
        {(order.shipping_carrier || order.shipping_tracking_code) && (
          <p className="sm:col-span-2">
            <strong>Vận chuyển:</strong> {order.shipping_carrier || '—'}
            {order.shipping_tracking_code ? ` · Mã vận đơn ${order.shipping_tracking_code}` : ''}
          </p>
        )}
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Sản phẩm</th>
            <th className="w-14 py-1.5 text-right">SL</th>
            <th className="w-28 py-1.5 text-right">Đơn giá</th>
            <th className="w-28 py-1.5 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i, idx) => (
            <tr key={i.id} className="border-b border-black/30">
              <td className="py-1.5">{idx + 1}</td>
              <td className="py-1.5">
                {i.product_name}
                <span className="block text-xs">{i.sku}</span>
              </td>
              <td className="py-1.5 text-right">{formatNumber(i.quantity)}</td>
              <td className="py-1.5 text-right">{formatVnd(i.unit_price)}</td>
              <td className="py-1.5 text-right">{formatVnd(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto w-full max-w-xs space-y-1">
        <div className="flex justify-between">
          <dt>Tạm tính</dt>
          <dd>{formatVnd(order.subtotal_vnd)}</dd>
        </div>
        {order.discount_vnd > 0 && (
          <div className="flex justify-between">
            <dt>Giảm giá</dt>
            <dd>-{formatVnd(order.discount_vnd)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Phí vận chuyển</dt>
          <dd>{formatVnd(order.shipping_fee_vnd)}</dd>
        </div>
        <div className="flex justify-between border-t border-black pt-1 font-bold">
          <dt>Tổng cộng</dt>
          <dd>{formatVnd(order.total_amount)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Đã thanh toán ({PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method})</dt>
          <dd>{formatVnd(order.paid_amount)}</dd>
        </div>
        <div className="flex justify-between text-base font-bold">
          <dt>Còn phải thu</dt>
          <dd>{formatVnd(due)}</dd>
        </div>
      </dl>
      {order.notes && (
        <p>
          <strong>Ghi chú:</strong> {order.notes}
        </p>
      )}
      <footer className="flex justify-between pt-6">
        <p>Người giao: ____________</p>
        <p>Người nhận: ____________</p>
      </footer>
    </article>
  );
}
