// Gọi Pancake POS Open API (https://docs.pancake.biz/pos/api/openapi.json): khoá qua query
// `api_key`, máy chủ https://pos.pages.fm/api/v1. Mỗi lời gọi có timeout và thử lại 1 lần khi
// lỗi mạng/5xx. Gói Free của Workers cho tối đa 50 lời gọi ra ngoài mỗi lần chạy → giới hạn trang.
import type { Env } from './env';

const BASE = 'https://pos.pages.fm/api/v1';
const TIMEOUT_MS = 10_000;
export const PAGE_SIZE = 100;
/** Tối đa số trang mỗi lần chạy (đơn + mẫu mã), giữ tổng lời gọi dưới 50. */
export const MAX_PAGES = 15;

export class PancakeApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined>;

async function call(env: Env, method: 'GET' | 'POST', path: string, query: Query = {}, body?: unknown): Promise<any> {
  if (!env.PANCAKE_API_KEY) throw new PancakeApiError('Chưa nạp PANCAKE_API_KEY', 0);
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set('api_key', env.PANCAKE_API_KEY);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.href, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 500) {
        lastErr = new PancakeApiError(`Pancake ${method} ${path} → ${res.status}`, res.status);
        continue;
      }
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data || data.success === false) {
        const msg = data?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new PancakeApiError(`Pancake ${method} ${path}: ${String(msg).slice(0, 200)}`, res.status);
      }
      return data;
    } catch (e) {
      if (e instanceof PancakeApiError && e.status > 0 && e.status < 500) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof PancakeApiError ? lastErr : new PancakeApiError(`Pancake ${method} ${path}: ${String(lastErr)}`, 0);
}

/** Đọc lần lượt các trang `data[]` cho tới hết hoặc chạm MAX_PAGES (`truncated = true`). */
async function allPages(env: Env, path: string, query: Query, budget: number): Promise<{ items: any[]; calls: number; truncated: boolean }> {
  const items: any[] = [];
  let calls = 0;
  for (let p = 1; p <= budget; p++) {
    const data = await call(env, 'GET', path, { ...query, page_number: p, page_size: PAGE_SIZE });
    calls++;
    items.push(...((data.data as any[]) ?? []));
    const total = Number(data.total_pages ?? 1);
    if (p >= total) return { items, calls, truncated: false };
  }
  return { items, calls, truncated: true };
}

/** Đơn có `updated_at` trong [start, end] (giây unix). */
export const listOrdersUpdated = (env: Env, shopId: string, start: number, end: number, budget = MAX_PAGES) =>
  allPages(env, `/shops/${shopId}/orders`, { updateStatus: 'updated_at', startDateTime: start, endDateTime: end }, budget);

/** Mọi mẫu mã của shop (`id`, `display_id`, ...). */
export const listVariations = (env: Env, shopId: string, budget = MAX_PAGES) =>
  allPages(env, `/shops/${shopId}/products/variations`, {}, budget);

/** Cập nhật số "có thể bán" (`is_actual_remain_quantity = false`) cho tối đa 100 mẫu mã. */
export const updateSellable = (
  env: Env,
  shopId: string,
  rows: { variation_id: string; remain_quantity: number; warehouse_id: string }[],
) =>
  call(env, 'POST', `/shops/${shopId}/variations/update_quantity`, {}, {
    is_actual_remain_quantity: false,
    variations_warehouses: rows,
  });
