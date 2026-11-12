import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const BM = 'VK-BOSSMAN-DESCALER-500ML';
const COMBO = 'VK-COMBO-BOSSMAN-VKINNO-500ML';

let env: Env;
let admin: { id: number };
let staff: { id: number };

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
  await env.DB.prepare('DELETE FROM inventory_logs').run();
  admin = await createUser(env.DB, 'ADMIN');
  staff = await createUser(env.DB, 'STAFF');
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function send(path: string, method = 'GET', body?: unknown, user = admin): Promise<{ status: number; json: Json }> {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, user);
  return { status: res.status, json: (await res.json()) as Json };
}

async function makeOrder(over: Record<string, unknown>): Promise<any> {
  const r = await send('/orders', 'POST', {
    channel: 'WEB',
    customer: { phone: '0912345678', name: 'Chị Lan' },
    shipping_address: '12 Lê Lợi, Q1',
    shipping_fee_vnd: 30000,
    payment_method: 'COD',
    ...over,
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.data;
}

async function transition(id: number, to: string, lines?: unknown) {
  const r = await send(`/orders/${id}/transition`, 'POST', lines === undefined ? { to } : { to, lines });
  expect(r.status, `${to}: ${JSON.stringify(r.json)}`).toBe(200);
}

/** Đặt thời điểm (UTC) cho các dòng sổ kho của một đơn theo điều kiện lý do. */
const stamp = (code: string, reasonLike: string, at: string) =>
  env.DB.prepare('UPDATE inventory_logs SET created_at = ? WHERE ref_order_code = ? AND reason LIKE ?')
    .bind(at, code, reasonLike)
    .run();

/**
 * Bộ dữ liệu cố định (giá vốn 50.000):
 *  A WEB  : 2 × DG @100.000                      → bán 08/03 (VN), doanh thu 200.000, vốn 100.000
 *  B B2B  : 1 × DG @150.000 + 2 × BM @70.000, giảm 10.000
 *           → bán 11/03 (VN; 20:00 UTC ngày 10 = 03:00 ngày 11), doanh thu 280.000, vốn 150.000
 *  C WEB  : 3 × DG @90.000                       → bán 12/03, trả 13/03: doanh thu 270.000, vốn 150.000
 */
async function seedSales() {
  const a = await makeOrder({ items: [{ sku: DG, quantity: 2, unit_price: 100000 }] });
  const b = await makeOrder({
    channel: 'B2B',
    items: [
      { sku: DG, quantity: 1, unit_price: 150000 },
      { sku: BM, quantity: 2, unit_price: 70000 },
    ],
    discount_vnd: 10000,
  });
  const c = await makeOrder({ items: [{ sku: DG, quantity: 3, unit_price: 90000 }] });
  for (const o of [a, b, c]) await transition(o.id, 'PACKED');
  await transition(c.id, 'SHIPPING');
  await transition(c.id, 'COMPLETED');
  await transition(c.id, 'RETURNED', [{ order_item_id: c.items[0].id, action: 'RESTOCK' }]);
  await stamp(a.order_code, 'SALE_OUT', '2026-03-08 05:00:00');
  await stamp(b.order_code, 'SALE_OUT', '2026-03-10 20:00:00');
  await stamp(c.order_code, 'SALE_OUT', '2026-03-12 02:00:00');
  await stamp(c.order_code, 'RETURN%', '2026-03-13 03:00:00');
  return { a, b, c };
}

const sales = (qs: string, user = admin) => send(`/reports/sales?${qs}`, 'GET', undefined, user);
const RANGE = 'from=2026-03-01&to=2026-03-31';

describe('báo cáo bán hàng', () => {
  it('revenue/cost/profit theo ngày đúng tới từng đồng', async () => {
    await seedSales();
    const r = await sales(`${RANGE}&group=day`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data).toEqual([
      { key: '2026-03-08', orders: 1, returns: 0, revenue_vnd: 200000, cost_total_vnd: 100000, gross_profit_vnd: 100000, gross_margin: 0.5 },
      { key: '2026-03-11', orders: 1, returns: 0, revenue_vnd: 280000, cost_total_vnd: 150000, gross_profit_vnd: 130000, gross_margin: 0.4643 },
      { key: '2026-03-12', orders: 1, returns: 0, revenue_vnd: 270000, cost_total_vnd: 150000, gross_profit_vnd: 120000, gross_margin: 0.4444 },
      { key: '2026-03-13', orders: 0, returns: 1, revenue_vnd: -270000, cost_total_vnd: -150000, gross_profit_vnd: -120000, gross_margin: 0.4444 },
    ]);
  });

  it('đơn bị trả hàng trừ doanh thu và giá vốn vào ngày trả', async () => {
    await seedSales();
    const day = await sales('from=2026-03-13&to=2026-03-13&group=day');
    expect(day.json.data).toHaveLength(1);
    expect(day.json.data[0]).toMatchObject({ key: '2026-03-13', revenue_vnd: -270000, cost_total_vnd: -150000 });
    const before = await sales('from=2026-03-12&to=2026-03-12&group=day');
    expect(before.json.data[0]).toMatchObject({ revenue_vnd: 270000 });
  });

  it('đơn huỷ sau khi xuất kho trừ vào ngày huỷ', async () => {
    const o = await makeOrder({ items: [{ sku: DG, quantity: 2, unit_price: 100000 }] });
    await transition(o.id, 'PACKED');
    await transition(o.id, 'CANCELLED');
    await stamp(o.order_code, 'SALE_OUT', '2026-03-05 03:00:00');
    await stamp(o.order_code, 'CANCEL_RESTOCK', '2026-03-06 03:00:00');
    const r = await sales(`${RANGE}&group=day`);
    expect(r.json.data).toEqual([
      { key: '2026-03-05', orders: 1, returns: 0, revenue_vnd: 200000, cost_total_vnd: 100000, gross_profit_vnd: 100000, gross_margin: 0.5 },
      { key: '2026-03-06', orders: 0, returns: 1, revenue_vnd: -200000, cost_total_vnd: -100000, gross_profit_vnd: -100000, gross_margin: 0.5 },
    ]);
  });

  it('group=channel tách WEB và B2B', async () => {
    await seedSales();
    const r = await sales(`${RANGE}&group=channel`);
    expect(r.json.data).toEqual([
      { key: 'B2B', orders: 1, returns: 0, revenue_vnd: 280000, cost_total_vnd: 150000, gross_profit_vnd: 130000, gross_margin: 0.4643 },
      { key: 'WEB', orders: 2, returns: 1, revenue_vnd: 200000, cost_total_vnd: 100000, gross_profit_vnd: 100000, gross_margin: 0.5 },
    ]);
  });

  it('group=week (ISO, thứ Hai đầu tuần) và group=month', async () => {
    await seedSales();
    const week = await sales(`${RANGE}&group=week`);
    // 08/03/2026 là Chủ nhật → tuần 10; 11–13/03 → tuần 11.
    expect(week.json.data.map((x: any) => [x.key, x.orders, x.revenue_vnd])).toEqual([
      ['2026-W10', 1, 200000],
      ['2026-W11', 2, 280000],
    ]);
    const month = await sales(`${RANGE}&group=month`);
    expect(month.json.data).toEqual([
      { key: '2026-03', orders: 3, returns: 1, revenue_vnd: 480000, cost_total_vnd: 250000, gross_profit_vnd: 230000, gross_margin: 0.4792 },
    ]);
  });

  it('group=product phân bổ giảm giá, tổng sản phẩm = tổng theo ngày', async () => {
    await seedSales();
    const prod = await sales(`${RANGE}&group=product`);
    const byKey = Object.fromEntries(prod.json.data.map((x: any) => [x.key, x]));
    // Giảm 10.000 chia theo 150.000 / 140.000: 5.172 + 4.827, dư 1 vào dòng lớn nhất (DG).
    expect(byKey[DG]).toMatchObject({ name: expect.any(String), revenue_vnd: 344827, cost_total_vnd: 150000 });
    expect(byKey[BM]).toMatchObject({ revenue_vnd: 135173, cost_total_vnd: 100000 });
    const days = (await sales(`${RANGE}&group=day`)).json.data;
    const sum = (rows: any[], k: string) => rows.reduce((s, x) => s + x[k], 0);
    for (const k of ['revenue_vnd', 'cost_total_vnd', 'gross_profit_vnd']) {
      expect(sum(prod.json.data, k), k).toBe(sum(days, k));
    }
  });

  it('ranh giới ngày VN: log lúc 23:59:59 thuộc ngày trước; đơn lệch 1 giây qua nửa đêm tính đúng một lần', async () => {
    const x = await makeOrder({ items: [{ sku: DG, quantity: 1, unit_price: 100000 }] });
    await transition(x.id, 'PACKED');
    await stamp(x.order_code, 'SALE_OUT', '2026-03-09 16:59:59'); // VN 09/03 23:59:59
    const y = await makeOrder({
      items: [
        { sku: DG, quantity: 1, unit_price: 100000 },
        { sku: BM, quantity: 1, unit_price: 70000 },
      ],
    });
    await transition(y.id, 'PACKED');
    const at = (sku: string, t: string) =>
      env.DB.prepare("UPDATE inventory_logs SET created_at = ? WHERE ref_order_code = ? AND reason = 'SALE_OUT' AND sku = ?")
        .bind(t, y.order_code, sku)
        .run();
    await at(DG, '2026-03-09 16:59:59'); // VN 09/03 23:59:59
    await at(BM, '2026-03-09 17:00:00'); // VN 10/03 00:00:00

    const d9 = (await sales('from=2026-03-09&to=2026-03-09&group=day')).json.data;
    const d10 = (await sales('from=2026-03-10&to=2026-03-10&group=day')).json.data;
    expect(d10).toEqual([]);
    expect(d9).toMatchObject([{ key: '2026-03-09', orders: 2, revenue_vnd: 270000 }]);
    // Hai khoảng một ngày liền kề: tổng số đơn = 2, mỗi đơn đúng một lần.
    expect(d9.reduce((n: number, r: any) => n + r.orders, 0) + d10.reduce((n: number, r: any) => n + r.orders, 0)).toBe(2);
  });

  it('group=product: dòng trùng SKU trong một đơn chỉ tính một lần vào orders/returns', async () => {
    const o = await makeOrder({
      items: [
        { sku: DG, quantity: 1, unit_price: 100000 },
        { sku: DG, quantity: 2, unit_price: 90000 },
      ],
    });
    await transition(o.id, 'PACKED');
    await transition(o.id, 'SHIPPING');
    await transition(o.id, 'COMPLETED');
    await transition(
      o.id,
      'RETURNED',
      o.items.map((i: any) => ({ order_item_id: i.id, action: 'RESTOCK' })),
    );
    await stamp(o.order_code, 'SALE_OUT', '2026-03-05 03:00:00');
    await stamp(o.order_code, 'RETURN%', '2026-03-06 03:00:00');
    const rows = (await sales(`${RANGE}&group=product`)).json.data;
    expect(rows).toMatchObject([{ key: DG, orders: 1, returns: 1, revenue_vnd: 0, cost_total_vnd: 0 }]);
  });

  it('đơn combo: doanh thu và giá vốn đúng, không tính hai lần', async () => {
    const o = await makeOrder({ items: [{ sku: COMBO, quantity: 2, unit_price: 500000 }] });
    await transition(o.id, 'PACKED');
    await stamp(o.order_code, 'SALE_OUT', '2026-03-09 03:00:00');
    // Combo = 1 BM + 1 DG (giá vốn 50.000 mỗi chai) → vốn 100.000/combo.
    const r = await sales(`${RANGE}&group=day`);
    expect(r.json.data).toEqual([
      { key: '2026-03-09', orders: 1, returns: 0, revenue_vnd: 1000000, cost_total_vnd: 200000, gross_profit_vnd: 800000, gross_margin: 0.8 },
    ]);
    const prod = (await sales(`${RANGE}&group=product`)).json.data;
    expect(prod).toMatchObject([{ key: COMBO, orders: 1, revenue_vnd: 1000000, cost_total_vnd: 200000 }]);
  });

  it('khoảng ngày sai → 422', async () => {
    for (const qs of [
      'from=2026-03-10&to=2026-03-09&group=day',
      'from=2026-01-01&to=2027-01-02&group=day', // 367 ngày
      'from=2026-02-30&to=2026-03-01&group=day',
      'from=2026-03-01&group=day',
      'from=2026-03-01&to=2026-03-02&group=year',
    ]) {
      expect((await sales(qs)).status, qs).toBe(422);
    }
    expect((await sales('from=2025-12-31&to=2026-12-31&group=day')).status).toBe(200); // đúng 366 ngày
  });

  it('STAFF gọi sales / top-products → 403', async () => {
    expect((await sales(`${RANGE}&group=day`, staff)).status).toBe(403);
    expect((await send(`/reports/top-products?${RANGE}`, 'GET', undefined, staff)).status).toBe(403);
  });
});

describe('top sản phẩm', () => {
  it('xếp theo số lượng bán ròng sau trả hàng, có doanh thu phân bổ', async () => {
    await seedSales();
    const r = await send(`/reports/top-products?${RANGE}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // DG: 2 + 1 + 3 − 3 = 3; BM: 2.
    expect(r.json.data).toMatchObject([
      { sku: DG, quantity: 3, revenue_vnd: 344827 },
      { sku: BM, quantity: 2, revenue_vnd: 135173 },
    ]);
    const one = await send(`/reports/top-products?${RANGE}&limit=1`);
    expect(one.json.data).toHaveLength(1);
    expect((await send(`/reports/top-products?${RANGE}&limit=101`)).status).toBe(422);
  });
});

describe('nhập - xuất - tồn', () => {
  async function seedMovements() {
    await seedSales();
    const combo = await makeOrder({ items: [{ sku: COMBO, quantity: 2, unit_price: 500000 }] });
    await transition(combo.id, 'PACKED');
    await stamp(combo.order_code, 'SALE_OUT', '2026-03-09 03:00:00');
    const doc = async (body: unknown, at: string) => {
      const c = await send('/stock-docs', 'POST', body);
      expect(c.status, JSON.stringify(c.json)).toBe(201);
      const p = await send(`/stock-docs/${c.json.data.id}/post`, 'POST', {});
      expect(p.status, JSON.stringify(p.json)).toBe(200);
      await env.DB.prepare('UPDATE inventory_logs SET created_at = ? WHERE doc_code = ?').bind(at, c.json.data.code).run();
    };
    await doc({ type: 'RECEIPT', lines: [{ sku: DG, qty: 20, unit_cost_vnd: 60000 }] }, '2026-03-02 03:00:00');
    await doc({ type: 'ISSUE', lines: [{ sku: BM, qty: 3 }] }, '2026-03-14 03:00:00');
    await doc({ type: 'ADJUST', lines: [{ sku: DG, qty: -2 }] }, '2026-03-15 03:00:00');
    await doc({ type: 'STOCKTAKE', lines: [{ sku: BM, counted_qty: 90 }] }, '2026-03-16 03:00:00');
  }

  const rowsOf = async (qs: string, user = admin) => {
    const r = await send(`/reports/stock-movement?${qs}`, 'GET', undefined, user);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.data as any[];
  };
  const stockOf = async (sku: string) =>
    (await env.DB.prepare('SELECT stock_qty FROM products WHERE sku = ?').bind(sku).first<{ stock_qty: number }>())!.stock_qty;

  it('tồn đầu + nhập − xuất bán − xuất khác + điều chỉnh = tồn cuối với mọi SKU', async () => {
    await seedMovements();
    for (const qs of [RANGE, 'from=2026-03-08&to=2026-03-13', 'from=2026-03-14&to=2026-03-20', 'from=2026-04-01&to=2026-04-02']) {
      const rows = await rowsOf(qs);
      expect(rows.length).toBeGreaterThan(5);
      for (const x of rows) {
        expect(x.opening + x.received - x.sold_out - x.other_out + x.adjusted, `${qs} ${x.sku}`).toBe(x.closing);
      }
    }
  });

  it('số liệu từng cột đúng, combo không xuất hiện, SKU không có sổ vẫn có tồn', async () => {
    await seedMovements();
    const rows = await rowsOf(RANGE);
    const by = Object.fromEntries(rows.map((x) => [x.sku, x]));
    expect(by[COMBO]).toBeUndefined();
    // DG: bán A2 + B1 + C3 − trả 3 + combo 2 = 5 ròng; nhập 20; điều chỉnh −2 → 100 + 20 − 5 − 2.
    expect(by[DG]).toEqual({ sku: DG, name: expect.any(String), opening: 100, received: 20, sold_out: 5, other_out: 0, adjusted: -2, closing: 113 });
    // BM: bán B2 + thành phần combo 2 = 4; xuất khác 3; kiểm kê 93 → 90 là điều chỉnh −3.
    expect(by[BM]).toEqual({ sku: BM, name: expect.any(String), opening: 100, received: 0, sold_out: 4, other_out: 3, adjusted: -3, closing: 90 });
    expect(await stockOf(DG)).toBe(113);
    expect(await stockOf(BM)).toBe(90);
    const untouched = rows.find((x) => x.sku !== DG && x.sku !== BM && x.sold_out === 0 && x.received === 0);
    expect(untouched).toMatchObject({ opening: 100, closing: 100 });
    const early = Object.fromEntries((await rowsOf('from=2026-01-01&to=2026-01-31')).map((x) => [x.sku, x]));
    expect(early[DG]).toMatchObject({ opening: 100, closing: 100, received: 0, sold_out: 0 });
  });

  it('xuất bán là số ròng sau trả hàng', async () => {
    await seedMovements();
    const by = Object.fromEntries((await rowsOf('from=2026-03-12&to=2026-03-13')).map((x) => [x.sku, x]));
    // 12/03 bán 3, 13/03 trả 3 vào kho → ròng 0.
    expect(by[DG].sold_out).toBe(0);
  });

  it('STAFF xem được, không có khoá tiền', async () => {
    await seedMovements();
    const r = await send(`/reports/stock-movement?${RANGE}`, 'GET', undefined, staff);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/_vnd|cost|profit|margin|revenue/);
    expect(Object.keys(r.json.data[0]).sort()).toEqual([
      'adjusted',
      'closing',
      'name',
      'opening',
      'other_out',
      'received',
      'sku',
      'sold_out',
    ]);
  });
});

describe('dashboard', () => {
  it('ADMIN: doanh thu hôm nay/tháng, đơn theo trạng thái, cảnh báo, SePay chưa khớp', async () => {
    const o = await makeOrder({ items: [{ sku: DG, quantity: 2, unit_price: 100000 }] });
    await makeOrder({ items: [{ sku: DG, quantity: 1, unit_price: 100000 }] });
    await transition(o.id, 'PACKED');
    await env.DB.prepare('UPDATE products SET min_stock = 1000 WHERE sku = ?').bind(BM).run();
    await env.DB.prepare(
      `INSERT INTO sepay_webhook_logs (sepay_tx_id, gateway, account_number, transfer_type, transfer_amount, match_status, raw_payload)
       VALUES (1,'VCB','1','in',1000,'UNMATCHED','{}'), (2,'VCB','1','in',1000,'PAID','{}'), (3,'VCB','1','in',1000,'UNMATCHED','{}')`,
    ).run();
    const alerts = await send('/inventory/alerts');

    const r = await send('/reports/dashboard');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data).toMatchObject({
      today_revenue_vnd: 200000,
      month_revenue_vnd: 200000,
      orders_by_status: { PENDING: 1, PACKED: 1 },
      pending_orders: 1,
      sepay_unmatched: 2,
      alerts_count: alerts.json.data.low_stock.length + alerts.json.data.expiring.length,
    });
    expect(r.json.data.alerts_count).toBeGreaterThan(0);
  });

  it('doanh thu của tháng trước không tính vào hôm nay/tháng này', async () => {
    const o = await makeOrder({ items: [{ sku: DG, quantity: 1, unit_price: 100000 }] });
    await transition(o.id, 'PACKED');
    await env.DB.prepare("UPDATE inventory_logs SET created_at = datetime('now','-40 days')").run();
    const r = await send('/reports/dashboard');
    expect(r.json.data).toMatchObject({ today_revenue_vnd: 0, month_revenue_vnd: 0 });
  });

  it('STAFF nhận dashboard không có khoá doanh thu', async () => {
    const o = await makeOrder({ items: [{ sku: DG, quantity: 1, unit_price: 100000 }] });
    await transition(o.id, 'PACKED');
    const r = await send('/reports/dashboard', 'GET', undefined, staff);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/revenue|cost|profit|margin/);
    expect(r.json.data).toMatchObject({ pending_orders: 0, orders_by_status: { PACKED: 1 } });
    expect(r.json.data).toHaveProperty('alerts_count');
    expect(r.json.data).toHaveProperty('sepay_unmatched');
  });
});
