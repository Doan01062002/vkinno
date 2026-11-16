// Tự viết bài cẩm nang bằng Gemini: lấy 1 chủ đề trong hàng đợi → gọi Gemini → kiểm tra → lưu.
// Cron 02:00 giờ VN (tối đa 1 lần thành công/ngày) hoặc nút "Viết thử ngay" (tối đa 3 lần/ngày).
import { z } from 'zod';
import { products } from '../../src/data/products';
import type { Env } from '../lib/env';
import { ApiError } from '../lib/http';
import { sendTelegramAlert } from '../lib/notify';
import { extractJson, generateJson } from './gemini';
import { getGeminiKey } from './gemini-key';
import { sanitizeArticleHtml, slugify } from './html';
import { checkQuality, unwrapExternalLinks } from './quality';
import { parseJsonArray, readBlogSettings } from './store';

export const MANUAL_RUNS_PER_DAY = 3;
const MAX_ATTEMPTS = 3;
const VALID_SKUS = new Set(products.map((p) => p.sku));

/** Ngày hiện tại theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
export function vnToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface TopicRow {
  id: number;
  primary_keyword: string;
  angle: string;
  cluster: string;
  related_skus_json: string;
  priority: number;
  status: string;
  attempts: number;
}

const articleSchema = z.object({
  title: z.string().trim().min(10).max(150),
  seo_title: z.string().trim().min(5).max(120),
  slug: z.string().trim().max(150).optional().default(''),
  meta_description: z.string().trim().min(30).max(300),
  summary: z.string().trim().min(20).max(500),
  primary_keyword: z.string().trim().max(120).optional().default(''),
  secondary_keywords: z.array(z.string().trim().max(120)).max(10).optional().default([]),
  content_html: z.string().min(500).max(120_000),
  faq: z
    .array(z.object({ q: z.string().trim().min(5).max(300), a: z.string().trim().min(5).max(1200) }))
    .max(8)
    .optional()
    .default([]),
  image_alt: z.string().trim().max(200).optional().default(''),
  related_skus: z.array(z.string().trim()).max(6).optional().default([]),
});

export type Article = z.infer<typeof articleSchema>;

function productFacts(skus: string[]): string {
  const pick = products.filter((p) => skus.includes(p.sku));
  const list = pick.length ? pick : products.filter((p) => !p.is_combo);
  return JSON.stringify(
    list.map((p) => ({
      sku: p.sku,
      ten: p.name,
      duong_dan: `/san-pham/${p.slug}`,
      thanh_phan: p.ingredients,
      dac_tinh: p.biochemical_features,
      cach_dung: p.usage_instructions,
      thoi_gian_u: p.dwell_time_note,
      be_mat_khong_dung: p.prohibited_surfaces,
      an_toan: p.safety_notes,
      dung_tich_ml: p.volume_ml,
    })),
    null,
    1,
  );
}

export const SYSTEM_PROMPT = `Bạn là biên tập viên kỹ thuật của VKINNO (Công ty TNHH Công nghệ Vĩnh Khang, Hà Nội) — nhà sản xuất chất tẩy rửa nền nước Deion: vệ sinh tấm pin mặt trời, tẩy cặn canxi, tẩy dầu mỡ bếp, lau kính, chăm sóc kính ô tô.
Nhiệm vụ: viết MỘT bài hướng dẫn tiếng Việt thật sự hữu ích cho người đọc Việt Nam (chủ nhà, chủ xe, chủ hệ điện mặt trời), đủ tốt để đứng top Google cho từ khoá được giao mà không vi phạm chính sách spam của Google.

Quy tắc bắt buộc:
1. Trả lời đúng ý định tìm kiếm ngay trong 2–3 câu đầu. Viết cụ thể: tỷ lệ pha, thời gian, dụng cụ, thứ tự bước, cách nhận biết bề mặt, khi nào KHÔNG nên làm.
2. Độ dài nội dung 1.200–1.600 chữ. Cấu trúc gợi ý: mở bài ngắn → các H2 (nguyên nhân/nhận biết, chuẩn bị, quy trình từng bước dạng <ol>, sai lầm thường gặp, lưu ý an toàn & vật liệu, khi nào nên dùng sản phẩm chuyên dụng) → kết luận 2–3 câu. Có thể dùng 1 bảng so sánh nếu giúp người đọc.
3. Nêu trung thực cả mẹo tự làm (giấm, baking soda, chanh, nước rửa chén...) kèm giới hạn và rủi ro của chúng.
4. Nhắc sản phẩm VKINNO 1–2 lần, tự nhiên, ở phần phù hợp, bằng link <a href="/san-pham/..."> lấy ĐÚNG đường dẫn trong DỮ KIỆN SẢN PHẨM. Thông tin sản phẩm CHỈ lấy từ DỮ KIỆN SẢN PHẨM, viết dè dặt ("theo hướng dẫn của nhà sản xuất", "khi pha đúng tỷ lệ").
5. KHÔNG bịa số liệu, nghiên cứu, chứng nhận, tên chuyên gia hay trích dẫn. Không dùng: "số 1", "100%", "99,9%", "tốt nhất", "hiệu quả nhất", "rẻ nhất", "chữa khỏi", "diệt sạch", "vĩnh viễn", "thần kỳ". Không so sánh hạ thấp thương hiệu khác. Không chèn link ra website ngoài.
6. Văn phong: xưng "bạn", câu ngắn, rõ, thân thiện, chuyên môn; không văn mẫu kiểu "trong thế giới hiện đại", "hãy cùng khám phá", "không thể phủ nhận".
7. content_html CHỈ dùng thẻ: p, h2, h3, ul, ol, li, strong, em, a, table, thead, tbody, tr, th, td, blockquote. Không dùng h1, br, ảnh, class, style. KHÔNG đưa FAQ vào content_html.
8. Có thể link tới bài cẩm nang đã có (danh sách BÀI ĐÃ CÓ) bằng <a href="/cam-nang/slug"> nếu thật sự liên quan. Không viết trùng ý một bài đã có.

Trả về DUY NHẤT một đối tượng JSON với các khoá:
{"title": "tiêu đề H1 ≤ 70 ký tự, chứa từ khoá chính",
 "seo_title": "thẻ title ≤ 60 ký tự, không chứa chữ VKINNO",
 "slug": "duong-dan-khong-dau-ngan-gon-chua-tu-khoa",
 "meta_description": "140–160 ký tự: từ khoá + lợi ích + lời mời đọc",
 "summary": "sapo 1–2 câu ≤ 220 ký tự",
 "primary_keyword": "...", "secondary_keywords": ["3–6 từ khoá phụ"],
 "content_html": "<p>...</p><h2>...</h2>...",
 "faq": [{"q": "câu hỏi người dùng hay hỏi", "a": "trả lời 1–3 câu"}] (4–5 câu),
 "image_alt": "mô tả ảnh minh hoạ có từ khoá ≤ 120 ký tự",
 "related_skus": ["SKU trong DỮ KIỆN SẢN PHẨM"]}`;

export function buildPrompt(topic: TopicRow, existing: { title: string; slug: string }[]): string {
  const skus = parseJsonArray<string>(topic.related_skus_json).filter((s) => VALID_SKUS.has(s));
  return [
    `TỪ KHOÁ CHÍNH: ${topic.primary_keyword}`,
    topic.angle ? `HƯỚNG BÀI / Ý ĐỊNH TÌM KIẾM: ${topic.angle}` : '',
    topic.cluster ? `CỤM CHỦ ĐỀ: ${topic.cluster}` : '',
    '',
    'DỮ KIỆN SẢN PHẨM (nguồn duy nhất cho thông tin sản phẩm VKINNO):',
    productFacts(skus),
    '',
    'BÀI ĐÃ CÓ (không viết trùng; có thể link nội bộ):',
    existing.length ? existing.map((p) => `- ${p.title} → /cam-nang/${p.slug}`).join('\n') : '(chưa có)',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

async function uniqueSlug(db: D1Database, wanted: string): Promise<string> {
  const base = slugify(wanted, 80) || `bai-viet-${Date.now()}`;
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const hit = await db.prepare('SELECT 1 FROM blog_posts WHERE slug = ?').bind(slug).first();
    if (!hit) return slug;
  }
  return `${base}-${Date.now()}`;
}

export interface RunResult {
  status: 'ok' | 'rejected' | 'error' | 'skipped';
  message: string;
  post_id?: number;
  post_status?: string;
  topic_id?: number;
}

async function logRun(
  db: D1Database,
  r: RunResult & { trigger: 'cron' | 'manual'; model: string; usage?: { prompt: number; output: number; thoughts: number } },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO blog_runs (run_date, trigger, topic_id, post_id, status, model, prompt_tokens, output_tokens, thoughts_tokens, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      vnToday(),
      r.trigger,
      r.topic_id ?? null,
      r.post_id ?? null,
      r.status,
      r.model,
      r.usage?.prompt ?? 0,
      r.usage?.output ?? 0,
      r.usage?.thoughts ?? 0,
      r.message.slice(0, 1000),
    )
    .run();
}

/** Chạy một lần viết bài. Không ném lỗi với cron; với manual ném ApiError khi vượt hạn mức/thiếu cấu hình. */
export async function runBlogGeneration(env: Env, trigger: 'cron' | 'manual'): Promise<RunResult> {
  const db = env.DB;
  const settings = await readBlogSettings(db);
  const today = vnToday();
  const model = settings.model;

  if (trigger === 'cron') {
    if (!settings.enabled) return { status: 'skipped', message: 'Tự viết bài đang tắt.' };
    const done = await db
      .prepare("SELECT 1 FROM blog_runs WHERE run_date = ? AND trigger = 'cron' AND status IN ('ok', 'rejected', 'skipped', 'error') LIMIT 1")
      .bind(today)
      .first();
    if (done) return { status: 'skipped', message: 'Hôm nay đã chạy.' };
  } else {
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM blog_runs WHERE run_date = ? AND trigger = 'manual' AND status <> 'skipped'")
      .bind(today)
      .first<{ n: number }>();
    if ((n?.n ?? 0) >= MANUAL_RUNS_PER_DAY) {
      throw new ApiError(429, 'LIMIT', `Mỗi ngày chỉ viết thử tối đa ${MANUAL_RUNS_PER_DAY} lần.`);
    }
  }

  const gemini = await getGeminiKey(env);
  if (!gemini) {
    const r: RunResult = { status: 'error', message: 'Chưa có khoá Gemini — nhập ở Quản trị → Bài viết → Tự viết bằng AI.' };
    await logRun(db, { ...r, trigger, model });
    if (trigger === 'manual') throw new ApiError(503, 'NO_API_KEY', r.message);
    return r;
  }

  const topic = await db
    .prepare("SELECT * FROM blog_topics WHERE status = 'pending' ORDER BY priority ASC, id ASC LIMIT 1")
    .first<TopicRow>();
  if (!topic) {
    const r: RunResult = { status: 'skipped', message: 'Hết chủ đề trong hàng đợi — thêm chủ đề ở Quản trị → Bài viết → Chủ đề.' };
    await logRun(db, { ...r, trigger, model });
    if (trigger === 'cron') await sendTelegramAlert(env, `📝 Cẩm nang: ${r.message}`);
    return r;
  }

  const existing = (
    await db
      .prepare("SELECT title, slug FROM blog_posts WHERE status IN ('published', 'review') ORDER BY id DESC LIMIT 200")
      .all<{ title: string; slug: string }>()
  ).results;

  let usage: { prompt: number; output: number; thoughts: number } | undefined;
  let article: Article;
  let modelUsed = model;
  try {
    const res = await generateJson({
      apiKey: gemini.key,
      model,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(topic, existing),
    });
    usage = res.usage;
    modelUsed = res.modelVersion || model;
    const parsed = articleSchema.safeParse(extractJson(res.text));
    if (!parsed.success) throw new Error(`JSON sai cấu trúc: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ')}`);
    article = parsed.data;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const attempts = topic.attempts + 1;
    await db
      .prepare("UPDATE blog_topics SET attempts = ?, last_error = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(attempts, message.slice(0, 500), attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', topic.id)
      .run();
    const r: RunResult = { status: 'error', message, topic_id: topic.id };
    await logRun(db, { ...r, trigger, model: modelUsed, usage });
    if (trigger === 'cron') await sendTelegramAlert(env, `⚠️ Cẩm nang: viết bài "${topic.primary_keyword}" lỗi — ${message}`);
    return r;
  }

  const content = unwrapExternalLinks(sanitizeArticleHtml(article.content_html));
  const faq = article.faq.slice(0, 6);
  const report = checkQuality(
    { ...article, content_html: content, faq },
    existing.map((p) => p.title),
  );
  const topicSkus = parseJsonArray<string>(topic.related_skus_json);
  const skus = [...new Set([...article.related_skus, ...topicSkus])].filter((s) => VALID_SKUS.has(s)).slice(0, 3);
  const cover = products.find((p) => p.sku === skus[0]) ?? products[0];
  const passed = report.blocking.length === 0;
  const status = !passed ? 'draft' : settings.autoPublish ? 'published' : 'review';
  const slug = await uniqueSlug(db, article.slug || article.title);
  const notes = [...report.blocking.map((b) => `CHẶN: ${b}`), ...report.warnings.map((w) => `Lưu ý: ${w}`)].join('\n');

  const ins = await db
    .prepare(
      `INSERT INTO blog_posts (slug, title, seo_title, meta_description, summary, content_html, faq_json, image_url, image_alt,
         primary_keyword, secondary_keywords_json, related_skus_json, sources_json, status, origin, ai_model, topic_id,
         word_count, quality_notes, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'ai', ?, ?, ?, ?, ${status === 'published' ? "datetime('now')" : 'NULL'})`,
    )
    .bind(
      slug,
      article.title,
      article.seo_title,
      article.meta_description,
      article.summary,
      content,
      JSON.stringify(faq),
      cover.image_url,
      article.image_alt || article.title,
      article.primary_keyword || topic.primary_keyword,
      JSON.stringify(article.secondary_keywords),
      JSON.stringify(skus),
      status,
      modelUsed,
      topic.id,
      report.wordCount,
      notes,
    )
    .run();
  const postId = Number(ins.meta.last_row_id);
  await db
    .prepare("UPDATE blog_topics SET status = 'used', post_id = ?, attempts = attempts + 1, last_error = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(postId, topic.id)
    .run();

  const r: RunResult = {
    status: passed ? 'ok' : 'rejected',
    message: passed
      ? `Đã viết "${article.title}" (${report.wordCount} chữ) — ${status === 'published' ? 'đã đăng' : 'chờ duyệt'}.`
      : `Bài "${article.title}" chưa đạt: ${report.blocking.join(' ')}`,
    post_id: postId,
    post_status: status,
    topic_id: topic.id,
  };
  await logRun(db, { ...r, trigger, model: modelUsed, usage });
  if (trigger === 'cron') {
    const link = status === 'published' ? `https://vkinno.vn/cam-nang/${slug}` : `/quan-tri/bai-viet/${postId}`;
    await sendTelegramAlert(env, `📝 Cẩm nang: ${r.message}\n${link}`);
  }
  return r;
}

/** Cron hằng ngày: không bao giờ ném lỗi. */
export async function runBlogDaily(env: Env): Promise<RunResult> {
  try {
    return await runBlogGeneration(env, 'cron');
  } catch (e) {
    console.error('Tự viết bài thất bại', e);
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
