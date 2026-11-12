// Công nợ B2B: đơn đã PACKED trở đi còn thiếu tiền (total_amount > paid_amount). Tính toàn bộ bằng SQL.
import { idSchema, pageQuerySchema } from '../../src/shared/schemas';
import { ApiError, ok, parseQuery } from '../lib/http';
import type { AdminCtx } from './auth';
import { route } from './router';

const TODAY = `date('now', '+7 hours')`;
const OUTSTANDING = `o.order_status IN ('PACKED', 'SHIPPING', 'COMPLETED') AND o.total_amount > o.paid_amount`;

const DEBT_COLS = `c.id AS customer_id, c.name, d.outstanding_vnd, d.overdue_vnd, d.oldest_due_date,
  c.credit_limit_vnd,
  CASE WHEN c.credit_limit_vnd > 0 AND d.outstanding_vnd > c.credit_limit_vnd THEN 1 ELSE 0 END AS over_limit`;

const DEBT_JOIN = `FROM customers c
  JOIN (SELECT o.customer_id,
               SUM(o.total_amount - o.paid_amount) AS outstanding_vnd,
               SUM(CASE WHEN o.due_date IS NOT NULL AND o.due_date < ${TODAY} THEN o.total_amount - o.paid_amount ELSE 0 END)
                 AS overdue_vnd,
               MIN(o.due_date) AS oldest_due_date
        FROM orders o WHERE ${OUTSTANDING} AND o.customer_id IS NOT NULL GROUP BY o.customer_id) d
    ON d.customer_id = c.id
  WHERE c.type = 'B2B' AND d.outstanding_vnd > 0`;

route('GET', '/debts', async ({ env, url }) => {
  const q = parseQuery(url, pageQuerySchema);
  const [items, total] = await env.DB.batch([
    env.DB.prepare(`SELECT ${DEBT_COLS} ${DEBT_JOIN} ORDER BY d.outstanding_vnd DESC, c.id LIMIT ?1 OFFSET ?2`).bind(
      q.page_size,
      (q.page - 1) * q.page_size,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n ${DEBT_JOIN}`),
  ]);
  return ok({
    items: (items.results as { over_limit: number }[]).map((r) => ({ ...r, over_limit: r.over_limit === 1 })),
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('GET', '/debts/:customerId', async (c: AdminCtx) => {
  const parsed = idSchema.safeParse(c.params.customerId);
  if (!parsed.success) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy khách hàng.');
  const id = parsed.data;
  const [customer, orders] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name, type, credit_limit_vnd, payment_terms_days FROM customers WHERE id = ?').bind(id),
    c.env.DB.prepare(
      `SELECT o.id, o.order_code, o.order_status, o.total_amount, o.paid_amount,
              o.total_amount - o.paid_amount AS outstanding_vnd, o.due_date,
              CASE WHEN o.due_date IS NOT NULL AND o.due_date < ${TODAY}
                   THEN CAST(julianday(${TODAY}) - julianday(o.due_date) AS INTEGER) ELSE 0 END AS days_overdue
       FROM orders o WHERE o.customer_id = ? AND ${OUTSTANDING}
       ORDER BY o.due_date IS NULL, o.due_date, o.id`,
    ).bind(id),
  ]);
  if (customer.results.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy khách hàng.');
  return ok({ customer: customer.results[0], items: orders.results });
});
