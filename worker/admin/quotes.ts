// Báo giá B2B: tạo/sửa khi DRAFT hoặc SENT, chuyển trạng thái, chuyển thành đơn. Mọi đổi trạng thái
// dùng câu lệnh guard đầu batch (sai trạng thái → 'INVALID' → CHECK lỗi → rollback), nên hai thao tác
// đồng thời không thể cùng thắng. Trạng thái EXPIRED chỉ tính lúc đọc, không lưu.
import { idSchema, quoteInput, quoteListQuery, quoteStatusInput, type QuoteInput } from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { docCode } from '../lib/codes';
import { auditStmt } from './audit';
import type { AdminCtx } from './auth';
import { createOrder, quoteNotConvertible } from './orders';
import { isCheckError, isUniqueError } from '../lib/db-errors';
import { route } from './router';

const TODAY = `date('now', '+7 hours')`;
const EFFECTIVE_STATUS = `CASE WHEN q.status IN ('DRAFT', 'SENT', 'ACCEPTED') AND q.valid_until IS NOT NULL
  AND q.valid_until < ${TODAY} THEN 'EXPIRED' ELSE q.status END`;
const SUBTOTAL = '(SELECT COALESCE(SUM(i.unit_price * i.quantity), 0) FROM quote_items i WHERE i.quote_id = q.id)';
const COLS = `q.id, q.code, q.customer_id, c.name AS customer_name, ${EFFECTIVE_STATUS} AS status, q.valid_until,
  q.note, q.discount_vnd, q.shipping_fee_vnd, q.created_by, q.created_at,
  ${SUBTOTAL} AS subtotal_vnd, ${SUBTOTAL} - q.discount_vnd + q.shipping_fee_vnd AS total_amount`;
const FROM = 'FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id';

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Không tìm thấy báo giá.');

function parseId(c: AdminCtx): number {
  const parsed = idSchema.safeParse(c.params.id);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

interface StoredQuote {
  id: number;
  code: string;
  status: string;
  customer_id: number | null;
  expired: number;
}

async function loadStored(db: D1Database, id: number): Promise<StoredQuote> {
  const row = await db
    .prepare(
      `SELECT id, code, status, customer_id,
              CASE WHEN valid_until IS NOT NULL AND valid_until < ${TODAY} THEN 1 ELSE 0 END AS expired
       FROM quotes WHERE id = ?`,
    )
    .bind(id)
    .first<StoredQuote>();
  if (!row) throw notFound();
  return row;
}

async function quoteDetail(db: D1Database, id: number) {
  const [quote, items] = await db.batch([
    db.prepare(`SELECT ${COLS} ${FROM} WHERE q.id = ?`).bind(id),
    db
      .prepare(
        `SELECT id, sku, product_name, unit_price, quantity, unit_price * quantity AS line_total
         FROM quote_items WHERE quote_id = ? ORDER BY id`,
      )
      .bind(id),
  ]);
  if (quote.results.length === 0) throw notFound();
  return { ...(quote.results[0] as object), items: items.results };
}

/** Khách phải tồn tại; SKU phải tồn tại, đang bán, không trùng. Trả tên sản phẩm theo SKU. */
async function validateInput(db: D1Database, input: QuoteInput): Promise<Map<string, string>> {
  const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').bind(input.customer_id).first();
  if (!customer) {
    throw new ApiError(422, 'VALIDATION', 'Khách hàng không tồn tại.', { customer_id: ['Không tồn tại'] });
  }
  const res = await db
    .prepare('SELECT sku, name, is_active FROM products WHERE sku IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(input.items.map((i) => i.sku)))
    .all<{ sku: string; name: string; is_active: number }>();
  const found = new Map(res.results.map((p) => [p.sku, p]));
  const seen = new Set<string>();
  input.items.forEach((l, index) => {
    const p = found.get(l.sku);
    let problem: string | null = null;
    if (seen.has(l.sku)) problem = `SKU ${l.sku} bị trùng trong báo giá`;
    else if (!p) problem = `Sản phẩm ${l.sku} không tồn tại`;
    else if (p.is_active !== 1) problem = `Sản phẩm ${l.sku} đã ngừng bán`;
    seen.add(l.sku);
    if (problem) throw new ApiError(422, 'INVALID_LINE', `Dòng ${index + 1}: ${problem}.`, { index, sku: l.sku });
  });
  const subtotal = input.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  if (input.discount_vnd > subtotal) {
    throw new ApiError(422, 'VALIDATION', 'Giảm giá không được lớn hơn tạm tính.', {
      discount_vnd: ['Giảm giá không được lớn hơn tạm tính'],
    });
  }
  return new Map(res.results.map((p) => [p.sku, p.name]));
}

function insertItemStmts(db: D1Database, quoteSql: string, bind: unknown[], input: QuoteInput, names: Map<string, string>) {
  return input.items.map((i) =>
    db
      .prepare(
        `INSERT INTO quote_items (quote_id, sku, product_name, unit_price, quantity) VALUES (${quoteSql}, ?, ?, ?, ?)`,
      )
      .bind(...bind, i.sku, names.get(i.sku)!, i.unit_price, i.quantity),
  );
}

route('GET', '/quotes', async ({ env, url }) => {
  const q = parseQuery(url, quoteListQuery);
  const where = `WHERE (?1 IS NULL OR (${EFFECTIVE_STATUS}) = ?1) AND (?2 IS NULL OR q.customer_id = ?2)
      AND (?3 IS NULL OR q.code LIKE '%' || ?3 || '%' OR c.name LIKE '%' || ?3 || '%')`;
  const filters = [q.status ?? null, q.customer_id ?? null, q.q || null];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} ${FROM} ${where} ORDER BY q.id DESC LIMIT ?4 OFFSET ?5`).bind(
      ...filters,
      q.page_size,
      (q.page - 1) * q.page_size,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n ${FROM} ${where}`).bind(...filters),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('GET', '/quotes/:id', async (c) => ok(await quoteDetail(c.env.DB, parseId(c))));

route('POST', '/quotes', async ({ env, req, user }) => {
  const input = await parseBody(req, quoteInput);
  const names = await validateInput(env.DB, input);
  for (let attempt = 0; ; attempt++) {
    const code = docCode('BG');
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO quotes (code, customer_id, valid_until, note, discount_vnd, shipping_fee_vnd, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(code, input.customer_id, input.valid_until ?? null, input.note, input.discount_vnd, input.shipping_fee_vnd, user.id),
        ...insertItemStmts(env.DB, '(SELECT id FROM quotes WHERE code = ?)', [code], input, names),
        auditStmt(env.DB, user.id, 'quote.create', 'quote', code, { items: input.items.length }),
      ]);
      const row = await env.DB.prepare('SELECT id FROM quotes WHERE code = ?').bind(code).first<{ id: number }>();
      return ok(await quoteDetail(env.DB, row!.id), 201);
    } catch (e) {
      if (isUniqueError(e, 'quotes.code') && attempt < 4) continue;
      throw e;
    }
  }
});

const notEditable = (status: string) =>
  new ApiError(409, 'INVALID_STATE', 'Chỉ sửa được báo giá nháp hoặc đã gửi.', { status });

route('PUT', '/quotes/:id', async (c) => {
  const { env, req, user } = c;
  const id = parseId(c);
  const input = await parseBody(req, quoteInput);
  const before = await loadStored(env.DB, id);
  if (before.status !== 'DRAFT' && before.status !== 'SENT') throw notEditable(before.status);
  const names = await validateInput(env.DB, input);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE quotes SET status = CASE WHEN status IN ('DRAFT', 'SENT') THEN status ELSE 'INVALID' END,
           customer_id = ?2, valid_until = ?3, note = ?4, discount_vnd = ?5, shipping_fee_vnd = ?6
         WHERE id = ?1`,
      ).bind(id, input.customer_id, input.valid_until ?? null, input.note, input.discount_vnd, input.shipping_fee_vnd),
      env.DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id),
      ...insertItemStmts(env.DB, '?', [id], input, names),
      auditStmt(env.DB, user.id, 'quote.update', 'quote', before.code, { items: input.items.length }),
    ]);
  } catch (e) {
    if (!isCheckError(e)) throw e;
    throw notEditable((await loadStored(env.DB, id)).status);
  }
  return ok(await quoteDetail(env.DB, id));
});

const NEXT: Record<string, readonly string[]> = { DRAFT: ['SENT'], SENT: ['ACCEPTED', 'REJECTED'] };

const invalidTransition = (from: string, to: string) =>
  new ApiError(409, 'INVALID_TRANSITION', `Không thể chuyển báo giá từ ${from} sang ${to}.`, { from, to });

const quoteExpired = () => new ApiError(409, 'QUOTE_EXPIRED', 'Báo giá đã hết hạn, không thể chấp nhận.');

route('POST', '/quotes/:id/status', async (c) => {
  const { env, req, user } = c;
  const id = parseId(c);
  const { to } = await parseBody(req, quoteStatusInput);
  const before = await loadStored(env.DB, id);
  if (!NEXT[before.status]?.includes(to)) throw invalidTransition(before.status, to);
  if (to === 'ACCEPTED' && before.expired) throw quoteExpired();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE quotes SET status = CASE WHEN status = ?2 AND (?3 <> 'ACCEPTED' OR valid_until IS NULL
           OR valid_until >= ${TODAY}) THEN ?3 ELSE 'INVALID' END WHERE id = ?1`,
      ).bind(id, before.status, to),
      auditStmt(env.DB, user.id, 'quote.status', 'quote', before.code, { from: before.status, to }),
    ]);
  } catch (e) {
    if (!isCheckError(e)) throw e;
    const now = await loadStored(env.DB, id);
    if (now.status !== before.status) throw invalidTransition(now.status, to);
    throw quoteExpired();
  }
  return ok(await quoteDetail(env.DB, id));
});

route('POST', '/quotes/:id/convert', async (c) => {
  const { env, ctx, user } = c;
  const id = parseId(c);
  const stored = await loadStored(env.DB, id);
  if ((stored.status !== 'SENT' && stored.status !== 'ACCEPTED') || stored.expired) throw quoteNotConvertible();
  const customer = stored.customer_id
    ? await env.DB.prepare('SELECT phone, name, email, address FROM customers WHERE id = ?')
        .bind(stored.customer_id)
        .first<{ phone: string; name: string; email: string; address: string }>()
    : null;
  if (!customer) {
    throw new ApiError(422, 'QUOTE_NO_CUSTOMER', 'Báo giá chưa có khách hàng nên không thể chuyển thành đơn.');
  }
  const [quote, items] = await env.DB.batch([
    env.DB.prepare('SELECT discount_vnd, shipping_fee_vnd FROM quotes WHERE id = ?').bind(id),
    env.DB.prepare('SELECT sku, quantity, unit_price FROM quote_items WHERE quote_id = ? ORDER BY id').bind(id),
  ]);
  const q = quote.results[0] as { discount_vnd: number; shipping_fee_vnd: number };
  const order = await createOrder(
    env,
    {
      channel: 'B2B',
      customer: { phone: customer.phone, name: customer.name, email: customer.email, address: customer.address },
      shipping_address: customer.address,
      items: items.results as { sku: string; quantity: number; unit_price: number }[],
      shipping_fee_vnd: q.shipping_fee_vnd,
      discount_vnd: q.discount_vnd,
      payment_method: 'BANK_B2B',
    },
    { source: 'QUOTE', userId: user.id, quoteId: id, quoteCode: stored.code },
    ctx,
  );
  return ok({ quote: await quoteDetail(env.DB, id), order }, 201);
});
