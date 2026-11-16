// Truy cập D1 cho cẩm nang: đọc bài đã đăng, cài đặt blog.

export type BlogStatus = 'draft' | 'review' | 'published' | 'archived';

export interface BlogPostRow {
  id: number;
  slug: string;
  title: string;
  seo_title: string;
  meta_description: string;
  summary: string;
  content_html: string;
  faq_json: string;
  image_url: string;
  image_alt: string;
  primary_keyword: string;
  secondary_keywords_json: string;
  related_skus_json: string;
  sources_json: string;
  status: BlogStatus;
  origin: 'manual' | 'ai';
  ai_model: string | null;
  topic_id: number | null;
  word_count: number;
  quality_notes: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface SourceItem {
  url: string;
  title: string;
}

/** Đọc mảng JSON trong cột TEXT; hỏng thì trả mảng rỗng. */
export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function getPostBySlug(db: D1Database, slug: string): Promise<BlogPostRow | null> {
  return db.prepare('SELECT * FROM blog_posts WHERE slug = ?').bind(slug).first<BlogPostRow>();
}

/** Bài đã đăng, mới nhất trước. */
export async function listPublished(
  db: D1Database,
  limit: number,
  offset = 0,
): Promise<{ rows: BlogPostRow[]; total: number }> {
  const [rows, total] = await db.batch([
    db
      .prepare(
        "SELECT * FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?",
      )
      .bind(limit, offset),
    db.prepare("SELECT COUNT(*) AS n FROM blog_posts WHERE status = 'published'"),
  ]);
  return { rows: rows.results as BlogPostRow[], total: (total.results[0] as { n: number }).n };
}

/** Slug + ngày cập nhật của mọi bài đã đăng (cho sitemap). */
export async function listPublishedForSitemap(
  db: D1Database,
): Promise<{ slug: string; updated_at: string; published_at: string | null }[]> {
  const r = await db
    .prepare(
      "SELECT slug, updated_at, published_at FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC",
    )
    .all<{ slug: string; updated_at: string; published_at: string | null }>();
  return r.results;
}

export interface BlogSettings {
  enabled: boolean;
  autoPublish: boolean;
  model: string;
  author: string;
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export async function readBlogSettings(db: D1Database): Promise<BlogSettings> {
  const r = await db
    .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'blog.%'")
    .all<{ key: string; value: string }>();
  const s = new Map(r.results.map((x) => [x.key, x.value]));
  return {
    enabled: s.get('blog.enabled') !== '0',
    autoPublish: s.get('blog.auto_publish') === '1',
    model: (s.get('blog.model') || DEFAULT_MODEL).trim(),
    author: (s.get('blog.author') || 'Phòng Kỹ thuật VKINNO').trim(),
  };
}

/** "2026-11-16 09:00:00" (UTC trong D1) → ISO 8601 có múi giờ. */
export function sqlToIso(s: string | null | undefined): string {
  if (!s) return new Date(0).toISOString();
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
