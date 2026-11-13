import { CHANNEL_LABELS } from '../../lib/orderFlow';

export interface SalesRow {
  key: string;
  name?: string;
  orders: number;
  returns: number;
  revenue_vnd: number;
  cost_total_vnd: number;
  gross_profit_vnd: number;
  gross_margin: number;
}

export interface TopProductRow {
  sku: string;
  name: string;
  quantity: number;
  revenue_vnd: number;
}

export type SalesKind = 'period' | 'channel' | 'product';

/** Biên lãi gộp theo %, làm tròn 2 chữ số (0.2345 → 23.45). */
export const marginPercent = (m: number) => Math.round(m * 10000) / 100;

/** Hàng xuất Excel: đúng các cột và dòng đang hiển thị, số giữ dạng số (không phải chuỗi đã định dạng). */
export function salesSheetRows(kind: SalesKind, rows: SalesRow[]): Record<string, string | number>[] {
  return rows.map((r) => ({
    ...(kind === 'product'
      ? { SKU: r.key, 'Tên sản phẩm': r.name ?? '' }
      : { [kind === 'channel' ? 'Kênh' : 'Kỳ']: kind === 'channel' ? (CHANNEL_LABELS[r.key] ?? r.key) : r.key }),
    'Số đơn': r.orders,
    'Đơn trả': r.returns,
    'Doanh thu (₫)': r.revenue_vnd,
    'Giá vốn (₫)': r.cost_total_vnd,
    'Lãi gộp (₫)': r.gross_profit_vnd,
    'Biên lãi gộp (%)': marginPercent(r.gross_margin),
  }));
}

export function topSheetRows(rows: TopProductRow[]) {
  return rows.map((r) => ({
    SKU: r.sku,
    'Tên sản phẩm': r.name,
    'Số lượng bán': r.quantity,
    'Doanh thu (₫)': r.revenue_vnd,
  }));
}
