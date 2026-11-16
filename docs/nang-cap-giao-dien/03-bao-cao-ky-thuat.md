---
title: Báo cáo kỹ thuật nâng cấp giao diện trang người dùng VKINNO (đợt 1)
type: bao-cao-ky-thuat
status: nháp
created: 2026-11-16
department: Phòng Kỹ thuật Frontend
du_an: vkinno
nhanh: ui/nang-cap-giao-dien
tags:
  - vkinno
  - mobile
  - seo
  - wcag-2-2
  - bao-cao
---

# Báo cáo kỹ thuật: nâng cấp giao diện trang người dùng VKINNO (đợt 1)

Đầu vào: `docs/nang-cap-giao-dien/01-spec-thiet-ke.md` (Phòng Thiết kế, V1–V12) và `docs/nang-cap-giao-dien/02-seo-tieu-de-mo-ta.md` (Phòng Marketing, 16 cặp tiêu đề/mô tả). Hai file này đang nằm ở checkout chính `C:\vkinno`, chưa commit nên chưa có trên nhánh này. Liên quan: [[../van-hanh]] · [[../superpowers/specs/2026-11-16-cam-nang-seo-tu-dong-design]] (phiên Cẩm nang nhận V5.4, V10.6).

## 🤝 Handoff Summary (Cho Phòng Kế Tiếp)
- **Đã làm:** V1–V11 + V12 (alt banner, khối Chăm sóc kính 4/4) + A (cuộn bằng document) + B (noindex, follow cho giỏ hàng/thanh toán/tài khoản) + SEO 9 sản phẩm và 7 trang chính, giá ghép tự động từ `price_vnd`.
- **Số đo 360/375px, 12 trang (24 lượt):** phần tử tràn ngang 84 → 2; vùng bấm < 44px 655 → 4; chữ < 12px 210 → 0; `<p>` < 14px 100 → 0; nút nổi đè chữ 14 → 0; trang cuộn được bằng document 0/36 → 36/36.
- **Font tải ở trang chủ:** 571 KB → 241 KB (không còn tải font Font Awesome; bỏ Be Vietnam Pro 600). Yêu cầu CSS + font: 18 → 12.
- **Còn lại có chủ đích:** 2 "tràn" là ảnh PET phóng to nằm trong thẻ `overflow-hidden` (scrollWidth = innerWidth); 4 vùng bấm là 1 link nằm giữa câu trong nội dung pháp lý `policies.json` (ngoại lệ "inline" của WCAG 2.5.8).
- **Gửi phiên Cẩm nang:** V5.4 (CSS `.vk-breadcrumb`) và V10.6 (`render.ts` dùng `svg()`); sau đó gỡ thẻ `<link>` Font Awesome trong `SEOHead.astro` (đã đánh dấu TODO, hiện nạp không chặn hiển thị).
- **Sửa thêm lỗi có thật:** phí ship `undefined` làm tổng tiền NaN ở giỏ hàng/thanh toán khi đơn < 199.000đ; số TK, chủ TK trống ở màn hình VietQR; MST trống; `tel:undefined`. Chi tiết ở mục 3.
- **Không deploy, không push.** Code nằm trên nhánh `ui/nang-cap-giao-dien` (worktree `C:\vkinno-ui`).

## 🔍 0. Mẫu Tham Chiếu, Skill & Thư Viện Đã Nghiên Cứu

| Nguồn | Dùng vào việc |
|---|---|
| Spec Thiết kế mục 0: Hasaki, Bách Hóa Xanh, Thế Giới Di Động (Thiết kế đã đo ngày 16/11/2026) | Thanh đáy 5 tab không có nút chat nổi (V3), breadcrumb 1 dòng cắt "…" (V5), banner mobile chữ to (V6). Không tra lại `motionsites.ai`/`gsap.com`/`21st.dev` vì ràng buộc cứng: không thêm thư viện chuyển động |
| `ui.shadcn.com` (qua skill `ui-styling`) | Quy ước token màu, `size-11`, `min-w-0` + `truncate` cho phần tử co giãn |
| Skill `web-interface-guidelines` (bản ghim `rules.md`) | `touch-action: manipulation`, tap highlight, `aria-live` cho toast/thông báo mã, `…` thay `...`, autoplay > 5 giây phải dừng được, `inert` cho ngăn kéo đóng |
| Skill `web-performance-optimization` | Đo trước/sau bằng Playwright; Font Awesome nạp `media=print` rồi đổi `all` để không chặn hiển thị |
| Skill `frontend-dev-guidelines` | Phần lớn viết cho React/MUI nên chỉ áp dụng nguyên tắc chung: kiểu dữ liệu rõ ràng, tách logic SEO ra module có test |
| Skill `verification-before-completion` | Mọi số liệu trong báo cáo lấy từ lệnh chạy thật (mục 4) |
| Thư viện | Không cài mới. Path icon chép từ `lucide-react@1.66.0` (ISC) đã có trong `node_modules`; icon Facebook từ Simple Icons (CC0) |

## 1. Bảng việc

| Việc | Trạng thái | File chính | Cách kiểm |
|---|---|---|---|
| V1 Header mobile hết tràn | Đã làm | `Header.astro` | Probe mục 3 spec: `over` = 0 ở header; nút giỏ trong khung 360px |
| V2 Trust bar 12px, rút gọn mobile, ẩn icon FB/Shopee < 640px | Đã làm | `Header.astro` | `lt12 = 0`; ảnh chụp 360px không còn "…" |
| V3 Zalo vào thanh đáy (tab giữa), nút nổi chỉ ≥ 1024px | Đã làm | `Header.astro`, `Layout.astro` | `fabOverlap = 0` ở 24 lượt mobile |
| V4 Safe-area, nhãn tab 12px, `viewport-fit=cover`, touch-action | Đã làm | `SEOHead.astro`, `Header.astro`, `san-pham/[slug].astro`, `global.css` | Đọc HTML build: viewport có `viewport-fit=cover` |
| V5.1–V5.3 Breadcrumb component, 11 trang | Đã làm | `Breadcrumb.astro` + 11 trang | Ảnh `/chinh-sach/chinh-sach-doi-tra` 360px: 1 dòng, mục cuối "…" |
| V5.4 CSS breadcrumb Cẩm nang | Không làm (phiên khác) | `blog.css` | Gửi phiên Cẩm nang |
| V6 Banner mobile chữ HTML, vuốt, chấm 44px | Đã làm | `index.astro` | Ảnh 360px: banner 264px, chai hiện trọn; 1440px giữ như cũ |
| V7 Ảnh PET thẻ danh mục | Đã làm | `index.astro` | Ảnh 360px |
| V8 Vùng bấm 44px | Đã làm | Header, Footer, Layout, 9 trang | `tgt44`: 655 → 4 (xem mục 2) |
| V9 Cỡ chữ ≥ 12px, `<p>` ≥ 14px | Đã làm | toàn bộ trang người dùng | `lt12 = 0`, `pSmall = 0` ở mobile; `grep text-[9-11px]` = 0 |
| V10.1–V10.5 Icon SVG thay Font Awesome | Đã làm | `src/shared/icons.ts`, `Icon.astro`, mọi trang | `grep -rlE "fa-[a-z]" src` chỉ còn `policies.json` (không được sửa, đổi lúc render) và `icons.ts` (bảng ánh xạ) |
| V10.6 `render.ts` | Không làm (phiên khác) | `worker/blog/render.ts` | Gửi phiên Cẩm nang |
| V10.7 Gỡ `<link>` Font Awesome | Chưa gỡ theo brief | `SEOHead.astro` | Giữ thẻ + TODO; đổi sang nạp không chặn hiển thị |
| V11 Font Be Vietnam Pro bỏ 600 | Đã làm | `SEOHead.astro` | Font trang chủ 571 KB → 241 KB (gồm cả phần Font Awesome) |
| V12.1 Alt banner 2–3 | Đã làm | `index.astro` | Đọc HTML build |
| V12.2 Khối Chăm sóc kính 2/4 → 4/4 | Đã làm | `index.astro` | Ảnh full trang chủ: 4 thẻ |
| V12.3 `VietQRModal.tsx`, `DilutionCalculator.tsx` | Giữ nguyên, không xoá | | |
| A Cuộn bằng document | Đã làm | `global.css`, `Layout.astro`, khoá cuộn ở `Header`, `Layout`, `san-pham/index` | `scrollHeight > innerHeight` 36/36; `window.scrollTo(0,600)` cho `scrollY = 600` |
| B `noindex, follow` 3 trang | Đã làm | prop `robots` ở `Layout`/`SEOHead` | HTML build có `<meta name="robots" content="noindex, follow">`; GTM vẫn có |
| SEO 16 cặp tiêu đề/mô tả | Đã làm | `products.ts`, `src/data/seo.ts`, 7 trang + trang sản phẩm | `test/seo.test.ts` 6 test |
| H1 trang chủ, /san-pham/ | Đã làm | `index.astro`, `san-pham/index.astro` | "Chất Tẩy Rửa Sinh Học Chuyên Dụng…", "Bảng Giá Cửa Hàng Chính Hãng VKINNO" |

## 2. Số liệu trước/sau (Playwright, bản build tĩnh, 12 trang)

Kịch bản: đoạn JS mục 3 spec Thiết kế, chạy ở 360×800 và 375×812 cho `/`, `/san-pham/`, 1 trang sản phẩm, `/gio-hang/` (giỏ có 1 món), `/thanh-toan/`, `/gioi-thieu/`, `/chinh-sach/chinh-sach-doi-tra/`, `/chinh-sach/`, `/lien-he/`, `/giai-phap-gara/`, `/bossman-creator/`, `/tai-khoan/`. `fabOverlap` đo ở nhiều vị trí cuộn từ đầu tới cuối trang.

| Chỉ số (tổng 24 lượt mobile) | Trước | Sau |
|---|---|---|
| Phần tử vượt mép phải (`over`) | 84 | 2 (ảnh PET phóng to trong thẻ `overflow-hidden`, trang chủ; `scrollWidth = innerWidth`) |
| Vùng bấm < 44px (`tgt44`) | 655 | 4 (link `https://vkinno.vn` giữa câu trong nội dung pháp lý, 2 trang chính sách) |
| Chữ < 12px (`lt12`) | 210 | 0 |
| `<p>` trong `main` < 14px (`pSmall`) | 100 | 0 |
| Nút nổi đè chữ (`fabOverlap`) | 14 | 0 |
| Trang cuộn bằng document (36 lượt cả 1440px) | 0/36 | 36/36 |
| Thẻ `<i class="fa-…">` trên trang | 1.674 | 0 |
| Trang chủ 375px: font tải về | 571 KB | 241 KB |
| Trang chủ 375px: CSS tải về (giải nén) | 184 KB | 185 KB (Font Awesome CSS còn, nhưng không chặn hiển thị) |
| Trang chủ 375px: số yêu cầu CSS + font | 18 | 12 |

Ở 1440px vùng bấm < 44px còn khoảng 25/trang (link chữ trên thanh menu, ô tìm kiếm 32px): spec V8 chỉ áp cho mobile nên không đổi giao diện desktop.

## 3. Lỗi phát hiện thêm và đã sửa (ngoài spec)

Các khoá này không có trong `src/data/siteConfig.ts`, Astro in ra rỗng hoặc chuỗi `undefined`:

| Chỗ | Hậu quả trên bản đang chạy | Sửa |
|---|---|---|
| `defaultShippingFeeVnd` ở `gio-hang.astro`, `thanh-toan.astro` | Đơn < 199.000đ: phí ship `undefined`, tổng tiền NaN | `flatShippingFeeVnd` (25.000đ) |
| `bankAccountNumber`, `bankAccountName` ở `thanh-toan.astro`, `tai-khoan.astro` | Số TK, chủ TK trống ở màn hình VietQR; nút "Sao chép" STK chép rỗng | `bank.accountNo`, `bank.accountName` |
| `taxCode` ở trang sản phẩm, `/gioi-thieu/`, `/lien-he/`, `/giai-phap-gara/` | "MST " trống | `taxId` |
| `hotlinePrimaryRaw`, `hotlineSecondaryRaw` ở `/lien-he/`, `/giai-phap-gara/` | Link `tel:undefined` | `hotline…Tel` |
| `headquartersAddress` ở `/lien-he/` | Trụ sở trống | `registeredAddress` |
| `workingHours` ở `/lien-he/` | "Giờ làm việc:" trống | Ẩn dòng, TODO chờ dữ liệu giờ làm việc |

Thêm: trước khi sửa A, sự kiện `scroll` của GTM gắn trên `window` không bao giờ chạy và `window.scrollTo` ở trang thanh toán không có tác dụng (body là khung cuộn).

## 4. Lệnh đã chạy (kết quả thật)

| Lệnh | Kết quả |
|---|---|
| `npm.cmd run typecheck` | Không lỗi |
| `npx.cmd vitest run` | 23 file, 358 test đạt (gồm `seo.test.ts`, `icons.test.ts` mới) |
| `npx.cmd vitest run -c vitest.ui.config.mts` | 9 file, 117 test đạt |
| `npm.cmd run build` | 31 trang, thành công |
| `grep -o "__VK_[A-Z_]*" dist/vk-khung/bai-viet/index.html` | BODY, CANONICAL ×3, DESC ×4, IMAGE ×2, SCHEMA, TITLE__VKINNO ×4, giống hệt bản trước khi sửa |
| `qa_web.py dist --require-browser --require-visual-craft` | Visual Craft 10/10 mọi trang người dùng; FAIL còn lại: link `/cam-nang` (trang do Worker dựng từ D1, không có trong `dist`, có từ trước ở `main`), `quan-tri` (đã biết) |

Ảnh chụp: `C:\vkinno-ui\qa-screenshots\` (93 ảnh, đã gitignore).

## 5. Việc cho phiên khác / CEO quyết

1. Phiên Cẩm nang: V5.4, V10.6, rồi gỡ `<link>` Font Awesome (TODO trong `SEOHead.astro`).
2. Cần dữ liệu giờ làm việc để hiện lại dòng "Giờ làm việc" ở `/lien-he/`.
3. Link giữa câu trong `policies.json` (vd. `https://vkinno.vn`) cao 17px: muốn đạt 44px phải sửa nội dung pháp lý, cần Pháp lý duyệt.
