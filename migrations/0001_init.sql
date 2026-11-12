-- ============================================================================
-- VKINNO All-in-One D1 Schema & Initial Seed (0001_init.sql)
-- Architecture: Cloudflare Workers Static Assets + D1 SQLite (0 VND/month)
-- Rollback plan:
--   DROP TABLE IF EXISTS sepay_webhook_logs;
--   DROP TABLE IF EXISTS inventory_logs;
--   DROP TABLE IF EXISTS order_items;
--   DROP TABLE IF EXISTS orders;
--   DROP TABLE IF EXISTS bom_items;
--   DROP TABLE IF EXISTS leads;
--   DROP TABLE IF EXISTS app_settings;
--   DROP TABLE IF EXISTS products;
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
  listed_price_vnd INTEGER NOT NULL CHECK (listed_price_vnd >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  min_stock INTEGER NOT NULL DEFAULT 10 CHECK (min_stock >= 0),
  is_combo INTEGER NOT NULL DEFAULT 0 CHECK (is_combo IN (0, 1)),
  shelf_zone TEXT NOT NULL CHECK (shelf_zone IN ('RED_ACID', 'BLUE_BUFFER', 'GREEN_ALKALI', 'COMBO_MIX')),
  shelf_label TEXT NOT NULL,
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bom_items (
  combo_sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  component_sku TEXT NOT NULL REFERENCES products(sku) ON DELETE RESTRICT,
  qty_per_combo INTEGER NOT NULL CHECK (qty_per_combo > 0),
  PRIMARY KEY (combo_sku, component_sku)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  external_order_id TEXT UNIQUE,
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'SHOPEE', 'TIKTOK', 'ZALO', 'B2B')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  shipping_address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  subtotal_vnd INTEGER NOT NULL CHECK (subtotal_vnd >= 0),
  shipping_fee_vnd INTEGER NOT NULL CHECK (shipping_fee_vnd >= 0),
  discount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (discount_vnd >= 0),
  voucher_code TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'COD' CHECK (payment_method IN ('COD', 'VIETQR', 'SHOPEE', 'BANK_B2B')),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID')),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  sepay_tx_id INTEGER,
  paid_at TEXT,
  order_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (order_status IN ('PENDING', 'PACKED', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED')),
  stock_deducted INTEGER NOT NULL DEFAULT 0 CHECK (stock_deducted IN (0, 1)),
  privacy_consent INTEGER NOT NULL DEFAULT 1 CHECK (privacy_consent IN (0, 1)),
  du_an TEXT NOT NULL DEFAULT 'chu-dong-vkinno',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL REFERENCES products(sku),
  delta INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_order_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_created ON inventory_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_type TEXT NOT NULL DEFAULT 'B2B' CHECK (lead_type IN ('B2B', 'CONTACT', 'KOC')),
  company_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  interest TEXT NOT NULL DEFAULT '',
  volume_estimate TEXT NOT NULL DEFAULT '',
  social_link TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONSULTING', 'QUOTED', 'WON', 'LOST')),
  du_an TEXT NOT NULL DEFAULT 'chu-dong-vkinno',
  privacy_consent INTEGER NOT NULL DEFAULT 1 CHECK (privacy_consent IN (0, 1)),
  source_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_type_status ON leads(lead_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sepay_webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sepay_tx_id INTEGER NOT NULL UNIQUE,
  gateway TEXT NOT NULL,
  account_number TEXT NOT NULL,
  transfer_type TEXT NOT NULL,
  transfer_amount INTEGER NOT NULL,
  reference_code TEXT,
  content TEXT,
  matched_order_code TEXT,
  match_status TEXT NOT NULL CHECK (match_status IN ('PAID', 'PARTIAL', 'UNMATCHED', 'IGNORED')),
  raw_payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sepay_logs_received ON sepay_webhook_logs(received_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- SEED 9 SKUs (3-Color Shelf Standard at Di Trach Warehouse + Combo 145.000 VND)
-- ============================================================================
INSERT OR IGNORE INTO products (
  sku, product_id, name, slug, price_vnd, listed_price_vnd,
  stock_qty, min_stock, is_combo, shelf_zone, shelf_label, batch_code, expiry_date, image_url
) VALUES
  (
    'VK-BOSSMAN-DESCALER-500ML', 6,
    'Chai xịt tẩy cặn canxi 500ml Bossman làm sạch vách kính nhà tắm và sen vòi inox',
    'chai-xit-tay-can-canxi-500ml-an-toan-cho-da-tay-dung-dich-tay-can-canxi-lam-sach-voi-sen-va-nha-tam',
    69000, 90000, 85, 20, 0,
    'RED_ACID', 'Kệ 1 - Nhãn Đỏ (Nhóm Axit)',
    'BM-2610', '2028-10-15', '/images/products/vk-bossman-descaler-500ml.jpg'
  ),
  (
    'VK-VISIONX-CLEAN-500ML', 7,
    'Chai xịt tẩy ố kính ô tô, logo mạ Chrome và màng dầu kính lái VisionX Clean 500ml',
    'chai-xit-tay-rua-vet-o-kinh-logo-o-to-va-mang-dau-kinh-xit-lam-sach-sau-tiet-kiem-visionx-clean',
    75000, 99000, 48, 15, 0,
    'RED_ACID', 'Kệ 1 - Nhãn Đỏ (Nhóm Axit)',
    'VX-2610', '2028-10-15', '/images/products/vk-visionx-clean-500ml.jpg'
  ),
  (
    'VK-CLEARWAY-GLASSPRO-500ML', 5,
    'Nước lau kính ClearWay GlassPro 500ml sạch trong không vệt cho kính nhà & văn phòng',
    'nuoc-lau-kinh-clearway-glasspro-500ml-sach-nhanh-khong-vet-sang-bong-kinh-nha-van-phong',
    45000, 59000, 72, 20, 0,
    'BLUE_BUFFER', 'Kệ 2 - Nhãn Xanh Dương (Đệm Trung tính)',
    'CW500-2610', '2029-10-01', '/images/products/vk-clearway-glasspro-500ml.jpg'
  ),
  (
    'VK-BOTTLE-SPRAY-500ML', 3,
    'Chai xịt rỗng 500ml bình xịt nhựa PET dày phun sương có khóa an toàn',
    'bo-chai-xit-500ml-phun-suong',
    19000, 21000, 120, 30, 0,
    'BLUE_BUFFER', 'Kệ 2 - Nhãn Xanh Dương (Phụ kiện)',
    'PET-2609', '2030-12-31', '/images/products/vk-bottle-spray-500ml.jpg'
  ),
  (
    'VK-CLEARWAY-GLASSPRO-5L', 4,
    'Nước lau kính đa năng ClearWay GlassPro can 5L dùng ngay tặng kèm bình xịt',
    'nuoc-lau-kinh-lam-sach-cuc-sau-khong-de-lai-vet-mo-can-5l-tang-kem-binh-xit-clearway-glasspro',
    155000, 199000, 24, 10, 0,
    'BLUE_BUFFER', 'Kệ 2 - Nhãn Xanh Dương (Sát sàn <40cm)',
    'CW5L-2610', '2029-10-01', '/images/products/vk-clearway-glasspro-5l.jpg'
  ),
  (
    'VK-CLEARWAY-AUTO-5L', 9,
    'Nước rửa kính ô tô chuyên dụng ClearWay can 5L đổ bình gạt mưa sạch trong êm lưỡi gạt',
    'nuoc-rua-kinh-o-to-chuyen-dung-clearway-chong-bam-nuoc-sach-sau-an-toan-voi-can-gat-va-be-mat-kinh',
    95000, 125000, 8, 10, 0,
    'BLUE_BUFFER', 'Kệ 2 - Nhãn Xanh Dương (Sát sàn <40cm)',
    'CWA5L-2610', '2029-10-01', '/images/products/vk-clearway-auto-5l.jpg'
  ),
  (
    'VK-DEGREASER-500ML', 10,
    'Chai xịt tẩy dầu mỡ đa năng VKINNO 500ml chuyên dụng cho bếp từ và lưới lọc hút mùi',
    'tay-dau-mo-da-nang-cao-cap-vkinno-500ml-chuyen-dung-cho-bep-tu-bep-hong-ngoai-an-toan-be-mat-bep',
    85000, 117000, 64, 20, 0,
    'GREEN_ALKALI', 'Kệ 3 - Nhãn Xanh Lá (Nhóm Kiềm)',
    'DG-2610', '2028-10-20', '/images/products/vk-degreaser-500ml.jpg'
  ),
  (
    'VK-SOLAR-SHIELD-5L', 1,
    'Dung dịch vệ sinh tấm pin mặt trời Solar Shield đậm đặc can 5L tặng kèm bình xịt',
    'dung-dich-ve-sinh-tam-pin-mat-troi-solar-shield-dam-dac-giup-tang-hieu-suat-dien-tang-kem-binh-xit',
    295000, 380000, 18, 8, 0,
    'GREEN_ALKALI', 'Kệ 3 - Nhãn Xanh Lá (Sát sàn <40cm)',
    'SS5L-2610', '2028-10-20', '/images/products/vk-solar-shield-5l.jpg'
  ),
  (
    'VK-COMBO-BOSSMAN-VKINNO-500ML', 11,
    'Combo Nhà tắm & Nhà bếp sạch sâu: Chai tẩy cặn canxi Bossman 500ml + Tẩy dầu mỡ VKINNO 500ml',
    'combo-chai-xit-tay-can-canxi-500ml-va-chai-tay-dau-mo-an-toan-da-tay-cong-thuc-moi-sach-vuot-troi---combobossmanvkinno-1782568108',
    145000, 154000, 64, 15, 1,
    'COMBO_MIX', 'BOM Ảo: Nhặt Kệ 1 [Đỏ] + Kệ 3 [Xanh Lá]',
    'BOM-VIRTUAL', 'Theo chai lẻ', '/images/products/vk-combo-bossman-vkinno-500ml.jpg'
  );

INSERT OR IGNORE INTO bom_items (combo_sku, component_sku, qty_per_combo) VALUES
  ('VK-COMBO-BOSSMAN-VKINNO-500ML', 'VK-BOSSMAN-DESCALER-500ML', 1),
  ('VK-COMBO-BOSSMAN-VKINNO-500ML', 'VK-DEGREASER-500ML', 1);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('gem_cskh_url', 'https://gemini.google.com/gems/view'),
  ('gem_content_url', 'https://gemini.google.com/gems/view'),
  ('gem_b2b_url', 'https://gemini.google.com/gems/view'),
  ('gem_1_url', 'https://gemini.google.com/gems/view'),
  ('gem_2_url', 'https://gemini.google.com/gems/view'),
  ('gem_3_url', 'https://gemini.google.com/gems/view'),
  ('notebooklm_url', 'https://notebooklm.google.com/'),
  ('drive_backup_url', 'https://drive.google.com/');

INSERT INTO inventory_logs (sku, delta, stock_after, reason, ref_order_code)
SELECT 'VK-BOSSMAN-DESCALER-500ML', 85, 85, 'Khởi tạo tồn đầu kỳ Kho Di Trạch (Kệ 1 - Nhãn Đỏ)', 'INIT-SEED'
WHERE NOT EXISTS (SELECT 1 FROM inventory_logs LIMIT 1);

INSERT INTO inventory_logs (sku, delta, stock_after, reason, ref_order_code)
SELECT 'VK-DEGREASER-500ML', 64, 64, 'Khởi tạo tồn đầu kỳ Kho Di Trạch (Kệ 3 - Nhãn Xanh Lá)', 'INIT-SEED'
WHERE (SELECT COUNT(*) FROM inventory_logs) = 1;

INSERT INTO inventory_logs (sku, delta, stock_after, reason, ref_order_code)
SELECT 'VK-CLEARWAY-AUTO-5L', 8, 8, 'Cảnh báo sắp chạm đáy định mức (< 10 can) - Cần pha lô mới', 'INIT-SEED'
WHERE (SELECT COUNT(*) FROM inventory_logs) = 2;
