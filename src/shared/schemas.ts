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
