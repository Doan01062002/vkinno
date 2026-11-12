import { idSchema, pageQuerySchema, supplierInput } from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { auditStmt } from './audit';
import type { AdminCtx } from './auth';
import { route } from './router';

const COLS = 'id, name, phone, email, address, tax_code, note, is_active, created_at';

function parseId(c: AdminCtx): number {
  const parsed = idSchema.safeParse(c.params.id);
  if (!parsed.success) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp.');
  return parsed.data;
}

async function loadSupplier(db: D1Database, id: number) {
  const row = await db.prepare(`SELECT ${COLS} FROM suppliers WHERE id = ?`).bind(id).first();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp.');
  return row;
}

route('GET', '/suppliers', async ({ env, url }) => {
  const q = parseQuery(url, pageQuerySchema);
  const where = `WHERE (?1 IS NULL OR name LIKE '%' || ?1 || '%' OR phone LIKE '%' || ?1 || '%'
      OR email LIKE '%' || ?1 || '%' OR tax_code LIKE '%' || ?1 || '%')`;
  const [items, total] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} FROM suppliers ${where} ORDER BY id DESC LIMIT ?2 OFFSET ?3`).bind(
      q.q || null,
      q.page_size,
      (q.page - 1) * q.page_size,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM suppliers ${where}`).bind(q.q || null),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('POST', '/suppliers', async ({ env, req, user }) => {
  const input = await parseBody(req, supplierInput);
  const [res] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO suppliers (name, phone, email, address, tax_code, note, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(input.name, input.phone, input.email, input.address, input.tax_code, input.note, input.is_active),
    // Cùng batch/kết nối nên last_insert_rowid() là id của câu INSERT ngay trên.
    env.DB.prepare(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, detail_json)
       VALUES (?, 'supplier.create', 'supplier', CAST(last_insert_rowid() AS TEXT), ?)`,
    ).bind(user.id, JSON.stringify({ name: input.name })),
  ]);
  return ok(await loadSupplier(env.DB, Number(res.meta.last_row_id)), 201);
});

route('GET', '/suppliers/:id', async (c) => ok(await loadSupplier(c.env.DB, parseId(c))));

route('PUT', '/suppliers/:id', async (c) => {
  const { env, req, user } = c;
  const id = parseId(c);
  const input = await parseBody(req, supplierInput);
  await loadSupplier(env.DB, id);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, tax_code = ?, note = ?, is_active = ?
       WHERE id = ?`,
    ).bind(input.name, input.phone, input.email, input.address, input.tax_code, input.note, input.is_active, id),
    auditStmt(env.DB, user.id, 'supplier.update', 'supplier', id, { name: input.name }),
  ]);
  return ok(await loadSupplier(env.DB, id));
});

route('GET', '/suppliers/:id/stock-docs', async (c) => {
  const { env, url } = c;
  const id = parseId(c);
  await loadSupplier(env.DB, id);
  const q = parseQuery(url, pageQuerySchema.pick({ page: true, page_size: true }));
  const [items, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT d.id, d.code, d.type, d.status, d.supplier_id, d.note, d.created_by, d.posted_by, d.posted_at,
              d.created_at, (SELECT COUNT(*) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS line_count
       FROM stock_docs d WHERE d.supplier_id = ?1 ORDER BY d.id DESC LIMIT ?2 OFFSET ?3`,
    ).bind(id, q.page_size, (q.page - 1) * q.page_size),
    env.DB.prepare('SELECT COUNT(*) AS n FROM stock_docs WHERE supplier_id = ?').bind(id),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});
