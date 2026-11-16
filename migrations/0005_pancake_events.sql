-- 0005: Sự kiện đơn Pancake POS (Dự án 1b, bước 2). Mỗi lần Pancake gửi (webhook) hoặc đối soát
-- kéo về một trạng thái đơn → một dòng; khoá UNIQUE chống xử lý lặp. Không đụng bảng có sẵn.
-- Hoàn tác: DROP TABLE pancake_events;
CREATE TABLE IF NOT EXISTS pancake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- '<shop_id>-<id đơn trong shop>' (id đơn Pancake chỉ duy nhất trong một shop)
  pancake_order_id TEXT NOT NULL,
  status INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (result IN ('RECEIVED', 'CREATED', 'UPDATED', 'SKIPPED', 'NEEDS_MAPPING', 'NEEDS_ATTENTION', 'ERROR')),
  message TEXT NOT NULL DEFAULT '',
  order_id INTEGER REFERENCES orders(id),
  via TEXT NOT NULL DEFAULT 'WEBHOOK' CHECK (via IN ('WEBHOOK', 'RECONCILE')),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pancake_order_id, status, updated_at)
);

CREATE INDEX IF NOT EXISTS idx_pancake_events_order ON pancake_events(pancake_order_id);
CREATE INDEX IF NOT EXISTS idx_pancake_events_result ON pancake_events(result);
CREATE INDEX IF NOT EXISTS idx_pancake_events_received ON pancake_events(received_at);
