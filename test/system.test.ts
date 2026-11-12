import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import worker from '../worker/index';
import { pruneBackups, runBackup, runDaily } from '../worker/admin/scheduled';
import { DEFAULT_COLUMN_MAPS } from '../src/shared/marketplace';
import { api, createUser, makeEnv, seedProducts } from './helpers';

const DG = 'VK-DEGREASER-500ML';
const DAY_MS = 86400000;

let env: Env;
let admin: { id: number };

beforeEach(async () => {
  env = await makeEnv();
  await seedProducts(env.DB);
  admin = await createUser(env.DB, 'ADMIN');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } };

async function send(path: string, method = 'GET', body?: unknown, as: { id: number } = admin) {
  const res = await api(env, path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, as);
  return { status: res.status, json: (await res.json()) as Json };
}

const vnDay = (offsetDays: number) => new Date(Date.now() + 7 * 3600000 + offsetDays * DAY_MS).toISOString().slice(0, 10);
const backupKey = (offsetDays: number) => `backups/${vnDay(offsetDays)}.json.gz`;

async function gunzipJson(key: string): Promise<any> {
  const obj = await env.FILES.get(key);
  const stream = (await obj!.blob()).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

describe('sao lưu', () => {
  it('runBackup tạo object R2 giải nén ra JSON có đủ các bảng', async () => {
    const r = await runBackup(env);
    expect(r.key).toBe(backupKey(0));
    const head = await env.FILES.head(r.key);
    expect(head!.size).toBe(r.bytes);
    expect(head!.httpMetadata?.contentType).toBe('application/gzip');

    const json = await gunzipJson(r.key);
    expect(typeof json.created_at).toBe('string');
    const expected = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) <> '_cf_'",
      ).all<{ name: string }>()
    ).results.map((t) => t.name);
    expect(expected).toContain('users');
    expect(Object.keys(json.tables).sort()).toEqual([...expected].sort());
    expect(json.tables.users.map((u: any) => u.email)).toContain((await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(admin.id).first<{ email: string }>())!.email);
    expect(json.tables.products.length).toBe(9);
  });

  it('bản sao lưu 91 ngày tuổi bị xoá, 89 ngày còn giữ (90 ngày giữ)', async () => {
    for (const d of [0, -89, -90, -91, -200]) await env.FILES.put(backupKey(d), 'x');
    await env.FILES.put('products/anh.png', 'x');
    await env.FILES.put('backups/ghi-chu.txt', 'x');
    await runBackup(env);
    expect(await env.FILES.head(backupKey(-91))).toBeNull();
    expect(await env.FILES.head(backupKey(-200))).toBeNull();
    expect(await env.FILES.head(backupKey(-90))).not.toBeNull();
    expect(await env.FILES.head(backupKey(-89))).not.toBeNull();
    expect(await env.FILES.head('products/anh.png')).not.toBeNull();
    expect(await env.FILES.head('backups/ghi-chu.txt')).not.toBeNull();
  });

  it('pruneBackups theo dõi phân trang list và xoá bằng một lệnh nhiều khoá', async () => {
    const orig = env.FILES.list.bind(env.FILES);
    const del = vi.spyOn(env.FILES, 'delete');
    const list = vi.spyOn(env.FILES, 'list');
    list.mockImplementation((o) => orig({ ...o, limit: 2 }));
    for (let i = 91; i < 96; i++) await env.FILES.put(backupKey(-i), 'x');
    await env.FILES.put(backupKey(-1), 'x');
    const n = await pruneBackups(env);
    expect(n).toBe(5);
    expect(list.mock.calls.length).toBeGreaterThan(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(Array.isArray(del.mock.calls[0][0])).toBe(true);
    expect(await env.FILES.head(backupKey(-1))).not.toBeNull();
  });

  it('POST backup/run (ADMIN) trả key và bytes; STAFF bị 403', async () => {
    const r = await send('/backup/run', 'POST');
    expect(r.status).toBe(200);
    expect(r.json.data.key).toBe(backupKey(0));
    expect(r.json.data.bytes).toBeGreaterThan(0);
    const staff = await createUser(env.DB, 'STAFF');
    expect((await send('/backup/run', 'POST', undefined, staff)).status).toBe(403);
  });
});

describe('runDaily / scheduled', () => {
  const stubTelegram = () => {
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string).text);
        return new Response('{}');
      }),
    );
    return sent;
  };

  it('một bước lỗi không chặn bước khác: backup lỗi vẫn dọn login_attempts và báo Telegram', async () => {
    const sent = stubTelegram();
    env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
    vi.spyOn(env.FILES, 'put').mockRejectedValue(new Error('R2 down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (key, count, window_start) VALUES ('old', 3, datetime('now', '-1 day'))"),
      env.DB.prepare("INSERT INTO login_attempts (key, count, window_start) VALUES ('fresh', 1, datetime('now'))"),
    ]);
    await runDaily(env);
    const keys = (await env.DB.prepare('SELECT key FROM login_attempts').all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(['fresh']);
    expect(err).toHaveBeenCalled();
    expect(sent.some((t) => t.includes('THẤT BẠI'))).toBe(true);
  });

  it('gửi cảnh báo tồn thấp khi telegram.enabled = true, không gửi khi tắt', async () => {
    const sent = stubTelegram();
    env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
    await env.DB.prepare('UPDATE products SET stock_qty = 0, reserved_qty = 0, min_stock = 5 WHERE sku = ?').bind(DG).run();
    await runDaily(env);
    expect(sent).toEqual([]);
    expect((await send('/settings', 'PUT', { 'telegram.enabled': true })).status).toBe(200);
    await runDaily(env);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(DG);
  });

  it('cảnh báo dài được tách thành nhiều tin ≤ 4096 ký tự, đủ 80 SKU', async () => {
    const sent = stubTelegram();
    env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
    const stmts = [];
    for (let i = 0; i < 80; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO products (sku, product_id, name, slug, price_vnd, listed_price_vnd, stock_qty, min_stock, shelf_zone, shelf_label, image_url) VALUES (?, ?, ?, ?, 1000, 1000, 0, 5, 'RED_ACID', 'A', '')",
        ).bind(`LONG-SKU-${String(i).padStart(3, '0')}`, 1000 + i, `Sản phẩm có tên rất dài ${'x'.repeat(80)} số ${i}`, `long-${i}`),
      );
    }
    await env.DB.batch(stmts);
    await send('/settings', 'PUT', { 'telegram.enabled': true });
    await runDaily(env);
    expect(sent.length).toBeGreaterThan(1);
    for (const m of sent) expect(m.length).toBeLessThanOrEqual(4096);
    const all = sent.join('\n');
    for (let i = 0; i < 80; i++) expect(all).toContain(`LONG-SKU-${String(i).padStart(3, '0')}`);
  });

  it('Telegram trả 400 → console.error, runDaily vẫn chạy các bước còn lại', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":false}', { status: 400 })));
    env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await send('/settings', 'PUT', { 'telegram.enabled': true });
    await env.DB.prepare('UPDATE products SET stock_qty = 0, reserved_qty = 0, min_stock = 5 WHERE sku = ?').bind(DG).run();
    await env.DB.prepare("INSERT INTO login_attempts (key, count, window_start) VALUES ('old', 3, datetime('now', '-1 day'))").run();
    await runDaily(env);
    expect(err.mock.calls.some((c) => String(c[0]).includes('400'))).toBe(true);
    expect(await env.FILES.head(backupKey(0))).not.toBeNull();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').first<{ n: number }>())!.n).toBe(0);
  });

  it('cảnh báo hằng ngày gồm cả lô sắp hết hạn', async () => {
    const sent = stubTelegram();
    env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
    const expiry = vnDay(10);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO stock_docs (code, type, status, posted_at) VALUES ('PN-TEST', 'RECEIPT', 'POSTED', datetime('now'))"),
      env.DB.prepare(
        "INSERT INTO stock_doc_lines (doc_id, sku, qty, batch_code, expiry_date) VALUES ((SELECT id FROM stock_docs WHERE code = 'PN-TEST'), ?, 10, 'LOT-EXP', ?)",
      ).bind(DG, expiry),
    ]);
    await send('/settings', 'PUT', { 'telegram.enabled': true });
    await runDaily(env);
    const all = sent.join('\n');
    expect(all).toContain('LOT-EXP');
    expect(all).toContain(expiry);
  });

  it('worker.scheduled gọi runDaily (tạo bản sao lưu)', async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
    await worker.scheduled({ cron: '0 19 * * *', scheduledTime: Date.now() } as ScheduledController, env, ctx);
    await Promise.all(pending);
    expect(await env.FILES.head(backupKey(0))).not.toBeNull();
  });
});

describe('cài đặt', () => {
  it('STAFF GET settings → 403', async () => {
    const staff = await createUser(env.DB, 'STAFF');
    expect((await send('/settings', 'GET', undefined, staff)).status).toBe(403);
    expect((await send('/settings', 'PUT', { 'company.name': 'x' }, staff)).status).toBe(403);
  });

  it('PUT từng phần, GET trả đúng và ghi nhật ký settings.update', async () => {
    const put = await send('/settings', 'PUT', {
      'company.name': '  Công ty VKINNO ',
      'print.show_logo': false,
      'import.columns.SHOPEE': DEFAULT_COLUMN_MAPS.SHOPEE,
    });
    expect(put.status).toBe(200);
    await send('/settings', 'PUT', { 'telegram.enabled': true });
    const got = (await send('/settings')).json.data;
    expect(got['company.name']).toBe('Công ty VKINNO');
    expect(got['print.show_logo']).toBe(false);
    expect(got['telegram.enabled']).toBe(true);
    expect(got['import.columns.SHOPEE']).toEqual(DEFAULT_COLUMN_MAPS.SHOPEE);
    expect(got['company.phone']).toBeNull();
    const audits = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'settings.update'").first<{ n: number }>();
    expect(audits!.n).toBe(2);
  });

  it('khoá lạ → 422, khoá cũ của website không bị lộ hay ghi đè', async () => {
    const before = await env.DB.prepare('SELECT key, value FROM app_settings ORDER BY key').all();
    expect(before.results.some((r: any) => r.key === 'gem_cskh_url')).toBe(true);
    expect((await send('/settings', 'PUT', { gem_cskh_url: 'https://evil' })).status).toBe(422);
    expect((await send('/settings', 'PUT', { 'company.name': 'A', foo: 1 })).status).toBe(422);
    expect((await send('/settings', 'PUT', { 'print.show_logo': 'yes' })).status).toBe(422);
    expect((await send('/settings', 'PUT', {})).status).toBe(422);
    await send('/settings', 'PUT', { 'company.name': 'A' });
    const got = (await send('/settings')).json.data;
    expect(Object.keys(got).some((k) => k.startsWith('gem_') || k === 'notebooklm_url' || k === 'drive_backup_url')).toBe(false);
    const after = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key NOT LIKE 'company.%' ORDER BY key").all();
    expect(after.results).toEqual(before.results);
  });
});

describe('tài khoản', () => {
  it('email được cắt khoảng trắng và viết thường; trùng → 409; không lộ password_hash', async () => {
    const r = await send('/users', 'POST', { email: '  Nhan.Vien@Test.LOCAL ', name: 'Nhân viên', role: 'STAFF', password: 'matkhau-dai-123' });
    expect(r.status).toBe(201);
    expect(r.json.data.email).toBe('nhan.vien@test.local');
    expect(JSON.stringify(r.json)).not.toContain('password_hash');
    const dup = await send('/users', 'POST', { email: 'NHAN.VIEN@test.local', name: 'Khác', role: 'STAFF', password: 'matkhau-dai-123' });
    expect(dup.status).toBe(409);
    const list = await send('/users');
    expect(JSON.stringify(list.json)).not.toContain('password');
    expect((await send('/users', 'POST', { email: 'a@b.co', name: 'A', role: 'STAFF', password: 'ngan' })).status).toBe(422);
  });

  it('STAFF bị 403 ở GET và POST users', async () => {
    const staff = await createUser(env.DB, 'STAFF');
    expect((await send('/users', 'GET', undefined, staff)).status).toBe(403);
    const body = { email: 'x@y.co', name: 'X', role: 'STAFF', password: 'matkhau-dai-123' };
    expect((await send('/users', 'POST', body, staff)).status).toBe(403);
  });

  it('đặt lại mật khẩu: đăng nhập được bằng mật khẩu mới, nhật ký không chứa mật khẩu', async () => {
    const u = await createUser(env.DB, 'STAFF');
    const r = await send(`/users/${u.id}/reset-password`, 'POST', { password: 'mat-khau-moi-999' });
    expect(r.status).toBe(200);
    const login = await api(env, '/auth/login', { method: 'POST', body: JSON.stringify({ email: u.email, password: 'mat-khau-moi-999' }) });
    expect(login.status).toBe(200);
    expect((await send('/users/9999/reset-password', 'POST', { password: 'mat-khau-moi-999' })).status).toBe(404);
    const logs = await env.DB.prepare("SELECT detail_json FROM audit_logs WHERE action = 'user.reset_password'").all<{ detail_json: string }>();
    expect(logs.results).toHaveLength(1);
    expect(logs.results[0].detail_json).not.toContain('mat-khau');
  });

  it('không khoá được ADMIN cuối cùng', async () => {
    // Tự hạ quyền / tự khoá khi là ADMIN duy nhất
    const self = await send(`/users/${admin.id}`, 'PUT', { name: 'A', role: 'STAFF', is_active: true });
    expect(self.status).toBe(409);
    expect(self.json.error!.code).toBe('LAST_ADMIN');
    expect((await send(`/users/${admin.id}`, 'PUT', { name: 'A', role: 'ADMIN', is_active: false })).status).toBe(409);
    const row = await env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(admin.id).first();
    expect(row).toEqual({ role: 'ADMIN', is_active: 1 });
    // Batch bị huỷ: không có nhật ký user.update
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'user.update'").first<{ n: number }>();
    expect(n!.n).toBe(0);

    // Có ADMIN thứ hai: hạ một người được, người còn lại thì không
    const second = await createUser(env.DB, 'ADMIN');
    const ok1 = await send(`/users/${second.id}`, 'PUT', { name: 'B', role: 'STAFF', is_active: true });
    expect(ok1.status).toBe(200);
    expect((await send(`/users/${admin.id}`, 'PUT', { name: 'A', role: 'STAFF', is_active: true })).status).toBe(409);
    // Đổi tên không bị chặn
    expect((await send(`/users/${admin.id}`, 'PUT', { name: 'Tên mới', role: 'ADMIN', is_active: true })).status).toBe(200);
    // STAFF hạ/khoá không ảnh hưởng
    expect((await send(`/users/${second.id}`, 'PUT', { name: 'B', role: 'STAFF', is_active: false })).status).toBe(200);
    expect((await send('/users/9999', 'PUT', { name: 'B', role: 'STAFF', is_active: false })).status).toBe(404);
  });
});

describe('nhật ký thao tác', () => {
  it('lọc theo user, entity, ngày VN; mới nhất trước; có tên người dùng; phân trang', async () => {
    const other = await createUser(env.DB, 'STAFF', { name: 'Nhân viên B' });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO audit_logs (user_id, action, entity, entity_id, created_at) VALUES (?, 'order.create', 'order', '1', '2026-11-01 16:30:00')").bind(admin.id),
      env.DB.prepare("INSERT INTO audit_logs (user_id, action, entity, entity_id, created_at) VALUES (?, 'order.create', 'order', '2', '2026-11-02 10:00:00')").bind(other.id),
      env.DB.prepare("INSERT INTO audit_logs (user_id, action, entity, entity_id, created_at) VALUES (?, 'payment.create', 'payment', '3', '2026-11-03 10:00:00')").bind(other.id),
    ]);
    const all = (await send('/audit-logs?page_size=2')).json.data;
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(2);
    expect(all.items[0].entity).toBe('payment');
    expect(all.items[0].user_name).toBe('Nhân viên B');
    expect((await send(`/audit-logs?user_id=${admin.id}`)).json.data.total).toBe(1);
    expect((await send('/audit-logs?entity=order')).json.data.items.map((i: any) => i.entity_id)).toEqual(['2', '1']);
    // 2026-11-01 16:30 UTC = 2026-11-01 23:30 VN; 2026-11-02 10:00 UTC = 17:00 VN
    expect((await send('/audit-logs?from=2026-11-02&to=2026-11-02&entity=order')).json.data.items.map((i: any) => i.entity_id)).toEqual(['2']);
    expect((await send('/audit-logs?from=2026-11-01&to=2026-11-01')).json.data.items.map((i: any) => i.entity_id)).toEqual(['1']);
    // Biên nửa đêm VN: 16:59:59 UTC = 23:59:59 VN (ngày 11-01), 17:00:00 UTC = 00:00:00 VN (ngày 11-02)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO audit_logs (user_id, action, entity, entity_id, created_at) VALUES (?, 'x', 'edge', 'a', '2026-12-01 16:59:59')").bind(admin.id),
      env.DB.prepare("INSERT INTO audit_logs (user_id, action, entity, entity_id, created_at) VALUES (?, 'x', 'edge', 'b', '2026-12-01 17:00:00')").bind(admin.id),
    ]);
    expect((await send('/audit-logs?entity=edge&from=2026-12-01&to=2026-12-01')).json.data.items.map((i: any) => i.entity_id)).toEqual(['a']);
    expect((await send('/audit-logs?entity=edge&from=2026-12-02&to=2026-12-02')).json.data.items.map((i: any) => i.entity_id)).toEqual(['b']);
    expect((await send('/audit-logs?from=bad')).status).toBe(422);
    const staff = await createUser(env.DB, 'STAFF');
    expect((await send('/audit-logs', 'GET', undefined, staff)).status).toBe(403);
  });
});

describe('bản sao Google Sheets', () => {
  const orderBody = {
    channel: 'PHONE',
    customer: { phone: '0912345678', name: 'Chị Lan' },
    shipping_address: '12 Lê Lợi, Q1',
    items: [{ sku: DG, quantity: 2 }],
    shipping_fee_vnd: 0,
    payment_method: 'COD',
  };

  it('mirrorEvent khi webhook lỗi không làm hỏng thao tác chính', async () => {
    env = { ...env, GOOGLE_SCRIPT_WEBHOOK_URL: 'https://script.google.com/macros/s/x/exec' };
    const f = vi.fn(async () => {
      throw new Error('mạng lỗi');
    });
    vi.stubGlobal('fetch', f);
    const o = await send('/orders', 'POST', orderBody);
    expect(o.status).toBe(201);
    const p = await send(`/orders/${o.json.data.id}/payments`, 'POST', { kind: 'RECEIPT', amount_vnd: 1000, method: 'CASH' });
    expect(p.status).toBe(201);
    expect(f).toHaveBeenCalled();
    const order = await env.DB.prepare('SELECT paid_amount FROM orders WHERE id = ?').bind(o.json.data.id).first<{ paid_amount: number }>();
    expect(order!.paid_amount).toBe(1000);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM payments').first<{ n: number }>())!.n).toBe(1);
  });

  it('nhập file sàn đẩy đúng một sự kiện import.batch (không đẩy từng đơn)', async () => {
    env = { ...env, GOOGLE_SCRIPT_WEBHOOK_URL: 'https://script.google.com/macros/s/x/exec' };
    await env.DB.prepare("INSERT INTO channel_sku_map (channel, external_sku, sku) VALUES ('SHOPEE', 'SHP-DEG-500', ?)").bind(DG).run();
    const events: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        events.push(JSON.parse(init.body as string));
        return new Response('{}');
      }),
    );
    const mk = (id: string) => ({
      external_order_id: id,
      created_at: '2026-11-01 02:00:00',
      status: 'PENDING',
      buyer_name: 'A',
      buyer_phone: '0912345678',
      address: '1 Lê Lợi',
      shipping_fee_vnd: 0,
      items: [{ external_sku: DG, product_name: 'x', quantity: 1, unit_price: 150000 }],
    });
    const r = await send('/orders/import', 'POST', { channel: 'SHOPEE', file_name: 'a.csv', orders: [mk('E1'), mk('E2')] });
    expect(r.json.data.created).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'import.batch', channel: 'SHOPEE', batch_id: r.json.data.batch_id });
    expect(events[0].order_codes).toHaveLength(2);
    // Gửi lại: toàn đơn trùng → không có đơn mới → không có sự kiện
    events.length = 0;
    await send('/orders/import', 'POST', { channel: 'SHOPEE', file_name: 'a.csv', orders: [mk('E1')] });
    expect(events).toHaveLength(0);
  });
});
