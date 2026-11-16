-- 0004: Hộp thư webhook Pancake POS (Dự án 1b, bước 0b).
-- Chỉ lưu nguyên văn payload để xem cấu trúc thật trước khi viết ánh xạ đơn/kho.
-- Không đụng bảng có sẵn. Hoàn tác: DROP TABLE pancake_inbox;
CREATE TABLE IF NOT EXISTS pancake_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  content_type TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pancake_inbox_received ON pancake_inbox(received_at);
