import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import { runPancakeSync } from '../worker/admin/pancake-sync';
import manual from './fixtures/pancake-order-manual.json';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const SHOP = 101119774;
const WH = 'fc4a49e0-0ade-4257-9222-e419baa57ae5';
const DG = 'VK-DEGREASER-500ML';
const NOW = Date.parse('2026-11-16T15:00:00Z');

let env: Env;

/** Pancake giả: danh sách đơn, danh sách mẫu mã, và các lần đẩy tồn nhận được. */
const fake = {
  orders: [] as any[],
  variations: [] as any[],
  pushes: [] as any[],
  orderQueries: [] as URLSearchParams[],
  failOrders: false,
  failPush: false,
  telegram: 0,
};

function shopeeOrder(over: Record<string, any> = {}) {
  return {
    ...structuredClone(manual),
    id: 77,
    marketplace_id: '-3',
    status: 0,
    updated_at: '2026-11-16T14:55:00.000000',
    inserted_at: '2026-11-16T14:54:00.000000',
    additional_info: { booking_sn: 'SN-RECON-1' },
    shipping_address: { ...manual.shipping_address, full_name: 'Chị B', full_address: '1 Trần Phú' },
    items: [{ variation_id: 'v-dg', quantity: 1, variation_info: { display_id: DG, retail_price: 89000 } }],
    ...over,
  };
}

const page = (data: any[]) => ({ success: true, data, page_number: 1, page_size: 100, total_pages: 1, total_entries: data.length });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.assign(fake, { orders: [], variations: [], pushes: [], orderQueries: [], failOrders: false, failPush: false, telegram: 0 });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'api.telegram.org') {
      fake.telegram++;
      return new Response('{"ok":true}');
    }
    expect(url.origin + '/').toBe('https://pos.pages.fm/');
    expect(url.searchParams.get('api_key')).toBe('pk-test');
    if (url.pathname === `/api/v1/shops/${SHOP}/orders`) {
      fake.orderQueries.push(url.searchParams);
      if (fake.failOrders) return new Response('boom', { status: 500 });
      return Response.json(page(fake.orders));
    }
    if (url.pathname === `/api/v1/shops/${SHOP}/products/variations`) return Response.json(page(fake.variations));
    if (url.pathname === `/api/v1/shops/${SHOP}/variations/update_quantity` && init?.method === 'POST') {
      if (fake.failPush) return new Response('boom', { status: 502 });
      fake.pushes.push(JSON.parse(String(init.body)));
      return Response.json({ success: true });
    }
    return new Response('not found', { status: 404 });
  });
  env = await makeEnv({ PANCAKE_API_KEY: 'pk-test' });
  await seedProducts(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('pancake.shop_id', ?)").bind(String(SHOP)),
    env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('pancake.warehouse_id', ?)").bind(WH),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setting = async (key: string) =>
  (await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
const orders = async () => (await env.DB.prepare('SELECT external_order_id, order_status FROM orders').all<any>()).results;

describe('đối soát đơn Pancake (bước 3)', () => {
  it('chưa nạp PANCAKE_API_KEY → không gọi Pancake', async () => {
    env = await makeEnv();
    const r = await runPancakeSync(env);
    expect(r.skipped).toBeTruthy();
    expect(fake.orderQueries).toHaveLength(0);
  });

  it('kéo bù đơn webhook bỏ lỡ, lọc theo updated_at từ lần trước − 5 phút, rồi lưu mốc mới', async () => {
    const last = Math.floor(NOW / 1000) - 900;
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('pancake.last_reconcile_at', ?)").bind(String(last)).run();
    fake.orders = [shopeeOrder()];
    const r = await runPancakeSync(env);
    expect(r.reconcile).toMatchObject({ fetched: 1, created: 1 });
    expect(await orders()).toEqual([{ external_order_id: 'SN-RECON-1', order_status: 'PENDING' }]);
    const q = fake.orderQueries[0];
    expect(q.get('updateStatus')).toBe('updated_at');
    expect(Number(q.get('startDateTime'))).toBe(last - 300);
    expect(Number(q.get('endDateTime'))).toBe(Math.floor(NOW / 1000));
    expect(await setting('pancake.last_reconcile_at')).toBe(String(Math.floor(NOW / 1000)));
    const ev = await env.DB.prepare('SELECT via, result FROM pancake_events').first<any>();
    expect(ev).toEqual({ via: 'RECONCILE', result: 'CREATED' });
  });

  it('chạy lại cùng dữ liệu → không tạo trùng', async () => {
    fake.orders = [shopeeOrder()];
    await runPancakeSync(env);
    await runPancakeSync(env);
    expect(await orders()).toHaveLength(1);
  });

  it('Pancake lỗi → giữ mốc cũ, đếm lỗi; lỗi lần thứ 3 liên tiếp → báo Telegram; thành công thì đặt lại đếm', async () => {
    env.TELEGRAM_BOT_TOKEN = 't';
    env.TELEGRAM_CHAT_ID = 'c';
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('telegram.enabled', 'true')").run();
    fake.failOrders = true;
    await runPancakeSync(env);
    await runPancakeSync(env);
    expect(fake.telegram).toBe(0);
    await runPancakeSync(env);
    expect(fake.telegram).toBe(1);
    expect(await setting('pancake.reconcile_failures')).toBe('3');
    expect(await setting('pancake.last_reconcile_at')).toBeNull();
    fake.failOrders = false;
    await runPancakeSync(env);
    expect(await setting('pancake.reconcile_failures')).toBe('0');
  });
});

describe('đẩy tồn "có thể bán" lên Pancake (bước 4)', () => {
  beforeEach(() => {
    fake.variations = [
      { id: 'v-dg', display_id: DG },
      { id: 'v-la', display_id: 'MA-LA' },
    ];
  });

  it('đẩy số có thể bán theo SKU (display_id) vào kho đã cấu hình, chỉ mẫu mã gán được', async () => {
    const r = await runPancakeSync(env);
    expect(r.stock).toMatchObject({ pushed: 1 });
    expect(fake.pushes).toEqual([
      { is_actual_remain_quantity: false, variations_warehouses: [{ variation_id: 'v-dg', remain_quantity: 100, warehouse_id: WH }] },
    ]);
  });

  it('không đổi → không gửi lại; giữ hàng làm giảm có thể bán → gửi số mới', async () => {
    await runPancakeSync(env);
    await runPancakeSync(env);
    expect(fake.pushes).toHaveLength(1);
    await env.DB.prepare('UPDATE products SET reserved_qty = 3 WHERE sku = ?').bind(DG).run();
    await runPancakeSync(env);
    expect(fake.pushes).toHaveLength(2);
    expect(fake.pushes[1].variations_warehouses[0].remain_quantity).toBe(97);
  });

  it('gán qua channel_sku_map PANCAKE theo variation_id', async () => {
    await env.DB.prepare("INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES ('PANCAKE', 'v-la', ?)").bind(DG).run();
    await runPancakeSync(env);
    expect(fake.pushes[0].variations_warehouses.map((v: any) => v.variation_id).sort()).toEqual(['v-dg', 'v-la']);
  });

  it('Pancake lỗi khi đẩy → lần sau gửi lại', async () => {
    fake.failPush = true;
    const r = await runPancakeSync(env);
    expect(r.stock?.error).toBeTruthy();
    fake.failPush = false;
    await runPancakeSync(env);
    expect(fake.pushes).toHaveLength(1);
  });

  it('chưa cấu hình pancake.warehouse_id → không đẩy', async () => {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = 'pancake.warehouse_id'").run();
    const r = await runPancakeSync(env);
    expect(r.stock?.skipped).toBeTruthy();
    expect(fake.pushes).toHaveLength(0);
  });
});

describe('POST /api/admin/pancake/sync', () => {
  it('ADMIN chạy ngay được; nhân viên không', async () => {
    const admin = await createUser(env.DB, 'ADMIN');
    const res = await api(env, '/pancake/sync', { method: 'POST', body: '{}' }, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveProperty('reconcile');
    expect(body.data).toHaveProperty('stock');
    const staff = await createUser(env.DB, 'STAFF');
    expect((await api(env, '/pancake/sync', { method: 'POST', body: '{}' }, staff)).status).toBe(403);
  });
});
