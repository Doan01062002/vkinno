// Kiểm bộ icon SVG thay Font Awesome (spec V10) và cách hiển thị nội dung chính sách.
import { describe, expect, it } from 'vitest';
import policies from '../src/data/policies.json';
import { FA_TO_LUCIDE, ICONS, ICON_NAMES, replaceFaIcons, svg } from '../src/shared/icons';
import { renderPolicyHtml, upsizePolicyText } from '../src/shared/policy-html';

describe('icons.ts', () => {
  it('mọi tên trong bảng ánh xạ đều có path SVG', () => {
    for (const name of Object.values(FA_TO_LUCIDE)) {
      expect(ICON_NAMES).toContain(name);
      expect(ICONS[name].length, name).toBeGreaterThan(10);
    }
  });

  it('svg() cỡ 1em, ẩn với trình đọc màn hình, giữ class truyền vào', () => {
    const out = svg('menu', 'text-xl text-[#1E2B6B]');
    expect(out).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(out).toContain('focusable="false"');
    expect(out).toContain('w-[1em] h-[1em]');
    expect(out).toContain('text-xl text-[#1E2B6B]');
    expect(svg('facebook')).toContain('fill="currentColor"');
  });

  it('replaceFaIcons đổi thẻ <i class="fa-…"> sang SVG và giữ class phụ', () => {
    const html = '<p><i class="fa-solid fa-circle-info mr-1 text-amber-600"></i> Lưu ý</p>';
    const out = replaceFaIcons(html);
    expect(out).not.toContain('fa-');
    expect(out).toContain('mr-1 text-amber-600');
    expect(out).toContain('<svg');
  });

  it('nội dung policies.json sau khi hiển thị không còn icon Font Awesome, icon menu đều có ánh xạ', () => {
    for (const p of Object.values(policies) as Array<{ icon: string; content: string }>) {
      expect(FA_TO_LUCIDE[p.icon], p.icon).toBeDefined();
      expect(renderPolicyHtml(p.content)).not.toMatch(/<i class="fa-/);
    }
  });

  it('upsizePolicyText nâng thân bài text-xs lên text-sm, không đụng badge span', () => {
    const html = '<p class="text-slate-600 text-xs">A</p><span class="text-xs font-semibold">B</span><div class="space-y-2 text-xs">C</div>';
    const out = upsizePolicyText(html);
    expect(out).toContain('<p class="text-slate-600 text-sm">');
    expect(out).toContain('<span class="text-xs font-semibold">');
    expect(out).toContain('<div class="space-y-2 text-sm">');
  });
});
