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
