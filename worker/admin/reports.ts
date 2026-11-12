import { z } from 'zod';
import { ApiError, ok, parseQuery } from '../lib/http';
import { inventoryAlerts } from './products';
import { route } from './router';

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86400000;
const ORDER_STATUSES = ['PENDING', 'PACKED', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'RETURNED'] as const;

// ---------------------------------------------------------------------------
// Tham số
// ---------------------------------------------------------------------------

const vnDate = z.string().refine((s) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}, 'Ngày phải có dạng YYYY-MM-DD');

const rangeFields = { from: vnDate, to: vnDate };

function checkRange(q: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const days = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / DAY_MS + 1;
  if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu' });
  else if (days > MAX_RANGE_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày` });
  }
}

const rangeQuery = z.object(rangeFields).superRefine(checkRange);
const salesQuery = z
  .object({ ...rangeFields, group: z.enum(['day', 'week', 'month', 'channel', 'product']) })
  .superRefine(checkRange);
const topQuery = z
  .object({ ...rangeFields, limit: z.coerce.number().int().min(1).max(100).default(10) })
  .superRefine(checkRange);

// ---------------------------------------------------------------------------
// Sự kiện bán / hoàn (nguồn duy nhất của doanh thu)
// ---------------------------------------------------------------------------

/**
 * Mỗi đơn có một sự kiện bán (+1) tại MIN(created_at) của SALE_OUT, và nếu bị trả/huỷ sau xuất kho
 * thì một sự kiện hoàn (−1) tại MIN(created_at) của RETURN_* / CANCEL_RESTOCK. Ngày theo giờ Việt Nam.
 */
const EVENTS_CTE = `
  ev AS (
    SELECT ref_order_code AS code, date(MIN(created_at), '+7 hours') AS day, 1 AS sign
      FROM inventory_logs WHERE reason = 'SALE_OUT' AND ref_order_code IS NOT NULL GROUP BY ref_order_code
    UNION ALL
    SELECT ref_order_code, date(MIN(created_at), '+7 hours'), -1
      FROM inventory_logs
     WHERE reason IN ('RETURN_RESTOCK', 'RETURN_DAMAGED', 'CANCEL_RESTOCK') AND ref_order_code IS NOT NULL
     GROUP BY ref_order_code
  )`;

interface Money {
  orders: number;
  returns: number;
  revenue: number;
  cost: number;
}

const emptyMoney = (): Money => ({ orders: 0, returns: 0, revenue: 0, cost: 0 });

function addMoney(into: Money, m: Money): void {
  into.orders += m.orders;
  into.returns += m.returns;
  into.revenue += m.revenue;
  into.cost += m.cost;
}

interface DayChannelRow extends Money {
  day: string;
  channel: string;
}

/** Doanh thu / giá vốn đã gộp theo (ngày VN, kênh) trong khoảng [from, to]. */
async function dayChannelRows(db: D1Database, from: string, to: string): Promise<DayChannelRow[]> {
  const res = await db
    .prepare(
      `WITH ${EVENTS_CTE},
       oc AS (SELECT order_id, SUM(COALESCE(unit_cost_vnd, 0) * quantity) AS cost FROM order_items GROUP BY order_id)
       SELECT ev.day AS day, o.channel AS channel,
              SUM(ev.sign * (o.subtotal_vnd - o.discount_vnd)) AS revenue,
              SUM(ev.sign * COALESCE(oc.cost, 0)) AS cost,
              SUM(ev.sign = 1) AS orders,
              SUM(ev.sign = -1) AS returns
         FROM ev
         JOIN orders o ON o.order_code = ev.code
         LEFT JOIN oc ON oc.order_id = o.id
        WHERE ev.day BETWEEN ?1 AND ?2
        GROUP BY ev.day, o.channel
        ORDER BY ev.day, o.channel`,
    )
    .bind(from, to)
    .all<DayChannelRow>();
  return res.results;
}

/** Tổng doanh thu / giá vốn trong khoảng (dùng cho dashboard, cùng logic với báo cáo). */
async function totalsBetween(db: D1Database, from: string, to: string): Promise<Money> {
  const total = emptyMoney();
  for (const r of await dayChannelRows(db, from, to)) addMoney(total, r);
  return total;
}

function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Thứ Hai = 0
  const thursday = new Date(d.getTime() + (3 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function present(key: string, m: Money, extra: Record<string, unknown> = {}) {
  const profit = m.revenue - m.cost;
  return {
    key,
    ...extra,
    orders: m.orders,
    returns: m.returns,
    revenue_vnd: m.revenue,
    cost_total_vnd: m.cost,
    gross_profit_vnd: profit,
    gross_margin: m.revenue === 0 ? 0 : Math.round((profit / m.revenue) * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Theo sản phẩm (phân bổ giảm giá đơn theo dòng)
// ---------------------------------------------------------------------------

interface LineRow {
  sign: number;
  order_id: number;
  discount_vnd: number;
  sku: string;
  product_name: string;
  quantity: number;
  line_total: number;
  line_cost: number;
}

interface ProductAgg extends Money {
  sku: string;
  name: string;
  quantity: number;
}

/** Chia `discount` theo line_total (số nguyên); phần dư vào dòng lớn nhất (dòng đầu nếu hoà). */
function allocateDiscount(lines: LineRow[]): number[] {
  const discount = lines[0].discount_vnd;
  const sum = lines.reduce((s, l) => s + l.line_total, 0);
  if (discount === 0 || sum === 0) return lines.map(() => 0);
  const parts = lines.map((l) => Math.floor((discount * l.line_total) / sum));
  let biggest = 0;
  lines.forEach((l, i) => {
    if (l.line_total > lines[biggest].line_total) biggest = i;
  });
  parts[biggest] += discount - parts.reduce((s, p) => s + p, 0);
  return parts;
}

async function productTotals(db: D1Database, from: string, to: string): Promise<ProductAgg[]> {
  const res = await db
    .prepare(
      `WITH ${EVENTS_CTE}
       SELECT ev.sign AS sign, o.id AS order_id, o.discount_vnd AS discount_vnd, i.sku AS sku,
              i.product_name AS product_name, i.quantity AS quantity, i.line_total AS line_total,
              COALESCE(i.unit_cost_vnd, 0) * i.quantity AS line_cost
         FROM ev
         JOIN orders o ON o.order_code = ev.code
         JOIN order_items i ON i.order_id = o.id
        WHERE ev.day BETWEEN ?1 AND ?2
        ORDER BY ev.code, ev.sign, i.id`,
    )
    .bind(from, to)
    .all<LineRow>();

  const aggs = new Map<string, ProductAgg>();
  const rows = res.results;
  for (let start = 0; start < rows.length; ) {
    let end = start + 1;
    while (end < rows.length && rows[end].order_id === rows[start].order_id && rows[end].sign === rows[start].sign) end++;
    const lines = rows.slice(start, end);
    const discounts = allocateDiscount(lines);
    lines.forEach((l, i) => {
      const a = aggs.get(l.sku) ?? { sku: l.sku, name: l.product_name, quantity: 0, ...emptyMoney() };
      a.quantity += l.sign * l.quantity;
      a.revenue += l.sign * (l.line_total - discounts[i]);
      a.cost += l.sign * l.line_cost;
      if (l.sign > 0) a.orders += 1;
      else a.returns += 1;
      aggs.set(l.sku, a);
    });
    start = end;
  }
  return [...aggs.values()];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

route(
  'GET',
  '/reports/sales',
  async ({ env, url }) => {
    const q = parseQuery(url, salesQuery);
    if (q.group === 'product') {
      const rows = await productTotals(env.DB, q.from, q.to);
      rows.sort((a, b) => b.revenue - a.revenue || a.sku.localeCompare(b.sku));
      return ok(rows.map((r) => present(r.sku, r, { name: r.name })));
    }
    const buckets = new Map<string, Money>();
    for (const r of await dayChannelRows(env.DB, q.from, q.to)) {
      const key =
        q.group === 'day' ? r.day : q.group === 'month' ? r.day.slice(0, 7) : q.group === 'week' ? isoWeekKey(r.day) : r.channel;
      const m = buckets.get(key) ?? emptyMoney();
      addMoney(m, r);
      buckets.set(key, m);
    }
    return ok([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, m]) => present(k, m)));
  },
  { role: 'ADMIN' },
);

route(
  'GET',
  '/reports/top-products',
  async ({ env, url }) => {
    const q = parseQuery(url, topQuery);
    const rows = (await productTotals(env.DB, q.from, q.to)).filter((r) => r.quantity > 0);
    rows.sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.sku.localeCompare(b.sku));
    return ok(rows.slice(0, q.limit).map((r) => ({ sku: r.sku, name: r.name, quantity: r.quantity, revenue_vnd: r.revenue })));
  },
  { role: 'ADMIN' },
);

route('GET', '/reports/stock-movement', async ({ env, url }) => {
  const q = parseQuery(url, rangeQuery);
  // Tồn đầu/cuối tính ngược từ tồn hiện tại (sản phẩm web có tồn mà không có lịch sử sổ).
  const res = await env.DB.prepare(
    `SELECT p.sku AS sku, p.name AS name, p.stock_qty AS stock_qty,
            COALESCE(SUM(CASE WHEN l.d >= ?1 THEN l.delta END), 0) AS since_from,
            COALESCE(SUM(CASE WHEN l.d > ?2 THEN l.delta END), 0) AS after_to,
            COALESCE(SUM(CASE WHEN l.d BETWEEN ?1 AND ?2 AND l.reason = 'RECEIPT' THEN l.delta END), 0) AS received,
            COALESCE(SUM(CASE WHEN l.d BETWEEN ?1 AND ?2
                               AND l.reason IN ('SALE_OUT', 'CANCEL_RESTOCK', 'RETURN_RESTOCK') THEN l.delta END), 0) AS sold_delta,
            COALESCE(SUM(CASE WHEN l.d BETWEEN ?1 AND ?2 AND l.reason = 'ISSUE' THEN l.delta END), 0) AS issue_delta,
            COALESCE(SUM(CASE WHEN l.d BETWEEN ?1 AND ?2
                               AND l.reason NOT IN ('RECEIPT', 'ISSUE', 'SALE_OUT', 'CANCEL_RESTOCK', 'RETURN_RESTOCK')
                              THEN l.delta END), 0) AS adjusted
       FROM products p
       LEFT JOIN (SELECT sku, delta, reason, date(created_at, '+7 hours') AS d FROM inventory_logs) l ON l.sku = p.sku
      WHERE p.is_combo = 0
      GROUP BY p.sku
      ORDER BY p.product_id`,
  )
    .bind(q.from, q.to)
    .all<{
      sku: string;
      name: string;
      stock_qty: number;
      since_from: number;
      after_to: number;
      received: number;
      sold_delta: number;
      issue_delta: number;
      adjusted: number;
    }>();
  return ok(
    res.results.map((r) => ({
      sku: r.sku,
      name: r.name,
      opening: r.stock_qty - r.since_from,
      received: r.received,
      sold_out: -r.sold_delta,
      other_out: -r.issue_delta,
      adjusted: r.adjusted,
      closing: r.stock_qty - r.after_to,
    })),
  );
});

route('GET', '/reports/dashboard', async ({ env }) => {
  const now = await env.DB.prepare("SELECT date('now', '+7 hours') AS today").first<{ today: string }>();
  if (!now) throw new ApiError(500, 'INTERNAL', 'Lỗi hệ thống, vui lòng thử lại.');
  const today = now.today;
  const [statuses, unmatched] = await env.DB.batch([
    env.DB.prepare('SELECT order_status AS status, COUNT(*) AS n FROM orders GROUP BY order_status'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM sepay_webhook_logs WHERE match_status = 'UNMATCHED'"),
  ]);
  const orders_by_status: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const r of statuses.results as { status: string; n: number }[]) orders_by_status[r.status] = r.n;

  const [dayTotal, monthTotal, alerts] = await Promise.all([
    totalsBetween(env.DB, today, today),
    totalsBetween(env.DB, `${today.slice(0, 7)}-01`, today),
    inventoryAlerts(env.DB),
  ]);
  return ok({
    today_revenue_vnd: dayTotal.revenue,
    month_revenue_vnd: monthTotal.revenue,
    orders_by_status,
    pending_orders: orders_by_status.PENDING,
    alerts_count: alerts.low_stock.length + alerts.expiring.length,
    sepay_unmatched: (unmatched.results[0] as { n: number }).n,
  });
});
