import worker from '../worker/index';
import type { Env } from '../worker/index';
import { applyMigrations, createTestD1 } from './d1-sqlite';
import { createMemoryR2 } from './r2-memory';

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
