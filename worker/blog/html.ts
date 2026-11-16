// Tiện ích HTML cho cẩm nang: escape, lọc thẻ theo danh sách cho phép (không cần DOM, chạy được cả
// trên Worker lẫn Node), đếm chữ, gắn id cho H2 để làm mục lục.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape cho văn bản và giá trị thuộc tính HTML. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** JSON an toàn để nhúng trong `<script type="application/ld+json">`. */
export function jsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const ALLOWED = new Set([
  'p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote',
]);
/** Thẻ bị bỏ cả nội dung bên trong. */
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'textarea', 'select', 'button'];
const RENAME: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3' };

function decodeAttr(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return decodeAttr(m[1] ?? m[2] ?? m[3] ?? '');
}

/** Link hợp lệ: đường dẫn nội bộ "/..." hoặc http(s). Trả null nếu không an toàn. */
export function safeHref(raw: string, siteHost = 'vkinno.vn'): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (href.startsWith('/') && !href.startsWith('//')) return { href, external: false };
  if (href.startsWith('#')) return { href, external: false };
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '');
  if (host === siteHost) return { href: `${u.pathname}${u.search}${u.hash}`, external: false };
  return { href: u.toString(), external: true };
}

/** Văn bản thuần (escape lại mọi ký tự đặc biệt, giữ thực thể HTML hợp lệ). */
function cleanText(t: string): string {
  return t.replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Lọc HTML bài viết theo danh sách thẻ cho phép. Bỏ mọi thuộc tính trừ `href` của `<a>`;
 * link ngoài thêm `rel="nofollow noopener" target="_blank"`. Thẻ lạ bị bỏ (giữ chữ bên trong),
 * script/style/iframe... bị bỏ cả nội dung. Tự đóng các thẻ còn mở.
 */
export function sanitizeArticleHtml(input: string, siteHost = 'vkinno.vn'): string {
  let html = String(input ?? '').replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(?:</${tag}\\s*>|$)`, 'gi'), '');
  }
  html = html.replace(/<br\s*\/?>/gi, ' ');
  const out: string[] = [];
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    out.push(cleanText(html.slice(last, m.index)));
    last = tagRe.lastIndex;
    const closing = m[1] === '/';
    let name = m[2].toLowerCase();
    name = RENAME[name] ?? name;
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue;
      while (stack.length > idx) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (name === 'a') {
      const link = safeHref(readAttr(m[3], 'href') ?? '', siteHost);
      if (!link) continue;
      out.push(
        link.external
          ? `<a href="${esc(link.href)}" rel="nofollow noopener" target="_blank">`
          : `<a href="${esc(link.href)}">`,
      );
    } else {
      out.push(`<${name}>`);
    }
    stack.push(name);
  }
  out.push(cleanText(html.slice(last)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out
    .join('')
    .replace(/<(p|li|h2|h3|strong|em)>\s*<\/\1>/g, '')
    .trim();
}

/** Bỏ thẻ, giải mã vài thực thể phổ biến, gộp khoảng trắng. */
export function stripTags(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Số chữ (tách theo khoảng trắng — tiếng Việt mỗi âm tiết là một "chữ"). */
export function countWords(html: string): number {
  const t = stripTags(html);
  return t ? t.split(' ').length : 0;
}

/** Slug tiếng Việt không dấu: "Tẩy cặn canxi" → "tay-can-canxi". */
export function slugify(s: string, max = 90): string {
  const out = String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out.slice(0, max).replace(/-+$/g, '');
}

/** Gắn `id` cho mỗi `<h2>` (để làm mục lục) và trả danh sách mục. */
export function addHeadingIds(html: string): { html: string; toc: { id: string; text: string }[] } {
  const toc: { id: string; text: string }[] = [];
  const used = new Set<string>();
  const out = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_all, inner: string) => {
    const text = stripTags(inner);
    let id = slugify(text, 60) || `muc-${toc.length + 1}`;
    while (used.has(id)) id = `${id}-${toc.length + 1}`;
    used.add(id);
    toc.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

/** Gắn `data-label` (tên cột) cho từng `<td>` để bảng hiển thị dạng thẻ trên điện thoại. */
export function labelTableCells(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (whole, inner: string) => {
    const head = /<thead>([\s\S]*?)<\/thead>/.exec(inner);
    if (!head) return whole;
    const labels = [...head[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => esc(stripTags(m[1])));
    if (!labels.length) return whole;
    const body = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells: string) => {
      if (!cells.includes('<td>')) return row;
      let i = 0;
      return `<tr>${cells.replace(/<td>/g, () => `<td data-label="${labels[i++] ?? ''}">`)}</tr>`;
    });
    return `<table class="vk-table">${body}</table>`;
  });
}
