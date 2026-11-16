# Thiết kế: Đơn sàn tự về qua Pancake POS (Dự án 1b – Đa kênh)

> Trạng thái: **đã duyệt 16/11/2026** (anh chọn cách A: tự nhận webhook trên staging). Bước 0b đang làm, kết quả ở mục 16.
> Dự án 1 đã lên staging: `https://vkinno-web-staging.vkinno.workers.dev`.

## 1. Bối cảnh

- Trang quản trị (Dự án 1) đã có đơn đa kênh, nhưng đơn Shopee/TikTok phải **tải file từ sàn rồi nhập** (`worker/admin/imports.ts`).
- Anh muốn đơn sàn **tự về**, nhưng **không tự đăng ký API sàn** và **không tốn tiền**.
- Quyết định 16/11/2026: dùng **Pancake POS** làm ống dẫn. Pancake đã được Shopee, Lazada, TikTok Shop duyệt API; chủ shop chỉ đăng nhập và bấm "Ủy quyền". Pancake tự ghi là miễn phí. Nhanh.vn bị loại vì thu phí (POS 250.000đ + Ecom 100.000đ mỗi tháng).
- Điều kiện của anh: **nếu không miễn phí thì không làm.**

## 2. Mục tiêu & tiêu chí hoàn thành

**Mục tiêu:** đơn mới trên Shopee, TikTok Shop, Lazada tự xuất hiện trong `/quan-tri` và giữ hàng, không cần nhập file. Tồn kho trên sàn được cập nhật theo số "có thể bán" của VKINNO. **D1 của VKINNO vẫn là kho gốc duy nhất.**

**Tiêu chí hoàn thành:**
1. Đơn sàn mới vào admin trong vòng 2 phút kể từ khi Pancake nhận được đơn, ở trạng thái `PENDING` và đã giữ hàng.
2. Pancake gửi lại cùng một đơn nhiều lần → admin chỉ có **một** đơn. Đơn đã nhập bằng file trước đó cũng không bị tạo lại.
3. Đơn huỷ trên sàn → admin tự huỷ và trả hàng giữ (nếu đơn còn `PENDING`/`PACKED`).
4. Đơn giao xong trên sàn → admin chuyển `COMPLETED` và ghi nhận thu (sàn thu hộ), giống đơn nhập file.
5. Đơn trả hàng → **không tự xử lý kho**, mà báo Telegram và gắn cờ "cần xử lý trả hàng" để người quyết định nhập lại hay ghi hỏng.
6. Webhook bị lỡ (Pancake lỗi, Worker lỗi) → lần đối soát định kỳ kéo bù, không mất đơn.
7. Tồn "có thể bán" trên Pancake (và từ đó lên sàn) khớp với VKINNO trong vòng 15 phút sau mỗi thay đổi kho.
8. Chi phí phát sinh: **0đ** (Pancake miễn phí, Cloudflare gói miễn phí).

## 3. Phạm vi

**Trong phạm vi:**

| Nhóm | Chức năng |
|---|---|
| Nhận đơn | Endpoint webhook `POST /api/webhook/pancake` nhận loại `orders` |
| Ánh xạ | Trạng thái Pancake → trạng thái VKINNO (mục 6). Mẫu mã Pancake → SKU VKINNO (mục 7) |
| Đối soát | Cron mỗi 15 phút gọi API Pancake lấy các đơn cập nhật gần đây, xử lý những gì webhook bỏ sót |
| Đẩy tồn | Đẩy số "có thể bán" của VKINNO lên Pancake bằng `POST /shops/{SHOP_ID}/variations/update_quantity` |
| Giao diện | Cài đặt → tab **Pancake**: tình trạng kết nối, ánh xạ mẫu mã chưa gán, sự kiện lỗi + nút xử lý lại, nút "Đẩy tồn ngay". Danh sách đơn: thêm kênh Lazada, lọc theo nguồn Pancake |
| Cảnh báo | Telegram khi: đơn có SKU chưa gán, đơn trả hàng, webhook lỗi liên tiếp, đẩy tồn thất bại |

**Ngoài phạm vi:**
- Gom tin nhắn chat Facebook/Zalo (dùng Chatwoot đã có).
- Đẩy trạng thái ngược từ VKINNO lên sàn (xác nhận đơn, in vận đơn, giao cho đơn vị vận chuyển). Việc này vẫn làm trên Pancake hoặc trang người bán.
- Đăng và sửa sản phẩm lên sàn từ VKINNO.
- Đơn Facebook/Zalo/tạo tay trong Pancake (chỉ nhận đơn có `marketplace_id` khác `null`; payload thật không có trường `is_from_ecommerce`, xem mục 16).

## 4. Kiến trúc

```
Shopee / TikTok Shop / Lazada
        │  (chủ shop bấm "Ủy quyền" trong Pancake)
        ▼
   Pancake POS ──── webhook "orders" ─────────────► POST /api/webhook/pancake
        ▲          (header X-VK-Key bí mật)              │
        │                                                ├─ ghi pancake_events (thô, chống trùng)
        │                                                ├─ ánh xạ SKU, trạng thái
        │                                                └─ createOrder / transitionOrder (đã có)
        │
        ├── GET /shops/{id}/orders (cron 15 phút) ◄──── đối soát bù webhook lỡ
        │
        └── POST variations/update_quantity ◄────────── đẩy "có thể bán" (cron + sau khi đổi kho)
                                                         │
                                                  D1 vkinno-db = kho gốc
```

- File mới: `worker/admin/pancake.ts` (xử lý sự kiện, ánh xạ, đối soát, đẩy tồn) và `worker/lib/pancake-client.ts` (gọi API Pancake, có timeout và thử lại).
- `worker/index.ts`: thêm route webhook, cùng kiểu bảo vệ như SePay (so khoá bằng `timingSafeCompare`).
- **Không** viết lại luồng tạo đơn. Mọi đơn đi qua `createOrder` (nguồn `PANCAKE`) và `transitionOrder` có sẵn, nên quy tắc kho mục 5 của Dự án 1 giữ nguyên.
- Nguồn `PANCAKE` dùng cùng kiểu kiểm tra dễ dãi như `IMPORT` (`importOrderInput`, `lenientPhone`), vì sàn thường che bớt số điện thoại và địa chỉ người mua.

## 5. Bảo mật

- Pancake cho tự đặt **Request Headers** khi cấu hình webhook. Đặt header `X-VK-Key: <PANCAKE_WEBHOOK_SECRET>` (chuỗi ngẫu nhiên 32 byte, nạp bằng `wrangler secret put`). Worker so khoá bằng `timingSafeCompare`; sai khoá → 401, không ghi gì.
- `PANCAKE_API_KEY` (tạo ở Pancake: Cấu hình → Nâng cao → Kết nối bên thứ 3 → Webhook/API) nạp bằng `wrangler secret put`, chỉ dùng phía Worker, không trả về giao diện.
- Giới hạn thân yêu cầu 512 KB. Kiểm tra `shop_id` trong payload trùng với `pancake.shop_id` trong cài đặt; khác → bỏ qua và ghi lỗi.
- Dữ liệu khách từ sàn (tên, số điện thoại, địa chỉ) chỉ lưu những trường cần giao hàng, như đơn nhập file hiện nay.

## 6. Ánh xạ trạng thái

Mã trạng thái lấy từ tài liệu Pancake POS Open API (`WebhookOrderResponse.status`).

| Pancake | Ý nghĩa | VKINNO |
|---|---|---|
| 0, 17, 11, 20, 1, 12, 13, 8, 9 | Mới, Chờ xác nhận, Chờ hàng, Đã đặt hàng, Đã xác nhận, Chờ in, Đã in, Đang đóng hàng, Chờ chuyển hàng | `PENDING` (giữ hàng) |
| 2 | Đã gửi hàng | `SHIPPING` |
| 3, 16 | Đã nhận, Đã thu tiền | `COMPLETED` (ghi nhận thu `MARKETPLACE`) |
| 6 | Đã huỷ | `CANCELLED` |
| 4, 15, 5 | Đang hoàn, Hoàn một phần, Đã hoàn | Gắn cờ **cần xử lý trả hàng** + Telegram, không tự đổi kho |
| 7 | Đã xoá | Bỏ qua, ghi sự kiện |

**Quy tắc:**
- **Đơn chưa có trong admin:** tạo theo cột VKINNO. Đơn đến lần đầu ở `SHIPPING`/`COMPLETED` thì tạo thẳng và trừ kho ngay, giống đơn nhập file (`directSaleOutStmts`). Đơn đến lần đầu ở trạng thái huỷ, xoá hay hoàn thì không tạo.
- **Đơn đã có:** chỉ đi **tiến**, không lùi. Nếu cần nhiều bước, đi lần lượt qua các bước hợp lệ của bảng chuyển trạng thái Dự án 1, mỗi bước một lần `transitionOrder`. Ví dụ `PENDING` → `SHIPPING` = `PENDING→PACKED` (trừ kho, ghi giá vốn) rồi `PACKED→SHIPPING`.
- Trạng thái Pancake "lùi" hơn trạng thái VKINNO hiện tại (ví dụ nhân viên đã đóng gói trong admin) → bỏ qua, ghi sự kiện.
- `CANCELLED` khi đơn VKINNO đã `SHIPPING`/`COMPLETED` → không làm gì về kho, báo Telegram để người xem.
- Người tự đổi trạng thái trong admin vẫn được. Lần webhook sau chỉ đẩy tiến nếu Pancake đi xa hơn.

## 7. Ánh xạ sản phẩm

- Mỗi dòng hàng Pancake có `variation_id` và `variation_info` (gồm mã mẫu mã do shop đặt).
- **Cách khuyến nghị:** khi tạo sản phẩm trên Pancake, đặt **mã mẫu mã = SKU VKINNO** (ví dụ `VK-SOLAR-SHIELD-5L`). Khi đó ánh xạ thẳng, không cần cấu hình.
- Dự phòng: dùng bảng `channel_sku_map` có sẵn với `channel = 'PANCAKE'`, `external_sku = variation_id`. Màn hình Cài đặt → Pancake liệt kê các mẫu mã chưa gán để chọn SKU, giống màn hình nhập file.
- Đơn có dòng chưa gán SKU → **không tạo đơn**, lưu sự kiện ở trạng thái `NEEDS_MAPPING`, báo Telegram. Gán xong thì bấm "Xử lý lại" (hoặc lần đối soát sau tự xử lý).
- Combo: nếu combo trên sàn được khai báo là một mẫu mã trên Pancake thì gán vào SKU combo của VKINNO; kho VKINNO tự tách thành phần theo BOM như hiện nay.
- Số lượng và đơn giá lấy từ dòng hàng Pancake; phí ship lấy `shipping_fee`; giảm giá lấy `total_discount`. Phí sàn (`fee_marketplace`) chỉ ghi vào ghi chú ở bản này, chưa đưa vào báo cáo lãi.

## 8. Chống trùng

- `external_order_id` (đã có `UNIQUE`):
  - Nếu payload có **mã đơn gốc của sàn** thì dùng mã đó, giống đơn nhập file. Khi đó đơn đã nhập bằng file sẽ không bị tạo lại.
  - Nếu không có thì dùng `PCK-<shop_id>-<id Pancake>`.
  - `[ASSUMED]` Tài liệu Pancake có `marketplace_id` (mã **sàn**: -3 Shopee, -9 TikTok, -4 Lazada) nhưng chưa thấy trường mã đơn gốc của sàn. **Phải xác nhận bằng payload thật ở bước 0 (mục 12).** Nếu không có, kể từ ngày bật Pancake thì **ngừng nhập file** cho các shop đã nối, để tránh trùng.
- `pancake_events` chống xử lý lặp: khoá `UNIQUE(pancake_order_id, status, updated_at)`. Sự kiện trùng → trả 200 ngay, không xử lý lại.

## 9. Dữ liệu (migration `0004_pancake.sql`)

**Sửa bảng có sẵn** (dựng lại `orders` theo mẫu 0003 vì SQLite không sửa được CHECK):
- `orders.channel`: thêm `LAZADA`.
- `orders.source`: thêm `PANCAKE`.
- `orders`: thêm `needs_attention TEXT` (lý do cần người xử lý, ví dụ `RETURN_FROM_MARKETPLACE`; `NULL` khi bình thường).

**Bảng mới:**
- `pancake_events(id, pancake_order_id, status INTEGER, updated_at TEXT, payload_json TEXT, result TEXT CHECK IN ('CREATED','UPDATED','SKIPPED','NEEDS_MAPPING','ERROR'), message TEXT, order_id INTEGER, received_at, via TEXT CHECK IN ('WEBHOOK','RECONCILE'), UNIQUE(pancake_order_id, status, updated_at))`. Giữ 90 ngày, cron tự xoá bản cũ.
- `pancake_stock_push(sku PRIMARY KEY, variation_id, last_qty INTEGER, pushed_at, last_error)`: chỉ đẩy SKU có số "có thể bán" khác lần đẩy trước.

**Cài đặt** (`app_settings`): `pancake.shop_id`, `pancake.warehouse_id`, `pancake.enabled` (`0`/`1`, công tắc tắt nhanh), `pancake.last_reconcile_at`.

**Khoá bí mật:** `PANCAKE_API_KEY`, `PANCAKE_WEBHOOK_SECRET`.

## 10. Đối soát và đẩy tồn

**Đối soát (cron `*/15 * * * *`):**
- Gọi `GET /shops/{SHOP_ID}/orders` lọc theo thời điểm cập nhật từ `last_reconcile_at − 5 phút` đến hiện tại, phân trang.
- Mỗi đơn đi qua đúng hàm xử lý của webhook (`via = 'RECONCILE'`). Khoá chống trùng làm cho việc chạy lại an toàn.
- Lỗi gọi API → ghi log, không cập nhật `last_reconcile_at`, lần sau thử lại. Lỗi 3 lần liên tiếp → Telegram.

**Đẩy tồn (cùng cron, chạy sau đối soát):**
- Tính "có thể bán" bằng `availability()` có sẵn (combo theo BOM).
- So với `pancake_stock_push.last_qty`; chỉ gửi SKU thay đổi, tối đa 100 mẫu mã mỗi lần gọi `variations/update_quantity` với `is_actual_remain_quantity = false` (cập nhật số có thể bán) và `warehouse_id` từ cài đặt.
- Pancake tự đồng bộ tồn sang sàn. **Trong Pancake phải bật** "Đồng bộ tồn kho POS → Shopee/TikTok/Lazada", và **không** nhập kho trực tiếp trên Pancake.
- Nút "Đẩy tồn ngay" trong Cài đặt gọi cùng hàm.

> Cron mới cộng với cron sao lưu hiện có là 2 lịch, trong giới hạn gói miễn phí `[ASSUMED: tối đa 5 lịch mỗi tài khoản]`. Mỗi lần chạy vài lời gọi API, dưới giới hạn 50 lời gọi ra ngoài mỗi lần chạy của gói miễn phí.

## 11. Xử lý lỗi

- Webhook luôn trả **200** khi đã ghi được sự kiện, kể cả khi xử lý lỗi (lỗi lưu ở `pancake_events`), để Pancake không gửi lại vô hạn. Chỉ trả 401 (sai khoá), 400 (JSON hỏng), 503 (`pancake.enabled = 0`).
- Thiếu hàng khi tạo đơn (409 `STOCK_CONFLICT`) → vẫn ghi sự kiện `ERROR` + Telegram "Đơn sàn X thiếu hàng SKU Y". Đơn trên sàn đã bán, nên người phải quyết định nhập thêm kho hay huỷ.
- Một đơn lỗi không chặn đơn khác (mỗi đơn một `try`, giống `runImport`).
- Màn hình sự kiện lỗi có nút "Xử lý lại" (chạy lại từ `payload_json`).

## 12. Triển khai từng bước

| Bước | Việc | Ai làm |
|---|---|---|
| 0 | Đăng ký Pancake POS, nối 1 shop (Shopee hoặc TikTok), tạo sản phẩm với mã mẫu mã = SKU VKINNO hoặc dùng "Liên kết sản phẩm" | **Anh** |
| 0b | Bật webhook tạm trỏ tới một trang nhận thử (ví dụ webhook.site) để lấy **payload thật** của một đơn sàn. Xác nhận: webhook có bắn cho đơn từ sàn không, có mã đơn gốc của sàn không, có gửi lại khi đổi trạng thái không, gói miễn phí giới hạn bao nhiêu đơn | Anh tạo đơn thử, em đọc payload |
| 1 | Đưa Dự án 1 lên staging (đang chờ ở task 20) | Anh đăng nhập Cloudflare, em chuẩn bị lệnh |
| 2 | Migration 0004 + webhook + ánh xạ + test (viết test trước, dùng payload thật ở bước 0b làm mẫu) | Em |
| 3 | Đối soát cron | Em |
| 4 | Đẩy tồn | Em |
| 5 | Giao diện Cài đặt → Pancake, kênh Lazada, cờ cần xử lý | Em |
| 6 | Trỏ webhook Pancake về staging, chạy nghiệm thu mục 2, rồi mới bật production | Anh xác nhận |

**Điểm dừng:** nếu ở bước 0b phát hiện Pancake **thu phí** cho kết nối sàn hoặc webhook, hoặc giới hạn đơn miễn phí thấp hơn số đơn thực tế của VKINNO, thì **dừng dự án** theo điều kiện của anh và giữ cách nhập file.

## 13. Kiểm thử

- Vitest trên D1 cục bộ, fixture là payload thật từ bước 0b (đã che thông tin khách).
- Webhook: sai khoá → 401; trùng sự kiện → không tạo thêm; `shop_id` lạ → bỏ qua; `marketplace_id = null` (đơn tạo tay) → bỏ qua.
- Ánh xạ trạng thái: mỗi dòng bảng mục 6; đi tiến nhiều bước; trạng thái lùi bị bỏ qua; huỷ khi đã giao → chỉ báo.
- Ánh xạ SKU: mã mẫu mã trùng SKU; qua `channel_sku_map`; chưa gán → `NEEDS_MAPPING`, gán xong xử lý lại được.
- Chống trùng với đơn nhập file (nếu có mã đơn gốc).
- Đối soát: đơn lỡ webhook được tạo; chạy hai lần không trùng.
- Đẩy tồn: chỉ gửi SKU thay đổi; combo tính theo BOM; Pancake lỗi → giữ `last_qty` cũ để lần sau gửi lại.

## 14. Rủi ro & cách giảm

| Rủi ro | Cách giảm |
|---|---|
| Pancake đổi chính sách miễn phí | Công tắc `pancake.enabled`; cách nhập file vẫn còn nguyên để quay về |
| Hai nơi giữ tồn (Pancake và VKINNO) lệch nhau | VKINNO là gốc, đẩy số tuyệt đối 15 phút/lần; cấm nhập kho trên Pancake (ghi vào `docs/van-hanh.md`) |
| Bán vượt trên sàn trong 15 phút giữa hai lần đẩy | Chấp nhận ở quy mô hiện tại; nếu xảy ra, đơn vào admin báo thiếu hàng ngay để xử lý |
| Pancake đổi cấu trúc payload | Kiểm tra bằng zod với các trường cần dùng, phần còn lại cho qua; sai cấu trúc → sự kiện `ERROR` + Telegram, không mất payload |
| Webhook không bắn cho đơn từ sàn | Đối soát 15 phút vẫn kéo được đơn (độ trễ tối đa 15 phút thay vì 2 phút) |
| Phụ thuộc thêm một bên thứ ba | Chỉ là ống dẫn; dữ liệu gốc vẫn ở D1, có sao lưu R2 hằng ngày |

## 15. Việc cần anh quyết định

1. Duyệt bản thiết kế này.
2. Làm bước 0 và 0b (đăng ký Pancake, nối 1 shop, tạo 1 đơn thử) và gửi em kết quả.
3. Đồng ý đưa Dự án 1 lên staging trước (bắt buộc để nhận webhook).

## 16. Kết quả bước 0b (16/11/2026)

Hạ tầng: `POST /api/webhook/pancake` trên staging chỉ kiểm header `X-VK-Key` rồi lưu nguyên văn vào `pancake_inbox` (migration `0004`). Pancake: Cấu hình → Tích hợp bên thứ 3 → Webhook/API, bật "Gửi dữ liệu", Dữ liệu = Đơn hàng, Request Headers `X-VK-Key`. Mẫu payload (có email nhân viên, không commit): `.dev/pancake-payloads/`.

**Đã xác nhận `[VERIFIED]`** với 1 đơn tạo tay (#1, không sản phẩm):
- Webhook bắn khi **tạo** đơn (`event_type = "create"`) và khi **sửa** đơn, kể cả chỉ sửa ghi chú (`event_type = "update"`, `updated_at` mới). Độ trễ dưới 1 giây.
- Gửi `Content-Type: application/json`, thân khoảng 5,4 KB khi chưa có dòng hàng; mỗi lần gửi là **toàn bộ đơn**, không phải phần thay đổi.
- Có `type = "orders"`, `shop_id`, `status` (0 = `new`), `status_name`, `status_history[]`, `items[]`, `shipping_fee`, `total_discount`, `fee_marketplace`, `warehouse_id`, `marketplace_id`, `additional_info.booking_sn`, `bill_full_name`, `bill_phone_number`, `shipping_address{full_name, phone_number, full_address, province_name, ...}`.
- Mã đơn: `id` là số thứ tự **trong shop** (đơn đầu = 1); `system_id` = 1; mã toàn hệ thống chỉ nằm trong `order_link` (`order_id=10970705792`). → Khoá chống trùng dùng `PCK-<shop_id>-<id>`.
- **Không có** trường `is_from_ecommerce`. Đơn tạo tay có `marketplace_id = null` → dùng `marketplace_id` để lọc đơn sàn.
- Không thấy trang thu phí khi bật webhook và tạo đơn.

**Còn phải xác nhận bằng 1 đơn Shopee thật `[ASSUMED]`:**
- Mã đơn gốc Shopee nằm ở `additional_info.booking_sn` (tên trường giống "order SN" của Shopee) — nếu đúng thì chống trùng được với đơn nhập file.
- `marketplace_id` của Shopee là `-3`; cấu trúc `items[].variation_info` (mã mẫu mã) để ánh xạ SKU.
- Đơn sàn có bắn webhook giống đơn tạo tay không.
- Giới hạn đơn của gói miễn phí.

**Hệ quả cho thiết kế:** vì đơn sửa ghi chú cũng bắn webhook, khoá chống lặp `UNIQUE(pancake_order_id, status, updated_at)` ở mục 8 vẫn đúng nhưng sẽ ghi nhiều sự kiện `SKIPPED`; giữ 90 ngày rồi xoá như đã định.

## Nguồn

- Pancake POS Open API (webhook, trạng thái đơn, `variations/update_quantity`): https://docs.pancake.biz/pos/api/en (đọc ngày 16/11/2026)
- Pancake POS – Kết nối Shopee: https://docs.pos.pages.fm/pos/thiet-lap-shop/kenh-ban/ket-noi-kenh-ban/shopee
- Pancake POS (trang chủ, ghi "miễn phí"): https://pos.pancake.vn/
- Nhanh.vn – Bảng giá (lý do loại): https://nhanh.vn/bang-gia-phan-mem
