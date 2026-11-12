import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { api, callWorker, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const BM = 'VK-BOSSMAN-DESCALER-500ML';
const COMBO = 'VK-COMBO-BOSSMAN-VKINNO-500ML';

let env: Env;
let admin: { id: number };
let staff: { id: number };

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
  admin = await createUser(env.DB, 'ADMIN');
  staff = await createUser(env.DB, 'STAFF');
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

const send = async (path: string, method: string, body?: unknown, user: { id: number } = admin) => {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, user);
  return { status: res.status, json: (await res.json()) as Json };
};

const newProduct = (over: object = {}) => ({
  sku: 'VK-NEW-100',
  name: 'Sản phẩm mới',
  slug: 'san-pham-moi',
  price_vnd: 100000,
  listed_price_vnd: 120000,
  ...over,
});

const row = (sku: string) => env.DB.prepare('SELECT * FROM products WHERE sku = ?').bind(sku).first<any>();

function upload(bytes: Uint8Array, type: string, name = 'a.bin', user: { id: number } = admin) {
  const form = new FormData();
  form.set('file', new File([bytes as any], name, { type }));
  return api(env, '/uploads/image', { method: 'POST', body: form }, user);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

describe('sản phẩm', () => {
  it('tạo, đọc, sửa; không đổi được stock_qty/reserved_qty/cost_avg_vnd', async () => {
    const c = await send(
      '/products',
      'POST',
      newProduct({ stock_qty: 99, reserved_qty: 5, cost_avg_vnd: 777, is_active: 1 }),
    );
    expect(c.status).toBe(201);
    expect(c.json.data.sku).toBe('VK-NEW-100');
    expect(await row('VK-NEW-100')).toMatchObject({ stock_qty: 0, reserved_qty: 0, cost_avg_vnd: 0, unit: 'chai' });

    const before = await row(DG);
    const u = await send(`/products/${DG}`, 'PUT', {
      name: 'Tên mới',
      min_stock: 7,
      stock_qty: 5,
      reserved_qty: 3,
      cost_avg_vnd: 1,
    });
    expect(u.status).toBe(200);
    const after = await row(DG);
    expect(after.name).toBe('Tên mới');
    expect(after.min_stock).toBe(7);
    expect(after.stock_qty).toBe(before.stock_qty);
    expect(after.reserved_qty).toBe(before.reserved_qty);
    expect(after.cost_avg_vnd).toBe(before.cost_avg_vnd);
    const audit = await env.DB.prepare('SELECT action FROM audit_logs WHERE entity_id = ?').bind(DG).all();
    expect(audit.results.map((r: any) => r.action)).toContain('product.update');
  });

  it('sku sai định dạng/trùng/đổi sau khi tạo → lỗi', async () => {
    expect((await send('/products', 'POST', newProduct({ sku: 'ab' }))).status).toBe(422);
    expect((await send('/products', 'POST', newProduct({ sku: DG }))).status).toBe(409);
    expect((await send('/products', 'POST', newProduct({ slug: 'x', sku: 'VK-NEW-2' }))).status).toBe(201);
    expect((await send('/products', 'POST', newProduct({ sku: 'VK-NEW-3', slug: 'x' }))).status).toBe(409);
    expect((await send(`/products/${DG}`, 'PUT', { sku: 'VK-OTHER-1' })).status).toBe(422);
    expect((await send('/products/NOPE-123', 'GET')).status).toBe(404);
  });

  it('danh sách theo shape chuẩn, lọc q', async () => {
    const r = await send('/products?q=degreaser&page_size=5', 'GET');
    expect(r.json.data).toMatchObject({ page: 1, page_size: 5 });
    expect(r.json.data.total).toBe(r.json.data.items.length);
    expect(r.json.data.items.map((p: any) => p.sku)).toContain(DG);
  });

  it('STAFF GET products/:sku không có cost_avg_vnd; ADMIN có', async () => {
    const s = await send(`/products/${DG}`, 'GET', undefined, staff);
    expect(s.status).toBe(200);
    expect(s.json.data.sku).toBe(DG);
    expect(s.json.data).not.toHaveProperty('cost_avg_vnd');
    const a = await send(`/products/${DG}`, 'GET');
    expect(a.json.data.cost_avg_vnd).toBe(50000);
  });
});

describe('BOM combo', () => {
  it('đặt BOM hợp lệ cho combo', async () => {
    const r = await send(`/products/${COMBO}/bom`, 'PUT', { items: [{ component_sku: DG, qty_per_combo: 2 }] });
    expect(r.status).toBe(200);
    const rows = await env.DB.prepare('SELECT component_sku, qty_per_combo FROM bom_items WHERE combo_sku = ?')
      .bind(COMBO)
      .all();
    expect(rows.results).toEqual([{ component_sku: DG, qty_per_combo: 2 }]);
    const got = await send(`/products/${COMBO}`, 'GET');
    expect(got.json.data.bom).toEqual([expect.objectContaining({ component_sku: DG, qty_per_combo: 2 })]);
  });

  it('combo lồng combo → 422; tự tham chiếu, thành phần không có, qty ≤ 0, trùng, sản phẩm lẻ → 422', async () => {
    await send('/products', 'POST', newProduct({ sku: 'VK-COMBO-2', slug: 'c2', is_combo: 1 }));
    const bad = [
      [COMBO, [{ component_sku: 'VK-COMBO-2', qty_per_combo: 1 }]],
      [COMBO, [{ component_sku: COMBO, qty_per_combo: 1 }]],
      [COMBO, [{ component_sku: 'KHONG-CO-1', qty_per_combo: 1 }]],
      [COMBO, [{ component_sku: DG, qty_per_combo: 0 }]],
      [
        COMBO,
        [
          { component_sku: DG, qty_per_combo: 1 },
          { component_sku: DG, qty_per_combo: 1 },
        ],
      ],
      [DG, [{ component_sku: BM, qty_per_combo: 1 }]],
    ] as const;
    for (const [sku, items] of bad) {
      const r = await send(`/products/${sku}/bom`, 'PUT', { items });
      expect(r.status, JSON.stringify(items)).toBe(422);
    }
    const kept = await env.DB.prepare('SELECT COUNT(*) AS n FROM bom_items WHERE combo_sku = ?')
      .bind(COMBO)
      .first<any>();
    expect(kept.n).toBe(2);
  });

  it('combo đang có đơn PENDING → 409 BOM_IN_USE', async () => {
    const o = await env.DB.prepare(
      `INSERT INTO orders (order_code, customer_name, customer_phone, shipping_address, subtotal_vnd, shipping_fee_vnd, total_amount, order_status)
       VALUES ('VKTEST1', 'A', '0900000000', 'x', 1, 0, 1, 'PENDING')`,
    ).run();
    await env.DB.prepare(
      'INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total) VALUES (?, ?, ?, 1, 1, 1)',
    )
      .bind(o.meta.last_row_id, COMBO, 'c')
      .run();
    const r = await send(`/products/${COMBO}/bom`, 'PUT', { items: [{ component_sku: DG, qty_per_combo: 1 }] });
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('BOM_IN_USE');
  });
});

describe('upload ảnh', () => {
  it('file 6 MB → 413', async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG);
    const res = await upload(big, 'image/png');
    expect(res.status).toBe(413);
    expect(((await res.json()) as Json).error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('text/plain → 415; khai png nhưng nội dung không phải ảnh → 415', async () => {
    const t = await upload(new TextEncoder().encode('hello'), 'text/plain', 'a.txt');
    expect(t.status).toBe(415);
    expect(((await t.json()) as Json).error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await upload(new TextEncoder().encode('<script>alert(1)</script>'), 'image/png')).status).toBe(415);
  });

  it('png → GET /files/<key> trả đúng bytes và header cache', async () => {
    const res = await upload(PNG, 'image/png');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Json;
    expect(data.key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(data.url).toBe(`/files/${data.key}`);
    const got = await callWorker(new Request(`https://test.local${data.url}`), env);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/png');
    expect(got.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
    const audit = await env.DB.prepare("SELECT 1 FROM audit_logs WHERE action = 'upload.image'").first();
    expect(audit).toBeTruthy();
  });

  it('/files: thiếu → 404, chứa .. → 404, không phục vụ khoá ngoài products/', async () => {
    expect((await callWorker(new Request('https://test.local/files/products/none.png'), env)).status).toBe(404);
    expect(
      (await callWorker(new Request('https://test.local/files/products/..%2Fbackups/x.json.gz'), env)).status,
    ).toBe(404);
    await env.FILES.put('backups/2026-01-01.json.gz', 'secret');
    expect((await callWorker(new Request('https://test.local/files/backups/2026-01-01.json.gz'), env)).status).toBe(
      404,
    );
  });

  describe('giới hạn kích thước khi đọc thân', () => {
    async function multipart(size: number) {
      const bytes = new Uint8Array(size);
      bytes.set(PNG);
      const form = new FormData();
      form.set('file', new File([bytes as any], 'a.png', { type: 'image/png' }));
      const res = new Response(form);
      return { type: res.headers.get('content-type') as string, bytes: new Uint8Array(await res.arrayBuffer()) };
    }
    const streamOf = (bytes: Uint8Array, state: { pulls: number }) => {
      let at = 0;
      return new ReadableStream<Uint8Array>({
        pull(ctrl) {
          state.pulls += 1;
          if (at >= bytes.length) return ctrl.close();
          ctrl.enqueue(bytes.slice(at, at + 65536));
          at += 65536;
        },
      }, { highWaterMark: 0 });
    };
    const post = (body: ReadableStream, headers: Record<string, string>) =>
      api(env, '/uploads/image', { method: 'POST', body, headers, duplex: 'half' } as RequestInit, admin);

    it('Content-Length vượt giới hạn → 413 mà không đọc thân', async () => {
      const m = await multipart(100);
      const state = { pulls: 0 };
      const res = await post(streamOf(m.bytes, state), {
        'Content-Type': m.type,
        'Content-Length': String(6 * 1024 * 1024),
      });
      expect(res.status).toBe(413);
      expect(state.pulls).toBe(0);
    });

    it('thân chunked (không Content-Length) vượt giới hạn → 413', async () => {
      const m = await multipart(6 * 1024 * 1024);
      const res = await post(streamOf(m.bytes, { pulls: 0 }), { 'Content-Type': m.type });
      expect(res.status).toBe(413);
    });

    it('png hợp lệ không có Content-Length vẫn tải được', async () => {
      const m = await multipart(1000);
      const res = await post(streamOf(m.bytes, { pulls: 0 }), { 'Content-Type': m.type });
      expect(res.status).toBe(200);
    });
  });

  it('chưa đăng nhập → 401', async () => {
    const form = new FormData();
    form.set('file', new File([PNG as any], 'a.png', { type: 'image/png' }));
    const res = await api(env, '/uploads/image', { method: 'POST', body: form });
    expect(res.status).toBe(401);
  });
});

const receipt = async (sku: string, qty: number, batch: string, expiry: string) => {
  const c = await send('/stock-docs', 'POST', {
    type: 'RECEIPT',
    lines: [{ sku, qty, unit_cost_vnd: 1000, batch_code: batch, expiry_date: expiry }],
  });
  expect(c.status).toBe(201);
  const p = await send(`/stock-docs/${c.json.data.id}/post`, 'POST', {});
  expect(p.status).toBe(200);
};
const isoIn = (days: number) => new Date(Date.now() + 7 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);

describe('tồn kho và cảnh báo', () => {
  it('inventory: shape, lọc q/low; STAFF không thấy cost', async () => {
    const r = await send('/inventory?q=degreaser', 'GET');
    expect(r.json.data).toMatchObject({ total: 1, page: 1 });
    expect(r.json.data.items[0]).toMatchObject({
      sku: DG,
      stock: 100,
      reserved: 0,
      available: 100,
      is_combo: 0,
      is_active: 1,
      cost_avg_vnd: 50000,
    });
    await env.DB.prepare('UPDATE products SET min_stock = 200 WHERE sku = ?').bind(DG).run();
    const low = await send('/inventory?low=1', 'GET');
    expect(low.json.data.items.map((i: any) => i.sku)).toContain(DG);
    expect(low.json.data.total).toBe(low.json.data.items.length);
    const s = await send('/inventory?q=degreaser', 'GET', undefined, staff);
    expect(s.json.data.items[0]).not.toHaveProperty('cost_avg_vnd');
  });

  it('alerts.low_stock gồm SKU có available < min_stock', async () => {
    await env.DB.prepare('UPDATE products SET min_stock = 150 WHERE sku = ?').bind(BM).run();
    const r = await send('/inventory/alerts', 'GET');
    const skus = r.json.data.low_stock.map((i: any) => i.sku);
    expect(skus).toContain(BM);
    expect(skus).not.toContain(DG);
    expect(r.json.data.expiring).toEqual([]);
  });

  it('alerts.expiring theo FIFO: nhập lô A (hết hạn sớm) rồi lô B, xuất hết lượng lô A → chỉ còn lô B', async () => {
    await env.DB.prepare('UPDATE products SET stock_qty = 0, cost_avg_vnd = 0 WHERE sku = ?').bind(DG).run();
    await receipt(DG, 10, 'A', isoIn(10));
    let r = await send('/inventory/alerts', 'GET');
    expect(r.json.data.expiring.map((l: any) => l.batch_code)).toEqual(['A']);
    await receipt(DG, 20, 'B', isoIn(30));
    r = await send('/inventory/alerts', 'GET');
    expect(r.json.data.expiring.map((l: any) => [l.batch_code, l.qty])).toEqual([
      ['A', 10],
      ['B', 20],
    ]);
    const x = await send('/stock-docs', 'POST', { type: 'ISSUE', lines: [{ sku: DG, qty: 10 }] });
    await send(`/stock-docs/${x.json.data.id}/post`, 'POST', {});
    r = await send('/inventory/alerts', 'GET');
    expect(r.json.data.expiring).toMatchObject([{ sku: DG, batch_code: 'B', qty: 20 }]);
  });

  it('lô hết hạn xa hơn 60 ngày không vào danh sách; đã hết hạn thì có', async () => {
    await env.DB.prepare('UPDATE products SET stock_qty = 0, cost_avg_vnd = 0 WHERE sku = ?').bind(DG).run();
    await receipt(DG, 5, 'FAR', isoIn(61));
    await receipt(DG, 5, 'OLD', isoIn(-3));
    const r = await send('/inventory/alerts', 'GET');
    expect(r.json.data.expiring.map((l: any) => l.batch_code)).toEqual(['OLD']);
  });

  it('ledger theo sku và khoảng ngày', async () => {
    await receipt(DG, 5, 'A', '');
    const r = await send(`/inventory/${DG}/ledger`, 'GET');
    expect(r.json.data.items[0]).toMatchObject({ sku: DG, delta: 5, reason: 'RECEIPT' });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_logs WHERE sku = ?').bind(DG).first<any>();
    expect(r.json.data).toMatchObject({ total: n.n, page: 1 });
    expect(r.json.data.items).toHaveLength(n.n);
    const none = await send(`/inventory/${DG}/ledger?from=2000-01-01&to=2000-01-02`, 'GET');
    expect(none.json.data.items).toEqual([]);
    expect((await send('/inventory/NOPE-123/ledger', 'GET')).status).toBe(404);
  });
});
