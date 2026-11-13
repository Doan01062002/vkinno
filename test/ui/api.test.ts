import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch, setUnauthorizedHandler } from '../../src/admin/lib/api';

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apiFetch', () => {
  it('apiFetch ném ApiClientError có code và details khi 422', async () => {
    const details = { name: ['Bắt buộc'] };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonRes(422, { ok: false, error: { code: 'VALIDATION', message: 'Dữ liệu không hợp lệ.', details } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await apiFetch('/customers', { method: 'POST', json: { name: '' } }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION', message: 'Dữ liệu không hợp lệ.', details });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/customers');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe('{"name":""}');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('401 gọi điều hướng tới /quan-tri/dang-nhap', async () => {
    const navigate = vi.fn();
    setUnauthorizedHandler(navigate);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonRes(401, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Vui lòng đăng nhập.' } })),
    );

    const err = await apiFetch('/orders').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(401);
    expect(navigate).toHaveBeenCalledWith('/quan-tri/dang-nhap');
  });

  it('sai mật khẩu (401 ở /auth/login) không điều hướng', async () => {
    const navigate = vi.fn();
    setUnauthorizedHandler(navigate);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonRes(401, { ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } }),
      ),
    );

    const err = await apiFetch('/auth/login', { method: 'POST', json: { email: 'a@b.c', password: 'x' } }).catch(
      (e: unknown) => e,
    );

    expect((err as ApiClientError).code).toBe('INVALID_CREDENTIALS');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('trả data khi thành công và ghép query bỏ giá trị rỗng', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonRes(200, { ok: true, data: { items: [], total: 0, page: 2, page_size: 50 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiFetch<{ page: number }>('/orders', { query: { page: 2, q: 'Nguyễn', status: '', x: undefined } });

    expect(data.page).toBe(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/orders?page=2&q=Nguy%E1%BB%85n');
  });

  it('phản hồi không phải JSON vẫn ném ApiClientError tiếng Việt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));

    const err = (await apiFetch('/orders').catch((e: unknown) => e)) as ApiClientError;

    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/máy chủ/i);
  });
});
