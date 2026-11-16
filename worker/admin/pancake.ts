// Đơn sàn về qua Pancake POS (Dự án 1b, spec 2026-11-16-pancake-da-kenh-design.md).
// Pancake gửi TOÀN BỘ đơn mỗi lần tạo/sửa. Mỗi lần nhận → một dòng pancake_events (khoá
// UNIQUE chống lặp), rồi tạo đơn qua createOrder hoặc đẩy tiến qua transitionOrder có sẵn,
// nên mọi quy tắc kho của Dự án 1 giữ nguyên. D1 VKINNO vẫn là kho gốc.
import { z } from 'zod';
import type { Env } from '../lib/env';
import { timingSafeCompare } from '../lib/crypto';
import { isUniqueError } from '../lib/db-errors';
import { ApiError } from '../lib/http';
import { sendTelegramAlert } from '../lib/notify';
import { createOrder, transitionOrder, type OrderStatus, type TransitionTarget } from './orders';

/** Pancake gửi cả đơn kèm dòng hàng; 512 KB dư cho đơn lớn nhất (spec mục 5). */
export const PANCAKE_MAX_BODY_BYTES = 512 * 1024;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

/** Đọc thân yêu cầu dạng chữ, dừng ngay khi vượt `limit` byte (kể cả khi không có Content-Length). */
async function readTextBounded(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get('Content-Length') || '0') > limit) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

// ---------------------------------------------------------------------------
// Payload (chỉ kiểm các trường cần dùng; phần còn lại cho qua — spec mục 14)
// ---------------------------------------------------------------------------

const money = z.coerce.number().int().catch(0);
const optText = z.string().nullish();

const itemSchema = z.object({
  variation_id: z.coerce.string().nullish(),
  quantity: z.coerce.number().int().positive(),
  discount_each_product: money.optional(),
  is_discount_percent: z.boolean().nullish(),
  is_bonus_product: z.boolean().nullish(),
  variation_info: z
    .object({ display_id: optText, name: optText, retail_price: money.optional() })
    .passthrough()
    .nullish(),
});

const orderSchema = z.object({
  id: z.coerce.number().int(),
  shop_id: z.coerce.number().int(),
  status: z.coerce.number().int(),
  updated_at: z.string().min(1),
  inserted_at: optText,
  marketplace_id: z.coerce.string().nullish(),
  is_from_ecommerce: z.boolean().nullish(),
  bill_full_name: optText,
  bill_phone_number: optText,
  shipping_address: z
    .object({ full_name: optText, phone_number: optText, full_address: optText })
    .passthrough()
    .nullish(),
  shipping_fee: money.optional(),
  total_discount: money.optional(),
  fee_marketplace: money.optional(),
  note: optText,
  additional_info: z.object({ booking_sn: optText }).passthrough().nullish(),
  items: z.array(itemSchema).default([]),
});
type PancakeOrder = z.infer<typeof orderSchema>;

/** marketplace_id của Pancake → kênh VKINNO. Lazada (-4) chưa có kênh trong bảng orders. */
const CHANNEL_BY_MARKETPLACE: Record<string, 'SHOPEE' | 'TIKTOK'> = { '-3': 'SHOPEE', '-9': 'TIKTOK' };
const MARKETPLACE_NAME: Record<string, string> = { '-3': 'Shopee', '-9': 'TikTok', '-4': 'Lazada', '-2': 'Tiki' };

// ---------------------------------------------------------------------------
// Ánh xạ trạng thái (spec mục 6)
// ---------------------------------------------------------------------------

type Target = 'PENDING' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED' | 'RETURN' | 'DELETED';

function targetOf(status: number): Target | null {
  if ([0, 17, 11, 20, 1, 12, 13, 8, 9].includes(status)) return 'PENDING';
  if (status === 2) return 'SHIPPING';
  if (status === 3 || status === 16) return 'COMPLETED';
  if (status === 6) return 'CANCELLED';
  if (status === 4 || status === 15 || status === 5) return 'RETURN';
  if (status === 7) return 'DELETED';
  return null;
}

const RANK: Record<string, number> = { PENDING: 0, PACKED: 1, SHIPPING: 2, COMPLETED: 3 };
/** Đường đi tiến từ trạng thái hiện tại tới đích, theo bảng chuyển của Dự án 1. */
const FORWARD: TransitionTarget[] = ['PACKED', 'SHIPPING', 'COMPLETED'];

// ---------------------------------------------------------------------------
// Xử lý một đơn
// ---------------------------------------------------------------------------

type Result = 'CREATED' | 'UPDATED' | 'SKIPPED' | 'NEEDS_MAPPING' | 'NEEDS_ATTENTION' | 'ERROR';
interface Outcome {
  result: Result;
  message: string;
  orderId?: number | null;
  alert?: string;
}

async function setting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

const isoToSql = (s: string | null | undefined) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(s ?? '');
  return m ? `${m[1]} ${m[2]}` : undefined;
};

/** Mã đơn gốc của sàn (`additional_info.booking_sn`, chưa có trong tài liệu) hoặc mã dự phòng. */
function externalIds(o: PancakeOrder): { primary: string; fallback: string } {
  const fallback = `PCK-${o.shop_id}-${o.id}`;
  const sn = o.additional_info?.booking_sn?.trim();
  return { primary: sn || fallback, fallback };
}

async function findOrder(db: D1Database, key: string, ids: { primary: string; fallback: string }) {
  const viaEvent = await db
    .prepare(
      `SELECT o.id, o.order_code, o.order_status FROM pancake_events e JOIN orders o ON o.id = e.order_id
       WHERE e.pancake_order_id = ? ORDER BY e.id DESC LIMIT 1`,
    )
    .bind(key)
    .first<{ id: number; order_code: string; order_status: OrderStatus }>();
  if (viaEvent) return viaEvent;
  return db
    .prepare('SELECT id, order_code, order_status FROM orders WHERE external_order_id IN (?, ?) ORDER BY id LIMIT 1')
    .bind(ids.primary, ids.fallback)
    .first<{ id: number; order_code: string; order_status: OrderStatus }>();
}

/** display_id = SKU VKINNO, hoặc channel_sku_map (PANCAKE) theo variation_id / display_id. */
async function resolveItems(db: D1Database, o: PancakeOrder) {
  const codes = o.items.flatMap((i) => [i.variation_info?.display_id ?? '', i.variation_id ?? '']).filter(Boolean);
  const list = JSON.stringify([...new Set(codes)]);
  const [direct, mapped] = await db.batch([
    db.prepare('SELECT sku FROM products WHERE sku IN (SELECT value FROM json_each(?))').bind(list),
    db
      .prepare("SELECT external_sku, sku FROM channel_sku_map WHERE channel = 'PANCAKE' AND external_sku IN (SELECT value FROM json_each(?))")
      .bind(list),
  ]);
  const skuOf = new Map<string, string>();
  for (const r of direct.results as { sku: string }[]) skuOf.set(r.sku, r.sku);
  const mapOf = new Map((mapped.results as { external_sku: string; sku: string }[]).map((r) => [r.external_sku, r.sku]));

  const lines: { sku: string; quantity: number; unit_price: number }[] = [];
  const missing: string[] = [];
  for (const it of o.items) {
    const display = it.variation_info?.display_id?.trim() ?? '';
    const vid = it.variation_id ?? '';
    const sku = mapOf.get(vid) ?? mapOf.get(display) ?? skuOf.get(display);
    if (!sku) {
      missing.push(`${display || '(không mã)'} [${vid}] ${it.variation_info?.name ?? ''}`.trim());
      continue;
    }
    const retail = it.variation_info?.retail_price ?? 0;
    const off = it.discount_each_product ?? 0;
    const each = it.is_bonus_product ? 0 : it.is_discount_percent ? Math.round((retail * (100 - off)) / 100) : retail - off;
    lines.push({ sku, quantity: it.quantity, unit_price: Math.max(0, each) });
  }
  return { lines, missing };
}

async function createFrom(env: Env, o: PancakeOrder, channel: 'SHOPEE' | 'TIKTOK', status: 'PENDING' | 'SHIPPING' | 'COMPLETED'): Promise<Outcome> {
  if (o.items.length === 0) return { result: 'SKIPPED', message: 'Đơn không có dòng hàng.' };
  const { lines, missing } = await resolveItems(env.DB, o);
  const ids = externalIds(o);
  if (missing.length > 0) {
    const message = `Mẫu mã chưa gán SKU: ${missing.join('; ')}`;
    return { result: 'NEEDS_MAPPING', message, alert: `Đơn ${channel} ${ids.primary} chưa vào kho VKINNO. ${message}` };
  }
  const sa = o.shipping_address;
  const name = (o.bill_full_name || sa?.full_name || '').trim() || `Khách ${channel === 'SHOPEE' ? 'Shopee' : 'TikTok'}`;
  const address = (sa?.full_address ?? '').trim();
  const notes = [
    `Pancake #${o.id} (${channel})`,
    o.total_discount ? `Giảm giá đơn trên Pancake: ${o.total_discount}đ` : '',
    o.fee_marketplace ? `Phí sàn: ${o.fee_marketplace}đ` : '',
    o.note?.trim() ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  try {
    const made = await createOrder(
      env,
      {
        channel,
        external_order_id: ids.primary,
        customer: { phone: (sa?.phone_number || o.bill_phone_number || '').slice(0, 30), name: name.slice(0, 200), address },
        shipping_address: address.slice(0, 500),
        notes: notes.slice(0, 2000),
        items: lines,
        shipping_fee_vnd: Math.max(0, o.shipping_fee ?? 0),
        payment_method: 'MARKETPLACE',
      },
      { source: 'IMPORT', userId: null, status, createdAt: isoToSql(o.inserted_at) },
    );
    return { result: 'CREATED', message: `Tạo đơn ${made.order_code} (${status})`, orderId: made.id };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'DUPLICATE_ORDER') {
      const existing = await findOrder(env.DB, '', ids);
      return { result: 'SKIPPED', message: 'Đơn đã có (nhập file trước đó).', orderId: existing?.id ?? null };
    }
    if (e instanceof ApiError) {
      return { result: 'ERROR', message: e.message, alert: `Đơn ${channel} ${ids.primary} không vào được kho VKINNO: ${e.message}` };
    }
    throw e;
  }
}

async function advance(env: Env, order: { id: number; order_code: string; order_status: OrderStatus }, target: Target, label: string): Promise<Outcome> {
  const cur = order.order_status;
  const base = { orderId: order.id };
  if (target === 'DELETED') return { ...base, result: 'SKIPPED', message: 'Pancake báo đơn đã xoá.' };
  if (target === 'RETURN') {
    return {
      ...base,
      result: 'NEEDS_ATTENTION',
      message: `Sàn báo ${label}: cần xử lý trả hàng (nhập lại hay ghi hỏng).`,
      alert: `Đơn ${order.order_code}: sàn báo ${label}. Vào quản trị để xử lý trả hàng.`,
    };
  }
  if (cur === 'CANCELLED' || cur === 'RETURNED') return { ...base, result: 'SKIPPED', message: `Đơn đã ${cur}.` };
  if (target === 'CANCELLED') {
    if (cur === 'PENDING' || cur === 'PACKED') {
      await transitionOrder(env, order.id, 'CANCELLED', { userId: null });
      return { ...base, result: 'UPDATED', message: `${cur} → CANCELLED` };
    }
    return {
      ...base,
      result: 'NEEDS_ATTENTION',
      message: `Sàn huỷ đơn nhưng VKINNO đang ${cur}: không tự đổi kho.`,
      alert: `Đơn ${order.order_code} bị huỷ trên sàn nhưng đã ${cur} trong VKINNO. Vui lòng kiểm tra.`,
    };
  }
  if (RANK[target] <= RANK[cur]) return { ...base, result: 'SKIPPED', message: `Không lùi ${cur} → ${target}.` };
  const steps = FORWARD.filter((s) => RANK[s] > RANK[cur] && RANK[s] <= RANK[target]);
  for (const s of steps) await transitionOrder(env, order.id, s, { userId: null });
  return { ...base, result: 'UPDATED', message: `${cur} → ${steps.join(' → ')}` };
}

async function processOrder(env: Env, o: PancakeOrder, key: string): Promise<Outcome> {
  const shopId = await setting(env.DB, 'pancake.shop_id');
  if (!shopId) return { result: 'SKIPPED', message: 'Chưa cấu hình pancake.shop_id.' };
  if (String(o.shop_id) !== shopId.trim()) return { result: 'SKIPPED', message: `Shop ${o.shop_id} không phải shop đã cấu hình.` };
  const mk = o.marketplace_id ?? null;
  if (mk === null || mk === '' || mk === 'null') return { result: 'SKIPPED', message: 'Không phải đơn sàn (tạo tay/mạng xã hội).' };
  const channel = CHANNEL_BY_MARKETPLACE[mk];
  if (!channel) return { result: 'SKIPPED', message: `Sàn ${MARKETPLACE_NAME[mk] ?? mk} chưa hỗ trợ.` };
  const target = targetOf(o.status);
  if (!target) return { result: 'SKIPPED', message: `Trạng thái Pancake ${o.status} không rõ.` };

  const ids = externalIds(o);
  const existing = await findOrder(env.DB, key, ids);
  if (!existing) {
    if (target === 'PENDING' || target === 'SHIPPING' || target === 'COMPLETED') return createFrom(env, o, channel, target);
    return { result: 'SKIPPED', message: `Lần đầu thấy đơn ở trạng thái ${o.status}: không tạo.` };
  }
  try {
    return await advance(env, existing, target, `trạng thái ${o.status}`);
  } catch (e) {
    if (e instanceof ApiError) {
      return {
        result: 'ERROR',
        message: e.message,
        orderId: existing.id,
        alert: `Không cập nhật được đơn ${existing.order_code} theo Pancake: ${e.message}`,
      };
    }
    throw e;
  }
}

/**
 * Ghi sự kiện (chống lặp) rồi xử lý. Trả `null` khi sự kiện đã nhận trước đó.
 * Dùng chung cho webhook và đối soát (bước 3).
 */
export async function handlePancakeOrder(
  env: Env,
  raw: unknown,
  rawText: string,
  via: 'WEBHOOK' | 'RECONCILE',
  ctx?: ExecutionContext,
): Promise<Outcome | null> {
  const parsed = orderSchema.safeParse(raw);
  const r = raw as Record<string, unknown> | null;
  const key = parsed.success
    ? `${parsed.data.shop_id}-${parsed.data.id}`
    : `?-${String((r && typeof r === 'object' && r.id) ?? 'unknown')}`;
  const status = parsed.success ? parsed.data.status : -1;
  const updatedAt = parsed.success ? parsed.data.updated_at : new Date().toISOString();

  let eventId: number;
  try {
    const res = await env.DB.prepare(
      'INSERT INTO pancake_events (pancake_order_id, status, updated_at, payload_json, via) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(key, status, updatedAt, rawText, via)
      .run();
    eventId = Number(res.meta.last_row_id);
  } catch (e) {
    if (isUniqueError(e, 'pancake_events.pancake_order_id')) return null;
    throw e;
  }

  let out: Outcome;
  if (!parsed.success) {
    out = { result: 'ERROR', message: `Payload sai cấu trúc: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  } else {
    try {
      out = await processOrder(env, parsed.data, key);
    } catch (e) {
      console.error('Xử lý đơn Pancake lỗi', e);
      out = { result: 'ERROR', message: 'Lỗi hệ thống khi xử lý đơn.', alert: `Lỗi hệ thống khi xử lý đơn Pancake ${key}.` };
    }
  }
  await env.DB.prepare('UPDATE pancake_events SET result = ?, message = ?, order_id = ? WHERE id = ?')
    .bind(out.result, out.message.slice(0, 1000), out.orderId ?? null, eventId)
    .run();
  if (out.alert) {
    const p = sendTelegramAlert(env, out.alert).then((sent) => {
      if (!sent) console.warn('Không gửi được cảnh báo Telegram cho đơn Pancake', key);
    });
    if (ctx) ctx.waitUntil(p);
    else await p;
  }
  return out;
}

/**
 * POST /api/webhook/pancake: kiểm header `X-VK-Key`, rồi xử lý đơn. Luôn trả 200 khi đã ghi
 * được sự kiện (kể cả xử lý lỗi) để Pancake không gửi lại vô hạn; 401 sai khoá, 400 JSON hỏng,
 * 503 khi chưa nạp khoá hoặc `pancake.enabled = 0`.
 */
export async function handlePancakeWebhook(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  if (!env.PANCAKE_WEBHOOK_SECRET) return json({ success: false, error: 'Webhook secret not configured' }, 503);
  const key = request.headers.get('X-VK-Key') || '';
  if (!(await timingSafeCompare(key, env.PANCAKE_WEBHOOK_SECRET))) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }
  if ((await setting(env.DB, 'pancake.enabled')) === '0') return json({ success: false, error: 'Disabled' }, 503);
  const body = await readTextBounded(request, PANCAKE_MAX_BODY_BYTES);
  if (body === null) return json({ success: false, error: 'Payload too large' }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const out = await handlePancakeOrder(env, payload, body, 'WEBHOOK', ctx);
  return json({ success: true, result: out?.result ?? 'DUPLICATE' });
}
