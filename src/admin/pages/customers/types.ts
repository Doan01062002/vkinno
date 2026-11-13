export interface CustomerRow {
  id: number;
  phone: string;
  name: string;
  type: 'RETAIL' | 'B2B';
  company_name: string;
  tax_code: string;
  email: string;
  address: string;
  credit_limit_vnd: number;
  payment_terms_days: number;
  price_tier: 'RETAIL' | 'WHOLESALE';
  note: string;
  total_spent_vnd: number;
  order_count: number;
  created_at: string;
}

export const CUSTOMER_TYPE_LABELS: Record<string, string> = { RETAIL: 'Khách lẻ', B2B: 'Khách sỉ (B2B)' };
export const PRICE_TIER_LABELS: Record<string, string> = { RETAIL: 'Giá lẻ', WHOLESALE: 'Giá sỉ' };
