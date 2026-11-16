// Trả từng đoạn file (HTTP Range, 206) cho video trong public/videos/. Workers Static Assets
// luôn trả 200 nguyên file, mà Safari/iPhone cần 206 mới phát được <video>.
// Chỉ hỗ trợ một đoạn (bytes=a-b | a- | -n); cú pháp lạ hoặc nhiều đoạn → trả nguyên file.

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

export async function withByteRange(request: Request, asset: Response): Promise<Response> {
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=604800');
  const isHead = request.method.toUpperCase() === 'HEAD';
  const range = request.headers.get('Range');
  const m = range ? RANGE_RE.exec(range.trim()) : null;

  const buf = await asset.arrayBuffer();
  const size = buf.byteLength;
  if (!m || (m[1] === '' && m[2] === '')) {
    headers.set('Content-Length', String(size));
    return new Response(isHead ? null : buf, { status: 200, headers });
  }

  let start: number;
  let end: number;
  if (m[1] === '') {
    // bytes=-n: n byte cuối
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('Content-Length');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(isHead ? null : buf.slice(start, end + 1), { status: 206, headers });
}
