import type { Role } from './auth';

/** Các khoá giá vốn / lợi nhuận mà STAFF không được thấy. */
export const COST_KEYS: ReadonlySet<string> = new Set([
  'cost_avg_vnd',
  'unit_cost_vnd',
  'cost_total_vnd',
  'gross_profit_vnd',
  'gross_margin',
]);

/** Các khoá doanh thu (dashboard) chỉ dành cho ADMIN. */
export const ADMIN_ONLY_KEYS: ReadonlySet<string> = new Set(['today_revenue_vnd', 'month_revenue_vnd']);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!COST_KEYS.has(k) && !ADMIN_ONLY_KEYS.has(k)) out[k] = strip(v);
    }
    return out;
  }
  return value;
}

/** Bỏ đệ quy các khoá giá vốn và doanh thu dashboard (ADMIN_ONLY_KEYS) khi role là STAFF; ADMIN giữ nguyên. */
export function redact<T>(data: T, role: Role): T {
  return role === 'STAFF' ? (strip(data) as T) : data;
}
