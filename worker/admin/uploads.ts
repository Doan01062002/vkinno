import { ApiError, ok } from '../lib/http';
import { auditStmt } from './audit';
import { route } from './router';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Phần dư cho phần đầu/biên của multipart khi kiểm tra Content-Length sớm. */
const MULTIPART_OVERHEAD = 64 * 1024;

const KINDS = [
  { type: 'image/jpeg', ext: 'jpg' },
  { type: 'image/png', ext: 'png' },
  { type: 'image/webp', ext: 'webp' },
];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Nhận dạng định dạng theo magic bytes, không tin Content-Type do client khai. */
function sniff(b: Uint8Array): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

const unsupported = () => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
const tooLarge = () => new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Ảnh vượt quá 5 MB.');

/** Đọc thân yêu cầu qua bộ đếm byte; vượt giới hạn thì huỷ luồng và trả 413 (kể cả khi không có Content-Length). */
async function readBounded(req: Request, limit: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

route('POST', '/uploads/image', async ({ env, req, user }) => {
  if (Number(req.headers.get('Content-Length') || '0') > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD) throw tooLarge();
  let form: FormData;
  try {
    const bytes = await readBounded(req, MAX_IMAGE_BYTES + MULTIPART_OVERHEAD);
    form = await new Response(bytes, {
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    }).formData();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'BAD_REQUEST', 'Cần gửi multipart/form-data với trường "file".');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    throw new ApiError(400, 'BAD_REQUEST', 'Thiếu tệp ảnh trong trường "file".');
  }
  if (file.size > MAX_IMAGE_BYTES) throw tooLarge();
  const kind = KINDS.find((k) => k.type === file.type.toLowerCase());
  if (!kind) throw unsupported();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniff(bytes) !== kind.type) throw unsupported();

  const key = `products/${crypto.randomUUID()}.${kind.ext}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  await env.DB.batch([
    auditStmt(env.DB, user.id, 'upload.image', 'file', key, { size: bytes.byteLength, type: kind.type }),
  ]);
  return ok({ key, url: `/files/${key}` });
});

/** Phục vụ công khai ảnh sản phẩm; chỉ khoá `products/` (cùng bucket còn có backups/). */
export async function serveFile(env: { FILES: R2Bucket }, rawKey: string, method: string): Promise<Response> {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (key.includes('..') || !/^products\/[A-Za-z0-9._-]+$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.FILES.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
