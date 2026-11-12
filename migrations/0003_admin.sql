-- ============================================================================
-- VKINNO D1 Forward Migration 0003: Quản trị kho và bán hàng
-- Kế hoạch hoàn tác:
--   1. DROP các bảng mới: audit_logs, login_attempts, users, import_batches,
--      channel_sku_map, quote_items, quotes, payments, stock_doc_lines,
--      stock_docs, suppliers, customers.
--   2. Dựng lại products và orders theo cấu trúc của 0001/0002 (bỏ các cột mới,
--      trả CHECK cũ của shelf_zone/channel/payment_method), chép lại dữ liệu cột cũ.
--   3. order_items.unit_cost_vnd và inventory_logs.(doc_type, doc_code,
--      unit_cost_vnd, created_by) không xoá được cột trực tiếp: dựng lại bảng
--      hoặc để nguyên (cột dư vô hại).
--   Khôi phục từ bản sao lưu D1 (R2 backups/) nếu dữ liệu đã bị ghi sau migration.
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- Bảng mới mà orders tham chiếu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'RETAIL' CHECK (type IN ('RETAIL', 'B2B')),
  company_name TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  credit_limit_vnd INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_vnd >= 0),
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  price_tier TEXT NOT NULL DEFAULT 'RETAIL' CHECK (price_tier IN ('RETAIL', 'WHOLESALE')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- products: dựng lại để thêm cột và CHECK tồn kho, bỏ CHECK cố định của shelf_zone
-- ---------------------------------------------------------------------------
CREATE TABLE products_new (
  sku TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
  listed_price_vnd INTEGER NOT NULL CHECK (listed_price_vnd >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  min_stock INTEGER NOT NULL DEFAULT 10 CHECK (min_stock >= 0),
  is_combo INTEGER NOT NULL DEFAULT 0 CHECK (is_combo IN (0, 1)),
  shelf_zone TEXT NOT NULL DEFAULT '',
  shelf_label TEXT NOT NULL DEFAULT '',
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  cost_avg_vnd INTEGER NOT NULL DEFAULT 0 CHECK (cost_avg_vnd >= 0),
  wholesale_price_vnd INTEGER CHECK (wholesale_price_vnd IS NULL OR wholesale_price_vnd >= 0),
  unit TEXT NOT NULL DEFAULT 'chai',
  category TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  gallery_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (reserved_qty <= stock_qty)
);

INSERT INTO products_new (
  sku, product_id, name, slug, price_vnd, listed_price_vnd, stock_qty, min_stock,
  is_combo, shelf_zone, shelf_label, batch_code, expiry_date, image_url, updated_at
)
SELECT
  sku, product_id, name, slug, price_vnd, listed_price_vnd, stock_qty, min_stock,
  is_combo, shelf_zone, shelf_label, batch_code, expiry_date, image_url, updated_at
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

-- ---------------------------------------------------------------------------
-- orders: dựng lại để mở rộng kênh, phương thức thanh toán, thêm cột mới
-- ---------------------------------------------------------------------------
CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  external_order_id TEXT UNIQUE,
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'SHOPEE', 'TIKTOK', 'ZALO', 'B2B', 'PHONE', 'FACEBOOK')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  shipping_address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  shipping_carrier TEXT NOT NULL DEFAULT '',
  shipping_tracking_code TEXT NOT NULL DEFAULT '',
  subtotal_vnd INTEGER NOT NULL CHECK (subtotal_vnd >= 0),
  shipping_fee_vnd INTEGER NOT NULL CHECK (shipping_fee_vnd >= 0),
  discount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (discount_vnd >= 0),
  voucher_code TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'COD' CHECK (payment_method IN ('COD', 'VIETQR', 'SHOPEE', 'BANK_B2B', 'CASH', 'BANK_TRANSFER', 'MARKETPLACE')),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID')),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  sepay_tx_id INTEGER,
  paid_at TEXT,
  order_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (order_status IN ('PENDING', 'PACKED', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED')),
  stock_deducted INTEGER NOT NULL DEFAULT 0 CHECK (stock_deducted IN (0, 1)),
  privacy_consent INTEGER NOT NULL DEFAULT 1 CHECK (privacy_consent IN (0, 1)),
  du_an TEXT NOT NULL DEFAULT 'chu-dong-vkinno',
  customer_id INTEGER REFERENCES customers(id),
  due_date TEXT,
  source TEXT NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB', 'MANUAL', 'IMPORT', 'QUOTE')),
  created_by INTEGER,
  quote_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO orders_new (
  id, order_code, external_order_id, channel, customer_name, customer_phone,
  customer_email, shipping_address, notes, shipping_carrier, shipping_tracking_code,
  subtotal_vnd, shipping_fee_vnd, discount_vnd, voucher_code, total_amount,
  payment_method, payment_status, paid_amount, sepay_tx_id, paid_at, order_status,
  stock_deducted, privacy_consent, du_an, created_at, updated_at
)
SELECT
  id, order_code, external_order_id, channel, customer_name, customer_phone,
  customer_email, shipping_address, notes, shipping_carrier, shipping_tracking_code,
  subtotal_vnd, shipping_fee_vnd, discount_vnd, voucher_code, total_amount,
  payment_method, payment_status, paid_amount, sepay_tx_id, paid_at, order_status,
  stock_deducted, privacy_consent, du_an, created_at, updated_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at);

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Cột thêm vào bảng có sẵn
-- ---------------------------------------------------------------------------
ALTER TABLE order_items ADD COLUMN unit_cost_vnd INTEGER;

ALTER TABLE inventory_logs ADD COLUMN doc_type TEXT;
ALTER TABLE inventory_logs ADD COLUMN doc_code TEXT;
ALTER TABLE inventory_logs ADD COLUMN unit_cost_vnd INTEGER;
ALTER TABLE inventory_logs ADD COLUMN created_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_inventory_logs_sku_created ON inventory_logs(sku, created_at);

-- ---------------------------------------------------------------------------
-- Bảng mới
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('RECEIPT', 'ISSUE', 'ADJUST', 'STOCKTAKE')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  supplier_id INTEGER REFERENCES suppliers(id),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  posted_by INTEGER REFERENCES users(id),
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_doc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  qty INTEGER NOT NULL DEFAULT 0,
  unit_cost_vnd INTEGER CHECK (unit_cost_vnd IS NULL OR unit_cost_vnd >= 0),
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  counted_qty INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
  system_qty INTEGER
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL DEFAULT 'RECEIPT' CHECK (kind IN ('RECEIPT', 'REFUND')),
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0),
  method TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  sepay_tx_id INTEGER UNIQUE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED')),
  valid_until TEXT,
  note TEXT NOT NULL DEFAULT '',
  discount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (discount_vnd >= 0),
  shipping_fee_vnd INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee_vnd >= 0),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS channel_sku_map (
  channel TEXT NOT NULL,
  external_sku TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku),
  PRIMARY KEY (channel, external_sku)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  total_rows INTEGER NOT NULL DEFAULT 0,
  created_orders INTEGER NOT NULL DEFAULT 0,
  skipped_duplicates INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Chỉ mục
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_doc_lines_doc ON stock_doc_lines(doc_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
