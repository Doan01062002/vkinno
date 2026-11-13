export interface OrderRow {
  id: number;
  order_code: string;
  external_order_id: string | null;
  channel: string;
  source: string;
  customer_name: string;
  customer_phone: string;
  subtotal_vnd: number;
  shipping_fee_vnd: number;
  discount_vnd: number;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  paid_amount: number;
  order_status: string;
  item_count: number;
  created_at: string;
}

export interface OrderItem {
  id: number;
  sku: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface PaymentRow {
  id: number;
  kind: 'RECEIPT' | 'REFUND';
  amount_vnd: number;
  method: string;
  reference: string;
  note: string;
  received_at: string;
}

export interface InventoryLogRow {
  id: number;
  sku: string;
  delta: number;
  reason: string;
  created_at: string;
}

export interface OrderDetailData extends OrderRow {
  customer_email: string;
  shipping_address: string;
  notes: string;
  shipping_carrier: string;
  shipping_tracking_code: string;
  voucher_code: string;
  paid_at: string | null;
  due_date: string | null;
  updated_at: string;
  items: OrderItem[];
  payments: PaymentRow[];
  inventory_logs: InventoryLogRow[];
}

export const orderKey = (id: string | number) => ['/orders', 'detail', String(id)];
