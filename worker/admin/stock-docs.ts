import { stockDocInput, stockDocListQuery, idSchema, type StockDocInput } from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { docCode } from '../lib/codes';
import { mirrorEvent } from '../lib/notify';
import { auditStmt } from './audit';
import type { AdminCtx } from './auth';
import {
  adjustStmts,
  issueStmts,
  receiveStmts,
  stockConflictMessage,
  stocktakeStmts,
  type DocRef,
} from './inventory';
import { route } from './router';

type DocType = StockDocInput['type'];
type LineInput = StockDocInput['lines'][number];

interface DocRow {
  id: number;
  code: string;
  type: DocType;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  supplier_id: number | null;
  note: string;
}

const PREFIX = { RECEIPT: 'PN', ISSUE: 'PX', ADJUST: 'DC', STOCKTAKE: 'KK' } as const;

const isCheckError = (e: unknown): boolean => e instanceof Error && e.message.includes('CHECK constraint failed');

function invalidState(status: string): ApiError {
  const label = status === 'POSTED' ? 'đã ghi sổ' : status === 'CANCELLED' ? 'đã huỷ' : status;
  return new ApiError(409, 'INVALID_STATE', `Phiếu ${label}, không thể thao tác.`, { status });
}

function parseId(c: AdminCtx): number {
  const parsed = idSchema.safeParse(c.params.id);
  if (!parsed.success) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy phiếu.');
  return parsed.data;
}

async function loadDoc(db: D1Database, id: number): Promise<DocRow> {
  const doc = await db
    .prepare('SELECT id, code, type, status, supplier_id, note FROM stock_docs WHERE id = ?')
    .bind(id)
    .first<DocRow>();
  if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy phiếu.');
  return doc;
}

interface DocLine {
  sku: string;
  qty: number;
  unit_cost_vnd: number | null;
  batch_code: string;
  expiry_date: string;
  counted_qty: number | null;
}

async function loadLines(db: D1Database, id: number): Promise<DocLine[]> {
  const res = await db
    .prepare(
      `SELECT l.id, l.sku, p.name AS product_name, l.qty, l.unit_cost_vnd, l.batch_code, l.expiry_date,
              l.counted_qty, l.system_qty
       FROM stock_doc_lines l LEFT JOIN products p ON p.sku = l.sku
       WHERE l.doc_id = ? ORDER BY l.id`,
    )
    .bind(id)
    .all<DocLine>();
  return res.results;
}

async function docDetail(db: D1Database, id: number) {
  const [doc, lines] = await Promise.all([
    db
      .prepare(
        `SELECT id, code, type, status, supplier_id, note, created_by, posted_by, posted_at, created_at
         FROM stock_docs WHERE id = ?`,
      )
      .bind(id)
      .first(),
    loadLines(db, id),
  ]);
  if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy phiếu.');
  return { ...doc, lines };
}

/** SKU phải tồn tại, đang bán, không phải combo và không trùng trong phiếu; trước khi dựng batch nào. */
async function validateLines(db: D1Database, lines: { sku: string }[]): Promise<void> {
  const res = await db
    .prepare('SELECT sku, is_active, is_combo FROM products WHERE sku IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(lines.map((l) => l.sku)))
    .all<{ sku: string; is_active: number; is_combo: number }>();
  const found = new Map(res.results.map((p) => [p.sku, p]));
  const seen = new Set<string>();
  lines.forEach((l, index) => {
    const p = found.get(l.sku);
    let problem: string | null = null;
    if (seen.has(l.sku)) problem = `SKU ${l.sku} bị trùng trong phiếu`;
    else if (!p) problem = `Sản phẩm ${l.sku} không tồn tại`;
    else if (p.is_active !== 1) problem = `Sản phẩm ${l.sku} đã ngừng bán`;
    else if (p.is_combo === 1) problem = `${l.sku} là combo, không nhập/xuất/kiểm kê trực tiếp`;
    seen.add(l.sku);
    if (problem) throw new ApiError(422, 'INVALID_LINE', `Dòng ${index + 1}: ${problem}.`, { index, sku: l.sku });
  });
}

async function assertSupplier(db: D1Database, supplierId: number | null | undefined): Promise<void> {
  if (!supplierId) return;
  const row = await db.prepare('SELECT id FROM suppliers WHERE id = ?').bind(supplierId).first();
  if (!row) throw new ApiError(422, 'VALIDATION', 'Nhà cung cấp không tồn tại.', { supplier_id: ['Không tồn tại'] });
}

/** Dòng phiếu → INSERT; `docRef` là biểu thức SQL trả id phiếu (dùng được trong cùng batch tạo phiếu). */
function insertLineStmts(db: D1Database, docRef: string, bind: unknown[], type: DocType, lines: LineInput[]) {
  return lines.map((l) =>
    db
      .prepare(
        `INSERT INTO stock_doc_lines (doc_id, sku, qty, unit_cost_vnd, batch_code, expiry_date, counted_qty)
         VALUES (${docRef}, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ...bind,
        l.sku,
        type === 'STOCKTAKE' ? 0 : (l.qty ?? 0),
        type === 'RECEIPT' ? (l.unit_cost_vnd ?? 0) : null,
        l.batch_code,
        l.expiry_date,
        type === 'STOCKTAKE' ? (l.counted_qty ?? 0) : null,
      ),
  );
}

/**
 * Câu lệnh đầu của batch đổi trạng thái: chỉ DRAFT mới hợp lệ, trạng thái khác gán giá trị
 * ngoài CHECK nên cả batch rollback (chặn ghi sổ/huỷ/sửa đồng thời hai lần).
 */
function transitionStmt(db: D1Database, id: number, to: 'POSTED' | 'CANCELLED', userId: number) {
  return db
    .prepare(
      `UPDATE stock_docs SET
         status = CASE WHEN status = 'DRAFT' THEN ?2 ELSE 'INVALID' END,
         posted_by = CASE WHEN ?2 = 'POSTED' THEN ?3 ELSE posted_by END,
         posted_at = CASE WHEN ?2 = 'POSTED' THEN datetime('now') ELSE posted_at END
       WHERE id = ?1`,
    )
    .bind(id, to, userId);
}

route('GET', '/stock-docs', async ({ env, url }) => {
  const q = parseQuery(url, stockDocListQuery);
  const where = `WHERE (?1 IS NULL OR d.type = ?1) AND (?2 IS NULL OR d.status = ?2)
      AND (?3 IS NULL OR date(d.created_at, '+7 hours') >= ?3)
      AND (?4 IS NULL OR date(d.created_at, '+7 hours') <= ?4)
      AND (?5 IS NULL OR d.code LIKE '%' || ?5 || '%' OR d.note LIKE '%' || ?5 || '%')`;
  const filters = [q.type ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.q || null];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT d.id, d.code, d.type, d.status, d.supplier_id, d.note, d.created_by, d.posted_by, d.posted_at,
              d.created_at, (SELECT COUNT(*) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS line_count
       FROM stock_docs d ${where} ORDER BY d.id DESC LIMIT ?6 OFFSET ?7`,
    ).bind(...filters, q.page_size, (q.page - 1) * q.page_size),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM stock_docs d ${where}`).bind(...filters),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('GET', '/stock-docs/:id', async (c) => ok(await docDetail(c.env.DB, parseId(c))));

route('POST', '/stock-docs', async ({ env, req, user }) => {
  const input = await parseBody(req, stockDocInput);
  await validateLines(env.DB, input.lines);
  await assertSupplier(env.DB, input.supplier_id);
  const code = docCode(PREFIX[input.type]);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO stock_docs (code, type, supplier_id, note, created_by) VALUES (?, ?, ?, ?, ?)').bind(
      code,
      input.type,
      input.supplier_id ?? null,
      input.note,
      user.id,
    ),
    ...insertLineStmts(env.DB, '(SELECT id FROM stock_docs WHERE code = ?)', [code], input.type, input.lines),
    auditStmt(env.DB, user.id, 'stock_doc.create', 'stock_doc', code, { type: input.type, lines: input.lines.length }),
  ]);
  const row = await env.DB.prepare('SELECT id FROM stock_docs WHERE code = ?').bind(code).first<{ id: number }>();
  return ok(await docDetail(env.DB, row!.id), 201);
});

route('PUT', '/stock-docs/:id', async (c) => {
  const { env, req, user } = c;
  const id = parseId(c);
  const input = await parseBody(req, stockDocInput);
  const doc = await loadDoc(env.DB, id);
  if (doc.status !== 'DRAFT') throw invalidState(doc.status);
  if (input.type !== doc.type) {
    throw new ApiError(422, 'VALIDATION', 'Không đổi được loại phiếu.', { type: ['Không đổi được loại phiếu'] });
  }
  await validateLines(env.DB, input.lines);
  await assertSupplier(env.DB, input.supplier_id);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE stock_docs SET supplier_id = ?2, note = ?3,
           status = CASE WHEN status = 'DRAFT' THEN 'DRAFT' ELSE 'INVALID' END
         WHERE id = ?1`,
      ).bind(id, input.supplier_id ?? null, input.note),
      env.DB.prepare('DELETE FROM stock_doc_lines WHERE doc_id = ?').bind(id),
      ...insertLineStmts(env.DB, '?', [id], doc.type, input.lines),
      auditStmt(env.DB, user.id, 'stock_doc.update', 'stock_doc', id, { lines: input.lines.length }),
    ]);
  } catch (e) {
    if (isCheckError(e)) throw invalidState((await loadDoc(env.DB, id)).status);
    throw e;
  }
  return ok(await docDetail(env.DB, id));
});

/** Câu lệnh tồn kho của phiếu + dòng để dựng thông điệp xung đột nếu CHECK lỗi. */
function inventoryStmts(db: D1Database, doc: DocRow, lines: DocLine[], userId: number): D1PreparedStatement[] {
  const ref: DocRef = { docType: doc.type, docCode: doc.code, userId };
  switch (doc.type) {
    case 'RECEIPT':
      return receiveStmts(db, lines.map((l) => ({ sku: l.sku, qty: l.qty, unitCost: l.unit_cost_vnd ?? 0 })), ref);
    case 'ISSUE':
      return issueStmts(db, lines.map((l) => ({ sku: l.sku, qty: l.qty })), ref);
    case 'ADJUST':
      return adjustStmts(db, lines.map((l) => ({ sku: l.sku, delta: l.qty })), 'ADJUST', ref);
    case 'STOCKTAKE':
      return stocktakeStmts(db, lines.map((l) => ({ sku: l.sku, counted: l.counted_qty ?? 0 })), ref);
  }
}

async function conflictMessage(db: D1Database, doc: DocRow, lines: DocLine[]): Promise<string> {
  if (doc.type === 'ISSUE') return stockConflictMessage(db, lines.map((l) => ({ sku: l.sku, qty: l.qty })));
  if (doc.type === 'ADJUST') {
    const out = lines.filter((l) => l.qty < 0).map((l) => ({ sku: l.sku, qty: -l.qty }));
    return stockConflictMessage(db, out);
  }
  if (doc.type === 'STOCKTAKE') {
    const res = await db
      .prepare('SELECT sku, name, reserved_qty FROM products WHERE sku IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(lines.map((l) => l.sku)))
      .all<{ sku: string; name: string; reserved_qty: number }>();
    const reserved = new Map(res.results.map((p) => [p.sku, p]));
    for (const l of lines) {
      const p = reserved.get(l.sku);
      if (p && (l.counted_qty ?? 0) < p.reserved_qty) {
        return `Sản phẩm ${p.name} đang giữ cho đơn ${p.reserved_qty}, không thể kiểm kê thấp hơn số đó.`;
      }
    }
  }
  return stockConflictMessage(db, []);
}

route('POST', '/stock-docs/:id/post', async (c) => {
  const { env, ctx, user } = c;
  const id = parseId(c);
  const doc = await loadDoc(env.DB, id);
  if (doc.status !== 'DRAFT') throw invalidState(doc.status);
  const lines = await loadLines(env.DB, id);
  if (lines.length === 0) throw new ApiError(422, 'VALIDATION', 'Phiếu chưa có dòng nào.');
  await validateLines(env.DB, lines);

  try {
    await env.DB.batch([
      transitionStmt(env.DB, id, 'POSTED', user.id),
      ...inventoryStmts(env.DB, doc, lines, user.id),
      auditStmt(env.DB, user.id, 'stock_doc.post', 'stock_doc', id, { code: doc.code, type: doc.type }),
    ]);
  } catch (e) {
    if (!isCheckError(e)) throw e;
    const now = await loadDoc(env.DB, id);
    if (now.status !== 'DRAFT') throw invalidState(now.status);
    throw new ApiError(409, 'STOCK_CONFLICT', await conflictMessage(env.DB, doc, lines));
  }
  mirrorEvent(env, ctx, 'stock_doc.posted', { doc_code: doc.code, doc_type: doc.type, posted_by: user.id });
  return ok(await docDetail(env.DB, id));
});

route('POST', '/stock-docs/:id/cancel', async (c) => {
  const { env, user } = c;
  const id = parseId(c);
  const doc = await loadDoc(env.DB, id);
  if (doc.status !== 'DRAFT') throw invalidState(doc.status);
  try {
    await env.DB.batch([
      transitionStmt(env.DB, id, 'CANCELLED', user.id),
      auditStmt(env.DB, user.id, 'stock_doc.cancel', 'stock_doc', id, { code: doc.code }),
    ]);
  } catch (e) {
    if (isCheckError(e)) throw invalidState((await loadDoc(env.DB, id)).status);
    throw e;
  }
  return ok(await docDetail(env.DB, id));
});
