---
title: Tiêu đề SEO & meta description – 9 sản phẩm và 7 trang chính VKINNO
type: seo-copy
status: nháp
created: 2026-11-16
department: Phòng Marketing & Bán hàng
project: vkinno
tags:
  - seo
  - meta-description
  - ctr
  - vkinno
---

# Tiêu đề SEO & meta description – VKINNO (bản nháp 16/11/2026)

Liên kết: [[../van-hanh|Sổ vận hành VKINNO]] · [[../../src/data/products.ts|Dữ liệu sản phẩm products.ts]] · [[../../src/components/SEOHead.astro|Thẻ meta SEOHead.astro]]

## 🤝 Handoff Summary (Cho Phòng Kế Tiếp)
- **Đã chốt:** 16 cặp `seo_title` (48–59 ký tự) + `meta_description` (149–160 ký tự), đếm bằng Python `len()` sau chuẩn hoá NFC; 0 trùng lặp.
- **Kỹ thuật – bắt buộc 1:** `SEOHead.astro` tự nối thêm ` | VKINNO - Công Nghệ Làm Sạch Sinh Học` khi tiêu đề không chứa chữ "VKINNO". Cả 16 tiêu đề dưới đây đều đã chứa "VKINNO", nên dán nguyên văn là đủ, không bị nối đuôi.
- **Kỹ thuật – bắt buộc 2:** thêm 2 trường `seo_title`, `meta_description` vào `Product` trong `products.ts`; ở `san-pham/[slug].astro` dùng `product.seo_title ?? product.name` và `product.meta_description ?? product.name` (hiện `short_description` không tồn tại nên mô tả đang rơi về tên sản phẩm).
- **Kỹ thuật – bắt buộc 3:** dữ liệu sạch để dán nằm ở mục 4 (khối JSON). Trong bảng, ký tự `\|` chỉ là escape của Markdown, tiêu đề thật dùng `|`.
- **Ràng buộc giá:** chỉ dùng `price_vnd` hiện hành. Khi đổi giá trong `products.ts` phải sửa lại mô tả có ghi giá (8/9 sản phẩm + `/san-pham/`).
- **Không viết:** `/gio-hang`, `/thanh-toan`, `/tai-khoan` (sẽ `noindex`). Trang con `/chinh-sach/<slug>` giữ mẫu hiện tại, đề xuất làm đợt sau.
- **Đo:** ghi CTR + vị trí trung bình 28 ngày trong Google Search Console trước khi deploy, so lại sau 4 tuần.

## 🔍 0. Mẫu Tham Chiếu, Skill & Thư Viện Đã Nghiên Cứu

**Skill đã nạp:** `ai-seo:ai-seo` (nguyên tắc: viết cho người đọc, không nhồi từ khoá, đưa số liệu thật có thể kiểm chứng vào đoạn mô tả), `seo-audit` + tài liệu `references/title-tags.md` (cấu trúc `[từ khoá chính] + [lý do bấm] + [thương hiệu]`, giữ chữ quan trọng trong 50 ký tự đầu, mỗi trang một tiêu đề riêng, tiêu đề khớp H1).

**Từ khoá thật người Việt gõ** – lấy từ Google Autocomplete (`hl=vi`, `gl=vn`), chạy ngày 16/11/2026:

| Nhóm | Gợi ý Google trả về (trích) | Từ khoá chọn |
|---|---|---|
| Tẩy dầu mỡ bếp | tẩy dầu mỡ bếp, nước tẩy dầu mỡ bếp, tẩy dầu mỡ trên máy hút mùi, nước tẩy dầu mỡ máy hút mùi | tẩy dầu mỡ bếp (+ bếp từ, lưới máy hút mùi) |
| Tẩy cặn canxi | tẩy cặn canxi trên kính, tẩy cặn canxi kính nhà tắm, tẩy cặn canxi trên vòi sen, …vách kính nhà tắm | tẩy cặn canxi kính nhà tắm (+ vòi sen) |
| Nước lau kính | nước lau kính 5l, nước lau kính can 5l, nước lau kính gift 500ml, nước lau kính công nghiệp | nước lau kính can 5L / nước lau kính 500ml |
| Nước rửa kính ô tô | nước rửa kính ô tô bao nhiêu tiền, …loại nào tốt, …nhanh hết, …tự pha | nước rửa kính ô tô (+ can 5L, không Methanol) |
| Tẩy ố kính ô tô | tẩy ố kính ô tô tại nhà, …bao nhiêu tiền, …loại nào tốt, tẩy kính lái ô tô | tẩy ố kính ô tô (+ màng dầu kính lái) |
| Vệ sinh pin mặt trời | dung dịch vệ sinh tấm pin mặt trời, chổi/máy/robot vệ sinh tấm pin mặt trời | dung dịch vệ sinh tấm pin mặt trời |
| Bình xịt | bình xịt phun sương 500ml, chai xịt phun sương 500ml, vỏ chai xịt 500ml | bình xịt phun sương 500ml |
| Trang chủ | chất tẩy rửa sinh học, …enzyme, …là gì | chất tẩy rửa sinh học |

**Trang đối thủ đang lên kết quả** (đọc thẻ `<title>` và `meta description` thật bằng script, ngày 16/11/2026):

| URL | Tiêu đề (ký tự) | Mô tả (ký tự) | Bài học |
|---|---|---|---|
| https://meta.vn/dung-dich-xit-lam-sach-loai-bo-can-canxi-nuoc-cung-nha-tam-express-shine-500ml-p53201 | 103 – bị cắt | 175 – giá đặt ở cuối, bị cắt | Giá phải nằm trong 150 ký tự đầu mới hiện |
| https://meta.vn/sieu-tay-dau-mo-dr-c-danh-bay-vet-ban-cung-dau-chai-500ml-p79855 | 69 | 156 – liệt kê bề mặt: bếp ga, bếp từ, nồi, máy hút mùi + giá 120.000đ | Người mua lọc theo bề mặt cần lau, nên nêu đích danh |
| https://meta.vn/dung-dich-ve-sinh-kinh-chong-bam-nuoc-tren-be-mat-kinh-o-to-focar-glass-cleaner-5l-p66540 | 95 – bị cắt | 169 – giá 320.000đ cho can 5L | Can 5L của VKINNO có giá 95.000đ, đáng đưa vào mô tả |
| https://chiaki.vn/chai-xit-tay-dau-mo-nha-bep-denkmit-duc-750ml-lam-sach-bep-gas-lo-nuong-may-hut-mui-hieu-qua | 104 – bị cắt | 133 – không có giá | Mô tả không có giá, không có lý do bấm cụ thể |
| https://www.bachhoaxanh.com/kem-tay-lau-da-nang-365-max | 30 – quá ngắn | 143 | Tiêu đề ngắn phí chỗ hiển thị |

**Khoảng trống rút ra:** đối thủ dồn tên sản phẩm dài vào tiêu đề (95–104 ký tự, bị Google cắt) và để giá ở cuối mô tả. VKINNO đưa từ khoá lên đầu, giữ tiêu đề dưới 60 ký tự, và đặt giá đã gồm VAT + điều kiện freeship ngay trong mô tả.

## 1. Quy tắc đã áp dụng

- Từ khoá chính đứng đầu tiêu đề (trừ trang thương hiệu `/gioi-thieu/`, `/lien-he/`, nơi người tìm gõ chính tên VKINNO).
- Mọi số trong mô tả lấy từ `products.ts` (giá `price_vnd`, pH, tỷ lệ pha, thời gian ủ, dung tích), `siteConfig.ts` (freeship từ 199.000đ, hotline, MST) và `policies.json` (đổi trả 7 ngày, COD). Chiết khấu sỉ 20–40% lấy từ nội dung đang có trên `giai-phap-gara.astro`.
- Không dùng giá gạch `listed_price_vnd` hay "% giảm" trong mô tả: thẻ meta lưu cache lâu trên Google, giá gạch dễ lệch so với chương trình khuyến mại đã đăng ký (NĐ 128/2024).
- Không dùng từ so sánh tuyệt đối ("tốt nhất", "số 1", "hàng đầu"). Các tính năng nêu ra đều là tính năng ghi trong `products.ts`.
- Freeship chỉ ghi ở sản phẩm có giá ≥ 199.000đ (Solar Shield 295.000đ) hoặc ở lời gợi ý ghép combo. Can ClearWay 5L 155.000đ không ghi freeship.

## 2. Bảng 9 trang sản phẩm

| # | slug (đúng `products.ts`) | Từ khoá chính | seo_title | Ký tự | meta_description | Ký tự |
|---|---|---|---|---|---|---|
| 1 | `dung-dich-ve-sinh-tam-pin-mat-troi-solar-shield-dam-dac-giup-tang-hieu-suat-dien-tang-kem-binh-xit` | dung dịch vệ sinh tấm pin mặt trời | Dung dịch vệ sinh tấm pin mặt trời Solar Shield 5L \| VKINNO | 59 | Solar Shield can 5L đậm đặc, pha 1:20–1:30, pH trung tính, an toàn lớp phủ ARC và khung nhôm. Giá 295.000đ đã gồm VAT, tặng bình xịt 500ml, freeship. | 149 |
| 2 | `bo-chai-xit-500ml-phun-suong` | bình xịt phun sương 500ml | Bình xịt phun sương 500ml nhựa PET dày, có khóa \| VKINNO | 56 | Chai xịt rỗng 500ml nhựa PET nguyên sinh, cò xịt kháng hóa chất pH 3–10.5, 2 chế độ phun sương và tia thẳng, có khóa OFF. Giá 19.000đ, mua kèm can 5L. | 150 |
| 3 | `nuoc-lau-kinh-lam-sach-cuc-sau-khong-de-lai-vet-mo-can-5l-tang-kem-binh-xit-clearway-glasspro` | nước lau kính can 5L | Nước lau kính can 5L ClearWay, tặng bình xịt \| VKINNO | 53 | ClearWay GlassPro can 5L dùng ngay không cần pha, không Amoniac, không Methanol, khô trong 10–15 giây. Giá 155.000đ đã gồm VAT, tặng kèm bình xịt 500ml. | 152 |
| 4 | `nuoc-lau-kinh-clearway-glasspro-500ml-sach-nhanh-khong-vet-sang-bong-kinh-nha-van-phong` | nước lau kính 500ml | Nước lau kính 500ml ClearWay không vệt mờ, 45.000đ \| VKINNO | 59 | Chai xịt lau kính ClearWay 500ml cho gương, cửa sổ, bàn kính: khô nhanh, không mùi Amoniac, pH trung tính. Giá 45.000đ, ghép Bộ 3 Toàn Gia 199.000đ để freeship. | 160 |
| 5 | `chai-xit-tay-can-canxi-500ml-an-toan-cho-da-tay-dung-dich-tay-can-canxi-lam-sach-voi-sen-va-nha-tam` | tẩy cặn canxi kính nhà tắm | Tẩy cặn canxi kính nhà tắm, vòi sen Bossman 500ml \| VKINNO | 58 | Bossman 500ml gốc acid hữu cơ, không HCl/HF: xịt, ủ 5–15 phút là cặn vôi trên vách kính, sen vòi Chrome, Inox 304 mềm ra dễ lau. Giá 69.000đ đã gồm VAT. | 152 |
| 6 | `chai-xit-tay-rua-vet-o-kinh-logo-o-to-va-mang-dau-kinh-xit-lam-sach-sau-tiet-kiem-visionx-clean` | tẩy ố kính ô tô | Tẩy ố kính ô tô, màng dầu kính lái VisionX 500ml \| VKINNO | 57 | VisionX Clean 500ml xử lý đốm ố nước mưa, màng dầu gây lóa đèn ban đêm và làm sáng logo Chrome. Không chứa HF, tự làm tại nhà. Giá 75.000đ đã gồm VAT. | 150 |
| 7 | `nuoc-rua-kinh-o-to-chuyen-dung-clearway-chong-bam-nuoc-sach-sau-an-toan-voi-can-gat-va-be-mat-kinh` | nước rửa kính ô tô | Nước rửa kính ô tô can 5L không Methanol \| VKINNO | 49 | ClearWay can 5L đổ thẳng bình gạt mưa, không pha thêm nước. Nền nước Deion hạn chế tắc béc phun, gạt êm không kêu rít, không Methanol. Giá 95.000đ có VAT. | 154 |
| 8 | `tay-dau-mo-da-nang-cao-cap-vkinno-500ml-chuyen-dung-cho-bep-tu-bep-hong-ngoai-an-toan-be-mat-bep` | tẩy dầu mỡ bếp | Tẩy dầu mỡ bếp từ, lưới máy hút mùi chai 500ml \| VKINNO | 55 | Chai xịt bọt tẩy dầu mỡ 500ml không xút NaOH, không làm sùi đen lưới nhôm hút mùi, dùng được trên mặt kính bếp từ đã nguội. Hương chanh. Giá 85.000đ có VAT. | 156 |
| 9 | `combo-chai-xit-tay-can-canxi-500ml-va-chai-tay-dau-mo-an-toan-da-tay-cong-thuc-moi-sach-vuot-troi---combobossmanvkinno-1782568108` | combo tẩy cặn canxi và tẩy dầu mỡ | Combo tẩy cặn canxi + tẩy dầu mỡ bếp 145.000đ \| VKINNO | 54 | Combo Đôi Nhà Sạch: Bossman 500ml tẩy cặn canxi nhà tắm + VKINNO 500ml tẩy dầu mỡ bếp. Giá 145.000đ, rẻ hơn mua lẻ 9.000đ. Thêm chai lau kính để freeship. | 154 |

## 3. Bảng 7 trang chính

| Trang | Từ khoá chính | seo_title | Ký tự | meta_description | Ký tự |
|---|---|---|---|---|---|
| `/` | chất tẩy rửa sinh học | Chất tẩy rửa sinh học nền nước Deion chính hãng \| VKINNO | 56 | Tẩy cặn canxi Bossman, tẩy dầu mỡ bếp, nước lau kính, nước rửa kính ô tô và vệ sinh pin mặt trời. Giá đã gồm VAT, freeship từ 199.000đ, COD, đổi trả 7 ngày. | 156 |
| `/san-pham/` | bảng giá chất tẩy rửa VKINNO | Bảng giá chất tẩy rửa VKINNO: 9 sản phẩm, đã gồm VAT 8% | 55 | 9 sản phẩm từ 19.000đ: tẩy cặn canxi, tẩy dầu mỡ, lau kính, rửa kính ô tô, vệ sinh pin mặt trời. Combo Đôi Nhà Sạch 145.000đ, Bộ 3 Toàn Gia 199.000đ freeship. | 158 |
| `/gioi-thieu/` | VKINNO Công ty Vĩnh Khang | Giới thiệu VKINNO – Công ty TNHH Công nghệ Vĩnh Khang | 53 | VKINNO là thương hiệu của Công ty TNHH Công nghệ Vĩnh Khang (MST 0107301786, Hà Nội), sản xuất chất tẩy rửa nền nước Deion cho gia đình, ô tô và điện mặt trời. | 159 |
| `/lien-he/` | liên hệ VKINNO | Liên hệ VKINNO: hotline 0938.791.389, Zalo, kho Hà Nội | 54 | Gọi 0938.791.389 hoặc nhắn Zalo để được tư vấn chọn sản phẩm, báo giá sỉ gara, đại lý. Văn phòng tại Cầu Giấy, kho xuất hàng tại Di Trạch, Hoài Đức, Hà Nội. | 156 |
| `/giai-phap-gara/` | giá sỉ cho gara ô tô | Giá sỉ cho gara ô tô, chiết khấu 20–40% \| VKINNO | 48 | Chiết khấu sỉ 20–40% trên giá lẻ cho gara ô tô, Car Care và nhà thầu O&M điện mặt trời: nước rửa kính ClearWay 5L, tẩy ố VisionX, Solar Shield 5L. Giá gồm VAT. | 159 |
| `/bossman-creator/` | đăng ký KOC Bossman | Đăng ký KOC Bossman: nhận mẫu dùng thử thật \| VKINNO | 52 | Cho nhà sáng tạo nội dung mẹo dọn nhà, chăm xe trên TikTok, Shopee Video, Reels: nhận bộ mẫu Bossman và VKINNO dùng thật, hoa hồng tiếp thị liên kết minh bạch. | 159 |
| `/chinh-sach/` | chính sách đổi trả VKINNO | Chính sách đổi trả 7 ngày, giao hàng, bảo hành \| VKINNO | 55 | Đổi trả trong 7 ngày qua hotline 0938.791.389, thanh toán COD hoặc chuyển khoản VietQR, giao hàng toàn quốc, freeship đơn từ 199.000đ. Xem đủ điều khoản. | 153 |

Ghi chú căn chỉnh H1: tiêu đề mới của `/` và `/san-pham/` khác hẳn H1 hiện tại. Google hay tự viết lại tiêu đề khi tiêu đề lệch H1, nên Phòng Kỹ thuật FE cân nhắc đưa cụm "chất tẩy rửa sinh học" vào H1 trang chủ và "bảng giá" vào H1 `/san-pham/`.

## 4. Dữ liệu sạch để dán vào code

```json
{
  "products": {
    "dung-dich-ve-sinh-tam-pin-mat-troi-solar-shield-dam-dac-giup-tang-hieu-suat-dien-tang-kem-binh-xit": {
      "seo_title": "Dung dịch vệ sinh tấm pin mặt trời Solar Shield 5L | VKINNO",
      "meta_description": "Solar Shield can 5L đậm đặc, pha 1:20–1:30, pH trung tính, an toàn lớp phủ ARC và khung nhôm. Giá 295.000đ đã gồm VAT, tặng bình xịt 500ml, freeship."
    },
    "bo-chai-xit-500ml-phun-suong": {
      "seo_title": "Bình xịt phun sương 500ml nhựa PET dày, có khóa | VKINNO",
      "meta_description": "Chai xịt rỗng 500ml nhựa PET nguyên sinh, cò xịt kháng hóa chất pH 3–10.5, 2 chế độ phun sương và tia thẳng, có khóa OFF. Giá 19.000đ, mua kèm can 5L."
    },
    "nuoc-lau-kinh-lam-sach-cuc-sau-khong-de-lai-vet-mo-can-5l-tang-kem-binh-xit-clearway-glasspro": {
      "seo_title": "Nước lau kính can 5L ClearWay, tặng bình xịt | VKINNO",
      "meta_description": "ClearWay GlassPro can 5L dùng ngay không cần pha, không Amoniac, không Methanol, khô trong 10–15 giây. Giá 155.000đ đã gồm VAT, tặng kèm bình xịt 500ml."
    },
    "nuoc-lau-kinh-clearway-glasspro-500ml-sach-nhanh-khong-vet-sang-bong-kinh-nha-van-phong": {
      "seo_title": "Nước lau kính 500ml ClearWay không vệt mờ, 45.000đ | VKINNO",
      "meta_description": "Chai xịt lau kính ClearWay 500ml cho gương, cửa sổ, bàn kính: khô nhanh, không mùi Amoniac, pH trung tính. Giá 45.000đ, ghép Bộ 3 Toàn Gia 199.000đ để freeship."
    },
    "chai-xit-tay-can-canxi-500ml-an-toan-cho-da-tay-dung-dich-tay-can-canxi-lam-sach-voi-sen-va-nha-tam": {
      "seo_title": "Tẩy cặn canxi kính nhà tắm, vòi sen Bossman 500ml | VKINNO",
      "meta_description": "Bossman 500ml gốc acid hữu cơ, không HCl/HF: xịt, ủ 5–15 phút là cặn vôi trên vách kính, sen vòi Chrome, Inox 304 mềm ra dễ lau. Giá 69.000đ đã gồm VAT."
    },
    "chai-xit-tay-rua-vet-o-kinh-logo-o-to-va-mang-dau-kinh-xit-lam-sach-sau-tiet-kiem-visionx-clean": {
      "seo_title": "Tẩy ố kính ô tô, màng dầu kính lái VisionX 500ml | VKINNO",
      "meta_description": "VisionX Clean 500ml xử lý đốm ố nước mưa, màng dầu gây lóa đèn ban đêm và làm sáng logo Chrome. Không chứa HF, tự làm tại nhà. Giá 75.000đ đã gồm VAT."
    },
    "nuoc-rua-kinh-o-to-chuyen-dung-clearway-chong-bam-nuoc-sach-sau-an-toan-voi-can-gat-va-be-mat-kinh": {
      "seo_title": "Nước rửa kính ô tô can 5L không Methanol | VKINNO",
      "meta_description": "ClearWay can 5L đổ thẳng bình gạt mưa, không pha thêm nước. Nền nước Deion hạn chế tắc béc phun, gạt êm không kêu rít, không Methanol. Giá 95.000đ có VAT."
    },
    "tay-dau-mo-da-nang-cao-cap-vkinno-500ml-chuyen-dung-cho-bep-tu-bep-hong-ngoai-an-toan-be-mat-bep": {
      "seo_title": "Tẩy dầu mỡ bếp từ, lưới máy hút mùi chai 500ml | VKINNO",
      "meta_description": "Chai xịt bọt tẩy dầu mỡ 500ml không xút NaOH, không làm sùi đen lưới nhôm hút mùi, dùng được trên mặt kính bếp từ đã nguội. Hương chanh. Giá 85.000đ có VAT."
    },
    "combo-chai-xit-tay-can-canxi-500ml-va-chai-tay-dau-mo-an-toan-da-tay-cong-thuc-moi-sach-vuot-troi---combobossmanvkinno-1782568108": {
      "seo_title": "Combo tẩy cặn canxi + tẩy dầu mỡ bếp 145.000đ | VKINNO",
      "meta_description": "Combo Đôi Nhà Sạch: Bossman 500ml tẩy cặn canxi nhà tắm + VKINNO 500ml tẩy dầu mỡ bếp. Giá 145.000đ, rẻ hơn mua lẻ 9.000đ. Thêm chai lau kính để freeship."
    }
  },
  "pages": {
    "/": {
      "seo_title": "Chất tẩy rửa sinh học nền nước Deion chính hãng | VKINNO",
      "meta_description": "Tẩy cặn canxi Bossman, tẩy dầu mỡ bếp, nước lau kính, nước rửa kính ô tô và vệ sinh pin mặt trời. Giá đã gồm VAT, freeship từ 199.000đ, COD, đổi trả 7 ngày."
    },
    "/san-pham/": {
      "seo_title": "Bảng giá chất tẩy rửa VKINNO: 9 sản phẩm, đã gồm VAT 8%",
      "meta_description": "9 sản phẩm từ 19.000đ: tẩy cặn canxi, tẩy dầu mỡ, lau kính, rửa kính ô tô, vệ sinh pin mặt trời. Combo Đôi Nhà Sạch 145.000đ, Bộ 3 Toàn Gia 199.000đ freeship."
    },
    "/gioi-thieu/": {
      "seo_title": "Giới thiệu VKINNO – Công ty TNHH Công nghệ Vĩnh Khang",
      "meta_description": "VKINNO là thương hiệu của Công ty TNHH Công nghệ Vĩnh Khang (MST 0107301786, Hà Nội), sản xuất chất tẩy rửa nền nước Deion cho gia đình, ô tô và điện mặt trời."
    },
    "/lien-he/": {
      "seo_title": "Liên hệ VKINNO: hotline 0938.791.389, Zalo, kho Hà Nội",
      "meta_description": "Gọi 0938.791.389 hoặc nhắn Zalo để được tư vấn chọn sản phẩm, báo giá sỉ gara, đại lý. Văn phòng tại Cầu Giấy, kho xuất hàng tại Di Trạch, Hoài Đức, Hà Nội."
    },
    "/giai-phap-gara/": {
      "seo_title": "Giá sỉ cho gara ô tô, chiết khấu 20–40% | VKINNO",
      "meta_description": "Chiết khấu sỉ 20–40% trên giá lẻ cho gara ô tô, Car Care và nhà thầu O&M điện mặt trời: nước rửa kính ClearWay 5L, tẩy ố VisionX, Solar Shield 5L. Giá gồm VAT."
    },
    "/bossman-creator/": {
      "seo_title": "Đăng ký KOC Bossman: nhận mẫu dùng thử thật | VKINNO",
      "meta_description": "Cho nhà sáng tạo nội dung mẹo dọn nhà, chăm xe trên TikTok, Shopee Video, Reels: nhận bộ mẫu Bossman và VKINNO dùng thật, hoa hồng tiếp thị liên kết minh bạch."
    },
    "/chinh-sach/": {
      "seo_title": "Chính sách đổi trả 7 ngày, giao hàng, bảo hành | VKINNO",
      "meta_description": "Đổi trả trong 7 ngày qua hotline 0938.791.389, thanh toán COD hoặc chuyển khoản VietQR, giao hàng toàn quốc, freeship đơn từ 199.000đ. Xem đủ điều khoản."
    }
  }
}
```

## 5. Câu hỏi mở cho CEO

1. Giá trong mô tả sẽ lệch nếu đổi giá. Chọn: (a) giữ giá trong mô tả, mỗi lần đổi giá sửa tay; hoặc (b) Kỹ thuật ghép giá động từ `price_vnd` vào chuỗi mô tả lúc build.
2. Tiêu đề Combo dùng ký tự `+`. Nếu Chủ tịch muốn tránh ký hiệu, thay bằng "và" (vẫn dưới 60 ký tự).
