// API cho màn hình Cài đặt → Pancake (Dự án 1b, bước 5). Chỉ ADMIN.
import { z } from 'zod';
import { idSchema, pageQuerySchema } from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { listVariations } from '../lib/pancake-client';
import { auditStmt } from './audit';
import { reprocessPancakeEvent } from './pancake';
import { route } from './router';

const ADMIN = { role: 'ADMIN' as const };
const RESULTS = ['RECEIVED', 'CREATED', 'UPDATED', 'SKIPPED', 'NEEDS_MAPPING', 'NEEDS_ATTENTION', 'ERROR'] as const;
/** Kết quả cần người xem (chưa đánh dấu đã xử lý). */
const openSql = (alias = '') => `${alias}result IN ('NEEDS_MAPPING', 'NEEDS_ATTENTION', 'ERROR') AND ${alias}resolved_at IS NULL`;
const OPEN_SQL = openSql();

const settingKeys = ['pancake.shop_id', 'pancake.warehouse_id', 'pancake.enabled', 'pancake.last_reconcile_at', 'pancake.reconcile_failures'];

const eventId = (params: Record<string, string>) => {
  const p = idSchema.safeParse(params.id);
  if (!p.success) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự kiện.');
  return p.data;
};

route(
  'GET',
  '/pancake/status',
  async ({ env }) => {
    const [settings, counts, open, last] = await env.DB.batch([
      env.DB.prepare('SELECT key, value FROM app_settings WHERE key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(settingKeys)),
      env.DB.prepare(
        "SELECT result, COUNT(*) AS n FROM pancake_events WHERE received_at >= datetime('now', '-7 days') GROUP BY result",
      ),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM pancake_events WHERE ${OPEN_SQL}`),
      env.DB.prepare('SELECT MAX(received_at) AS at FROM pancake_events'),
    ]);
    const s = new Map((settings.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const lastSec = Number(s.get('pancake.last_reconcile_at'));
    return ok({
      shop_id: s.get('pancake.shop_id') ?? null,
      warehouse_id: s.get('pancake.warehouse_id') ?? null,
      enabled: s.get('pancake.enabled') !== '0',
      has_api_key: Boolean(env.PANCAKE_API_KEY),
      has_webhook_secret: Boolean(env.PANCAKE_WEBHOOK_SECRET),
      last_reconcile_at: Number.isFinite(lastSec) && lastSec > 0 ? new Date(lastSec * 1000).toISOString() : null,
      reconcile_failures: Number(s.get('pancake.reconcile_failures') ?? 0),
      last_event_at: (last.results[0] as { at: string | null }).at,
      open_count: (open.results[0] as { n: number }).n,
      counts_7d: Object.fromEntries((counts.results as { result: string; n: number }[]).map((r) => [r.result, r.n])),
    });
  },
  ADMIN,
);

const settingsInput = z.object({
  enabled: z.boolean(),
  shop_id: z.string().trim().regex(/^\d{1,20}$/, 'Mã shop là dãy số.'),
  warehouse_id: z.string().trim().max(64),
});

route(
  'PUT',
  '/pancake/settings',
  async ({ env, req, user }) => {
    const input = await parseBody(req, settingsInput);
    const upsert = (key: string, value: string) =>
      env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
    await env.DB.batch([
      upsert('pancake.enabled', input.enabled ? '1' : '0'),
      upsert('pancake.shop_id', input.shop_id),
      upsert('pancake.warehouse_id', input.warehouse_id),
      auditStmt(env.DB, user.id, 'pancake.settings', 'app_settings', 'pancake', input),
    ]);
    return ok(input);
  },
  ADMIN,
);

const eventsQuery = pageQuerySchema.extend({
  result: z.enum(RESULTS).optional(),
  open: z.coerce.number().int().min(0).max(1).optional(),
});

route(
  'GET',
  '/pancake/events',
  async ({ env, url }) => {
    const q = parseQuery(url, eventsQuery);
    const where: string[] = [];
    const binds: unknown[] = [];
    if (q.open === 1) where.push(openSql('e.'));
    if (q.result) {
      where.push('e.result = ?');
      binds.push(q.result);
    }
    if (q.q) {
      where.push("(e.pancake_order_id LIKE ? OR json_extract(e.payload_json, '$.additional_info.booking_sn') LIKE ? OR o.order_code LIKE ?)");
      binds.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = 'FROM pancake_events e LEFT JOIN orders o ON o.id = e.order_id';
    const [items, total] = await env.DB.batch([
      env.DB.prepare(
        `SELECT e.id, e.pancake_order_id, e.status, e.result, e.message, e.order_id, o.order_code, e.via, e.received_at, e.resolved_at,
                json_extract(e.payload_json, '$.marketplace_id') AS marketplace_id,
                json_extract(e.payload_json, '$.additional_info.booking_sn') AS marketplace_order_id,
                COALESCE(json_extract(e.payload_json, '$.bill_full_name'), json_extract(e.payload_json, '$.shipping_address.full_name')) AS customer_name
         ${from} ${w} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      ).bind(...binds, q.page_size, (q.page - 1) * q.page_size),
      env.DB.prepare(`SELECT COUNT(*) AS n ${from} ${w}`).bind(...binds),
    ]);
    return ok({ items: items.results, total: (total.results[0] as { n: number }).n, page: q.page, page_size: q.page_size });
  },
  ADMIN,
);

route(
  'POST',
  '/pancake/events/:id/retry',
  async ({ env, params, user }) => {
    const id = eventId(params);
    const out = await reprocessPancakeEvent(env, id);
    await env.DB.batch([auditStmt(env.DB, user.id, 'pancake.retry', 'pancake_event', id, { result: out.result })]);
    return ok({ result: out.result, message: out.message, order_id: out.orderId ?? null });
  },
  ADMIN,
);

route(
  'POST',
  '/pancake/events/:id/resolve',
  async ({ env, params, user }) => {
    const id = eventId(params);
    const res = await env.DB.prepare("UPDATE pancake_events SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ? AND resolved_at IS NULL")
      .bind(user.id, id)
      .run();
    if (res.meta.changes === 0) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự kiện cần xử lý.');
    await env.DB.batch([auditStmt(env.DB, user.id, 'pancake.resolve', 'pancake_event', id)]);
    return ok({ id });
  },
  ADMIN,
);

/**
 * Mẫu mã trên Pancake chưa gán được SKU VKINNO (display_id không phải SKU và chưa có trong
 * channel_sku_map PANCAKE). Gọi API Pancake nên cần PANCAKE_API_KEY.
 */
route(
  'GET',
  '/pancake/unmapped',
  async ({ env }) => {
    if (!env.PANCAKE_API_KEY) return ok({ available: false, items: [] });
    const shopId = (await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'pancake.shop_id'").first<{ value: string }>())?.value;
    if (!shopId) return ok({ available: false, items: [] });
    const { items: variations, truncated } = await listVariations(env, shopId.trim()).catch((e: Error) => {
      throw new ApiError(502, 'PANCAKE_UNAVAILABLE', `Không lấy được mẫu mã từ Pancake: ${e.message}`);
    });
    const [skus, maps] = await env.DB.batch([
      env.DB.prepare('SELECT sku FROM products'),
      env.DB.prepare("SELECT external_sku, sku FROM channel_sku_map WHERE channel = 'PANCAKE'"),
    ]);
    const known = new Set((skus.results as { sku: string }[]).map((r) => r.sku));
    const mapped = new Set((maps.results as { external_sku: string }[]).map((r) => r.external_sku));
    const items = variations
      .map((v) => ({
        variation_id: String(v.id ?? ''),
        display_id: String(v.display_id ?? '').trim(),
        name: String(v.product?.name ?? v.name ?? '').trim(),
        detail: Array.isArray(v.fields) ? v.fields.map((f: { value?: string }) => f?.value).filter(Boolean).join(' / ') : '',
      }))
      .filter((v) => v.variation_id && !known.has(v.display_id) && !mapped.has(v.variation_id) && !mapped.has(v.display_id));
    return ok({ available: true, truncated, items });
  },
  ADMIN,
);
