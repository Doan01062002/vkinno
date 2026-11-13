import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const BM = 'VK-BOSSMAN-DESCALER-500ML';

let env: Env;
let admin: { id: number };

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function send(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, admin);
  return { status: res.status, json: (await res.json()) as Json };
}

const vnToday = (plusDays = 0) => new Date(Date.now() + 7 * 3600 * 1000 + plusDays * 86400000).toISOString().slice(0, 10);

let phoneSeq = 0;
async function makeCustomer(over: { type?: string; credit?: number; terms?: number; address?: string } = {}): Promise<number> {
  phoneSeq += 1;
  const res = await env.DB.prepare(
    'INSERT INTO customers (phone, name, type, address, credit_limit_vnd, payment_terms_days) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(`09000000${String(phoneSeq).padStart(2, '0')}`, `Khách ${phoneSeq}`, over.type ?? 'B2B', over.address ?? '1 Nguyễn Huệ, Q1', over.credit ?? 0, over.terms ?? 30)
    .run();
  return Number(res.meta.last_row_id);
}

const quoteBody = (customer_id: number, over: Record<string, unknown> = {}) => ({
  customer_id,
  valid_until: vnToday(10),
  discount_vnd: 10000,
  shipping_fee_vnd: 30000,
  note: 'Giá sỉ',
  items: [{ sku: DG, quantity: 10, unit_price: 60000 }],
  ...over,
});

async function makeQuote(customer_id: number, over: Record<string, unknown> = {}): Promise<any> {
  const r = await send('/quotes', 'POST', quoteBody(customer_id, over));
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.data;
}

const setStatus = (id: number, to: string) => send(`/quotes/${id}/status`, 'POST', { to });
const quoteRow = (id: number) => env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<any>();
const product = (sku: string) =>
  env.DB.prepare('SELECT stock_qty, reserved_qty FROM products WHERE sku = ?').bind(sku).first<any>();

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
  admin = await createUser(env.DB, 'ADMIN');
});

describe('báo giá', () => {
  it('tạo báo giá tính tổng, mã BG, đọc lại và liệt kê', async () => {
    const cid = await makeCustomer();
    const q = await makeQuote(cid);
    expect(q.code).toMatch(/^BG\d{6}-[A-Z0-9]{4}$/);
    expect(q.status).toBe('DRAFT');
    expect(q.subtotal_vnd).toBe(600000);
    expect(q.total_amount).toBe(600000 - 10000 + 30000);
    expect(q.items).toMatchObject([{ sku: DG, quantity: 10, unit_price: 60000, line_total: 600000 }]);
    const list = await send('/quotes');
    expect(list.json.data).toMatchObject({ total: 1, page: 1, page_size: 50 });
    expect(list.json.data.items[0].customer_name).toBe(`Khách ${phoneSeq}`);
  });

  it('SKU không tồn tại hoặc ngừng bán → 422 INVALID_LINE; khách không tồn tại → 422', async () => {
    const cid = await makeCustomer();
    const bad = await send('/quotes', 'POST', quoteBody(cid, { items: [{ sku: 'NOPE-SKU', quantity: 1, unit_price: 1 }] }));
    expect(bad.status).toBe(422);
    expect(bad.json.error?.code).toBe('INVALID_LINE');
    await env.DB.prepare('UPDATE products SET is_active = 0 WHERE sku = ?').bind(BM).run();
    const off = await send('/quotes', 'POST', quoteBody(cid, { items: [{ sku: BM, quantity: 1, unit_price: 1 }] }));
    expect(off.json.error?.code).toBe('INVALID_LINE');
    const noCust = await send('/quotes', 'POST', quoteBody(9999));
    expect(noCust.status).toBe(422);
  });

  it('chuyển trạng thái hợp lệ và chặn chuyển sai', async () => {
    const q = await makeQuote(await makeCustomer());
    expect((await setStatus(q.id, 'ACCEPTED')).status).toBe(409);
    expect((await setStatus(q.id, 'SENT')).json.data.status).toBe('SENT');
    expect((await setStatus(q.id, 'SENT')).json.error?.code).toBe('INVALID_TRANSITION');
    expect((await setStatus(q.id, 'ACCEPTED')).json.data.status).toBe('ACCEPTED');
    const r = await setStatus(q.id, 'REJECTED');
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('INVALID_TRANSITION');
  });

  it('PUT chỉ khi DRAFT/SENT và thay toàn bộ dòng', async () => {
    const cid = await makeCustomer();
    const q = await makeQuote(cid);
    const put = await send(`/quotes/${q.id}`, 'PUT', quoteBody(cid, { discount_vnd: 0, items: [{ sku: BM, quantity: 2, unit_price: 100000 }] }));
    expect(put.status).toBe(200);
    expect(put.json.data.items).toMatchObject([{ sku: BM, quantity: 2 }]);
    expect(put.json.data.total_amount).toBe(200000 + 30000);
    await setStatus(q.id, 'SENT');
    await setStatus(q.id, 'REJECTED');
    const again = await send(`/quotes/${q.id}`, 'PUT', quoteBody(cid));
    expect(again.status).toBe(409);
  });

  it('quá valid_until: đọc ra EXPIRED, không chấp nhận, không convert; trạng thái lưu không đổi', async () => {
    const q = await makeQuote(await makeCustomer());
    await setStatus(q.id, 'SENT');
    await env.DB.prepare('UPDATE quotes SET valid_until = ? WHERE id = ?').bind(vnToday(-1), q.id).run();
    expect((await send(`/quotes/${q.id}`)).json.data.status).toBe('EXPIRED');
    expect((await send('/quotes?status=EXPIRED')).json.data.total).toBe(1);
    expect((await quoteRow(q.id)).status).toBe('SENT');
    expect((await setStatus(q.id, 'ACCEPTED')).status).toBe(409);
    const conv = await send(`/quotes/${q.id}/convert`, 'POST');
    expect(conv.status).toBe(409);
    expect(conv.json.error?.code).toBe('QUOTE_NOT_CONVERTIBLE');
  });

  it('DRAFT không convert được', async () => {
    const q = await makeQuote(await makeCustomer());
    expect((await send(`/quotes/${q.id}/convert`, 'POST')).json.error?.code).toBe('QUOTE_NOT_CONVERTIBLE');
  });
});

describe('convert báo giá → đơn', () => {
  it('convert báo giá → đơn B2B PENDING giữ hàng, giá theo báo giá, quote CONVERTED', async () => {
    const cid = await makeCustomer({ address: '99 Hai Bà Trưng' });
    const q = await makeQuote(cid);
    await setStatus(q.id, 'SENT');
    const r = await send(`/quotes/${q.id}/convert`, 'POST');
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.data.quote.status).toBe('CONVERTED');
    const order = await env.DB.prepare('SELECT * FROM orders WHERE order_code = ?').bind(r.json.data.order.order_code).first<any>();
    expect(order).toMatchObject({
      channel: 'B2B',
      order_status: 'PENDING',
      source: 'QUOTE',
      quote_id: q.id,
      customer_id: cid,
      payment_method: 'BANK_B2B',
      shipping_address: '99 Hai Bà Trưng',
      subtotal_vnd: 600000,
      discount_vnd: 10000,
      shipping_fee_vnd: 30000,
      total_amount: 620000,
    });
    const item = await env.DB.prepare('SELECT sku, unit_price, quantity FROM order_items WHERE order_id = ?').bind(order.id).first<any>();
    expect(item).toMatchObject({ sku: DG, unit_price: 60000, quantity: 10 });
    expect(await product(DG)).toMatchObject({ stock_qty: 100, reserved_qty: 10 });
    expect((await quoteRow(q.id)).status).toBe('CONVERTED');
    const audit = await env.DB.prepare("SELECT detail_json FROM audit_logs WHERE action = 'order.create' AND entity_id = ?")
      .bind(order.order_code)
      .first<{ detail_json: string }>();
    expect(JSON.parse(audit!.detail_json)).toMatchObject({ source: 'QUOTE', quote_id: q.id, quote_code: q.code });
  });

  it('convert lần 2 → 409 QUOTE_NOT_CONVERTIBLE, không tạo thêm đơn/giữ thêm hàng', async () => {
    const q = await makeQuote(await makeCustomer());
    await setStatus(q.id, 'SENT');
    expect((await send(`/quotes/${q.id}/convert`, 'POST')).status).toBe(201);
    const r = await send(`/quotes/${q.id}/convert`, 'POST');
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('QUOTE_NOT_CONVERTIBLE');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(1);
    expect((await product(DG)).reserved_qty).toBe(10);
  });

  it('convert thiếu hàng → 409 STOCK_CONFLICT, báo giá giữ nguyên, không có đơn', async () => {
    const q = await makeQuote(await makeCustomer(), { items: [{ sku: DG, quantity: 500, unit_price: 60000 }], discount_vnd: 0 });
    await setStatus(q.id, 'SENT');
    await setStatus(q.id, 'ACCEPTED');
    const r = await send(`/quotes/${q.id}/convert`, 'POST');
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('STOCK_CONFLICT');
    expect((await quoteRow(q.id)).status).toBe('ACCEPTED');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(0);
    expect((await product(DG)).reserved_qty).toBe(0);
  });

  it('báo giá không có khách → 422', async () => {
    const q = await makeQuote(await makeCustomer());
    await setStatus(q.id, 'SENT');
    await env.DB.prepare('UPDATE quotes SET customer_id = NULL WHERE id = ?').bind(q.id).run();
    expect((await send(`/quotes/${q.id}/convert`, 'POST')).status).toBe(422);
  });
});

describe('công nợ B2B', () => {
  /** Tạo đơn B2B qua API rồi đặt trạng thái/thu tiền/hạn trực tiếp trong DB để mô phỏng thời gian. */
  async function debtOrder(cid: number, unitPrice: number, opts: { paid?: number; status?: string; due?: string | null } = {}) {
    const cust = await env.DB.prepare('SELECT phone, name FROM customers WHERE id = ?').bind(cid).first<any>();
    const r = await send('/orders', 'POST', {
      channel: 'B2B',
      customer: { phone: cust.phone, name: cust.name },
      shipping_address: 'Kho khách',
      items: [{ sku: BM, quantity: 1, unit_price: unitPrice }],
      shipping_fee_vnd: 0,
      payment_method: 'BANK_B2B',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    await env.DB.prepare('UPDATE orders SET order_status = ?, paid_amount = ?, due_date = ? WHERE id = ?')
      .bind(opts.status ?? 'COMPLETED', opts.paid ?? 0, opts.due === undefined ? vnToday(10) : opts.due, r.json.data.id)
      .run();
    return r.json.data;
  }

  it('công nợ: 2 đơn B2B 1.000.000 và 500.000, thu 300.000 → outstanding 1.200.000', async () => {
    const cid = await makeCustomer();
    await debtOrder(cid, 1_000_000, { paid: 300_000 });
    await debtOrder(cid, 500_000);
    const r = await send('/debts');
    expect(r.status).toBe(200);
    expect(r.json.data.total).toBe(1);
    expect(r.json.data.items[0]).toMatchObject({
      customer_id: cid,
      outstanding_vnd: 1_200_000,
      overdue_vnd: 0,
      oldest_due_date: vnToday(10),
      credit_limit_vnd: 0,
      over_limit: false,
    });
  });

  it('chỉ tính B2B, đơn PACKED trở đi, còn nợ: bỏ PENDING/CANCELLED/RETURNED/đã trả đủ/khách lẻ', async () => {
    const cid = await makeCustomer();
    await debtOrder(cid, 100_000, { status: 'PACKED' });
    await debtOrder(cid, 200_000, { status: 'SHIPPING' });
    await debtOrder(cid, 400_000, { status: 'PENDING' });
    await debtOrder(cid, 800_000, { status: 'CANCELLED' });
    await debtOrder(cid, 1_600_000, { status: 'RETURNED' });
    await debtOrder(cid, 3_200_000, { paid: 3_200_000 });
    const retail = await makeCustomer({ type: 'RETAIL' });
    await debtOrder(retail, 999_000);
    const r = await send('/debts');
    expect(r.json.data.items).toHaveLength(1);
    expect(r.json.data.items[0]).toMatchObject({ customer_id: cid, outstanding_vnd: 300_000 });
  });

  it('đơn quá hạn 5 ngày → overdue_vnd đúng, days_overdue 5', async () => {
    const cid = await makeCustomer();
    const late = await debtOrder(cid, 700_000, { paid: 100_000, due: vnToday(-5) });
    await debtOrder(cid, 300_000, { due: vnToday(3) });
    const r = await send('/debts');
    expect(r.json.data.items[0]).toMatchObject({
      outstanding_vnd: 900_000,
      overdue_vnd: 600_000,
      oldest_due_date: vnToday(-5),
    });
    const d = await send(`/debts/${cid}`);
    expect(d.status).toBe(200);
    expect(d.json.data.items).toHaveLength(2);
    expect(d.json.data.items[0]).toMatchObject({ id: late.id, outstanding_vnd: 600_000, days_overdue: 5 });
    expect(d.json.data.items[1].days_overdue).toBe(0);
  });

  it('vượt hạn mức → over_limit true; hạn mức 0 = không giới hạn', async () => {
    const over = await makeCustomer({ credit: 1_000_000 });
    await debtOrder(over, 1_500_000);
    const within = await makeCustomer({ credit: 5_000_000 });
    await debtOrder(within, 1_500_000);
    const none = await makeCustomer({ credit: 0 });
    await debtOrder(none, 1_500_000);
    const items = (await send('/debts')).json.data.items as any[];
    const by = (id: number) => items.find((i) => i.customer_id === id);
    expect(by(over).over_limit).toBe(true);
    expect(by(within).over_limit).toBe(false);
    expect(by(none).over_limit).toBe(false);
  });

  it('khách không tồn tại → 404', async () => {
    expect((await send('/debts/9999')).status).toBe(404);
  });
});
