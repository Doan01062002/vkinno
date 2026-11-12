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
    await expect(
      db.batch([
        db.prepare("UPDATE products SET stock_qty = 7 WHERE sku='VK-DEGREASER-500ML'"),
        db.prepare("UPDATE products SET stock_qty = -1 WHERE sku='VK-DEGREASER-500ML'"),
      ]),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await db.prepare("SELECT stock_qty FROM products WHERE sku='VK-DEGREASER-500ML'").first('stock_qty')).toBe(64);
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
