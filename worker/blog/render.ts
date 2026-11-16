// Dựng HTML cho cẩm nang (thân trang bài, danh sách, thẻ bài, JSON-LD, sitemap, robots).
// Khung trang (head, header, footer) do Astro build ở /vk-khung/*; file này chỉ dựng phần ruột.
import { products } from '../../src/data/products';
import { svg } from '../../src/shared/icons';
import { addHeadingIds, esc, jsonForScript, labelTableCells, stripTags } from './html';
import { parseJsonArray, sqlToIso, type BlogPostRow, type FaqItem, type SourceItem } from './store';

export const SITE_URL = 'https://vkinno.vn';
export const BLOG_PATH = '/cam-nang';
export const PAGE_SIZE = 12;
const DEFAULT_IMAGE = '/images/og-vkinno.jpg';
export const AI_NOTE =
  'Bài được biên soạn với sự hỗ trợ của công cụ AI và được đội ngũ kỹ thuật VKINNO rà soát nội dung trước khi đăng.';

/** dd/mm/yyyy theo giờ Việt Nam. */
export function vnDate(sql: string | null | undefined): string {
  const d = new Date(new Date(sqlToIso(sql)).getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Phút đọc ước tính (~220 chữ/phút), tối thiểu 1. */
export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 220));
}

export function postUrl(slug: string): string {
  return `${SITE_URL}${BLOG_PATH}/${slug}`;
}

function absoluteImage(path: string): string {
  const p = path || DEFAULT_IMAGE;
  return p.startsWith('http') ? p : `${SITE_URL}${p.startsWith('/') ? '' : '/'}${p}`;
}

function relatedProducts(post: BlogPostRow) {
  const skus = parseJsonArray<string>(post.related_skus_json);
  return skus
    .map((sku) => products.find((p) => p.sku === sku))
    .filter((p): p is (typeof products)[number] => Boolean(p))
    .slice(0, 3);
}

/** JSON-LD: BlogPosting + BreadcrumbList (+ FAQPage nếu có FAQ). */
export function postSchema(post: BlogPostRow, author: string): Record<string, unknown>[] {
  const url = postUrl(post.slug);
  const faq = parseJsonArray<FaqItem>(post.faq_json).filter((f) => f && f.q && f.a);
  const out: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.meta_description || post.summary,
      image: [absoluteImage(post.image_url)],
      datePublished: sqlToIso(post.published_at || post.created_at),
      dateModified: sqlToIso(post.updated_at),
      wordCount: post.word_count,
      inLanguage: 'vi-VN',
      keywords: [post.primary_keyword, ...parseJsonArray<string>(post.secondary_keywords_json)].filter(Boolean).join(', '),
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      author: { '@type': 'Organization', name: author, url: `${SITE_URL}/gioi-thieu` },
      publisher: {
        '@type': 'Organization',
        name: 'VKINNO',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Cẩm nang', item: `${SITE_URL}${BLOG_PATH}` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (faq.length) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return out;
}

/** Thẻ bài trong danh sách / bài liên quan. */
export function postCard(post: BlogPostRow): string {
  const href = `${BLOG_PATH}/${esc(post.slug)}`;
  const img = esc(post.image_url || DEFAULT_IMAGE);
  return `
<article class="vk-post-card group">
  <a href="${href}" class="vk-post-card__media" tabindex="-1" aria-hidden="true">
    <img src="${img}" alt="${esc(post.image_alt || post.title)}" width="600" height="375" loading="lazy" />
  </a>
  <div class="vk-post-card__body">
    <div class="vk-post-card__meta">
      <span class="vk-chip">Hướng dẫn</span>
      <span>${vnDate(post.published_at || post.created_at)}</span>
      <span aria-hidden="true">·</span>
      <span>${readingMinutes(post.word_count)} phút đọc</span>
    </div>
    <h2 class="vk-post-card__title"><a href="${href}">${esc(post.title)}</a></h2>
    <p class="vk-post-card__summary">${esc(post.summary)}</p>
    <a href="${href}" class="vk-post-card__more">Đọc hướng dẫn ${svg('move-right')}</a>
  </div>
</article>`;
}

/** Ruột trang một bài. */
export function renderPostBody(
  post: BlogPostRow,
  opts: { author: string; related: BlogPostRow[]; preview?: boolean },
): string {
  const { html, toc } = addHeadingIds(labelTableCells(post.content_html));
  const faq = parseJsonArray<FaqItem>(post.faq_json).filter((f) => f && f.q && f.a);
  const sources = parseJsonArray<SourceItem>(post.sources_json).filter((s) => s && /^https?:\/\//.test(s.url));
  const prods = relatedProducts(post);
  const published = vnDate(post.published_at || post.created_at);
  const updated = vnDate(post.updated_at);
  const showUpdated = updated !== published;
  const minutes = readingMinutes(post.word_count);

  const tocHtml = toc.length
    ? `<nav class="vk-toc" aria-label="Mục lục">
  <p class="vk-toc__title">Nội dung bài viết</p>
  <ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}${
    faq.length ? '<li><a href="#cau-hoi-thuong-gap">Câu hỏi thường gặp</a></li>' : ''
  }</ol>
</nav>`
    : '';

  const faqHtml = faq.length
    ? `<section class="vk-faq" aria-labelledby="cau-hoi-thuong-gap">
  <h2 id="cau-hoi-thuong-gap">Câu hỏi thường gặp</h2>
  ${faq
    .map(
      (f, i) => `<details class="vk-faq__item"${i === 0 ? ' open' : ''}>
    <summary>${esc(f.q)}</summary>
    <p>${esc(f.a)}</p>
  </details>`,
    )
    .join('')}
</section>`
    : '';

  const productsHtml = prods.length
    ? `<aside class="vk-related-products" aria-label="Sản phẩm dùng trong bài">
  <p class="vk-side-title">Sản phẩm dùng trong bài</p>
  ${prods
    .map(
      (p) => `<a class="vk-mini-product" href="/san-pham/${esc(p.slug)}">
    <img src="${esc(p.image_url)}" alt="${esc(p.name)}" width="64" height="64" loading="lazy" />
    <span><strong>${esc(p.name)}</strong><em>Xem chi tiết sản phẩm</em></span>
  </a>`,
    )
    .join('')}
</aside>`
    : '';

  const sourcesHtml = sources.length
    ? `<section class="vk-sources" aria-label="Nguồn tham khảo">
  <p class="vk-side-title">Nguồn tham khảo</p>
  <ul>${sources
    .map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.title || s.url)}</a></li>`)
    .join('')}</ul>
</section>`
    : '';

  const relatedHtml = opts.related.length
    ? `<section class="vk-related" aria-labelledby="bai-lien-quan">
  <h2 id="bai-lien-quan" class="vk-section-title">Bài viết liên quan</h2>
  <div class="vk-post-grid">${opts.related.map(postCard).join('')}</div>
</section>`
    : '';

  const previewBanner = opts.preview
    ? `<div class="vk-preview-banner" role="status">Bản xem trước — bài đang ở trạng thái <strong>${esc(
        post.status,
      )}</strong>, khách chưa nhìn thấy.</div>`
    : '';

  return `
<div class="vk-blog">
  ${previewBanner}
  <div class="vk-blog__wrap">
    <nav class="vk-breadcrumb" aria-label="Breadcrumb">
      <a href="/">Trang chủ</a><span aria-hidden="true">/</span><a href="${BLOG_PATH}">Cẩm nang</a><span aria-hidden="true">/</span><span aria-current="page">${esc(
        post.title,
      )}</span>
    </nav>

    <header class="vk-post-hero">
      <span class="vk-chip">Cẩm nang kỹ thuật</span>
      <h1>${esc(post.title)}</h1>
      <p class="vk-post-hero__summary">${esc(post.summary)}</p>
      <div class="vk-post-hero__meta">
        <span>${svg('user-cog')} ${esc(opts.author)}</span>
        <span>${svg('calendar')} <time datetime="${sqlToIso(
          post.published_at || post.created_at,
        )}">${published}</time></span>
        ${
          showUpdated
            ? `<span>${svg('rotate-cw')} Cập nhật <time datetime="${sqlToIso(
                post.updated_at,
              )}">${updated}</time></span>`
            : ''
        }
        <span>${svg('clock')} ${minutes} phút đọc</span>
      </div>
    </header>

    ${
      post.image_url
        ? `<figure class="vk-post-cover"><img src="${esc(post.image_url)}" alt="${esc(
            post.image_alt || post.title,
          )}" width="1200" height="675" fetchpriority="high" /></figure>`
        : ''
    }

    <div class="vk-post-layout">
      <article class="vk-article">
        ${tocHtml ? `<div class="vk-toc-mobile">${tocHtml}</div>` : ''}
        ${html}
        ${faqHtml}
        ${post.origin === 'ai' ? `<p class="vk-ai-note">${svg('info')} ${esc(AI_NOTE)}</p>` : ''}
        <div class="vk-post-share">
          <a href="${BLOG_PATH}" class="vk-link-back">${svg('arrow-left')} Tất cả bài viết</a>
          <a class="vk-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
            postUrl(post.slug),
          )}" target="_blank" rel="noopener noreferrer" aria-label="Chia sẻ bài viết lên Facebook">${svg('facebook')}</a>
        </div>
      </article>
      <div class="vk-post-aside">
        <div class="vk-post-aside__sticky">
          ${tocHtml ? `<div class="vk-toc-desktop">${tocHtml}</div>` : ''}
          ${productsHtml}
          <div class="vk-help-box">
            <p class="vk-side-title">Cần tư vấn pha chế?</p>
            <p>Kỹ thuật viên VKINNO hướng dẫn tỷ lệ pha và cách dùng theo bề mặt của bạn.</p>
            <a href="https://zalo.me/0938791389" target="_blank" rel="noopener noreferrer" class="vk-btn-zalo">Nhắn Zalo 0938.791.389</a>
          </div>
          ${sourcesHtml}
        </div>
      </div>
    </div>

    ${relatedHtml}
  </div>
</div>`;
}

/** Ruột trang danh sách. */
export function renderListBody(rows: BlogPostRow[], page: number, totalPages: number): string {
  const pager =
    totalPages > 1
      ? `<nav class="vk-pager" aria-label="Phân trang">${Array.from({ length: totalPages }, (_, i) => i + 1)
          .map((n) =>
            n === page
              ? `<span aria-current="page">${n}</span>`
              : `<a href="${n === 1 ? BLOG_PATH : `${BLOG_PATH}?trang=${n}`}">${n}</a>`,
          )
          .join('')}</nav>`
      : '';
  const grid = rows.length
    ? `<div class="vk-post-grid">${rows.map(postCard).join('')}</div>`
    : '<p class="vk-empty">Chưa có bài viết nào.</p>';
  return `
<div class="vk-blog">
  <div class="vk-blog__wrap">
    <nav class="vk-breadcrumb" aria-label="Breadcrumb"><a href="/">Trang chủ</a><span aria-hidden="true">/</span><span aria-current="page">Cẩm nang</span></nav>
    <header class="vk-list-hero">
      <span class="vk-chip">Cẩm nang kỹ thuật VKINNO</span>
      <h1>Cẩm nang làm sạch &amp; chăm sóc bề mặt</h1>
      <p>Hướng dẫn tỷ lệ pha, thời gian ủ và lưu ý vật liệu khi vệ sinh tấm pin mặt trời, nhà tắm, bếp và kính ô tô${
        page > 1 ? ` — trang ${page}` : ''
      }.</p>
    </header>
    ${grid}
    ${pager}
  </div>
</div>`;
}

/** JSON-LD trang danh sách. */
export function listSchema(rows: BlogPostRow[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Cẩm nang kỹ thuật VKINNO',
    url: `${SITE_URL}${BLOG_PATH}`,
    inLanguage: 'vi-VN',
    blogPost: rows.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: postUrl(p.slug),
      datePublished: sqlToIso(p.published_at || p.created_at),
    })),
  };
}

export interface ShellValues {
  title: string;
  description: string;
  canonical: string;
  image: string;
  schema: unknown;
  body: string;
  robots?: string;
}

/**
 * Điền khung trang Astro. Khung chứa các chuỗi giữ chỗ:
 * `__VK_TITLE__VKINNO` (chứa chữ VKINNO để SEOHead không gắn đuôi dài), `__VK_DESC__`, `https://vkinno.vn/__VK_CANONICAL__`, `https://vkinno.vn/__VK_IMAGE__`,
 * `"__VK_SCHEMA__"` (trong JSON-LD), `<!--__VK_BODY__-->`.
 */
export function fillShell(shell: string, v: ShellValues): string {
  let out = shell
    .split(`${SITE_URL}/__VK_CANONICAL__`).join(esc(v.canonical))
    .split(`${SITE_URL}/__VK_IMAGE__`).join(esc(absoluteImage(v.image)))
    .split('__VK_TITLE__VKINNO').join(esc(/vkinno/i.test(v.title) ? v.title : `${v.title} | VKINNO`))
    .split('__VK_DESC__').join(esc(v.description))
    .split('"__VK_SCHEMA__"').join(jsonForScript(v.schema));
  if (v.robots) {
    out = out.replace(/<meta name="robots" content="[^"]*"\s*\/?>/, `<meta name="robots" content="${esc(v.robots)}">`);
  }
  const marker = '<!--__VK_BODY__-->';
  const i = out.indexOf(marker);
  return i === -1 ? out : out.slice(0, i) + v.body + out.slice(i + marker.length);
}

/** Mô tả meta dự phòng từ nội dung (≤ 160 ký tự). */
export function fallbackDescription(post: BlogPostRow): string {
  const t = post.meta_description || post.summary || stripTags(post.content_html);
  return t.length > 160 ? `${t.slice(0, 157).replace(/\s+\S*$/, '')}…` : t;
}

export function renderSitemap(rows: { slug: string; updated_at: string; published_at: string | null }[]): string {
  const latest = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
  const items = [
    `<url><loc>${SITE_URL}${BLOG_PATH}</loc>${latest ? `<lastmod>${sqlToIso(latest)}</lastmod>` : ''}</url>`,
    ...rows.map((r) => `<url><loc>${esc(postUrl(r.slug))}</loc><lastmod>${sqlToIso(r.updated_at)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>\n`;
}

/** robots.txt: host staging (*.workers.dev) chặn toàn bộ; host thật khai báo 2 sitemap. */
export function renderRobots(host: string): string {
  if (host.endsWith('.workers.dev') || host === 'localhost' || host.startsWith('127.')) {
    return 'User-agent: *\nDisallow: /\n';
  }
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /quan-tri',
    'Disallow: /api/',
    'Disallow: /gio-hang',
    'Disallow: /thanh-toan',
    'Disallow: /tai-khoan',
    '',
    `Sitemap: ${SITE_URL}/sitemap-index.xml`,
    `Sitemap: ${SITE_URL}/sitemap-cam-nang.xml`,
    '',
  ].join('\n');
}
