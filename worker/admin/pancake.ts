import type { Env } from '../lib/env';
import { timingSafeCompare } from '../lib/crypto';

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

/**
 * POST /api/webhook/pancake — bước 0b: xác thực header `X-VK-Key` rồi lưu nguyên văn vào
 * `pancake_inbox`. Chưa tạo đơn; phần ánh xạ viết sau khi đã thấy payload thật.
 */
export async function handlePancakeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  if (!env.PANCAKE_WEBHOOK_SECRET) return json({ success: false, error: 'Webhook secret not configured' }, 503);
  const key = request.headers.get('X-VK-Key') || '';
  if (!(await timingSafeCompare(key, env.PANCAKE_WEBHOOK_SECRET))) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }
  const body = await readTextBounded(request, PANCAKE_MAX_BODY_BYTES);
  if (body === null) return json({ success: false, error: 'Payload too large' }, 413);
  await env.DB.prepare('INSERT INTO pancake_inbox (content_type, body) VALUES (?, ?)')
    .bind((request.headers.get('Content-Type') || '').slice(0, 200), body)
    .run();
  return json({ success: true });
}
