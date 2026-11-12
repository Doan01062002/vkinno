import {
  bomInput,
  inventoryListQuery,
  ledgerQuery,
  productInput,
  productListQuery,
  productUpdateInput,
} from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { auditStmt } from './audit';
import { availability } from './inventory';
import { route } from './router';

const EXPIRY_WINDOW_DAYS = 60;
const SKU_RE = /^[A-Z0-9-]{3,60}$/;

interface ProductRow {
  sku: string;
  name: string;
  unit: string;
  category: string;
  min_stock: number;
  is_combo: number;
  is_active: number;
  stock_qty: number;
  cost_avg_vnd: number;
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');
const isUnique = (e: unknown) => e instanceof Error && e.message.includes('UNIQUE constraint failed');

async function loadProduct(db: D1Database, sku: string) {
  const p = await db.prepare('SELECT * FROM products WHERE sku = ?').bind(sku).first<ProductRow>();
  if (!p) throw notFound();
  return p;
}

async function productDetail(db: D1Database, sku: string) {
  const p = await loadProduct(db, sku);
  const stock = (await availability(db, [sku])).get(sku);
  const bom = p.is_combo
    ? (
        await db
          .prepare(
            `SELECT b.component_sku, c.name AS component_name, b.qty_per_combo
             FROM bom_items b LEFT JOIN products c ON c.sku = b.component_sku
             WHERE b.combo_sku = ? ORDER BY b.component_sku`,
          )
          .bind(sku)
          .all()
      ).results
    : [];
  return { ...p, available: stock?.available ?? 0, bom };
}

route('GET', '/products', async ({ env, url }) => {
  const q = parseQuery(url, productListQuery);
  const where = `WHERE (?1 IS NULL OR sku LIKE '%' || ?1 || '%' OR name LIKE '%' || ?1 || '%')
      AND (?2 IS NULL OR category = ?2) AND (?3 IS NULL OR is_active = ?3)`;
  const filters = [q.q || null, q.category || null, q.is_active === undefined ? null : Number(q.is_active)];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM products ${where} ORDER BY product_id LIMIT ?4 OFFSET ?5`).bind(
      ...filters,
      q.page_size,
      (q.page - 1) * q.page_size,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM products ${where}`).bind(...filters),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('POST', '/products', async ({ env, req, user }) => {
  const p = await parseBody(req, productInput);
  const dup = await env.DB.prepare('SELECT 1 FROM products WHERE sku = ?').bind(p.sku).first();
  if (dup) throw new ApiError(409, 'SKU_EXISTS', 'SKU đã tồn tại.');
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO products (sku, product_id, name, slug, price_vnd, listed_price_vnd, wholesale_price_vnd, unit,
           category, min_stock, shelf_label, is_active, is_combo, image_url, gallery_json, description, batch_code,
           expiry_date)
         VALUES (?, (SELECT COALESCE(MAX(product_id), 0) + 1 FROM products), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?)`,
      ).bind(
        p.sku,
        p.name,
        p.slug,
        p.price_vnd,
        p.listed_price_vnd,
        p.wholesale_price_vnd ?? null,
        p.unit,
        p.category,
        p.min_stock,
        p.shelf_label,
        p.is_active,
        p.is_combo,
        p.image_url,
        p.gallery_json,
        p.description,
        p.batch_code,
        p.expiry_date,
      ),
      auditStmt(env.DB, user.id, 'product.create', 'product', p.sku, { name: p.name, is_combo: p.is_combo }),
    ]);
  } catch (e) {
    if (isUnique(e)) throw new ApiError(409, 'CONFLICT', 'Slug hoặc SKU đã được dùng cho sản phẩm khác.');
    throw e;
  }
  return ok(await productDetail(env.DB, p.sku), 201);
});

route('GET', '/products/:sku', async ({ env, params }) => ok(await productDetail(env.DB, params.sku)));

route('PUT', '/products/:sku', async ({ env, req, user, params }) => {
  const body = await parseBody(req, productUpdateInput);
  const current = await loadProduct(env.DB, params.sku);
  if (body.sku !== undefined && body.sku !== current.sku) {
    throw new ApiError(422, 'VALIDATION', 'Không được đổi SKU sau khi tạo.', { sku: ['Không được đổi SKU'] });
  }
  const { sku: _sku, ...changes } = body;
  if (changes.is_combo !== undefined && changes.is_combo !== current.is_combo) {
    const links = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM bom_items WHERE combo_sku = ?1 OR component_sku = ?1',
    )
      .bind(current.sku)
      .first<{ n: number }>();
    if ((links?.n ?? 0) > 0 || (changes.is_combo === 1 && current.stock_qty > 0)) {
      throw new ApiError(422, 'VALIDATION', 'Không đổi loại combo khi sản phẩm còn tồn kho hoặc còn liên kết BOM.', {
        is_combo: ['Không đổi được'],
      });
    }
  }
  const entries = Object.entries(changes).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new ApiError(422, 'VALIDATION', 'Không có trường nào để cập nhật.');
  // Tên cột lấy từ khoá của schema (zod đã loại mọi khoá lạ, gồm stock_qty/reserved_qty/cost_avg_vnd).
  const sets = entries.map(([k], i) => `${k} = ?${i + 2}`).join(', ');
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE sku = ?1`).bind(
        current.sku,
        ...entries.map(([, v]) => v ?? null),
      ),
      auditStmt(env.DB, user.id, 'product.update', 'product', current.sku, { fields: entries.map(([k]) => k) }),
    ]);
  } catch (e) {
    if (isUnique(e)) throw new ApiError(409, 'CONFLICT', 'Slug đã được dùng cho sản phẩm khác.');
    throw e;
  }
  return ok(await productDetail(env.DB, current.sku));
});

route('PUT', '/products/:sku/bom', async ({ env, req, user, params }) => {
  const { items } = await parseBody(req, bomInput);
  const combo = await loadProduct(env.DB, params.sku);
  const invalid = (message: string, details?: unknown) => new ApiError(422, 'INVALID_BOM', message, details);
  if (combo.is_combo !== 1) throw invalid('Chỉ sản phẩm combo mới có BOM.');
  const seen = new Set<string>();
  for (const it of items) {
    if (it.component_sku === combo.sku) throw invalid('Combo không thể chứa chính nó.', { sku: it.component_sku });
    if (seen.has(it.component_sku)) throw invalid(`Thành phần ${it.component_sku} bị trùng.`, { sku: it.component_sku });
    seen.add(it.component_sku);
  }
  const comps = await env.DB.prepare('SELECT sku, is_combo FROM products WHERE sku IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...seen]))
    .all<{ sku: string; is_combo: number }>();
  const found = new Map(comps.results.map((c) => [c.sku, c]));
  for (const sku of seen) {
    const c = found.get(sku);
    if (!c) throw invalid(`Thành phần ${sku} không tồn tại.`, { sku });
    if (c.is_combo === 1) throw invalid(`${sku} là combo, không được lồng combo trong combo.`, { sku });
  }
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders o JOIN order_items i ON i.order_id = o.id
     WHERE i.sku = ? AND o.order_status IN ('PENDING', 'PACKED', 'SHIPPING')`,
  )
    .bind(combo.sku)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) {
    throw new ApiError(409, 'BOM_IN_USE', 'Combo đang có đơn chưa hoàn tất (đã giữ hàng hoặc đang giao), chưa thể đổi thành phần.', {
      pending_orders: pending?.n,
    });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bom_items WHERE combo_sku = ?').bind(combo.sku),
    ...items.map((it) =>
      env.DB.prepare('INSERT INTO bom_items (combo_sku, component_sku, qty_per_combo) VALUES (?, ?, ?)').bind(
        combo.sku,
        it.component_sku,
        it.qty_per_combo,
      ),
    ),
    env.DB.prepare("UPDATE products SET updated_at = datetime('now') WHERE sku = ?").bind(combo.sku),
    auditStmt(env.DB, user.id, 'product.bom_update', 'product', combo.sku, { items }),
  ]);
  return ok(await productDetail(env.DB, combo.sku));
});

// --- Tồn kho (chỉ đọc) ---------------------------------------------------------------------

route('GET', '/inventory', async ({ env, url }) => {
  const q = parseQuery(url, inventoryListQuery);
  const rows = await env.DB.prepare(
    `SELECT sku, name, unit, category, min_stock, is_combo, is_active, cost_avg_vnd FROM products
     WHERE (?1 IS NULL OR sku LIKE '%' || ?1 || '%' OR name LIKE '%' || ?1 || '%') AND (?2 IS NULL OR category = ?2)
     ORDER BY product_id`,
  )
    .bind(q.q || null, q.category || null)
    .all<ProductRow>();
  const avail = await availability(
    env.DB,
    rows.results.map((r) => r.sku),
  );
  let items = rows.results.map((r) => {
    const a = avail.get(r.sku);
    return { ...r, stock: a?.stock ?? 0, reserved: a?.reserved ?? 0, available: a?.available ?? 0 };
  });
  if (q.low === '1') items = items.filter((i) => i.available < i.min_stock);
  const start = (q.page - 1) * q.page_size;
  return ok({ items: items.slice(start, start + q.page_size), total: items.length, page: q.page, page_size: q.page_size });
});

/** Cảnh báo tồn thấp và lô sắp hết hạn (dùng cho trang tồn kho và dashboard). */
export async function inventoryAlerts(db: D1Database) {
  const rows = await db.prepare(
    'SELECT sku, name, unit, min_stock, is_combo FROM products WHERE is_active = 1 ORDER BY product_id',
  ).all<ProductRow>();
  const avail = await availability(
    db,
    rows.results.map((r) => r.sku),
  );
  const low_stock = rows.results
    .map((r) => ({ ...r, available: avail.get(r.sku)?.available ?? 0, stock: avail.get(r.sku)?.stock ?? 0 }))
    .filter((r) => r.available < r.min_stock);

  const win = await db.prepare(
    `SELECT date('now', '+7 hours') AS today, date('now', '+7 hours', '+${EXPIRY_WINDOW_DAYS} days') AS limit_day`,
  ).first<{ today: string; limit_day: string }>();
  // Lô nhập mới nhất trước; cộng dồn đến khi đủ tồn hiện tại (phần còn lại theo FIFO).
  const lots = await db.prepare(
    `SELECT p.sku, p.name, p.stock_qty, l.batch_code, l.expiry_date, l.qty, d.code AS doc_code
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id AND d.type = 'RECEIPT' AND d.status = 'POSTED'
     JOIN products p ON p.sku = l.sku AND p.is_combo = 0 AND p.stock_qty > 0
     WHERE l.qty > 0
     ORDER BY p.sku, d.posted_at DESC, d.id DESC, l.id DESC`,
  ).all<{
    sku: string;
    name: string;
    stock_qty: number;
    batch_code: string;
    expiry_date: string;
    qty: number;
    doc_code: string;
  }>();
  const today = Date.parse(`${win?.today}T00:00:00Z`);
  const expiring: { expiry_date: string; sku: string }[] = [];
  let currentSku = '';
  let remaining = 0;
  for (const lot of lots.results) {
    if (lot.sku !== currentSku) {
      currentSku = lot.sku;
      remaining = lot.stock_qty;
    }
    if (remaining <= 0) continue;
    const take = Math.min(lot.qty, remaining);
    remaining -= take;
    if (lot.expiry_date && lot.expiry_date <= (win?.limit_day ?? '')) {
      expiring.push({
        sku: lot.sku,
        name: lot.name,
        batch_code: lot.batch_code,
        expiry_date: lot.expiry_date,
        qty: take,
        doc_code: lot.doc_code,
        days_left: Math.round((Date.parse(`${lot.expiry_date}T00:00:00Z`) - today) / 86400000),
      } as { expiry_date: string; sku: string });
    }
  }
  expiring.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.sku.localeCompare(b.sku));
  return { low_stock, expiring };
}

route('GET', '/inventory/alerts', async ({ env }) => ok(await inventoryAlerts(env.DB)));

route('GET', '/inventory/:sku/ledger', async ({ env, url, params }) => {
  if (!SKU_RE.test(params.sku)) throw notFound();
  await loadProduct(env.DB, params.sku);
  const q = parseQuery(url, ledgerQuery);
  const where = `WHERE sku = ?1 AND (?2 IS NULL OR date(created_at, '+7 hours') >= ?2)
      AND (?3 IS NULL OR date(created_at, '+7 hours') <= ?3)`;
  const filters = [params.sku, q.from ?? null, q.to ?? null];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, sku, delta, stock_after, reason, ref_order_code, doc_type, doc_code, unit_cost_vnd, created_by, created_at
       FROM inventory_logs ${where} ORDER BY id DESC LIMIT ?4 OFFSET ?5`,
    ).bind(...filters, q.page_size, (q.page - 1) * q.page_size),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM inventory_logs ${where}`).bind(...filters),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});
