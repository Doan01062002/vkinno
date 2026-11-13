import { formatDate, formatNumber, formatVnd } from '../lib/format';
import type { CustomerRow } from '../pages/customers/types';
import type { QuoteDetailData } from '../pages/quotes/types';
import type { CompanyInfo } from './types';

/** Báo giá gửi khách (A4): thông tin công ty, khách, bảng hàng, tổng tiền, hiệu lực. */
export function QuotePrint({
  quote,
  customer,
  company,
}: {
  quote: QuoteDetailData;
  customer: CustomerRow | null;
  company: CompanyInfo;
}) {
  return (
    <article aria-label="Báo giá" className="space-y-4 text-sm leading-relaxed">
      <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
        <div>
          <p className="text-lg font-bold">{company.name}</p>
          {company.address && <p>{company.address}</p>}
          {company.phone && <p>ĐT: {company.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl font-bold uppercase">Báo giá</p>
          <p>Số: {quote.code}</p>
          <p>Ngày: {formatDate(quote.created_at)}</p>
          {quote.valid_until && <p>Hiệu lực đến: {formatDate(quote.valid_until)}</p>}
        </div>
      </header>
      <section>
        <p>
          <strong>Kính gửi:</strong> {customer?.company_name || customer?.name || quote.customer_name || '—'}
        </p>
        {customer?.company_name && customer.name && <p>Người liên hệ: {customer.name}</p>}
        {customer?.tax_code && <p>Mã số thuế: {customer.tax_code}</p>}
        {customer?.address && <p>Địa chỉ: {customer.address}</p>}
        {customer?.phone && <p>ĐT: {customer.phone}</p>}
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5">Sản phẩm</th>
            <th className="w-16 py-1.5 text-right">SL</th>
            <th className="w-28 py-1.5 text-right">Đơn giá</th>
            <th className="w-32 py-1.5 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((i, idx) => (
            <tr key={i.id} className="border-b border-black/30">
              <td className="py-1.5">{idx + 1}</td>
              <td className="py-1.5">
                {i.product_name}
                <span className="block text-xs text-black/60">{i.sku}</span>
              </td>
              <td className="py-1.5 text-right">{formatNumber(i.quantity)}</td>
              <td className="py-1.5 text-right">{formatVnd(i.unit_price)}</td>
              <td className="py-1.5 text-right">{formatVnd(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="py-1 text-right">
              Tạm tính
            </td>
            <td className="py-1 text-right">{formatVnd(quote.subtotal_vnd)}</td>
          </tr>
          {quote.discount_vnd > 0 && (
            <tr>
              <td colSpan={4} className="py-1 text-right">
                Giảm giá
              </td>
              <td className="py-1 text-right">-{formatVnd(quote.discount_vnd)}</td>
            </tr>
          )}
          {quote.shipping_fee_vnd > 0 && (
            <tr>
              <td colSpan={4} className="py-1 text-right">
                Phí vận chuyển
              </td>
              <td className="py-1 text-right">{formatVnd(quote.shipping_fee_vnd)}</td>
            </tr>
          )}
          <tr className="border-t border-black font-bold">
            <td colSpan={4} className="py-1.5 text-right">
              Tổng cộng
            </td>
            <td className="py-1.5 text-right">{formatVnd(quote.total_amount)}</td>
          </tr>
        </tfoot>
      </table>
      {quote.note && (
        <p>
          <strong>Ghi chú:</strong> {quote.note}
        </p>
      )}
      <footer className="flex justify-between pt-8">
        <p>Khách hàng xác nhận</p>
        <p>Người lập báo giá</p>
      </footer>
    </article>
  );
}
