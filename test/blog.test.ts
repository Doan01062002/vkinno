import { afterEach, describe, expect, it, vi } from 'vitest';
import { products } from '../src/data/products';
import { runBlogDaily, runBlogGeneration } from '../worker/blog/generate';
import { addHeadingIds, countWords, labelTableCells, sanitizeArticleHtml, slugify } from '../worker/blog/html';
import { checkQuality } from '../worker/blog/quality';
import { fillShell, renderRobots } from '../worker/blog/render';
import { api, callWorker, createUser, makeEnv } from './helpers';
import type { Env } from '../worker/index';

const SHELL =
  '<!doctype html><html><head><link rel="canonical" href="https://vkinno.vn/__VK_CANONICAL__" />' +
  '<title>__VK_TITLE__VKINNO</title><meta property="og:title" content="__VK_TITLE__VKINNO" />' +
  '<meta name="description" content="__VK_DESC__" /><meta name="robots" content="index, follow" />' +
  '<meta property="og:image" content="https://vkinno.vn/__VK_IMAGE__" />' +
  '<script type="application/ld+json">"__VK_SCHEMA__"</script></head><body><main><!--__VK_BODY__--></main></body></html>';

const SEED_SLUG = 'huong-dan-ve-sinh-pin-mat-troi-tang-hieu-suat-phat-dien';
const PRODUCT = products.find((p) => p.sku === 'VK-VISIONX-CLEAN-500ML')!;

function assets(): Fetcher {
  return {
    fetch: async (input: Request | string) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname.startsWith('/vk-khung/')) return new Response(SHELL, { headers: { 'Content-Type': 'text/html' } });
      return new Response('TRANG-404', { status: 404, headers: { 'Content-Type': 'text/html' } });
    },
  } as unknown as Fetcher;
}

async function blogEnv(overrides: Partial<Env> = {}): Promise<Env> {
  return makeEnv({ ASSETS: assets(), ...overrides });
}

const get = (env: Env, path: string, host = 'vkinno.vn', headers: Record<string, string> = {}) =>
  callWorker(new Request(`https://${host}${path}`, { headers }), env);

function schemaOf(html: string): Record<string, unknown>[] {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m![1]);
}

/** Bài mẫu Gemini trả về: đủ dài, 4 H2, có link sản phẩm thật. */
function article(overrides: Record<string, unknown> = {}) {
  const para = '<p>Bạn nên lau kính lái bằng khăn microfiber sạch, làm từng vùng nhỏ và kiểm tra lại dưới ánh đèn để chắc chắn không còn vệt dầu bám trên bề mặt.</p>';
  const section = (h: string) => `<h2>${h}</h2>${para.repeat(12)}`;
  return {
    title: 'Tẩy màng dầu kính lái ô tô tại nhà an toàn',
    seo_title: 'Tẩy màng dầu kính lái ô tô tại nhà',
    slug: 'tay-mang-dau-kinh-lai-o-to',
    meta_description:
      'Cách tẩy màng dầu kính lái ô tô tại nhà: nhận biết màng dầu, chuẩn bị dụng cụ, quy trình từng bước và lỗi thường gặp. Xem hướng dẫn chi tiết.',
    summary: 'Màng dầu làm kính lái lóa khi mưa đêm. Đây là cách nhận biết và tẩy sạch an toàn tại nhà.',
    primary_keyword: 'tẩy màng dầu kính lái ô tô',
    secondary_keywords: ['màng dầu kính ô tô'],
    content_html:
      `${para}${section('Màng dầu kính lái là gì')}${section('Chuẩn bị dụng cụ')}${section('Quy trình từng bước')}` +
      `<h2>Khi nào dùng sản phẩm chuyên dụng</h2><p>Bạn có thể dùng <a href="/san-pham/${PRODUCT.slug}">VisionX Clean</a> theo hướng dẫn của nhà sản xuất.</p>` +
      `<p>Xem nguồn <a href="https://example.com/bia">ở đây</a>.</p><script>alert(1)</script>`,
    faq: [
      { q: 'Màng dầu kính lái do đâu?', a: 'Do khói xe, sáp rửa xe và bụi dầu bám lâu ngày.' },
      { q: 'Có dùng kem đánh răng được không?', a: 'Không nên vì có hạt mài dễ làm xước kính.' },
      { q: 'Bao lâu nên tẩy một lần?', a: 'Khi thấy kính lóa lúc mưa đêm hoặc gạt mưa để lại vệt.' },
    ],
    image_alt: 'Tẩy màng dầu kính lái ô tô',
    related_skus: ['VK-VISIONX-CLEAN-500ML', 'KHONG-CO'],
    ...overrides,
  };
}

function geminiOk(body: unknown, finishReason = 'STOP') {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason }],
      usageMetadata: { promptTokenCount: 9000, candidatesTokenCount: 5000, thoughtsTokenCount: 800 },
      modelVersion: 'gemini-3.8-flash',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

/** Stub fetch: Gemini theo `handler`, Telegram ghi lại tin. */
function stubFetch(handler: (body: Record<string, unknown>) => Response) {
  const telegram: string[] = [];
  const gemini: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.telegram.org')) {
      telegram.push(JSON.parse(String(init?.body)).text);
      return new Response('{}');
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(String(init?.body));
      gemini.push({ url, body, key: new Headers(init?.headers).get('x-goog-api-key') });
      return handler(body);
    }
    throw new Error(`fetch ngoài dự kiến: ${url}`);
  });
  return { telegram, gemini };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lọc HTML bài viết', () => {
  it('bỏ script/thuộc tính lạ, đổi b→strong, link ngoài có nofollow, bỏ javascript:', () => {
    const out = sanitizeArticleHtml(
      '<h1 class="x">Tiêu đề</h1><p style="color:red" onclick="x()">Chữ <b>đậm</b><br>xuống</p>' +
        '<script>alert(1)</script><a href="javascript:alert(1)">xấu</a><a href="https://vkinno.vn/san-pham/a">nội</a>' +
        '<a href="https://example.com">ngoài</a><img src=x onerror=alert(1)><p>chưa đóng',
    );
    expect(out).toBe(
      '<h2>Tiêu đề</h2><p>Chữ <strong>đậm</strong> xuống</p>xấu<a href="/san-pham/a">nội</a>' +
        '<a href="https://example.com/" rel="nofollow noopener" target="_blank">ngoài</a><p>chưa đóng</p>',
    );
  });

  it('escape ký tự < > lẻ trong văn bản', () => {
    expect(sanitizeArticleHtml('<p>pH < 7 & > 5</p>')).toBe('<p>pH &lt; 7 &amp; &gt; 5</p>');
  });

  it('đếm chữ, slug không dấu, id cho H2, nhãn cột bảng', () => {
    expect(countWords('<p>Tẩy cặn <strong>canxi</strong></p>')).toBe(3);
    expect(slugify('Tẩy cặn canxi Đồng hồ!')).toBe('tay-can-canxi-dong-ho');
    const { html, toc } = addHeadingIds('<h2>Bước 1</h2><h2>Bước 1</h2>');
    expect(toc.map((t) => t.id)).toEqual(['buoc-1', 'buoc-1-2']);
    expect(html).toContain('<h2 id="buoc-1-2">');
    expect(labelTableCells('<table><thead><tr><th>Cách</th><th>Rủi ro</th></tr></thead><tbody><tr><td>Giấm</td><td>Mùi</td></tr></tbody></table>')).toBe(
      '<table class="vk-table"><thead><tr><th>Cách</th><th>Rủi ro</th></tr></thead><tbody><tr><td data-label="Cách">Giấm</td><td data-label="Rủi ro">Mùi</td></tr></tbody></table>',
    );
  });
});

describe('kiểm chất lượng', () => {
  it('bài đạt không có lỗi chặn; cụm từ tuyệt đối bị chặn', () => {
    const a = article();
    const ok = checkQuality({ ...a, content_html: sanitizeArticleHtml(a.content_html) });
    expect(ok.blocking).toEqual([]);
    expect(ok.wordCount).toBeGreaterThanOrEqual(900);
    const bad = checkQuality({ ...a, content_html: '<p>Sản phẩm tốt nhất, sạch 100%.</p>', faq: [] });
    expect(bad.blocking.join(' ')).toMatch(/quá ngắn/);
    expect(bad.blocking.join(' ')).toMatch(/"100%"/);
    expect(bad.blocking.join(' ')).toMatch(/"tốt nhất"/);
    expect(bad.blocking.join(' ')).toMatch(/FAQ/);
  });
});

describe('trang công khai cẩm nang', () => {
  it('trang bài: điền khung, canonical, title ngắn, JSON-LD BlogPosting + FAQPage', async () => {
    const env = await blogEnv();
    const res = await get(env, `/cam-nang/${SEED_SLUG}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('__VK_');
    expect(html).toContain(`<link rel="canonical" href="https://vkinno.vn/cam-nang/${SEED_SLUG}" />`);
    expect(html).toMatch(/<title>[^<]+ \| VKINNO<\/title>/);
    expect(html).toContain('<h1>');
    expect(html).toContain('class="vk-toc"');
    const types = schemaOf(html).map((s) => s['@type']);
    expect(types).toEqual(['BlogPosting', 'BreadcrumbList', 'FAQPage']);
    expect(html).toContain('og:image" content="https://vkinno.vn/images/products/vk-solar-shield-5l.jpg"');
    // Có dấu "/" cuối vẫn trả cùng bài
    expect((await get(env, `/cam-nang/${SEED_SLUG}/`)).status).toBe(200);
  });

  it('escape tiêu đề có ký tự HTML', async () => {
    const env = await blogEnv();
    await env.DB.prepare("UPDATE blog_posts SET title = 'A <b>&</b> \"B\"', seo_title = '' WHERE slug = ?").bind(SEED_SLUG).run();
    const html = await (await get(env, `/cam-nang/${SEED_SLUG}`)).text();
    expect(html).toContain('<h1>A &lt;b&gt;&amp;&lt;/b&gt; &quot;B&quot;</h1>');
    expect(html).not.toContain('<b>&</b>');
  });

  it('slug lạ, bài nháp, /vk-khung trả 404; POST bị từ chối', async () => {
    const env = await blogEnv();
    expect((await get(env, '/cam-nang/khong-co')).status).toBe(404);
    expect((await get(env, '/cam-nang/CHU-HOA')).status).toBe(404);
    expect((await get(env, '/cam-nang/a/b')).status).toBe(404);
    expect((await get(env, '/vk-khung/bai-viet/')).status).toBe(404);
    await env.DB.prepare("UPDATE blog_posts SET status = 'review' WHERE slug = ?").bind(SEED_SLUG).run();
    expect((await get(env, `/cam-nang/${SEED_SLUG}`)).status).toBe(404);
    expect((await get(env, `/cam-nang/${SEED_SLUG}?xem-truoc=1`)).status).toBe(404);
    const post = await callWorker(new Request('https://vkinno.vn/cam-nang', { method: 'POST' }), env);
    expect(post.status).toBe(405);
  });

  it('xem trước bài chưa đăng khi đã đăng nhập: noindex, không cache', async () => {
    const env = await blogEnv();
    await env.DB.prepare("UPDATE blog_posts SET status = 'review' WHERE slug = ?").bind(SEED_SLUG).run();
    const admin = await createUser(env.DB, 'ADMIN');
    const { signSession } = await import('../worker/admin/auth');
    const cookie = `vk_admin=${await signSession(admin.id, env.ADMIN_SESSION_SECRET as string)}`;
    const prev = await get(env, `/cam-nang/${SEED_SLUG}?xem-truoc=1`, 'vkinno.vn', { Cookie: cookie });
    expect(prev.status).toBe(200);
    expect(prev.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(prev.headers.get('Cache-Control')).toBe('no-store');
    const html = await prev.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('Bản xem trước');
  });

  it('danh sách: 3 bài gốc, JSON-LD Blog; trang vượt quá trả 404', async () => {
    const env = await blogEnv();
    const html = await (await get(env, '/cam-nang')).text();
    expect(html.match(/class="vk-post-card /g)?.length).toBe(3);
    expect(html).toContain('<link rel="canonical" href="https://vkinno.vn/cam-nang" />');
    expect(schemaOf(html)).toMatchObject({ '@type': 'Blog' });
    expect((await get(env, '/cam-nang?trang=2')).status).toBe(404);
  });

  it('sitemap cẩm nang và robots theo host', async () => {
    const env = await blogEnv();
    const xml = await (await get(env, '/sitemap-cam-nang.xml')).text();
    expect(xml.match(/<url>/g)?.length).toBe(4);
    expect(xml).toContain(`<loc>https://vkinno.vn/cam-nang/${SEED_SLUG}</loc>`);
    expect(await (await get(env, '/robots.txt', 'vkinno-web-staging.vkinno.workers.dev')).text()).toBe('User-agent: *\nDisallow: /\n');
    const prod = await (await get(env, '/robots.txt')).text();
    expect(prod).toContain('Sitemap: https://vkinno.vn/sitemap-cam-nang.xml');
    expect(renderRobots('vkinno.vn')).toContain('Disallow: /quan-tri');
  });

  it('fillShell thay đủ chỗ giữ và ảnh ngoài giữ nguyên URL', () => {
    const html = fillShell(SHELL, {
      title: 'Bài VKINNO',
      description: 'Mô tả',
      canonical: 'https://vkinno.vn/cam-nang/x',
      image: 'https://cdn.example.com/a.jpg',
      schema: { a: '</script>' },
      body: '<p>Thân</p>',
    });
    expect(html).toContain('<title>Bài VKINNO</title>');
    expect(html).toContain('content="https://cdn.example.com/a.jpg"');
    expect(html).toContain('{"a":"\\u003c/script\\u003e"}');
    expect(html).toContain('<main><p>Thân</p></main>');
  });
});

describe('tự viết bài bằng Gemini', () => {
  it('cron: lấy chủ đề ưu tiên nhất, lưu "chờ duyệt", bỏ link ngoài và script, báo Telegram', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'khoa-test', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' });
    const { telegram, gemini } = stubFetch(() => geminiOk(article()));
    const r = await runBlogDaily(env);
    expect(r.status).toBe('ok');
    expect(r.post_status).toBe('review');
    expect(gemini).toHaveLength(1);
    expect(gemini[0].key).toBe('khoa-test');
    expect(String(gemini[0].url)).toContain('/models/gemini-3.8-flash:generateContent');
    const body = gemini[0].body as { generationConfig: Record<string, unknown>; contents: { parts: { text: string }[] }[] };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toContain('TỪ KHOÁ CHÍNH: tẩy màng dầu kính lái ô tô');
    const post = await env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(r.post_id).first<Record<string, unknown>>();
    expect(post).toMatchObject({ status: 'review', origin: 'ai', slug: 'tay-mang-dau-kinh-lai-o-to', published_at: null });
    expect(String(post!.content_html)).not.toContain('<script');
    expect(String(post!.content_html)).not.toContain('example.com');
    expect(JSON.parse(String(post!.related_skus_json))).toEqual(['VK-VISIONX-CLEAN-500ML']);
    const topic = await env.DB.prepare('SELECT status, post_id FROM blog_topics WHERE id = ?').bind(r.topic_id).first();
    expect(topic).toEqual({ status: 'used', post_id: r.post_id });
    expect(telegram[0]).toContain('chờ duyệt');
    // Bài chờ duyệt chưa lên web
    expect((await get(env, '/cam-nang/tay-mang-dau-kinh-lai-o-to')).status).toBe(404);
    // Cùng ngày chạy lại: bỏ qua, không gọi Gemini nữa
    expect((await runBlogDaily(env)).status).toBe('skipped');
    expect(gemini).toHaveLength(1);
  });

  it('bật tự đăng: bài đạt lên web ngay, có ghi chú AI', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'k' });
    await env.DB.prepare("UPDATE app_settings SET value = '1' WHERE key = 'blog.auto_publish'").run();
    stubFetch(() => geminiOk(article()));
    const r = await runBlogDaily(env);
    expect(r.post_status).toBe('published');
    const html = await (await get(env, '/cam-nang/tay-mang-dau-kinh-lai-o-to')).text();
    expect(html).toContain('sự hỗ trợ của công cụ AI');
    expect(await (await get(env, '/sitemap-cam-nang.xml')).text()).toContain('tay-mang-dau-kinh-lai-o-to');
  });

  it('bài không đạt (cụm từ tuyệt đối) thành bản nháp, kể cả khi bật tự đăng', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'k' });
    await env.DB.prepare("UPDATE app_settings SET value = '1' WHERE key = 'blog.auto_publish'").run();
    stubFetch(() => geminiOk(article({ summary: 'Sản phẩm tốt nhất thị trường cho kính ô tô.' })));
    const r = await runBlogDaily(env);
    expect(r.status).toBe('rejected');
    const post = await env.DB.prepare('SELECT status, quality_notes FROM blog_posts WHERE id = ?').bind(r.post_id).first<{ status: string; quality_notes: string }>();
    expect(post!.status).toBe('draft');
    expect(post!.quality_notes).toContain('CHẶN');
  });

  it('API từ chối thinkingConfig thì gửi lại không có trường đó', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'k' });
    const { gemini } = stubFetch((body) =>
      (body.generationConfig as Record<string, unknown>).thinkingConfig
        ? new Response(JSON.stringify({ error: { message: 'Unknown name "thinkingConfig"' } }), { status: 400 })
        : geminiOk(article()),
    );
    expect((await runBlogDaily(env)).status).toBe('ok');
    expect(gemini).toHaveLength(2);
  });

  it('MAX_TOKENS / 429: ghi lỗi, tăng số lần thử, đủ 3 lần thì chủ đề "failed"', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'k' });
    stubFetch(() => geminiOk(article(), 'MAX_TOKENS'));
    const r = await runBlogGeneration(env, 'manual');
    expect(r.status).toBe('error');
    expect(r.message).toContain('MAX_TOKENS');
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }));
    await runBlogGeneration(env, 'manual');
    await runBlogGeneration(env, 'manual');
    const t = await env.DB.prepare('SELECT status, attempts, last_error FROM blog_topics WHERE id = ?').bind(r.topic_id).first();
    expect(t).toMatchObject({ status: 'failed', attempts: 3 });
    await expect(runBlogGeneration(env, 'manual')).rejects.toMatchObject({ status: 429 });
  });

  it('thiếu khoá API: cron ghi lỗi, không gọi mạng; tắt tự viết thì bỏ qua', async () => {
    const env = await blogEnv();
    const { gemini } = stubFetch(() => geminiOk(article()));
    const r = await runBlogDaily(env);
    expect(r).toMatchObject({ status: 'error' });
    expect(gemini).toHaveLength(0);
    const env2 = await blogEnv({ GEMINI_API_KEY: 'k' });
    await env2.DB.prepare("UPDATE app_settings SET value = '0' WHERE key = 'blog.enabled'").run();
    expect((await runBlogDaily(env2)).message).toContain('đang tắt');
  });

  it('hết chủ đề: bỏ qua và báo Telegram', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'k', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' });
    await env.DB.prepare("UPDATE blog_topics SET status = 'skipped'").run();
    const { telegram } = stubFetch(() => geminiOk(article()));
    expect((await runBlogDaily(env)).status).toBe('skipped');
    expect(telegram[0]).toContain('Hết chủ đề');
  });
});

describe('API quản trị cẩm nang', () => {
  it('chỉ ADMIN; STAFF bị chặn', async () => {
    const env = await blogEnv();
    const staff = await createUser(env.DB, 'STAFF');
    expect((await api(env, '/blog/posts', {}, staff)).status).toBe(403);
    const admin = await createUser(env.DB, 'ADMIN');
    const res = await api(env, '/blog/posts', {}, admin);
    const j = (await res.json()) as { data: { items: unknown[]; counts: Record<string, number> } };
    expect(j.data.items).toHaveLength(3);
    expect(j.data.counts.published).toBe(3);
  });

  it('tạo, sửa (lọc HTML), đăng bị chặn khi chưa đạt rồi đăng cưỡng chế, gỡ, xoá', async () => {
    const env = await blogEnv();
    const admin = await createUser(env.DB, 'ADMIN');
    const created = await api(env, '/blog/posts', { method: 'POST', body: JSON.stringify({ title: 'Bài viết tay thử nghiệm' }) }, admin);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { data: { id: number } }).data.id;
    const put = await api(
      env,
      `/blog/posts/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          title: 'Bài viết tay thử nghiệm',
          slug: 'bai-viet-tay',
          content_html: '<p onclick="x">Ngắn</p><script>x</script>',
          faq: [],
        }),
      },
      admin,
    );
    const updated = ((await put.json()) as { data: { content_html: string; quality: { blocking: string[] } } }).data;
    expect(updated.content_html).toBe('<p>Ngắn</p>');
    expect(updated.quality.blocking.length).toBeGreaterThan(0);
    const blocked = await api(env, `/blog/posts/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'published' }) }, admin);
    expect(blocked.status).toBe(422);
    const forced = await api(env, `/blog/posts/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'published', force: true }) }, admin);
    expect(((await forced.json()) as { data: { status: string; published_at: string } }).data).toMatchObject({ status: 'published' });
    expect((await get(env, '/cam-nang/bai-viet-tay')).status).toBe(200);
    expect((await api(env, `/blog/posts/${id}`, { method: 'DELETE' }, admin)).status).toBe(409);
    await api(env, `/blog/posts/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'archived' }) }, admin);
    expect((await get(env, '/cam-nang/bai-viet-tay')).status).toBe(404);
    expect((await api(env, `/blog/posts/${id}`, { method: 'DELETE' }, admin)).status).toBe(200);
    // Trùng đường dẫn
    const dup = await api(env, '/blog/posts', { method: 'POST', body: JSON.stringify({ title: 'X trùng', slug: SEED_SLUG }) }, admin);
    expect(dup.status).toBe(409);
  });

  it('chủ đề: thêm, trùng từ khoá bị chặn, bỏ qua; cài đặt; viết thử tối đa 3 lần/ngày', async () => {
    const env = await blogEnv({ GEMINI_API_KEY: 'k' });
    const admin = await createUser(env.DB, 'ADMIN');
    const add = await api(env, '/blog/topics', { method: 'POST', body: JSON.stringify({ primary_keyword: 'Lau kính xe hơi', priority: 1 }) }, admin);
    expect(add.status).toBe(201);
    const tid = ((await add.json()) as { data: { id: number } }).data.id;
    expect((await api(env, '/blog/topics', { method: 'POST', body: JSON.stringify({ primary_keyword: 'lau kính xe hơi' }) }, admin)).status).toBe(409);
    expect((await api(env, `/blog/topics/${tid}`, { method: 'PUT', body: JSON.stringify({ status: 'skipped' }) }, admin)).status).toBe(200);
    const s = await api(env, '/blog/settings', { method: 'PUT', body: JSON.stringify({ enabled: true, auto_publish: false, model: 'gemini-3.5-flash-lite', author: 'Kỹ thuật VKINNO' }) }, admin);
    expect(s.status).toBe(200);
    expect((await api(env, '/blog/settings', { method: 'PUT', body: JSON.stringify({ enabled: true, auto_publish: false, model: 'bad model/../', author: 'X Y' }) }, admin)).status).toBe(422);
    const { gemini } = stubFetch(() => geminiOk(article()));
    for (let i = 0; i < 3; i++) {
      const g = await api(env, '/blog/generate', { method: 'POST', body: '{}' }, admin);
      expect(g.status).toBe(200);
    }
    expect(String(gemini[0].url)).toContain('gemini-3.5-flash-lite');
    expect((await api(env, '/blog/generate', { method: 'POST', body: '{}' }, admin)).status).toBe(429);
    const st = ((await (await api(env, '/blog/status', {}, admin)).json()) as { data: Record<string, unknown> }).data;
    expect(st).toMatchObject({ has_api_key: true, manual_runs_today: 3, model: 'gemini-3.5-flash-lite' });
  });
});
