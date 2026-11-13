export interface QuoteItem {
  id: number;
  sku: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface QuoteRow {
  id: number;
  code: string;
  customer_id: number | null;
  customer_name: string | null;
  /** EXPIRED được máy chủ tính lúc đọc. */
  status: string;
  valid_until: string | null;
  note: string;
  discount_vnd: number;
  shipping_fee_vnd: number;
  subtotal_vnd: number;
  total_amount: number;
  created_at: string;
}

export interface QuoteDetailData extends QuoteRow {
  items: QuoteItem[];
}

export const quoteKey = (id: string | number) => ['/quotes', 'detail', String(id)];
