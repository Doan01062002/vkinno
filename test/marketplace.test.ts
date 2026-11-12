import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMN_MAPS,
  parseMarketplaceRows,
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
    created_at: '2026-11-01',
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
    expect(JSON.parse(b.errors_json)).toHaveLength(1);
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
