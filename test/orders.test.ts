import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { createOrder, transitionOrder } from '../worker/admin/orders';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const BM = 'VK-BOSSMAN-DESCALER-500ML';
const COMBO = 'VK-COMBO-BOSSMAN-VKINNO-500ML';
const PHONE = '0912345678';

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

const orderBody = (over: Record<string, unknown> = {}) => ({
  channel: 'PHONE',
  customer: { phone: PHONE, name: 'Chị Lan' },
  shipping_address: '12 Lê Lợi, Q1',
  items: [{ sku: DG, quantity: 2 }],
  shipping_fee_vnd: 25000,
  payment_method: 'COD',
  ...over,
});

async function create(over: Record<string, unknown> = {}): Promise<any> {
  const r = await send('/orders', 'POST', orderBody(over));
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.data;
}

const transition = (id: number, to: string, lines?: unknown) =>
  send(`/orders/${id}/transition`, 'POST', lines === undefined ? { to } : { to, lines });

async function moveTo(id: number, ...steps: string[]) {
  for (const to of steps) {
    const r = await transition(id, to);
    expect(r.status, `${to}: ${JSON.stringify(r.json)}`).toBe(200);
  }
}

const product = (sku: string) =>
  env.DB.prepare('SELECT stock_qty, reserved_qty FROM products WHERE sku = ?').bind(sku).first<{
    stock_qty: number;
    reserved_qty: number;
  }>();
const order = (id: number) => env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<any>();
const logs = async (code: string) =>
  (
    await env.DB.prepare('SELECT sku, delta, reason, doc_type FROM inventory_logs WHERE ref_order_code = ? ORDER BY id')
      .bind(code)
      .all<any>()
  ).results;
const vnToday = (plusDays = 0) => new Date(Date.now() + 7 * 3600 * 1000 + plusDays * 86400000).toISOString().slice(0, 10);

describe('tạo đơn', () => {
  it('tạo PENDING giữ hàng', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 2 }, { sku: COMBO, quantity: 1 }], discount_vnd: 10000 });
    expect(o.order_code).toMatch(/^VK[A-Z0-9]{6}$/);
    expect(o.order_status).toBe('PENDING');
    expect(o.source).toBe('MANUAL');
    expect(o.created_by).toBe(admin.id);
    expect(o.subtotal_vnd).toBe(2 * 85000 + 145000);
    expect(o.total_amount).toBe(2 * 85000 + 145000 - 10000 + 25000);
    expect(o.items).toMatchObject([
      { sku: DG, quantity: 2, unit_price: 85000, line_total: 170000 },
      { sku: COMBO, quantity: 1, unit_price: 145000, line_total: 145000 },
    ]);
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 3 });
    expect(await product(BM)).toEqual({ stock_qty: 100, reserved_qty: 1 });
    expect(await logs(o.order_code)).toEqual([]);
    const cust = await env.DB.prepare('SELECT id, name FROM customers WHERE phone = ?').bind(PHONE).first<any>();
    expect(o.customer_id).toBe(cust.id);
    const audit = await env.DB.prepare("SELECT entity_id FROM audit_logs WHERE action = 'order.create'").first<any>();
    expect(audit.entity_id).toBe(o.order_code);
  });

  it('validate trước khi ghi: tên rỗng, không dòng, số lượng 0, SKU lạ, giảm giá vượt tạm tính → 422', async () => {
    const cases: Record<string, unknown>[] = [
      { customer: { phone: PHONE, name: '  ' } },
      { items: [] },
      { items: [{ sku: DG, quantity: 0 }] },
      { items: [{ sku: DG, quantity: 1.5 }] },
      { items: [{ sku: 'NOPE', quantity: 1 }] },
      { discount_vnd: 999999 },
      { customer: { phone: '123', name: 'A' } },
    ];
    for (const c of cases) {
      const r = await send('/orders', 'POST', orderBody(c));
      expect(r.status, JSON.stringify(c)).toBe(422);
    }
    expect((await send('/orders', 'POST', orderBody({ items: [{ sku: 'NOPE', quantity: 1 }] }))).json.error?.code).toBe(
      'UNKNOWN_SKU',
    );
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(0);
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
  });

  it('khách WHOLESALE lấy giá sỉ (không có giá sỉ → giá lẻ; unit_price gửi lên được giữ)', async () => {
    await env.DB.prepare(
      "INSERT INTO customers (phone, name, type, price_tier) VALUES (?, 'Đại lý A', 'B2B', 'WHOLESALE')",
    )
      .bind(PHONE)
      .run();
    await env.DB.prepare('UPDATE products SET wholesale_price_vnd = 60000 WHERE sku = ?').bind(DG).run();
    const o = await create({
      items: [
        { sku: DG, quantity: 10 },
        { sku: BM, quantity: 1 },
        { sku: COMBO, quantity: 1, unit_price: 100000 },
      ],
    });
    const bm = (await env.DB.prepare('SELECT price_vnd FROM products WHERE sku = ?').bind(BM).first<any>()).price_vnd;
    expect(o.items.map((i: any) => i.unit_price)).toEqual([60000, bm, 100000]);
    expect(o.subtotal_vnd).toBe(600000 + bm + 100000);
  });

  it('hai đơn tạo song song cho món cuối → 1 thành công, 1 nhận 409 có tên sản phẩm', async () => {
    await env.DB.prepare('UPDATE products SET stock_qty = 1 WHERE sku = ?').bind(DG).run();
    const body = orderBody({ items: [{ sku: DG, quantity: 1 }] });
    const results = await Promise.all([send('/orders', 'POST', body), send('/orders', 'POST', body)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const failed = results.find((r) => r.status === 409)!;
    expect(failed.json.error?.code).toBe('STOCK_CONFLICT');
    expect(failed.json.error?.message).toContain('Chai xịt tẩy dầu mỡ đa năng VKINNO');
    expect(failed.json.error?.message).toContain('chỉ còn 0 có thể bán');
    expect(await product(DG)).toEqual({ stock_qty: 1, reserved_qty: 1 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(1);
  });

  it('tạo SHIPPING trực tiếp (nguồn IMPORT) trừ tồn ngay, reserved không đổi', async () => {
    await env.DB.prepare('UPDATE products SET reserved_qty = 5 WHERE sku = ?').bind(DG).run();
    const r = await createOrder(
      env,
      {
        ...orderBody({ channel: 'SHOPEE', payment_method: 'MARKETPLACE', items: [{ sku: COMBO, quantity: 2 }] }),
        external_order_id: 'SP-0001',
      } as any,
      { source: 'IMPORT', userId: admin.id, status: 'SHIPPING' },
    );
    const o = await order(r.id);
    expect(o).toMatchObject({ order_code: r.order_code, order_status: 'SHIPPING', source: 'IMPORT', stock_deducted: 1 });
    expect(o.external_order_id).toBe('SP-0001');
    expect(await product(DG)).toEqual({ stock_qty: 98, reserved_qty: 5 });
    expect(await product(BM)).toEqual({ stock_qty: 98, reserved_qty: 0 });
    expect((await logs(r.order_code)).map((l: any) => [l.sku, l.delta, l.reason])).toEqual(
      expect.arrayContaining([
        [DG, -2, 'SALE_OUT'],
        [BM, -2, 'SALE_OUT'],
      ]),
    );
    const item = await env.DB.prepare('SELECT unit_cost_vnd FROM order_items WHERE order_id = ?').bind(r.id).first<any>();
    expect(item.unit_cost_vnd).toBe(100000);
  });

  it('mã đơn sàn trùng → 409 DUPLICATE_ORDER, không giữ thêm hàng', async () => {
    const input = { ...orderBody(), channel: 'TIKTOK', external_order_id: 'TT-1' } as any;
    await createOrder(env, input, { source: 'IMPORT', userId: null });
    await expect(createOrder(env, input, { source: 'IMPORT', userId: null })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_ORDER',
    });
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 2 });
  });

  it('createOrder với ctx → mirrorEvent order.created qua waitUntil', async () => {
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p) } as unknown as ExecutionContext;
    await createOrder(env, orderBody() as any, { source: 'MANUAL', userId: admin.id }, ctx);
    expect(waited).toHaveLength(1);
  });
});

describe('chuyển trạng thái', () => {
  it('PENDING→PACKED trừ kho + unit_cost', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 2 }, { sku: COMBO, quantity: 1 }] });
    await env.DB.prepare('UPDATE products SET cost_avg_vnd = 30000 WHERE sku = ?').bind(BM).run();
    const r = await transition(o.id, 'PACKED');
    expect(r.status).toBe(200);
    expect(r.json.data.order_status).toBe('PACKED');
    expect(await product(DG)).toEqual({ stock_qty: 97, reserved_qty: 0 });
    expect(await product(BM)).toEqual({ stock_qty: 99, reserved_qty: 0 });
    expect(r.json.data.items.map((i: any) => i.unit_cost_vnd)).toEqual([50000, 80000]);
    expect((await order(o.id)).stock_deducted).toBe(1);
    expect((await logs(o.order_code)).map((l: any) => [l.sku, l.delta, l.reason])).toEqual(
      expect.arrayContaining([
        [DG, -3, 'SALE_OUT'],
        [BM, -1, 'SALE_OUT'],
      ]),
    );
    const audit = await env.DB.prepare("SELECT detail_json FROM audit_logs WHERE action = 'order.transition'").first<any>();
    expect(JSON.parse(audit.detail_json)).toMatchObject({ from: 'PENDING', to: 'PACKED' });
  });

  it('PACKED→SHIPPING→COMPLETED không đổi kho', async () => {
    const o = await create();
    await moveTo(o.id, 'PACKED');
    const before = await logs(o.order_code);
    await moveTo(o.id, 'SHIPPING', 'COMPLETED');
    expect((await order(o.id)).order_status).toBe('COMPLETED');
    expect(await product(DG)).toEqual({ stock_qty: 98, reserved_qty: 0 });
    expect(await logs(o.order_code)).toEqual(before);
  });

  it('PENDING→CANCELLED bỏ giữ', async () => {
    const o = await create({ items: [{ sku: COMBO, quantity: 3 }] });
    expect(await product(BM)).toEqual({ stock_qty: 100, reserved_qty: 3 });
    await moveTo(o.id, 'CANCELLED');
    expect(await product(BM)).toEqual({ stock_qty: 100, reserved_qty: 0 });
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
    expect(await logs(o.order_code)).toEqual([]);
  });

  it('PACKED→CANCELLED nhập lại kho (CANCEL_RESTOCK); huỷ lần 2 → 409, không nhập lại 2 lần', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 4 }] });
    await moveTo(o.id, 'PACKED', 'CANCELLED');
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
    expect((await logs(o.order_code)).map((l: any) => [l.delta, l.reason])).toEqual([
      [-4, 'SALE_OUT'],
      [4, 'CANCEL_RESTOCK'],
    ]);
    const again = await transition(o.id, 'CANCELLED');
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe('INVALID_TRANSITION');
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
  });

  it('COMPLETED→RETURNED với 1 dòng RESTOCK + 1 dòng DAMAGED', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 2 }, { sku: BM, quantity: 3 }] });
    await moveTo(o.id, 'PACKED', 'SHIPPING', 'COMPLETED');
    const [dgItem, bmItem] = o.items;
    const lines = [
      { order_item_id: dgItem.id, action: 'RESTOCK' },
      { order_item_id: bmItem.id, action: 'DAMAGED' },
    ];
    // Thiếu dòng / trùng dòng / dòng lạ → 422, chưa đổi gì
    for (const bad of [[lines[0]], [lines[0], lines[0], lines[1]], [...lines, { order_item_id: 99999, action: 'RESTOCK' }]]) {
      const r = await transition(o.id, 'RETURNED', bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await transition(o.id, 'RETURNED')).status).toBe(422);
    expect((await order(o.id)).order_status).toBe('COMPLETED');

    const r = await transition(o.id, 'RETURNED', lines);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
    expect(await product(BM)).toEqual({ stock_qty: 97, reserved_qty: 0 });
    expect((await logs(o.order_code)).filter((l: any) => l.reason.startsWith('RETURN'))).toEqual([
      { sku: DG, delta: 2, reason: 'RETURN_RESTOCK', doc_type: 'RETURN' },
      { sku: BM, delta: 0, reason: 'RETURN_DAMAGED', doc_type: 'RETURN' },
    ]);
    const twice = await transition(o.id, 'RETURNED', lines);
    expect(twice.json.error?.code).toBe('INVALID_TRANSITION');
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
  });

  it('chuyển sai (PENDING→COMPLETED) → 409 INVALID_TRANSITION', async () => {
    const o = await create();
    for (const to of ['COMPLETED', 'SHIPPING', 'RETURNED']) {
      const r = await transition(o.id, to);
      expect(r.status, to).toBe(409);
      expect(r.json.error?.code).toBe('INVALID_TRANSITION');
    }
    expect((await order(o.id)).order_status).toBe('PENDING');
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 2 });
    expect((await transition(99999, 'PACKED')).json.error?.code).toBe('ORDER_NOT_FOUND');
  });

  it('chuyển trùng song song chỉ áp dụng một lần (guard trong batch)', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 3 }] });
    const results = await Promise.all([transition(o.id, 'PACKED'), transition(o.id, 'PACKED')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.json.error?.code).toBe('INVALID_TRANSITION');
    expect(await product(DG)).toEqual({ stock_qty: 97, reserved_qty: 0 });
  });

  it('B2B PACKED đặt due_date = hôm nay + payment_terms_days', async () => {
    await env.DB.prepare(
      "INSERT INTO customers (phone, name, type, payment_terms_days) VALUES (?, 'Công ty B', 'B2B', 30)",
    )
      .bind(PHONE)
      .run();
    const o = await create({ channel: 'B2B', payment_method: 'BANK_TRANSFER' });
    expect(o.due_date).toBeNull();
    await moveTo(o.id, 'PACKED');
    expect((await order(o.id)).due_date).toBe(vnToday(30));

    // due_date đã có thì giữ nguyên
    const o2 = await create({ channel: 'B2B', payment_method: 'BANK_TRANSFER', due_date: '2030-01-01' });
    await moveTo(o2.id, 'PACKED');
    expect((await order(o2.id)).due_date).toBe('2030-01-01');

    // khách lẻ, kênh không phải B2B → không đặt hạn
    const o3 = await create({ customer: { phone: '0987654321', name: 'Lẻ' } });
    await moveTo(o3.id, 'PACKED');
    expect((await order(o3.id)).due_date).toBeNull();
  });

  it('đơn cũ chưa từng trừ kho (stock_deducted = 0) huỷ sau PACKED không nhập lại kho', async () => {
    const o = await create();
    await moveTo(o.id, 'CANCELLED');
    // Mô phỏng đơn PACKED tạo trước module kho: không giữ, không trừ.
    await env.DB.prepare("UPDATE orders SET order_status = 'PACKED', stock_deducted = 0 WHERE id = ?").bind(o.id).run();
    await moveTo(o.id, 'CANCELLED');
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 0 });
    expect(await logs(o.order_code)).toEqual([]);
  });

  it('dòng hàng bị sửa giữa lúc đọc và ghi của lệnh huỷ → 409 ORDER_CHANGED, giữ hàng theo dòng mới', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 2 }] });
    // Chen một lần sửa đơn ngay trước batch ghi của lệnh huỷ (lệnh huỷ đã đọc dòng cũ).
    const realBatch = env.DB.batch.bind(env.DB);
    let put: { status: number; json: Json } | undefined;
    env.DB.batch = (async (stmts: D1PreparedStatement[]) => {
      if (!put) {
        put = { status: 0, json: { ok: false } };
        put = await send(`/orders/${o.id}`, 'PUT', orderBody({ items: [{ sku: DG, quantity: 7 }] }));
      }
      return realBatch(stmts);
    }) as typeof env.DB.batch;
    const cancel = await transition(o.id, 'CANCELLED');
    env.DB.batch = realBatch;
    expect(put!.status).toBe(200);
    expect(cancel.status).toBe(409);
    expect(cancel.json.error?.code).toBe('ORDER_CHANGED');
    expect((await order(o.id)).order_status).toBe('PENDING');
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 7 });
  });

  it('transitionOrder dùng trực tiếp: đơn không tồn tại → 404 ORDER_NOT_FOUND', async () => {
    await expect(transitionOrder(env, 424242, 'PACKED', { userId: null })).rejects.toMatchObject({
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  });
});

describe('sửa đơn', () => {
  it('PUT dòng hàng khi PACKED → 409', async () => {
    const o = await create();
    await moveTo(o.id, 'PACKED');
    const r = await send(`/orders/${o.id}`, 'PUT', orderBody({ items: [{ sku: DG, quantity: 1 }] }));
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('INVALID_TRANSITION');
    expect(await product(DG)).toEqual({ stock_qty: 98, reserved_qty: 0 });
  });

  it('PUT khi PENDING: release cũ + reserve mới, tính lại tổng', async () => {
    const o = await create({ items: [{ sku: DG, quantity: 2 }] });
    const r = await send(
      `/orders/${o.id}`,
      'PUT',
      orderBody({ items: [{ sku: COMBO, quantity: 1 }, { sku: DG, quantity: 5 }], shipping_fee_vnd: 0, notes: 'giao sáng' }),
    );
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.items.map((i: any) => [i.sku, i.quantity])).toEqual([
      [COMBO, 1],
      [DG, 5],
    ]);
    expect(r.json.data).toMatchObject({ notes: 'giao sáng', subtotal_vnd: 145000 + 5 * 85000, total_amount: 145000 + 5 * 85000 });
    expect(await product(DG)).toEqual({ stock_qty: 100, reserved_qty: 6 });
    expect(await product(BM)).toEqual({ stock_qty: 100, reserved_qty: 1 });
  });

  it('PUT dòng hàng khi PENDING tăng số lượng vượt có thể bán → 409, đơn giữ nguyên', async () => {
    await env.DB.prepare('UPDATE products SET stock_qty = 5 WHERE sku = ?').bind(DG).run();
    const o = await create({ items: [{ sku: BM, quantity: 1 }, { sku: DG, quantity: 2 }] });
    const before = await send(`/orders/${o.id}`);
    const r = await send(
      `/orders/${o.id}`,
      'PUT',
      orderBody({ items: [{ sku: BM, quantity: 1 }, { sku: DG, quantity: 6 }], notes: 'đổi' }),
    );
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('STOCK_CONFLICT');
    expect(r.json.error?.message).toContain('chỉ còn 3 có thể bán');
    expect(await product(DG)).toEqual({ stock_qty: 5, reserved_qty: 2 });
    expect(await product(BM)).toEqual({ stock_qty: 100, reserved_qty: 1 });
    const after = await send(`/orders/${o.id}`);
    expect(after.json.data).toEqual(before.json.data);
  });
});

describe('giao hàng, danh sách, chi tiết', () => {
  it('PUT shipping cập nhật vận chuyển, phí ship và tổng tiền', async () => {
    const o = await create();
    const r = await send(`/orders/${o.id}/shipping`, 'PUT', {
      shipping_carrier: 'GHN',
      shipping_tracking_code: 'GHN123',
      shipping_fee_vnd: 0,
    });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ shipping_carrier: 'GHN', shipping_tracking_code: 'GHN123', total_amount: 170000 });
    await moveTo(o.id, 'CANCELLED');
    const late = await send(`/orders/${o.id}/shipping`, 'PUT', {
      shipping_carrier: 'GHN',
      shipping_tracking_code: 'X',
      shipping_fee_vnd: 0,
    });
    expect(late.status).toBe(409);
  });

  it('đổi tổng tiền (phí ship) tính lại payment_status theo số đã thu', async () => {
    const o = await create();
    await env.DB.prepare('UPDATE orders SET paid_amount = 170000, payment_status = ? WHERE id = ?')
      .bind('PARTIAL', o.id)
      .run();
    const r = await send(`/orders/${o.id}/shipping`, 'PUT', {
      shipping_carrier: '',
      shipping_tracking_code: '',
      shipping_fee_vnd: 0,
    });
    expect(r.json.data).toMatchObject({ total_amount: 170000, payment_status: 'PAID' });
    expect(r.json.data.paid_at).not.toBeNull();
    const back = await send(`/orders/${o.id}/shipping`, 'PUT', {
      shipping_carrier: '',
      shipping_tracking_code: '',
      shipping_fee_vnd: 30000,
    });
    expect(back.json.data).toMatchObject({ total_amount: 200000, payment_status: 'PARTIAL' });
  });

  it('GET orders lọc và tìm theo mã, tên, SĐT (chuẩn hoá)', async () => {
    const a = await create();
    await create({ customer: { phone: '0987654321', name: 'Anh Minh' }, channel: 'ZALO' });
    const list = async (qs: string) => (await send(`/orders?${qs}`)).json.data;
    expect((await list('')).total).toBe(2);
    expect((await list('channel=ZALO')).items.map((i: any) => i.customer_name)).toEqual(['Anh Minh']);
    expect((await list(`q=${a.order_code}`)).items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await list('q=Minh')).total).toBe(1);
    expect((await list(`q=${encodeURIComponent('+84 912 345 678')}`)).items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await list(`customer_id=${a.customer_id}`)).total).toBe(1);
    expect((await list('status=PACKED')).total).toBe(0);
    expect((await list(`from=${vnToday()}&to=${vnToday()}`)).total).toBe(2);
    expect((await list(`from=${vnToday(1)}`)).total).toBe(0);
    const page = await list('page=1&page_size=1');
    expect(page).toMatchObject({ total: 2, page: 1, page_size: 1 });
    expect(page.items).toHaveLength(1);
  });

  it('GET orders/:id kèm dòng hàng, thanh toán, sổ kho; STAFF không thấy giá vốn', async () => {
    const o = await create();
    await moveTo(o.id, 'PACKED');
    const r = await send(`/orders/${o.id}`);
    expect(r.json.data.payments).toEqual([]);
    expect(r.json.data.inventory_logs.map((l: any) => l.reason)).toEqual(['SALE_OUT']);
    expect(r.json.data.items[0].unit_cost_vnd).toBe(50000);
    const s = await send(`/orders/${o.id}`, 'GET', undefined, staff);
    expect(s.json.data.items[0]).not.toHaveProperty('unit_cost_vnd');
    expect(s.json.data.inventory_logs[0]).not.toHaveProperty('unit_cost_vnd');
    expect((await send('/orders/99999')).status).toBe(404);
  });
});
