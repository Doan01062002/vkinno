import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, fail, ok, parseBody } from '../worker/lib/http';
import { docCode } from '../worker/lib/codes';
import { callWorker, makeEnv } from './helpers';

const post = (body: string) =>
  new Request('https://test.local/x', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });

describe('http', () => {
  it('parseBody trả 422 kèm fieldErrors', async () => {
    const schema = z.object({ name: z.string().min(1), qty: z.number().int() });
    const err = await parseBody(post(JSON.stringify({ name: '', qty: 'x' })), schema).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    const res = fail(err);
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION');
    expect(Object.keys(body.error.details)).toEqual(expect.arrayContaining(['name', 'qty']));
  });

  it('parseBody trả 400 BAD_JSON và 413 PAYLOAD_TOO_LARGE', async () => {
    const schema = z.object({});
    const bad = await parseBody(post('{oops'), schema).catch((e) => e);
    expect(bad.status).toBe(400);
    expect(bad.code).toBe('BAD_JSON');
    const big = await parseBody(post(JSON.stringify({ a: 'x'.repeat(100) })), schema, 50).catch((e) => e);
    expect(big.status).toBe(413);
    expect(big.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('ok bọc dữ liệu thành công', async () => {
    const res = ok({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, data: { a: 1 } });
  });

  it('fail ánh xạ CHECK constraint → 409 STOCK_CONFLICT', async () => {
    const res = fail(new Error('D1_ERROR: CHECK constraint failed: reserved_qty <= stock_qty'));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('STOCK_CONFLICT');
  });

  it('fail trả 500 INTERNAL và ghi console.error cho lỗi lạ', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fail(new Error('boom'));
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).error.code).toBe('INTERNAL');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("docCode('PN') khớp định dạng và dùng ngày giờ Việt Nam", () => {
    expect(docCode('PN', new Date('2026-01-05T03:00:00Z'))).toMatch(/^PN260105-[A-Z0-9]{4}$/);
    expect(docCode('PX', new Date('2026-01-05T20:00:00Z'))).toMatch(/^PX260106-[A-Z0-9]{4}$/);
  });
});

describe('hồi quy API công khai', () => {
  it('GET /api/products.json vẫn trả ok:true và đủ 9 sản phẩm', async () => {
    const res = await callWorker(new Request('https://test.local/api/products.json'), await makeEnv());
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.products).toHaveLength(9);
  });
});
