# Trang quản trị kho & bán hàng VKINNO – Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây trang `/quan-tri` cùng API `/api/admin/*` trên Worker và D1 hiện có, để 2 người quản lý hàng hoá, kho, đơn đa kênh, thu tiền, công nợ B2B và báo cáo. Mọi thay đổi tồn kho đi qua một module kho duy nhất.

**Architecture:** Cloudflare Worker (`worker/index.ts`) định tuyến `/api/admin/*` sang `worker/admin/router.ts`. Nghiệp vụ nằm trong các module theo nhóm ở `worker/admin/`. Riêng `worker/admin/inventory.ts` sinh ra mọi câu lệnh thay đổi tồn kho, người gọi gộp chúng vào một `DB.batch()`. Bất biến tồn kho do CHECK của D1 bảo đảm. Giao diện là ứng dụng React (`src/admin/`) gắn vào trang Astro `/quan-tri`, gọi API bằng TanStack Query. Schema zod dùng chung ở `src/shared/`.

**Tech Stack:** Astro 7, React 19, Tailwind v4, Cloudflare Workers + D1 + R2 + Cron, TypeScript, zod, react-router, @tanstack/react-query, react-hook-form, recharts, xlsx (SheetJS), Vitest + @cloudflare/vitest-pool-workers, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-12-quan-tri-kho-ban-hang-design.md`

## Global Constraints

- Mọi chuỗi giao diện bằng tiếng Việt; số tiền là số nguyên VND, hiển thị `Intl.NumberFormat('vi-VN')` + " ₫".
- Bất biến kho (CHECK): `stock_qty >= 0`, `reserved_qty >= 0`, `reserved_qty <= stock_qty`. Có thể bán = `stock_qty − reserved_qty`.
- Không câu lệnh nào ngoài `worker/admin/inventory.ts` được ghi `stock_qty`, `reserved_qty`, `cost_avg_vnd` hay `inventory_logs`.
- Thao tác ghi nhiều bước phải nằm trong một `env.DB.batch([...])`. Khi cần id của dòng vừa tạo trong cùng batch, dùng subquery theo mã duy nhất (vd. `(SELECT id FROM orders WHERE order_code = ?)`).
- Lỗi API: `{ ok:false, error:{ code, message, details? } }`. Mã HTTP: 400 (yêu cầu sai), 401 (chưa đăng nhập), 403 (không đủ quyền / Origin sai), 404, 409 (xung đột kho/trạng thái), 422 (validate). Thành công: `{ ok:true, data }`.
- Vai trò: `ADMIN`, `STAFF`. Phản hồi cho STAFF bỏ các khoá `cost_avg_vnd`, `unit_cost_vnd`, `cost_total_vnd`, `gross_profit_vnd`, `gross_margin`. STAFF bị 403 ở `reports/*` (trừ `reports/stock-movement`), `users`, `settings`, `backup`, `audit-logs`.
- Cookie phiên: tên `vk_admin`, `HttpOnly; Secure; SameSite=Strict; Path=/`, sống 7 ngày, ký HMAC-SHA256 bằng `ADMIN_SESSION_SECRET`. Mật khẩu: PBKDF2-SHA256, 100000 vòng, muối 16 byte, lưu `pbkdf2$100000$<saltB64>$<hashB64>`. Sai quá 5 lần trong 15 phút theo khoá `ip|email` → 429.
- Yêu cầu thay đổi dữ liệu (POST/PUT/DELETE) tới `/api/admin/*` phải có header `Origin` trùng `new URL(request.url).origin`, nếu không thì 403.
- Mã chứng từ: `<TIỀN TỐ><YYMMDD>-<4 ký tự A-Z0-9 ngẫu nhiên>`. Tiền tố: `PN` nhập, `PX` xuất khác, `DC` điều chỉnh, `KK` kiểm kê, `BG` báo giá. Mã đơn giữ hàm `generateOrderCode()` hiện có.
- Lý do trong sổ kho (`inventory_logs.reason`): `RECEIPT`, `ISSUE`, `ADJUST`, `STOCKTAKE`, `SALE_OUT`, `CANCEL_RESTOCK`, `RETURN_RESTOCK`, `RETURN_DAMAGED`.
- Mọi API quản trị có ghi dữ liệu đều thêm `auditStmt(...)` (Task 3) vào cùng batch. `action` theo dạng `<entity>.<động từ>`, ví dụ `order.transition`, `payment.create`, `stock_doc.post`.
- Thời gian lưu UTC (`datetime('now')`). Báo cáo và lọc ngày theo giờ Việt Nam: `date(col, '+7 hours')`.
- Doanh thu ghi nhận lúc xuất kho (`SALE_OUT`) = `subtotal_vnd − discount_vnd` của đơn, không gồm phí ship. Trả hàng trừ doanh thu vào ngày trả. Giá vốn = Σ `unit_cost_vnd × quantity` của dòng đã xuất. Lãi gộp = doanh thu − giá vốn.
- Ảnh upload: `image/jpeg|png|webp`, tối đa 5 MB, khoá R2 `products/<uuid>.<ext>`, phục vụ qua `GET /files/<key>`.
- Sao lưu: cron `0 19 * * *` → `R2 backups/YYYY-MM-DD.json.gz`, xoá bản cũ hơn 90 ngày. Cảnh báo hết hạn: 60 ngày.
- Trang quản trị trả header `X-Robots-Tag: noindex, nofollow`.
- Website: tên, mô tả, ảnh trên trang sản phẩm vẫn build từ `src/data/products.ts` (đổi khi build lại, thuộc Dự án 2). Giá và tồn đọc trực tiếp từ `/api/products.json`.

## Review Focus

1. **Hai người cùng đóng gói hoặc tạo đơn cho món hàng cuối cùng:** đúng một thao tác thành công, thao tác kia nhận 409 "Sản phẩm X chỉ còn N có thể bán", tồn không âm (Task 4, 8).
2. **Kiểm kê khi đang có hàng được giữ cho đơn chờ:** số đếm thấp hơn số đang giữ → 409, không ghi sổ nửa vời; số đếm hợp lệ thì giữ nguyên `reserved_qty` (Task 5).
3. **Nhập lại cùng một file sàn hai lần, hoặc file có đơn đã huỷ / SKU lạ:** lần hai không tạo đơn trùng, đơn huỷ bị bỏ qua, SKU lạ báo ở bước xem trước và không làm hỏng các đơn khác (Task 12).
4. **Thu tiền vượt tổng đơn hoặc hoàn tiền nhiều hơn đã thu:** thu vượt vẫn ghi nhận (PAID, có cảnh báo thừa tiền); hoàn vượt số đã thu → 422 (Task 10).
5. **Nhân viên mở thẳng URL báo cáo hoặc xem chi tiết sản phẩm/đơn:** không thấy giá vốn hay lãi trong JSON trả về, báo cáo trả 403, giao diện ẩn menu tương ứng (Task 3, 6, 13, 15).

---

## Cấu trúc file

```
migrations/0003_admin.sql                 lược đồ mới + dựng lại products/orders
wrangler.jsonc                            R2, cron, env.staging, run_worker_first /quan-tri/*, /files/*
vitest.config.mts, test/setup.ts          chạy test trên D1 cục bộ (áp migration)
test/helpers.ts                           seed sản phẩm, tạo user, gọi API có cookie
worker/index.ts                           giữ API công khai + webhook; gọi admin router, /quan-tri, /files, scheduled
worker/lib/http.ts                        ApiError, ok(), fail(), parseBody(), jsonResponse (chuyển từ index.ts)
worker/lib/crypto.ts                      hmacSign, timingSafeCompare, toHex (chuyển từ index.ts)
worker/lib/codes.ts                       generateOrderCode (chuyển), docCode(prefix)
worker/lib/notify.ts                      sendTelegramAlert, syncToGoogleSheetsRealtime (chuyển), mirrorEvent()
worker/admin/router.ts                    định tuyến /api/admin/*, Origin check, phiên, quyền
worker/admin/auth.ts                      mật khẩu, phiên, giới hạn đăng nhập, API auth/*
worker/admin/redact.ts                    bỏ trường giá vốn theo vai trò
worker/admin/inventory.ts                 MODULE KHO DUY NHẤT
worker/admin/stock-docs.ts                phiếu kho
worker/admin/products.ts, uploads.ts      sản phẩm, combo, ảnh R2, tồn/sổ kho/cảnh báo
worker/admin/customers.ts, suppliers.ts   khách, nhà cung cấp
worker/admin/orders.ts                    tạo đơn (mọi nguồn), chuyển trạng thái, giao hàng, danh sách
worker/admin/payments.ts                  thu/hoàn, SePay
worker/admin/quotes.ts, debts.ts          báo giá, công nợ
worker/admin/imports.ts                   nhập đơn sàn
worker/admin/reports.ts                   báo cáo
worker/admin/system.ts                    settings, users, audit-logs, backup
worker/admin/audit.ts                     auditStmt()
worker/admin/scheduled.ts                 cron: sao lưu + cảnh báo
src/shared/schemas.ts                     zod dùng chung trình duyệt + Worker
src/shared/marketplace.ts                 ánh xạ cột file Shopee/TikTok (thuần hàm)
src/pages/quan-tri/index.astro            vỏ trang, client:only React
src/admin/main.tsx, App.tsx, routes.tsx   khởi tạo, router basename /quan-tri
src/admin/lib/api.ts, format.ts           client API, định dạng tiền/ngày
src/admin/components/*                    Layout, DataTable, FormDialog, ConfirmDialog, MoneyInput, ProductPicker, StatusBadge, PrintFrame, Toast
src/admin/pages/*                         các màn hình
scripts/create-admin.mjs                  sinh SQL tạo tài khoản ADMIN đầu tiên
scripts/reconcile-products.mjs            đối chiếu 9 sản phẩm với web cũ → SQL cập nhật
docs/van-hanh.md                          triển khai, tạo admin, sao lưu/khôi phục
```

---

## Phần A – Nền tảng

### Task 1: Môi trường test, cấu hình Worker và migration 0003

**Files:**
- Create: `migrations/0003_admin.sql`, `vitest.config.mts`, `test/setup.ts`, `test/helpers.ts`, `test/schema.test.ts`
- Modify: `wrangler.jsonc`, `package.json`, `.gitignore`

**Interfaces:**
- Produces: các bảng và cột theo spec mục 6, trong đó `payments.kind`. `test/helpers.ts` xuất:
  - `seedProducts(db): Promise<void>`: dùng 9 sản phẩm có sẵn từ 0001, đặt `stock_qty = 100`, `reserved_qty = 0`, `cost_avg_vnd = 50000`.
  - `createUser(db, role: 'ADMIN'|'STAFF'): Promise<{id, email, password}>`
  - `api(path, init?, user?)`: gọi `SELF.fetch` tới `https://test.local/api/admin…`, tự gắn `Origin` và cookie phiên của `user`.

- [ ] **Step 1:** Cài devDependencies `vitest`, `@cloudflare/vitest-pool-workers`, `zod` (dependency). Thêm script `"test": "vitest run"`. Chạy thử `npx wrangler --version` và `npx workerd --version`. Nếu Windows Application Control chặn file native (như đã gặp với rollup), **dừng lại và báo anh**: không lách chính sách bảo mật.
- [ ] **Step 2:** Viết `test/schema.test.ts` (dự kiến FAIL):
  - `products CHECK chặn tồn âm`: `UPDATE products SET stock_qty = -1 WHERE sku='VK-DEGREASER-500ML'` ném lỗi chứa `CHECK constraint failed`.
  - `products CHECK chặn giữ vượt tồn`: `stock_qty=5, reserved_qty=6` ném lỗi.
  - `migration giữ dữ liệu 0001`: `SELECT COUNT(*) FROM products` = 9, combo `VK-COMBO-BOSSMAN-VKINNO-500ML` vẫn còn 2 dòng `bom_items`.
  - `orders nhận kênh FACEBOOK, nguồn MANUAL, thanh toán CASH`.
  - `payments.kind chỉ nhận RECEIPT|REFUND`.
- [ ] **Step 3:** Chạy `npm test`. Kỳ vọng FAIL: thiếu cột/bảng.
- [ ] **Step 4:** Viết `migrations/0003_admin.sql` theo spec mục 6. Đầu file ghi kế hoạch hoàn tác. `products` và `orders` dựng lại theo mẫu `0002`, giữ nguyên index cũ. Tạo đủ bảng mới và các index trong spec. `setup.ts` dùng `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`.
- [ ] **Step 5:** Cập nhật `wrangler.jsonc`:
  - `r2_buckets: [{binding:"FILES", bucket_name:"vkinno-files"}]`
  - `triggers.crons: ["0 19 * * *"]`
  - `assets.run_worker_first: ["/api/*","/quan-tri/*","/files/*"]`
  - `env.staging`: D1 `vkinno-db-staging`, R2 `vkinno-files-staging`
  - Thêm `FILES: R2Bucket` vào `Env`.
- [ ] **Step 6:** Chạy `npm test`. Kỳ vọng PASS 5 test. Chạy `npx wrangler d1 migrations apply vkinno-db --local`: áp đủ 0001→0003 không lỗi.
- [ ] **Step 7:** Commit `feat(db): migration 0003 quản trị + môi trường test`.

### Task 2: Tách tiện ích dùng chung và khung HTTP

**Files:**
- Create: `worker/lib/http.ts`, `worker/lib/crypto.ts`, `worker/lib/codes.ts`, `worker/lib/notify.ts`, `src/shared/schemas.ts`, `test/http.test.ts`
- Modify: `worker/index.ts` (xoá các hàm đã chuyển, import lại)

**Interfaces:**
- Produces:
  - `class ApiError extends Error { constructor(status: number, code: string, message: string, details?: unknown) }`
  - `ok(data: unknown, status = 200, headers?): Response`
  - `fail(e: unknown): Response`: ApiError → đúng mã; lỗi chứa `CHECK constraint failed` → 409 `STOCK_CONFLICT`; còn lại 500 `INTERNAL` và ghi `console.error`.
  - `parseBody<T>(req: Request, schema: z.ZodType<T>, maxBytes = 524288): Promise<T>` (422 `VALIDATION`, `details` = `error.flatten().fieldErrors`).
  - `parseQuery<T>(url: URL, schema): T`
  - `docCode(prefix: 'PN'|'PX'|'DC'|'KK'|'BG', now = new Date()): string`
  - `mirrorEvent(env, ctx, event: string, payload: object): void`: gọi `syncToGoogleSheetsRealtime` qua `ctx.waitUntil`, nuốt lỗi.

- [ ] **Step 1:** Viết `test/http.test.ts`:
  - `parseBody trả 422 kèm fieldErrors`
  - `fail ánh xạ CHECK constraint → 409 STOCK_CONFLICT`
  - `docCode('PN', new Date('2026-01-05T03:00:00Z'))` khớp `/^PN260105-[A-Z0-9]{4}$/`
  - API công khai `GET /api/products.json` vẫn trả `ok:true` và đủ 9 sản phẩm (hồi quy sau khi tách).
- [ ] **Step 2:** Chạy `npm test -- http`. Kỳ vọng FAIL.
- [ ] **Step 3:** Tạo các module, chuyển hàm từ `worker/index.ts` sang mà không đổi hành vi. Riêng `docCode` dùng ngày theo giờ Việt Nam (+7).
- [ ] **Step 4:** Chạy `npm test`. Kỳ vọng PASS toàn bộ.
- [ ] **Step 5:** Commit `refactor(worker): tách tiện ích http/crypto/codes/notify`.

### Task 3: Đăng nhập, phiên, phân quyền và khung router quản trị

**Files:**
- Create: `worker/admin/auth.ts`, `worker/admin/router.ts`, `worker/admin/redact.ts`, `worker/admin/audit.ts`, `scripts/create-admin.mjs`, `test/auth.test.ts`
- Modify: `worker/index.ts` (chuyển `/api/admin/*` sang router; xoá `verifyAdminRequest`, `createAdminToken`, `ADMIN_COOKIE_NAME` cũ)

**Interfaces:**
- Produces:
  - `type Role = 'ADMIN'|'STAFF'`, `interface SessionUser { id: number; email: string; name: string; role: Role }`
  - `interface AdminCtx { env: Env; ctx: ExecutionContext; req: Request; url: URL; user: SessionUser; params: Record<string,string> }`
  - `hashPassword(pw: string): Promise<string>`, `verifyPassword(pw: string, stored: string): Promise<boolean>`
  - `signSession(userId: number, secret: string, nowMs = Date.now()): Promise<string>` (token `"<userId>.<expMs>.<hexSig>"`), `readSession(req, env): Promise<SessionUser|null>` (đọc user từ DB, `is_active=1`)
  - `requireRole(user: SessionUser, role: Role): void` (ném 403 `FORBIDDEN`)
  - `redact<T>(data: T, role: Role): T`: bỏ đệ quy các khoá trong Global Constraints khi role là STAFF.
  - `auditStmt(db, userId, action: string, entity: string, entityId: string|number, detail?: object): D1PreparedStatement`
  - `route(method, pattern: string, handler: (c: AdminCtx) => Promise<Response>, opts?: { role?: Role; public?: boolean })`. Pattern dạng `"/orders/:id/transition"`. `handleAdmin(req, env, ctx): Promise<Response>` lần lượt: kiểm Origin → khớp route → đọc phiên (401) → kiểm quyền → gọi handler → tự `redact` phần `data` của phản hồi JSON theo vai trò.
  - API: `POST auth/login {email,password}` (đặt cookie), `POST auth/logout`, `GET auth/me`, `POST auth/change-password {current,next}` (next ≥ 8 ký tự).
  - `scripts/create-admin.mjs <email> <name> <password>` in ra câu `INSERT INTO users …` với mật khẩu đã băm (dùng chung thuật toán).

- [ ] **Step 1:** Viết `test/auth.test.ts`:
  - `login đúng → 200, Set-Cookie vk_admin có HttpOnly; Secure; SameSite=Strict`
  - `login sai → 401 INVALID_CREDENTIALS, không tiết lộ email có tồn tại hay không`
  - `sai 6 lần trong 15 phút → lần 6 trả 429`
  - `cookie hết hạn hoặc bị sửa chữ ký → 401`
  - `POST không có Origin hoặc Origin lạ → 403`
  - `STAFF gọi route role ADMIN → 403`
  - `redact xoá cost_avg_vnd lồng trong mảng cho STAFF, giữ cho ADMIN`
  - `user is_active=0 → 401 dù cookie hợp lệ`
- [ ] **Step 2:** Chạy `npm test -- auth`. Kỳ vọng FAIL.
- [ ] **Step 3:** Cài đặt theo Interfaces. Lưu số lần thử đăng nhập trong bảng `login_attempts`. Cửa sổ 15 phút: quá hạn thì đặt lại đếm. Ghi `auditStmt('login')` khi đăng nhập thành công.
- [ ] **Step 4:** Chạy `npm test`. Kỳ vọng PASS.
- [ ] **Step 5:** Commit `feat(admin): đăng nhập, phiên, phân quyền, router`.

### Task 4: Module kho

**Files:**
- Create: `worker/admin/inventory.ts`, `test/inventory.test.ts`

**Interfaces:**
- Consumes: bảng `products`, `bom_items`, `inventory_logs`, `order_items`.
- Produces (mọi hàm `*Stmts` chỉ trả câu lệnh, không tự chạy):
  - `type Line = { sku: string; qty: number }`
  - `interface DocRef { docType: 'ORDER'|'RECEIPT'|'ISSUE'|'ADJUST'|'STOCKTAKE'|'RETURN'; docCode: string; userId: number|null }`
  - `expandToPhysical(db, lines: Line[]): Promise<Line[]>`: tách combo theo `bom_items`, gộp SKU trùng. SKU không tồn tại hoặc ngừng bán → ApiError 422 `UNKNOWN_SKU`.
  - `reserveStmts(db, lines: Line[]): D1PreparedStatement[]` / `releaseStmts(db, lines)`
  - `saleOutStmts(db, orderId: number, ref: DocRef): Promise<D1PreparedStatement[]>`: đọc `order_items` của đơn; mỗi thành phần vật lý: `stock -= q, reserved -= q`, ghi sổ `SALE_OUT` kèm `unit_cost_vnd = cost_avg_vnd` hiện tại; cập nhật `order_items.unit_cost_vnd` (combo = Σ cost thành phần × qty_per_combo); `orders.stock_deducted = 1`.
  - `directSaleOutStmts(db, orderId, ref)`: như trên nhưng không trừ `reserved` (đơn sàn nhập ở trạng thái đã giao).
  - `restockStmts(db, lines, reason: 'CANCEL_RESTOCK'|'RETURN_RESTOCK', ref)`; `damagedLogStmts(db, lines, ref)` (sổ `RETURN_DAMAGED`, delta 0).
  - `receiveStmts(db, lines: {sku, qty, unitCost}[], ref)`: SQL tính bình quân `cost_avg_vnd = CAST(ROUND((stock_qty*cost_avg_vnd + ?*?)*1.0/(stock_qty + ?)) AS INTEGER)`, rồi `stock_qty += qty`; ghi sổ `RECEIPT`.
  - `issueStmts(db, lines, ref)`; `adjustStmts(db, lines: {sku, delta}[], reason: 'ADJUST'|'STOCKTAKE', ref)`
  - `availability(db, skus?: string[]): Promise<Map<string, { stock: number; reserved: number; available: number; isCombo: boolean }>>`: combo tính theo spec mục 5.
  - `stockConflictMessage(db, lines: Line[]): Promise<string>`: sau khi batch lỗi 409, dựng câu "Sản phẩm X chỉ còn N có thể bán" cho dòng đầu tiên thiếu hàng.
- Mỗi lệnh UPDATE số lượng đi kèm một câu INSERT vào `inventory_logs`, với `stock_after` lấy bằng subquery sau UPDATE.

- [ ] **Step 1:** Viết `test/inventory.test.ts` (sau `seedProducts`):
  - `giữ 3 → reserved 3, available 97, không ghi sổ`
  - `giữ quá có thể bán → batch ném CHECK, dữ liệu không đổi`
  - `combo giữ 2 → mỗi thành phần reserved += 2 × qty_per_combo`
  - `saleOut → stock 97, reserved 0, sổ SALE_OUT có unit_cost_vnd 50000, order_items.unit_cost_vnd đặt đúng (combo = tổng thành phần)`
  - `hai batch saleOut tranh món cuối (stock 1, reserved 1, hai đơn) → đúng 1 thành công`
  - `nhập 2 lần: 100@50000 rồi 100@70000 → cost_avg 60000`
  - `nhập khi tồn 0 → cost_avg = đơn giá`
  - `issue làm stock < reserved → CHECK ném`
  - `restock RETURN_RESTOCK cộng tồn; damaged chỉ ghi sổ delta 0`
  - `expandToPhysical với SKU lạ → 422 UNKNOWN_SKU`
  - `availability combo = min ⌊available/qty_per_combo⌋`
- [ ] **Step 2:** Chạy `npm test -- inventory`. Kỳ vọng FAIL.
- [ ] **Step 3:** Cài đặt theo Interfaces.
- [ ] **Step 4:** Chạy `npm test`. Kỳ vọng PASS.
- [ ] **Step 5:** Commit `feat(inventory): module kho giữ/trừ/hoàn/nhập/điều chỉnh`.

## Phần B – Nghiệp vụ (API)

### Task 5: Phiếu kho

**Files:** Create `worker/admin/stock-docs.ts`, `test/stock-docs.test.ts`. Modify `src/shared/schemas.ts`, `worker/admin/router.ts`.

**Interfaces:**
- Produces:
  - `stockDocInput` (zod): `{ type: 'RECEIPT'|'ISSUE'|'ADJUST'|'STOCKTAKE', supplier_id?, note?, lines: { sku, qty?, unit_cost_vnd?, batch_code?, expiry_date?, counted_qty? }[] }`. RECEIPT bắt buộc `qty > 0` và `unit_cost_vnd >= 0`; ISSUE cần `qty > 0`; ADJUST cần `qty ≠ 0` (delta); STOCKTAKE cần `counted_qty >= 0`.
  - API: `GET stock-docs?type&status&from&to`, `POST stock-docs` (tạo DRAFT, mã theo loại), `GET/PUT stock-docs/:id` (chỉ khi DRAFT), `POST stock-docs/:id/post`, `POST stock-docs/:id/cancel`.
  - Khi ghi sổ phiếu STOCKTAKE: lưu `system_qty` = tồn lúc ghi sổ, delta = `counted_qty − system_qty`.

- [ ] **Step 1:** Viết test:
  - `RECEIPT ghi sổ → tồn và giá vốn bình quân đúng, status POSTED, posted_by đặt`
  - `PUT hoặc post lần 2 với phiếu POSTED → 409 INVALID_STATE`
  - `STOCKTAKE đếm 2 khi reserved 3 → 409 STOCK_CONFLICT, phiếu vẫn DRAFT`
  - `STOCKTAKE đếm 120 khi tồn 100 → sổ STOCKTAKE delta +20, reserved giữ nguyên`
  - `cancel DRAFT → CANCELLED; cancel POSTED → 409`
  - `STAFF được tạo và ghi sổ phiếu, phản hồi không có unit_cost_vnd`
- [ ] **Step 2:** Chạy `npm test -- stock-docs`. Kỳ vọng FAIL.
- [ ] **Step 3:** Cài đặt. Ghi sổ = một batch gồm câu lệnh từ `inventory.ts`, `UPDATE stock_docs` và `auditStmt`. Sau đó gọi `mirrorEvent('stock_doc.posted')`.
- [ ] **Step 4:** Chạy `npm test`. Kỳ vọng PASS.
- [ ] **Step 5:** Commit `feat(admin): phiếu nhập/xuất/điều chỉnh/kiểm kê`.

### Task 6: Sản phẩm, combo, ảnh R2, tồn kho và cảnh báo

**Files:** Create `worker/admin/products.ts`, `worker/admin/uploads.ts`, `test/products.test.ts`. Modify `worker/index.ts` (route `GET /files/*` đọc R2, có `Cache-Control: public, max-age=31536000, immutable`).

**Interfaces:**
- Produces:
  - `productInput` (zod): `sku` (/^[A-Z0-9-]{3,60}$/, không sửa sau khi tạo), `name`, `slug`, `price_vnd`, `listed_price_vnd`, `wholesale_price_vnd?`, `unit`, `category`, `min_stock`, `shelf_label`, `is_active`, `is_combo`, `image_url`, `gallery_json`, `description`, `batch_code`, `expiry_date`.
  - Mọi API sản phẩm **không** sửa được `stock_qty`, `reserved_qty`, `cost_avg_vnd` (bị bỏ qua nếu có gửi).
  - API: `GET/POST products`, `GET/PUT products/:sku`, `PUT products/:sku/bom {items:[{component_sku, qty_per_combo}]}` (từ chối combo lồng combo, từ chối tự tham chiếu), `POST uploads/image` (multipart `file`, trả `{key, url:"/files/<key>"}`), `GET inventory?q&category&low=1`, `GET inventory/:sku/ledger?from&to`, `GET inventory/alerts` → `{ low_stock:[…], expiring:[…] }`.
  - Danh sách lô sắp hết hạn: duyệt các dòng phiếu RECEIPT đã ghi sổ, mới nhất trước, cộng dồn đến khi đủ `stock_qty` (phần còn lại theo FIFO). Lô nào hết hạn trong vòng 60 ngày thì đưa vào danh sách.

- [ ] **Step 1:** Viết test:
  - `PUT không đổi được stock_qty`
  - `combo lồng combo → 422`
  - `upload file 6 MB → 413`; `upload text/plain → 415`; `upload png → GET /files/<key> trả đúng bytes`
  - `alerts.low_stock gồm SKU có available < min_stock`
  - `alerts.expiring theo FIFO: nhập lô A (hết hạn sớm) rồi lô B, xuất hết lượng lô A → chỉ còn lô B`
  - `STAFF GET products/:sku không có cost_avg_vnd`
- [ ] **Step 2:** Chạy, kỳ vọng FAIL. **Step 3:** Cài đặt. **Step 4:** Chạy `npm test`, kỳ vọng PASS.
- [ ] **Step 5:** Commit `feat(admin): sản phẩm, combo, ảnh R2, tồn và cảnh báo`.

### Task 7: Khách hàng và nhà cung cấp

**Files:** Create `worker/admin/customers.ts`, `worker/admin/suppliers.ts`, `test/customers.test.ts`.

**Interfaces:**
- Produces:
  - `upsertCustomerByPhoneStmts(db, { phone, name, email?, address? }): Promise<{ stmts: D1PreparedStatement[]; customerIdSql: string; bind: unknown[] }>`: chuẩn hoá số bằng `normalizeVnPhone` hiện có; khách đã có thì không ghi đè tên khác rỗng. `customerIdSql` là subquery `(SELECT id FROM customers WHERE phone = ?)` để dùng trong cùng batch.
  - API: `GET/POST customers` (lọc theo `type`, `q`), `GET/PUT customers/:id`, `GET customers/:id/orders`, `GET/POST suppliers`, `GET/PUT suppliers/:id`, `GET suppliers/:id/stock-docs`.
  - Tổng chi tiêu = Σ `total_amount` của đơn không ở trạng thái CANCELLED/RETURNED.

- [ ] **Step 1:** Viết test:
  - `upsert theo SĐT "0912 345 678" và "+84912345678" ra cùng một khách`
  - `tạo trùng SĐT → 409 DUPLICATE_PHONE`
  - `khách B2B bắt buộc payment_terms_days >= 0, credit_limit_vnd >= 0`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): khách hàng, nhà cung cấp`.

### Task 8: Đơn hàng (tạo đơn mọi nguồn, chuyển trạng thái, giao hàng)

**Files:** Create `worker/admin/orders.ts`, `test/orders.test.ts`.

**Interfaces:**
- Consumes: `inventory.ts`, `upsertCustomerByPhoneStmts`, `generateOrderCode`, `auditStmt`, `mirrorEvent`.
- Produces:
  - `createOrderInput` (zod): `{ channel, customer:{phone,name,email?,address?}, shipping_address, notes?, items:[{sku, quantity, unit_price?}], shipping_fee_vnd, discount_vnd?, payment_method, external_order_id?, due_date? }`. Không gửi `unit_price` → lấy `price_vnd`; khách `price_tier = WHOLESALE` → lấy `wholesale_price_vnd ?? price_vnd`.
  - `createOrder(env, input, opts: { source: 'WEB'|'MANUAL'|'IMPORT'|'QUOTE'; userId: number|null; status?: 'PENDING'|'SHIPPING'|'COMPLETED'; quoteId?: number }): Promise<{ id: number; order_code: string }>`. Một batch gồm: upsert khách, INSERT đơn, INSERT các dòng (dùng subquery `order_code`), rồi `reserveStmts` (PENDING) hoặc `directSaleOutStmts` (SHIPPING/COMPLETED). Batch lỗi CHECK → ApiError 409 kèm `stockConflictMessage`.
  - `transitionOrder(env, orderId, to, opts: { userId: number|null; returnLines?: { order_item_id: number; action: 'RESTOCK'|'DAMAGED' }[] }): Promise<void>` theo đúng bảng spec mục 5. PACKED với đơn B2B mà `due_date` trống → đặt `date('now','+7 hours', '+N days')` với N = `payment_terms_days` của khách.
  - API: `GET orders?channel&status&payment_status&from&to&q&customer_id`, `POST orders` (source MANUAL), `GET orders/:id` (kèm dòng hàng, thanh toán, lịch sử sổ kho của đơn), `PUT orders/:id` (chỉ khi PENDING: sửa dòng hàng thì release cũ + reserve mới trong một batch), `POST orders/:id/transition {to, lines?}`, `PUT orders/:id/shipping {shipping_carrier, shipping_tracking_code, shipping_fee_vnd}`.

- [ ] **Step 1:** Viết test (mỗi dòng bảng spec mục 5 một test):
  - `tạo PENDING giữ hàng`
  - `PENDING→PACKED trừ kho + unit_cost`
  - `PACKED→SHIPPING→COMPLETED không đổi kho`
  - `PENDING→CANCELLED bỏ giữ`
  - `PACKED→CANCELLED nhập lại kho (CANCEL_RESTOCK)`
  - `COMPLETED→RETURNED với 1 dòng RESTOCK + 1 dòng DAMAGED`
  - `chuyển sai (PENDING→COMPLETED) → 409 INVALID_TRANSITION`
  - `PUT dòng hàng khi PACKED → 409`
  - `PUT dòng hàng khi PENDING tăng số lượng vượt có thể bán → 409, đơn giữ nguyên`
  - `hai đơn tạo song song cho món cuối → 1 thành công, 1 nhận 409 có tên sản phẩm`
  - `khách WHOLESALE lấy giá sỉ`
  - `B2B PACKED đặt due_date = hôm nay + payment_terms_days`
  - `tạo SHIPPING trực tiếp (nguồn IMPORT) trừ tồn ngay, reserved không đổi`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): đơn hàng đa kênh và quy tắc trạng thái`.

### Task 9: Sửa luồng đặt đơn công khai trên website

**Files:** Modify `worker/index.ts` (khối `POST /api/orders` và `loadCatalogWithBom`). Test `test/public-orders.test.ts`.

**Interfaces:**
- Consumes: `createOrder(…, { source: 'WEB', userId: null })`, `availability()`.
- Produces:
  - `POST /api/orders` giữ nguyên định dạng body và phản hồi hiện có (VietQR, tóm tắt hàng, `freeship_threshold_vnd`, `FLAT_SHIPPING_FEE_VND`, giới hạn tốc độ), nhưng ghi đơn bằng `createOrder` nên giữ hàng ngay.
  - `GET /api/products(.json)`: trường `available_stock` = có thể bán.

- [ ] **Step 1:** Viết test:
  - `đặt đơn web → orders.source='WEB', reserved tăng, phản hồi vẫn có vietqr_url và order_code`
  - `đặt vượt có thể bán → 409 kèm thông báo tiếng Việt như cũ`
  - `đơn ≥ 199000 miễn ship, dưới đó phí 25000` (hồi quy)
  - `products.json available_stock giảm sau khi đặt`
- [ ] **Step 2–4:** Chạy (FAIL) → sửa → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `fix(orders): đặt đơn web giữ hàng trong một giao dịch`.

### Task 10: Thanh toán và SePay

**Files:** Create `worker/admin/payments.ts`, `test/payments.test.ts`. Modify khối `POST /api/webhook/sepay` trong `worker/index.ts`, và `transitionOrder` trong `worker/admin/orders.ts` (tự thu tiền đơn sàn khi COMPLETED).

**Interfaces:**
- Produces:
  - `paymentInput`: `{ kind: 'RECEIPT'|'REFUND', amount_vnd > 0, method: 'CASH'|'BANK_TRANSFER'|'COD'|'VIETQR'|'MARKETPLACE', reference?, note?, received_at? }`
  - `addPaymentStmts(db, orderId, input, opts: { userId: number|null; sepayTxId?: number }): D1PreparedStatement[]`: INSERT `payments`, rồi cập nhật `orders.paid_amount = Σ RECEIPT − Σ REFUND`, `payment_status` (0 → UNPAID, nhỏ hơn tổng → PARTIAL, từ tổng trở lên → PAID), `paid_at` khi chuyển sang PAID.
  - REFUND vượt `paid_amount` hiện tại → 422 `REFUND_EXCEEDS_PAID` (kiểm tra trước khi chạy batch).
  - API: `GET/POST orders/:id/payments`, `GET sepay/unmatched`, `POST sepay/:txId/assign {order_id}` (tạo payment `VIETQR` với `sepay_tx_id`, đổi `match_status` sang PAID/PARTIAL).
  - Webhook SePay khi khớp đơn: dùng `addPaymentStmts` (bỏ UPDATE trực tiếp `orders.paid_amount`). Giữ nguyên 6 lớp kiểm tra bảo mật và cảnh báo Telegram.
  - Đơn sàn chuyển sang COMPLETED → tự thêm RECEIPT `MARKETPLACE` bằng phần còn thiếu (đặt trong `transitionOrder`).

- [ ] **Step 1:** Viết test:
  - `thu 2 lần tới đủ → PARTIAL rồi PAID`
  - `thu vượt tổng → PAID, paid_amount > total`
  - `hoàn vượt đã thu → 422`
  - `webhook SePay khớp mã đơn → có payment kind RECEIPT method VIETQR, gửi lại cùng tx → không nhân đôi`
  - `assign giao dịch chưa khớp → đơn PAID, log match_status PAID`
  - `đơn MARKETPLACE COMPLETED → PAID`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): thanh toán, hoàn tiền, SePay`.

### Task 11: Báo giá và công nợ B2B

**Files:** Create `worker/admin/quotes.ts`, `worker/admin/debts.ts`, `test/quotes-debts.test.ts`.

**Interfaces:**
- Produces:
  - `quoteInput`: `{ customer_id, valid_until, discount_vnd, shipping_fee_vnd, note?, items:[{sku, quantity, unit_price}] }`
  - API: `GET/POST quotes`, `GET/PUT quotes/:id` (chỉ khi DRAFT/SENT), `POST quotes/:id/status {to: SENT|ACCEPTED|REJECTED}`, `POST quotes/:id/convert` → `createOrder({channel:'B2B', …}, {source:'QUOTE', quoteId})`, quote sang CONVERTED. Báo giá quá `valid_until` khi đọc → trả status `EXPIRED` (tính lúc đọc, không cần cron).
  - `GET debts` → mỗi khách B2B: `{ customer_id, name, outstanding_vnd, overdue_vnd, oldest_due_date, credit_limit_vnd, over_limit: boolean }`. `GET debts/:customerId` → danh sách đơn còn nợ kèm `days_overdue`. Nợ chỉ tính đơn đã PACKED trở đi, không gồm CANCELLED/RETURNED.

- [ ] **Step 1:** Viết test:
  - `convert báo giá → đơn B2B PENDING giữ hàng, giá theo báo giá, quote CONVERTED`
  - `convert lần 2 → 409`
  - `công nợ: 2 đơn B2B 1.000.000 và 500.000, thu 300.000 → outstanding 1.200.000`
  - `đơn quá hạn 5 ngày → overdue_vnd đúng, days_overdue 5`
  - `vượt hạn mức → over_limit true`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): báo giá và công nợ B2B`.

### Task 12: Nhập đơn Shopee/TikTok từ file

**Files:** Create `src/shared/marketplace.ts`, `worker/admin/imports.ts`, `test/marketplace.test.ts`, `test/fixtures/shopee-sample.csv`, `test/fixtures/tiktok-sample.csv`.

**Interfaces:**
- Produces:
  - `type Channel = 'SHOPEE'|'TIKTOK'`
  - `interface ColumnMap { order_id: string; created_at: string; status: string; sku: string; product_name: string; quantity: string; unit_price: string; shipping_fee: string; buyer_name: string; buyer_phone: string; address: string }`
  - `DEFAULT_COLUMN_MAPS: Record<Channel, ColumnMap>`: tên cột theo file xuất tiếng Việt của từng sàn. **Giá trị cuối cùng lấy từ file thật anh cung cấp**; trước khi có file thì dùng file mẫu trong `test/fixtures`.
  - `STATUS_MAP: Record<Channel, Record<string, 'SKIP'|'PENDING'|'SHIPPING'|'COMPLETED'>>`
  - `parseMarketplaceRows(channel, rows: Record<string,string>[], map: ColumnMap): { orders: ImportOrder[]; errors: { row: number; message: string }[] }`: gộp nhiều dòng cùng mã đơn thành một đơn.
  - API:
    - `POST orders/import/preview {channel, orders}` → `{ new: n, duplicates: [...], unmapped_skus: [...] }`
    - `POST orders/import {channel, file_name, orders}` → từng đơn gọi `createOrder({…channel, external_order_id, payment_method:'MARKETPLACE'}, {source:'IMPORT', status})` trong `try` riêng; trả `{ created, skipped_duplicates, errors }` và ghi `import_batches`.
    - `GET/PUT channel-sku-map`
  - Ánh xạ cột được lưu trong `app_settings` với khoá `import.columns.SHOPEE` và `import.columns.TIKTOK` (sửa được ở Cài đặt).

- [ ] **Step 1:** Viết test:
  - `parse gộp 2 dòng cùng mã đơn thành 1 đơn 2 sản phẩm`
  - `trạng thái "Đã hủy" → SKIP`
  - `thiếu cột bắt buộc → errors có số dòng`
  - `import 2 lần cùng dữ liệu → lần 2 created 0, skipped_duplicates = n`
  - `SKU chưa ánh xạ → preview báo, import đơn đó vào errors, đơn khác vẫn tạo`
  - `đơn trạng thái giao xong → COMPLETED, tồn trừ ngay, payment MARKETPLACE`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): nhập đơn Shopee/TikTok từ file`.

### Task 13: Báo cáo

**Files:** Create `worker/admin/reports.ts`, `test/reports.test.ts`.

**Interfaces:**
- Produces (định nghĩa số liệu theo Global Constraints):
  - `GET reports/sales?from&to&group=day|week|month|channel|product` → `[{ key, orders, revenue_vnd, cost_total_vnd, gross_profit_vnd, gross_margin }]` (role ADMIN). Doanh thu theo ngày lấy từ thời điểm `SALE_OUT` trong sổ kho, gộp theo đơn; trả hàng trừ vào ngày trả.
  - `GET reports/top-products?from&to&limit=10` (ADMIN)
  - `GET reports/stock-movement?from&to` → mỗi SKU: tồn đầu, nhập, xuất bán, xuất khác, điều chỉnh, tồn cuối (STAFF được xem, không có giá trị tiền).
  - `GET reports/dashboard` → `{ today_revenue_vnd?, month_revenue_vnd?, orders_by_status, pending_orders, alerts_count, sepay_unmatched }`. Trường doanh thu bị `redact` với STAFF.

- [ ] **Step 1:** Viết test với dữ liệu seed cố định: 3 đơn (một bị trả hàng), giá vốn 50.000:
  - `revenue/cost/profit theo ngày đúng tới từng đồng`
  - `group=channel tách WEB và B2B`
  - `stock-movement: tồn đầu + nhập − xuất ± điều chỉnh = tồn cuối với mọi SKU`
  - `STAFF gọi sales → 403`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): báo cáo doanh thu, lãi gộp, nhập-xuất-tồn`.

### Task 14: Hệ thống (cài đặt, tài khoản, nhật ký, sao lưu, cảnh báo, bản sao Sheets)

**Files:** Create `worker/admin/system.ts`, `worker/admin/scheduled.ts`, `test/system.test.ts`. Modify `worker/index.ts` (thêm `scheduled(event, env, ctx)` gọi `runDaily(env)`).

**Interfaces:**
- Produces:
  - API (ADMIN): `GET/PUT settings` (khoá `company.*`, `print.*`, `telegram.enabled`, `import.columns.*`), `GET/POST users`, `PUT users/:id {name, role, is_active}`, `POST users/:id/reset-password`, `GET audit-logs?user_id&entity&from&to`, `POST backup/run`.
  - Không được tự hạ quyền hoặc khoá tài khoản ADMIN cuối cùng → 409.
  - `runBackup(env): Promise<{ key: string; bytes: number }>`: `SELECT *` mọi bảng → JSON → gzip (`CompressionStream`) → `R2 backups/YYYY-MM-DD.json.gz`. Xoá các khoá `backups/` cũ hơn 90 ngày.
  - `runDaily(env)`: `runBackup` + gửi Telegram danh sách `inventory/alerts` (nếu `telegram.enabled`).
  - `mirrorEvent` được gọi ở: tạo đơn, chuyển trạng thái, thêm thanh toán, ghi sổ phiếu kho.

- [ ] **Step 1:** Viết test:
  - `runBackup tạo object R2 giải nén ra JSON có đủ các bảng`
  - `bản sao lưu 91 ngày tuổi bị xoá, 89 ngày còn giữ`
  - `không khoá được ADMIN cuối cùng`
  - `STAFF GET settings → 403`
  - `mirrorEvent khi webhook lỗi không làm hỏng thao tác chính`
- [ ] **Step 2–4:** Chạy (FAIL) → cài đặt → chạy `npm test` (PASS).
- [ ] **Step 5:** Commit `feat(admin): cài đặt, tài khoản, nhật ký, sao lưu, cron`.

## Phần C – Giao diện quản trị

> Mỗi task giao diện kết thúc bằng kiểm tra tay trên trình duyệt. Chạy `npm run dev:all` (Worker cổng 8787) cùng `npm run dev` (Astro, proxy `/api` và `/files` sang 8787), mở `http://localhost:4321/quan-tri`. Kiểm tra trên khung màn hình 1280px và 390px (điện thoại).

### Task 15: Vỏ ứng dụng, đăng nhập, client API, bộ thành phần dùng chung

**Files:** Create `src/pages/quan-tri/index.astro`, `src/admin/main.tsx`, `App.tsx`, `routes.tsx`, `lib/api.ts`, `lib/format.ts`, `lib/auth.tsx`, `components/{Layout,DataTable,FormDialog,ConfirmDialog,MoneyInput,ProductPicker,StatusBadge,PrintFrame,Toast}.tsx`, `pages/Login.tsx`, `test/ui/api.test.ts`, `test/ui/DataTable.test.tsx`. Modify `astro.config.mjs` (proxy dev, loại `/quan-tri` khỏi sitemap như hiện tại), `package.json`.

**Interfaces:**
- Produces:
  - `apiFetch<T>(path: string, init?): Promise<T>`: tự thêm tiền tố `/api/admin`, gửi kèm cookie; ném `ApiClientError {status, code, message, details}`. Lỗi 401 → chuyển về `/quan-tri/dang-nhap`.
  - `useMe(): { user: SessionUser|null, isAdmin: boolean }`
  - `formatVnd(n)`, `formatDate(iso)` (giờ Việt Nam)
  - `<DataTable columns rows total page onPageChange search filters loading empty />`
  - `<ProductPicker onPick(sku, qty) priceTier />`: hiển thị số có thể bán, chặn chọn quá.
  - `<StatusBadge kind="order"|"payment"|"doc" value />`
  - `<PrintFrame>`: in qua `window.print()` với CSS `@media print`.
  - Menu theo spec mục 10. Ẩn Báo cáo và Cài đặt với STAFF. Có chế độ tối (lưu `localStorage`, bọc trong `try/catch`).
- Cài đặt thêm: `react-router`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `xlsx`, `@testing-library/react`, `jsdom` (dùng cấu hình vitest riêng `vitest.ui.config.mts` cho `test/ui`).

- [ ] **Step 1:** Viết test UI:
  - `apiFetch ném ApiClientError có code và details khi 422`
  - `401 gọi điều hướng tới /quan-tri/dang-nhap`
  - `DataTable hiển thị trạng thái rỗng và chuyển trang`
- [ ] **Step 2–4:** Chạy `npx vitest run -c vitest.ui.config.mts` (FAIL) → cài đặt → chạy lại (PASS).
- [ ] **Step 5:** Kiểm tra tay:
  - Đăng nhập sai báo lỗi tiếng Việt; đăng nhập đúng vào được Tổng quan (trống).
  - Tải lại trang `/quan-tri/don-hang` vẫn vào đúng trang.
  - Đăng xuất thì quay về trang đăng nhập.
  - Header phản hồi có `X-Robots-Tag: noindex, nofollow`.
- [ ] **Step 6:** Commit `feat(admin-ui): vỏ ứng dụng, đăng nhập, thành phần dùng chung`.

### Task 16: Màn hình Sản phẩm và Kho

**Files:** Create `src/admin/pages/{Products,ProductEdit,Inventory,Ledger,StockDocs,StockDocEdit,StockMovement}.tsx`.

**Interfaces:** Consumes API Task 5, 6, 13 (`stock-movement`).

- [ ] **Step 1:** Cài đặt các màn hình:
  - Sản phẩm: danh sách, thêm/sửa, upload ảnh, khai báo thành phần combo.
  - Tồn kho: cột thực tế, đang giữ, có thể bán; lọc sắp hết hàng.
  - Sổ kho theo sản phẩm.
  - Phiếu kho: tạo nháp → ghi sổ, nhập dòng bằng `ProductPicker`. Phiếu kiểm kê tự điền số hệ thống.
  - Nhập-xuất-tồn theo kỳ, xuất Excel.
- [ ] **Step 2:** Kiểm tra tay:
  - Tạo phiếu nhập 10 sản phẩm → ghi sổ → tồn tăng đúng, giá vốn bình quân hiển thị (ADMIN).
  - Đăng nhập bằng STAFF thì không thấy cột giá vốn.
  - Kiểm kê lệch thì sổ kho có dòng STOCKTAKE.
  - Upload ảnh thì xem trước ngay.
- [ ] **Step 3:** Commit `feat(admin-ui): sản phẩm và kho`.

### Task 17: Màn hình Đơn hàng, thanh toán, giao hàng, nhập file sàn

**Files:** Create `src/admin/pages/{Orders,OrderCreate,OrderDetail,OrderImport}.tsx`, `src/admin/print/{PackingSlip,DeliveryNote}.tsx`.

**Interfaces:** Consumes API Task 7, 8, 10, 12. Đọc file ở trình duyệt bằng `xlsx` (`XLSX.read(arrayBuffer)` → `sheet_to_json`) rồi gọi `parseMarketplaceRows`.

- [ ] **Step 1:** Cài đặt:
  - Danh sách có lọc kênh, trạng thái, thanh toán, ngày.
  - Tạo đơn: tìm khách theo SĐT (tự điền khách cũ), chọn sản phẩm, giá theo hạng giá của khách, phí ship, ghi chú.
  - Chi tiết đơn: dòng thời gian, các nút chuyển trạng thái hợp lệ, hộp thoại trả hàng chọn RESTOCK hoặc DAMAGED từng dòng, thông tin giao hàng, thu/hoàn tiền, in phiếu giao.
  - Nhập file sàn: chọn sàn → chọn file → xem trước (đơn mới, trùng, SKU chưa gán, cho gán ngay) → xác nhận → kết quả.
- [ ] **Step 2:** Kiểm tra tay:
  - Tạo đơn Zalo 2 sản phẩm → tồn "có thể bán" giảm, tồn thực tế không đổi.
  - Đóng gói thì tồn thực tế giảm. Giao, rồi hoàn thành.
  - Thu tiền 2 lần thì trạng thái PARTIAL rồi PAID.
  - Huỷ một đơn đang chờ thì "có thể bán" tăng lại.
  - Nhập `test/fixtures/shopee-sample.csv` hai lần, lần 2 báo trùng toàn bộ.
  - In phiếu giao ra đúng khổ A5 hoặc A4.
- [ ] **Step 3:** Commit `feat(admin-ui): đơn hàng, thanh toán, giao hàng, nhập sàn`.

### Task 18: Màn hình Khách hàng, Nhà cung cấp, Báo giá, Công nợ

**Files:** Create `src/admin/pages/{Customers,CustomerDetail,Suppliers,Quotes,QuoteEdit,Debts}.tsx`, `src/admin/print/QuotePrint.tsx`.

**Interfaces:** Consumes API Task 7, 11.

- [ ] **Step 1:** Cài đặt:
  - Khách hàng: danh sách lọc lẻ/sỉ; chi tiết có lịch sử đơn và tổng chi tiêu.
  - Nhà cung cấp kèm phiếu nhập.
  - Báo giá: soạn, in hoặc lưu PDF qua `window.print`, đổi trạng thái, chuyển thành đơn.
  - Công nợ: tổng theo khách, chi tiết theo đơn, tô đỏ quá hạn, nút thu tiền nhanh.
- [ ] **Step 2:** Kiểm tra tay:
  - Báo giá B2B chuyển thành đơn có giá đúng.
  - Đóng gói đơn B2B thì công nợ hiện số nợ và hạn thanh toán.
  - Thu một phần thì nợ giảm đúng.
- [ ] **Step 3:** Commit `feat(admin-ui): khách hàng, NCC, báo giá, công nợ`.

### Task 19: Tổng quan, Báo cáo, Cài đặt

**Files:** Create `src/admin/pages/{Dashboard,Reports,Settings,Users,AuditLogs}.tsx`.

**Interfaces:** Consumes API Task 13, 14.

- [ ] **Step 1:** Cài đặt:
  - Tổng quan: thẻ số liệu, đơn chờ xử lý, cảnh báo, SePay chưa khớp (có nút gán đơn).
  - Báo cáo: biểu đồ recharts doanh thu/lãi theo ngày, bảng theo kênh và sản phẩm, xuất Excel.
  - Cài đặt: thông tin công ty, mẫu in, bật/tắt Telegram, ánh xạ cột file sàn, tài khoản, nhật ký, nút "Sao lưu ngay".
- [ ] **Step 2:** Kiểm tra tay:
  - Số trên báo cáo khớp tay với 3 đơn đã làm ở Task 17.
  - STAFF không thấy menu Báo cáo/Cài đặt; mở thẳng URL thì nhận trang "Không có quyền".
  - Bấm "Sao lưu ngay" tạo được file trên R2 (local).
- [ ] **Step 3:** Commit `feat(admin-ui): tổng quan, báo cáo, cài đặt`.

## Phần D – Dữ liệu ban đầu và triển khai

### Task 20: Đối chiếu sản phẩm, tài liệu vận hành, chạy thử trên staging

**Files:** Create `scripts/reconcile-products.mjs`, `docs/van-hanh.md`.

**Interfaces:**
- `node scripts/reconcile-products.mjs` gọi `https://vkinno.vn/api/products?limit=200`, khớp 9 sản phẩm với seed 0001 theo `slug` rồi theo tên. In bảng chênh lệch (giá, giá niêm yết, ảnh, mô tả) và ghi `scripts/out/reconcile.sql` (chỉ UPDATE, không đổi SKU). Ảnh từ `susercontent.com` được tải về và upload lên R2 khi chạy với cờ `--upload-images` (dùng `wrangler r2 object put`).

- [ ] **Step 1:** Viết script, chạy, gửi anh xem bảng chênh lệch và file SQL. **Chờ anh duyệt** rồi mới áp dụng.
- [ ] **Step 2:** Viết `docs/van-hanh.md`:
  - Tạo D1/R2 staging và production.
  - Nạp các khoá bí mật (`ADMIN_SESSION_SECRET`, `SEPAY_WEBHOOK_API_KEY`, `TELEGRAM_*`, `GOOGLE_SCRIPT_*`).
  - Chạy migration.
  - Tạo ADMIN bằng `scripts/create-admin.mjs`.
  - Lập phiếu nhập đầu kỳ.
  - Khôi phục từ bản sao lưu R2, có lệnh cụ thể.
  - Gỡ biến `ADMIN_PASSWORD` cũ.
- [ ] **Step 3:** Triển khai staging. Các lệnh `wrangler d1 create`, `wrangler r2 bucket create`, `wrangler secret put`, `wrangler deploy --env staging` cần anh đăng nhập Cloudflare: em chuẩn bị sẵn lệnh, anh chạy hoặc xác nhận.
- [ ] **Step 4:** Chạy thử toàn bộ tiêu chí 7 trên staging:
  - Phiếu nhập đầu kỳ.
  - 4 đơn: Zalo, B2B từ báo giá, nhập file Shopee, đơn web.
  - Đóng gói → giao → thu tiền (gồm một giao dịch SePay thử) → báo cáo.
  - Thử khôi phục một bản sao lưu vào D1 tạm.
- [ ] **Step 5:** Chạy `npm test` (toàn bộ PASS) và `npm run build` (không lỗi).
- [ ] **Step 6:** Commit `docs: vận hành; chore: script đối chiếu sản phẩm`. Deploy production lên `*.workers.dev` **sau khi anh xác nhận**. Tên miền vkinno.vn giữ nguyên tới Dự án 2.
