import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMigrations, createTestD1 } from './d1-sqlite';
import { seedProducts } from './helpers';

async function freshDb() {
  const db = createTestD1();
  await applyMigrations(db);
  return db;
}

const orderSql = `INSERT INTO orders (order_code, channel, customer_name, customer_phone, shipping_address,
  subtotal_vnd, shipping_fee_vnd, total_amount, payment_method, source)
  VALUES (?, ?, 'A', '0900000000', 'HN', 100, 0, 100, ?, ?)`;

describe('migration 0003', () => {
  it('products CHECK chặn tồn âm', async () => {
    const db = await freshDb();
    await expect(
      db.prepare("UPDATE products SET stock_qty = -1 WHERE sku='VK-DEGREASER-500ML'").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('products CHECK chặn giữ vượt tồn', async () => {
    const db = await freshDb();
    await expect(
      db.prepare("UPDATE products SET stock_qty = 5, reserved_qty = 6 WHERE sku='VK-DEGREASER-500ML'").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('giữ dữ liệu 0001', async () => {
    const db = await freshDb();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM products').first('n')).toBe(9);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM bom_items WHERE combo_sku='VK-COMBO-BOSSMAN-VKINNO-500ML'")
        .first('n'),
    ).toBe(2);
    expect(await db.prepare('SELECT reserved_qty, unit, is_active FROM products LIMIT 1').first()).toEqual({
      reserved_qty: 0,
      unit: 'chai',
      is_active: 1,
    });
  });

  it('orders nhận kênh FACEBOOK, nguồn MANUAL, thanh toán CASH', async () => {
    const db = await freshDb();
    await db.prepare(orderSql).bind('T1', 'FACEBOOK', 'CASH', 'MANUAL').run();
    expect(await db.prepare("SELECT channel FROM orders WHERE order_code='T1'").first('channel')).toBe('FACEBOOK');
    await expect(db.prepare(orderSql).bind('T2', 'FACEBOOK', 'CASH', 'BOGUS').run()).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });

  it('payments.kind chỉ nhận RECEIPT|REFUND', async () => {
    const db = await freshDb();
    await db.prepare(orderSql).bind('T1', 'WEB', 'COD', 'WEB').run();
    const ins = (kind: string) =>
      db
        .prepare(
          "INSERT INTO payments (order_id, kind, amount_vnd, method) VALUES ((SELECT id FROM orders WHERE order_code='T1'), ?, 100, 'CASH')",
        )
        .bind(kind)
        .run();
    await ins('RECEIPT');
    await ins('REFUND');
    await expect(ins('OTHER')).rejects.toThrow(/CHECK constraint failed/);
  });

  it('batch rollback khi một lệnh lỗi', async () => {
    const db = await freshDb();
    const before = await db.prepare("SELECT stock_qty FROM products WHERE sku='VK-DEGREASER-500ML'").first('stock_qty');
    await expect(
      db.batch([
        db.prepare("UPDATE products SET stock_qty = 7 WHERE sku='VK-DEGREASER-500ML'"),
        db.prepare("UPDATE products SET stock_qty = -1 WHERE sku='VK-DEGREASER-500ML'"),
      ]),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await db.prepare("SELECT stock_qty FROM products WHERE sku='VK-DEGREASER-500ML'").first('stock_qty')).toBe(before);
  });

  it('hai batch chạy chồng nhau không xen kẽ: chỉ một batch lấy được đơn vị cuối', async () => {
    const db = await freshDb();
    await db.prepare("UPDATE products SET stock_qty = 1 WHERE sku='VK-DEGREASER-500ML'").run();
    const take = (note: string) =>
      db.batch([
        db.prepare("UPDATE products SET stock_qty = stock_qty - 1 WHERE sku='VK-DEGREASER-500ML'"),
        db
          .prepare("INSERT INTO inventory_logs (sku, delta, stock_after, reason, ref_order_code) VALUES ('VK-DEGREASER-500ML', -1, 0, 'SALE_OUT', ?)")
          .bind(note),
      ]);
    const results = await Promise.allSettled([take('A'), take('B')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/CHECK constraint failed/);
    expect(await db.prepare("SELECT stock_qty FROM products WHERE sku='VK-DEGREASER-500ML'").first('stock_qty')).toBe(0);
    expect(await db.prepare("SELECT ref_order_code FROM inventory_logs WHERE reason='SALE_OUT'").all()).toMatchObject({
      results: [{ ref_order_code: 'A' }],
    });
  });

  it('nâng cấp 0002 -> 0003 giữ nguyên dòng con và khoá ngoại sạch', async () => {
    const db = createTestD1();
    await applyMigrations(db, { filter: (n) => !n.startsWith('0003') });
    await db
      .prepare(
        `INSERT INTO orders (order_code, customer_name, customer_phone, shipping_address, subtotal_vnd, shipping_fee_vnd, total_amount)
         VALUES ('OLD1', 'A', '0900000000', 'HN', 90000, 0, 90000)`,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total) VALUES ((SELECT id FROM orders WHERE order_code='OLD1'), 'VK-DEGREASER-500ML', 'Tẩy dầu', 85000, 2, 170000)",
      )
      .run();
    await db
      .prepare("INSERT INTO inventory_logs (sku, delta, stock_after, reason, ref_order_code) VALUES ('VK-DEGREASER-500ML', -2, 62, 'SALE_OUT', 'OLD1')")
      .run();
    const snap = async () => ({
      bom: (await db.prepare('SELECT * FROM bom_items ORDER BY component_sku').all()).results,
      items: (await db.prepare('SELECT * FROM order_items ORDER BY id').all()).results,
      logs: (await db.prepare('SELECT * FROM inventory_logs ORDER BY id').all()).results,
    });
    const before = await snap();
    expect(before.bom).toHaveLength(2);
    expect(before.items).toHaveLength(1);
    expect(before.logs.length).toBeGreaterThanOrEqual(2);

    await applyMigrations(db, { filter: (n) => n.startsWith('0003') });

    const after = await snap();
    expect(after.bom).toEqual(before.bom);
    expect(after.items).toEqual(before.items.map((r) => ({ ...r, unit_cost_vnd: null })));
    expect(after.logs).toEqual(
      before.logs.map((r) => ({ ...r, doc_type: null, doc_code: null, unit_cost_vnd: null, created_by: null })),
    );
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE order_code='OLD1'").first('n')).toBe(1);
    expect(
      (await db.prepare("SELECT name FROM sqlite_master WHERE substr(name, 1, 7) = '_m0003_'").all()).results,
    ).toEqual([]);

    const idx = (await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all()).results.map(
      (r) => r.name,
    );
    for (const name of [
      'idx_orders_status_created',
      'idx_orders_channel',
      'idx_orders_phone',
      'idx_orders_customer_created',
      'idx_order_items_order',
      'idx_inventory_logs_created',
      'idx_inventory_logs_sku_created',
      'idx_payments_order',
      'idx_stock_doc_lines_doc',
      'idx_quote_items_quote',
    ]) {
      expect(idx).toContain(name);
    }
  });

  it('0003 không dùng bảng TEMP (D1 từ xa), bảng trung gian _m0003_* bị xoá hết', async () => {
    const sql = readFileSync(join(process.cwd(), 'migrations', '0003_admin.sql'), 'utf8');
    expect(sql).not.toMatch(/\bTEMP(ORARY)?\s+TABLE\b/i);
    const created = [...sql.matchAll(/CREATE TABLE (_m0003_\w+)/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(3);
    const db = await freshDb();
    expect((await db.prepare("SELECT name FROM sqlite_master WHERE substr(name, 1, 7) = '_m0003_'").all()).results).toEqual([]);
  });

  it('seedProducts đặt tồn 100, giá vốn 50.000', async () => {
    const db = await freshDb();
    await seedProducts(db);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM products WHERE stock_qty=100 AND reserved_qty=0 AND cost_avg_vnd=50000')
        .first('n'),
    ).toBe(9);
  });
});
