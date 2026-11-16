import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import manual from './fixtures/pancake-order-manual.json';
import { api, callWorker, createUser, makeEnv, seedProducts } from './helpers';

const KEY = 'pancake-test-key-0123456789';
const SHOP = 101119774;
const DG = 'VK-DEGREASER-500ML';

let env: Env;
let admin: { id: number };
let tick = 0;

beforeEach(async () => {
  env = await makeEnv({ PANCAKE_WEBHOOK_SECRET: KEY });
  await seedProducts(env.DB);
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('pancake.shop_id', ?)").bind(String(SHOP)).run();
  admin = await createUser(env.DB, 'ADMIN');
  tick = 0;
});

afterEach(() => vi.unstubAllGlobals());

function shopee(display = DG, over: Record<string, any> = {}) {
  tick += 1;
  return {
    ...structuredClone(manual),
    id: 50 + tick,
    marketplace_id: '-3',
    status: 0,
    updated_at: `2026-11-16T16:00:${String(tick).padStart(2, '0')}`,
    additional_info: { booking_sn: `SN-${tick}` },
    items: [{ variation_id: `v-${display}`, quantity: 1, variation_info: { display_id: display, retail_price: 89000, name: 'SP' } }],
    ...over,
  };
}

const webhook = (p: unknown) =>
  callWorker(
    new Request('https://test.local/api/webhook/pancake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VK-Key': KEY },
      body: JSON.stringify(p),
    }),
    env,
  );

async function call(path: string, method = 'GET', body?: unknown, user: { id: number } = admin) {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, user);
  return { status: res.status, json: (await res.json()) as any };
}

describe('Cài đặt → Pancake: API', () => {
  it('trạng thái: cấu hình, khoá, số sự kiện 7 ngày, số việc cần xử lý', async () => {
    await webhook(shopee());
    await webhook(shopee('MA-LA'));
    const r = await call('/pancake/status');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({
      shop_id: String(SHOP),
      enabled: true,
      has_api_key: false,
      has_webhook_secret: true,
      open_count: 1,
      counts_7d: { CREATED: 1, NEEDS_MAPPING: 1 },
    });
  });

  it('lưu cài đặt; mã shop sai → 422; nhân viên → 403', async () => {
    const ok = await call('/pancake/settings', 'PUT', { enabled: false, shop_id: '123', warehouse_id: 'wh-1' });
    expect(ok.status).toBe(200);
    expect((await call('/pancake/status')).json.data).toMatchObject({ enabled: false, shop_id: '123', warehouse_id: 'wh-1' });
    expect((await call('/pancake/settings', 'PUT', { enabled: true, shop_id: 'abc', warehouse_id: '' })).status).toBe(422);
    const staff = await createUser(env.DB, 'STAFF');
    expect((await call('/pancake/status', 'GET', undefined, staff)).status).toBe(403);
  });

  it('danh sách sự kiện: lọc việc cần xử lý, tìm theo mã đơn sàn, kèm mã đơn VKINNO', async () => {
    await webhook(shopee());
    await webhook(shopee('MA-LA'));
    const all = await call('/pancake/events');
    expect(all.json.data.total).toBe(2);
    expect(all.json.data.items[1]).toMatchObject({ result: 'CREATED', marketplace_id: '-3', marketplace_order_id: 'SN-1' });
    expect(all.json.data.items[1].order_code).toBeTruthy();
    const open = await call('/pancake/events?open=1');
    expect(open.json.data.items.map((e: any) => e.result)).toEqual(['NEEDS_MAPPING']);
    const found = await call('/pancake/events?q=SN-2');
    expect(found.json.data.total).toBe(1);
  });

  it('gán SKU (kênh PANCAKE) rồi "Xử lý lại" → tạo đơn, hết trong danh sách cần xử lý', async () => {
    await webhook(shopee('MA-LA'));
    const ev = (await call('/pancake/events?open=1')).json.data.items[0];
    const map = await call('/channel-sku-map', 'PUT', { channel: 'PANCAKE', mappings: [{ external_sku: 'v-MA-LA', sku: DG }] });
    expect(map.status).toBe(200);
    const retry = await call(`/pancake/events/${ev.id}/retry`, 'POST', {});
    expect(retry.status).toBe(200);
    expect(retry.json.data.result).toBe('CREATED');
    expect((await call('/pancake/events?open=1')).json.data.total).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>())!.n).toBe(1);
  });

  it('"Đã xử lý" đánh dấu một lần; lần hai → 404', async () => {
    await webhook(shopee('MA-LA'));
    const ev = (await call('/pancake/events?open=1')).json.data.items[0];
    expect((await call(`/pancake/events/${ev.id}/resolve`, 'POST', {})).status).toBe(200);
    expect((await call('/pancake/status')).json.data.open_count).toBe(0);
    expect((await call(`/pancake/events/${ev.id}/resolve`, 'POST', {})).status).toBe(404);
  });

  it('mẫu mã chưa gán: chưa có khoá API → không khả dụng; có khoá → chỉ trả mẫu mã chưa khớp SKU', async () => {
    expect((await call('/pancake/unmapped')).json.data).toEqual({ available: false, items: [] });
    env.PANCAKE_API_KEY = 'pk';
    await env.DB.prepare("INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES ('PANCAKE', 'v-3', ?)").bind(DG).run();
    vi.stubGlobal('fetch', async () =>
      Response.json({
        success: true,
        total_pages: 1,
        data: [
          { id: 'v-1', display_id: DG, product: { name: 'Tẩy dầu' } },
          { id: 'v-2', display_id: 'SHOPEE-XYZ', product: { name: 'Nước lau kính' }, fields: [{ value: '5L' }] },
          { id: 'v-3', display_id: 'KHAC', product: { name: 'Đã gán' } },
        ],
      }),
    );
    const r = await call('/pancake/unmapped');
    expect(r.json.data).toMatchObject({
      available: true,
      items: [{ variation_id: 'v-2', display_id: 'SHOPEE-XYZ', name: 'Nước lau kính', detail: '5L' }],
    });
  });
});
