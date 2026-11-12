import { customerInput, customerListQuery, idSchema, pageQuerySchema } from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { isValidVnPhone, normalizeVnPhone } from '../lib/phone';
import { auditStmt } from './audit';
import type { AdminCtx } from './auth';
import { route } from './router';

const isUnique = (e: unknown) => e instanceof Error && e.message.includes('UNIQUE constraint failed');

const invalidPhone = () =>
  new ApiError(422, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.', { phone: ['Số điện thoại không hợp lệ'] });

/**
 * Câu lệnh tạo/cập nhật khách theo SĐT để gộp vào batch của đơn hàng. Khách đã có: chỉ điền
 * tên/email/địa chỉ khi giá trị đang lưu rỗng và giá trị mới không rỗng (không ghi đè dữ liệu có sẵn).
 * `customerIdSql` + `bind` dùng để tham chiếu id khách trong cùng batch.
 */
export async function upsertCustomerByPhoneStmts(
  db: D1Database,
  input: { phone: string; name: string; email?: string; address?: string },
): Promise<{ stmts: D1PreparedStatement[]; customerIdSql: string; bind: unknown[] }> {
  const phone = normalizeVnPhone(input.phone);
  if (!isValidVnPhone(phone)) throw invalidPhone();
  const fill = (col: string) =>
    `${col} = CASE WHEN ${col} = '' AND excluded.${col} <> '' THEN excluded.${col} ELSE ${col} END`;
  const stmt = db
    .prepare(
      `INSERT INTO customers (phone, name, email, address) VALUES (?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET ${fill('name')}, ${fill('email')}, ${fill('address')},
         updated_at = datetime('now')`,
    )
    .bind(phone, (input.name ?? '').trim(), (input.email ?? '').trim(), (input.address ?? '').trim());
  return { stmts: [stmt], customerIdSql: '(SELECT id FROM customers WHERE phone = ?)', bind: [phone] };
}

const SPEND_SQL = `COALESCE((SELECT SUM(o.total_amount) FROM orders o
  WHERE o.customer_id = c.id AND o.order_status NOT IN ('CANCELLED', 'RETURNED')), 0)`;
const ORDER_COUNT_SQL = '(SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id)';
const COLS = `c.id, c.phone, c.name, c.type, c.company_name, c.tax_code, c.email, c.address,
  c.credit_limit_vnd, c.payment_terms_days, c.price_tier, c.note, c.created_at, c.updated_at,
  ${SPEND_SQL} AS total_spent_vnd, ${ORDER_COUNT_SQL} AS order_count`;

function parseId(c: AdminCtx): number {
  const parsed = idSchema.safeParse(c.params.id);
  if (!parsed.success) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy khách hàng.');
  return parsed.data;
}

async function loadCustomer(db: D1Database, id: number) {
  const row = await db.prepare(`SELECT ${COLS} FROM customers c WHERE c.id = ?`).bind(id).first();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy khách hàng.');
  return row;
}

const duplicatePhone = () => new ApiError(409, 'DUPLICATE_PHONE', 'Số điện thoại đã thuộc về khách hàng khác.');

function normalizedInput(body: ReturnType<typeof customerInput.parse>) {
  const phone = normalizeVnPhone(body.phone);
  if (!isValidVnPhone(phone)) throw invalidPhone();
  return {
    ...body,
    phone,
    credit_limit_vnd: body.credit_limit_vnd ?? 0,
    payment_terms_days: body.payment_terms_days ?? 0,
  };
}

route('GET', '/customers', async ({ env, url }) => {
  const q = parseQuery(url, customerListQuery);
  const where = `WHERE (?1 IS NULL OR c.type = ?1)
      AND (?2 IS NULL OR c.name LIKE '%' || ?2 || '%' OR c.phone LIKE '%' || ?2 || '%'
           OR c.company_name LIKE '%' || ?2 || '%' OR c.email LIKE '%' || ?2 || '%')`;
  const filters = [q.type ?? null, q.q || null];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} FROM customers c ${where} ORDER BY c.id DESC LIMIT ?3 OFFSET ?4`).bind(
      ...filters,
      q.page_size,
      (q.page - 1) * q.page_size,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM customers c ${where}`).bind(...filters),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('POST', '/customers', async ({ env, req, user }) => {
  const input = normalizedInput(await parseBody(req, customerInput));
  const dup = await env.DB.prepare('SELECT id FROM customers WHERE phone = ?').bind(input.phone).first();
  if (dup) throw duplicatePhone();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO customers (phone, name, type, company_name, tax_code, email, address,
           credit_limit_vnd, payment_terms_days, price_tier, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.phone,
        input.name,
        input.type,
        input.company_name,
        input.tax_code,
        input.email,
        input.address,
        input.credit_limit_vnd,
        input.payment_terms_days,
        input.price_tier,
        input.note,
      ),
      auditStmt(env.DB, user.id, 'customer.create', 'customer', input.phone, { type: input.type }),
    ]);
  } catch (e) {
    if (isUnique(e)) throw duplicatePhone();
    throw e;
  }
  const row = await env.DB.prepare('SELECT id FROM customers WHERE phone = ?').bind(input.phone).first<{ id: number }>();
  return ok(await loadCustomer(env.DB, row!.id), 201);
});

route('GET', '/customers/:id', async (c) => ok(await loadCustomer(c.env.DB, parseId(c))));

route('PUT', '/customers/:id', async (c) => {
  const { env, req, user } = c;
  const id = parseId(c);
  const input = normalizedInput(await parseBody(req, customerInput));
  await loadCustomer(env.DB, id);
  const dup = await env.DB.prepare('SELECT id FROM customers WHERE phone = ? AND id <> ?').bind(input.phone, id).first();
  if (dup) throw duplicatePhone();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE customers SET phone = ?, name = ?, type = ?, company_name = ?, tax_code = ?, email = ?,
           address = ?, credit_limit_vnd = ?, payment_terms_days = ?, price_tier = ?, note = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).bind(
        input.phone,
        input.name,
        input.type,
        input.company_name,
        input.tax_code,
        input.email,
        input.address,
        input.credit_limit_vnd,
        input.payment_terms_days,
        input.price_tier,
        input.note,
        id,
      ),
      auditStmt(env.DB, user.id, 'customer.update', 'customer', id, { type: input.type }),
    ]);
  } catch (e) {
    if (isUnique(e)) throw duplicatePhone();
    throw e;
  }
  return ok(await loadCustomer(env.DB, id));
});

route('GET', '/customers/:id/orders', async (c) => {
  const { env, url } = c;
  const id = parseId(c);
  await loadCustomer(env.DB, id);
  const q = parseQuery(url, pageQuerySchema.pick({ page: true, page_size: true }));
  const [items, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, order_code, channel, order_status, payment_status, total_amount, paid_amount, created_at
       FROM orders WHERE customer_id = ?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3`,
    ).bind(id, q.page_size, (q.page - 1) * q.page_size),
    env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').bind(id),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});
