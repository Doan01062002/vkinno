import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import manual from './fixtures/pancake-order-manual.json';
import { callWorker, makeEnv, seedProducts } from './helpers';

const KEY = 'pancake-test-key-0123456789';
const SHOP = 101119774;
const DG = 'VK-DEGREASER-500ML';

let env: Env;
let tick = 0;

beforeEach(async () => {
  env = await makeEnv({ PANCAKE_WEBHOOK_SECRET: KEY });
  await seedProducts(env.DB);
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('pancake.shop_id', ?)").bind(String(SHOP)).run();
  tick = 0;
});

type Payload = Record<string, any>;

/** Đơn Shopee dựng từ payload thật (đơn tạo tay #1), mỗi lần gọi có `updated_at` mới hơn. */
function shopee(over: Payload = {}): Payload {
  tick += 1;
  return {
    ...structuredClone(manual),
    id: 42,
    marketplace_id: '-3',
    is_from_ecommerce: true,
    status: 0,
    updated_at: `2026-11-16T14:00:${String(tick).padStart(2, '0')}.000000`,
    inserted_at: '2026-11-16T13:59:00.000000',
    bill_full_name: 'Nguyễn Văn A',
    bill_phone_number: '******678',
    shipping_address: { ...manual.shipping_address, full_name: 'Nguyễn Văn A', phone_number: '******678', full_address: '12 Lê Lợi, Q1, TP.HCM' },
    shipping_fee: 15000,
    total_discount: 0,
    additional_info: { ...manual.additional_info, booking_sn: '251116ABCDEF' },
    items: [
      {
        id: 1,
        variation_id: 'var-dg-500',
        quantity: 2,
        discount_each_product: 5000,
        is_bonus_product: false,
        is_discount_percent: false,
        variation_info: { id: 'var-dg-500', display_id: DG, name: 'Xịt tẩy dầu mỡ 500ml', retail_price: 89000 },
      },
    ],
    ...over,
  };
}

async function send(p: Payload | string, key = KEY): Promise<Response> {
  return callWorker(
    new Request('https://test.local/api/webhook/pancake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VK-Key': key },
      body: typeof p === 'string' ? p : JSON.stringify(p),
    }),
    env,
  );
}

const orders = async () =>
  (
    await env.DB.prepare(
      'SELECT id, order_code, external_order_id, channel, order_status, payment_status, shipping_fee_vnd, source FROM orders ORDER BY id',
    ).all<any>()
  ).results;

const events = async () =>
  (await env.DB.prepare('SELECT pancake_order_id, status, result, message, order_id, via FROM pancake_events ORDER BY id').all<any>())
    .results;

const reserved = async (sku = DG) =>
  (await env.DB.prepare('SELECT reserved_qty, stock_qty FROM products WHERE sku = ?').bind(sku).first<any>())!;

const items = async (orderId: number) =>
  (await env.DB.prepare('SELECT sku, quantity, unit_price FROM order_items WHERE order_id = ?').bind(orderId).all<any>()).results;

describe('webhook Pancake → đơn VKINNO', () => {
  it('đơn Shopee mới → đơn PENDING giữ hàng, mã sàn = booking_sn, giá sau giảm từng sản phẩm', async () => {
    const res = await send(shopee());
    expect(res.status).toBe(200);
    const [o] = await orders();
    expect(o).toMatchObject({
      external_order_id: '251116ABCDEF',
      channel: 'SHOPEE',
      order_status: 'PENDING',
      shipping_fee_vnd: 15000,
    });
    expect(await items(o.id)).toEqual([{ sku: DG, quantity: 2, unit_price: 84000 }]);
    expect((await reserved()).reserved_qty).toBe(2);
    expect(await events()).toEqual([
      expect.objectContaining({ pancake_order_id: `${SHOP}-42`, status: 0, result: 'CREATED', order_id: o.id, via: 'WEBHOOK' }),
    ]);
  });

  it('không có booking_sn → mã sàn PCK-<shop>-<id>', async () => {
    await send(shopee({ additional_info: { booking_sn: null } }));
    expect((await orders())[0].external_order_id).toBe(`PCK-${SHOP}-42`);
  });

  it('gửi lại y hệt → vẫn một đơn, một sự kiện', async () => {
    const p = shopee();
    expect((await send(p)).status).toBe(200);
    expect((await send(p)).status).toBe(200);
    expect(await orders()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
    expect((await reserved()).reserved_qty).toBe(2);
  });

  it('đơn đã nhập bằng file (cùng mã sàn) → không tạo lại, gắn sự kiện vào đơn cũ', async () => {
    await send(shopee());
    await env.DB.prepare('DELETE FROM pancake_events').run();
    await send(shopee());
    expect(await orders()).toHaveLength(1);
    expect((await events())[0]).toMatchObject({ result: 'SKIPPED' });
  });

  it('đơn tạo tay trong Pancake (marketplace_id null) → bỏ qua', async () => {
    const res = await send({ ...manual, updated_at: '2026-11-16T14:10:00' });
    expect(res.status).toBe(200);
    expect(await orders()).toHaveLength(0);
    expect((await events())[0]).toMatchObject({ result: 'SKIPPED' });
  });

  it('shop khác → bỏ qua; Lazada → bỏ qua (chưa hỗ trợ)', async () => {
    await send(shopee({ shop_id: 999 }));
    await send(shopee({ id: 43, marketplace_id: '-4' }));
    expect(await orders()).toHaveLength(0);
    expect((await events()).map((e) => e.result)).toEqual(['SKIPPED', 'SKIPPED']);
  });

  it('TikTok (-9) → kênh TIKTOK', async () => {
    await send(shopee({ marketplace_id: '-9' }));
    expect((await orders())[0].channel).toBe('TIKTOK');
  });

  it('SKU chưa gán → NEEDS_MAPPING; gán qua channel_sku_map PANCAKE rồi gửi lại thì tạo được', async () => {
    const unknown = shopee();
    unknown.items[0].variation_info.display_id = 'MA-LA';
    await send(unknown);
    expect(await orders()).toHaveLength(0);
    expect((await events())[0]).toMatchObject({ result: 'NEEDS_MAPPING' });
    expect((await events())[0].message).toContain('MA-LA');

    await env.DB.prepare("INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES ('PANCAKE', 'var-dg-500', ?)").bind(DG).run();
    const again = shopee();
    again.items[0].variation_info.display_id = 'MA-LA';
    await send(again);
    expect(await orders()).toHaveLength(1);
  });

  it('quà tặng (is_bonus_product) → giá 0', async () => {
    const p = shopee();
    p.items.push({ ...p.items[0], id: 2, quantity: 1, is_bonus_product: true });
    await send(p);
    const [o] = await orders();
    expect(await items(o.id)).toEqual(
      expect.arrayContaining([
        { sku: DG, quantity: 2, unit_price: 84000 },
        { sku: DG, quantity: 1, unit_price: 0 },
      ]),
    );
  });

  it('đi tiến nhiều bước: 0 → 2 (Đã gửi) → 3 (Đã nhận) = PENDING → SHIPPING → COMPLETED, đã thu', async () => {
    await send(shopee());
    await send(shopee({ status: 2 }));
    let [o] = await orders();
    expect(o.order_status).toBe('SHIPPING');
    const r = await reserved();
    expect(r).toMatchObject({ reserved_qty: 0, stock_qty: 98 });
    await send(shopee({ status: 3 }));
    [o] = await orders();
    expect(o).toMatchObject({ order_status: 'COMPLETED', payment_status: 'PAID' });
    expect((await events()).map((e) => e.result)).toEqual(['CREATED', 'UPDATED', 'UPDATED']);
  });

  it('lần đầu thấy đơn ở trạng thái 3 → tạo thẳng COMPLETED, trừ kho', async () => {
    await send(shopee({ status: 3 }));
    const [o] = await orders();
    expect(o).toMatchObject({ order_status: 'COMPLETED', payment_status: 'PAID' });
    expect(await reserved()).toMatchObject({ reserved_qty: 0, stock_qty: 98 });
  });

  it('huỷ khi còn PENDING → CANCELLED, trả hàng giữ', async () => {
    await send(shopee());
    await send(shopee({ status: 6 }));
    expect((await orders())[0].order_status).toBe('CANCELLED');
    expect((await reserved()).reserved_qty).toBe(0);
  });

  it('lần đầu thấy đơn đã huỷ / đã xoá → không tạo', async () => {
    await send(shopee({ status: 6 }));
    await send(shopee({ id: 44, status: 7 }));
    expect(await orders()).toHaveLength(0);
    expect((await events()).map((e) => e.result)).toEqual(['SKIPPED', 'SKIPPED']);
  });

  it('huỷ khi đơn đã SHIPPING → giữ nguyên, cần người xử lý', async () => {
    await send(shopee({ status: 2 }));
    await send(shopee({ status: 6 }));
    expect((await orders())[0].order_status).toBe('SHIPPING');
    expect((await events())[1]).toMatchObject({ result: 'NEEDS_ATTENTION' });
  });

  it('đang hoàn / đã hoàn → không đổi kho, cần người xử lý', async () => {
    await send(shopee({ status: 3 }));
    await send(shopee({ status: 4 }));
    await send(shopee({ status: 5 }));
    expect((await orders())[0].order_status).toBe('COMPLETED');
    expect((await reserved()).stock_qty).toBe(98);
    expect((await events()).slice(1).map((e) => e.result)).toEqual(['NEEDS_ATTENTION', 'NEEDS_ATTENTION']);
  });

  it('trạng thái lùi so với admin → bỏ qua', async () => {
    await send(shopee({ status: 2 }));
    await send(shopee({ status: 1 }));
    expect((await orders())[0].order_status).toBe('SHIPPING');
    expect((await events())[1]).toMatchObject({ result: 'SKIPPED' });
  });

  it('thiếu hàng → ERROR, không tạo đơn, vẫn trả 200', async () => {
    const p = shopee();
    p.items[0].quantity = 1000;
    expect((await send(p)).status).toBe(200);
    expect(await orders()).toHaveLength(0);
    expect((await events())[0]).toMatchObject({ result: 'ERROR' });
  });

  it('payload sai cấu trúc → ERROR (vẫn lưu), JSON hỏng → 400', async () => {
    expect((await send({ hello: 'world' })).status).toBe(200);
    expect((await events())[0]).toMatchObject({ result: 'ERROR' });
    expect((await send('{not json')).status).toBe(400);
  });

  it('pancake.enabled = 0 → 503, không xử lý', async () => {
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('pancake.enabled', '0')").run();
    expect((await send(shopee())).status).toBe(503);
    expect(await orders()).toHaveLength(0);
  });

  it('chưa cấu hình pancake.shop_id → bỏ qua', async () => {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = 'pancake.shop_id'").run();
    await send(shopee());
    expect(await orders()).toHaveLength(0);
    expect((await events())[0]).toMatchObject({ result: 'SKIPPED' });
  });
});
