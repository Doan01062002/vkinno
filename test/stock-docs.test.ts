import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const BM = 'VK-BOSSMAN-DESCALER-500ML';
const COMBO = 'VK-COMBO-BOSSMAN-VKINNO-500ML';

let env: Env;
let admin: { id: number };
let staff: { id: number };

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
  await env.DB.prepare('DELETE FROM inventory_logs').run();
  admin = await createUser(env.DB, 'ADMIN');
  staff = await createUser(env.DB, 'STAFF');
});

const send = (path: string, method: string, body?: unknown, user: { id: number } = admin) =>
  api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, user);

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function create(body: unknown, user = admin): Promise<Json> {
  return (await send('/stock-docs', 'POST', body, user)).json() as Promise<Json>;
}
const product = (sku: string) =>
  env.DB.prepare('SELECT stock_qty, reserved_qty, cost_avg_vnd FROM products WHERE sku = ?').bind(sku).first<any>();
const docStatus = (id: number) =>
  env.DB.prepare('SELECT status, posted_by, posted_at FROM stock_docs WHERE id = ?').bind(id).first<any>();

const receipt = (lines: object[] = [{ sku: DG, qty: 100, unit_cost_vnd: 80000 }]) => ({ type: 'RECEIPT', lines });

describe('tạo và sửa phiếu', () => {
  it('tạo DRAFT với mã theo loại, đọc lại được cả dòng', async () => {
    const r = await create({ ...receipt(), note: 'lô 1' });
    expect(r.ok).toBe(true);
    expect(r.data.code).toMatch(/^PN\d{6}-[A-Z0-9]{4}$/);
    expect(r.data.status).toBe('DRAFT');
    const got = (await (await send(`/stock-docs/${r.data.id}`, 'GET')).json()) as Json;
    expect(got.data.note).toBe('lô 1');
    expect(got.data.lines).toMatchObject([{ sku: DG, qty: 100, unit_cost_vnd: 80000 }]);
    for (const [type, prefix, line] of [
      ['ISSUE', 'PX', { sku: DG, qty: 1 }],
      ['ADJUST', 'DC', { sku: DG, qty: -1 }],
      ['STOCKTAKE', 'KK', { sku: DG, counted_qty: 5 }],
    ] as const) {
      expect((await create({ type, lines: [line] })).data.code.startsWith(prefix)).toBe(true);
    }
  });

  it('validate theo loại phiếu → 422', async () => {
    const cases = [
      { type: 'RECEIPT', lines: [{ sku: DG, qty: 0, unit_cost_vnd: 1 }] },
      { type: 'RECEIPT', lines: [{ sku: DG, qty: 1 }] },
      { type: 'ISSUE', lines: [{ sku: DG, qty: -2 }] },
      { type: 'ADJUST', lines: [{ sku: DG, qty: 0 }] },
      { type: 'STOCKTAKE', lines: [{ sku: DG, counted_qty: -1 }] },
      { type: 'RECEIPT', lines: [] },
    ];
    for (const c of cases) {
      const res = await send('/stock-docs', 'POST', c);
      expect(res.status, JSON.stringify(c)).toBe(422);
    }
  });

  it('dòng không hợp lệ (SKU lạ, ngừng bán, combo, trùng) → 422 INVALID_LINE nêu dòng', async () => {
    await env.DB.prepare('UPDATE products SET is_active = 0 WHERE sku = ?').bind(BM).run();
    const cases: [object[], number][] = [
      [[{ sku: DG, qty: 1 }, { sku: 'NOPE', qty: 1 }], 1],
      [[{ sku: BM, qty: 1 }], 0],
      [[{ sku: COMBO, qty: 1 }], 0],
      [[{ sku: DG, qty: 1 }, { sku: DG, qty: 2 }], 1],
    ];
    for (const [lines, index] of cases) {
      const res = await send('/stock-docs', 'POST', { type: 'ISSUE', lines });
      const body = (await res.json()) as Json;
      expect(res.status).toBe(422);
      expect(body.error?.code).toBe('INVALID_LINE');
      expect(body.error?.details).toMatchObject({ index });
    }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM stock_docs').first<any>()).n).toBe(0);
  });

  it('nhà cung cấp không tồn tại → 422', async () => {
    const res = await send('/stock-docs', 'POST', { ...receipt(), supplier_id: 9999 });
    expect(res.status).toBe(422);
  });

  it('PUT thay dòng khi DRAFT; loại phiếu không đổi được', async () => {
    const id = (await create(receipt())).data.id;
    const res = await send(`/stock-docs/${id}`, 'PUT', receipt([{ sku: BM, qty: 7, unit_cost_vnd: 1000 }]));
    expect(res.status).toBe(200);
    const got = (await (await send(`/stock-docs/${id}`, 'GET')).json()) as Json;
    expect(got.data.lines).toMatchObject([{ sku: BM, qty: 7 }]);
    expect(got.data.lines).toHaveLength(1);
    const bad = await send(`/stock-docs/${id}`, 'PUT', { type: 'ISSUE', lines: [{ sku: DG, qty: 1 }] });
    expect(bad.status).toBe(422);
  });
});

describe('ghi sổ', () => {
  it('RECEIPT ghi sổ → tồn và giá vốn bình quân đúng, status POSTED, posted_by đặt', async () => {
    const id = (await create(receipt())).data.id;
    const res = await send(`/stock-docs/${id}/post`, 'POST');
    expect(res.status).toBe(200);
    // (100 × 50.000 + 100 × 80.000) / 200 = 65.000
    expect(await product(DG)).toMatchObject({ stock_qty: 200, cost_avg_vnd: 65000 });
    const doc = await docStatus(id);
    expect(doc).toMatchObject({ status: 'POSTED', posted_by: admin.id });
    expect(doc.posted_at).toBeTruthy();
    const log = await env.DB.prepare('SELECT * FROM inventory_logs').first<any>();
    expect(log).toMatchObject({ sku: DG, delta: 100, stock_after: 200, reason: 'RECEIPT', doc_type: 'RECEIPT', unit_cost_vnd: 80000 });
    const audit = await env.DB.prepare("SELECT user_id FROM audit_logs WHERE action = 'stock_doc.post'").first<any>();
    expect(audit.user_id).toBe(admin.id);
  });

  it('PUT hoặc post lần 2 với phiếu POSTED → 409 INVALID_STATE, tồn không đổi', async () => {
    const id = (await create(receipt())).data.id;
    await send(`/stock-docs/${id}/post`, 'POST');
    for (const res of [await send(`/stock-docs/${id}/post`, 'POST'), await send(`/stock-docs/${id}`, 'PUT', receipt())]) {
      expect(res.status).toBe(409);
      expect(((await res.json()) as Json).error?.code).toBe('INVALID_STATE');
    }
    expect(await product(DG)).toMatchObject({ stock_qty: 200 });
  });

  it('ISSUE làm tồn thấp hơn đang giữ → 409 với thông điệp tiếng Việt, phiếu vẫn DRAFT', async () => {
    await env.DB.prepare('UPDATE products SET reserved_qty = 10 WHERE sku = ?').bind(DG).run();
    const id = (await create({ type: 'ISSUE', lines: [{ sku: DG, qty: 95 }] })).data.id;
    const res = await send(`/stock-docs/${id}/post`, 'POST');
    const body = (await res.json()) as Json;
    expect(res.status).toBe(409);
    expect(body.error?.code).toBe('STOCK_CONFLICT');
    expect(body.error?.message).toMatch(/chỉ còn 90 có thể bán/);
    expect((await docStatus(id)).status).toBe('DRAFT');
    expect(await product(DG)).toMatchObject({ stock_qty: 100 });
  });

  it('ADJUST âm/dương ghi sổ ADJUST đúng delta', async () => {
    const id = (await create({ type: 'ADJUST', lines: [{ sku: DG, qty: -4 }, { sku: BM, qty: 6 }] })).data.id;
    expect((await send(`/stock-docs/${id}/post`, 'POST')).status).toBe(200);
    expect(await product(DG)).toMatchObject({ stock_qty: 96 });
    expect(await product(BM)).toMatchObject({ stock_qty: 106 });
    const rows = (await env.DB.prepare('SELECT sku, delta, reason FROM inventory_logs ORDER BY id').all()).results;
    expect(rows).toEqual([
      { sku: DG, delta: -4, reason: 'ADJUST' },
      { sku: BM, delta: 6, reason: 'ADJUST' },
    ]);
  });

  it('ADJUST âm quá tồn → 409, phiếu vẫn DRAFT', async () => {
    const id = (await create({ type: 'ADJUST', lines: [{ sku: DG, qty: -101 }] })).data.id;
    const res = await send(`/stock-docs/${id}/post`, 'POST');
    expect(res.status).toBe(409);
    expect((await docStatus(id)).status).toBe('DRAFT');
  });

  it('STOCKTAKE đếm 2 khi reserved 3 → 409 STOCK_CONFLICT, phiếu vẫn DRAFT', async () => {
    await env.DB.prepare('UPDATE products SET reserved_qty = 3 WHERE sku = ?').bind(DG).run();
    const id = (await create({ type: 'STOCKTAKE', lines: [{ sku: DG, counted_qty: 2 }] })).data.id;
    const res = await send(`/stock-docs/${id}/post`, 'POST');
    const body = (await res.json()) as Json;
    expect(res.status).toBe(409);
    expect(body.error?.code).toBe('STOCK_CONFLICT');
    expect((await docStatus(id)).status).toBe('DRAFT');
    expect(await product(DG)).toMatchObject({ stock_qty: 100, reserved_qty: 3 });
  });

  it('STOCKTAKE đếm 120 khi tồn 100 → sổ STOCKTAKE delta +20, reserved giữ nguyên, system_qty lưu', async () => {
    await env.DB.prepare('UPDATE products SET reserved_qty = 3 WHERE sku = ?').bind(DG).run();
    const id = (await create({ type: 'STOCKTAKE', lines: [{ sku: DG, counted_qty: 120 }] })).data.id;
    expect((await send(`/stock-docs/${id}/post`, 'POST')).status).toBe(200);
    expect(await product(DG)).toMatchObject({ stock_qty: 120, reserved_qty: 3 });
    const log = await env.DB.prepare('SELECT * FROM inventory_logs').first<any>();
    expect(log).toMatchObject({ delta: 20, stock_after: 120, reason: 'STOCKTAKE' });
    const got = (await (await send(`/stock-docs/${id}`, 'GET')).json()) as Json;
    expect(got.data.lines[0]).toMatchObject({ counted_qty: 120, system_qty: 100 });
  });

  it('SKU bị ngừng bán sau khi lập phiếu → post 422 INVALID_LINE, không đổi tồn', async () => {
    const id = (await create({ type: 'ISSUE', lines: [{ sku: DG, qty: 1 }] })).data.id;
    await env.DB.prepare('UPDATE products SET is_active = 0 WHERE sku = ?').bind(DG).run();
    const res = await send(`/stock-docs/${id}/post`, 'POST');
    expect(res.status).toBe(422);
    expect(await product(DG)).toMatchObject({ stock_qty: 100 });
  });
});

describe('huỷ phiếu', () => {
  it('cancel DRAFT → CANCELLED; cancel POSTED → 409; post phiếu CANCELLED → 409', async () => {
    const a = (await create(receipt())).data.id;
    expect((await send(`/stock-docs/${a}/cancel`, 'POST')).status).toBe(200);
    expect((await docStatus(a)).status).toBe('CANCELLED');
    expect((await send(`/stock-docs/${a}/post`, 'POST')).status).toBe(409);

    const b = (await create(receipt())).data.id;
    await send(`/stock-docs/${b}/post`, 'POST');
    const res = await send(`/stock-docs/${b}/cancel`, 'POST');
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error?.code).toBe('INVALID_STATE');
    expect((await docStatus(b)).status).toBe('POSTED');
  });
});

describe('danh sách và phân quyền', () => {
  it('lọc theo type, status, khoảng ngày', async () => {
    const a = (await create(receipt())).data.id;
    await create({ type: 'ISSUE', lines: [{ sku: DG, qty: 1 }] });
    await send(`/stock-docs/${a}/post`, 'POST');
    const list = async (q: string) => ((await (await send(`/stock-docs?${q}`, 'GET')).json()) as Json).data.items;
    expect(await list('')).toHaveLength(2);
    expect(await list('type=ISSUE')).toHaveLength(1);
    expect(await list('status=POSTED')).toMatchObject([{ id: a }]);
    expect(await list('from=2000-01-01&to=2000-01-02')).toHaveLength(0);
    expect(await list('from=2000-01-01&to=2999-01-01')).toHaveLength(2);
  });

  it('STAFF được tạo và ghi sổ phiếu, phản hồi không có unit_cost_vnd', async () => {
    const created = await create(receipt(), staff);
    expect(created.ok).toBe(true);
    const id = created.data.id;
    const got = await (await send(`/stock-docs/${id}`, 'GET', undefined, staff)).text();
    expect(got).not.toContain('unit_cost_vnd');
    const posted = await send(`/stock-docs/${id}/post`, 'POST', undefined, staff);
    expect(posted.status).toBe(200);
    expect(await posted.text()).not.toContain('unit_cost_vnd');
    expect(await docStatus(id)).toMatchObject({ status: 'POSTED', posted_by: staff.id });
    expect(await product(DG)).toMatchObject({ cost_avg_vnd: 65000 });
  });

  it('chưa đăng nhập → 401', async () => {
    const res = await api(env, '/stock-docs');
    expect(res.status).toBe(401);
  });
});
