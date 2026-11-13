import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import { addPaymentStmts } from '../worker/admin/payments';
import { api, callWorker, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const ACCOUNT = '0491000082331';

let env: Env;
let admin: { id: number };

beforeEach(async () => {
  env = await makeEnv({ SEPAY_WEBHOOK_API_KEY: 'sepay-test-key' });
  await seedProducts(env.DB);
  admin = await createUser(env.DB, 'ADMIN');
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function send(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, admin);
  return { status: res.status, json: (await res.json()) as Json };
}

async function makeOrder(over: Record<string, unknown> = {}): Promise<any> {
  const r = await send('/orders', 'POST', {
    channel: 'PHONE',
    customer: { phone: '0912345678', name: 'Chị Lan' },
    shipping_address: '12 Lê Lợi, Q1',
    items: [{ sku: DG, quantity: 2 }],
    shipping_fee_vnd: 0,
    payment_method: 'COD',
    ...over,
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.data;
}

const pay = (orderId: number, body: Record<string, unknown>) => send(`/orders/${orderId}/payments`, 'POST', body);

const orderRow = (id: number) =>
  env.DB.prepare('SELECT total_amount, paid_amount, payment_status, paid_at FROM orders WHERE id = ?').bind(id).first<{
    total_amount: number;
    paid_amount: number;
    payment_status: string;
    paid_at: string | null;
  }>();

async function sepay(payload: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await callWorker(
    new Request('https://test.local/api/webhook/sepay', {
      method: 'POST',
      headers: { Authorization: 'Apikey sepay-test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway: 'VCB',
        accountNumber: ACCOUNT,
        transferType: 'in',
        referenceCode: 'FT1',
        ...payload,
      }),
    }),
    env,
  );
  return { status: res.status, json: await res.json() };
}

describe('thanh toán', () => {
  it('thu 2 lần tới đủ → PARTIAL rồi PAID', async () => {
    const o = await makeOrder();
    const total = o.total_amount as number;
    const first = await pay(o.id, { kind: 'RECEIPT', amount_vnd: 1000, method: 'CASH' });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    expect(first.json.data.payment_status).toBe('PARTIAL');
    expect(first.json.data.paid_amount).toBe(1000);
    expect((await orderRow(o.id))!.paid_at).toBeNull();

    const second = await pay(o.id, { kind: 'RECEIPT', amount_vnd: total - 1000, method: 'BANK_TRANSFER' });
    expect(second.status).toBe(201);
    expect(second.json.data.payment_status).toBe('PAID');
    const row = await orderRow(o.id);
    expect(row!.paid_amount).toBe(total);
    expect(row!.paid_at).not.toBeNull();

    const list = await send(`/orders/${o.id}/payments`);
    expect(list.status).toBe(200);
    expect(list.json.data.total).toBe(2);
    expect(list.json.data.items.map((p: any) => p.amount_vnd)).toEqual([1000, total - 1000]);
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'payment.create'").first<{ n: number }>();
    expect(audit!.n).toBe(2);
  });

  it('thu vượt tổng → PAID, paid_amount > total', async () => {
    const o = await makeOrder();
    const r = await pay(o.id, { kind: 'RECEIPT', amount_vnd: o.total_amount + 5000, method: 'CASH' });
    expect(r.status).toBe(201);
    expect(r.json.data.payment_status).toBe('PAID');
    expect(r.json.data.overpaid_vnd).toBe(5000);
    const row = await orderRow(o.id);
    expect(row!.paid_amount).toBe(o.total_amount + 5000);
  });

  it('hoàn tiền giảm paid_amount; PAID về PARTIAL và xoá paid_at', async () => {
    const o = await makeOrder();
    await pay(o.id, { kind: 'RECEIPT', amount_vnd: o.total_amount, method: 'CASH' });
    const r = await pay(o.id, { kind: 'REFUND', amount_vnd: 1000, method: 'CASH' });
    expect(r.status).toBe(201);
    expect(r.json.data.payment_status).toBe('PARTIAL');
    const row = await orderRow(o.id);
    expect(row!.paid_amount).toBe(o.total_amount - 1000);
    expect(row!.paid_at).toBeNull();
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'payment.refund'").first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });

  it('hoàn vượt đã thu → 422', async () => {
    const o = await makeOrder();
    await pay(o.id, { kind: 'RECEIPT', amount_vnd: 1000, method: 'CASH' });
    const r = await pay(o.id, { kind: 'REFUND', amount_vnd: 1001, method: 'CASH' });
    expect(r.status).toBe(422);
    expect(r.json.error!.code).toBe('REFUND_EXCEEDS_PAID');
    expect((await orderRow(o.id))!.paid_amount).toBe(1000);
  });

  it('batch tự chặn hoàn vượt (đua với hoàn khác), không làm paid_amount âm', async () => {
    const o = await makeOrder();
    await pay(o.id, { kind: 'RECEIPT', amount_vnd: 1000, method: 'CASH' });
    const stmts = addPaymentStmts(env.DB, o.id, { kind: 'REFUND', amount_vnd: 1500, method: 'CASH' }, { userId: null });
    await expect(env.DB.batch(stmts)).rejects.toThrow(/CHECK constraint failed/);
    const row = await orderRow(o.id);
    expect(row!.paid_amount).toBe(1000);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').bind(o.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('số tiền không hợp lệ và đơn không tồn tại', async () => {
    const o = await makeOrder();
    expect((await pay(o.id, { kind: 'RECEIPT', amount_vnd: 0, method: 'CASH' })).status).toBe(422);
    expect((await pay(o.id, { kind: 'RECEIPT', amount_vnd: 10, method: 'MOMO' })).status).toBe(422);
    expect((await pay(9999, { kind: 'RECEIPT', amount_vnd: 10, method: 'CASH' })).status).toBe(404);
  });
});

describe('SePay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tin Telegram trỏ tới trang quản trị mới, không còn AppSheet / "Tab 4"', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_u: unknown, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).text);
      return new Response('{}');
    });
    env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
    const o = await makeOrder();
    await sepay({ id: 9101, transferAmount: 1000, content: 'CK khong ro ma' });
    await sepay({ id: 9102, transferAmount: o.total_amount, content: `CK ${o.order_code}` });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('/quan-tri/tong-quan');
    expect(sent[1]).toContain(`/quan-tri/don-hang/${o.id}`);
    for (const t of sent) expect(t).not.toMatch(/AppSheet|Tab 4/);
  });

  it('webhook SePay khớp mã đơn → có payment kind RECEIPT method VIETQR, gửi lại cùng tx → không nhân đôi', async () => {
    const o = await makeOrder();
    const payload = { id: 9001, transferAmount: 1000, content: `CK ${o.order_code} cam on` };
    const first = await sepay(payload);
    expect(first.status).toBe(200);
    expect(first.json.match_status).toBe('PARTIAL');
    expect(first.json.paid_amount).toBe(1000);

    const pays = await env.DB.prepare('SELECT kind, method, amount_vnd, sepay_tx_id FROM payments WHERE order_id = ?')
      .bind(o.id)
      .all();
    expect(pays.results).toEqual([{ kind: 'RECEIPT', method: 'VIETQR', amount_vnd: 1000, sepay_tx_id: 9001 }]);

    const again = await sepay(payload);
    expect(again.json.duplicate).toBe(true);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').bind(o.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
    expect((await orderRow(o.id))!.paid_amount).toBe(1000);

    const rest = await sepay({ id: 9002, transferAmount: o.total_amount - 1000, content: o.order_code });
    expect(rest.json.match_status).toBe('PAID');
    expect((await orderRow(o.id))!.payment_status).toBe('PAID');
  });

  it('webhook không khớp mã → UNMATCHED, không tạo payment', async () => {
    const r = await sepay({ id: 9100, transferAmount: 5000, content: 'chuyen tien' });
    expect(r.json.match_status).toBe('UNMATCHED');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('assign giao dịch chưa khớp → đơn PAID, log match_status PAID', async () => {
    const o = await makeOrder();
    await sepay({ id: 9200, transferAmount: o.total_amount, content: 'khong co ma' });

    const list = await send('/sepay/unmatched');
    expect(list.status).toBe(200);
    expect(list.json.data.total).toBe(1);
    expect(list.json.data.items[0].sepay_tx_id).toBe(9200);

    const r = await send('/sepay/9200/assign', 'POST', { order_id: o.id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.payment_status).toBe('PAID');
    const log = await env.DB.prepare('SELECT match_status, matched_order_code FROM sepay_webhook_logs WHERE sepay_tx_id = 9200').first<any>();
    expect(log).toEqual({ match_status: 'PAID', matched_order_code: o.order_code });
    const p = await env.DB.prepare('SELECT method, kind, sepay_tx_id FROM payments WHERE order_id = ?').bind(o.id).first<any>();
    expect(p).toEqual({ method: 'VIETQR', kind: 'RECEIPT', sepay_tx_id: 9200 });
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'sepay.assign'").first<{ n: number }>();
    expect(audit!.n).toBe(1);

    // Gán lần hai: không còn UNMATCHED
    expect((await send('/sepay/9200/assign', 'POST', { order_id: o.id })).status).toBe(409);
    expect((await send('/sepay/424242/assign', 'POST', { order_id: o.id })).status).toBe(404);
    expect((await send('/sepay/unmatched')).json.data.total).toBe(0);
  });
});

describe('SePay assign: đơn đã đóng', () => {
  it('assign vào đơn đã huỷ → 409, log vẫn UNMATCHED, không có payment; đơn không tồn tại → 404', async () => {
    const o = await makeOrder();
    expect((await send(`/orders/${o.id}/transition`, 'POST', { to: 'CANCELLED' })).status).toBe(200);
    await sepay({ id: 9300, transferAmount: 1000, content: 'khong ma' });
    const r = await send('/sepay/9300/assign', 'POST', { order_id: o.id });
    expect(r.status).toBe(409);
    expect(r.json.error!.code).toBe('ORDER_CLOSED');
    const log = await env.DB.prepare('SELECT match_status FROM sepay_webhook_logs WHERE sepay_tx_id = 9300').first<any>();
    expect(log.match_status).toBe('UNMATCHED');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments').first<{ n: number }>();
    expect(n!.n).toBe(0);
    expect((await send('/sepay/9300/assign', 'POST', { order_id: 987654 })).status).toBe(404);
  });
});

describe('đơn sàn', () => {
  it('đơn MARKETPLACE COMPLETED → PAID', async () => {
    const o = await makeOrder({ channel: 'SHOPEE', payment_method: 'MARKETPLACE' });
    for (const to of ['PACKED', 'SHIPPING', 'COMPLETED']) {
      const r = await send(`/orders/${o.id}/transition`, 'POST', { to });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
    const row = await orderRow(o.id);
    expect(row!.payment_status).toBe('PAID');
    expect(row!.paid_amount).toBe(o.total_amount);
    expect(row!.paid_at).not.toBeNull();
    const p = await env.DB.prepare('SELECT kind, method, amount_vnd FROM payments WHERE order_id = ?').bind(o.id).all();
    expect(p.results).toEqual([{ kind: 'RECEIPT', method: 'MARKETPLACE', amount_vnd: o.total_amount }]);
  });

  it('đơn sàn đã thu một phần chỉ tự thu phần còn thiếu; đơn COD không tự thu', async () => {
    const m = await makeOrder({ channel: 'SHOPEE', payment_method: 'MARKETPLACE' });
    await pay(m.id, { kind: 'RECEIPT', amount_vnd: 1000, method: 'MARKETPLACE' });
    const cod = await makeOrder();
    for (const id of [m.id, cod.id]) {
      for (const to of ['PACKED', 'SHIPPING', 'COMPLETED']) {
        expect((await send(`/orders/${id}/transition`, 'POST', { to })).status).toBe(200);
      }
    }
    const rows = await env.DB.prepare('SELECT amount_vnd FROM payments WHERE order_id = ? ORDER BY id').bind(m.id).all();
    expect(rows.results.map((r: any) => r.amount_vnd)).toEqual([1000, m.total_amount - 1000]);
    expect((await orderRow(m.id))!.payment_status).toBe('PAID');
    expect((await orderRow(cod.id))!.payment_status).toBe('UNPAID');
  });

  it('đơn COD hoàn thành không bị tính lại paid_amount/payment_status/paid_at', async () => {
    const cod = await makeOrder();
    await env.DB.prepare(
      "UPDATE orders SET paid_amount = 777, payment_status = 'PARTIAL', paid_at = '2026-01-01 00:00:00' WHERE id = ?",
    ).bind(cod.id).run();
    for (const to of ['PACKED', 'SHIPPING', 'COMPLETED']) {
      expect((await send(`/orders/${cod.id}/transition`, 'POST', { to })).status).toBe(200);
    }
    expect(await orderRow(cod.id)).toMatchObject({ paid_amount: 777, payment_status: 'PARTIAL', paid_at: '2026-01-01 00:00:00' });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').bind(cod.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
