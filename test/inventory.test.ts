import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createTestD1 } from './d1-sqlite';
import { seedProducts } from './helpers';
import { ApiError } from '../worker/lib/http';
import {
  adjustStmts,
  availability,
  damagedLogStmts,
  directSaleOutStmts,
  expandToPhysical,
  issueStmts,
  receiveStmts,
  releaseStmts,
  reserveStmts,
  restockStmts,
  saleOutStmts,
  stockConflictMessage,
  stocktakeStmts,
  type DocRef,
} from '../worker/admin/inventory';

const DG = 'VK-DEGREASER-500ML';
const BM = 'VK-BOSSMAN-DESCALER-500ML';
const CW = 'VK-CLEARWAY-GLASSPRO-500ML';
const COMBO = 'VK-COMBO-BOSSMAN-VKINNO-500ML';

let db: D1Database;

beforeEach(async () => {
  db = createTestD1();
  await applyMigrations(db);
  await seedProducts(db);
  await db.prepare('DELETE FROM inventory_logs').run();
});

type Row = { stock_qty: number; reserved_qty: number; cost_avg_vnd: number };

function product(sku: string): Promise<Row | null> {
  return db.prepare('SELECT stock_qty, reserved_qty, cost_avg_vnd FROM products WHERE sku = ?').bind(sku).first<Row>();
}

async function logs(): Promise<Record<string, unknown>[]> {
  const res = await db
    .prepare(
      `SELECT sku, delta, stock_after, reason, ref_order_code, doc_type, doc_code, unit_cost_vnd, created_by
       FROM inventory_logs ORDER BY id`,
    )
    .all();
  return res.results;
}

async function createOrder(code: string, items: [string, number][]): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO orders (order_code, customer_name, customer_phone, shipping_address, subtotal_vnd, shipping_fee_vnd, total_amount)
       VALUES (?, 'A', '0900000000', 'HN', 0, 0, 0)`,
    )
    .bind(code)
    .run();
  const id = Number(res.meta.last_row_id);
  for (const [sku, qty] of items) {
    await db
      .prepare(
        `INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total) VALUES (?, ?, 'x', 0, ?, 0)`,
      )
      .bind(id, sku, qty)
      .run();
  }
  return id;
}

function orderRef(code: string): DocRef {
  return { docType: 'ORDER', docCode: code, userId: 7 };
}

describe('giữ / bỏ giữ', () => {
  it('giữ 3 → reserved 3, available 97, không ghi sổ', async () => {
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 3 }]));
    expect(await product(DG)).toMatchObject({ stock_qty: 100, reserved_qty: 3 });
    expect((await availability(db, [DG])).get(DG)).toEqual({ stock: 100, reserved: 3, available: 97, isCombo: false });
    expect(await logs()).toEqual([]);
  });

  it('giữ quá có thể bán → batch ném CHECK, dữ liệu không đổi', async () => {
    await expect(
      db.batch(reserveStmts(db, [{ sku: CW, qty: 5 }, { sku: DG, qty: 101 }])),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await product(CW)).toMatchObject({ reserved_qty: 0 });
    expect(await product(DG)).toMatchObject({ reserved_qty: 0 });
  });

  it('combo giữ 2 → mỗi thành phần reserved += 2 × qty_per_combo', async () => {
    await db.prepare('UPDATE bom_items SET qty_per_combo = 3 WHERE combo_sku = ? AND component_sku = ?').bind(COMBO, DG).run();
    await db.batch(reserveStmts(db, [{ sku: COMBO, qty: 2 }]));
    expect(await product(BM)).toMatchObject({ reserved_qty: 2 });
    expect(await product(DG)).toMatchObject({ reserved_qty: 6 });
    expect(await product(COMBO)).toMatchObject({ reserved_qty: 0, stock_qty: 100 });
  });

  it('bỏ giữ trả reserved về, kể cả combo', async () => {
    await db.batch(reserveStmts(db, [{ sku: COMBO, qty: 2 }, { sku: DG, qty: 1 }]));
    await db.batch(releaseStmts(db, [{ sku: COMBO, qty: 2 }, { sku: DG, qty: 1 }]));
    expect(await product(BM)).toMatchObject({ reserved_qty: 0 });
    expect(await product(DG)).toMatchObject({ reserved_qty: 0, stock_qty: 100 });
    expect(await logs()).toEqual([]);
  });

  it('số lượng không phải số nguyên dương → 422', () => {
    expect(() => reserveStmts(db, [{ sku: DG, qty: -1 }])).toThrow(ApiError);
    expect(() => reserveStmts(db, [{ sku: DG, qty: 1.5 }])).toThrow(ApiError);
  });
});

describe('xuất bán', () => {
  it('saleOut → stock 97, reserved 0, sổ SALE_OUT có unit_cost_vnd 50000, order_items.unit_cost_vnd đặt đúng (combo = tổng thành phần)', async () => {
    await db.prepare('UPDATE products SET cost_avg_vnd = 30000 WHERE sku = ?').bind(BM).run();
    await db.prepare('UPDATE products SET cost_avg_vnd = 45000 WHERE sku = ?').bind(DG).run();
    await db.prepare('UPDATE bom_items SET qty_per_combo = 2 WHERE combo_sku = ? AND component_sku = ?').bind(COMBO, DG).run();
    const id = await createOrder('VK000001', [[CW, 3], [COMBO, 1]]);
    await db.batch(reserveStmts(db, [{ sku: CW, qty: 3 }, { sku: COMBO, qty: 1 }]));

    await db.batch(await saleOutStmts(db, id, orderRef('VK000001')));

    expect(await product(CW)).toMatchObject({ stock_qty: 97, reserved_qty: 0 });
    expect(await product(BM)).toMatchObject({ stock_qty: 99, reserved_qty: 0 });
    expect(await product(DG)).toMatchObject({ stock_qty: 98, reserved_qty: 0 });
    expect(await product(COMBO)).toMatchObject({ stock_qty: 100, reserved_qty: 0 });
    const rows = await logs();
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual({
      sku: CW, delta: -3, stock_after: 97, reason: 'SALE_OUT', ref_order_code: 'VK000001',
      doc_type: 'ORDER', doc_code: 'VK000001', unit_cost_vnd: 50000, created_by: 7,
    });
    expect(rows).toContainEqual(expect.objectContaining({ sku: DG, delta: -2, stock_after: 98, unit_cost_vnd: 45000 }));
    expect(rows).toContainEqual(expect.objectContaining({ sku: BM, delta: -1, stock_after: 99, unit_cost_vnd: 30000 }));
    const items = await db.prepare('SELECT sku, unit_cost_vnd FROM order_items WHERE order_id = ? ORDER BY id').bind(id).all();
    expect(items.results).toEqual([
      { sku: CW, unit_cost_vnd: 50000 },
      { sku: COMBO, unit_cost_vnd: 30000 + 2 * 45000 },
    ]);
    expect(await db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').bind(id).first('stock_deducted')).toBe(1);
  });

  it('saleOut gộp SKU trùng giữa combo và dòng lẻ thành một dòng sổ', async () => {
    const id = await createOrder('VK000002', [[DG, 2], [COMBO, 1]]);
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 2 }, { sku: COMBO, qty: 1 }]));
    await db.batch(await saleOutStmts(db, id, orderRef('VK000002')));
    expect(await product(DG)).toMatchObject({ stock_qty: 97, reserved_qty: 0 });
    expect((await logs()).filter((r) => r.sku === DG)).toEqual([expect.objectContaining({ delta: -3, stock_after: 97 })]);
  });

  it('giá vốn lấy lúc batch chạy, không lấy lúc dựng câu lệnh', async () => {
    const id = await createOrder('VK000003', [[DG, 1]]);
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 1 }]));
    const stmts = await saleOutStmts(db, id, orderRef('VK000003'));
    await db.batch(receiveStmts(db, [{ sku: DG, qty: 100, unitCost: 70000 }], { docType: 'RECEIPT', docCode: 'PN1', userId: 1 }));
    await db.batch(stmts);
    expect((await logs()).find((r) => r.reason === 'SALE_OUT')).toMatchObject({ unit_cost_vnd: 60000, stock_after: 199 });
    expect(await db.prepare('SELECT unit_cost_vnd FROM order_items WHERE order_id = ?').bind(id).first('unit_cost_vnd')).toBe(60000);
  });

  it('saleOut chạy lần hai cho cùng đơn không trừ thêm', async () => {
    const id = await createOrder('VK000004', [[DG, 2]]);
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 2 }]));
    const first = await saleOutStmts(db, id, orderRef('VK000004'));
    const second = await saleOutStmts(db, id, orderRef('VK000004'));
    await db.batch(first);
    await db.batch(second);
    expect(await product(DG)).toMatchObject({ stock_qty: 98, reserved_qty: 0 });
    expect(await logs()).toHaveLength(1);
  });

  it('hai batch saleOut tranh món cuối (stock 1, reserved 1, hai đơn) → đúng 1 thành công', async () => {
    await db.prepare('UPDATE products SET stock_qty = 1, reserved_qty = 1 WHERE sku = ?').bind(DG).run();
    const a = await createOrder('VK00000A', [[DG, 1]]);
    const b = await createOrder('VK00000B', [[DG, 1]]);
    const stmtsA = await saleOutStmts(db, a, orderRef('VK00000A'));
    const stmtsB = await saleOutStmts(db, b, orderRef('VK00000B'));
    const results = await Promise.allSettled([db.batch(stmtsA), db.batch(stmtsB)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/CHECK constraint failed/);
    expect(await product(DG)).toMatchObject({ stock_qty: 0, reserved_qty: 0 });
    expect(await logs()).toHaveLength(1);
    const deducted = await db.prepare('SELECT SUM(stock_deducted) AS n FROM orders').first('n');
    expect(deducted).toBe(1);
  });

  it('directSaleOut trừ tồn, không đụng reserved', async () => {
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 5 }]));
    const id = await createOrder('VK000005', [[DG, 2], [COMBO, 1]]);
    await db.batch(await directSaleOutStmts(db, id, orderRef('VK000005')));
    expect(await product(DG)).toMatchObject({ stock_qty: 97, reserved_qty: 5 });
    expect(await product(BM)).toMatchObject({ stock_qty: 99, reserved_qty: 0 });
    expect(await logs()).toContainEqual(expect.objectContaining({ sku: DG, delta: -3, reason: 'SALE_OUT', unit_cost_vnd: 50000 }));
    expect(await db.prepare('SELECT stock_deducted FROM orders WHERE id = ?').bind(id).first('stock_deducted')).toBe(1);
  });

  it('directSaleOut với orderId null tìm đơn theo mã trong cùng batch tạo đơn', async () => {
    const insertOrder = db
      .prepare(
        `INSERT INTO orders (order_code, customer_name, customer_phone, shipping_address, subtotal_vnd, shipping_fee_vnd, total_amount)
         VALUES ('VK000006', 'A', '0900000000', 'HN', 0, 0, 0)`,
      );
    const insertItem = db
      .prepare(
        `INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total)
         VALUES ((SELECT id FROM orders WHERE order_code = 'VK000006'), ?, 'x', 0, 4, 0)`,
      )
      .bind(DG);
    await db.batch([insertOrder, insertItem, ...(await directSaleOutStmts(db, null, orderRef('VK000006')))]);
    expect(await product(DG)).toMatchObject({ stock_qty: 96 });
    expect(await logs()).toEqual([expect.objectContaining({ sku: DG, delta: -4, ref_order_code: 'VK000006' })]);
    expect(await db.prepare("SELECT stock_deducted FROM orders WHERE order_code = 'VK000006'").first('stock_deducted')).toBe(1);
  });
});

describe('nhập / xuất khác / điều chỉnh', () => {
  const receipt: DocRef = { docType: 'RECEIPT', docCode: 'PN261112-AAAA', userId: 1 };

  it('nhập 2 lần: 100@50000 rồi 100@70000 → cost_avg 60000', async () => {
    await db.prepare('UPDATE products SET stock_qty = 0, cost_avg_vnd = 0 WHERE sku = ?').bind(DG).run();
    await db.batch(receiveStmts(db, [{ sku: DG, qty: 100, unitCost: 50000 }], receipt));
    await db.batch(receiveStmts(db, [{ sku: DG, qty: 100, unitCost: 70000 }], receipt));
    expect(await product(DG)).toMatchObject({ stock_qty: 200, cost_avg_vnd: 60000 });
    expect(await logs()).toEqual([
      { sku: DG, delta: 100, stock_after: 100, reason: 'RECEIPT', ref_order_code: '', doc_type: 'RECEIPT', doc_code: 'PN261112-AAAA', unit_cost_vnd: 50000, created_by: 1 },
      { sku: DG, delta: 100, stock_after: 200, reason: 'RECEIPT', ref_order_code: '', doc_type: 'RECEIPT', doc_code: 'PN261112-AAAA', unit_cost_vnd: 70000, created_by: 1 },
    ]);
  });

  it('nhập khi tồn 0 → cost_avg = đơn giá', async () => {
    await db.prepare('UPDATE products SET stock_qty = 0, cost_avg_vnd = 50000 WHERE sku = ?').bind(DG).run();
    await db.batch(receiveStmts(db, [{ sku: DG, qty: 7, unitCost: 42000 }], receipt));
    expect(await product(DG)).toMatchObject({ stock_qty: 7, cost_avg_vnd: 42000 });
  });

  it('nhập vào combo bị từ chối, cả batch huỷ', async () => {
    await expect(
      db.batch(receiveStmts(db, [{ sku: DG, qty: 1, unitCost: 1 }, { sku: COMBO, qty: 1, unitCost: 1 }], receipt)),
    ).rejects.toThrow(/NOT NULL constraint failed/);
    expect(await product(DG)).toMatchObject({ stock_qty: 100 });
  });

  it('issue trừ tồn và ghi sổ ISSUE', async () => {
    await db.batch(issueStmts(db, [{ sku: DG, qty: 4 }], { docType: 'ISSUE', docCode: 'PX1', userId: 2 }));
    expect(await product(DG)).toMatchObject({ stock_qty: 96 });
    expect(await logs()).toEqual([
      expect.objectContaining({ sku: DG, delta: -4, stock_after: 96, reason: 'ISSUE', doc_code: 'PX1', unit_cost_vnd: 50000 }),
    ]);
  });

  it('issue làm stock < reserved → CHECK ném', async () => {
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 98 }]));
    await expect(
      db.batch(issueStmts(db, [{ sku: DG, qty: 3 }], { docType: 'ISSUE', docCode: 'PX1', userId: 2 })),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await product(DG)).toMatchObject({ stock_qty: 100, reserved_qty: 98 });
    expect(await logs()).toEqual([]);
  });

  it('adjust cộng/trừ theo delta với lý do ADJUST hoặc STOCKTAKE', async () => {
    await db.batch(adjustStmts(db, [{ sku: DG, delta: -5 }, { sku: CW, delta: 20 }], 'STOCKTAKE', { docType: 'STOCKTAKE', docCode: 'KK1', userId: 3 }));
    expect(await product(DG)).toMatchObject({ stock_qty: 95 });
    expect(await product(CW)).toMatchObject({ stock_qty: 120 });
    expect(await logs()).toEqual([
      expect.objectContaining({ sku: DG, delta: -5, stock_after: 95, reason: 'STOCKTAKE', doc_type: 'STOCKTAKE' }),
      expect.objectContaining({ sku: CW, delta: 20, stock_after: 120, reason: 'STOCKTAKE' }),
    ]);
  });
});

describe('hoàn kho / hàng hỏng', () => {
  it('restock RETURN_RESTOCK cộng tồn; damaged chỉ ghi sổ delta 0', async () => {
    const ref: DocRef = { docType: 'RETURN', docCode: 'VK000009', userId: 4 };
    await db.batch(restockStmts(db, [{ sku: DG, qty: 2 }], 'RETURN_RESTOCK', ref));
    await db.batch(damagedLogStmts(db, [{ sku: COMBO, qty: 1 }], ref));
    expect(await product(DG)).toMatchObject({ stock_qty: 102 });
    expect(await product(BM)).toMatchObject({ stock_qty: 100 });
    const rows = await logs();
    expect(rows[0]).toEqual({
      sku: DG, delta: 2, stock_after: 102, reason: 'RETURN_RESTOCK', ref_order_code: 'VK000009',
      doc_type: 'RETURN', doc_code: 'VK000009', unit_cost_vnd: 50000, created_by: 4,
    });
    expect(rows.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: BM, delta: 0, stock_after: 100, reason: 'RETURN_DAMAGED' }),
        expect.objectContaining({ sku: DG, delta: 0, stock_after: 102, reason: 'RETURN_DAMAGED' }),
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it('restock CANCEL_RESTOCK của combo cộng vào thành phần', async () => {
    await db.batch(restockStmts(db, [{ sku: COMBO, qty: 3 }], 'CANCEL_RESTOCK', orderRef('VK000010')));
    expect(await product(BM)).toMatchObject({ stock_qty: 103 });
    expect(await product(DG)).toMatchObject({ stock_qty: 103 });
    expect(await product(COMBO)).toMatchObject({ stock_qty: 100 });
  });
});

describe('expandToPhysical / availability / thông báo', () => {
  it('expandToPhysical tách combo và gộp SKU trùng', async () => {
    expect(await expandToPhysical(db, [{ sku: DG, qty: 2 }, { sku: COMBO, qty: 3 }, { sku: CW, qty: 1 }])).toEqual([
      { sku: DG, qty: 5 },
      { sku: BM, qty: 3 },
      { sku: CW, qty: 1 },
    ]);
  });

  it('expandToPhysical với SKU lạ → 422 UNKNOWN_SKU', async () => {
    const err = await expandToPhysical(db, [{ sku: 'KHONG-CO', qty: 1 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'UNKNOWN_SKU' });
  });

  it('expandToPhysical với SKU ngừng bán → 422 UNKNOWN_SKU', async () => {
    await db.prepare('UPDATE products SET is_active = 0 WHERE sku = ?').bind(DG).run();
    await expect(expandToPhysical(db, [{ sku: DG, qty: 1 }])).rejects.toMatchObject({ status: 422, code: 'UNKNOWN_SKU' });
  });

  it('availability combo = min ⌊available/qty_per_combo⌋', async () => {
    await db.prepare('UPDATE bom_items SET qty_per_combo = 3 WHERE combo_sku = ? AND component_sku = ?').bind(COMBO, DG).run();
    await db.batch(reserveStmts(db, [{ sku: BM, qty: 10 }]));
    const map = await availability(db, [COMBO]);
    expect([...map.keys()]).toEqual([COMBO]);
    expect(map.get(COMBO)).toMatchObject({ available: 33, isCombo: true });

    await db.batch(reserveStmts(db, [{ sku: BM, qty: 80 }]));
    expect((await availability(db)).get(COMBO)).toMatchObject({ available: 10, isCombo: true });
    expect((await availability(db)).get(BM)).toEqual({ stock: 100, reserved: 90, available: 10, isCombo: false });
  });

  it('stockConflictMessage nêu tên sản phẩm lẻ thiếu hàng và số còn bán được', async () => {
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 98 }]));
    const name = await db.prepare('SELECT name FROM products WHERE sku = ?').bind(DG).first<string>('name');
    expect(await stockConflictMessage(db, [{ sku: CW, qty: 1 }, { sku: DG, qty: 5 }])).toBe(
      `Sản phẩm ${name} chỉ còn 2 có thể bán`,
    );
  });

  it('stockConflictMessage với dòng combo nêu tên combo và số combo còn bán được', async () => {
    await db.batch(reserveStmts(db, [{ sku: DG, qty: 98 }]));
    const name = await db.prepare('SELECT name FROM products WHERE sku = ?').bind(COMBO).first<string>('name');
    expect(await stockConflictMessage(db, [{ sku: COMBO, qty: 3 }])).toBe(`Sản phẩm ${name} chỉ còn 2 có thể bán`);
  });
});

describe('kiểm kê', () => {
  const kkRef: DocRef = { docType: 'STOCKTAKE', docCode: 'KK261112-TEST', userId: 7 };

  async function draftDoc(skus: string[]): Promise<void> {
    await db.prepare("INSERT INTO stock_docs (code, type) VALUES ('KK261112-TEST', 'STOCKTAKE')").run();
    for (const sku of skus) {
      await db
        .prepare(
          "INSERT INTO stock_doc_lines (doc_id, sku, counted_qty) VALUES ((SELECT id FROM stock_docs WHERE code = 'KK261112-TEST'), ?, 0)",
        )
        .bind(sku)
        .run();
    }
  }
  const systemQty = (sku: string) =>
    db.prepare('SELECT system_qty FROM stock_doc_lines WHERE sku = ?').bind(sku).first<{ system_qty: number | null }>();

  it('đếm 120 khi tồn 100 → stock 120, sổ STOCKTAKE delta +20 stock_after 120, system_qty 100', async () => {
    await draftDoc([DG]);
    await db.batch(stocktakeStmts(db, [{ sku: DG, counted: 120 }], kkRef));
    expect(await product(DG)).toMatchObject({ stock_qty: 120, reserved_qty: 0 });
    expect(await logs()).toEqual([
      {
        sku: DG, delta: 20, stock_after: 120, reason: 'STOCKTAKE', ref_order_code: '',
        doc_type: 'STOCKTAKE', doc_code: 'KK261112-TEST', unit_cost_vnd: 50000, created_by: 7,
      },
    ]);
    expect(await systemQty(DG)).toEqual({ system_qty: 100 });
  });

  it('dòng không chênh lệch → không ghi sổ nhưng vẫn lưu system_qty', async () => {
    await draftDoc([DG]);
    await db.batch(stocktakeStmts(db, [{ sku: DG, counted: 100 }], kkRef));
    expect(await logs()).toEqual([]);
    expect(await systemQty(DG)).toEqual({ system_qty: 100 });
  });

  it('bán xuất xen giữa lúc dựng và lúc chạy → delta tính theo tồn lúc chạy', async () => {
    await draftDoc([DG]);
    const stmts = stocktakeStmts(db, [{ sku: DG, counted: 90 }], kkRef);
    await db.prepare('UPDATE products SET stock_qty = 95 WHERE sku = ?').bind(DG).run();
    await db.batch(stmts);
    expect(await product(DG)).toMatchObject({ stock_qty: 90 });
    expect(await logs()).toMatchObject([{ delta: -5, stock_after: 90 }]);
    expect(await systemQty(DG)).toEqual({ system_qty: 95 });
  });

  it('đếm thấp hơn reserved → CHECK, rollback cả system_qty và sổ', async () => {
    await draftDoc([DG, CW]);
    await db.prepare('UPDATE products SET reserved_qty = 3 WHERE sku = ?').bind(DG).run();
    await expect(
      db.batch(stocktakeStmts(db, [{ sku: CW, counted: 50 }, { sku: DG, counted: 2 }], kkRef)),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await product(CW)).toMatchObject({ stock_qty: 100 });
    expect(await product(DG)).toMatchObject({ stock_qty: 100, reserved_qty: 3 });
    expect(await logs()).toEqual([]);
    expect(await systemQty(CW)).toEqual({ system_qty: null });
  });

  it('số đếm không hợp lệ → 422', () => {
    expect(() => stocktakeStmts(db, [{ sku: DG, counted: -1 }], kkRef)).toThrow(ApiError);
    expect(() => stocktakeStmts(db, [{ sku: DG, counted: 1.5 }], kkRef)).toThrow(ApiError);
  });
});
