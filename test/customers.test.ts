import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { upsertCustomerByPhoneStmts } from '../worker/admin/customers';
import { isValidVnPhone, normalizeVnPhone } from '../worker/lib/phone';
import { api, createUser, makeEnv } from './helpers';

let env: Env;
let admin: { id: number };

beforeEach(async () => {
  env = await makeEnv();
  admin = await createUser(env.DB, 'ADMIN');
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function send(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, admin);
  return { status: res.status, json: (await res.json()) as Json };
}

const customerCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>())!.n;

async function upsert(input: Parameters<typeof upsertCustomerByPhoneStmts>[1]) {
  const { stmts } = await upsertCustomerByPhoneStmts(env.DB, input);
  await env.DB.batch(stmts);
}

describe('phone helpers', () => {
  it('chuẩn hoá và kiểm tra số Việt Nam', () => {
    expect(normalizeVnPhone('+84 912 345 678')).toBe('0912345678');
    expect(isValidVnPhone('0912345678')).toBe(true);
    expect(isValidVnPhone('12345')).toBe(false);
  });
});

describe('upsertCustomerByPhoneStmts', () => {
  it('upsert theo SĐT "0912 345 678" và "+84912345678" ra cùng một khách', async () => {
    const a = await upsertCustomerByPhoneStmts(env.DB, { phone: '0912 345 678', name: 'An' });
    const b = await upsertCustomerByPhoneStmts(env.DB, { phone: '+84912345678', name: 'An' });
    expect(a.bind).toEqual(['0912345678']);
    expect(b.bind).toEqual(['0912345678']);
    expect(a.customerIdSql).toBe('(SELECT id FROM customers WHERE phone = ?)');
    await env.DB.batch([...a.stmts, ...b.stmts]);
    expect(await customerCount()).toBe(1);
    const row = await env.DB.prepare(`SELECT ${a.customerIdSql} AS id`).bind(...a.bind).first<{ id: number }>();
    expect(row!.id).toBeGreaterThan(0);
  });

  it('không ghi đè tên/email/địa chỉ đã có, chỉ điền chỗ trống', async () => {
    await upsert({ phone: '0912345678', name: 'An', email: '', address: '' });
    await upsert({ phone: '0912345678', name: 'Bình', email: 'a@x.vn', address: 'Hà Nội' });
    await upsert({ phone: '0912345678', name: 'Cường', email: 'c@x.vn', address: 'HCM' });
    const row = await env.DB.prepare('SELECT name, email, address FROM customers').first<any>();
    expect(row).toEqual({ name: 'An', email: 'a@x.vn', address: 'Hà Nội' });
  });

  it('SĐT không hợp lệ → 422 INVALID_PHONE', async () => {
    await expect(upsertCustomerByPhoneStmts(env.DB, { phone: '123', name: 'X' })).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_PHONE',
    });
  });
});

describe('API khách hàng', () => {
  const retail = { phone: '0912 345 678', name: 'An' };

  it('tạo khách (201), SĐT được chuẩn hoá, ghi audit', async () => {
    const r = await send('/customers', 'POST', retail);
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ phone: '0912345678', name: 'An', type: 'RETAIL', total_spent_vnd: 0 });
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'customer.create'").first<any>();
    expect(audit.n).toBe(1);
  });

  it('tạo trùng SĐT → 409 DUPLICATE_PHONE (kể cả viết khác định dạng)', async () => {
    await send('/customers', 'POST', retail);
    const r = await send('/customers', 'POST', { phone: '+84912345678', name: 'Khác' });
    expect(r.status).toBe(409);
    expect(r.json.error!.code).toBe('DUPLICATE_PHONE');
    expect(await customerCount()).toBe(1);
  });

  it('SĐT sai → 422 INVALID_PHONE', async () => {
    const r = await send('/customers', 'POST', { phone: '999', name: 'X' });
    expect(r.status).toBe(422);
    expect(r.json.error!.code).toBe('INVALID_PHONE');
  });

  it('khách B2B bắt buộc payment_terms_days >= 0, credit_limit_vnd >= 0', async () => {
    const base = { phone: '0988111222', name: 'Cty', type: 'B2B', company_name: 'Cty ABC' };
    for (const body of [
      base,
      { ...base, payment_terms_days: 30 },
      { ...base, credit_limit_vnd: 1000000 },
      { ...base, payment_terms_days: -1, credit_limit_vnd: 1000000 },
      { ...base, payment_terms_days: 30, credit_limit_vnd: -5 },
    ]) {
      const r = await send('/customers', 'POST', body);
      expect(r.status).toBe(422);
      expect(r.json.error!.code).toBe('VALIDATION');
    }
    expect(await customerCount()).toBe(0);
    const good = await send('/customers', 'POST', { ...base, payment_terms_days: 0, credit_limit_vnd: 0 });
    expect(good.status).toBe(201);
    expect(good.json.data).toMatchObject({ type: 'B2B', payment_terms_days: 0, credit_limit_vnd: 0 });
  });

  it('sửa khách; đổi sang SĐT của khách khác → 409; không tồn tại → 404', async () => {
    const a = (await send('/customers', 'POST', retail)).json.data;
    await send('/customers', 'POST', { phone: '0988111222', name: 'B' });
    const put = await send(`/customers/${a.id}`, 'PUT', { ...retail, name: 'An mới', note: 'vip' });
    expect(put.status).toBe(200);
    expect(put.json.data).toMatchObject({ name: 'An mới', note: 'vip' });
    const dup = await send(`/customers/${a.id}`, 'PUT', { phone: '0988111222', name: 'An' });
    expect(dup.status).toBe(409);
    expect((await send('/customers/9999', 'GET')).status).toBe(404);
    expect((await send('/customers/9999', 'PUT', retail)).status).toBe(404);
  });

  it('danh sách lọc theo type và q, có phân trang', async () => {
    await send('/customers', 'POST', retail);
    await send('/customers', 'POST', {
      phone: '0988111222', name: 'Cty', type: 'B2B', payment_terms_days: 15, credit_limit_vnd: 5000000,
    });
    const all = (await send('/customers')).json.data;
    expect(all).toMatchObject({ total: 2, page: 1, page_size: 50 });
    const b2b = (await send('/customers?type=B2B')).json.data;
    expect(b2b.items.map((c: any) => c.name)).toEqual(['Cty']);
    const byPhone = (await send('/customers?q=0912')).json.data;
    expect(byPhone.items.map((c: any) => c.name)).toEqual(['An']);
    expect((await send('/customers?page_size=1&page=2')).json.data.items).toHaveLength(1);
  });

  it('tổng chi tiêu bỏ đơn CANCELLED/RETURNED; liệt kê đơn của khách', async () => {
    const c = (await send('/customers', 'POST', retail)).json.data;
    const other = (await send('/customers', 'POST', { phone: '0988111222', name: 'B' })).json.data;
    const add = (code: string, status: string, total: number, customerId: number) =>
      env.DB.prepare(
        `INSERT INTO orders (order_code, customer_name, customer_phone, shipping_address, subtotal_vnd, shipping_fee_vnd, order_status, total_amount, customer_id)
         VALUES (?, 'x', '0912345678', 'x', 0, 0, ?, ?, ?)`,
      ).bind(code, status, total, customerId).run();
    await add('O1', 'COMPLETED', 100000, c.id);
    await add('O2', 'PENDING', 50000, c.id);
    await add('O3', 'CANCELLED', 900000, c.id);
    await add('O4', 'RETURNED', 700000, c.id);
    await add('O5', 'COMPLETED', 333, other.id);

    const detail = (await send(`/customers/${c.id}`)).json.data;
    expect(detail.total_spent_vnd).toBe(150000);
    expect(detail.order_count).toBe(4);
    const listed = (await send('/customers?q=0912')).json.data.items[0];
    expect(listed.total_spent_vnd).toBe(150000);

    const orders = (await send(`/customers/${c.id}/orders`)).json.data;
    expect(orders.total).toBe(4);
    expect(orders.items.map((o: any) => o.order_code)).toEqual(['O4', 'O3', 'O2', 'O1']);
  });
});

describe('API nhà cung cấp', () => {
  it('tạo (201), sửa, đọc, liệt kê, ghi audit', async () => {
    const created = await send('/suppliers', 'POST', { name: 'NCC A', phone: '0900000001' });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ name: 'NCC A', is_active: 1 });
    const id = created.json.data.id;
    const put = await send(`/suppliers/${id}`, 'PUT', { name: 'NCC A+', is_active: false });
    expect(put.json.data).toMatchObject({ name: 'NCC A+', is_active: 0 });
    expect((await send(`/suppliers/${id}`)).json.data.name).toBe('NCC A+');
    await send('/suppliers', 'POST', { name: 'Công ty B' });
    const list = (await send('/suppliers?q=Công')).json.data;
    expect(list).toMatchObject({ total: 1, page: 1, page_size: 50 });
    const actions = await env.DB.prepare('SELECT action, entity_id FROM audit_logs WHERE entity = ? ORDER BY id')
      .bind('supplier').all<any>();
    expect(actions.results.map((a: any) => a.action)).toEqual(['supplier.create', 'supplier.update', 'supplier.create']);
    expect(actions.results[0].entity_id).toBe(String(id));
    expect((await send('/suppliers/9999')).status).toBe(404);
    expect((await send('/suppliers', 'POST', { name: '' })).status).toBe(422);
  });

  it('GET suppliers/:id/stock-docs trả phiếu của nhà cung cấp đó', async () => {
    const a = (await send('/suppliers', 'POST', { name: 'A' })).json.data.id;
    const b = (await send('/suppliers', 'POST', { name: 'B' })).json.data.id;
    const sku = (await env.DB.prepare('SELECT sku FROM products LIMIT 1').first<{ sku: string }>())!.sku;
    const doc = (supplier_id: number) =>
      send('/stock-docs', 'POST', { type: 'RECEIPT', supplier_id, lines: [{ sku, qty: 1, unit_cost_vnd: 1 }] });
    await doc(a);
    await doc(a);
    await doc(b);
    const r = (await send(`/suppliers/${a}/stock-docs`)).json.data;
    expect(r).toMatchObject({ total: 2, page: 1, page_size: 50 });
    expect(r.items.every((d: any) => d.supplier_id === a)).toBe(true);
    expect((await send('/suppliers/9999/stock-docs')).status).toBe(404);
  });
});
