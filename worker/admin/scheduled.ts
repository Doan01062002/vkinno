import type { Env } from '../lib/env';
import { sendTelegramAlert } from '../lib/notify';
import { inventoryAlerts } from './products';

const BACKUP_PREFIX = 'backups/';
const BACKUP_KEEP_DAYS = 90;
const DAY_MS = 86400000;
const KEY_RE = /^backups\/(\d{4}-\d{2}-\d{2})\.json\.gz$/;

/** Ngày hiện tại theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
function vnToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Xoá các bản `backups/` cũ hơn 90 ngày (bản đúng 90 ngày tuổi còn giữ). Trả số khoá đã xoá. */
export async function pruneBackups(env: Env, now = Date.now()): Promise<number> {
  const cutoff = Date.parse(`${vnToday(now)}T00:00:00Z`) - BACKUP_KEEP_DAYS * DAY_MS;
  const stale: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.FILES.list({ prefix: BACKUP_PREFIX, cursor });
    for (const obj of page.objects) {
      const m = KEY_RE.exec(obj.key);
      if (m && Date.parse(`${m[1]}T00:00:00Z`) < cutoff) stale.push(obj.key);
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  for (let i = 0; i < stale.length; i += 1000) await env.FILES.delete(stale.slice(i, i + 1000));
  return stale.length;
}

/** Sao lưu mọi bảng D1 thành JSON nén gzip vào R2 `backups/YYYY-MM-DD.json.gz`, rồi dọn bản cũ. */
export async function runBackup(env: Env): Promise<{ key: string; bytes: number }> {
  const names = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) <> '_cf_' ORDER BY name",
  ).all<{ name: string }>();
  const tables = names.results.map((r) => r.name);
  const results = tables.length
    ? await env.DB.batch(tables.map((t) => env.DB.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`)))
    : [];
  const data: Record<string, unknown[]> = {};
  tables.forEach((t, i) => {
    data[t] = results[i].results;
  });
  const body = await gzip(JSON.stringify({ created_at: new Date().toISOString(), tables: data }));
  const key = `${BACKUP_PREFIX}${vnToday()}.json.gz`;
  await env.FILES.put(key, body, { httpMetadata: { contentType: 'application/gzip' } });
  try {
    await pruneBackups(env);
  } catch (e) {
    console.error('Dọn bản sao lưu cũ thất bại', e);
  }
  return { key, bytes: body.byteLength };
}

async function telegramEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'telegram.enabled'").first<{
    value: string;
  }>();
  return row?.value === 'true';
}

const TELEGRAM_CHUNK_MAX = 3900;

/** Gộp các dòng thành các tin ≤ max ký tự, chỉ ngắt giữa các dòng (dòng quá dài bị cắt). */
export function chunkLines(lines: string[], max = TELEGRAM_CHUNK_MAX): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
    if (cur && cur.length + 1 + line.length > max) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

interface ExpiringLot {
  name: string;
  sku: string;
  batch_code: string;
  expiry_date: string;
  qty: number;
}

async function sendInventoryAlerts(env: Env): Promise<void> {
  if (!(await telegramEnabled(env))) return;
  const { low_stock, expiring } = await inventoryAlerts(env.DB);
  if (low_stock.length === 0 && expiring.length === 0) return;
  const lines: string[] = ['Cảnh báo kho VKINNO'];
  if (low_stock.length > 0) {
    lines.push('', `Tồn thấp (${low_stock.length}):`);
    for (const r of low_stock) lines.push(`- ${r.name} (${r.sku}): còn ${r.available}, tối thiểu ${r.min_stock}`);
  }
  if (expiring.length > 0) {
    lines.push('', `Lô sắp hết hạn (${expiring.length}):`);
    for (const e of expiring as unknown as ExpiringLot[]) {
      lines.push(`- ${e.name} (${e.sku}) lô ${e.batch_code || '-'}: ${e.qty} hết hạn ${e.expiry_date}`);
    }
  }
  let failed = 0;
  for (const chunk of chunkLines(lines)) {
    if (!(await sendTelegramAlert(env, chunk))) failed++;
  }
  if (failed > 0) console.error(`Gửi cảnh báo tồn kho: ${failed} tin Telegram thất bại`);
}

/** Bản sao lưu mới nhất (`backups/YYYY-MM-DD.json.gz`, ngày lớn nhất) hoặc null khi chưa có. */
export async function latestBackup(env: Env): Promise<{ key: string; uploaded: string; size: number } | null> {
  let best: R2Object | null = null;
  let cursor: string | undefined;
  for (;;) {
    const page = await env.FILES.list({ prefix: BACKUP_PREFIX, cursor });
    for (const obj of page.objects) {
      if (KEY_RE.test(obj.key) && (!best || obj.key > best.key)) best = obj;
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return best ? { key: best.key, uploaded: new Date(best.uploaded).toISOString(), size: best.size } : null;
}

/**
 * Bản sao lưu của ngày hôm qua (giờ VN) phải có trong R2; thiếu (vd. Worker bị dừng giữa chừng vì
 * quá CPU, không kịp báo lỗi) → báo Telegram. Cài mới chưa có bản nào thì bỏ qua.
 */
async function checkYesterdayBackup(env: Env, now = Date.now()): Promise<void> {
  const any = await env.FILES.list({ prefix: BACKUP_PREFIX, limit: 1 });
  if (any.objects.length === 0) return;
  const day = vnToday(now - DAY_MS);
  const key = `${BACKUP_PREFIX}${day}.json.gz`;
  if (await env.FILES.head(key)) return;
  const [y, m, d] = day.split('-');
  const sentOk = await sendTelegramAlert(
    env,
    `Không thấy bản sao lưu ngày ${d}/${m}/${y} (${key}). Vui lòng kiểm tra nhật ký Worker và bấm "Sao lưu ngay" trong Cài đặt.`,
  );
  if (!sentOk) console.error(`Thiếu bản sao lưu ${key}; không gửi được tin Telegram`);
}

/**
 * Tác vụ hằng ngày; mỗi bước độc lập, một bước lỗi không chặn các bước còn lại. Sao lưu chạy CUỐI:
 * nếu nó làm Worker vượt giới hạn CPU, dọn dẹp và cảnh báo (gồm kiểm tra bản hôm qua) đã xong.
 */
export async function runDaily(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "DELETE FROM login_attempts WHERE (CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', window_start) AS INTEGER)) >= 900",
    ).run();
  } catch (e) {
    console.error('Dọn login_attempts thất bại', e);
  }
  try {
    await sendInventoryAlerts(env);
  } catch (e) {
    console.error('Gửi cảnh báo tồn kho thất bại', e);
  }
  try {
    await checkYesterdayBackup(env);
  } catch (e) {
    console.error('Kiểm tra bản sao lưu hôm qua thất bại', e);
  }
  try {
    await runBackup(env);
  } catch (e) {
    console.error('Sao lưu hằng ngày thất bại', e);
    const sentOk = await sendTelegramAlert(env, 'Sao lưu D1 hằng ngày THẤT BẠI. Vui lòng kiểm tra nhật ký Worker.');
    if (!sentOk) console.error('Không gửi được tin báo lỗi sao lưu qua Telegram');
  }
}
