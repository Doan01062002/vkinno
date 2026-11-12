import { describe, expect, it, vi } from 'vitest';
import { hashPassword, signSession, verifyPassword } from '../worker/admin/auth';
import { redact } from '../worker/admin/redact';
import { route } from '../worker/admin/router';
import { ApiError, ok } from '../worker/lib/http';
import { api, callWorker, createUser, makeEnv } from './helpers';

type TestEnv = Awaited<ReturnType<typeof makeEnv>>;

const login = (env: TestEnv, email: string, password: string, ip = '1.1.1.1') =>
  api(env, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'CF-Connecting-IP': ip },
  });

const post = (env: TestEnv, path: string, body: object, user: { id: number }) =>
  api(env, path, { method: 'POST', body: JSON.stringify(body) }, user);

// Route chỉ dùng trong test (router là đăng ký toàn cục theo module).
route('GET', '/test-only/admin', async () => ok({}), { role: 'ADMIN' });
route('GET', '/test-only/err', async () => {
  throw new ApiError(422, 'VALIDATION', 'x', { lines: [{ unit_cost_vnd: 7, qty: 1 }] });
});
route('GET', '/test-only/csv', async () => new Response('a,b', { headers: { 'Content-Type': 'text/csv' } }));
route('GET', '/test-only/csv-ok', async () => new Response('a,b', { headers: { 'Content-Type': 'text/csv' } }), {
  staffNonJson: true,
});
route('GET', '/test-only/costs', async () => ok({ rows: [{ sku: 'A', cost_avg_vnd: 5, qty: 1 }] }));

describe('đăng nhập', () => {
  it('login đúng → 200, Set-Cookie vk_admin có HttpOnly; Secure; SameSite=Strict', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    const res = await login(env, u.email, u.password);
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^vk_admin=\d+\.\d+\.[0-9a-f]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    const audit = await env.DB.prepare("SELECT user_id FROM audit_logs WHERE action = 'login'").all();
    expect(audit.results).toEqual([{ user_id: u.id }]);
    const me = await callWorker(
      new Request('https://test.local/api/admin/auth/me', { headers: { Cookie: cookie.split(';')[0] } }),
      env,
    );
    expect(((await me.json()) as { data: { email: string } }).data.email).toBe(u.email);
  });

  it('login sai → 401 INVALID_CREDENTIALS, không tiết lộ email có tồn tại hay không', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    const wrongPw = await login(env, u.email, 'sai-mat-khau');
    const noUser = await login(env, 'khong-co@test.local', 'sai-mat-khau');
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    const a = (await wrongPw.json()) as { error: { code: string } };
    const b = (await noUser.json()) as { error: { code: string } };
    expect(a.error.code).toBe('INVALID_CREDENTIALS');
    expect(b).toEqual(a);
    expect(wrongPw.headers.get('Set-Cookie')).toBeNull();
  });

  it('sai 6 lần trong 15 phút → lần 6 trả 429; đăng nhập đúng xoá bộ đếm', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    for (let i = 0; i < 5; i++) expect((await login(env, u.email, 'sai')).status).toBe(401);
    expect((await login(env, u.email, 'sai')).status).toBe(429);
    expect((await login(env, u.email, u.password)).status).toBe(429);
    expect((await login(env, u.email, u.password, '2.2.2.2')).status).toBe(200);
    await env.DB.prepare("UPDATE login_attempts SET window_start = datetime('now', '-16 minutes')").run();
    expect((await login(env, u.email, u.password)).status).toBe(200);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('8 lần sai song song cùng ip|email: tăng bộ đếm trước khi băm, tối đa 5 lần được xác thực', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    const results = await Promise.all(Array.from({ length: 8 }, () => login(env, u.email, 'sai')));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((c) => c === 429).length).toBeGreaterThanOrEqual(3);
    const row = await env.DB.prepare('SELECT count FROM login_attempts').first<{ count: number }>();
    expect(row?.count).toBe(8);
  });

  it('cửa sổ hết hạn: lần sai kế tiếp đặt lại đếm về 1', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    for (let i = 0; i < 5; i++) await login(env, u.email, 'sai');
    await env.DB.prepare("UPDATE login_attempts SET window_start = datetime('now', '-16 minutes')").run();
    expect((await login(env, u.email, 'sai')).status).toBe(401);
    const row = await env.DB.prepare('SELECT count FROM login_attempts').first<{ count: number }>();
    expect(row?.count).toBe(1);
  });
});

describe('phiên và phân quyền', () => {
  it('cookie hết hạn hoặc bị sửa chữ ký → 401', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    const secret = env.ADMIN_SESSION_SECRET as string;
    const expired = await signSession(u.id, secret, Date.now() - 8 * 24 * 3600 * 1000);
    const valid = await signSession(u.id, secret);
    const [, exp, sig] = valid.split('.');
    const tampered = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');
    const forgedId = `${u.id + 1}.${exp}.${sig}`;
    for (const token of [expired, tampered, forgedId, 'rac', '']) {
      const res = await callWorker(
        new Request('https://test.local/api/admin/auth/me', { headers: { Cookie: `vk_admin=${token}` } }),
        env,
      );
      expect(res.status).toBe(401);
    }
    expect((await callWorker(new Request('https://test.local/api/admin/auth/me'), env)).status).toBe(401);
    expect((await api(env, '/auth/me', {}, u)).status).toBe(200);
  });

  it('POST không có Origin hoặc Origin lạ → 403', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    const body = JSON.stringify({ email: u.email, password: u.password });
    const none = await callWorker(
      new Request('https://test.local/api/admin/auth/login', { method: 'POST', body }),
      env,
    );
    const other = await callWorker(
      new Request('https://test.local/api/admin/auth/login', {
        method: 'POST',
        body,
        headers: { Origin: 'https://evil.example' },
      }),
      env,
    );
    expect(none.status).toBe(403);
    expect(other.status).toBe(403);
  });

  it('STAFF gọi route role ADMIN → 403', async () => {
    const env = await makeEnv();
    const staff = await createUser(env.DB, 'STAFF');
    const admin = await createUser(env.DB, 'ADMIN');
    const denied = await api(env, '/test-only/admin', {}, staff);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    expect((await api(env, '/test-only/admin', {}, admin)).status).toBe(200);
  });

  it('user is_active=0 → 401 dù cookie hợp lệ', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'ADMIN');
    expect((await api(env, '/auth/me', {}, u)).status).toBe(200);
    await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(u.id).run();
    expect((await api(env, '/auth/me', {}, u)).status).toBe(401);
  });

  it('route không tồn tại → 404; router tự bỏ khoá giá vốn khỏi phản hồi cho STAFF', async () => {
    const env = await makeEnv();
    const staff = await createUser(env.DB, 'STAFF');
    const admin = await createUser(env.DB, 'ADMIN');
    expect((await api(env, '/khong-co', {}, admin)).status).toBe(404);
    const s = (await (await api(env, '/test-only/costs', {}, staff)).json()) as { data: { rows: object[] } };
    const a = (await (await api(env, '/test-only/costs', {}, admin)).json()) as { data: { rows: object[] } };
    expect(s.data.rows).toEqual([{ sku: 'A', qty: 1 }]);
    expect(a.data.rows).toEqual([{ sku: 'A', cost_avg_vnd: 5, qty: 1 }]);
  });
});

describe('redaction cho STAFF ngoài phản hồi thành công', () => {
  it('ApiError.details chứa unit_cost_vnd: STAFF không thấy, ADMIN thấy', async () => {
    const env = await makeEnv();
    const staff = await createUser(env.DB, 'STAFF');
    const admin = await createUser(env.DB, 'ADMIN');
    const s = await api(env, '/test-only/err', {}, staff);
    const a = await api(env, '/test-only/err', {}, admin);
    expect(s.status).toBe(422);
    expect(((await s.json()) as { error: { details: unknown } }).error.details).toEqual({ lines: [{ qty: 1 }] });
    expect(((await a.json()) as { error: { details: unknown } }).error.details).toEqual({
      lines: [{ unit_cost_vnd: 7, qty: 1 }],
    });
  });

  it('phản hồi không phải JSON: STAFF bị 500 REDACTION_UNSUPPORTED trừ khi route opt-in', async () => {
    const env = await makeEnv();
    const staff = await createUser(env.DB, 'STAFF');
    const admin = await createUser(env.DB, 'ADMIN');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const denied = await api(env, '/test-only/csv', {}, staff);
    expect(denied.status).toBe(500);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('REDACTION_UNSUPPORTED');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    expect(await (await api(env, '/test-only/csv-ok', {}, staff)).text()).toBe('a,b');
    expect(await (await api(env, '/test-only/csv', {}, admin)).text()).toBe('a,b');
  });
});

describe('đổi mật khẩu', () => {
  it('đúng mật khẩu hiện tại thì đổi được; next < 8 ký tự → 422', async () => {
    const env = await makeEnv();
    const u = await createUser(env.DB, 'STAFF');
    expect((await post(env, '/auth/change-password', { current: u.password, next: '1234567' }, u)).status).toBe(422);
    expect((await post(env, '/auth/change-password', { current: 'sai', next: 'mat-khau-moi-1' }, u)).status).toBe(401);
    expect((await post(env, '/auth/change-password', { current: u.password, next: 'mat-khau-moi-1' }, u)).status).toBe(200);
    expect((await login(env, u.email, 'mat-khau-moi-1')).status).toBe(200);
    expect((await login(env, u.email, u.password, '3.3.3.3')).status).toBe(401);
  });
});

describe('redact', () => {
  const data = {
    items: [{ sku: 'A', cost_avg_vnd: 1, lines: [{ unit_cost_vnd: 2, cost_total_vnd: 3, qty: 1 }] }],
    gross_profit_vnd: 9,
    gross_margin: 0.2,
    name: 'x',
  };
  it('redact xoá cost_avg_vnd lồng trong mảng cho STAFF, giữ cho ADMIN', () => {
    expect(redact(data, 'STAFF')).toEqual({ items: [{ sku: 'A', lines: [{ qty: 1 }] }], name: 'x' });
    expect(redact(data, 'ADMIN')).toEqual(data);
    expect(data.items[0]).toHaveProperty('cost_avg_vnd');
  });
});

describe('mật khẩu', () => {
  it('băm đúng định dạng pbkdf2$100000$salt$hash và xác thực được', async () => {
    const h = await hashPassword('abc12345');
    const [alg, iter, salt, hash] = h.split('$');
    expect([alg, iter]).toEqual(['pbkdf2', '100000']);
    expect(atob(salt).length).toBe(16);
    expect(atob(hash).length).toBe(32);
    expect(await verifyPassword('abc12345', h)).toBe(true);
    expect(await verifyPassword('abc12346', h)).toBe(false);
    expect(await verifyPassword('abc12345', 'rac')).toBe(false);
  });
});
