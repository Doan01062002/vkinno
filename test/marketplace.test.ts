import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMN_MAPS,
  MAX_IMPORT_ORDERS_PER_REQUEST,
  parseMarketplaceRows,
  parseOrderDate,
  parseVnd,
  type Channel,
  type ImportOrder,
} from '../src/shared/marketplace';
import { createOrder } from '../worker/admin/orders';
import type { Env } from '../worker/index';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const DEG = 'VK-DEGREASER-500ML';
const VISION = 'VK-VISIONX-CLEAN-500ML';

/** CSV tối thiểu: dấu ngoặc kép, dấu phẩy và dấu ngoặc kép lồng ("") trong ô. */
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(join(__dirname, 'fixtures', file), 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const parseFixture = (channel: Channel, file: string) =>
  parseMarketplaceRows(channel, readCsv(file), DEFAULT_COLUMN_MAPS[channel]);

let env: Env;
let admin: { id: number };

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
  admin = await createUser(env.DB, 'ADMIN');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES ('SHOPEE', 'SHP-DEG-500', ?)").bind(DEG),
    env.DB.prepare("INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES ('TIKTOK', 'TT-DEG-500', ?)").bind(DEG),
  ]);
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function send(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, admin);
  return { status: res.status, json: (await res.json()) as Json };
}

const doImport = (channel: Channel, orders: ImportOrder[], file_name = 'x.csv') =>
  send('/orders/import', 'POST', { channel, file_name, orders });

const stock = async (sku: string) =>
  (await env.DB.prepare('SELECT stock_qty, reserved_qty FROM products WHERE sku = ?').bind(sku).first<{ stock_qty: number; reserved_qty: number }>())!;

const orderByExt = (ext: string) =>
  env.DB.prepare('SELECT * FROM orders WHERE external_order_id = ?').bind(ext).first<any>();

function order(over: Partial<ImportOrder> = {}): ImportOrder {
  return {
    external_order_id: 'EXT-1',
    created_at: '2026-11-01 02:00:00',
    status: 'PENDING',
    buyer_name: 'Nguyễn A',
    buyer_phone: '0912345678',
    address: '1 Lê Lợi',
    shipping_fee_vnd: 0,
    items: [{ external_sku: DEG, product_name: 'Tẩy dầu', quantity: 1, unit_price: 150000 }],
    ...over,
  };
}

describe('parseMarketplaceRows', () => {
  it('parse gộp 2 dòng cùng mã đơn thành 1 đơn 2 sản phẩm', () => {
    const { orders, errors } = parseFixture('SHOPEE', 'shopee-sample.csv');
    expect(errors).toEqual([]);
    const o = orders.find((x) => x.external_order_id === 'SP1001')!;
    expect(orders.filter((x) => x.external_order_id === 'SP1001')).toHaveLength(1);
    expect(o.items).toEqual([
      { external_sku: 'SHP-DEG-500', product_name: 'Tẩy dầu mỡ 500ml', quantity: 2, unit_price: 150000 },
      { external_sku: VISION, product_name: 'Nước lau kính 500ml', quantity: 1, unit_price: 120000 },
    ]);
    expect(o.status).toBe('COMPLETED');
    expect(o.shipping_fee_vnd).toBe(25000);
    expect(o.buyer_name).toBe('Nguyễn Thị Lan');
    expect(o.address).toBe('12 Lê Lợi, Quận 1, TP.HCM');
    expect(orders).toHaveLength(4);
    expect(o.created_at).toBe('2026-11-01 02:15:00');
  });

  it('trạng thái "Đã hủy" → SKIP', () => {
    const { orders } = parseFixture('SHOPEE', 'shopee-sample.csv');
    expect(orders.find((x) => x.external_order_id === 'SP1002')!.status).toBe('SKIP');
    expect(orders.find((x) => x.external_order_id === 'SP1003')!.status).toBe('SHIPPING');
    expect(orders.find((x) => x.external_order_id === 'SP1004')!.status).toBe('PENDING');
    const tt = parseFixture('TIKTOK', 'tiktok-sample.csv');
    expect(tt.errors).toEqual([]);
    expect(tt.orders.map((o) => [o.external_order_id, o.status])).toEqual([
      ['TT2001', 'COMPLETED'],
      ['TT2002', 'SHIPPING'],
      ['TT2003', 'SKIP'],
    ]);
    expect(tt.orders[1].items[0].unit_price).toBe(450000);
  });

  it('thiếu cột bắt buộc → errors có số dòng', () => {
    const rows = readCsv('shopee-sample.csv').map(({ 'Số lượng': _q, ...rest }) => rest);
    const { orders, errors } = parseMarketplaceRows('SHOPEE', rows, DEFAULT_COLUMN_MAPS.SHOPEE);
    expect(orders).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].message).toContain('Số lượng');
  });

  it('giá trị dòng sai → lỗi kèm số dòng, cả đơn đó bị loại, đơn khác vẫn parse', () => {
    const rows = readCsv('shopee-sample.csv');
    rows[1]['Giá ưu đãi'] = 'abc'; // dòng 3 của file (dòng 1 là tiêu đề), thuộc SP1001
    const { orders, errors } = parseMarketplaceRows('SHOPEE', rows, DEFAULT_COLUMN_MAPS.SHOPEE);
    expect(errors.map((e) => e.row)).toEqual([3]);
    expect(orders.find((o) => o.external_order_id === 'SP1001')).toBeUndefined();
    expect(orders.find((o) => o.external_order_id === 'SP1003')).toBeDefined();
  });

  it('trạng thái lạ → lỗi dòng', () => {
    const rows = readCsv('shopee-sample.csv');
    rows[3]['Trạng Thái Đơn Hàng'] = 'Trạng thái lạ';
    const { errors } = parseMarketplaceRows('SHOPEE', rows, DEFAULT_COLUMN_MAPS.SHOPEE);
    expect(errors.map((e) => e.row)).toEqual([5]);
  });

  it('parseVnd: dấu phân cách nghìn và ₫', () => {
    expect(parseVnd('1.250.000')).toBe(1250000);
    expect(parseVnd('1,250,000')).toBe(1250000);
    expect(parseVnd('₫120.000')).toBe(120000);
    expect(parseVnd('150000 ₫')).toBe(150000);
    expect(parseVnd(' 0 ')).toBe(0);
    expect(parseVnd('1.5')).toBeNull();
    expect(parseVnd('abc')).toBeNull();
    expect(parseVnd('')).toBeNull();
  });
});

describe('POST /orders/import', () => {
  it('đi qua router, không bị route orders/:id bắt', async () => {
    const preview = await send('/orders/import/preview', 'POST', { channel: 'SHOPEE', orders: [order()] });
    expect(preview.status).toBe(200);
    const imp = await doImport('SHOPEE', [order()]);
    expect(imp.status).toBe(200);
    expect(imp.json.data.created).toBe(1);
    // GET orders/:id vẫn hoạt động bình thường
    const o = await orderByExt('EXT-1');
    expect((await send(`/orders/${o.id}`)).status).toBe(200);
  });

  it('import 2 lần cùng dữ liệu → lần 2 created 0, skipped_duplicates = n', async () => {
    const { orders } = parseFixture('SHOPEE', 'shopee-sample.csv');
    const ok = orders.filter((o) => o.external_order_id !== 'SP1004'); // bỏ đơn SKU chưa ánh xạ
    const first = await doImport('SHOPEE', ok);
    expect(first.json.data).toMatchObject({ created: 2, skipped_duplicates: 0, errors: [] });
    const second = await doImport('SHOPEE', ok);
    expect(second.json.data).toMatchObject({ created: 0, skipped_duplicates: 2, errors: [] });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>())!.n).toBe(2);
  });

  it('trùng mã ngay trong một lần gửi (đua UNIQUE) → tính là bỏ qua trùng', async () => {
    const r = await doImport('SHOPEE', [order(), order()]);
    expect(r.json.data).toMatchObject({ created: 1, skipped_duplicates: 1, errors: [] });
  });

  it('SKU chưa ánh xạ → preview báo, import đơn đó vào errors, đơn khác vẫn tạo', async () => {
    const { orders } = parseFixture('SHOPEE', 'shopee-sample.csv');
    const pre = await send('/orders/import/preview', 'POST', { channel: 'SHOPEE', orders });
    expect(pre.json.data).toMatchObject({ new: 3, duplicates: [], unmapped_skus: ['SHP-UNKNOWN'] });
    const r = await doImport('SHOPEE', orders);
    expect(r.json.data.created).toBe(2);
    expect(r.json.data.errors).toHaveLength(1);
    expect(r.json.data.errors[0]).toMatchObject({ external_order_id: 'SP1004' });
    expect(r.json.data.errors[0].message).toContain('SHP-UNKNOWN');
    expect(await orderByExt('SP1004')).toBeNull();
    expect(await orderByExt('SP1003')).not.toBeNull();
    // đơn SKIP (đã hủy) không tạo và không tính lỗi
    expect(await orderByExt('SP1002')).toBeNull();
  });

  it('preview liệt kê đơn trùng và không ghi gì', async () => {
    await doImport('SHOPEE', [order()]);
    const pre = await send('/orders/import/preview', 'POST', {
      channel: 'SHOPEE',
      orders: [order(), order({ external_order_id: 'EXT-2' })],
    });
    expect(pre.json.data).toMatchObject({ new: 1, duplicates: ['EXT-1'], unmapped_skus: [] });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first<{ n: number }>())!.n).toBe(1);
  });

  it('SKU trùng sku sản phẩm (không cần ánh xạ) và ánh xạ kênh đều được phân giải', async () => {
    const r = await doImport('SHOPEE', [
      order({ external_order_id: 'A', items: [{ external_sku: 'SHP-DEG-500', product_name: 'x', quantity: 1, unit_price: 100000 }] }),
      order({ external_order_id: 'B', items: [{ external_sku: DEG, product_name: 'x', quantity: 1, unit_price: 100000 }] }),
    ]);
    expect(r.json.data.created).toBe(2);
    // ánh xạ theo kênh: TT-DEG-500 chỉ có ở TIKTOK nên ở SHOPEE là chưa ánh xạ
    const other = await doImport('SHOPEE', [
      order({ external_order_id: 'C', items: [{ external_sku: 'TT-DEG-500', product_name: 'x', quantity: 1, unit_price: 1 }] }),
    ]);
    expect(other.json.data.created).toBe(0);
    expect(other.json.data.errors[0].message).toContain('TT-DEG-500');
  });

  it('đơn trạng thái giao xong → COMPLETED, tồn trừ ngay, payment MARKETPLACE', async () => {
    const { orders } = parseFixture('SHOPEE', 'shopee-sample.csv');
    const r = await doImport('SHOPEE', orders.filter((o) => o.external_order_id === 'SP1001'));
    expect(r.json.data.created).toBe(1);
    const o = await orderByExt('SP1001');
    expect(o).toMatchObject({
      channel: 'SHOPEE',
      order_status: 'COMPLETED',
      payment_method: 'MARKETPLACE',
      source: 'IMPORT',
      subtotal_vnd: 2 * 150000 + 120000,
      shipping_fee_vnd: 25000,
      total_amount: 445000,
      paid_amount: 445000,
      payment_status: 'PAID',
    });
    expect(await stock(DEG)).toMatchObject({ stock_qty: 98, reserved_qty: 0 });
    expect(await stock(VISION)).toMatchObject({ stock_qty: 99, reserved_qty: 0 });
    const pays = await env.DB.prepare('SELECT kind, amount_vnd, method FROM payments WHERE order_id = ?').bind(o.id).all();
    expect(pays.results).toEqual([{ kind: 'RECEIPT', amount_vnd: 445000, method: 'MARKETPLACE' }]);
  });

  it('SHIPPING: trừ tồn, chưa có thu tiền; PENDING: giữ hàng', async () => {
    const { orders } = parseFixture('SHOPEE', 'shopee-sample.csv');
    await doImport('SHOPEE', orders.filter((o) => o.external_order_id === 'SP1003'));
    const ship = await orderByExt('SP1003');
    expect(ship).toMatchObject({ order_status: 'SHIPPING', paid_amount: 0, payment_status: 'UNPAID' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').bind(ship.id).first<{ n: number }>())!.n).toBe(0);
    expect(await stock('VK-BOSSMAN-DESCALER-500ML')).toMatchObject({ stock_qty: 97, reserved_qty: 0 });
    await doImport('SHOPEE', [order({ external_order_id: 'P1', status: 'PENDING' })]);
    expect(await stock(DEG)).toMatchObject({ stock_qty: 100, reserved_qty: 1 });
  });

  it('hết hàng → đơn đó vào errors (409), đơn khác vẫn tạo', async () => {
    const big = order({
      external_order_id: 'BIG',
      status: 'COMPLETED',
      items: [{ external_sku: DEG, product_name: 'x', quantity: 500, unit_price: 1000 }],
    });
    const r = await doImport('SHOPEE', [big, order({ external_order_id: 'OK1' })]);
    expect(r.json.data.created).toBe(1);
    expect(r.json.data.errors).toHaveLength(1);
    expect(r.json.data.errors[0].external_order_id).toBe('BIG');
    expect(await orderByExt('BIG')).toBeNull();
  });

  it('SĐT bị che/thiếu/sai: không tạo khách, giữ nguyên chuỗi gốc; SĐT hợp lệ tạo khách', async () => {
    const r = await doImport('TIKTOK', [
      order({ external_order_id: 'M1', buyer_phone: '******45' }),
      order({ external_order_id: 'M2', buyer_phone: '' }),
      order({ external_order_id: 'M3', buyer_phone: '12345' }),
      order({ external_order_id: 'V1', buyer_phone: '(+84)912345678' }),
    ]);
    expect(r.json.data).toMatchObject({ created: 4, errors: [] });
    expect(await orderByExt('M1')).toMatchObject({ customer_id: null, customer_phone: '******45' });
    expect(await orderByExt('M2')).toMatchObject({ customer_id: null, customer_phone: '' });
    expect(await orderByExt('M3')).toMatchObject({ customer_id: null, customer_phone: '12345' });
    const v = await orderByExt('V1');
    expect(v.customer_phone).toBe('0912345678');
    expect(v.customer_id).not.toBeNull();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>())!.n).toBe(1);
  });

  it('ngoài IMPORT, SĐT sai vẫn 422 INVALID_PHONE', async () => {
    const base = {
      channel: 'PHONE' as const,
      customer: { phone: '******45', name: 'A' },
      shipping_address: 'x',
      items: [{ sku: DEG, quantity: 1 }],
      shipping_fee_vnd: 0,
      payment_method: 'COD' as const,
    };
    await expect(createOrder(env, base, { source: 'MANUAL', userId: admin.id })).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_PHONE',
    });
    const res = await send('/orders', 'POST', base);
    expect(res.status).toBe(422);
  });

  it('ghi import_batches và nhật ký', async () => {
    const { orders } = parseFixture('SHOPEE', 'shopee-sample.csv');
    await doImport('SHOPEE', orders, 'shopee-11.csv');
    const b = await env.DB.prepare('SELECT * FROM import_batches').first<any>();
    expect(b).toMatchObject({
      channel: 'SHOPEE',
      file_name: 'shopee-11.csv',
      created_orders: 2,
      skipped_duplicates: 0,
      created_by: admin.id,
    });
    expect(JSON.parse(b.errors_json)).toMatchObject({ total: 1, items: [{ external_order_id: 'SP1004' }] });
    const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'import.run'").first<{ n: number }>();
    expect(a!.n).toBe(1);
  });

  it('server kiểm tra lại dữ liệu gửi lên (422) và cần đăng nhập', async () => {
    const bad = await send('/orders/import', 'POST', {
      channel: 'SHOPEE',
      file_name: 'x',
      orders: [{ external_order_id: '', items: [] }],
    });
    expect(bad.status).toBe(422);
    const wrongChannel = await send('/orders/import', 'POST', { channel: 'WEB', file_name: 'x', orders: [] });
    expect(wrongChannel.status).toBe(422);
    const anon = await api(env, '/orders/import', { method: 'POST', body: '{}' });
    expect(anon.status).toBe(401);
  });
});

describe('cấu hình nhập', () => {
  it('GET orders/import/columns: mặc định, rồi ưu tiên app_settings', async () => {
    const def = await send('/orders/import/columns?channel=SHOPEE');
    expect(def.json.data).toEqual(DEFAULT_COLUMN_MAPS.SHOPEE);
    const custom = { ...DEFAULT_COLUMN_MAPS.SHOPEE, order_id: 'Order No' };
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('import.columns.SHOPEE', ?)").bind(JSON.stringify(custom)).run();
    expect((await send('/orders/import/columns?channel=SHOPEE')).json.data).toEqual(custom);
    expect((await send('/orders/import/columns?channel=TIKTOK')).json.data).toEqual(DEFAULT_COLUMN_MAPS.TIKTOK);
    expect((await send('/orders/import/columns?channel=WEB')).status).toBe(422);
  });

  it('channel-sku-map: PUT thêm/sửa/xoá, GET phân trang theo kênh', async () => {
    const put = await send('/channel-sku-map', 'PUT', {
      channel: 'SHOPEE',
      mappings: [
        { external_sku: 'NEW-1', sku: VISION },
        { external_sku: 'SHP-DEG-500', sku: VISION },
      ],
    });
    expect(put.status).toBe(200);
    const list = await send('/channel-sku-map?channel=SHOPEE');
    expect(list.json.data).toMatchObject({ total: 2, page: 1, page_size: 50 });
    expect(list.json.data.items).toEqual([
      { channel: 'SHOPEE', external_sku: 'NEW-1', sku: VISION },
      { channel: 'SHOPEE', external_sku: 'SHP-DEG-500', sku: VISION },
    ]);
    await send('/channel-sku-map', 'PUT', { channel: 'SHOPEE', mappings: [{ external_sku: 'NEW-1', sku: null }] });
    expect((await send('/channel-sku-map?channel=SHOPEE')).json.data.total).toBe(1);
    const bad = await send('/channel-sku-map', 'PUT', {
      channel: 'SHOPEE',
      mappings: [{ external_sku: 'Z', sku: 'KHONG-CO' }],
    });
    expect(bad.status).toBe(422);
  });
});

describe('fix round 1', () => {
  it('parseOrderDate: Shopee và TikTok (giờ VN → UTC), ngày sai → null', () => {
    expect(parseOrderDate('SHOPEE', '2026-11-01 09:15')).toBe('2026-11-01 02:15:00');
    expect(parseOrderDate('SHOPEE', '2026-11-01 03:00:30')).toBe('2026-10-31 20:00:30');
    expect(parseOrderDate('TIKTOK', '05/11/2026 09:00:00')).toBe('2026-11-05 02:00:00');
    expect(parseOrderDate('TIKTOK', '2026-11-05 09:00:00')).toBeNull();
    expect(parseOrderDate('TIKTOK', '31/02/2026 09:00:00')).toBeNull();
    expect(parseOrderDate('SHOPEE', '2026-13-01 09:00')).toBeNull();
    expect(parseOrderDate('SHOPEE', 'hôm qua')).toBeNull();
  });

  it('created_at của đơn nhập = giờ sàn đã đổi sang UTC (cả hai kênh); notes không chứa ngày', async () => {
    const sp = parseFixture('SHOPEE', 'shopee-sample.csv').orders.filter((o) => o.external_order_id === 'SP1003');
    const tt = parseFixture('TIKTOK', 'tiktok-sample.csv').orders.filter((o) => o.external_order_id === 'TT2001');
    await doImport('SHOPEE', sp);
    await doImport('TIKTOK', tt);
    expect((await orderByExt('SP1003')).created_at).toBe('2026-11-03 07:30:00');
    const t = await orderByExt('TT2001');
    expect(t.created_at).toBe('2026-11-05 02:00:00');
    expect(t.notes).not.toContain('2026');
  });

  it('ngày sai → lỗi dòng ở bước parse; server từ chối created_at không chuẩn', async () => {
    const rows = readCsv('shopee-sample.csv');
    rows[3]['Ngày đặt hàng'] = '31/02/2026';
    const { errors } = parseMarketplaceRows('SHOPEE', rows, DEFAULT_COLUMN_MAPS.SHOPEE);
    expect(errors.map((e) => e.row)).toEqual([5]);
    expect((await doImport('SHOPEE', [order({ created_at: '2026-02-31 00:00:00' })])).status).toBe(422);
    expect((await doImport('SHOPEE', [order({ created_at: '01/11/2026' })])).status).toBe(422);
  });

  it('tối đa 10 đơn mỗi request (422 nếu hơn)', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => order({ external_order_id: `L${i}` }));
    expect(MAX_IMPORT_ORDERS_PER_REQUEST).toBe(10);
    expect((await doImport('SHOPEE', mk(11))).status).toBe(422);
    expect((await send('/orders/import/preview', 'POST', { channel: 'SHOPEE', orders: mk(11) })).status).toBe(422);
    expect((await doImport('SHOPEE', mk(10))).json.data.created).toBe(10);
  });

  it('batch_id: nhóm đầu tạo đợt, nhóm sau cộng dồn; 404 và 409', async () => {
    const bad = (id: string, sku: string) =>
      order({ external_order_id: id, items: [{ external_sku: sku, product_name: 'x', quantity: 1, unit_price: 1 }] });
    const first = await doImport('SHOPEE', [order({ external_order_id: 'B1' }), bad('B2', 'NOPE')], 'big.csv');
    const id = first.json.data.batch_id;
    expect(id).toBeGreaterThan(0);
    const second = await send('/orders/import', 'POST', {
      channel: 'SHOPEE',
      file_name: 'big.csv',
      batch_id: id,
      orders: [order({ external_order_id: 'B1' }), order({ external_order_id: 'B3' }), bad('B4', 'NOPE2')],
    });
    expect(second.json.data).toMatchObject({ batch_id: id, created: 1, skipped_duplicates: 1, errors_total: 2 });
    const rows = await env.DB.prepare('SELECT * FROM import_batches').all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ total_rows: 5, created_orders: 2, skipped_duplicates: 1 });
    expect(JSON.parse(rows.results[0].errors_json).items).toHaveLength(2);
    const missing = await send('/orders/import', 'POST', {
      channel: 'SHOPEE', file_name: 'x', batch_id: 9999, orders: [order({ external_order_id: 'Z1' })],
    });
    expect(missing.status).toBe(404);
    expect(await orderByExt('Z1')).toBeNull();
    const wrong = await send('/orders/import', 'POST', {
      channel: 'TIKTOK', file_name: 'x', batch_id: id, orders: [order({ external_order_id: 'Z2' })],
    });
    expect(wrong.status).toBe(409);
    expect(await orderByExt('Z2')).toBeNull();
  });

  it('lỗi lưu tối đa 200, cắt thông điệp 300 ký tự, đếm tổng', async () => {
    let id: number | undefined;
    let total = 0;
    for (let c = 0; c < 22; c++) {
      const orders = Array.from({ length: 10 }, (_, i) =>
        order({
          external_order_id: `E${c}-${i}`,
          items: Array.from({ length: 8 }, (_, k) => ({ external_sku: 'X'.repeat(50) + `-${c}-${i}-${k}`, product_name: 'x', quantity: 1, unit_price: 1 })),
        }),
      );
      const r = await send('/orders/import', 'POST', { channel: 'SHOPEE', file_name: 'e.csv', batch_id: id, orders });
      id = r.json.data.batch_id;
      total = r.json.data.errors_total;
    }
    expect(total).toBe(220);
    const row = await env.DB.prepare('SELECT errors_json FROM import_batches WHERE id = ?').bind(id).first<{ errors_json: string }>();
    const stored = JSON.parse(row!.errors_json);
    expect(stored.total).toBe(220);
    expect(stored.items).toHaveLength(200);
    expect(Math.max(...stored.items.map((e: any) => e.message.length))).toBeLessThanOrEqual(300);
  });

  it('hai dòng cùng quy về một SKU nội bộ (PENDING và COMPLETED)', async () => {
    const item = (sku: string, q: number) => ({ external_sku: sku, product_name: 'x', quantity: q, unit_price: 100000 });
    const r = await doImport('SHOPEE', [
      order({ external_order_id: 'S1', status: 'PENDING', items: [item('SHP-DEG-500', 2), item(DEG, 3)] }),
      order({ external_order_id: 'S2', status: 'COMPLETED', items: [item('SHP-DEG-500', 1), item(DEG, 4)] }),
    ]);
    expect(r.json.data).toMatchObject({ created: 2, errors: [] });
    const sum = async (ext: string) =>
      (await env.DB.prepare(
        'SELECT SUM(quantity) AS q, COUNT(*) AS n FROM order_items WHERE order_id = (SELECT id FROM orders WHERE external_order_id = ?)',
      ).bind(ext).first<{ q: number; n: number }>())!;
    expect(await sum('S1')).toMatchObject({ q: 5 });
    expect(await sum('S2')).toMatchObject({ q: 5 });
    expect(await stock(DEG)).toMatchObject({ stock_qty: 95, reserved_qty: 5 });
  });

  it('header là hợp khoá của mọi dòng (dòng đầu thiếu ô trống vẫn được)', () => {
    const rows = readCsv('shopee-sample.csv');
    delete rows[0]['Giá ưu đãi'];
    const { orders, errors } = parseMarketplaceRows('SHOPEE', rows, DEFAULT_COLUMN_MAPS.SHOPEE);
    expect(errors.map((e) => e.row)).toEqual([2]); // lỗi dòng 2 (thiếu đơn giá), không phải lỗi thiếu cột
    expect(orders.find((o) => o.external_order_id === 'SP1003')).toBeDefined();
  });

  it('đơn không SKIP phải có ≥ 1 sản phẩm; SKIP được rỗng', async () => {
    expect((await doImport('SHOPEE', [order({ items: [] })])).status).toBe(422);
    expect((await doImport('SHOPEE', [order({ status: 'SKIP', items: [] })])).status).toBe(200);
  });

  it('một request 10 đơn COMPLETED dùng ≤ 45 lệnh D1', async () => {
    let calls = 0;
    const real = env.DB;
    const unwrap = new WeakMap<object, any>();
    const wrap = (st: any): any => {
      const p: any = new Proxy(st, {
        get(t, k) {
          if (k === 'bind') return (...a: unknown[]) => wrap(t.bind(...a));
          if (['run', 'all', 'first', 'raw'].includes(k as string)) return (...a: unknown[]) => (calls++, t[k](...a));
          const v = t[k];
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      unwrap.set(p, st);
      return p;
    };
    const counting = {
      prepare: (q: string) => wrap(real.prepare(q)),
      batch: (stmts: any[]) => (calls++, real.batch(stmts.map((x) => unwrap.get(x) ?? x))),
    } as unknown as D1Database;
    env = { ...env, DB: counting };
    const orders = Array.from({ length: 10 }, (_, i) =>
      order({ external_order_id: `C${i}`, status: 'COMPLETED', buyer_phone: `09123456${String(i).padStart(2, '0')}` }),
    );
    const r = await doImport('SHOPEE', orders);
    expect(r.json.data.created).toBe(10);
    expect(calls).toBeLessThanOrEqual(45);
  });
});
