// Hiển thị nội dung chính sách (src/data/policies.json) mà KHÔNG sửa file nội dung pháp lý:
// đổi icon Font Awesome sang SVG và nâng cỡ chữ thân bài từ 12px lên 14px (spec V9/V10.3).
import { replaceFaIcons } from "./icons";

const BODY_TAG_WITH_XS = /<(p|ul|ol|li|div)(\s[^>]*?)class="([^"]*)"/g;

/** Khối thân bài (p, ul, ol, li, div) đang text-xs thì đổi sang text-sm; badge (span) giữ nguyên. */
export function upsizePolicyText(html: string): string {
  return html.replace(BODY_TAG_WITH_XS, (_m, tag: string, before: string, cls: string) => {
    const next = cls
      .split(/\s+/)
      .map((c) => (c === "text-xs" ? "text-sm" : c))
      .join(" ");
    return `<${tag}${before}class="${next}"`;
  });
}

/** HTML chính sách sẵn sàng để set:html. */
export function renderPolicyHtml(html: string): string {
  return upsizePolicyText(replaceFaIcons(html));
}
