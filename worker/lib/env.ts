/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /**
   * Lúc chạy có thể KHÔNG có khi môi trường chưa bật R2 (staging tạm chạy không R2): mọi chỗ dùng
   * phải qua `requireFiles()` hoặc kiểm tra `if (!env.FILES)` trước.
   */
  FILES: R2Bucket;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  SEPAY_WEBHOOK_API_KEY?: string;
  /** Giá trị header `X-VK-Key` mà webhook Pancake POS phải gửi kèm. */
  PANCAKE_WEBHOOK_SECRET?: string;
  /** Khoá Pancake POS Open API (Cấu hình → Ứng dụng → API KEY) cho đối soát + đẩy tồn. */
  PANCAKE_API_KEY?: string;
  /** Khoá Gemini API (Google AI Studio) cho tự viết bài cẩm nang. */
  GEMINI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GOOGLE_SCRIPT_WEBHOOK_URL?: string;
  GOOGLE_SCRIPT_SECRET?: string;
  GOOGLE_SHEET_ID?: string;
  APPSHEET_APP_URL?: string;
}
