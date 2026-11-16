-- 0006: Lần đẩy tồn "có thể bán" gần nhất lên Pancake POS cho từng mẫu mã (Dự án 1b, bước 4).
-- Chỉ gửi mẫu mã có số khác lần trước. Không đụng bảng có sẵn.
-- Hoàn tác: DROP TABLE pancake_stock_push;
CREATE TABLE IF NOT EXISTS pancake_stock_push (
  variation_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  last_qty INTEGER NOT NULL,
  pushed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
