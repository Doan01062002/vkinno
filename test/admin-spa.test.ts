import { describe, expect, it } from 'vitest';
import { callWorker, makeEnv } from './helpers';

const INDEX_HTML = '<!doctype html><title>Quản trị</title><div id="admin-root"></div>';

/** ASSETS giả: `/quan-tri/` trả trang SPA, `/quan-tri/*.js` trả JS, còn lại 404; ghi lại URL được hỏi. */
function stubAssets() {
  const seen: string[] = [];
  const fetcher = {
    fetch: async (input: Request | string) => {
      const req = typeof input === 'string' ? new Request(input) : input;
      const url = new URL(req.url);
      seen.push(url.pathname);
      if (url.pathname === '/quan-tri/') {
        return new Response(INDEX_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (url.pathname.endsWith('.js')) {
        return new Response('console.log(1)', { headers: { 'Content-Type': 'text/javascript' } });
      }
      return new Response('Not found', { status: 404 });
    },
  };
  return { fetcher: fetcher as unknown as Fetcher, seen };
}

describe('SPA /quan-tri', () => {
  it('đường dẫn sâu trả trang /quan-tri/ kèm noindex và no-store', async () => {
    const { fetcher, seen } = stubAssets();
    const env = await makeEnv({ ASSETS: fetcher });
    const res = await callWorker(new Request('https://test.local/quan-tri/don-hang/123'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX_HTML);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(seen).toEqual(['/quan-tri/']);
  });

  it('/quan-tri (không gạch chéo) và HEAD cũng trả trang SPA', async () => {
    const { fetcher, seen } = stubAssets();
    const env = await makeEnv({ ASSETS: fetcher });
    const res = await callWorker(new Request('https://test.local/quan-tri'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX_HTML);
    const head = await callWorker(new Request('https://test.local/quan-tri/dang-nhap', { method: 'HEAD' }), env);
    expect(head.status).toBe(200);
    expect(head.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(seen).toEqual(['/quan-tri/', '/quan-tri/']);
  });

  it('tệp có phần mở rộng đi thẳng tới ASSETS nhưng vẫn có header quản trị', async () => {
    const { fetcher, seen } = stubAssets();
    const env = await makeEnv({ ASSETS: fetcher });
    const res = await callWorker(new Request('https://test.local/quan-tri/app.js'), env);
    expect(await res.text()).toBe('console.log(1)');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(seen).toEqual(['/quan-tri/app.js']);
  });

  it('trang công khai không bị gắn header quản trị', async () => {
    const { fetcher } = stubAssets();
    const env = await makeEnv({ ASSETS: fetcher });
    const res = await callWorker(new Request('https://test.local/quan-tri-khac'), env);
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
  });
});
