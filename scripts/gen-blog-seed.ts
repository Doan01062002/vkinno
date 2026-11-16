// Sinh migrations/0009_blog_seed.sql: 3 bài cẩm nang gốc (src/data/posts.json) + hàng đợi chủ đề ban đầu.
// Chạy: npx.cmd tsx scripts/gen-blog-seed.ts  (chạy lại sẽ ghi đè file; chỉ dùng trước khi migration được áp).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countWords, sanitizeArticleHtml } from '../worker/blog/html';

interface SeedPost {
  title: string;
  slug: string;
  seo_title: string;
  meta_description: string;
  summary: string;
  primary_keyword: string;
  secondary_keywords: string[];
  content: string;
  faq: { q: string; a: string }[];
  image_url: string;
  image_alt: string;
  related_skus: string[];
  sources: { url: string; title: string }[];
  created_at: string;
  updated_at: string;
}

const ROOT = process.cwd();
/** Giờ trong posts.json là giờ Việt Nam; D1 lưu UTC. */
const vnToUtc = (s: string) => `datetime(${q(s)}, '-7 hours')`;
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const SOLAR = 'VK-SOLAR-SHIELD-5L';
const BOSSMAN = 'VK-BOSSMAN-DESCALER-500ML';
const DEGREASER = 'VK-DEGREASER-500ML';
const GLASS500 = 'VK-CLEARWAY-GLASSPRO-500ML';
const GLASS5L = 'VK-CLEARWAY-GLASSPRO-5L';
const VISIONX = 'VK-VISIONX-CLEAN-500ML';
const AUTO5L = 'VK-CLEARWAY-AUTO-5L';
const BOTTLE = 'VK-BOTTLE-SPRAY-500ML';

/** [từ khoá chính, hướng bài, cụm, SKU] — xếp xen kẽ cụm để mỗi ngày một chủ đề khác. */
const TOPICS: [string, string, string, string[]][] = [
  ['tẩy màng dầu kính lái ô tô', 'Nhận biết màng dầu (lóa đèn khi mưa đêm), nguyên nhân, cách tẩy từng bước, sai lầm dùng kem đánh răng/xà phòng', 'kinh-o-to', [VISIONX]],
  ['tẩy cặn canxi vòi sen', 'Đầu sen tắc lỗ, tia nước lệch; tháo ngâm đầu sen, lưu ý lớp mạ chrome', 'nha-tam', [BOSSMAN]],
  ['tẩy dầu mỡ bếp gas', 'Kiềng, mặt bếp inox/kính, đầu đốt; thứ tự làm, hoá chất nào tránh cho inox và kính', 'bep', [DEGREASER]],
  ['rửa pin năng lượng mặt trời bằng nước máy có được không', 'Nước cứng để lại cặn khoáng, cách nhận biết nước cứng, giải pháp lọc/gạt khô', 'pin-mat-troi', [SOLAR]],
  ['lau kính không để lại vệt', 'Vì sao lau kính hay để vệt, khăn microfiber, thứ tự lau, thời điểm (tránh nắng)', 'kinh-nha', [GLASS500, BOTTLE]],
  ['nước rửa kính ô tô pha bình gạt mưa', 'Pha đúng tỷ lệ, vì sao không đổ nước lã/nước rửa chén, vệ sinh bình chứa', 'kinh-o-to', [AUTO5L]],
  ['tẩy cặn canxi bồn cầu', 'Vệt ố vàng đáy bồn cầu do nước cứng, cách ủ, tránh trộn với chất tẩy chứa clo', 'nha-tam', [BOSSMAN]],
  ['vệ sinh mặt kính bếp từ bị cháy đen', 'Vết cháy, ố vàng, vân cầu vồng; dao cạo chuyên dụng, thứ tự xử lý, điều không nên làm', 'bep', [DEGREASER]],
  ['vệ sinh pin mặt trời bị phân chim', 'Phân chim, rêu bám mép khung; làm mềm, chà nhẹ, không cạo; phòng chim đậu', 'pin-mat-troi', [SOLAR]],
  ['kính ô tô bị ố mốc cách xử lý', 'Phân biệt ố nước cứng, mốc, màng dầu; cách xử lý từng loại, khi nào cần đánh bóng', 'kinh-o-to', [VISIONX]],
  ['cách giữ vách kính nhà tắm không bị đóng cặn', 'Phòng ngừa: gạt nước sau khi tắm, thông gió, lịch vệ sinh định kỳ', 'nha-tam', [BOSSMAN, GLASS500]],
  ['tẩy dầu mỡ tường bếp gạch men', 'Gạch men, ron gạch, kính ốp bếp; ủ bọt, chải ron, lưu ý ron xi măng', 'bep', [DEGREASER]],
  ['dụng cụ vệ sinh pin năng lượng mặt trời', 'Chổi lông mềm cán dài, vòi áp lực thấp, gạt cao su, đồ bảo hộ; những dụng cụ không được dùng', 'pin-mat-troi', [SOLAR, BOTTLE]],
  ['vệ sinh cửa kính cường lực văn phòng', 'Mặt dựng kính, vách kính văn phòng; quy trình, pha can 5L, tần suất', 'kinh-nha', [GLASS5L]],
  ['gạt mưa ô tô kêu và để lại vệt', 'Nguyên nhân (màng dầu, lưỡi gạt chai, kính bẩn), cách kiểm tra, khi nào thay lưỡi', 'kinh-o-to', [AUTO5L, VISIONX]],
  ['tẩy cặn canxi lavabo và vòi inox', 'Lavabo sứ, vòi inox/mạ; vệt nước, cặn quanh chân vòi; ủ ngắn, xả kỹ', 'nha-tam', [BOSSMAN]],
  ['vệ sinh tủ bếp bị bám dầu mỡ', 'Tủ gỗ công nghiệp, acrylic, laminate; thử ở góc khuất, không để ướt lâu', 'bep', [DEGREASER]],
  ['vệ sinh pin mặt trời ven biển', 'Hơi muối, ăn mòn khung nhôm, tần suất dày hơn, rửa tráng kỹ', 'pin-mat-troi', [SOLAR]],
  ['lau gương phòng tắm bị mờ', 'Gương mờ do cặn xà phòng và nước cứng; phân biệt gương bị tróc bạc', 'kinh-nha', [GLASS500, BOSSMAN]],
  ['vệ sinh logo mạ chrome ô tô bị ố', 'Logo, viền chrome; ố nước, oxy hoá nhẹ; khăn mềm, tránh chất mài mòn', 'kinh-o-to', [VISIONX]],
  ['nước cứng là gì cách nhận biết nước cứng tại nhà', 'Dấu hiệu cặn trắng ở ấm/vòi/kính, cách thử đơn giản, ảnh hưởng tới thiết bị vệ sinh', 'nha-tam', [BOSSMAN]],
  ['tẩy dầu mỡ nồi chiên không dầu', 'Giỏ chiên chống dính, khoang nhiệt; không dùng búi sắt, chờ nguội, an toàn điện', 'bep', [DEGREASER]],
  ['an toàn khi vệ sinh pin mặt trời trên mái nhà', 'An toàn điện, chống té ngã, giờ nên làm, khi nào nên thuê thợ', 'pin-mat-troi', [SOLAR]],
  ['lái xe ban đêm trời mưa kính lóa', 'Nguyên nhân lóa (màng dầu, xước, kính trong bẩn), cách xử lý và phòng ngừa', 'kinh-o-to', [VISIONX, AUTO5L]],
  ['chất tẩy dầu mỡ có xút NaOH có hại không', 'Phân biệt tẩy kiềm mạnh và dịu; ảnh hưởng tới da tay, nhôm, sơn; đọc nhãn', 'bep', [DEGREASER]],
  ['bình xịt phun sương pha hóa chất tẩy rửa', 'Chọn bình, ghi nhãn, pha đúng tỷ lệ, không trộn nhiều loại, bảo quản', 'dung-cu', [BOTTLE]],
  ['tự vệ sinh hay thuê dịch vụ vệ sinh pin mặt trời', 'So sánh công sức, rủi ro, chi phí tự làm vs thuê; tiêu chí chọn đơn vị dịch vụ', 'pin-mat-troi', [SOLAR]],
  ['vệ sinh kính ô tô bên trong bị mờ', 'Màng mờ do nhựa nội thất bay hơi, khói thuốc; khăn khô ướt, tránh làm ướt taplo', 'kinh-o-to', [VISIONX, GLASS500]],
  ['vệ sinh nhà tắm định kỳ hằng tuần', 'Checklist 15 phút/tuần: kính, vòi, bồn cầu, gạch; chọn chất tẩy theo bề mặt', 'nha-tam', [BOSSMAN, GLASS500]],
  ['vệ sinh máy hút mùi than hoạt tính', 'Phân biệt lưới than/lưới kim loại, khi nào thay, vệ sinh vỏ máy inox', 'bep', [DEGREASER]],
];

const posts = JSON.parse(readFileSync(join(ROOT, 'src/data/posts.json'), 'utf8')) as SeedPost[];

const lines: string[] = [
  '-- 0009: Seed cẩm nang — 3 bài gốc viết lại chuẩn SEO (16/11/2026) + hàng đợi chủ đề ban đầu.',
  '-- Sinh tự động bởi scripts/gen-blog-seed.ts từ src/data/posts.json. Không sửa tay.',
  '-- Hoàn tác: DELETE FROM blog_posts WHERE origin = \'manual\' AND topic_id IS NULL; DELETE FROM blog_topics;',
];

for (const p of [...posts].reverse()) {
  const content = sanitizeArticleHtml(p.content);
  lines.push(
    `INSERT OR IGNORE INTO blog_posts (slug, title, seo_title, meta_description, summary, content_html, faq_json, image_url, image_alt, primary_keyword, secondary_keywords_json, related_skus_json, sources_json, status, origin, word_count, published_at, created_at, updated_at) VALUES (${[
      p.slug,
      p.title,
      p.seo_title,
      p.meta_description,
      p.summary,
      content,
      JSON.stringify(p.faq),
      p.image_url,
      p.image_alt,
      p.primary_keyword,
      JSON.stringify(p.secondary_keywords),
      JSON.stringify(p.related_skus),
      JSON.stringify(p.sources.map(({ url, title }) => ({ url, title }))),
      'published',
      'manual',
    ]
      .map(q)
      .join(', ')}, ${countWords(content)}, ${vnToUtc(p.created_at)}, ${vnToUtc(p.created_at)}, ${vnToUtc(p.updated_at)});`,
  );
}

TOPICS.forEach(([kw, angle, cluster, skus], i) => {
  lines.push(
    `INSERT OR IGNORE INTO blog_topics (primary_keyword, angle, cluster, related_skus_json, priority) VALUES (${q(kw)}, ${q(
      angle,
    )}, ${q(cluster)}, ${q(JSON.stringify(skus))}, ${(i + 1) * 10});`,
  );
});

writeFileSync(join(ROOT, 'migrations/0009_blog_seed.sql'), `${lines.join('\n')}\n`);
console.log(`Đã ghi migrations/0009_blog_seed.sql: ${posts.length} bài, ${TOPICS.length} chủ đề.`);
