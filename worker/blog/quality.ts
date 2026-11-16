// Kiểm tra chất lượng bài trước khi lưu/đăng (chốt an toàn mục 5 của spec).
import { products } from '../../src/data/products';
import { countWords, stripTags } from './html';

/** Cụm từ cấm (khẳng định tuyệt đối / quảng cáo quá mức) — có thì không cho đăng. */
export const BANNED_PHRASES = [
  'số 1',
  'số một',
  '100%',
  '99,9%',
  '99.9%',
  'tốt nhất',
  'hiệu quả nhất',
  'rẻ nhất',
  'chữa khỏi',
  'chữa bệnh',
  'diệt sạch',
  'vĩnh viễn',
  'thần kỳ',
  'thần thánh',
  'không độc hại tuyệt đối',
];

/** Văn mẫu sáo rỗng kiểu AI — chỉ cảnh báo. */
export const CLICHES = [
  'trong thế giới hiện đại',
  'hãy cùng khám phá',
  'không thể phủ nhận',
  'trong bài viết này, chúng ta sẽ',
  'hành trình',
  'bí mật được bật mí',
];

export interface QualityInput {
  title: string;
  seo_title: string;
  meta_description: string;
  summary: string;
  content_html: string;
  faq: { q: string; a: string }[];
}

export interface QualityReport {
  wordCount: number;
  blocking: string[];
  warnings: string[];
}

export const MIN_WORDS = 900;
const PRODUCT_SLUGS = new Set(products.map((p) => p.slug));

export function checkQuality(p: QualityInput, existingTitles: string[] = []): QualityReport {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const wordCount = countWords(p.content_html);
  if (wordCount < MIN_WORDS) blocking.push(`Bài quá ngắn: ${wordCount} chữ (tối thiểu ${MIN_WORDS}).`);
  const h2 = (p.content_html.match(/<h2[\s>]/g) || []).length;
  if (h2 < 3) blocking.push(`Cần ít nhất 3 tiêu đề H2 (đang có ${h2}).`);
  const links = [...p.content_html.matchAll(/href="\/san-pham\/([^"#?]+)"/g)].map((m) => m[1]);
  if (!links.some((s) => PRODUCT_SLUGS.has(s))) blocking.push('Thiếu link tới trang sản phẩm có thật (/san-pham/...).');
  const badLinks = links.filter((s) => !PRODUCT_SLUGS.has(s));
  if (badLinks.length) blocking.push(`Link sản phẩm không tồn tại: ${badLinks.slice(0, 3).join(', ')}.`);
  if (p.faq.length < 3) blocking.push(`Cần ít nhất 3 câu FAQ (đang có ${p.faq.length}).`);

  const text = `${p.title} ${p.summary} ${p.meta_description} ${stripTags(p.content_html)} ${p.faq
    .map((f) => `${f.q} ${f.a}`)
    .join(' ')}`.toLowerCase();
  const banned = BANNED_PHRASES.filter((w) => text.includes(w));
  if (banned.length) blocking.push(`Có cụm từ quảng cáo tuyệt đối: ${banned.map((w) => `"${w}"`).join(', ')}.`);
  const norm = (s: string) => s.trim().toLowerCase();
  if (existingTitles.some((t) => norm(t) === norm(p.title))) blocking.push('Trùng tiêu đề với bài đã có.');

  if (p.title.length > 90) warnings.push(`Tiêu đề dài ${p.title.length} ký tự (nên ≤ 70).`);
  if (p.seo_title.length > 65) warnings.push(`SEO title dài ${p.seo_title.length} ký tự (nên ≤ 60).`);
  if (p.meta_description.length < 110 || p.meta_description.length > 170) {
    warnings.push(`Meta description ${p.meta_description.length} ký tự (nên 140–160).`);
  }
  const cliches = CLICHES.filter((w) => text.includes(w));
  if (cliches.length) warnings.push(`Văn mẫu sáo rỗng: ${cliches.map((w) => `"${w}"`).join(', ')}.`);
  if (/<a [^>]*rel="nofollow/.test(p.content_html)) warnings.push('Có link ngoài — kiểm tra nguồn trước khi đăng.');
  return { wordCount, blocking, warnings };
}

/** Bỏ thẻ `<a>` trỏ ra ngoài (giữ chữ) — bài AI không được tự chèn link ngoài vì có thể bịa URL. */
export function unwrapExternalLinks(html: string): string {
  return html.replace(/<a href="https?:\/\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '$1');
}
