---
title: Spec thiết kế sửa giao diện mobile VKINNO (đợt 1)
type: spec-thiet-ke
status: nháp
created: 2026-11-16
department: Phòng Thiết kế
du_an: vkinno
nguoi_nhan: Phòng Kỹ thuật FE
tags:
  - vkinno
  - mobile
  - wcag-2-2
  - spec
---

# Spec thiết kế: sửa giao diện mobile VKINNO (đợt 1)

Liên quan: [[02-seo-tieu-de-mo-ta]] (spec SEO cùng đợt) · [[../superpowers/specs/2026-11-16-cam-nang-seo-tu-dong-design]] (Cẩm nang do phiên khác làm) · [[../van-hanh]].

## 🤝 Handoff Summary (Cho Phòng Kế Tiếp)
- **Phạm vi:** 11 việc (V1–V11) + 3 lỗi phát hiện thêm (V12). Chỉ sửa cho gọn, rõ, dễ bấm, **không đổi phong cách**: giữ navy `#1E2B6B`/`#0F1638`, cam `#FF8A15`/`#A84B00`, font Be Vietnam Pro + Inter, logo, nội dung pháp lý.
- **Ưu tiên chạy trước:** V1 header (nút giỏ vượt mép màn hình 6px ở 375px, 21px ở 360px) → V3 nút Zalo nổi → V5 breadcrumb → V8/V9 vùng bấm + cỡ chữ → V6 banner → V10 icon → V11 font.
- **Ngưỡng nghiệm thu:** `scrollWidth === innerWidth` ở 360/375/390px; 0 phần tử bấm < 44×44px trong `main`, header, footer, ngăn kéo giỏ; 0 chữ < 12px; mọi `<p>` thân bài ≥ 14px; 0 nút nổi đè chữ ở < 1024px.
- **Không thêm thư viện.** Icon dùng SVG inline lấy từ `lucide-react` 1.66.0 đã có trong `node_modules` (chép path, không thêm runtime JS). Bỏ hẳn Font Awesome CDN: giảm 18KB CSS chặn hiển thị + 276KB font.
- **Không đụng:** `worker/`, `wrangler.jsonc`, `astro.config.mjs`, `src/pages/cam-nang`, `src/pages/vk-khung`, `src/styles/blog.css`. Phần breadcrumb + icon của Cẩm nang để ở mục "Gửi phiên Cẩm nang" (V5.4, V10.6).
- **Kiểm:** đoạn JS ở mục 3 (dán vào DevTools) + `qa_web.py --require-browser --require-visual-craft` ở 1440×900, 375×812, 360×800.

## 🔍 0. Mẫu Tham Chiếu, Skill & Thư Viện Đã Nghiên Cứu

| Nguồn | Ngày xem | Điều học được, dùng ở việc nào |
|---|---|---|
| Staging `https://vkinno-web-staging.vkinno.workers.dev` (12 trang, 360×800 và 375×812) | 16/11/2026 | Đo thật bằng JS: header tràn tới 381px; 22–28 vùng bấm < 44px mỗi trang; 85 phần tử chữ 12px trên trang chủ; Zalo nổi đè `<p>` ở `/gioi-thieu`; "Trang chủ" vỡ 2 dòng (55×32px) ở `/chinh-sach/*` |
| `https://hasaki.vn` (375×812) | 16/11/2026 | Banner mobile là ảnh dàn lại cho mobile, chữ to; nút chat nổi chỉ là icon tròn, không phải viên dài có chữ. Nhưng icon header của họ 36×34px, dưới chuẩn 44px: không chép điểm này (V6, V3) |
| `https://www.bachhoaxanh.com` (375×812) | 16/11/2026 | Thanh đáy 4–5 tab cao 54px, có "Đơn hàng"; không có nút chat nổi đè nội dung; header không lặp lại chức năng đã có ở thanh đáy (V1, V3, V4) |
| `https://www.thegioididong.com/dtdd` (375×812) | 16/11/2026 | Breadcrumb 1 dòng, dấu `>` nhạt, chữ xám, mục cuối cắt bằng dấu "…" (V5) |
| Shopee Mall web | không xem | Bị yêu cầu đăng nhập/ứng dụng trên mobile web, bỏ qua |

- **Skill đã nạp:** `web-interface-guidelines` (bản ghim `rules.md`: vùng bấm, `touch-action`, safe-area, `min-w-0` cho truncate, autoplay > 5s phải dừng được); `impeccable` (tham chiếu `audit.md`: WCAG 2.5.8, cuộn ngang, cỡ chữ). Không chạy được trình nạp ngữ cảnh của `impeccable` nên đọc trực tiếp tài liệu. `apple-design`, `ui-styling` không nạp riêng: việc này là sửa nhỏ, không có chuyển động mới, quy tắc vùng bấm/cỡ chữ đã đủ ở hai skill trên.
- **Mẫu motion (`motionsites.ai`, `gsap.com`, `21st.dev`):** không tra, vì ràng buộc cứng của brief là không thêm thư viện chuyển động.
- **Thư viện:** không cài mới. Dùng `lucide-react@1.66.0` (đã có, giấy phép ISC) làm nguồn path SVG; icon Facebook lấy từ Simple Icons (CC0) vì Lucide v1 đã bỏ icon thương hiệu.

## 1. Quy ước chung cho cả spec

- **Breakpoint:** "mobile" = `< 640px` (không tiền tố Tailwind). Mọi thay đổi chỉ dành cho mobile phải kèm `sm:` để giữ nguyên giao diện desktop.
- **Vùng bấm:** dùng `min-h-11` / `size-11` (= 44px, thang spacing Tailwind v4). Không dùng `::after` nới vùng bấm, vì công cụ đo dùng `getBoundingClientRect`.
- **Cỡ chữ:** thân bài (`<p>`, `<li>` mô tả, đoạn văn) ≥ `text-sm` (14px) trên mobile. Nhãn phụ (badge, eyebrow, ngày, giá gạch, nhãn form, nhãn tab) ≥ `text-xs` (12px). Cấm `text-[9px]`, `text-[10px]`, `text-[11px]`.
- **Tiêu đề tiếng Việt:** `leading-[1.3]` trở lên; không dùng `leading-tight`/`leading-none` cho chữ in hoa có dấu.
- **Màu:** chỉ dùng mã màu đã có trong `src/styles/global.css` `:root`. Màu mới duy nhất là nền banner mobile `#EEF4FF`/`#F2F6FF`, lấy từ nền sẵn có của chính ảnh banner.

## 2. Danh sách việc

### V1. Header mobile: bỏ tràn ngang

- **File:** `src/components/Header.astro` (dòng 72–159).
- **Hiện trạng [VERIFIED, đo 375px]:** vùng nội dung 343px; tổng con 365px = menu 44 + gap 12 + logo 150 (ảnh 137,8px + 12px lề thừa do `space-x-3` đặt lề cho `div` đã `hidden`) + gap 12 + cụm nút 147 (3 nút × 44 + 2 × 8). Nút giỏ `right = 381px` (375px) và `381px` (360px).
- **Thay đổi:**
  1. Hàng chính (dòng 73): `gap-3 sm:gap-4` → `gap-2 sm:gap-4`.
  2. Link logo (dòng 84): `flex items-center space-x-3 shrink-0` → `flex items-center gap-3 shrink-0 min-h-11 mr-auto`. `gap` bỏ qua phần tử `display:none` nên mất 12px lề thừa. Giữ ảnh `h-8 sm:h-9`.
  3. Link "Tra cứu đơn" (dòng 133–141): đổi `flex` → `hidden sm:flex`. Mobile đã có tab "Tra đơn" ở thanh đáy và mục "Tra cứu đơn hàng VKxxxx" trong menu kéo (đúng mẫu Bách Hóa Xanh).
  4. Cụm nút (dòng 119): `flex items-center space-x-2 sm:space-x-3` → `flex items-center gap-2 sm:gap-3 shrink-0`.
  5. Nút tìm kiếm mobile (dòng 120–127): thêm `aria-expanded="false"` + `aria-controls="mobile-search-bar-panel"`; script dòng 386–389 đổi `aria-expanded` khi bật/tắt. Icon 18px (`text-lg`).
  6. Nút tìm trong ô tìm mobile (dòng 177–184): `w-9 h-9` → `size-11`; input (dòng 168) `py-2.5` → `py-3`.
  7. Huy hiệu số lượng giỏ (dòng 152): `text-[11px]` → `text-xs`.
- **Kết quả dự tính:** 360px: 44 + 8 + 138 + 8 + 96 = 294px ≤ 328px (dư 34px); 375px: dư 49px. Đã thử bằng cách chèn style trực tiếp trên staging ở 360px: `scrollWidth = 360`, nút giỏ `right = 338px`.
- **Cách kiểm:** 360×800, 375×812, 390×844: `document.documentElement.scrollWidth === innerWidth`; `#header-cart-trigger.getBoundingClientRect().right <= innerWidth - 16`. 768px và 1440px: header giống hệt hiện tại.

### V2. Thanh chữ trên cùng (trust bar)

- **File:** `src/components/Header.astro` dòng 29–69.
- **Hiện trạng:** chữ 11px bị cắt "…"; icon Facebook (8×20px) và Shopee (14×20px) quá nhỏ để bấm.
- **Thay đổi:**
  1. Dòng 29: `py-1.5` → `py-2`; `font-semibold` → `font-bold` (để bỏ được độ đậm 600 của Be Vietnam Pro, xem V11).
  2. Dòng 32: `text-[11px] sm:text-xs` → `text-xs`. Tách 2 câu: `<span class="sm:hidden">FREESHIP TOÀN QUỐC ĐƠN TỪ 199.000Đ</span><span class="hidden sm:inline">` + câu đầy đủ hiện tại + `</span>`. Chỉ rút gọn trên mobile, không thêm cam kết mới. Hotline vẫn có ở menu kéo, footer, trang Liên hệ.
  3. Cụm icon phải (dòng 36): `flex items-center space-x-3` → `hidden sm:flex items-center gap-3`. Footer đã có 2 link này ở cỡ 44px (V8).
- **Cách kiểm:** 360px: câu hiển thị trọn, không có "…"; chữ đo được 12px.

### V3. Nút "Zalo Tư Vấn" nổi: chuyển vào thanh đáy trên mobile

- **Hiện trạng [VERIFIED]:** viên Zalo `fixed right-4 bottom-[76px]`, 128×46px ở 375px, đè lên `<p>` ở `/`, `/gioi-thieu`, `/cam-nang`. Thanh đáy chỉ có 4 tab.
- **Hướng chọn:** bỏ nút nổi trên mobile, thêm tab thứ 5 "Zalo" vào thanh đáy. Thanh đáy đã có khoảng trống dưới `body` (`padding-bottom: 68px`) nên không che chữ. Thu nhỏ thành icon tròn kiểu Hasaki vẫn đè nội dung, nên không chọn.
- **Thay đổi:**
  1. `src/layouts/Layout.astro` dòng 70–80: class của thẻ `<a>` → luôn là `hidden lg:inline-flex fixed lg:bottom-6 lg:right-6 z-[130] …` (bỏ nhánh `inline-flex` cho mobile). Giữ prop `hideFloatingZaloOnMobile` để không vỡ các trang đang truyền, nhưng prop không còn tác dụng; ghi chú `@deprecated` trong `interface Props`.
  2. `src/components/Header.astro`, thanh đáy (dòng 333–380): chèn tab Zalo **ở vị trí 3** (giữa Cửa hàng và Giỏ hàng: ngón cái phải lẫn trái đều với tới):

     ```astro
     <a href={SITE_CONFIG.zaloUrl} target="_blank" rel="noopener noreferrer"
        aria-label="Nhắn Zalo tư vấn kỹ thuật VKINNO"
        class="flex-1 min-w-0 flex flex-col items-center justify-center h-14 rounded-xl text-[#0052CC]">
       <span class="flex items-center justify-center size-8 rounded-full bg-[#E8F0FE]">
         <Icon name="message-circle-more" class="text-xl" />
       </span>
       <span class="text-xs font-bold mt-0.5">Zalo</span>
     </a>
     ```
  3. 4 tab còn lại: `min-w-[64px] h-12` → `flex-1 min-w-0 h-14` để 5 tab chia đều (72px/tab ở 360px).
- **Trang sản phẩm:** giữ nguyên, thanh dính đáy đã có nút Zalo và thanh đáy đang bị ẩn ở đó.
- **Cách kiểm:** 360/375px, cuộn hết `/`, `/gioi-thieu`, `/lien-he`, `/cam-nang`, `/chinh-sach`: không còn phần tử `position:fixed` nào ngoài header và thanh đáy giao với `main p, main li, main h2, main h3`. 1440px: viên Zalo vẫn ở góc phải dưới như cũ.

### V4. Thanh đáy & thanh dính trang sản phẩm: safe-area, nhãn 12px

- **Files:** `src/components/SEOHead.astro` dòng 71; `src/components/Header.astro` dòng 333–380; `src/pages/san-pham/[slug].astro` dòng 447–473.
- **Thay đổi:**
  1. Viewport meta: `width=device-width, initial-scale=1.0` → `width=device-width, initial-scale=1, viewport-fit=cover` (để `env(safe-area-inset-bottom)` có giá trị trên iPhone; `global.css` dòng 314–318 đang dùng sẵn biến này).
  2. Thanh đáy: `h-16` → `h-[calc(64px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]`. Nhãn tab `text-[11px] font-semibold` → `text-xs font-semibold`. Icon `text-base` → `text-xl` (20px). Huy hiệu giỏ (dòng 364) `text-[10px] min-w-[18px] h-[18px]` → `text-xs min-w-5 h-5`.
  3. Thanh dính trang sản phẩm: `py-2.5` → `pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]`; nút Zalo trong thanh: `text-[10px]` → `text-xs`.
  4. Thêm vào `src/styles/global.css` (cuối file): `a, button, [role="button"], label { touch-action: manipulation; -webkit-tap-highlight-color: rgb(30 43 107 / 0.12); }`.
- **Cách kiểm:** DevTools giả lập iPhone 14 (390×844): thanh đáy không dính sát vạch home; nhãn tab đo được 12px.

### V5. Breadcrumb: một dòng, không vỡ chữ

- **Nguyên nhân [VERIFIED]:** `nav.flex.space-x-2` không có `whitespace-nowrap`; link "Trang chủ" bị co (flex-shrink) nên xuống 2 dòng (55×32px ở `/chinh-sach/chinh-sach-doi-tra`), trong khi mục cuối giữ `max-w-[250px]`.
- **V5.1 Tạo component** `src/components/Breadcrumb.astro`:

  ```astro
  ---
  import Icon from "./Icon.astro";
  interface Item { label: string; href?: string }
  interface Props { items: Item[]; tone?: "light" | "dark"; class?: string }
  const { items, tone = "light", class: cls = "" } = Astro.props;
  const last = items.length - 1;
  const link = tone === "dark" ? "text-slate-300 hover:text-[#FF8A15]" : "text-[#475569] hover:text-[#1E2B6B]";
  const current = tone === "dark" ? "text-white" : "text-[#0F172A] font-bold";
  ---
  <nav aria-label="Breadcrumb" class={`min-w-0 ${cls}`}>
    <ol class="flex items-center gap-1 min-w-0 whitespace-nowrap text-[13px] leading-5 font-semibold">
      {items.map((it, i) => (
        <li class={i === last ? "min-w-0 flex-1" : "shrink-0 flex items-center gap-1"}>
          {i === last || !it.href
            ? <span aria-current="page" class={`block truncate ${current}`}>{it.label}</span>
            : <a href={it.href} class={`inline-flex items-center min-h-11 px-1 -mx-1 rounded-md transition-colors ${link}`}>{it.label}</a>}
          {i < last && <Icon name="chevron-right" class="text-sm opacity-60" />}
        </li>
      ))}
    </ol>
  </nav>
  ```
  Độ tương phản: `#CBD5E1` trên `#1E2B6B` ≈ 9,5:1; `#475569` trên `#F8FAFC` ≈ 7,2:1 (đạt AA).
- **V5.2 Thay ở 11 chỗ** (giữ nguyên nhãn, chỉ thay markup):

  | File | Dòng | tone |
  |---|---|---|
  | `src/pages/chinh-sach/index.astro` | 16–20 (đang thiếu `aria-label`) | dark |
  | `src/pages/chinh-sach/[slug].astro` | 28–34 | dark |
  | `src/pages/gioi-thieu.astro` | 14–… | dark |
  | `src/pages/lien-he.astro` | 14–… | dark |
  | `src/pages/giai-phap-gara.astro` | 53–… | dark |
  | `src/pages/bossman-creator.astro` | 14–… | dark |
  | `src/pages/gio-hang.astro` | 21–… | light |
  | `src/pages/san-pham/index.astro` | 20–… | light |
  | `src/pages/san-pham/[slug].astro` | 76–… | light |
  | `src/pages/thanh-toan.astro` | 17–… | light |
  | `src/pages/tai-khoan.astro` | 13–… | light |
- **V5.3** Không đổi JSON-LD `BreadcrumbList`.
- **V5.4 Gửi phiên Cẩm nang (không tự sửa):** trang Cẩm nang mới do `worker/blog/render.ts` sinh, style ở `src/styles/blog.css` dòng 7–9 vẫn dùng `flex-wrap: wrap` nên sẽ vỡ tương tự. Đề nghị phiên đó thay bằng:

  ```css
  .vk-breadcrumb { display:flex; flex-wrap:nowrap; align-items:center; gap:.25rem; white-space:nowrap; min-width:0; overflow:hidden; font-size:.8125rem; line-height:1.25rem; font-weight:600; color:var(--vk-text-muted); }
  .vk-breadcrumb a { display:inline-flex; align-items:center; min-height:44px; padding:0 .25rem; margin:0 -.25rem; flex-shrink:0; }
  .vk-breadcrumb > span[aria-hidden] { flex-shrink:0; opacity:.6; }
  .vk-breadcrumb [aria-current] { min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; color:var(--vk-text-strong); font-weight:700; }
  ```
- **Cách kiểm:** 360px ở `/chinh-sach/chinh-sach-doi-tra`, `/san-pham/<slug dài>`, `/thanh-toan`: chiều cao `nav[aria-label=Breadcrumb] ol` ≤ 44px; "Trang chủ" cao 44px, 1 dòng; mục cuối kết thúc bằng "…".

### V6. Banner trang chủ trên mobile: chữ HTML + cắt ảnh có sẵn

- **File:** `src/pages/index.astro` dòng 37–95 (markup) và 400–447 (script).
- **Hiện trạng [VERIFIED]:** khung `aspect-[2244/701]` → cao 117px ở 375px; chữ in trong ảnh còn khoảng 8px. Nút trái/phải 44px che thêm 2 mép ảnh. Chấm chuyển ảnh 12×12px.
- **Asset dùng (có sẵn, không vẽ mới):** `public/uploads/banner-homepage-1.png` (Xịt tẩy dầu mỡ), `-2.png` (Bossman), `-3.png` (ClearWay Auto 5L), đều 2244×701. Mobile vẫn tải đúng file này (đang là LCP), nên không thêm request.
- **Bố cục mobile (< 640px), cao 264px:** cột trái 56% là chữ HTML trên nền `#EEF4FF→#F2F6FF`; cột phải 44% là chính ảnh banner, `object-cover` và căn ngang sao cho chai sản phẩm (x ≈ 1630–1960 trong ảnh gốc) nằm trọn khung, phần chữ in trong ảnh bị cắt bỏ. Đã thử trực tiếp trên staging ở 360px: cả 3 chai hiện trọn, chữ HTML đọc rõ.
- **Dữ liệu** (frontmatter `index.astro`). Chữ chép từ chính banner, không thêm cam kết:

  ```ts
  const heroSlides = [
    { img: "/uploads/banner-homepage-1.png", alt: "Xịt tẩy dầu mỡ đa năng VKINNO 500ml",
      eyebrow: "VKINNO · 500ml", title: "Xịt tẩy dầu mỡ đa năng",
      sub: "Làm sạch dầu mỡ nhanh chóng, giữ sáng gian bếp mỗi ngày",
      href: "/san-pham/tay-dau-mo-da-nang-cao-cap-vkinno-500ml-chuyen-dung-cho-bep-tu-bep-hong-ngoai-an-toan-be-mat-bep",
      pos: "object-[88%_50%]" },
    { img: "/uploads/banner-homepage-2.png", alt: "Xịt tẩy cặn canxi Bossman 500ml",
      eyebrow: "VKINNO · 500ml", title: "Xịt tẩy cặn canxi Bossman",
      sub: "Đánh bay cặn vôi cứng đầu, giữ sáng bóng sen vòi & vách kính tắm",
      href: "/san-pham/chai-xit-tay-can-canxi-500ml-an-toan-cho-da-tay-dung-dich-tay-can-canxi-lam-sach-voi-sen-va-nha-tam",
      pos: "object-[83%_50%]" },
    { img: "/uploads/banner-homepage-3.png", alt: "Nước rửa kính ô tô ClearWay can 5L",
      eyebrow: "VKINNO · Can 5L", title: "Nước rửa kính ô tô ClearWay",
      sub: "Chống bám nước lá sen, trong suốt tầm nhìn vượt mưa bão",
      href: "/san-pham/nuoc-rua-kinh-o-to-chuyen-dung-clearway-chong-bam-nuoc-sach-sau-an-toan-voi-can-gat-va-be-mat-kinh",
      pos: "object-[84%_50%]" },
  ];
  ```
- **Markup:**
  - `section#home-section-hero`: `aspect-[2244/701] … bg-[#0F1638]` → `h-[264px] sm:h-auto sm:aspect-[2244/701] max-h-[560px] bg-[#EEF4FF] sm:bg-[#0F1638] overflow-hidden touch-pan-y`, thêm `aria-roledescription="carousel" aria-label="Sản phẩm nổi bật"`.
  - Mỗi slide (giữ class `hero-slide` và `data-index`):

    ```astro
    <img src={s.img} alt={s.alt} width="1600" height="500"
      class={`absolute top-0 right-0 h-full w-[44%] object-cover ${s.pos} sm:inset-0 sm:w-full sm:object-center`}
      fetchpriority={i === 0 ? "high" : undefined} loading={i === 0 ? undefined : "lazy"} />
    <div aria-hidden="true" class="sm:hidden absolute inset-y-0 left-[56%] w-8 bg-gradient-to-r from-[#EEF4FF] to-transparent"></div>
    <a href={s.href} tabindex={i === 0 ? 0 : -1}
       class="sm:hidden absolute inset-y-0 left-0 w-[56%] flex flex-col justify-center gap-1.5 pl-4 pr-2 pt-4 pb-12 bg-gradient-to-r from-[#EEF4FF] to-[#F2F6FF]">
      <span class="text-xs font-bold uppercase tracking-wide text-[#A84B00]">{s.eyebrow}</span>
      <p class="font-display font-extrabold text-xl leading-[1.3] text-[#1E2B6B] text-balance">{s.title}</p>
      <p class="text-sm leading-[1.4] text-[#334155] line-clamp-3">{s.sub}</p>
      <span class="mt-1.5 self-start inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-[#FF8A15] text-[#0F1638] text-sm font-extrabold">
        Xem sản phẩm <Icon name="arrow-right" class="text-base" />
      </span>
    </a>
    ```
    Dùng `<p>` cho tên sản phẩm, không dùng `h2`, để giữ đúng thứ tự heading (H1 nằm ở khối ngay dưới). Tương phản: `#334155`/`#EEF4FF` ≈ 9,4:1; `#A84B00`/`#EEF4FF` ≈ 5,3:1; `#0F1638`/`#FF8A15` = 7,46:1.
  - Nút trái/phải (`#hero-prev`, `#hero-next`): `flex` → `hidden sm:flex`.
  - Chấm chuyển ảnh: khung `absolute z-20 left-2 bottom-0 flex sm:left-1/2 sm:-translate-x-1/2 sm:bottom-2 sm:bg-black/40 sm:rounded-full sm:px-1` (bỏ `backdrop-blur-xs`, `space-x-1.5`). Mỗi nút:

    ```html
    <button type="button" class="hero-dot group size-11 flex items-center justify-center cursor-pointer"
            data-index="0" aria-label="Chuyển tới ảnh 1" aria-current="true">
      <span class="block h-2 w-2 rounded-full bg-[#1E2B6B]/30 sm:bg-white/80 transition-[width,background-color] duration-200
                   group-aria-[current=true]:w-6 group-aria-[current=true]:bg-[#FF8A15]"></span>
    </button>
    ```
- **Script:**
  1. `showSlide()`: bỏ việc gán đè `dot.className`; chỉ đặt `dot.setAttribute("aria-current", i === currentIdx ? "true" : "false")`; đặt `tabindex` cho link chữ của slide đang hiện là `0`, các slide khác `-1`.
  2. Vuốt: `touchstart` lưu `x0`; `touchend` nếu `|dx| > 40` thì `showSlide(currentIdx ± 1)`.
  3. Tự chạy (5,5 giây): dừng hẳn khi có `touchstart`, `focusin`, hoặc `matchMedia("(prefers-reduced-motion: reduce)").matches` (theo `web-interface-guidelines`: chuyển động tự chạy > 5 giây phải dừng được).
- **≥ 640px:** giao diện giữ nguyên như hiện tại.
- **Cách kiểm:** 360×800 và 375×812: banner cao 264px; tên sản phẩm 20px, mô tả 14px; chai hiện trọn ở cả 3 slide; 3 chấm mỗi chấm 44×44px; vuốt trái/phải đổi slide. 1440×900: giống ảnh chụp trước khi sửa.

### V7. Ảnh thẻ danh mục "Dụng cụ & Bình xịt PET"

- **File:** `src/pages/index.astro` dòng 167–174.
- **Hiện trạng:** `src="/images/blog/cat-dung-cu.jpg"` là ảnh lối đi trong vườn hoa, không liên quan sản phẩm.
- **Thay đổi:** dùng ảnh sản phẩm có sẵn `public/images/products/vk-bottle-spray-500ml.jpg` (960×960, 134KB; bình PET trắng, vòi xịt đỏ).

  ```astro
  <img alt="Bình xịt nhựa PET 500ml phun sương VKINNO"
    class="w-full h-full object-cover object-[50%_20%] origin-top scale-[1.34] group-hover:scale-[1.4] transition-transform duration-500"
    loading="lazy" src="/images/products/vk-bottle-spray-500ml.jpg" width="960" height="960" />
  ```
  `scale-[1.34]` + `origin-top` để cắt bỏ 2 dải viền trắng (x 0–120 và 840–960) có sẵn trong ảnh gốc, đồng thời giữ đầu vòi xịt ở nửa trên khung, không bị lớp phủ tối ở đáy che. Đã thử trực tiếp trên staging ở 360px.
- **Ghi chú [ASSUMED]:** ảnh này vẫn có lá cây làm nền (là ảnh duy nhất của sản phẩm). Nếu sau này có ảnh chụp bình trên nền trơn thì thay vào cùng đường dẫn.
- **Cách kiểm:** 360/375/1440px: thẻ thứ 3 hiện bình xịt, không còn viền trắng 2 bên.

### V8. Vùng bấm ≥ 44×44px trên mobile

Số đo trên staging ở 375px [VERIFIED]: trang chủ 28 vùng < 44px (22 vùng < 32px), `/san-pham` 24, trang sản phẩm 28, `/thanh-toan` 25, `/chinh-sach` 33, `/giai-phap-gara` 28, `/gioi-thieu` 24 (tính cả header + footer).

| # | File · vị trí | Hiện trạng | Sửa thành |
|---|---|---|---|
| 1 | `Header.astro` icon FB/Shopee ở trust bar | 8×20, 14×20 | ẩn trên mobile (V2) |
| 2 | `Header.astro` link logo | 150×32 | `min-h-11` (V1) |
| 3 | `index.astro` chấm banner | 12×12 | `size-11` (V6) |
| 4 | `index.astro` "Xem tất cả 9 mã", "Xem cửa hàng"; `san-pham/[slug].astro` "Xem tất cả" | cao 16 | thêm `min-h-11` (giữ `flex items-center`) |
| 5 | `Footer.astro` dòng 18, 28 (FB, Shopee) | 40×40 | `w-10 h-10` → `size-11` |
| 6 | `Footer.astro` dòng 38 (Zalo hỗ trợ) | 112×40 | `h-10` → `h-11` |
| 7 | `Footer.astro` 13 link ở 2 danh sách (dòng 54–100) | cao 15 | `<ul>`: `space-y-2.5`/`space-y-2` → `space-y-0 lg:space-y-2`; mỗi `<a>`: thêm `flex items-center min-h-11 lg:min-h-0 lg:inline` |
| 8 | `Footer.astro` 2 số hotline (dòng 130, 132) | 84×15 | `inline-flex items-center min-h-11` |
| 9 | `san-pham/[slug].astro` dòng 270 "Gửi ảnh vết ố qua Zalo" | cao 16 | `inline-flex items-center min-h-11` |
| 10 | `gio-hang.astro` dòng 257, 261 nút −/+ | 32×32 | `w-8 h-8` → `size-11 text-base` |
| 11 | `gio-hang.astro` dòng 268 nút xoá | 36×36 | `w-9 h-9` → `size-11` |
| 12 | `gio-hang.astro` `#btn-cart-add-glass-45k`, `#btn-cart-add-bottle-19k`, `#btn-cart-add-bundle-199k` | cao 40 | `min-h-[40px]` → `min-h-11` |
| 13 | `Layout.astro` ngăn giỏ: nút −/+ (dòng 345, 347) | 28×28 | `w-7 h-7` → `size-11 text-base` |
| 14 | `Layout.astro` ngăn giỏ: nút xoá (dòng 350), nút đóng `#cart-drawer-close` | 36, 40 | `size-11` |
| 15 | `Layout.astro` ngăn giỏ: nút upsell (dòng 240, 268, 271, 274), link "Xem 9 sản phẩm" (dòng 328) | cao 38–42 | `min-h-11`; chữ `text-[11px]` → `text-xs` |
| 16 | `thanh-toan.astro` nút sao chép `.copy-qr-btn` (dòng 375, 388, 397; cụm VietQR 1 máy) | cao khoảng 24 | `px-2.5 py-1 text-[11px]` → `min-h-11 px-3 text-xs inline-flex items-center` |
| 17 | `thanh-toan.astro` 2 ô tick (`input.w-4.h-4`, `#order-privacy-consent`) | 13×16, 20×20 | ô tick `size-5`; thẻ `<label>` bao quanh: `flex items-start gap-3 min-h-11 py-2.5 cursor-pointer` (cả nhãn là vùng bấm) |
| 18 | `san-pham/[slug].astro` ô số lượng `#qty-input` (chỉ hiển thị) | 48×24 | `h-11 w-12` cho thẳng hàng 2 nút −/+ 44px |

- **Không đổi:** nút trong menu kéo (≥ 44), thẻ sản phẩm (nút giỏ 44), thanh dính đáy (48).
- **Cách kiểm:** chạy đoạn JS mục 3 trên `/`, `/san-pham`, 1 trang sản phẩm, `/gio-hang` (có ≥ 1 món), `/thanh-toan`, `/chinh-sach`, `/giai-phap-gara`, `/gioi-thieu`, `/lien-he`: `tgt44 = 0`.

### V9. Cỡ chữ tối thiểu

- **Hiện trạng [VERIFIED, 360px]:** chữ < 12px: trang chủ 15, `/san-pham` 6, trang sản phẩm 7, `/thanh-toan` 5. Chữ 12–13px: trang chủ 85, `/giai-phap-gara` 99, trang sản phẩm 85.
- **Quy tắc thay** (áp cho `src/**/*.astro`, trừ `src/admin`):

  | Mẫu hiện tại | Thay bằng | Áp cho |
  |---|---|---|
  | `text-[9px]`, `text-[10px]`, `text-[11px]` | `text-xs` | mọi chỗ (badge, nhãn tab, nhãn nút, chú thích) |
  | `<p class="… text-xs sm:text-sm …">` | `text-sm` | đoạn mô tả, đoạn hero, đoạn danh mục |
  | `<p class="… text-xs …">` là câu mô tả ≥ 6 từ | `text-sm` | thân bài, mô tả thẻ, mô tả trust badge |
  | `<footer … text-xs sm:text-sm>` và `<ul class="… text-xs …">` trong footer | `text-sm` | footer |
  | Giữ `text-xs` | | badge, eyebrow in hoa, ngày đăng, giá gạch, nhãn form in hoa, nhãn tab |

- **Số chỗ cần sửa (đếm bằng grep):**
  - `text-[10px]`/`text-[11px]`: `Header.astro` 10, `thanh-toan.astro` 6, `gio-hang.astro` 4, `Layout.astro` 3, `san-pham/index.astro` 2, `san-pham/[slug].astro` 2, mỗi file 1 chỗ: `ProductCard.astro`, `index.astro`, `chinh-sach/index.astro`, `chinh-sach/[slug].astro`, `giai-phap-gara.astro`, `gioi-thieu.astro`, `lien-he.astro`.
  - `<p>` đang `text-xs`: `index.astro` 11, `giai-phap-gara.astro` 8, `lien-he.astro` 8, `bossman-creator.astro` 5, `gioi-thieu.astro` 5, `thanh-toan.astro` 5, `Header.astro` 5, `Layout.astro` 3, `gio-hang.astro` 3, `san-pham/[slug].astro` 2, mỗi file 1 chỗ: `Footer.astro`, `chinh-sach/index.astro`, `chinh-sach/[slug].astro`, `san-pham/index.astro`, `tai-khoan.astro`. Cần sửa thêm các đoạn trong chuỗi template JS (ngăn giỏ, `gio-hang`, `thanh-toan` dòng 477).
  - Bổ sung: tên sản phẩm trong ngăn giỏ (`Layout.astro` dòng 341) `text-xs` → `text-sm`; badge chính sách `text-[10px] font-black` (`chinh-sach/*.astro`) → `text-xs font-extrabold`.
- **Tiêu đề in hoa có dấu:** giữ `leading-snug` (1,375) trở lên; không thêm `leading-tight`.
- **Cách kiểm:** đoạn JS mục 3: `lt12 = 0` mọi trang; `pSmall = 0` (`<p>` trong `main` nhỏ hơn 14px).

### V10. Bỏ Font Awesome CDN, chuyển sang SVG Lucide inline

- **Hiện trạng [VERIFIED]:** `SEOHead.astro` dòng 116–123 nạp `font-awesome/6.4.0/css/all.min.css` (18KB, chặn hiển thị) kéo theo `fa-solid-900.woff2` 147KB, `fa-brands-400.woff2` 105KB, `fa-regular-400.woff2` 24KB. Có 63 icon Font Awesome khác nhau trong `src/` + `worker/blog/render.ts`.
- **V10.1 Tạo** `src/shared/icons.ts` (thư mục `src/shared` đã được `worker/` import):
  - `ICONS: Record<IconName, string>`: phần thân SVG của từng icon, chép từ `node_modules/lucide-react/dist/esm/icons/<tên>.mjs` (mảng `__iconNode`) đổi thành chuỗi `<path …/>`. Chỉ chép đúng 62 icon ở cột 2 bảng V10.4 (61 icon Lucide + `facebook`), không import cả gói lúc chạy.
  - `export function svg(name: IconName, cls = ""): string` trả về `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="inline-block w-[1em] h-[1em] shrink-0 align-[-0.125em] ${cls}">…</svg>`.
  - Riêng `facebook`: path từ Simple Icons (CC0, https://simpleicons.org/?q=facebook), `fill="currentColor"` và `stroke="none"`.
  - `export const FA_TO_LUCIDE: Record<string, IconName>` (bảng V10.4) và `export function replaceFaIcons(html: string): string`: regex `<i class="fa-(?:solid|regular|brands) (fa-[a-z0-9-]+)([^"]*)"[^>]*><\/i>` → `svg(FA_TO_LUCIDE[$1], $2)`, giữ các class màu và lề còn lại.
- **V10.2 Tạo** `src/components/Icon.astro`: `<Fragment set:html={svg(name, Astro.props.class)} />`. Kích thước `1em` nên các class cỡ đang có (`text-sm`, `text-xl`, …) vẫn quyết định cỡ icon, không cần đổi.
- **V10.3 Thay ở từng loại chỗ dùng:**
  1. Markup tĩnh `.astro`: `<i class="fa-solid fa-bars text-xl" aria-hidden="true"></i>` → `<Icon name="menu" class="text-xl" />`.
  2. Chuỗi HTML trong script inline (`Layout.astro` ngăn giỏ: `circle-check`, `shopping-basket`, `trash-2`; toast): render sẵn ở server rồi truyền vào `define:vars={{ ICON_SVG: { check: svg("circle-check", "text-[#FF8A15] text-base"), … } }}`.
  3. `chinh-sach/index.astro` dòng 132–133 (đổi icon bằng `className`): truyền `policyIconSvg` (map `slug → chuỗi svg`) qua `define:vars`, thay bằng `iconWrap.innerHTML = policyIconSvg[p.slug]`.
  4. `src/data/policies.json`: **không sửa file** (có nội dung pháp lý). Ở `chinh-sach/[slug].astro` và `chinh-sach/index.astro`: icon menu dùng `svg(FA_TO_LUCIDE[item.icon])`; nội dung HTML đi qua `replaceFaIcons(policy.content)` trước `set:html`.
  5. Trang sản phẩm dòng 269: `fa-brands fa-whatsapp` đang đứng cạnh link Zalo là sai nghĩa → `message-circle-more` màu `text-[#0052CC]`.
- **V10.4 Bảng ánh xạ đầy đủ** (số chỗ dùng; file viết tắt bỏ `src/`):

  | Font Awesome | Lucide | Chỗ dùng |
  |---|---|---|
  | `fa-arrow-left` | `arrow-left` | worker/blog/render.ts (1) |
  | `fa-arrow-right` | `arrow-right` | layouts/Layout.astro (1) |
  | `fa-arrow-right-long` | `move-right` | pages/index.astro (3), san-pham/[slug] (1), render.ts (1) |
  | `fa-arrows-rotate` | `refresh-cw` | index.astro (1) |
  | `fa-bars` | `menu` | Header (1) |
  | `fa-basket-shopping` | `shopping-basket` | Header (2), Layout (2), san-pham/[slug] (1) |
  | `fa-bolt` | `zap` | san-pham/[slug] (1) |
  | `fa-box-open` | `package-open` | policies.json (1), bossman-creator (1) |
  | `fa-building` | `building-2` | Footer, policies.json, index, lien-he, san-pham/[slug] (mỗi file 1) |
  | `fa-building-columns` | `landmark` | Footer (1) |
  | `fa-calendar` (regular) | `calendar` | render.ts (1) |
  | `fa-calendar-check` | `calendar-check` | policies.json (1) |
  | `fa-calendar-days` (regular) | `calendar-days` | index.astro (1) |
  | `fa-cart-plus` | `shopping-cart-plus` | ProductCard (1) |
  | `fa-cart-shopping` | `shopping-cart` | gio-hang (1), thanh-toan (1) |
  | `fa-check-to-slot` | `vote` | thanh-toan (1) |
  | `fa-chevron-down` | `chevron-down` | Header (1) |
  | `fa-chevron-left` | `chevron-left` | index.astro (1) |
  | `fa-chevron-right` | `chevron-right` | Header (1), index.astro (1) |
  | `fa-circle-check` | `circle-check` | policies.json (1), Layout (2), bossman-creator (1), san-pham/[slug] (1), thanh-toan (1) |
  | `fa-circle-exclamation` | `circle-alert` | policies.json (1) |
  | `fa-circle-info` | `info` | policies.json (1), render.ts (1) |
  | `fa-clock` (solid + regular) | `clock` | policies.json (4), render.ts (1) |
  | `fa-comment-dots` | `message-circle-more` | Footer, Header, Layout, san-pham/[slug] (mỗi file 1) |
  | `fa-credit-card` | `credit-card` | policies.json (1) |
  | `fa-diamond-turn-right` | `navigation` | lien-he (1, nút "Mở chỉ đường Google Maps") |
  | `fa-download` | `download` | thanh-toan (1, nút tải ảnh QR) |
  | `fa-envelope` | `mail` | lien-he (1) |
  | `fa-facebook-f` (brands) | `facebook` (Simple Icons) | Footer (1), Header (1), render.ts (1) |
  | `fa-file-invoice` | `file-text` | index.astro (1) |
  | `fa-filter` | `funnel` | san-pham/index (2) |
  | `fa-flask` | `flask-conical` | gioi-thieu (1), index.astro (1) |
  | `fa-gift` | `gift` | index.astro (1) |
  | `fa-hand-holding-dollar` | `hand-coins` | policies.json (2), thanh-toan (1) |
  | `fa-headset` | `headset` | index.astro (1) |
  | `fa-house` | `house` | Header (1), 404 (1) |
  | `fa-layer-group` | `layers` | Header (1) |
  | `fa-list-check` | `list-checks` | policies.json (1) |
  | `fa-lock` | `lock` | thanh-toan (1) |
  | `fa-magnifying-glass` | `search` | Header (4), san-pham/index (2) |
  | `fa-magnifying-glass-location` | `package-search` | tai-khoan (1, khối tra cứu đơn) |
  | `fa-money-bill-transfer` | `banknote-arrow-up` | policies.json (1) |
  | `fa-percent` | `percent` | bossman-creator (1) |
  | `fa-phone` | `phone` | Footer (1), Header (2) |
  | `fa-phone-volume` | `phone-call` | lien-he (1) |
  | `fa-qrcode` | `qr-code` | thanh-toan (1) |
  | `fa-receipt` | `receipt` | Header (1, tab "Tra đơn") |
  | `fa-rotate` | `rotate-cw` | render.ts (1) |
  | `fa-rotate-left` | `rotate-ccw` | policies.json (1) |
  | `fa-scale-balanced` | `scale` | policies.json (1), bossman-creator (1) |
  | `fa-shield-halved` | `shield-half` | policies.json (1), gioi-thieu (1) |
  | `fa-stopwatch` | `timer` | gioi-thieu (1), san-pham/[slug] (1) |
  | `fa-store` | `store` | Footer (1), Header (2), 404 (1) |
  | `fa-tag` | `tag` | policies.json (1) |
  | `fa-trash-can` (solid + regular) | `trash-2` | Layout (1), gio-hang (1) |
  | `fa-triangle-exclamation` | `triangle-alert` | san-pham/[slug] (1) |
  | `fa-truck-fast` | `truck` | Header, index, san-pham/[slug], san-pham/index, tai-khoan (mỗi file 1), policies.json (2) |
  | `fa-truck-ramp-box` | `package-check` | policies.json (1) |
  | `fa-user-gear` | `user-cog` | policies.json (1), render.ts (1) |
  | `fa-user-lock` | `user-lock` | policies.json (1) |
  | `fa-warehouse` | `warehouse` | Footer (1), lien-he (1) |
  | `fa-whatsapp` (brands) | `message-circle-more` (đổi nghĩa đúng thành Zalo) | san-pham/[slug] (1) |
  | `fa-xmark` | `x` | Header (1), Layout (1), san-pham/index (1) |

  Tất cả tên Lucide ở cột 2 đã kiểm có file trong `lucide-react@1.66.0` [VERIFIED], trừ `facebook` (Lucide v1 không có, dùng Simple Icons).
- **V10.5 Độ đậm nét:** icon FA đặc (solid), Lucide là nét viền 2px. Cho icon ≤ 14px (`text-xs`, `text-sm`), truyền thêm `[stroke-width:2.25]` để không bị mảnh. Không đổi màu.
- **V10.6 Gửi phiên Cẩm nang (không tự sửa):** `worker/blog/render.ts` có 8 thẻ `<i class="fa-…">` (dòng 110, 203, 204, 209, 214, 231, 233, 236). Đề nghị phiên đó `import { svg } from "../../src/shared/icons"` và thay bằng `svg("move-right")`, `svg("user-cog")`, `svg("calendar")`, `svg("rotate-cw")`, `svg("clock")`, `svg("info")`, `svg("arrow-left")`, `svg("facebook")`. **Gỡ `<link>` Font Awesome chỉ sau khi phiên đó xong**, nếu không trang Cẩm nang sẽ mất icon.
- **V10.7 Gỡ CDN:** xoá `SEOHead.astro` dòng 116–123 khi `grep -rnE "fa-(solid|regular|brands)" src worker --include=*.astro --include=*.ts --include=*.tsx` (bỏ qua `src/admin`, `src/shared/icons.ts`) trả về 0 dòng. Lưu ý: chỉ `policies.json` còn chuỗi `fa-` vì được thay lúc render.
- **Cách kiểm:** Network tab không còn request tới `cdnjs.cloudflare.com/ajax/libs/font-awesome`; so ảnh chụp 1440 + 375 trước/sau: không còn ô vuông trống chỗ icon; trình đọc màn hình không đọc icon (vì có `aria-hidden`).

### V11. Font giữ lại

- **Đo thực tế [VERIFIED, computed style trên 7 trang]:** Inter hiển thị ở 400/500/600/700 (các chỗ `font-extrabold`/`font-black` dùng Inter đang tự rơi về file 700 vì 800/900 không được nạp). Be Vietnam Pro dùng 700/800 (`font-black` đang rơi về 800); **600 chỉ có 1 chỗ dùng** (trust bar, sửa ở V2).
- **Thay đổi** `src/components/SEOHead.astro` dòng 112:
  - Cũ: `family=Be+Vietnam+Pro:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap&subset=vietnamese`
  - Mới: `family=Be+Vietnam+Pro:wght@700;800&family=Inter:wght@400;500;600;700&display=swap`
  - Tham số `subset=` không có tác dụng với API `css2`; Google tự chia file theo `unicode-range` (latin, latin-ext, vietnamese) và trình duyệt chỉ tải phần cần.
- **Hiệu quả:** Be Vietnam Pro từ 9 file còn 6 (bớt 3 file ≈ 38KB). Inter là font biến thiên: đang tải 3 file (10 + 83 + 47KB) dùng chung cho mọi độ đậm, nên giữ 4 độ đậm không tốn thêm.
- **Tuỳ chọn (không bắt buộc):** thay 34 chỗ `font-black` thành `font-extrabold` cho khớp với cái đang hiển thị thật; giao diện không đổi.
- **Cách kiểm:** chạy `[...document.querySelectorAll('body *')].map(e=>getComputedStyle(e).fontFamily.split(',')[0]+' '+getComputedStyle(e).fontWeight)` trên `/` và `/chinh-sach`: không còn "Be Vietnam Pro 600". Network: không còn file `bevietnampro…` thứ 7 trở đi.

### V12. Lỗi phát hiện thêm (ngoài phạm vi, CEO quyết có làm đợt này không)

1. **Alt ảnh banner sai** [VERIFIED]: slide 2 alt "Chăm sóc kính ô tô ClearWay…" nhưng ảnh là Bossman; slide 3 alt "Solar Shield" nhưng ảnh là ClearWay Auto 5L. V6 đã sửa theo đúng ảnh.
2. **Khối "Chăm sóc kính tòa nhà & Ô tô" trên trang chủ chỉ hiện 2/4 sản phẩm** [VERIFIED trên staging]: `index.astro` dòng 16–17 trỏ tới 2 slug không còn trong `products.ts` (`nuoc-lau-kinh-chuyen-dung-clearway-glasspro-cong-thuc-khong-amoniac-…-500ml` và `…-can-5l`). Slug đúng: `nuoc-lau-kinh-clearway-glasspro-500ml-sach-nhanh-khong-vet-sang-bong-kinh-nha-van-phong` và `nuoc-lau-kinh-lam-sach-cuc-sau-khong-de-lai-vet-mo-can-5l-tang-kem-binh-xit-clearway-glasspro`. Nên gắn với spec SEO [[02-seo-tieu-de-mo-ta]] nếu phiên đó đang đổi slug.
3. `src/components/VietQRModal.tsx` và `DilutionCalculator.tsx` không được trang nào import [VERIFIED bằng grep]; `DilutionCalculator` còn 12 chỗ chữ 10–11px. Nếu sau này dùng lại thì áp quy tắc V9.

## 3. Kịch bản kiểm thử (dán vào DevTools Console)

Chạy ở 360×800 và 375×812 trên từng trang của V8. Kết quả đạt: `over = 0`, `tgt44 = 0`, `lt12 = 0`, `pSmall = 0`, `fabOverlap = 0`.

```js
(() => {
  const W = innerWidth, skip = '#cart-drawer,#mobile-menu-drawer,.cart-drawer';
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest(skip); };
  const over = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.getBoundingClientRect().right > W + 0.5 && !e.closest('[class*="overflow-x-auto"]')).length;
  const tg = [...document.querySelectorAll('a,button,select,summary,input[type=checkbox],input[type=radio]')].filter(vis)
    .filter(e => { const r = (e.closest('label') || e).getBoundingClientRect(); return r.width < 44 || r.height < 44; });
  const txt = [...document.querySelectorAll('body *')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const lt12 = txt.filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).length;
  const pSmall = [...document.querySelectorAll('main p')].filter(e => vis(e) && parseFloat(getComputedStyle(e).fontSize) < 14).length;
  const fabs = [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).position === 'fixed' && vis(e) && !e.closest('#site-header') && e.id !== 'mobile-bottom-nav' && !e.closest('#mobile-bottom-nav'));
  const fabOverlap = fabs.filter(f => { const a = f.getBoundingClientRect(); return [...document.querySelectorAll('main p, main li, main h2, main h3')].some(t => { const b = t.getBoundingClientRect(); return b.width && !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom); }); }).length;
  return { page: location.pathname, over, tgt44: tg.length, tgtList: tg.slice(0, 8).map(e => (e.innerText || e.getAttribute('aria-label') || e.id).trim().slice(0, 24)), lt12, pSmall, fabOverlap };
})();
```

- Trang sản phẩm: thanh dính đáy là phần tử `fixed` hợp lệ; kiểm `fabOverlap` sau khi cuộn tới cuối trang (`pb-28` đã chừa chỗ).
- QA tự động: `python -X utf8 C:\cong-ty-ai-main\he-thong\scripts\qa\qa_web.py <url staging> --require-browser --require-visual-craft --screenshot-dir C:\vkinno\docs\nang-cap-giao-dien\anh-qa` ở 1440×900, 375×812, 360×800; so với ảnh trước khi sửa: desktop không được khác ngoài icon (V10) và breadcrumb (V5).

## 4. Thứ tự làm đề xuất

1. V1 + V2 + V4 (Header, SEOHead viewport, global.css): một commit, hết tràn ngang.
2. V3 (Zalo vào thanh đáy).
3. V5 (Breadcrumb component + 11 trang).
4. V8 + V9 (vùng bấm, cỡ chữ): làm theo từng file, chạy đoạn JS mục 3 sau mỗi file.
5. V6 + V7 (banner, ảnh PET).
6. V10 (icon), gỡ CDN Font Awesome sau khi phiên Cẩm nang làm xong V10.6.
7. V11 (font).
