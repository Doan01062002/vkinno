// Nhập đơn Shopee/TikTok từ file. Trình duyệt đọc xlsx/csv rồi gửi các đơn đã parse
// (src/shared/marketplace.ts); ở đây KHÔNG tin client: kiểm tra lại bằng zod, phân giải SKU,
// bỏ đơn trùng mã sàn, rồi mỗi đơn đi qua createOrder trong `try` riêng (một đơn lỗi không
// làm hỏng đơn khác).
import { z } from 'zod';
import { DEFAULT_COLUMN_MAPS, importOrdersSchema, type Channel, type ColumnMap, type ImportOrder } from '../../src/shared/marketplace';
import { pageQuerySchema } from '../../src/shared/schemas';
import type { Env } from '../lib/env';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { auditStmt } from './audit';
import { createOrder } from './orders';
import { route } from './router';

const channelSchema = z.enum(['SHOPEE', 'TIKTOK']);
const MAX_BODY = 4 * 1024 * 1024;

const columnMapSchema = z.object({
  order_id: z.string(),
  created_at: z.string(),
  status: z.string(),
  sku: z.string(),
  product_name: z.string(),
  quantity: z.string(),
  unit_price: z.string(),
  shipping_fee: z.string(),
  buyer_name: z.string(),
  buyer_phone: z.string(),
  address: z.string(),
});

const previewInput = z.object({ channel: channelSchema, orders: importOrdersSchema });
const importInput = previewInput.extend({
  file_name: z.string().trim().max(255).default(''),
  total_rows: z.number().int().nonnegative().optional(),
});

interface ImportError {
  external_order_id: string;
  message: string;
}

/** Ánh xạ cột hiệu lực: app_settings (nếu hợp lệ) nếu không thì mặc định. */
async function effectiveColumns(db: D1Database, channel: Channel): Promise<ColumnMap> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(`import.columns.${channel}`)
    .first<{ value: string }>();
  if (row) {
    try {
      const parsed = columnMapSchema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data;
    } catch {
      // JSON hỏng → dùng mặc định
    }
  }
  return DEFAULT_COLUMN_MAPS[channel];
}

const jsonList = (values: string[]) => JSON.stringify(values);

/** external_sku → sku: ánh xạ theo kênh trước, nếu không thì sku sản phẩm trùng tên. */
async function resolveSkus(db: D1Database, channel: Channel, externalSkus: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (externalSkus.length === 0) return resolved;
  const [mapped, direct] = await db.batch([
    db
      .prepare(
        'SELECT external_sku, sku FROM channel_sku_map WHERE channel = ? AND external_sku IN (SELECT value FROM json_each(?))',
      )
      .bind(channel, jsonList(externalSkus)),
    db.prepare('SELECT sku FROM products WHERE sku IN (SELECT value FROM json_each(?))').bind(jsonList(externalSkus)),
  ]);
  for (const r of direct.results as { sku: string }[]) resolved.set(r.sku, r.sku);
  for (const r of mapped.results as { external_sku: string; sku: string }[]) resolved.set(r.external_sku, r.sku);
  return resolved;
}

async function existingExternalIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const res = await db
    .prepare('SELECT external_order_id FROM orders WHERE external_order_id IN (SELECT value FROM json_each(?))')
    .bind(jsonList(ids))
    .all<{ external_order_id: string }>();
  return new Set(res.results.map((r) => r.external_order_id));
}

const unmappedOf = (o: ImportOrder, resolved: Map<string, string>) => [
  ...new Set(o.items.map((i) => i.external_sku).filter((s) => !resolved.has(s))),
];

route('GET', '/orders/import/columns', async ({ env, url }) => {
  const { channel } = parseQuery(url, z.object({ channel: channelSchema }));
  return ok(await effectiveColumns(env.DB, channel));
});

route('POST', '/orders/import/preview', async ({ env, req }) => {
  const { channel, orders } = await parseBody(req, previewInput, MAX_BODY);
  const real = orders.filter((o) => o.status !== 'SKIP');
  const existing = await existingExternalIds(env.DB, real.map((o) => o.external_order_id));
  const fresh = real.filter((o) => !existing.has(o.external_order_id));
  const resolved = await resolveSkus(env.DB, channel, [...new Set(fresh.flatMap((o) => o.items.map((i) => i.external_sku)))]);
  return ok({
    new: fresh.length,
    duplicates: [...existing],
    skipped_status: orders.length - real.length,
    unmapped_skus: [...new Set(fresh.flatMap((o) => unmappedOf(o, resolved)))],
  });
});

function toCreateInput(channel: Channel, o: ImportOrder, resolved: Map<string, string>) {
  return {
    channel,
    external_order_id: o.external_order_id,
    customer: { phone: o.buyer_phone, name: o.buyer_name || `Khách ${channel === 'SHOPEE' ? 'Shopee' : 'TikTok'}`, address: o.address },
    shipping_address: o.address,
    notes: `Nhập từ ${channel}${o.created_at ? `, đặt ngày ${o.created_at}` : ''}`,
    items: o.items.map((i) => ({ sku: resolved.get(i.external_sku)!, quantity: i.quantity, unit_price: i.unit_price })),
    shipping_fee_vnd: o.shipping_fee_vnd,
    payment_method: 'MARKETPLACE' as const,
  };
}

export async function runImport(
  env: Env,
  ctx: ExecutionContext | undefined,
  userId: number,
  input: z.infer<typeof importInput>,
) {
  const { channel, orders } = input;
  const real = orders.filter((o) => o.status !== 'SKIP');
  const existing = await existingExternalIds(env.DB, real.map((o) => o.external_order_id));
  const resolved = await resolveSkus(env.DB, channel, [...new Set(real.flatMap((o) => o.items.map((i) => i.external_sku)))]);

  let created = 0;
  let skipped = 0;
  const errors: ImportError[] = [];
  for (const o of real) {
    if (existing.has(o.external_order_id)) {
      skipped++;
      continue;
    }
    const unmapped = unmappedOf(o, resolved);
    if (unmapped.length > 0) {
      errors.push({ external_order_id: o.external_order_id, message: `SKU chưa ánh xạ: ${unmapped.join(', ')}` });
      continue;
    }
    try {
      await createOrder(env, toCreateInput(channel, o, resolved), { source: 'IMPORT', userId, status: o.status as 'PENDING' | 'SHIPPING' | 'COMPLETED' }, ctx);
      created++;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_ORDER') skipped++;
      else if (e instanceof ApiError) errors.push({ external_order_id: o.external_order_id, message: e.message });
      else {
        console.error(e);
        errors.push({ external_order_id: o.external_order_id, message: 'Lỗi hệ thống khi tạo đơn.' });
      }
    }
  }

  await env.DB.batch([
    env.DB
      .prepare(
        'INSERT INTO import_batches (channel, file_name, total_rows, created_orders, skipped_duplicates, errors_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(channel, input.file_name, input.total_rows ?? orders.length, created, skipped, JSON.stringify(errors), userId),
    auditStmt(env.DB, userId, 'import.run', 'import_batch', input.file_name || channel, {
      channel,
      created,
      skipped_duplicates: skipped,
      errors: errors.length,
    }),
  ]);
  return { created, skipped_duplicates: skipped, errors };
}

route('POST', '/orders/import', async ({ env, ctx, req, user }) => {
  const input = await parseBody(req, importInput, MAX_BODY);
  return ok(await runImport(env, ctx, user.id, input));
});

// ---------------------------------------------------------------------------
// Ánh xạ SKU sàn → SKU nội bộ
// ---------------------------------------------------------------------------

route('GET', '/channel-sku-map', async ({ env, url }) => {
  const q = parseQuery(url, pageQuerySchema.extend({ channel: channelSchema.optional() }));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.channel) {
    where.push('channel = ?');
    binds.push(q.channel);
  }
  if (q.q) {
    where.push('(external_sku LIKE ? OR sku LIKE ?)');
    binds.push(`%${q.q}%`, `%${q.q}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [items, total] = await env.DB.batch([
    env.DB
      .prepare(`SELECT channel, external_sku, sku FROM channel_sku_map ${w} ORDER BY channel, external_sku LIMIT ? OFFSET ?`)
      .bind(...binds, q.page_size, (q.page - 1) * q.page_size),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM channel_sku_map ${w}`).bind(...binds),
  ]);
  return ok({ items: items.results, total: (total.results[0] as { n: number }).n, page: q.page, page_size: q.page_size });
});

const skuMapInput = z.object({
  channel: channelSchema,
  mappings: z
    .array(z.object({ external_sku: z.string().trim().min(1).max(64), sku: z.string().trim().min(1).max(64).nullable() }))
    .min(1)
    .max(500),
});

/** Thêm/sửa ánh xạ; `sku: null` xoá ánh xạ. SKU nội bộ phải tồn tại. */
route('PUT', '/channel-sku-map', async ({ env, req, user }) => {
  const { channel, mappings } = await parseBody(req, skuMapInput);
  const wanted = [...new Set(mappings.flatMap((m) => (m.sku === null ? [] : [m.sku])))];
  const known = new Set(
    (
      await env.DB.prepare('SELECT sku FROM products WHERE sku IN (SELECT value FROM json_each(?))')
        .bind(jsonList(wanted))
        .all<{ sku: string }>()
    ).results.map((r) => r.sku),
  );
  const unknown = wanted.filter((s) => !known.has(s));
  if (unknown.length > 0) {
    throw new ApiError(422, 'UNKNOWN_SKU', `SKU không tồn tại: ${unknown.join(', ')}`, { skus: unknown });
  }
  await env.DB.batch([
    ...mappings.map((m) =>
      m.sku === null
        ? env.DB.prepare('DELETE FROM channel_sku_map WHERE channel = ? AND external_sku = ?').bind(channel, m.external_sku)
        : env.DB
            .prepare(
              `INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES (?, ?, ?)
               ON CONFLICT(channel, external_sku) DO UPDATE SET sku = excluded.sku`,
            )
            .bind(channel, m.external_sku, m.sku),
    ),
    auditStmt(env.DB, user.id, 'channel_sku_map.update', 'channel_sku_map', channel, { count: mappings.length }),
  ]);
  return ok({ updated: mappings.length });
});
