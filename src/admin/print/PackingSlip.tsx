import { formatDate, formatNumber } from '../lib/format';
import { CHANNEL_LABELS } from '../lib/orderFlow';
import type { OrderDetailData } from '../pages/orders/types';
import type { CompanyInfo } from './types';

/** Phiếu đóng gói cho kho: danh sách hàng cần lấy, không có giá. */
export function PackingSlip({ order, company }: { order: OrderDetailData; company: CompanyInfo }) {
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <article aria-label="Phiếu đóng gói" className="space-y-4 text-sm leading-relaxed">
      <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
        <div>
          <p className="text-lg font-bold">{company.name}</p>
          {company.address && <p>{company.address}</p>}
          {company.phone && <p>ĐT: {company.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase">Phiếu đóng gói</p>
          <p>Mã đơn: {order.order_code}</p>
          <p>Ngày: {formatDate(order.created_at, { time: true })}</p>
          <p>Kênh: {CHANNEL_LABELS[order.channel] ?? order.channel}</p>
        </div>
      </header>
      <section>
        <p>
          <strong>Khách:</strong> {order.customer_name} · {order.customer_phone}
        </p>
        {order.shipping_address && (
          <p>
            <strong>Giao đến:</strong> {order.shipping_address}
          </p>
        )}
        {order.notes && (
          <p>
            <strong>Ghi chú:</strong> {order.notes}
          </p>
        )}
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">SKU</th>
            <th className="py-1.5">Sản phẩm</th>
            <th className="w-20 py-1.5 text-right">SL</th>
            <th className="w-12 py-1.5 text-center">Đủ</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i, idx) => (
            <tr key={i.id} className="border-b border-black/30">
              <td className="py-1.5">{idx + 1}</td>
              <td className="py-1.5">{i.sku}</td>
              <td className="py-1.5">{i.product_name}</td>
              <td className="py-1.5 text-right font-semibold">{formatNumber(i.quantity)}</td>
              <td className="py-1.5 text-center">☐</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="py-1.5 text-right font-semibold">
              Tổng số lượng
            </td>
            <td className="py-1.5 text-right font-semibold">{formatNumber(totalQty)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <footer className="flex justify-between pt-6">
        <p>Người đóng gói: ____________</p>
        <p>Người kiểm tra: ____________</p>
      </footer>
    </article>
  );
}
