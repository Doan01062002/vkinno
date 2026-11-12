import { z } from 'zod';

/** Schema dùng chung giữa Worker và giao diện quản trị. */
export const idSchema = z.coerce.number().int().positive();
export const vndSchema = z.number().int().nonnegative();
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().optional(),
});

const stockLineInput = z.object({
  sku: z.string().trim().min(1).max(64),
  qty: z.number().int().optional(),
  unit_cost_vnd: z.number().int().optional(),
  batch_code: z.string().trim().max(64).default(''),
  expiry_date: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Ngày hết hạn phải dạng YYYY-MM-DD')
    .default(''),
  counted_qty: z.number().int().optional(),
});

export const stockDocTypeSchema = z.enum(['RECEIPT', 'ISSUE', 'ADJUST', 'STOCKTAKE']);

/** Phiếu kho: ràng buộc từng dòng theo loại phiếu (ADJUST: `qty` là độ lệch ≠ 0). */
export const stockDocInput = z
  .object({
    type: stockDocTypeSchema,
    supplier_id: z.number().int().positive().nullish(),
    note: z.string().trim().max(1000).default(''),
    lines: z.array(stockLineInput).min(1).max(200),
  })
  .superRefine((doc, ctx) => {
    doc.lines.forEach((l, i) => {
      const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: ['lines', i, path], message });
      if (doc.type === 'RECEIPT') {
        if (l.qty === undefined || l.qty <= 0) bad('qty', 'Số lượng nhập phải lớn hơn 0');
        if (l.unit_cost_vnd === undefined || l.unit_cost_vnd < 0) bad('unit_cost_vnd', 'Đơn giá nhập phải từ 0 trở lên');
      } else if (doc.type === 'ISSUE') {
        if (l.qty === undefined || l.qty <= 0) bad('qty', 'Số lượng xuất phải lớn hơn 0');
      } else if (doc.type === 'ADJUST') {
        if (l.qty === undefined || l.qty === 0) bad('qty', 'Độ lệch điều chỉnh phải khác 0');
      } else if (l.counted_qty === undefined || l.counted_qty < 0) {
        bad('counted_qty', 'Số đếm phải từ 0 trở lên');
      }
    });
  });

export type StockDocInput = z.infer<typeof stockDocInput>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const stockDocListQuery = pageQuerySchema.extend({
  type: stockDocTypeSchema.optional(),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const flag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

/**
 * Sản phẩm. Không có `stock_qty`, `reserved_qty`, `cost_avg_vnd`: các khoá này (nếu gửi) bị bỏ qua,
 * chỉ module kho được ghi chúng.
 */
export const productInput = z.object({
  sku: z.string().regex(/^[A-Z0-9-]{3,60}$/, 'SKU gồm chữ in hoa, số, dấu gạch ngang (3-60 ký tự)'),
  name: z.string().trim().min(1).max(300),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số, dấu gạch ngang')
    .max(300),
  price_vnd: vndSchema,
  listed_price_vnd: vndSchema,
  wholesale_price_vnd: vndSchema.nullish(),
  unit: z.string().trim().min(1).max(30).default('chai'),
  category: z.string().trim().max(100).default(''),
  min_stock: z.number().int().nonnegative().default(10),
  shelf_label: z.string().trim().max(100).default(''),
  is_active: flag.default(1),
  is_combo: flag.default(0),
  image_url: z.string().trim().max(500).default(''),
  gallery_json: z
    .string()
    .max(10000)
    .refine((s) => {
      try {
        return Array.isArray(JSON.parse(s));
      } catch {
        return false;
      }
    }, 'gallery_json phải là mảng JSON')
    .default('[]'),
  description: z.string().max(5000).default(''),
  batch_code: z.string().trim().max(64).default(''),
  expiry_date: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Ngày hết hạn phải dạng YYYY-MM-DD')
    .default(''),
});

export type ProductInput = z.infer<typeof productInput>;

/** Sửa sản phẩm: mọi trường tuỳ chọn, không mặc định (chỉ cột được gửi mới bị ghi); SKU chỉ để đối chiếu. */
export const productUpdateInput = z.object(
  Object.fromEntries(
    Object.entries(productInput.shape).map(([k, v]) => [
      k,
      (v instanceof z.ZodDefault ? v.removeDefault() : (v as z.ZodType)).optional(),
    ]),
  ) as { [K in keyof typeof productInput.shape]: z.ZodOptional<z.ZodType> },
);

export const bomInput = z.object({
  items: z
    .array(
      z.object({
        component_sku: z.string().trim().min(1).max(64),
        qty_per_combo: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
});

export const productListQuery = pageQuerySchema.extend({
  category: z.string().trim().optional(),
  is_active: z.enum(['0', '1']).optional(),
});

export const inventoryListQuery = pageQuerySchema.extend({
  category: z.string().trim().optional(),
  low: z.enum(['0', '1']).optional(),
});

export const ledgerQuery = pageQuerySchema.pick({ page: true, page_size: true }).extend({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Khách hàng và nhà cung cấp
// ---------------------------------------------------------------------------

const customerFields = {
  phone: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  type: z.enum(['RETAIL', 'B2B']).default('RETAIL'),
  company_name: z.string().trim().max(300).default(''),
  tax_code: z.string().trim().max(30).default(''),
  email: z.string().trim().max(254).default(''),
  address: z.string().trim().max(500).default(''),
  credit_limit_vnd: vndSchema.optional(),
  payment_terms_days: z.number().int().nonnegative().optional(),
  price_tier: z.enum(['RETAIL', 'WHOLESALE']).default('RETAIL'),
  note: z.string().trim().max(1000).default(''),
};

/** Khách B2B bắt buộc có hạn mức công nợ và số ngày nợ (≥ 0); khách lẻ có thể bỏ qua. */
export const customerInput = z.object(customerFields).superRefine((c, ctx) => {
  if (c.type !== 'B2B') return;
  if (c.payment_terms_days === undefined) {
    ctx.addIssue({ code: 'custom', path: ['payment_terms_days'], message: 'Khách B2B bắt buộc có số ngày nợ (từ 0 trở lên)' });
  }
  if (c.credit_limit_vnd === undefined) {
    ctx.addIssue({ code: 'custom', path: ['credit_limit_vnd'], message: 'Khách B2B bắt buộc có hạn mức công nợ (từ 0 trở lên)' });
  }
});

export type CustomerInput = z.infer<typeof customerInput>;

export const customerListQuery = pageQuerySchema.extend({
  type: z.enum(['RETAIL', 'B2B']).optional(),
});

export const supplierInput = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(254).default(''),
  address: z.string().trim().max(500).default(''),
  tax_code: z.string().trim().max(30).default(''),
  note: z.string().trim().max(1000).default(''),
  is_active: flag.default(1),
});

export type SupplierInput = z.infer<typeof supplierInput>;

// ---------------------------------------------------------------------------
// Đơn hàng
// ---------------------------------------------------------------------------

export const orderChannelSchema = z.enum(['WEB', 'SHOPEE', 'TIKTOK', 'ZALO', 'B2B', 'PHONE', 'FACEBOOK']);
export const paymentMethodSchema = z.enum(['COD', 'VIETQR', 'SHOPEE', 'BANK_B2B', 'CASH', 'BANK_TRANSFER', 'MARKETPLACE']);
export const orderStatusSchema = z.enum(['PENDING', 'PACKED', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED']);

const orderFields = {
  channel: orderChannelSchema,
  customer: z.object({
    phone: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1, 'Vui lòng nhập tên khách').max(200),
    email: z.string().trim().max(254).optional(),
    address: z.string().trim().max(500).optional(),
  }),
  shipping_address: z.string().trim().max(500),
  notes: z.string().trim().max(2000).default(''),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64),
        quantity: z.number().int().positive().max(100000),
        unit_price: vndSchema.optional(),
      }),
    )
    .min(1)
    .max(200),
  shipping_fee_vnd: vndSchema,
  discount_vnd: vndSchema.default(0),
  payment_method: paymentMethodSchema,
  due_date: dateSchema.optional(),
};

/**
 * Tạo đơn (mọi nguồn). Dòng không có `unit_price` → giá bán theo hạng giá của khách
 * (WHOLESALE: `wholesale_price_vnd ?? price_vnd`, còn lại `price_vnd`).
 */
export const createOrderInput = z.object({
  ...orderFields,
  external_order_id: z.string().trim().min(1).max(100).optional(),
  /** Mã ưu đãi chỉ để lưu (đơn web tự tính giảm giá rồi truyền `discount_vnd`). */
  voucher_code: z.string().trim().max(50).default(''),
});

export type CreateOrderInput = z.input<typeof createOrderInput>;

/** Sửa đơn khi còn PENDING: thay toàn bộ thông tin và dòng hàng (mã đơn sàn không đổi). */
export const updateOrderInput = z.object(orderFields);

export const orderTransitionInput = z.object({
  to: z.enum(['PACKED', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED']),
  lines: z
    .array(z.object({ order_item_id: z.number().int().positive(), action: z.enum(['RESTOCK', 'DAMAGED']) }))
    .max(200)
    .optional(),
});

export const orderShippingInput = z.object({
  shipping_carrier: z.string().trim().max(100),
  shipping_tracking_code: z.string().trim().max(100),
  shipping_fee_vnd: vndSchema,
});

export const orderListQuery = pageQuerySchema.extend({
  channel: orderChannelSchema.optional(),
  status: orderStatusSchema.optional(),
  payment_status: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  customer_id: idSchema.optional(),
});
