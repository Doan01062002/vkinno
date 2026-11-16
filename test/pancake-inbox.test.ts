import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../worker/index';
import { callWorker, makeEnv } from './helpers';

const KEY = 'pancake-test-key-0123456789';
const URL_ = 'https://test.local/api/webhook/pancake';

let env: Env;

beforeEach(async () => {
  env = await makeEnv({ PANCAKE_WEBHOOK_SECRET: KEY });
});

function post(body: string, headers: Record<string, string> = { 'X-VK-Key': KEY }): Promise<Response> {
  return callWorker(
    new Request(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }),
    env,
  );
}

async function inbox(): Promise<{ body: string; content_type: string }[]> {
  const r = await env.DB.prepare("SELECT payload_json AS body, 'application/json' AS content_type FROM pancake_events ORDER BY id").all<{
    body: string;
    content_type: string;
  }>();
  return r.results;
}

describe('POST /api/webhook/pancake (xác thực + lưu payload thô vào pancake_events)', () => {
  it('đúng khoá → 200 và lưu nguyên văn thân yêu cầu', async () => {
    const body = JSON.stringify({ id: 123, status: 0, shop_id: 101119774, is_from_ecommerce: true });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    const rows = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(body);
    expect(rows[0].content_type).toBe('application/json');
  });

  it('sai khoá hoặc thiếu khoá → 401, không lưu gì', async () => {
    expect((await post('{}', { 'X-VK-Key': 'sai' })).status).toBe(401);
    expect((await post('{}', {})).status).toBe(401);
    expect(await inbox()).toHaveLength(0);
  });

  it('chưa nạp PANCAKE_WEBHOOK_SECRET → 503', async () => {
    env = await makeEnv();
    expect((await post('{}')).status).toBe(503);
  });

  it('thân yêu cầu quá 512 KB → 413, không lưu', async () => {
    const res = await post(JSON.stringify({ pad: 'x'.repeat(513 * 1024) }));
    expect(res.status).toBe(413);
    expect(await inbox()).toHaveLength(0);
  });

  it('chỉ nhận POST', async () => {
    const res = await callWorker(new Request(URL_, { method: 'GET', headers: { 'X-VK-Key': KEY } }), env);
    expect(res.status).not.toBe(200);
    expect(await inbox()).toHaveLength(0);
  });
});
