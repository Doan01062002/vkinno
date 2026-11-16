// Đối soát đơn (bước 3) và đẩy tồn (bước 4) với Pancake POS. Chạy theo cron 15 phút và từ nút
// "Đồng bộ ngay" (POST /api/admin/pancake/sync). D1 VKINNO là kho gốc: chỉ đẩy SỐ lên Pancake.
import type { Env } from '../lib/env';
import { ok } from '../lib/http';
import { sendTelegramAlert } from '../lib/notify';
import { PancakeApiError, listOrdersUpdated, listVariations, updateSellable } from '../lib/pancake-client';
import { availability } from './inventory';
import { handlePancakeOrder } from './pancake';
import { route } from './router';

/** Lùi 5 phút so với mốc lần trước để không lọt đơn cập nhật sát mốc (spec mục 10). */
const OVERLAP_SEC = 300;
/** Lần chạy đầu (chưa có mốc): kéo 1 giờ gần nhất. */
const FIRST_WINDOW_SEC = 3600;
const ALERT_AFTER_FAILURES = 3;
const PUSH_CHUNK = 100;

interface ReconcileResult {
  fetched?: number;
  created?: number;
  updated?: number;
  problems?: number;
  truncated?: boolean;
  error?: string;
}
interface StockResult {
  pushed?: number;
  unchanged?: number;
  unmapped?: number;
  skipped?: string;
  error?: string;
}
export interface SyncResult {
  skipped?: string;
  reconcile?: ReconcileResult;
  stock?: StockResult;
}

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
const setSetting = (db: D1Database, key: string, value: string) =>
  db
    .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();

async function reconcile(env: Env, shopId: string): Promise<ReconcileResult> {
  const now = Math.floor(Date.now() / 1000);
  const last = Number(await getSetting(env.DB, 'pancake.last_reconcile_at'));
  const start = (Number.isFinite(last) && last > 0 ? last : now - FIRST_WINDOW_SEC + OVERLAP_SEC) - OVERLAP_SEC;
  try {
    const { items, truncated } = await listOrdersUpdated(env, shopId, start, now);
    const out: ReconcileResult = { fetched: items.length, created: 0, updated: 0, problems: 0, truncated };
    for (const o of items) {
      const r = await handlePancakeOrder(env, o, JSON.stringify(o), 'RECONCILE');
      if (!r) continue;
      if (r.result === 'CREATED') out.created!++;
      else if (r.result === 'UPDATED') out.updated!++;
      else if (r.result !== 'SKIPPED') out.problems!++;
    }
    // Bị cắt trang: không dời mốc để lần sau kéo tiếp (khoá chống lặp giữ an toàn).
    if (!truncated) await setSetting(env.DB, 'pancake.last_reconcile_at', String(now));
    await setSetting(env.DB, 'pancake.reconcile_failures', '0');
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Đối soát Pancake lỗi', message);
    const failures = Number((await getSetting(env.DB, 'pancake.reconcile_failures')) ?? 0) + 1;
    await setSetting(env.DB, 'pancake.reconcile_failures', String(failures));
    if (failures === ALERT_AFTER_FAILURES) {
      const sent = await sendTelegramAlert(env, `Đối soát đơn Pancake lỗi ${failures} lần liên tiếp: ${message}`);
      if (!sent) console.warn('Không gửi được cảnh báo Telegram đối soát Pancake');
    }
    return { error: message };
  }
}

async function pushStock(env: Env, shopId: string): Promise<StockResult> {
  const warehouseId = (await getSetting(env.DB, 'pancake.warehouse_id'))?.trim();
  if (!warehouseId) return { skipped: 'Chưa cấu hình pancake.warehouse_id.' };
  try {
    const { items: variations } = await listVariations(env, shopId);
    const mapRows = (
      await env.DB.prepare("SELECT external_sku, sku FROM channel_sku_map WHERE channel = 'PANCAKE'").all<{ external_sku: string; sku: string }>()
    ).results;
    const mapped = new Map(mapRows.map((r) => [r.external_sku, r.sku]));
    const avail = await availability(env.DB);

    const wanted: { variation_id: string; sku: string; qty: number }[] = [];
    let unmapped = 0;
    for (const v of variations) {
      const id = String(v.id ?? '');
      const display = String(v.display_id ?? '').trim();
      const sku = mapped.get(id) ?? mapped.get(display) ?? (avail.has(display) ? display : undefined);
      const a = sku ? avail.get(sku) : undefined;
      if (!id || !sku || !a) {
        unmapped++;
        continue;
      }
      wanted.push({ variation_id: id, sku, qty: Math.max(0, a.available) });
    }

    const prev = new Map(
      (await env.DB.prepare('SELECT variation_id, last_qty FROM pancake_stock_push').all<{ variation_id: string; last_qty: number }>()).results.map(
        (r) => [r.variation_id, r.last_qty],
      ),
    );
    const changed = wanted.filter((w) => prev.get(w.variation_id) !== w.qty);
    let pushed = 0;
    for (let i = 0; i < changed.length; i += PUSH_CHUNK) {
      const chunk = changed.slice(i, i + PUSH_CHUNK);
      await updateSellable(
        env,
        shopId,
        chunk.map((c) => ({ variation_id: c.variation_id, remain_quantity: c.qty, warehouse_id: warehouseId })),
      );
      // Chỉ ghi nhận sau khi Pancake nhận: lỗi giữa chừng → phần chưa gửi sẽ gửi lại lần sau.
      await env.DB.batch(
        chunk.map((c) =>
          env.DB
            .prepare(
              `INSERT INTO pancake_stock_push (variation_id, sku, last_qty, pushed_at) VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(variation_id) DO UPDATE SET sku = excluded.sku, last_qty = excluded.last_qty, pushed_at = excluded.pushed_at`,
            )
            .bind(c.variation_id, c.sku, c.qty),
        ),
      );
      pushed += chunk.length;
    }
    return { pushed, unchanged: wanted.length - changed.length, unmapped };
  } catch (e) {
    const message = e instanceof PancakeApiError || e instanceof Error ? e.message : String(e);
    console.error('Đẩy tồn Pancake lỗi', message);
    return { error: message };
  }
}

/** Đối soát rồi đẩy tồn. Bỏ qua khi chưa có khoá API, chưa cấu hình shop, hoặc đã tắt. */
export async function runPancakeSync(env: Env): Promise<SyncResult> {
  if (!env.PANCAKE_API_KEY) return { skipped: 'Chưa nạp PANCAKE_API_KEY.' };
  if ((await getSetting(env.DB, 'pancake.enabled')) === '0') return { skipped: 'Đã tắt (pancake.enabled = 0).' };
  const shopId = (await getSetting(env.DB, 'pancake.shop_id'))?.trim();
  if (!shopId) return { skipped: 'Chưa cấu hình pancake.shop_id.' };
  const reconcileResult = await reconcile(env, shopId);
  const stock = await pushStock(env, shopId);
  return { reconcile: reconcileResult, stock };
}

route('POST', '/pancake/sync', async ({ env }) => ok(await runPancakeSync(env)), { role: 'ADMIN' });
