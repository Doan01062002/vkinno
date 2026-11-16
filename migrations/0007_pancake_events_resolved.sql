-- 0007: Đánh dấu sự kiện Pancake cần xử lý đã được người xử lý (màn hình Cài đặt → Pancake).
-- Hoàn tác: SQLite ≥ 3.35 hỗ trợ ALTER TABLE pancake_events DROP COLUMN resolved_at;
ALTER TABLE pancake_events ADD COLUMN resolved_at TEXT;
ALTER TABLE pancake_events ADD COLUMN resolved_by INTEGER REFERENCES users(id);
