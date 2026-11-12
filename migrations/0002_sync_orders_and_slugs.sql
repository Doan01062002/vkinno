-- ============================================================================
-- VKINNO D1 Forward Migration 0002: Sync Storefront Slugs, PHONE Channel & Tracking
-- Rollback plan:
--   Restore orders table without shipping_carrier/shipping_tracking_code if needed
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  external_order_id TEXT UNIQUE,
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'SHOPEE', 'TIKTOK', 'ZALO', 'B2B', 'PHONE')),
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

INSERT INTO orders_new (
  id, order_code, external_order_id, channel, customer_name, customer_phone,
  customer_email, shipping_address, notes, subtotal_vnd, shipping_fee_vnd,
  discount_vnd, voucher_code, total_amount, payment_method, payment_status,
  paid_amount, sepay_tx_id, paid_at, order_status, stock_deducted,
  privacy_consent, du_an, created_at, updated_at
)
SELECT
  id, order_code, external_order_id, channel, customer_name, customer_phone,
  customer_email, shipping_address, notes, subtotal_vnd, shipping_fee_vnd,
  discount_vnd, voucher_code, total_amount, payment_method, payment_status,
  paid_amount, sepay_tx_id, paid_at, order_status, stock_deducted,
  privacy_consent, du_an, created_at, updated_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);

PRAGMA foreign_keys = ON;

-- Sync exact SEO product slugs with src/data/products.ts
UPDATE products SET slug = 'dung-dich-ve-sinh-tam-pin-mat-troi-solar-shield-dam-dac-giup-tang-hieu-suat-dien-tang-kem-binh-xit' WHERE sku = 'VK-SOLAR-SHIELD-5L';
UPDATE products SET slug = 'bo-chai-xit-500ml-phun-suong' WHERE sku = 'VK-BOTTLE-SPRAY-500ML';
UPDATE products SET slug = 'nuoc-lau-kinh-lam-sach-cuc-sau-khong-de-lai-vet-mo-can-5l-tang-kem-binh-xit-clearway-glasspro' WHERE sku = 'VK-CLEARWAY-GLASSPRO-5L';
UPDATE products SET slug = 'nuoc-lau-kinh-clearway-glasspro-500ml-sach-nhanh-khong-vet-sang-bong-kinh-nha-van-phong' WHERE sku = 'VK-CLEARWAY-GLASSPRO-500ML';
UPDATE products SET slug = 'chai-xit-tay-can-canxi-500ml-an-toan-cho-da-tay-dung-dich-tay-can-canxi-lam-sach-voi-sen-va-nha-tam' WHERE sku = 'VK-BOSSMAN-DESCALER-500ML';
UPDATE products SET slug = 'chai-xit-tay-rua-vet-o-kinh-logo-o-to-va-mang-dau-kinh-xit-lam-sach-sau-tiet-kiem-visionx-clean' WHERE sku = 'VK-VISIONX-CLEAN-500ML';
UPDATE products SET slug = 'nuoc-rua-kinh-o-to-chuyen-dung-clearway-chong-bam-nuoc-sach-sau-an-toan-voi-can-gat-va-be-mat-kinh' WHERE sku = 'VK-CLEARWAY-AUTO-5L';
UPDATE products SET slug = 'tay-dau-mo-da-nang-cao-cap-vkinno-500ml-chuyen-dung-cho-bep-tu-bep-hong-ngoai-an-toan-be-mat-bep' WHERE sku = 'VK-DEGREASER-500ML';
UPDATE products SET slug = 'combo-chai-xit-tay-can-canxi-500ml-va-chai-tay-dau-mo-an-toan-da-tay-cong-thuc-moi-sach-vuot-troi---combobossmanvkinno-1782568108', price_vnd = 145000, listed_price_vnd = 154000 WHERE sku = 'VK-COMBO-BOSSMAN-VKINNO-500ML';

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('gem_cskh_url', 'https://gemini.google.com/gems/view'),
  ('gem_content_url', 'https://gemini.google.com/gems/view'),
  ('gem_b2b_url', 'https://gemini.google.com/gems/view'),
  ('notebooklm_url', 'https://notebooklm.google.com/'),
  ('drive_backup_url', 'https://drive.google.com/');
