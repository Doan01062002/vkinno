import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import { api, callWorker, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const COMBO = 'VK-COMBO-BOSSMAN-VKINNO-500ML';

let env: Env;

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
});

const webBody = (over: Record<string, unknown> = {}) => ({
  du_an: 'chu-dong-vkinno',
  privacy_consent: true,
  customer_name: 'Chị Lan',
  customer_phone: '0912345678',
  shipping_address: '12 Lê Lợi, Quận 1, TP.HCM',
  payment_method: 'VIETQR',
  items: [{ sku: DG, quantity: 2 }],
  ...over,
});

const post = async (body: unknown) => {
  const res = await callWorker(
    new Request('https://test.local/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, json: (await res.json()) as any };
};

const stock = (sku: string) =>
  env.DB.prepare('SELECT stock_qty, reserved_qty FROM products WHERE sku = ?').bind(sku).first<{
    stock_qty: number;
    reserved_qty: number;
  }>();

describe('POST /api/orders (web)', () => {
  it('đặt đơn web → source WEB, giữ hàng, phản hồi có vietqr_url và order_code', async () => {
    const { status, json } = await post(webBody());
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.order.order_code).toMatch(/^VK/);
    expect(json.order.vietqr_url).toContain(`addInfo=${json.order.order_code}`);
    expect(json.order.order_status).toBe('PENDING');
    const row = await env.DB.prepare('SELECT * FROM orders WHERE order_code = ?')
      .bind(json.order.order_code)
      .first<any>();
    expect(row.source).toBe('WEB');
    expect(row.channel).toBe('WEB');
    expect(row.privacy_consent).toBe(1);
    expect(row.total_amount).toBe(json.order.total_amount);
    expect((await stock(DG))!.reserved_qty).toBe(2);
    expect((await stock(DG))!.stock_qty).toBe(100);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').bind(row.id).first<any>();
    expect(n.n).toBe(1);
  });

  it('đặt vượt có thể bán → 409 kèm thông báo tiếng Việt, không tạo đơn', async () => {
    await env.DB.prepare('UPDATE products SET stock_qty = 10 WHERE sku = ?').bind(DG).run();
    const { status, json } = await post(webBody({ items: [{ sku: DG, quantity: 11 }] }));
    expect(status).toBe(409);
    expect(json.ok).toBe(false);
    expect(typeof json.error).toBe('string');
    expect(json.error).toContain('chỉ còn 10 có thể bán');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(0);
    expect((await stock(DG))!.reserved_qty).toBe(0);
  });

  it('đơn đã giữ hàng thì đơn sau chỉ còn phần có thể bán', async () => {
    await env.DB.prepare('UPDATE products SET stock_qty = 10 WHERE sku = ?').bind(DG).run();
    expect((await post(webBody({ items: [{ sku: DG, quantity: 9 }] }))).status).toBe(201);
    const r = await post(webBody({ items: [{ sku: DG, quantity: 2 }] }));
    expect(r.status).toBe(409);
    expect(r.json.error).toContain('chỉ còn 1 có thể bán');
  });

  it('đơn ≥ 199000 miễn ship, dưới đó phí 25000', async () => {
    const small = await post(webBody({ items: [{ sku: DG, quantity: 1 }] }));
    const subSmall = small.json.order.subtotal_vnd;
    expect(subSmall).toBeLessThan(199000);
    expect(small.json.order.shipping_fee_vnd).toBe(25000);
    expect(small.json.order.total_amount).toBe(subSmall + 25000);

    const big = await post(webBody({ items: [{ sku: COMBO, quantity: 2 }] }));
    expect(big.json.order.subtotal_vnd).toBeGreaterThanOrEqual(199000);
    expect(big.json.order.shipping_fee_vnd).toBe(0);
    expect(big.json.order.total_amount).toBe(big.json.order.subtotal_vnd);
  });

  it('voucher giảm 10% được lưu; mã sai → 400', async () => {
    const ok = await post(webBody({ voucher_code: 'vkinno10', items: [{ sku: COMBO, quantity: 2 }] }));
    expect(ok.status).toBe(201);
    expect(ok.json.order.voucher_code).toBe('VKINNO10');
    expect(ok.json.order.discount_vnd).toBe(Math.round(ok.json.order.subtotal_vnd * 0.1));
    const bad = await post(webBody({ voucher_code: 'SAIMA' }));
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('SAIMA');
  });

  it('quá 20 đơn vị một SKU (kể cả gộp dòng) → 422, không tạo đơn, không giữ hàng', async () => {
    const over = await post(webBody({ items: [{ sku: DG, quantity: 21 }] }));
    expect(over.status).toBe(422);
    expect(over.json.ok).toBe(false);
    expect(typeof over.json.error).toBe('string');
    expect(over.json.error).toContain('20');
    const merged = await post(webBody({ items: [{ sku: DG, quantity: 15 }, { sku: DG, quantity: 6 }] }));
    expect(merged.status).toBe(422);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(0);
    expect((await stock(DG))!.reserved_qty).toBe(0);
    expect((await post(webBody({ items: [{ sku: DG, quantity: 20 }] }))).status).toBe(201);
  });

  it('quá 100 đơn vị cả đơn → 422', async () => {
    const skus = (await env.DB.prepare('SELECT sku FROM products WHERE is_combo = 0 ORDER BY product_id').all<any>()).results.map(
      (r: any) => r.sku,
    );
    expect(skus.length).toBeGreaterThanOrEqual(6);
    const items = skus.slice(0, 6).map((sku: string) => ({ sku, quantity: 17 })); // 102 đơn vị, mỗi SKU ≤ 20
    const r = await post(webBody({ items }));
    expect(r.status).toBe(422);
    expect(r.json.error).toContain('100');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<any>()).n).toBe(0);
  });

  it('đơn web hiện trong danh sách quản trị với source WEB và voucher_code', async () => {
    const admin = await createUser(env.DB, 'ADMIN');
    const placed = await post(webBody({ voucher_code: 'KHACHCU10' }));
    expect(placed.status).toBe(201);
    const res = await api(env, '/orders?channel=WEB', {}, admin);
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    const row = json.data.items.find((o: any) => o.order_code === placed.json.order.order_code);
    expect(row).toBeTruthy();
    expect(row.source).toBe('WEB');
    expect(row.voucher_code).toBe('KHACHCU10');
  });
});

describe('đồng bộ Google Sheets', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('một đơn web chỉ gửi đúng 1 yêu cầu tới Sheets', async () => {
    const sheetsUrl = 'https://script.google.com/macros/s/test/exec';
    env = await makeEnv({ GOOGLE_SCRIPT_WEBHOOK_URL: sheetsUrl });
    await seedProducts(env.DB);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      calls.push(String(url));
      return new Response('{}', { status: 200 });
    });
    expect((await post(webBody())).status).toBe(201);
    expect(calls.filter((u) => u === sheetsUrl)).toHaveLength(1);
  });
});

describe('GET /api/products.json', () => {
  it('available_stock giảm sau khi đặt (kể cả combo)', async () => {
    const get = async () => {
      const res = await callWorker(new Request('https://test.local/api/products.json'), env);
      const json = (await res.json()) as any;
      return new Map<string, number>(json.products.map((p: any) => [p.sku, p.available_stock]));
    };
    const before = await get();
    expect(before.get(DG)).toBe(100);
    expect(before.get(COMBO)).toBe(100);
    expect((await post(webBody({ items: [{ sku: DG, quantity: 3 }] }))).status).toBe(201);
    const after = await get();
    expect(after.get(DG)).toBe(97);
    expect(after.get(COMBO)).toBe(97);
  });

  it('sản phẩm ngừng bán (is_active = 0) vẫn có trong danh sách nhưng available_stock = 0', async () => {
    await env.DB.prepare('UPDATE products SET is_active = 0 WHERE sku IN (?, ?)').bind(DG, COMBO).run();
    const res = await callWorker(new Request('https://test.local/api/products.json'), env);
    const json = (await res.json()) as any;
    const bySku = new Map<string, any>(json.products.map((p: any) => [p.sku, p]));
    expect(bySku.get(DG).available_stock).toBe(0);
    expect(bySku.get(COMBO).available_stock).toBe(0);
    expect(bySku.get('VK-BOSSMAN-DESCALER-500ML').available_stock).toBe(100);
    expect(json.products).toHaveLength(9);
  });
});
