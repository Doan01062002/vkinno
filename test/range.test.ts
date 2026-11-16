import { describe, expect, it } from 'vitest';
import { withByteRange } from '../worker/lib/range';

const body = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
const asset = () =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'video/mp4', ETag: '"abc"' } });
const req = (range?: string, method = 'GET') =>
  new Request('https://x/videos/a.mp4', { method, headers: range ? { Range: range } : {} });

describe('withByteRange (video cho Safari/iPhone)', () => {
  it('không có Range → 200 nguyên file, báo Accept-Ranges', async () => {
    const res = await withByteRange(req(), asset());
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('bytes=0-1 (Safari dò đầu tiên) → 206 đúng 2 byte, Content-Range', async () => {
    const res = await withByteRange(req('bytes=0-1'), asset());
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1/100');
    expect(res.headers.get('Content-Length')).toBe('2');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 1]);
  });

  it('bytes=90- (mở) và bytes=-5 (đuôi)', async () => {
    const open = await withByteRange(req('bytes=90-'), asset());
    expect(open.headers.get('Content-Range')).toBe('bytes 90-99/100');
    expect((await open.arrayBuffer()).byteLength).toBe(10);
    const tail = await withByteRange(req('bytes=-5'), asset());
    expect(tail.headers.get('Content-Range')).toBe('bytes 95-99/100');
  });

  it('end vượt kích thước → cắt về byte cuối', async () => {
    const res = await withByteRange(req('bytes=50-500'), asset());
    expect(res.headers.get('Content-Range')).toBe('bytes 50-99/100');
  });

  it('start ngoài phạm vi → 416', async () => {
    const res = await withByteRange(req('bytes=200-300'), asset());
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */100');
  });

  it('Range sai cú pháp hoặc nhiều đoạn → trả nguyên file 200', async () => {
    expect((await withByteRange(req('bytes=abc'), asset())).status).toBe(200);
    expect((await withByteRange(req('bytes=0-1,5-6'), asset())).status).toBe(200);
  });

  it('asset 404 → giữ nguyên 404', async () => {
    const res = await withByteRange(req('bytes=0-1'), new Response('nf', { status: 404 }));
    expect(res.status).toBe(404);
  });

  it('HEAD → không có thân, vẫn báo kích thước', async () => {
    const res = await withByteRange(req('bytes=0-9', 'HEAD'), asset());
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(res.body).toBeNull();
  });
});
