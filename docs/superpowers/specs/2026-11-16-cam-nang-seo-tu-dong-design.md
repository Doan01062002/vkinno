# Thiết kế: Cẩm nang chuẩn SEO + tự viết bài hằng ngày bằng Gemini (Dự án 1c)

> Trạng thái: **đã chốt hướng 16/11/2026 — đã làm xong code (chưa commit, chưa deploy staging)**. Chủ tịch chọn: (1) viết lại các bài cũ cho chuẩn SEO trước, (2) sau đó tự viết **1 bài/ngày** bằng **Gemini API gói miễn phí**.
> CEO đã phản biện 1 vòng (rủi ro "scaled content abuse", tên miền chưa chuyển). Chủ tịch giữ quyết định, nên làm theo, kèm các chốt an toàn ở mục 5.

## 1. Bối cảnh

- Mục `/cam-nang` hiện là trang tĩnh Astro, dữ liệu `src/data/posts.json`: 3 bài khoảng 300 chữ, dùng `<br><b>` thay tiêu đề, không FAQ, không dữ liệu cấu trúc Article, không link sang sản phẩm.
- Web tĩnh build ra `dist/`. Bài mới mà cứ phải build + deploy lại thì không "tự động" được. Vì vậy bài viết chuyển vào **D1** và **Worker dựng trang**.
- Staging đang trả `index, follow`. vkinno.vn vẫn là site cũ (Dự án 2 chưa chuyển). Bài trên staging chưa có giá trị SEO cho tới khi chuyển tên miền.

## 2. Mục tiêu & tiêu chí hoàn thành

1. 3 bài cũ viết lại: 1.200–1.800 chữ, có H2/H3, FAQ, ít nhất 2 link nội bộ, title ≤ 60 ký tự, meta description 140–160 ký tự, giữ nguyên URL.
2. Trang bài có: JSON-LD `BlogPosting` + `BreadcrumbList` + `FAQPage`, tác giả, ngày đăng/cập nhật, thời gian đọc, mục lục, khối sản phẩm liên quan, OG đúng bài.
3. `/sitemap-cam-nang.xml` liệt kê mọi bài đã đăng kèm `lastmod`. `robots.txt` khai báo sitemap bằng URL tuyệt đối. Trên host `*.workers.dev`, `robots.txt` chặn toàn bộ.
4. Mỗi ngày lúc 02:00 (giờ VN), Worker lấy 1 chủ đề trong hàng đợi, gọi Gemini, kiểm tra chất lượng rồi lưu bài. **Mặc định trạng thái "Chờ duyệt"**. Bật "Tự đăng" trong Cài đặt thì đăng thẳng.
5. Trang quản trị có mục **Bài viết** gồm 3 tab: danh sách bài (sửa, đăng, gỡ, xem trước), hàng đợi chủ đề, cài đặt. Có nút "Viết thử ngay".
6. Chi phí: **0đ** (Gemini gói miễn phí + Cloudflare gói miễn phí).

## 3. Phạm vi

**Trong phạm vi:** bảng D1 `blog_posts`, `blog_topics`, `blog_runs`; route công khai `/cam-nang`, `/cam-nang/:slug`, `/sitemap-cam-nang.xml`, `/robots.txt`; API admin `/api/admin/blog/*`; màn hình admin; cron viết bài; seed 3 bài cũ + khoảng 30 chủ đề.

**Ngoài phạm vi:** chuyển tên miền vkinno.vn (Dự án 2); AI tạo ảnh (bài dùng ảnh sản phẩm có sẵn); Grounding with Google Search (gói miễn phí không có, và điều khoản buộc hiển thị Search Suggestions, không hợp với blog); tự đăng mạng xã hội.

## 4. Kiến trúc

```
Astro build ─► dist/vk-khung/bai-viet/index.html   (Layout + SEOHead, chuỗi giữ chỗ __VK_*__)
            └► dist/vk-khung/danh-sach/index.html

GET /cam-nang/:slug ─► Worker ─► D1 blog_posts (published) ─► lấy khung từ ASSETS
                                                        └─► thay chuỗi giữ chỗ ─► HTML hoàn chỉnh
Cron 02:00 VN ─► runBlogDaily ─► blog_topics (pending, ưu tiên cao nhất)
                              └► Gemini generateContent (JSON) ─► zod + lọc HTML + kiểm chất lượng
                              └► blog_posts (review | published) + blog_runs + Telegram
```

- Dùng **thay chuỗi** chứ không dùng `HTMLRewriter`, vì test và `dev:api` chạy trên Node (không có `HTMLRewriter`).
- Khung do Astro build nên header, footer, giỏ hàng, font và GTM giống hệt các trang khác. Phần thân bài do `worker/blog/render.ts` dựng, dùng chung cho bài cũ và bài mới.
- `/vk-khung/*` truy cập trực tiếp sẽ trả 404 và bị loại khỏi sitemap Astro.
- Trang chủ vẫn lấy 3 bài nổi bật từ `src/data/posts.json` (giữ đồng bộ nội dung bài cũ). Xoá `src/pages/cam-nang/*.astro`.

## 5. Chốt an toàn chống bị Google phạt

- **Mặc định người duyệt** (`blog.auto_publish = 0`). Hướng dẫn chính thức của Google về nội dung AI nói việc kiểm chứng thủ công là "critical". Chủ tịch có thể bật tự đăng trong Cài đặt.
- Tối đa **1 bài/ngày**, chỉ viết từ hàng đợi chủ đề do người nhập. Hết chủ đề thì dừng và báo Telegram, không tự sinh chủ đề.
- Kiểm tra trước khi lưu: ít nhất 900 chữ; ít nhất 3 thẻ H2; ít nhất 1 link `/san-pham/<slug có thật>`; 3–6 FAQ; title ≤ 70, meta 120–170 ký tự; không chứa cụm cấm (`số 1`, `100%`, `99,9%`, `tốt nhất`, `chữa`, `cam kết`, `tuyệt đối`...). Không đạt thì lưu bản nháp kèm lý do (không đăng, kể cả khi bật tự đăng).
- HTML lọc theo danh sách thẻ cho phép (p, h2, h3, ul, ol, li, strong, em, a, table, thead, tbody, tr, th, td, blockquote). Link ngoài gắn `rel="nofollow noopener"`.
- Prompt chỉ cấp dữ kiện sản phẩm từ `src/data/products.ts`, cấm bịa số liệu, và yêu cầu nêu cả mẹo tự làm kèm giới hạn.
- Bài AI có dòng ghi chú cách làm ("Bài được biên soạn với sự hỗ trợ của công cụ AI và được đội ngũ kỹ thuật VKINNO rà soát"), đúng khuyến nghị minh bạch của Google.
- Gói miễn phí của Gemini: Google **được dùng dữ liệu vào/ra để cải tiến sản phẩm và có người đọc**. Vì vậy prompt chỉ chứa thông tin công khai (không đơn hàng, không khách hàng).

## 6. Dữ liệu (migration 0008, 0009)

`blog_posts`: `id, slug UNIQUE, title, seo_title, meta_description, summary, content_html, faq_json, image_url, image_alt, primary_keyword, secondary_keywords_json, related_skus_json, sources_json, status (draft|review|published|archived), origin (manual|ai), ai_model, topic_id, word_count, quality_notes, published_at, created_at, updated_at`.

`blog_topics`: `id, primary_keyword UNIQUE, angle, cluster, related_skus_json, priority, status (pending|used|failed|skipped), post_id, attempts, last_error, created_at, updated_at`.

`blog_runs`: `id, run_date (YYYY-MM-DD giờ VN), trigger (cron|manual), topic_id, post_id, status (ok|rejected|error|skipped), model, prompt_tokens, output_tokens, thoughts_tokens, message, created_at`. Mỗi ngày cron chỉ chạy 1 lần thành công: chống chạy trùng bằng `run_date` + `trigger='cron'` + `status IN ('ok','rejected')`.

`app_settings`: `blog.enabled` (mặc định 1), `blog.auto_publish` (0), `blog.model` (`gemini-3.8-flash`), `blog.author` (`Phòng Kỹ thuật VKINNO`).

0009 seed 3 bài cũ (sinh từ `src/data/posts.json` bằng `scripts/gen-blog-seed.ts`) + khoảng 30 chủ đề theo 4 cụm: pin mặt trời, nhà tắm, bếp, kính & ô tô.

## 7. Gemini

- Bí mật: `GEMINI_API_KEY` (Chủ tịch tự tạo ở Google AI Studio và tự chạy `npx.cmd wrangler secret put GEMINI_API_KEY --env staging`).
- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`. Gửi `systemInstruction`, `contents`, `generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32768, temperature: 0.7, thinkingConfig: { thinkingLevel: "LOW" } }`.
- Nếu API trả 400 do trường `thinkingConfig`, gửi lại một lần không có trường này. Lỗi 429/5xx: ghi `blog_runs` lỗi, tăng `attempts` của chủ đề (đủ 3 lần thì `failed`), ngày mai thử lại.
- `finishReason` khác `STOP` (ví dụ `MAX_TOKENS`, `SAFETY`) thì coi là lỗi.
- Tra 16/11/2026 (aistudio.google.com/docs): `gemini-3.8-flash` miễn phí ở gói Free, có ở Việt Nam. Hạn mức RPD của gói miễn phí chỉ xem được khi đăng nhập AI Studio [ASSUMED đủ cho 1–3 lần gọi/ngày]. `gemini-2.5-flash` bị chuyển hướng từ 01/12/2026, nên không dùng.

## 8. Giao diện quản trị

Menu **Bài viết** (chỉ ADMIN), `/quan-tri/bai-viet`:
- **Bài viết**: bảng gồm tiêu đề, trạng thái, nguồn (AI/tay), số chữ, ngày đăng; lọc theo trạng thái. Bấm vào bài thì mở trang sửa `/quan-tri/bai-viet/:id`: các trường SEO có bộ đếm ký tự, nội dung HTML, FAQ, cảnh báo chất lượng, nút Lưu / Đăng / Gỡ / Xem trước (mở `/cam-nang/:slug?xem-truoc=1`, chỉ người đã đăng nhập mới xem được bài chưa đăng, kèm `noindex`).
- **Chủ đề**: thêm chủ đề (từ khoá, hướng bài, cụm, SKU liên quan, ưu tiên), bỏ qua hoặc xoá chủ đề chưa dùng.
- **Cài đặt**: bật/tắt tự viết, tự đăng, model, trạng thái khoá API (có hay chưa), 10 lần chạy gần nhất, nút **Viết thử ngay** (tối đa 3 lần/ngày).

## 9. Kiểm thử

Vitest (Node, D1 sqlite): dựng trang bài và danh sách (thay đủ chuỗi giữ chỗ, escape, JSON-LD), 404, xem trước bài nháp, sitemap, robots theo host; lọc HTML; kiểm chất lượng; luồng cron với `fetch` Gemini giả (ok, JSON hỏng, MAX_TOKENS, 429, chạy trùng ngày, tự đăng bật/tắt); API admin (quyền, sửa, đăng, chủ đề).

## 10. Việc Chủ tịch cần làm

1. Tạo API key Gemini ở https://aistudio.google.com/apikey rồi tự nạp: `npx.cmd wrangler secret put GEMINI_API_KEY --env staging`.
2. Duyệt bài mỗi sáng (hoặc bật tự đăng nếu chấp nhận rủi ro).
3. Cung cấp tên người thật đứng tên tác giả (E-E-A-T) và ảnh thật trước/sau nếu có.
4. Dự án 2: chuyển vkinno.vn sang Worker + Search Console thì bài mới có giá trị SEO.
