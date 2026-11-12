import worker from '../worker/index';
import type { Env } from '../worker/index';
import { applyMigrations, createTestD1 } from './d1-sqlite';
import { createMemoryR2 } from './r2-memory';
import { hashPassword, signSession, type Role } from '../worker/admin/auth';

/** Env mới: D1 đã áp migrations, R2 bộ nhớ, ASSETS luôn trả 404. */
export async function makeEnv(overrides: Partial<Env> = {}): Promise<Env> {
  const DB = createTestD1();
  await applyMigrations(DB);
  return {
    DB,
    FILES: createMemoryR2(),
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } as unknown as Fetcher,
    ADMIN_SESSION_SECRET: 'test-secret-test-secret-test-secret',
    ...overrides,
  };
}

/** Gọi handler fetch của Worker; chờ mọi waitUntil xong trước khi trả về. */
export async function callWorker(req: Request, env: Env): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const res = await worker.fetch(req, env, ctx);
  await Promise.all(pending);
  return res;
}

/** 9 sản phẩm của 0001: tồn 100, không giữ, giá vốn 50.000. */
export async function seedProducts(db: D1Database): Promise<void> {
  await db.prepare('UPDATE products SET stock_qty = 100, reserved_qty = 0, cost_avg_vnd = 50000').run();
}

let userSeq = 0;

/** Tạo người dùng đang hoạt động; trả về id, email và mật khẩu rõ để đăng nhập. */
export async function createUser(
  db: D1Database,
  role: Role,
  overrides: { email?: string; name?: string; password?: string; is_active?: number } = {},
): Promise<{ id: number; email: string; password: string }> {
  userSeq += 1;
  const email = overrides.email ?? `${role.toLowerCase()}${userSeq}@test.local`;
  const password = overrides.password ?? 'matkhau-test-123';
  const res = await db
    .prepare('INSERT INTO users (email, name, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?)')
    .bind(email, overrides.name ?? `Người dùng ${userSeq}`, role, await hashPassword(password), overrides.is_active ?? 1)
    .run();
  return { id: Number(res.meta.last_row_id), email, password };
}

/** Gọi `/api/admin<path>`; có `user` thì kèm cookie phiên hợp lệ, POST/PUT/DELETE kèm Origin. */
export async function api(
  env: Env,
  path: string,
  init: RequestInit = {},
  user?: { id: number },
): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && !headers.has('Origin')) headers.set('Origin', 'https://test.local');
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (user) {
    headers.set('Cookie', `vk_admin=${await signSession(user.id, env.ADMIN_SESSION_SECRET as string)}`);
  }
  return callWorker(new Request(`https://test.local/api/admin${path}`, { ...init, method, headers }), env);
}
