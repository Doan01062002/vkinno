// Nhập đơn Shopee/TikTok từ file. Trình duyệt đọc xlsx/csv rồi gửi các đơn đã parse
// (src/shared/marketplace.ts); ở đây KHÔNG tin client: kiểm tra lại bằng zod, phân giải SKU,
// bỏ đơn trùng mã sàn, rồi mỗi đơn đi qua createOrder trong `try` riêng (một đơn lỗi không
// làm hỏng đơn khác).
import { z } from 'zod';
import { DEFAULT_COLUMN_MAPS, columnMapSchema, importOrdersSchema, type Channel, type ColumnMap, type ImportOrder } from '../../src/shared/marketplace';
import { pageQuerySchema } from '../../src/shared/schemas';
import type { Env } from '../lib/env';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { mirrorEvent } from '../lib/notify';
import { auditStmt } from './audit';
import { createOrder } from './orders';
import { route } from './router';

const channelSchema = z.enum(['SHOPEE', 'TIKTOK']);
const MAX_BODY = 4 * 1024 * 1024;

const previewInput = z.object({ channel: channelSchema, orders: importOrdersSchema });
const importInput = previewInput.extend({
  file_name: z.string().trim().max(255).default(''),
  total_rows: z.number().int().nonnegative().optional(),
  /** Các nhóm tiếp theo của cùng một file gửi lại `batch_id` nhận được ở nhóm đầu. */
  batch_id: z.number().int().positive().optional(),
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
      console.warn(`app_settings import.columns.${channel} không hợp lệ, dùng ánh xạ mặc định`);
    } catch {
      console.warn(`app_settings import.columns.${channel} không phải JSON, dùng ánh xạ mặc định`);
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
    notes: `Nhập từ ${channel}`,
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
  const prevBatch = input.batch_id === undefined ? null : await loadBatch(env.DB, input.batch_id, channel);
  const real = orders.filter((o) => o.status !== 'SKIP');
  const existing = await existingExternalIds(env.DB, real.map((o) => o.external_order_id));
  const resolved = await resolveSkus(env.DB, channel, [...new Set(real.flatMap((o) => o.items.map((i) => i.external_sku)))]);

  let created = 0;
  let skipped = 0;
  const createdCodes: string[] = [];
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
      const made = await createOrder(env, toCreateInput(channel, o, resolved), { source: 'IMPORT', userId, status: o.status as 'PENDING' | 'SHIPPING' | 'COMPLETED', createdAt: o.created_at || undefined }, ctx);
      createdCodes.push(made.order_code);
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

  const batch = await saveBatch(env.DB, userId, input, prevBatch, { created, skipped, errors });
  if (ctx && createdCodes.length > 0) {
    mirrorEvent(env, ctx, 'import.batch', { channel, batch_id: batch.batch_id, order_codes: createdCodes });
  }
  return { created, skipped_duplicates: skipped, errors, ...batch };
}

/** Kiểm tra đợt nhập TRƯỚC khi tạo đơn: không có → 404, thuộc kênh khác → 409. */
async function loadBatch(db: D1Database, id: number, channel: Channel): Promise<{ errors_json: string }> {
  const row = await db
    .prepare('SELECT channel, errors_json FROM import_batches WHERE id = ?')
    .bind(id)
    .first<{ channel: string; errors_json: string }>();
  if (!row) throw new ApiError(404, 'IMPORT_BATCH_NOT_FOUND', 'Không tìm thấy đợt nhập.');
  if (row.channel !== channel) {
    throw new ApiError(409, 'IMPORT_BATCH_CHANNEL_MISMATCH', 'Đợt nhập thuộc kênh khác.');
  }
  return row;
}

const MAX_STORED_ERRORS = 200;
const MAX_MESSAGE_LENGTH = 300;

interface StoredErrors {
  total: number;
  items: ImportError[];
}

function readStored(json: string): StoredErrors {
  try {
    const v = JSON.parse(json) as StoredErrors | ImportError[];
    return Array.isArray(v) ? { total: v.length, items: v } : v;
  } catch {
    return { total: 0, items: [] };
  }
}

/** Tạo (nhóm đầu) hoặc cộng dồn (nhóm sau, có batch_id) dòng import_batches; lỗi lưu tối đa 200. */
async function saveBatch(
  db: D1Database,
  userId: number,
  input: z.infer<typeof importInput>,
  prevBatch: { errors_json: string } | null,
  r: { created: number; skipped: number; errors: ImportError[] },
): Promise<{ batch_id: number; errors_total: number }> {
  const rows = input.total_rows ?? input.orders.length;
  const clipped = r.errors.map((e) => ({ ...e, message: e.message.slice(0, MAX_MESSAGE_LENGTH) }));
  const audit = (id: number) =>
    auditStmt(db, userId, 'import.run', 'import_batch', id, {
      channel: input.channel,
      file_name: input.file_name,
      created: r.created,
      skipped_duplicates: r.skipped,
      errors: r.errors.length,
    });

  if (input.batch_id === undefined) {
    const stored: StoredErrors = { total: clipped.length, items: clipped.slice(0, MAX_STORED_ERRORS) };
    const res = await db
      .prepare(
        'INSERT INTO import_batches (channel, file_name, total_rows, created_orders, skipped_duplicates, errors_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(input.channel, input.file_name, rows, r.created, r.skipped, JSON.stringify(stored), userId)
      .run();
    const id = Number(res.meta.last_row_id);
    await db.batch([audit(id)]);
    return { batch_id: id, errors_total: stored.total };
  }

  const id = input.batch_id!;
  const prev = readStored(prevBatch!.errors_json);
  const stored: StoredErrors = {
    total: prev.total + clipped.length,
    items: [...prev.items, ...clipped].slice(0, MAX_STORED_ERRORS),
  };
  await db.batch([
    db
      .prepare(
        `UPDATE import_batches SET total_rows = total_rows + ?, created_orders = created_orders + ?,
           skipped_duplicates = skipped_duplicates + ?, errors_json = ? WHERE id = ?`,
      )
      .bind(rows, r.created, r.skipped, JSON.stringify(stored), id),
    audit(id),
  ]);
  return { batch_id: id, errors_total: stored.total };
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
