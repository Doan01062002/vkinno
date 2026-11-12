import { z } from 'zod';

/** Schema dùng chung giữa Worker và giao diện quản trị. */
export const idSchema = z.coerce.number().int().positive();
export const vndSchema = z.number().int().nonnegative();
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().optional(),
});
