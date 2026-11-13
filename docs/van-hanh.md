# Vận hành quản trị kho và bán hàng VKINNO

Tài liệu này dành cho người chạy lệnh (anh). Mọi lệnh chạy trong thư mục gốc dự án `C:\vkinno`. Những bước cần đăng nhập Cloudflare, nạp khoá bí mật hoặc triển khai đều do anh thực hiện.

Quy ước: lệnh có `--env staging` là môi trường thử nghiệm; bỏ cờ này là production. Tên miền `vkinno.vn` giữ nguyên cho tới Dự án 2: quản trị chỉ chạy ở địa chỉ `*.workers.dev`.

## 1. Chuẩn bị

- Node.js 20 trở lên (`node -v`), đã chạy `npm install`.
- Đăng nhập Cloudflare một lần:

```powershell
npx wrangler login
npx wrangler whoami
```

## 2. Tạo D1 và R2

Hai môi trường tách hẳn nhau: `vkinno-db` + `vkinno-files` (production), `vkinno-db-staging` + `vkinno-files-staging` (staging).

```powershell
# Staging
npx wrangler d1 create vkinno-db-staging
npx wrangler r2 bucket create vkinno-files-staging

# Production
npx wrangler d1 create vkinno-db
npx wrangler r2 bucket create vkinno-files
```

Mỗi lệnh `d1 create` in ra một `database_id` (dạng UUID). Dán vào `wrangler.jsonc`, thay hai giá trị giữ chỗ `00000000-0000-0000-0000-000000000000`:

- `d1_databases[0].database_id` (ngoài cùng) là production, ứng với `vkinno-db`.
- `env.staging.d1_databases[0].database_id` là staging, ứng với `vkinno-db-staging`.

Không đổi `binding` (`DB`, `FILES`) và `migrations_dir`.

## 3. Khoá bí mật (secrets)

Nạp từng khoá, mỗi lệnh sẽ hỏi giá trị. Làm cho staging trước (`--env staging`), sau đó production (bỏ cờ).

Tạo chuỗi ngẫu nhiên cho `ADMIN_SESSION_SECRET` (khoá ký cookie phiên, 32 byte):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
# Staging
npx wrangler secret put ADMIN_SESSION_SECRET --env staging
npx wrangler secret put SEPAY_WEBHOOK_API_KEY --env staging
npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging
npx wrangler secret put TELEGRAM_CHAT_ID --env staging
npx wrangler secret put GOOGLE_SCRIPT_WEBHOOK_URL --env staging
npx wrangler secret put GOOGLE_SCRIPT_SECRET --env staging

# Production
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put SEPAY_WEBHOOK_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put GOOGLE_SCRIPT_WEBHOOK_URL
npx wrangler secret put GOOGLE_SCRIPT_SECRET
```

Ghi chú:

- `ADMIN_SESSION_SECRET` bắt buộc, thiếu thì không đăng nhập được. Dùng chuỗi khác nhau cho staging và production.
- `TELEGRAM_*` và `GOOGLE_SCRIPT_*` có thể bỏ qua khi thử nghiệm (tính năng tương ứng tự tắt).
- `SEPAY_WEBHOOK_API_KEY` phải trùng khoá cấu hình ở SePay (header `Authorization: Apikey <khoá>`).
- Xem danh sách đã nạp: `npx wrangler secret list` (thêm `--env staging` cho staging).

## 4. Migration

### Kiểm tra trước khi áp 0003 lên DB đã có dữ liệu

`0003_admin.sql` dựng lại bảng `products` và `orders`. Đơn cũ chưa từng giữ hàng hay trừ kho theo cách mới, nên nếu lúc áp còn đơn đang mở hoặc đơn đã thu tiền thì tồn kho, công nợ sẽ lệch. Với DB đã chạy website (production hiện tại), chạy câu kiểm tra này trước; kết quả **phải là 0**:

```powershell
npx wrangler d1 execute vkinno-db --remote --command "SELECT COUNT(*) FROM orders WHERE order_status IN ('PENDING','PACKED','SHIPPING') OR paid_amount > 0;"
```

Khác 0: **dừng lại, không áp migration**, gửi kết quả câu lệnh (số đơn và mã đơn: thay `COUNT(*)` bằng `order_code, order_status, paid_amount`) cho người phát triển để xử lý các đơn đó trước. DB mới tạo (staging) thì luôn ra 0.

### Áp migration

```powershell
# Staging
npx wrangler d1 migrations apply vkinno-db-staging --remote --env staging

# Production
npx wrangler d1 migrations apply vkinno-db --remote
```

Có ba migration: `0001_init.sql` (bảng gốc và 9 sản phẩm seed), `0002_sync_orders_and_slugs.sql`, `0003_admin.sql` (kho, chứng từ, thu tiền, báo giá, người dùng...). Wrangler hỏi xác nhận trước khi áp. Kiểm tra nhanh:

```powershell
npx wrangler d1 execute vkinno-db-staging --remote --env staging --command "SELECT sku, stock_qty FROM products"
```

## 5. Tạo ADMIN đầu tiên

Cú pháp: `node scripts/create-admin.mjs <email> <tên> <mật khẩu>` (mật khẩu tối thiểu 10 ký tự). Script chỉ in câu lệnh `INSERT` (mật khẩu đã băm PBKDF2), anh chạy câu lệnh đó lên D1:

```powershell
node scripts/create-admin.mjs admin@congty.vn "Tên Admin" "MatKhauManh!2026"
# Copy câu INSERT in ra rồi chạy (đặt trong nháy kép, giữ nguyên nội dung):
npx wrangler d1 execute vkinno-db-staging --remote --env staging --command "INSERT INTO users (...) VALUES (...);"
```

Cách gọn hơn, tránh sai nháy: ghi ra file rồi chạy file (file chứa mật khẩu đã băm, không commit):

```powershell
node scripts/create-admin.mjs admin@congty.vn "Tên Admin" "MatKhauManh!2026" > admin.sql
npx wrangler d1 execute vkinno-db-staging --remote --env staging --file admin.sql
Remove-Item admin.sql
```

Các tài khoản STAFF sau này tạo trong giao diện: Cài đặt, Tài khoản.

## 6. Đối chiếu sản phẩm với website (một lần, trước khi mở kho)

Script chỉ đọc `https://vkinno.vn/api/products?limit=200` và so với seed trong migration, không ghi gì lên Cloudflare:

```powershell
node scripts/reconcile-products.mjs
```

Script in bảng chênh lệch (giá, giá niêm yết, ảnh, mô tả) và ghi `scripts/out/reconcile.sql` (chỉ `UPDATE ... WHERE sku = ...`, không đổi SKU). Xem kỹ rồi mới áp:

```powershell
npx wrangler d1 execute vkinno-db-staging --remote --env staging --file scripts/out/reconcile.sql
```

Ảnh sản phẩm hiện nằm ở `susercontent.com` (Shopee). Muốn lưu về R2 của mình:

```powershell
# Chỉ tải ảnh về scripts/out/images và in lệnh upload (chưa chạy):
node scripts/reconcile-products.mjs --upload-images --bucket vkinno-files-staging
# Hoặc để script chạy luôn các lệnh `wrangler r2 object put ... --remote`:
node scripts/reconcile-products.mjs --upload-images --run --bucket vkinno-files-staging
```

Khi có `--upload-images`, `reconcile.sql` được kèm `image_url = '/files/products/<sku>.<đuôi>'`. Phải upload ảnh xong rồi mới áp SQL. Thư mục `scripts/out/` đã được git bỏ qua.

## 7. Nhập kho đầu kỳ (khi bắt đầu dùng thật)

Tồn kho seed của website có giá vốn bằng 0. Nếu cộng nhập kho thật lên trên số tồn đó, giá vốn bình quân bị kéo thấp và biên lãi hiển thị cao hơn thực tế. Vì vậy phải đưa kho về 0 rồi nhập lại bằng số đếm thật. ADMIN làm đúng hai bước, theo thứ tự:

1. **Kiểm kê về 0.** Mục Kho: tạo phiếu kiểm kê (`KK`) với số đếm thực tế bằng **0** cho mọi sản phẩm **trừ combo** (combo không có tồn riêng nên không kiểm kê được), rồi ghi sổ. Hệ thống ghi giảm tồn về 0 (lý do `STOCKTAKE`).
2. **Nhập đầu kỳ.** Mục Kho: tạo một phiếu nhập (`PN`) ghi chú "Nhập đầu kỳ", với **số lượng đếm thật** và **giá vốn thật trên mỗi đơn vị** cho từng sản phẩm, rồi ghi sổ. Giá vốn bình quân của từng sản phẩm bắt đầu từ các giá này.

Lưu ý: chỉ ADMIN lập được phiếu nhập (`RECEIPT`). Không có đơn nào đang mở khi làm bước 1 (tồn có thể bán không được âm). Combo không có tồn riêng, tồn combo tính từ các thành phần.

## 8. Vận hành hằng ngày

- **Nhập file đơn sàn mỗi ngày** (Shopee, TikTok). Với đơn sàn, doanh thu và giá vốn được ghi nhận lúc xuất kho, tức là lúc nhập file. Không nhập hằng ngày thì báo cáo doanh thu bị trễ.
- File được gửi lên theo từng lô **10 đơn** mỗi yêu cầu (`MAX_IMPORT_ORDERS_PER_REQUEST`). File lớn sẽ chạy nhiều lô, giao diện hiện tiến độ. Chạy lại cùng một file không tạo đơn trùng.
- **Xác nhận ánh xạ cột với file thật.** Ánh xạ mặc định (`src/shared/marketplace.ts`) dựng từ file mẫu. Với lần xuất đầu tiên từ Shopee và từ TikTok, mở Cài đặt, File sàn, so tên cột trong file thật với ánh xạ, sửa nếu lệch, rồi nhập thử vài đơn trước khi nhập cả file.
- **Phiếu nhập kho (`RECEIPT`) chỉ ADMIN** được lập và ghi sổ. STAFF xem được tồn nhưng không thấy giá vốn, lãi gộp.
- **Sửa thành phần của combo** bị chặn khi combo đó đang nằm trong đơn mở. Muốn đổi công thức, tạo mã combo (SKU) mới và ngừng bán mã cũ.
- Cảnh báo sắp hết hạn: 60 ngày. Cảnh báo tồn thấp gửi qua Telegram nếu bật ở Cài đặt, Telegram.
- **Giới hạn đơn website**: mỗi đơn đặt trên website tối đa **20 đơn vị cho mỗi sản phẩm** và **100 đơn vị cả đơn** (vượt thì khách thấy thông báo liên hệ Zalo/Hotline). Đơn số lượng lớn: nhân viên tạo đơn tay (kênh "Website (nhập tay)" hoặc B2B / báo giá).
- **Đơn web chờ thanh toán quá 48 giờ**: thẻ trên Tổng quan đếm đơn kênh Website đang chờ xử lý, chưa thu đồng nào, tạo quá 48 giờ; bấm vào để xem danh sách. Mỗi ngày rà thẻ này: gọi khách, hoặc huỷ đơn để trả hàng đang giữ về kho. Hệ thống **không tự huỷ** đơn.

## 9. Sao lưu và khôi phục

### Sao lưu tự động

Cron `0 19 * * *` (UTC), tức 02:00 giờ Việt Nam, ghi toàn bộ các bảng D1 vào R2 tại `backups/YYYY-MM-DD.json.gz`, giữ 90 ngày, tự xoá bản cũ hơn. Chạy tay: Cài đặt, Sao lưu (ADMIN). Nội dung tệp sau khi giải nén là JSON `{ "created_at": "...", "tables": { "<tên bảng>": [ { ...dòng }, ... ] } }`.

`triggers.crons` khai báo ở cấp ngoài cùng của `wrangler.jsonc`, nên cũng áp cho Worker staging (`vkinno-web-staging`) khi deploy `--env staging`: staging tự sao lưu vào bucket `vkinno-files-staging` của nó, vô hại. Kiểm tra cron đã được đăng ký sau mỗi lần deploy: Cloudflare Dashboard, Workers & Pages, chọn `vkinno-web` (và `vkinno-web-staging`), Settings, Triggers, mục Cron Triggers phải có `0 19 * * *`.

Thứ tự tác vụ hằng ngày: dọn `login_attempts` → cảnh báo kho → kiểm tra bản sao lưu hôm qua → sao lưu (chạy cuối, nếu sao lưu làm Worker vượt giới hạn CPU thì các bước trước đã xong). Nếu không thấy `backups/<ngày hôm qua>.json.gz`, Telegram nhận tin "Không thấy bản sao lưu ngày …" (cần `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). Cài đặt, Sao lưu hiện "Bản sao lưu gần nhất" (tên tệp, thời điểm, dung lượng) để kiểm tra bằng mắt.

### Khôi phục nhanh: D1 Time Travel (vài ngày gần nhất)

Dùng khi sự cố mới xảy ra. D1 giữ lịch sử theo thời điểm (30 ngày với gói trả phí, 7 ngày gói miễn phí).

```powershell
npx wrangler d1 time-travel info vkinno-db
npx wrangler d1 time-travel restore vkinno-db --timestamp "2026-11-12T08:00:00Z"
```

Lệnh `restore` ghi đè dữ liệu hiện tại; wrangler in ra "bookmark" của trạng thái trước khi khôi phục để quay lại nếu nhầm. Thêm `--env staging` hoặc đổi tên DB cho staging.

### Khôi phục từ bản sao lưu R2 (đầy đủ, cho bản cũ hơn)

Luôn khôi phục vào một D1 **tạm** trước để kiểm tra, rồi mới quyết định ghi vào DB thật.

```powershell
# 1. Tải bản sao lưu về (chọn ngày cần)
npx wrangler r2 object get vkinno-files/backups/2026-11-12.json.gz --file backup.json.gz --remote

# 2. Giải nén
node -e "require('fs').writeFileSync('backup.json', require('zlib').gunzipSync(require('fs').readFileSync('backup.json.gz')))"

# 3. Sinh SQL (DELETE con -> cha, rồi INSERT cha -> con)
node scripts/backup-to-sql.mjs backup.json restore.sql

# 4. Tạo D1 tạm, dựng schema bằng migration, nạp dữ liệu
npx wrangler d1 create vkinno-db-restore-tmp
npx wrangler d1 execute vkinno-db-restore-tmp --remote --file migrations/0001_init.sql
npx wrangler d1 execute vkinno-db-restore-tmp --remote --file migrations/0002_sync_orders_and_slugs.sql
npx wrangler d1 execute vkinno-db-restore-tmp --remote --file migrations/0003_admin.sql
npx wrangler d1 execute vkinno-db-restore-tmp --remote --file restore.sql

# 5. Kiểm tra số dòng và vài bản ghi
npx wrangler d1 execute vkinno-db-restore-tmp --remote --command "SELECT COUNT(*) FROM orders"
npx wrangler d1 execute vkinno-db-restore-tmp --remote --command "SELECT sku, stock_qty, reserved_qty FROM products"
```

(Với staging, thêm `--env staging` ở lệnh R2 nếu bucket là `vkinno-files-staging`: dùng tên bucket tương ứng thay cho `vkinno-files`.)

Khi đã chắc chắn bản sao lưu đúng, khôi phục vào DB thật bằng chính `restore.sql` (câu lệnh đã có `DELETE` toàn bộ rồi `INSERT`, bảng `d1_migrations` được bỏ qua).

**Trước khi ghi vào DB thật, ghi lại bookmark Time Travel** để có thể hoàn tác nếu khôi phục nhầm:

```powershell
npx wrangler d1 time-travel info vkinno-db
# Chép lại dòng bookmark in ra (lưu vào ghi chú), rồi mới chạy:
npx wrangler d1 execute vkinno-db --remote --file restore.sql
# Nếu cần quay lại trạng thái trước khi khôi phục:
npx wrangler d1 time-travel restore vkinno-db --bookmark <bookmark đã chép>
```

Dọn dẹp: `npx wrangler d1 delete vkinno-db-restore-tmp`, xoá `backup.json*` và `restore.sql` (chứa dữ liệu khách hàng và mật khẩu đã băm, không commit, không gửi đi).

Lưu ý: tệp sao lưu chỉ chứa dữ liệu D1. Ảnh trong R2 (`products/...`) không nằm trong tệp này.

## 10. Gỡ ADMIN_PASSWORD cũ

Khi đã đăng nhập được bằng tài khoản ADMIN mới (email + mật khẩu) ở `/quan-tri`, xoá biến mật khẩu quản trị cũ:

```powershell
npx wrangler secret delete ADMIN_PASSWORD --env staging
npx wrangler secret delete ADMIN_PASSWORD
```

Đồng thời bỏ dòng `ADMIN_PASSWORD` trong `.dev.vars` cục bộ nếu không còn dùng.

## 11. Triển khai

### Staging

```powershell
npm run build
npx wrangler deploy --env staging
```

Wrangler in địa chỉ dạng `https://vkinno-web-staging.<tên-tài-khoản>.workers.dev`. Truy cập `<địa chỉ>/quan-tri`.

Danh sách nghiệm thu (anh đánh dấu từng mục):

- [ ] Đăng nhập ADMIN thành công; trang quản trị có header `X-Robots-Tag: noindex, nofollow`.
- [ ] Nhập đầu kỳ: kiểm kê về 0, rồi một phiếu nhập "Nhập đầu kỳ" với số lượng và giá vốn thật; tồn kho và giá vốn bình quân đúng.
- [ ] Đơn 1, kênh Zalo: tạo đơn thủ công, đóng gói, giao hàng.
- [ ] Đơn 2, B2B từ báo giá: tạo báo giá, chuyển thành đơn, đóng gói, giao hàng.
- [ ] Đơn 3, nhập file Shopee (dùng file xuất thật hoặc file mẫu); kiểm tra ánh xạ cột, xuất kho lúc nhập.
- [ ] Đơn 4, đơn đặt từ website (form công khai); đơn xuất hiện trong quản trị, giữ hàng đúng.
- [ ] Thu tiền cho các đơn, gồm một giao dịch SePay thử (xem lệnh bên dưới); công nợ khớp.
- [ ] Báo cáo (doanh thu, giá vốn, lãi gộp, tồn kho) khớp với các đơn vừa làm; STAFF không thấy giá vốn và không vào được báo cáo.
- [ ] Chạy sao lưu tay (Cài đặt, Sao lưu), thấy tệp `backups/<ngày>.json.gz` trong R2.
- [ ] Khôi phục bản sao lưu đó vào D1 tạm theo mục 9, số dòng khớp, xoá D1 tạm.
- [ ] Giao diện dùng được trên điện thoại.
- [ ] Rủi ro gói Workers Free (xem ngay bên dưới) đã kiểm tra trên staging.

Rủi ro gói Workers Free cần thử trên staging (gói miễn phí giới hạn 10 ms CPU mỗi yêu cầu và 50 truy vấn D1 mỗi lần gọi):

- [ ] **CPU khi đăng nhập.** Mật khẩu băm PBKDF2 100.000 vòng. Đăng nhập vài lần liên tiếp; nếu gặp trang lỗi Cloudflare **1102** (Worker exceeded resource limits) hoặc đăng nhập thất bại ngẫu nhiên → nâng Workers Paid (5 USD/tháng). Không giảm số vòng băm.
- [ ] **CPU khi sao lưu** tăng theo lượng dữ liệu. Sau vài tuần dùng thật, xem Cài đặt, Sao lưu: "Bản sao lưu gần nhất" phải là ngày hôm nay/hôm qua. Bản sao lưu bị thiếu đã có tin Telegram "Không thấy bản sao lưu ngày …"; trong lúc đó D1 Time Travel (mục 9) vẫn là đường lùi. Thiếu lặp lại → nâng Workers Paid.
- [ ] **Số truy vấn D1 mỗi yêu cầu.** Nhập một file sàn có ít nhất 10 đơn (một lô đầy, `MAX_IMPORT_ORDERS_PER_REQUEST = 10`) và tạo một đơn tay 20 dòng hàng; cả hai phải thành công. Nếu lỗi kiểu "Too many API requests by single Worker invocation": giảm `MAX_IMPORT_ORDERS_PER_REQUEST` trong `src/shared/marketplace.ts` (ví dụ 5), build và deploy lại; đơn tay 20 dòng vẫn lỗi → nâng Workers Paid.

Giao dịch SePay thử (thay `<khoá>`, `<địa chỉ>`, mã đơn `VK...` của một đơn chuyển khoản đang chờ; tài khoản nhận phải đúng `0491000082331`):

```powershell
curl.exe -X POST "<địa chỉ>/api/webhook/sepay" `
  -H "Authorization: Apikey <khoá>" -H "Content-Type: application/json" `
  -d '{\"id\":900001,\"gateway\":\"VCB\",\"accountNumber\":\"0491000082331\",\"transferType\":\"in\",\"transferAmount\":100000,\"content\":\"VKABCD1234 thanh toan\"}'
```

### Production (`*.workers.dev`)

Chỉ làm sau khi anh xác nhận staging đạt:

```powershell
npm run build
npx wrangler deploy
```

Production cũng cần: D1/R2 production đã tạo (mục 2), secrets (mục 3), migration (mục 4), ADMIN (mục 5), nhập đầu kỳ (mục 7). Tên miền `vkinno.vn` chưa trỏ về Worker này cho tới Dự án 2.

## 12. Phát triển cục bộ

Windows Application Control chặn `workerd`, nên không dùng `wrangler dev`. Chạy API trên Node (D1 là SQLite trong `.dev/local.sqlite`, R2 trong bộ nhớ):

```powershell
Copy-Item .dev.vars.example .dev.vars
# Sửa .dev.vars: đặt DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD (tối thiểu 10 ký tự), ADMIN_SESSION_SECRET
npm run dev:api     # cổng 8787, tự áp migration và tạo ADMIN khi bảng users trống
npm run dev         # cổng 4321, proxy /api và /files sang 8787
```

Mở `http://localhost:4321/quan-tri`. Kiểm thử:

```powershell
npm test            # vitest, API và nghiệp vụ
npm run test:ui     # vitest giao diện (jsdom)
npm run typecheck
npm run build
```

`.dev.vars` đã nằm trong `.gitignore`; không commit khoá thật.
