// Route công khai của cẩm nang: /cam-nang, /cam-nang/:slug, /sitemap-cam-nang.xml, /robots.txt, /vk-khung/*.
import type { Env } from '../lib/env';
import { readSession } from '../admin/auth';
import {
  BLOG_PATH,
  PAGE_SIZE,
  SITE_URL,
  fallbackDescription,
  fillShell,
  listSchema,
  postSchema,
  postUrl,
  renderListBody,
  renderPostBody,
  renderRobots,
  renderSitemap,
} from './render';
import { getPostBySlug, listPublished, listPublishedForSitemap, readBlogSettings, type BlogPostRow } from './store';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'public, max-age=0, s-maxage=300, must-revalidate',
};

async function loadShell(env: Env, url: URL, name: 'bai-viet' | 'danh-sach'): Promise<string | null> {
  const res = await env.ASSETS.fetch(new Request(new URL(`/vk-khung/${name}/`, url).toString()));
  if (!res.ok) return null;
  return res.text();
}

/** Trang 404 của site (ASSETS trả trang 404 cho đường dẫn không có tệp). */
async function notFound(env: Env, url: URL): Promise<Response> {
  const res = await env.ASSETS.fetch(new Request(new URL('/__khong-ton-tai__', url).toString()));
  return new Response(res.body, { status: 404, headers: res.headers });
}

function shellMissing(): Response {
  return new Response('Thiếu khung trang /vk-khung — cần build lại web (npm run build).', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function related(db: D1Database, post: BlogPostRow): Promise<BlogPostRow[]> {
  const r = await db
    .prepare(
      "SELECT * FROM blog_posts WHERE status = 'published' AND id <> ? ORDER BY published_at DESC, id DESC LIMIT 12",
    )
    .bind(post.id)
    .all<BlogPostRow>();
  // Ưu tiên bài chung sản phẩm liên quan, sau đó bài mới nhất.
  let mySkus: string[] = [];
  try {
    mySkus = JSON.parse(post.related_skus_json || '[]');
  } catch {
    mySkus = [];
  }
  const score = (p: BlogPostRow) => {
    try {
      return (JSON.parse(p.related_skus_json || '[]') as string[]).filter((s) => mySkus.includes(s)).length;
    } catch {
      return 0;
    }
  };
  return [...r.results].sort((a, b) => score(b) - score(a)).slice(0, 3);
}

async function servePost(request: Request, env: Env, url: URL, slug: string): Promise<Response> {
  if (!SLUG_RE.test(slug)) return notFound(env, url);
  const post = await getPostBySlug(env.DB, slug);
  if (!post) return notFound(env, url);
  let preview = false;
  if (post.status !== 'published') {
    // Bài chưa đăng: chỉ người đăng nhập quản trị xem được, kèm noindex.
    const user = url.searchParams.has('xem-truoc') ? await readSession(request, env) : null;
    if (!user) return notFound(env, url);
    preview = true;
  }
  const shell = await loadShell(env, url, 'bai-viet');
  if (!shell) return shellMissing();
  const settings = await readBlogSettings(env.DB);
  const body = renderPostBody(post, { author: settings.author, related: await related(env.DB, post), preview });
  const html = fillShell(shell, {
    title: post.seo_title || post.title,
    description: fallbackDescription(post),
    canonical: postUrl(post.slug),
    image: post.image_url,
    schema: postSchema(post, settings.author),
    body,
    robots: preview ? 'noindex, nofollow' : undefined,
  });
  const headers: Record<string, string> = { ...HTML_HEADERS };
  if (preview) {
    headers['Cache-Control'] = 'no-store';
    headers['X-Robots-Tag'] = 'noindex, nofollow';
  }
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
}

async function serveList(request: Request, env: Env, url: URL): Promise<Response> {
  const raw = url.searchParams.get('trang');
  const page = raw && /^\d{1,4}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
  const { rows, total } = await listPublished(env.DB, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) return notFound(env, url);
  const shell = await loadShell(env, url, 'danh-sach');
  if (!shell) return shellMissing();
  const html = fillShell(shell, {
    title: page > 1 ? `Cẩm nang làm sạch & chăm sóc bề mặt – Trang ${page}` : 'Cẩm nang làm sạch & chăm sóc bề mặt',
    description:
      'Hướng dẫn vệ sinh tấm pin mặt trời, tẩy cặn canxi nhà tắm, tẩy dầu mỡ bếp và chăm sóc kính ô tô: tỷ lệ pha, thời gian ủ, lưu ý vật liệu từ kỹ thuật VKINNO.',
    canonical: page > 1 ? `${SITE_URL}${BLOG_PATH}?trang=${page}` : `${SITE_URL}${BLOG_PATH}`,
    image: '/images/og-vkinno.jpg',
    schema: listSchema(rows),
    body: renderListBody(rows, page, totalPages),
  });
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: HTML_HEADERS });
}

/** Trả Response nếu đường dẫn thuộc cẩm nang/robots/sitemap; null nếu không phải. */
export async function handleBlogPublic(request: Request, env: Env, url: URL, path: string): Promise<Response | null> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (path === '/robots.txt' && isRead) {
    return new Response(renderRobots(url.hostname), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (path === '/sitemap-cam-nang.xml' && isRead) {
    const rows = await listPublishedForSitemap(env.DB);
    return new Response(renderSitemap(rows), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=600' },
    });
  }
  if (path === '/vk-khung' || path.startsWith('/vk-khung/')) return notFound(env, url);
  if (path === BLOG_PATH) {
    if (!isRead) return new Response('Method Not Allowed', { status: 405 });
    return serveList(request, env, url);
  }
  if (path.startsWith(`${BLOG_PATH}/`)) {
    if (!isRead) return new Response('Method Not Allowed', { status: 405 });
    const rest = path.slice(BLOG_PATH.length + 1);
    if (rest.includes('/')) return notFound(env, url);
    let slug = rest;
    try {
      slug = decodeURIComponent(rest);
    } catch {
      return notFound(env, url);
    }
    return servePost(request, env, url, slug);
  }
  return null;
}
