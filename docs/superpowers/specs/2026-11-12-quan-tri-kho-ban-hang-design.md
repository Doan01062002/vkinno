# Thiết kế: Trang quản trị kho & bán hàng VKINNO (Dự án 1)

- Ngày: 2026-11-12
- Trạng thái: chờ duyệt
- Repo: `vkinno` (bản 2.0: Astro + Cloudflare Worker + D1)

## 1. Bối cảnh

- VKINNO bán chất tẩy rửa sinh học, sản phẩm chăm sóc ô tô và dụng cụ làm vườn. Có 9 sản phẩm, 3 danh mục, một số sản phẩm là combo.
- Hiện có 2 người vận hành, 1 kho. Bán qua website, điện thoại/Zalo/Facebook, bán sỉ (B2B) và sàn Shopee/TikTok.
- Website đang chạy trên vkinno.vn là bản cũ, mã nguồn khác repo này và **không có trang quản trị**.
- Repo `vkinno` là **bản 2.0** sẽ thay bản cũ. Bản 2.0 đã có sẵn:
  - Bảng `products` có tồn kho, combo theo `bom_items`, đơn đa kênh (`orders`, `order_items`), sổ kho `inventory_logs`, `leads`, nhật ký SePay.
  - API: danh sách sản phẩm, tạo đơn, trạng thái đơn, tra cứu đơn, `leads`, webhook SePay.
  - Thanh toán VietQR có SePay tự khớp và báo Telegram.
  - Đẩy một bản sao đơn hàng sang Google Sheets qua Apps Script.
- Bản 2.0 còn thiếu:
  - Trang quản trị (code có nhắc `/quan-tri` nhưng chưa có).
  - Đặt đơn không trừ hoặc giữ kho (`stock_deducted = 0`).
  - Ghi đơn và ghi dòng hàng chạy ở hai bước riêng, không nằm trong cùng một giao dịch.
  - `wrangler.jsonc` chưa có D1 thật (mã toàn số 0).
- Giao diện mẫu tham khảo: các module kho vận và kinh doanh của "5F template" (bản khôi phục ở repo `ERP_Teamplate`). Chỉ dùng làm khuôn mẫu giao diện và nghiệp vụ, **không chép mã**.

## 2. Mục tiêu & tiêu chí hoàn thành

**Mục tiêu:** một trang `/quan-tri` để 2 người quản lý toàn bộ hàng hoá, kho, đơn hàng mọi kênh, thu tiền, công nợ B2B và báo cáo. Dùng **một nguồn dữ liệu duy nhất** là D1, chi phí hạ tầng 0đ.

**Tiêu chí hoàn thành:**
1. Mọi thay đổi tồn kho đều đi qua module kho, có sổ kho. Tồn và số "đang giữ" không bao giờ âm, kể cả khi hai thao tác chạy cùng lúc. Có test chứng minh.
2. Đơn web, đơn nhập tay và đơn nhập file sàn đều giữ hàng khi tạo, trừ kho khi đóng gói, hoàn kho khi huỷ hoặc trả hàng đúng quy tắc ở mục 5.
3. Báo cáo lãi gộp dùng giá vốn bình quân tại thời điểm xuất kho.
4. Công nợ B2B cho thấy nợ hiện tại, đã trả và quá hạn theo từng khách.
5. Nhân viên không xem được giá vốn, lãi và báo cáo tài chính.
6. Tự sao lưu D1 sang R2 hằng ngày, và có hướng dẫn khôi phục.
7. Luồng chính chạy được trên môi trường thử nghiệm: nhập kho → tạo đơn (4 kênh) → đóng gói → giao → thu tiền → báo cáo.

## 3. Phạm vi

**Trong phạm vi Dự án 1:**

| Nhóm | Chức năng |
|---|---|
| Hàng hoá | CRUD sản phẩm và combo (BOM); giá bán lẻ, giá niêm yết, giá sỉ; giá vốn bình quân (chỉ đọc); đơn vị tính; danh mục; ảnh (upload R2); vị trí kệ; tồn tối thiểu; trạng thái đang bán/ngừng bán |
| Kho | Phiếu nhập (nhà cung cấp, đơn giá, lô, hạn dùng); phiếu xuất khác hoặc huỷ hàng; phiếu điều chỉnh; phiếu kiểm kê (đếm thực tế → chênh lệch → ghi sổ). Xem tồn: thực tế, đang giữ, có thể bán. Sổ kho theo sản phẩm. Cảnh báo dưới tồn tối thiểu và sắp hết hạn. Báo cáo nhập-xuất-tồn theo kỳ |
| Đơn hàng | Danh sách gộp mọi kênh, có bộ lọc kênh/trạng thái/thanh toán/ngày. Nhập đơn tay (PHONE, ZALO, FACEBOOK, B2B). Nhập file Shopee/TikTok. Đổi trạng thái theo mục 5. Thông tin giao hàng (đơn vị, mã vận đơn, phí). In phiếu giao, in phiếu xuất B2B |
| Thanh toán | Ghi nhận thu tay (tiền mặt, chuyển khoản, COD đối soát), thu nhiều lần. SePay tự tạo bản ghi thu tiền. Xử lý giao dịch SePay chưa khớp đơn (gán tay) |
| B2B | Khách sỉ (mã số thuế, hạn mức nợ, số ngày được nợ, giá sỉ). Báo giá → chuyển thành đơn. Công nợ theo khách và theo đơn, quá hạn |
| Khách hàng | Gộp theo số điện thoại; lịch sử đơn; tổng chi tiêu; ghi chú |
| Nhà cung cấp | CRUD; lịch sử phiếu nhập |
| Báo cáo | Doanh thu, giá vốn, lãi gộp theo ngày/tuần/tháng, kênh, sản phẩm; hàng bán chạy; công nợ; xuất Excel |
| Hệ thống | 2 vai trò (Quản trị, Nhân viên); đăng nhập; nhật ký thao tác; cài đặt (thông tin công ty, mẫu in, Telegram); sao lưu hằng ngày; bản sao sang Google Sheets |
| Website | Sửa `POST /api/orders`: tạo đơn + dòng hàng + giữ hàng trong một giao dịch; kiểm tra theo số "có thể bán"; danh sách sản phẩm hiển thị theo số "có thể bán" |

**Ngoài phạm vi** (dự án sau, khi có nhu cầu thật):
- Bán tại quầy (POS).
- Hoá đơn điện tử.
- API Shopee/TikTok cho đơn tự về (Dự án 1 dùng nhập file).
- API GHN/GHTK.
- Nhiều kho.
- Tồn kho theo lô (FEFO).
- **Dự án 2:** đưa các tính năng của website cũ vào bản 2.0 (tài khoản khách, mã giảm giá, danh mục động, bài viết động, tỉnh/phường) rồi chuyển tên miền vkinno.vn.

## 4. Kiến trúc

```
Trình duyệt ──► Cloudflare Worker (worker/index.ts)
                 ├─ /api/*            API công khai (đã có, sửa luồng đặt đơn)
                 ├─ /api/webhook/*    SePay (đã có)
                 ├─ /api/admin/*      API quản trị (mới, worker/admin/)
                 ├─ /quan-tri/*       trả /quan-tri/index.html (SPA)
                 └─ còn lại           tài nguyên tĩnh do Astro build
                 │
                 ├─ D1  vkinno-db     nguồn dữ liệu duy nhất
                 ├─ R2  vkinno-files  ảnh sản phẩm + bản sao lưu
                 ├─ Cron hằng ngày    sao lưu, cảnh báo tồn/hạn → Telegram
                 └─ Apps Script       bản sao một chiều sang Google Sheets (chỉ xem)
```

**Giao diện quản trị** (`src/admin/`):
- Ứng dụng React chạy hoàn toàn ở trình duyệt, gắn vào trang Astro `src/pages/quan-tri/index.astro` bằng `client:only="react"`. Điều hướng bằng react-router với `basename="/quan-tri"`.
- `wrangler.jsonc` thêm `"/quan-tri/*"` vào `run_worker_first`. Worker trả `index.html` của `/quan-tri` cho mọi đường dẫn con, và đặt header `X-Robots-Tag: noindex`.
- Thư viện: `react-router`, `@tanstack/react-query`, `react-hook-form`, `zod`, `recharts`, `xlsx` (SheetJS), `lucide-react` (đã có), Tailwind v4 (đã có).
- Bố cục theo bản mẫu 5F: thanh menu trái, đầu trang có breadcrumb, bảng có lọc/tìm/phân trang, hộp thoại thêm/sửa, thông báo dạng toast. Giao diện tiếng Việt, có chế độ tối.

**Phía máy chủ** (`worker/admin/`):
- `router.ts`: định tuyến `/api/admin/*`, kiểm tra phiên đăng nhập và quyền.
- `auth.ts`: đăng nhập, phiên, mã hoá mật khẩu.
- `inventory.ts`: **module kho duy nhất**. Mọi thay đổi `stock_qty`, `reserved_qty` hay `inventory_logs` đều phải qua đây. Module trả về danh sách câu lệnh D1 để người gọi gộp vào một `DB.batch()` cùng các thay đổi khác.
- `orders.ts`, `stock-docs.ts`, `payments.ts`, `customers.ts`, `suppliers.ts`, `quotes.ts`, `reports.ts`, `imports.ts`, `uploads.ts`, `settings.ts`, `backup.ts`, `sheets.ts`.
- `worker/index.ts` chỉ còn: định tuyến tổng, API công khai, webhook. Luồng đặt đơn công khai dùng `inventory.ts` và `orders.ts`.

## 5. Quy tắc tồn kho

**Khái niệm:**
- Mỗi sản phẩm lẻ có `stock_qty` (tồn thực tế) và `reserved_qty` (đang giữ). **Có thể bán = stock_qty − reserved_qty.**
- Combo (`is_combo = 1`) không có tồn riêng. Có thể bán của combo = min theo từng thành phần của ⌊có thể bán / qty_per_combo⌋. Mọi thao tác giữ/trừ/hoàn của combo được tách thành các thành phần theo `bom_items`.

**Bất biến** (do CHECK của cơ sở dữ liệu bảo đảm): `stock_qty >= 0`, `reserved_qty >= 0`, `reserved_qty <= stock_qty`. Lệnh UPDATE nào vi phạm sẽ làm cả `DB.batch()` bị huỷ. Đây là cách chặn bán vượt tồn khi hai thao tác chạy cùng lúc.

**Theo trạng thái đơn:**

| Chuyển trạng thái | Tác động kho | Sổ kho (`reason`) |
|---|---|---|
| Tạo đơn → `PENDING` | `reserved += qty` | không ghi (chỉ giữ) |
| `PENDING` → `PACKED` (đóng gói, xuất kho) | `stock -= qty`, `reserved -= qty`; ghi giá vốn bình quân vào `order_items.unit_cost_vnd`; `stock_deducted = 1` | `SALE_OUT` |
| `PACKED` → `SHIPPING` → `COMPLETED` | không | — |
| `PENDING` → `CANCELLED` | `reserved -= qty` | không ghi |
| `PACKED` → `CANCELLED` (huỷ sau khi đóng gói, hàng chưa rời kho) | `stock += qty` | `CANCEL_RESTOCK` |
| `SHIPPING`/`COMPLETED` → `RETURNED` | Chọn từng dòng: nhập lại (`stock += qty`) hoặc ghi hỏng (không cộng) | `RETURN_RESTOCK` / `RETURN_DAMAGED` (delta 0) |

- Mọi chuyển trạng thái khác bị từ chối (409). Không được sửa dòng hàng khi đơn đã qua `PENDING`.
- Đơn sàn nhập từ file có trạng thái đã giao hoặc hoàn thành: tạo thẳng ở trạng thái tương ứng và trừ kho ngay (`SALE_OUT`), không qua bước giữ.

**Phiếu kho** (`stock_docs`): trạng thái `DRAFT` → `POSTED` (ghi sổ, không sửa được nữa) hoặc `CANCELLED` (chỉ khi còn nháp). Muốn sửa phiếu đã ghi sổ thì lập phiếu điều chỉnh.

| Loại phiếu | Tác động khi ghi sổ |
|---|---|
| `RECEIPT` (nhập) | `stock += qty`. Giá vốn bình quân mới = (stock·avg + qty·đơn giá) / (stock + qty) |
| `ISSUE` (xuất khác, huỷ hàng) | `stock -= qty` (không được làm `stock < reserved`) |
| `ADJUST` (điều chỉnh) | `stock += delta` (delta âm hoặc dương) |
| `STOCKTAKE` (kiểm kê) | Mỗi dòng có số đếm thực tế. Khi ghi sổ: delta = đếm − tồn lúc ghi sổ |

- Lô và hạn dùng được lưu trên dòng phiếu nhập để tra cứu.
- Cảnh báo "sắp hết hạn" lấy các phiếu nhập còn hàng theo nguyên tắc nhập trước xuất trước (FIFO), tính trên tổng số đã xuất. Bản này chỉ ước lượng, không chia tồn theo lô.

## 6. Dữ liệu (migration `0003_admin.sql`)

SQLite không thêm được CHECK vào bảng đã có, nên `products` và `orders` được dựng lại bằng cách tạo bảng mới, chép dữ liệu, rồi đổi tên (giống cách làm ở 0002). File ghi kế hoạch hoàn tác ở đầu.

**Sửa bảng có sẵn:**
- `products`: thêm `reserved_qty INTEGER NOT NULL DEFAULT 0`, `cost_avg_vnd INTEGER NOT NULL DEFAULT 0`, `wholesale_price_vnd INTEGER`, `unit TEXT NOT NULL DEFAULT 'chai'`, `category TEXT NOT NULL DEFAULT ''`, `is_active INTEGER NOT NULL DEFAULT 1`, `description TEXT NOT NULL DEFAULT ''`, `gallery_json TEXT NOT NULL DEFAULT '[]'`. Thêm CHECK theo mục 5. Bỏ CHECK cố định của `shelf_zone`, chuyển thành giá trị tự do có gợi ý.
- `orders`: thêm `customer_id INTEGER REFERENCES customers(id)`, kênh `FACEBOOK`, phương thức thanh toán `CASH`, `BANK_TRANSFER`, `MARKETPLACE`, `due_date TEXT`, `source TEXT CHECK (source IN ('WEB','MANUAL','IMPORT','QUOTE'))`, `created_by INTEGER`, `quote_id INTEGER`.
- `order_items`: thêm `unit_cost_vnd INTEGER` (ghi khi xuất kho).
- `inventory_logs`: thêm `doc_type TEXT`, `doc_code TEXT`, `unit_cost_vnd INTEGER`, `created_by INTEGER`.

**Bảng mới:**
- `customers(id, phone UNIQUE, name, type CHECK IN ('RETAIL','B2B'), company_name, tax_code, email, address, credit_limit_vnd, payment_terms_days, price_tier CHECK IN ('RETAIL','WHOLESALE'), note, created_at, updated_at)`
- `suppliers(id, name, phone, email, address, tax_code, note, is_active, created_at)`
- `stock_docs(id, code UNIQUE, type, status, supplier_id, note, created_by, posted_by, posted_at, created_at)`
- `stock_doc_lines(id, doc_id, sku, qty, unit_cost_vnd, batch_code, expiry_date, counted_qty, system_qty)`
- `payments(id, order_id, kind CHECK IN ('RECEIPT','REFUND'), amount_vnd CHECK > 0, method, reference, sepay_tx_id UNIQUE, received_at, created_by, note)`. `orders.paid_amount` = tổng thu − tổng hoàn, cập nhật cùng `payment_status` trong cùng giao dịch khi thêm khoản thu hoặc hoàn. Hoàn tiền dùng khi đơn đã thu tiền bị huỷ hoặc trả hàng.
- `quotes(id, code UNIQUE, customer_id, status CHECK IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED'), valid_until, note, discount_vnd, shipping_fee_vnd, created_by, created_at)` và `quote_items(id, quote_id, sku, product_name, unit_price, quantity)`
- `channel_sku_map(channel, external_sku, sku, PRIMARY KEY(channel, external_sku))`: gán SKU trên sàn sang SKU nội bộ.
- `import_batches(id, channel, file_name, total_rows, created_orders, skipped_duplicates, errors_json, created_by, created_at)`
- `users(id, email UNIQUE, name, role CHECK IN ('ADMIN','STAFF'), password_hash, is_active, last_login_at, created_at)`
- `login_attempts(key, count, window_start)`: chống đoán mật khẩu.
- `audit_logs(id, user_id, action, entity, entity_id, detail_json, created_at)`

**Chỉ mục:** `orders(customer_id, created_at)`, `payments(order_id)`, `inventory_logs(sku, created_at)`, `stock_doc_lines(doc_id)`, `quote_items(quote_id)`.

**Công nợ B2B:** không có bảng riêng. Nợ của một đơn = `total_amount − paid_amount`, tính trên đơn chưa huỷ hoặc trả. Quá hạn khi `due_date < hôm nay`. Mặc định `due_date = ngày xuất kho + payment_terms_days`.

## 7. API quản trị

- Tất cả nằm dưới `/api/admin/*`, dùng JSON. Lỗi trả dạng `{ ok:false, error:{ code, message } }` với mã HTTP 400/401/403/404/409/422.
- Danh sách hỗ trợ `?page&limit&q&sort` cùng bộ lọc riêng.

| Nhóm | Endpoint chính |
|---|---|
| Đăng nhập | `POST auth/login`, `POST auth/logout`, `GET auth/me`, `POST auth/change-password` |
| Sản phẩm | `GET/POST products`, `GET/PUT products/:sku`, `PUT products/:sku/bom`, `POST uploads/image` |
| Kho | `GET inventory` (tồn: thực tế, đang giữ, có thể bán), `GET inventory/:sku/ledger`, `GET inventory/alerts`, `GET/POST stock-docs`, `GET/PUT stock-docs/:id`, `POST stock-docs/:id/post`, `POST stock-docs/:id/cancel`, `GET reports/stock-movement` |
| Đơn hàng | `GET/POST orders`, `GET/PUT orders/:id` (sửa khi còn `PENDING`), `POST orders/:id/transition` `{to, lines?}`, `PUT orders/:id/shipping`, `POST orders/import` (dữ liệu đã đọc từ file ở trình duyệt), `GET/PUT channel-sku-map` |
| Thanh toán | `GET/POST orders/:id/payments`, `GET sepay/unmatched`, `POST sepay/:txId/assign` |
| Khách, NCC | `GET/POST customers`, `GET/PUT customers/:id`, `GET customers/:id/orders`; tương tự `suppliers` |
| Báo giá | `GET/POST quotes`, `GET/PUT quotes/:id`, `POST quotes/:id/convert` |
| Công nợ | `GET debts` (theo khách), `GET debts/:customerId` (theo đơn) |
| Báo cáo | `GET reports/sales?from&to&group=day|week|month|channel|product`, `GET reports/top-products` |
| Hệ thống | `GET/PUT settings`, `GET audit-logs`, `GET/POST users` (ADMIN), `POST backup/run` (ADMIN) |

**Phân quyền:**
- `STAFF` không gọi được: báo cáo tài chính, `users`, `settings`, `backup`.
- Mọi phản hồi gửi cho `STAFF` đều bỏ các trường giá vốn (`cost_avg_vnd`, `unit_cost_vnd`) và các trường lãi.

## 8. Bảo mật

- Mật khẩu băm bằng PBKDF2-SHA256 (WebCrypto, 100.000 vòng, muối riêng từng người).
- Phiên đăng nhập là cookie `vk_admin` đã ký HMAC bằng `ADMIN_SESSION_SECRET`, có cờ `HttpOnly; Secure; SameSite=Strict; Path=/`, hết hạn sau 7 ngày.
- Các yêu cầu thay đổi dữ liệu phải có header `Origin` trùng tên miền.
- Sai mật khẩu quá 5 lần trong 15 phút thì khoá theo IP + email.
- Tài khoản ADMIN đầu tiên tạo bằng một lệnh `wrangler d1 execute` có trong hướng dẫn triển khai (không có trang tự đăng ký).
- Biến `ADMIN_PASSWORD` cũ bỏ đi, sau khi tạo xong tài khoản đầu tiên.
- Ảnh upload: chỉ nhận `image/jpeg|png|webp`, tối đa 5 MB, đặt tên theo mã ngẫu nhiên.
- Khoá bí mật nạp bằng `wrangler secret put`, không nằm trong repo.

## 9. Nhập đơn Shopee/TikTok từ file

1. Trình duyệt đọc file `.xlsx` hoặc `.csv` xuất từ trang người bán bằng SheetJS.
2. Bảng ánh xạ cột được cấu hình sẵn cho từng sàn (mã đơn, ngày, trạng thái, SKU người bán, tên hàng, số lượng, đơn giá, phí ship, tên và số điện thoại người nhận). Anh chỉnh được trong Cài đặt nếu sàn đổi mẫu file.
3. Màn hình xem trước báo: đơn mới, đơn đã có (trùng `external_order_id` thì bỏ qua), dòng có SKU chưa gán (cho gán ngay, lưu vào `channel_sku_map`).
4. Bấm xác nhận thì gửi dữ liệu đã chuẩn hoá lên `POST orders/import`. Mỗi đơn là một giao dịch riêng; đơn lỗi không chặn các đơn khác. Kết quả lưu vào `import_batches`.
5. Ánh xạ trạng thái sàn: đã huỷ → bỏ qua; chờ xác nhận/chờ lấy hàng → `PENDING`; đang giao → `SHIPPING`; đã giao/hoàn thành → `COMPLETED`. `payment_method = MARKETPLACE`; khi `COMPLETED` thì coi như đã thanh toán (sàn tự đối soát).

> Mẫu file thật của Shopee/TikTok sẽ được lấy từ tài khoản người bán của VKINNO khi làm phần này. Bảng ánh xạ cột được kiểm thử bằng chính file đó.

## 10. Màn hình quản trị

1. **Tổng quan:** doanh thu hôm nay/tháng (ADMIN), số đơn theo trạng thái, đơn chờ xử lý, cảnh báo tồn và hạn, SePay chưa khớp.
2. **Đơn hàng:** danh sách, nhập đơn tay (tìm khách theo số điện thoại, chọn sản phẩm có hiện số có thể bán, giá lẻ hoặc sỉ theo khách), chi tiết đơn (dòng thời gian trạng thái, giao hàng, thanh toán, in phiếu), nhập file sàn.
3. **Báo giá.**
4. **Khách hàng, Công nợ.**
5. **Sản phẩm** (kèm combo).
6. **Kho:** tồn kho, phiếu kho (nhập, xuất, điều chỉnh, kiểm kê), sổ kho, nhập-xuất-tồn.
7. **Nhà cung cấp.**
8. **Báo cáo** (ADMIN).
9. **Cài đặt** (ADMIN): công ty, mẫu in, Telegram, ánh xạ cột file sàn, tài khoản, nhật ký, sao lưu.

## 11. Đồng bộ phụ, sao lưu, cảnh báo

- **Google Sheets:** dùng lại hàm đẩy dữ liệu sang Apps Script (`GOOGLE_SCRIPT_WEBHOOK_URL`). Gửi thêm các sự kiện `order.status_changed`, `payment.created`, `stock_doc.posted`. Chạy qua `ctx.waitUntil`, nếu lỗi thì chỉ ghi log, không chặn thao tác chính. Sheets chỉ để xem; sửa trên Sheets không được ghi ngược về D1.
- **Sao lưu:** Cron 02:00 giờ Việt Nam (`0 19 * * *` theo UTC) xuất toàn bộ bảng ra JSON, lưu vào `R2: backups/YYYY-MM-DD.json.gz`, giữ 90 ngày. Hướng dẫn khôi phục ghi trong `docs/van-hanh.md`. D1 Time Travel là lớp dự phòng thứ hai.
- **Cảnh báo Telegram:** hằng ngày báo các sản phẩm dưới tồn tối thiểu và lô sắp hết hạn trong 60 ngày. Ngay lập tức báo khi có đơn web mới và khi có SePay chưa khớp (đã có).

## 12. Xử lý lỗi

- Mọi thao tác ghi gồm nhiều bước (đơn + dòng + giữ hàng; ghi sổ phiếu; thêm thanh toán; chuyển trạng thái) đều chạy trong một `DB.batch()`. Hoặc tất cả thành công, hoặc không có gì thay đổi.
- Hết hàng (vi phạm CHECK) → 409 với thông báo "Sản phẩm X chỉ còn N có thể bán".
- Chuyển trạng thái sai → 409.
- Dữ liệu đầu vào được kiểm tra bằng zod ở cả trình duyệt và Worker (dùng chung schema trong `src/shared/`) → 422 kèm lỗi từng trường.
- Nhập file sàn: lỗi từng đơn được ghi vào `errors_json`, không huỷ cả đợt nhập.
- Giao diện: lỗi mạng hiện toast có nút thử lại; xung đột 409 thì tải lại dữ liệu mới nhất.

## 13. Kiểm thử

- **Vitest** với `@cloudflare/vitest-pool-workers` trên D1 cục bộ, chạy đủ migration.
- `inventory.ts` (viết test trước): giữ/trừ/hoàn theo mọi dòng trong bảng mục 5; combo; tranh nhau món cuối cùng (hai batch song song, đúng một cái thành công); không cho tồn hay số giữ âm; giá vốn bình quân qua nhiều lần nhập; kiểm kê khi có hàng đang giữ.
- Đơn hàng: tạo đơn web, tạo đơn tay, nhập file (trùng, SKU chưa gán, trạng thái sàn), từng chuyển trạng thái hợp lệ và không hợp lệ.
- Thanh toán: thu nhiều lần đến đủ tiền; SePay tự ghi; gán giao dịch chưa khớp.
- Đăng nhập và phân quyền: sai mật khẩu, bị khoá, phiên hết hạn, STAFF không thấy trường giá vốn, STAFF bị 403 ở các API cấm.
- **Kiểm thử tay trên trình duyệt** (môi trường thử nghiệm): luồng ở tiêu chí 7, cùng giao diện trên màn hình điện thoại.

## 14. Triển khai

1. Tạo `vkinno-db-staging`, `vkinno-db` (D1) và `vkinno-files` (R2). Thêm `env.staging` trong `wrangler.jsonc`. Nạp các khoá bí mật cho từng môi trường.
2. Chạy migration trên staging, nhập 9 sản phẩm (mục 15), tạo tài khoản ADMIN, chạy thử toàn bộ.
3. Deploy production lên tên miền tạm `*.workers.dev`. Tên miền vkinno.vn **vẫn trỏ về web cũ** cho tới khi Dự án 2 xong.
4. **Trong giai đoạn chuyển tiếp:** đơn đặt trên web cũ được nhân viên nhập tay vào trang quản trị (kênh WEB, nguồn MANUAL). Khi Dự án 2 chuyển tên miền, đơn web sẽ tự đổ về.
5. Các bước cần quyền tài khoản Cloudflare hoặc tên miền: em chuẩn bị đến bước cuối và để anh tự xác nhận.

## 15. Dữ liệu ban đầu

- **Sản phẩm:** lấy 9 sản phẩm từ API công khai của web cũ (`/api/products`): tên, slug, danh mục, thương hiệu, giá, giá khuyến mãi, ảnh, thư viện ảnh, mô tả.
  - Sinh SKU theo quy tắc `VK-<SLUG-RÚT-GỌN>`. Sản phẩm trùng với 7 sản phẩm mẫu của bản 2.0 (khớp theo slug hoặc tên) thì giữ SKU cũ.
  - Ảnh tải về R2.
  - Combo được khai báo thành phần bằng tay khi duyệt.
  - Có một script `scripts/import-old-products.ts` tạo file SQL để anh xem trước khi chạy.
- **Tồn kho:** bắt đầu từ 0. Anh lập **phiếu nhập đầu kỳ** với số lượng và giá vốn thực tế.
- **Đơn, khách, mã giảm giá cũ:** không chuyển.

## 16. Rủi ro & cách giảm

| Rủi ro | Cách giảm |
|---|---|
| Giai đoạn chuyển tiếp phải nhập tay đơn web cũ | Đơn web còn ít; nhập đơn tay được tối ưu để thao tác nhanh. Ưu tiên làm Dự án 2 ngay sau |
| Mẫu file Shopee/TikTok thay đổi | Ánh xạ cột chỉnh được trong Cài đặt; màn hình xem trước báo dòng lỗi |
| Giới hạn gói miễn phí D1/R2/Workers | Lưu lượng ước tính dưới 2% hạn mức; cron sao lưu nén; theo dõi trên bảng điều khiển Cloudflare |
| Gói Workers miễn phí giới hạn CPU mỗi yêu cầu | Báo cáo dùng truy vấn SQL gộp có chỉ mục, không tính toán nặng trong Worker; xuất Excel làm ở trình duyệt |
| Mất dữ liệu | Sao lưu R2 hằng ngày, Time Travel, kiểm tra khôi phục một lần trước khi đưa vào dùng |

## 17. Quyết định đã chốt

- Bản 2.0 (Astro + Worker + D1) là hệ thống chính. D1 là nguồn dữ liệu duy nhất. Sheets là bản sao chỉ để xem. Ảnh lưu trên R2.
- Giao diện quản trị viết mới trong repo `vkinno`, theo khuôn mẫu giao diện 5F, không chép mã khôi phục.
- Giữ hàng khi tạo đơn, trừ kho khi đóng gói. Chưa chia tồn theo lô.
- Kênh bán: điện thoại/Zalo/Facebook, B2B, Shopee/TikTok (nhập file), web. Không làm POS.
- Dữ liệu bắt đầu mới. Sản phẩm giữ như web cũ.
