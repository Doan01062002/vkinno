// API quản trị cẩm nang: /api/admin/blog/*. Chỉ ADMIN.
import { z } from 'zod';
import { idSchema, pageQuerySchema } from '../../src/shared/schemas';
import { products } from '../../src/data/products';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { auditStmt } from '../admin/audit';
import { route } from '../admin/router';
import { MANUAL_RUNS_PER_DAY, runBlogGeneration, vnToday } from './generate';
import { countWords, sanitizeArticleHtml, slugify } from './html';
import { GEMINI_KEY_RE, GEMINI_KEY_SETTING, encryptGeminiKey, getGeminiKey, last4 } from './gemini-key';
import { checkQuality } from './quality';
import { parseJsonArray, readBlogSettings, type BlogPostRow, type FaqItem } from './store';

const ADMIN = { role: 'ADMIN' as const };
const STATUSES = ['draft', 'review', 'published', 'archived'] as const;
const VALID_SKUS = new Set(products.map((p) => p.sku));
const LIST_COLS =
  'id, slug, title, status, origin, word_count, primary_keyword, published_at, created_at, updated_at, quality_notes, topic_id';

const postId = (params: Record<string, string>) => {
  const p = idSchema.safeParse(params.id);
  if (!p.success) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bài viết.');
  return p.data;
};

async function loadPost(db: D1Database, id: number): Promise<BlogPostRow> {
  const row = await db.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first<BlogPostRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bài viết.');
  return row;
}

function qualityOf(row: Pick<BlogPostRow, 'title' | 'seo_title' | 'meta_description' | 'summary' | 'content_html' | 'faq_json'>) {
  return checkQuality({
    title: row.title,
    seo_title: row.seo_title,
    meta_description: row.meta_description,
    summary: row.summary,
    content_html: row.content_html,
    faq: parseJsonArray<FaqItem>(row.faq_json),
  });
}

// ---------- Bài viết ----------

const listQuery = pageQuerySchema.extend({ status: z.enum(STATUSES).optional() });

route(
  'GET',
  '/blog/posts',
  async ({ env, url }) => {
    const q = parseQuery(url, listQuery);
    const where = "WHERE (?1 IS NULL OR status = ?1) AND (?2 IS NULL OR title LIKE '%' || ?2 || '%' OR primary_keyword LIKE '%' || ?2 || '%')";
    const [items, total, counts] = await env.DB.batch([
      env.DB.prepare(
        `SELECT ${LIST_COLS} FROM blog_posts ${where} ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, COALESCE(published_at, created_at) DESC, id DESC LIMIT ?3 OFFSET ?4`,
      ).bind(q.status ?? null, q.q || null, q.page_size, (q.page - 1) * q.page_size),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_posts ${where}`).bind(q.status ?? null, q.q || null),
      env.DB.prepare('SELECT status, COUNT(*) AS n FROM blog_posts GROUP BY status'),
    ]);
    return ok({
      items: items.results,
      total: (total.results[0] as { n: number }).n,
      page: q.page,
      page_size: q.page_size,
      counts: Object.fromEntries((counts.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
    });
  },
  ADMIN,
);

route(
  'GET',
  '/blog/posts/:id',
  async ({ env, params }) => {
    const row = await loadPost(env.DB, postId(params));
    return ok({ ...row, quality: qualityOf(row) });
  },
  ADMIN,
);

const faqInput = z.array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1500) })).max(10);
const postInput = z.object({
  title: z.string().trim().min(5).max(150),
  slug: z
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Đường dẫn chỉ gồm chữ thường không dấu, số và gạch nối.'),
  seo_title: z.string().trim().max(120).default(''),
  meta_description: z.string().trim().max(300).default(''),
  summary: z.string().trim().max(600).default(''),
  content_html: z.string().max(200_000).default(''),
  faq: faqInput.default([]),
  image_url: z
    .string()
    .trim()
    .max(500)
    .regex(/^(\/[^\s"'<>]*|https:\/\/[^\s"'<>]+)?$/, 'Ảnh phải là đường dẫn /... hoặc https://...')
    .default(''),
  image_alt: z.string().trim().max(200).default(''),
  primary_keyword: z.string().trim().max(120).default(''),
  related_skus: z.array(z.string()).max(6).default([]),
});

async function assertSlugFree(db: D1Database, slug: string, exceptId?: number) {
  const hit = await db
    .prepare('SELECT id FROM blog_posts WHERE slug = ? AND id <> ?')
    .bind(slug, exceptId ?? 0)
    .first();
  if (hit) throw new ApiError(409, 'SLUG_TAKEN', 'Đường dẫn này đã có bài khác dùng.');
}

function normalized(input: z.infer<typeof postInput>) {
  const content = sanitizeArticleHtml(input.content_html);
  return {
    ...input,
    content_html: content,
    word_count: countWords(content),
    faq_json: JSON.stringify(input.faq),
    related_skus_json: JSON.stringify(input.related_skus.filter((s) => VALID_SKUS.has(s))),
  };
}

route(
  'POST',
  '/blog/posts',
  async ({ env, req, user }) => {
    const body = await parseBody(
      req,
      postInput.partial({ slug: true }).extend({ title: z.string().trim().min(5).max(150) }),
    );
    const slug = body.slug || slugify(body.title, 80);
    if (!slug) throw new ApiError(422, 'VALIDATION', 'Không tạo được đường dẫn từ tiêu đề.');
    await assertSlugFree(env.DB, slug);
    const v = normalized(postInput.parse({ ...body, slug }));
    const res = await env.DB.prepare(
      `INSERT INTO blog_posts (slug, title, seo_title, meta_description, summary, content_html, faq_json, image_url, image_alt,
         primary_keyword, related_skus_json, status, origin, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'manual', ?)`,
    )
      .bind(v.slug, v.title, v.seo_title, v.meta_description, v.summary, v.content_html, v.faq_json, v.image_url, v.image_alt, v.primary_keyword, v.related_skus_json, v.word_count)
      .run();
    const id = Number(res.meta.last_row_id);
    await auditStmt(env.DB, user.id, 'blog.create', 'blog_posts', id, { slug: v.slug }).run();
    return ok({ id }, 201);
  },
  ADMIN,
);

route(
  'PUT',
  '/blog/posts/:id',
  async ({ env, req, params, user }) => {
    const id = postId(params);
    const before = await loadPost(env.DB, id);
    const v = normalized(await parseBody(req, postInput));
    await assertSlugFree(env.DB, v.slug, id);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE blog_posts SET slug = ?, title = ?, seo_title = ?, meta_description = ?, summary = ?, content_html = ?,
           faq_json = ?, image_url = ?, image_alt = ?, primary_keyword = ?, related_skus_json = ?, word_count = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).bind(v.slug, v.title, v.seo_title, v.meta_description, v.summary, v.content_html, v.faq_json, v.image_url, v.image_alt, v.primary_keyword, v.related_skus_json, v.word_count, id),
      auditStmt(env.DB, user.id, 'blog.update', 'blog_posts', id, {
        slug_changed: before.slug !== v.slug ? { from: before.slug, to: v.slug } : undefined,
      }),
    ]);
    const row = await loadPost(env.DB, id);
    return ok({ ...row, quality: qualityOf(row) });
  },
  ADMIN,
);

const statusInput = z.object({ status: z.enum(STATUSES), force: z.boolean().default(false) });

route(
  'POST',
  '/blog/posts/:id/status',
  async ({ env, req, params, user }) => {
    const id = postId(params);
    const row = await loadPost(env.DB, id);
    const { status, force } = await parseBody(req, statusInput);
    if (status === 'published' && row.status !== 'published') {
      const q = qualityOf(row);
      if (q.blocking.length && !force) {
        throw new ApiError(422, 'QUALITY', 'Bài chưa đạt kiểm tra chất lượng.', { blocking: q.blocking });
      }
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE blog_posts SET status = ?, published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN datetime('now') ELSE published_at END,
           updated_at = datetime('now') WHERE id = ?`,
      ).bind(status, status, id),
      auditStmt(env.DB, user.id, 'blog.status', 'blog_posts', id, { from: row.status, to: status, force }),
    ]);
    return ok(await loadPost(env.DB, id));
  },
  ADMIN,
);

route(
  'DELETE',
  '/blog/posts/:id',
  async ({ env, params, user }) => {
    const id = postId(params);
    const row = await loadPost(env.DB, id);
    if (row.status === 'published') throw new ApiError(409, 'PUBLISHED', 'Gỡ bài (chuyển "Lưu trữ") trước khi xoá.');
    await env.DB.batch([
      env.DB.prepare("UPDATE blog_topics SET post_id = NULL, updated_at = datetime('now') WHERE post_id = ?").bind(id),
      env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id),
      auditStmt(env.DB, user.id, 'blog.delete', 'blog_posts', id, { slug: row.slug, title: row.title }),
    ]);
    return ok({ id });
  },
  ADMIN,
);

// ---------- Chủ đề ----------

const topicQuery = pageQuerySchema.extend({ status: z.enum(['pending', 'used', 'failed', 'skipped']).optional() });

route(
  'GET',
  '/blog/topics',
  async ({ env, url }) => {
    const q = parseQuery(url, topicQuery);
    const where = 'WHERE (?1 IS NULL OR t.status = ?1)';
    const [items, total] = await env.DB.batch([
      env.DB.prepare(
        `SELECT t.*, p.title AS post_title FROM blog_topics t LEFT JOIN blog_posts p ON p.id = t.post_id ${where}
         ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, t.priority ASC, t.id ASC LIMIT ?2 OFFSET ?3`,
      ).bind(q.status ?? null, q.page_size, (q.page - 1) * q.page_size),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM blog_topics t ${where}`).bind(q.status ?? null),
    ]);
    return ok({ items: items.results, total: (total.results[0] as { n: number }).n, page: q.page, page_size: q.page_size });
  },
  ADMIN,
);

const topicInput = z.object({
  primary_keyword: z.string().trim().min(3).max(120),
  angle: z.string().trim().max(500).default(''),
  cluster: z.string().trim().max(60).default(''),
  related_skus: z.array(z.string()).max(4).default([]),
  priority: z.number().int().min(0).max(100000).default(1000),
});

route(
  'POST',
  '/blog/topics',
  async ({ env, req, user }) => {
    const t = await parseBody(req, topicInput);
    const dup = await env.DB.prepare('SELECT id FROM blog_topics WHERE lower(primary_keyword) = lower(?)').bind(t.primary_keyword).first();
    if (dup) throw new ApiError(409, 'DUPLICATE', 'Từ khoá này đã có trong hàng đợi.');
    const res = await env.DB.prepare(
      'INSERT INTO blog_topics (primary_keyword, angle, cluster, related_skus_json, priority) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(t.primary_keyword, t.angle, t.cluster, JSON.stringify(t.related_skus.filter((s) => VALID_SKUS.has(s))), t.priority)
      .run();
    const id = Number(res.meta.last_row_id);
    await auditStmt(env.DB, user.id, 'blog.topic.create', 'blog_topics', id, { keyword: t.primary_keyword }).run();
    return ok({ id }, 201);
  },
  ADMIN,
);

const topicPatch = z.object({
  status: z.enum(['pending', 'skipped']).optional(),
  priority: z.number().int().min(0).max(100000).optional(),
});

route(
  'PUT',
  '/blog/topics/:id',
  async ({ env, req, params, user }) => {
    const id = postId(params);
    const patch = await parseBody(req, topicPatch);
    const row = await env.DB.prepare('SELECT * FROM blog_topics WHERE id = ?').bind(id).first<{ status: string }>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy chủ đề.');
    if (row.status === 'used' && patch.status) throw new ApiError(409, 'USED', 'Chủ đề đã viết bài, không đổi trạng thái được.');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE blog_topics SET status = COALESCE(?, status), priority = COALESCE(?, priority),
           attempts = CASE WHEN ? = 'pending' THEN 0 ELSE attempts END, updated_at = datetime('now') WHERE id = ?`,
      ).bind(patch.status ?? null, patch.priority ?? null, patch.status ?? null, id),
      auditStmt(env.DB, user.id, 'blog.topic.update', 'blog_topics', id, patch),
    ]);
    return ok({ id });
  },
  ADMIN,
);

route(
  'DELETE',
  '/blog/topics/:id',
  async ({ env, params, user }) => {
    const id = postId(params);
    const row = await env.DB.prepare('SELECT status FROM blog_topics WHERE id = ?').bind(id).first<{ status: string }>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy chủ đề.');
    if (row.status === 'used') throw new ApiError(409, 'USED', 'Chủ đề đã viết bài, không xoá được.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM blog_topics WHERE id = ?').bind(id),
      auditStmt(env.DB, user.id, 'blog.topic.delete', 'blog_topics', id, {}),
    ]);
    return ok({ id });
  },
  ADMIN,
);

// ---------- Cài đặt & chạy ----------

route(
  'GET',
  '/blog/status',
  async ({ env }) => {
    const settings = await readBlogSettings(env.DB);
    const gemini = await getGeminiKey(env);
    const [runs, pending, manual] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM blog_runs ORDER BY id DESC LIMIT 10'),
      env.DB.prepare("SELECT COUNT(*) AS n FROM blog_topics WHERE status = 'pending'"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM blog_runs WHERE run_date = ? AND trigger = 'manual' AND status <> 'skipped'").bind(vnToday()),
    ]);
    return ok({
      enabled: settings.enabled,
      auto_publish: settings.autoPublish,
      model: settings.model,
      author: settings.author,
      has_api_key: Boolean(gemini),
      key_source: gemini?.source ?? null,
      key_last4: gemini ? last4(gemini.key) : null,
      pending_topics: (pending.results[0] as { n: number }).n,
      manual_runs_today: (manual.results[0] as { n: number }).n,
      manual_runs_limit: MANUAL_RUNS_PER_DAY,
      runs: runs.results,
    });
  },
  ADMIN,
);

const settingsInput = z.object({
  enabled: z.boolean(),
  auto_publish: z.boolean(),
  model: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.\-]{1,63}$/, 'Tên model không hợp lệ (vd. gemini-3.8-flash).'),
  author: z.string().trim().min(2).max(120),
});

route(
  'PUT',
  '/blog/settings',
  async ({ env, req, user }) => {
    const s = await parseBody(req, settingsInput);
    const upsert = (key: string, value: string) =>
      env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
    await env.DB.batch([
      upsert('blog.enabled', s.enabled ? '1' : '0'),
      upsert('blog.auto_publish', s.auto_publish ? '1' : '0'),
      upsert('blog.model', s.model),
      upsert('blog.author', s.author),
      auditStmt(env.DB, user.id, 'blog.settings', 'app_settings', 'blog', s),
    ]);
    return ok(s);
  },
  ADMIN,
);

route(
  'POST',
  '/blog/generate',
  async ({ env }) => {
    const r = await runBlogGeneration(env, 'manual');
    return ok(r);
  },
  ADMIN,
);

// ---------- Khoá Gemini nhập trong admin (mã hoá AES-GCM; không bao giờ trả khoá đầy đủ) ----------

route(
  'GET',
  '/blog/gemini-key',
  async ({ env }) => {
    const g = await getGeminiKey(env);
    return ok({ configured: Boolean(g), source: g?.source ?? null, last4: g ? last4(g.key) : null });
  },
  ADMIN,
);

const keyInput = z.object({
  key: z
    .string()
    .trim()
    .regex(GEMINI_KEY_RE, 'Khoá không đúng định dạng (chỉ chữ, số, "-" và "_", dài 20–200 ký tự).'),
});

route(
  'PUT',
  '/blog/gemini-key',
  async ({ env, req, user }) => {
    if (!env.ADMIN_SESSION_SECRET) {
      throw new ApiError(503, 'NO_SECRET', 'Máy chủ thiếu ADMIN_SESSION_SECRET nên không mã hoá được khoá.');
    }
    const { key } = await parseBody(req, keyInput, 4096);
    const stored = await encryptGeminiKey(key, env.ADMIN_SESSION_SECRET);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(
        GEMINI_KEY_SETTING,
        stored,
      ),
      auditStmt(env.DB, user.id, 'blog.gemini_key.set', 'app_settings', 'blog.gemini_key', { action: 'đổi khoá Gemini', last4: last4(key) }),
    ]);
    return ok({ configured: true, source: 'admin', last4: last4(key) });
  },
  ADMIN,
);

route(
  'DELETE',
  '/blog/gemini-key',
  async ({ env, user }) => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(GEMINI_KEY_SETTING),
      auditStmt(env.DB, user.id, 'blog.gemini_key.delete', 'app_settings', 'blog.gemini_key', { action: 'xoá khoá Gemini nhập trong admin' }),
    ]);
    const g = await getGeminiKey(env);
    return ok({ configured: Boolean(g), source: g?.source ?? null, last4: g ? last4(g.key) : null });
  },
  ADMIN,
);

route(
  'POST',
  '/blog/gemini-key/test',
  async ({ env }) => {
    const g = await getGeminiKey(env);
    if (!g) return ok({ ok: false, message: 'Chưa có khoá Gemini.' });
    const scrub = (s: string) => s.split(g.key).join('***');
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': g.key },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return ok({ ok: true, message: `Khoá …${last4(g.key)} hoạt động.`, source: g.source });
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j.error?.message) detail = j.error.message.slice(0, 200);
      } catch {
        /* giữ HTTP status */
      }
      return ok({ ok: false, message: scrub(`Gemini từ chối khoá (${detail}).`), source: g.source });
    } catch (e) {
      const msg = e instanceof Error && e.name === 'TimeoutError' ? 'Quá 10 giây không phản hồi.' : 'Không kết nối được tới Gemini.';
      return ok({ ok: false, message: msg, source: g.source });
    }
  },
  ADMIN,
);
