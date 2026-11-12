// Module kho: nơi DUY NHẤT ghi stock_qty, reserved_qty, cost_avg_vnd và inventory_logs.
// Hàm `*Stmts` chỉ dựng câu lệnh để người gọi gộp vào một `DB.batch()`; bất biến tồn
// (CHECK stock_qty >= 0, reserved_qty >= 0, reserved_qty <= stock_qty) làm cả batch
// rollback khi thiếu hàng. Giá trị phụ thuộc trạng thái lúc chạy (giá vốn, stock_after,
// thành phần combo) đều tính bằng subquery trong câu lệnh, không đọc trước bằng JS.
import { ApiError } from '../lib/http';

export type Line = { sku: string; qty: number };

export interface DocRef {
  docType: 'ORDER' | 'RECEIPT' | 'ISSUE' | 'ADJUST' | 'STOCKTAKE' | 'RETURN';
  docCode: string;
  userId: number | null;
}

export interface Availability {
  stock: number;
  reserved: number;
  available: number;
  isCombo: boolean;
}

type LineReason = 'CANCEL_RESTOCK' | 'RETURN_RESTOCK' | 'RETURN_DAMAGED';

const LOG_COLUMNS =
  'INSERT INTO inventory_logs (sku, delta, stock_after, reason, ref_order_code, doc_type, doc_code, unit_cost_vnd, created_by)';

const STOCK_CONFLICT_FALLBACK = 'Tồn kho không đủ hoặc đã thay đổi, vui lòng tải lại.';

/** Đơn và trả hàng ghi mã đơn vào `ref_order_code` (giữ nghĩa cũ của cột); phiếu kho để trống. */
function refOrderCode(ref: DocRef): string {
  return ref.docType === 'ORDER' || ref.docType === 'RETURN' ? ref.docCode : '';
}

function invalidQty(sku: string): ApiError {
  return new ApiError(422, 'VALIDATION', 'Số lượng không hợp lệ.', { sku });
}

function assertPositiveQty(lines: Line[]): void {
  for (const l of lines) if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw invalidQty(l.sku);
}

/**
 * Bảng (sku, k) các SKU vật lý mà một dòng `p` tác động: combo → thành phần theo
 * bom_items (k = qty_per_combo), sản phẩm lẻ → chính nó (k = 1). Đọc lúc batch chạy.
 */
function expandSql(p: string): string {
  return `(SELECT b.component_sku AS sku, b.qty_per_combo AS k
     FROM bom_items b JOIN products c ON c.sku = b.combo_sku
     WHERE b.combo_sku = ${p} AND c.is_combo = 1
   UNION ALL
   SELECT sku, 1 AS k FROM products WHERE sku = ${p} AND is_combo = 0)`;
}

/**
 * Câu lệnh theo dòng (combo được tách trong SQL): cộng `stockSign·qty·k` vào tồn,
 * `reservedSign·qty·k` vào đang giữ, rồi (nếu có `log`) ghi sổ từng SKU vật lý với
 * delta = `logSign·qty·k` và stock_after đọc sau UPDATE.
 */
function lineStmts(
  db: D1Database,
  lines: Line[],
  move: { stockSign: number; reservedSign: number },
  log?: { reason: LineReason; ref: DocRef; logSign: number },
): D1PreparedStatement[] {
  assertPositiveQty(lines);
  const x = expandSql('?1');
  const stmts: D1PreparedStatement[] = [];
  for (const l of lines) {
    if (move.stockSign !== 0 || move.reservedSign !== 0) {
      stmts.push(
        db
          .prepare(
            `UPDATE products SET
               stock_qty = stock_qty + ?2 * (SELECT x.k FROM ${x} x WHERE x.sku = products.sku),
               reserved_qty = reserved_qty + ?3 * (SELECT x.k FROM ${x} x WHERE x.sku = products.sku)
             WHERE sku IN (SELECT sku FROM ${x})`,
          )
          .bind(l.sku, move.stockSign * l.qty, move.reservedSign * l.qty),
      );
    }
    if (log) {
      stmts.push(
        db
          .prepare(
            `${LOG_COLUMNS}
             SELECT p.sku, ?2 * x.k, p.stock_qty, ?3, ?4, ?5, ?6, p.cost_avg_vnd, ?7
             FROM ${x} x JOIN products p ON p.sku = x.sku`,
          )
          .bind(l.sku, log.logSign * l.qty, log.reason, refOrderCode(log.ref), log.ref.docType, log.ref.docCode, log.ref.userId),
      );
    }
  }
  return stmts;
}

/**
 * Ghi sổ một SKU lẻ (phiếu kho). stock_after đọc sau UPDATE; SKU không tồn tại hoặc
 * là combo cho stock_after NULL → lỗi NOT NULL làm cả batch huỷ thay vì lặng lẽ bỏ qua.
 * `unitCost` null → giá vốn bình quân lúc chạy.
 */
function physicalLogStmt(
  db: D1Database,
  sku: string,
  delta: number,
  reason: 'RECEIPT' | 'ISSUE' | 'ADJUST' | 'STOCKTAKE',
  unitCost: number | null,
  ref: DocRef,
): D1PreparedStatement {
  return db
    .prepare(
      `${LOG_COLUMNS} VALUES (
         ?1, ?2, (SELECT stock_qty FROM products WHERE sku = ?1 AND is_combo = 0), ?3, ?4, ?5, ?6,
         COALESCE(?7, (SELECT cost_avg_vnd FROM products WHERE sku = ?1)), ?8)`,
    )
    .bind(sku, delta, reason, refOrderCode(ref), ref.docType, ref.docCode, unitCost, ref.userId);
}

function physicalDeltaStmts(
  db: D1Database,
  sku: string,
  delta: number,
  reason: 'ISSUE' | 'ADJUST' | 'STOCKTAKE',
  ref: DocRef,
): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE products SET stock_qty = stock_qty + ?2 WHERE sku = ?1 AND is_combo = 0').bind(sku, delta),
    physicalLogStmt(db, sku, delta, reason, null, ref),
  ];
}

// ---------------------------------------------------------------------------
// Đọc danh mục
// ---------------------------------------------------------------------------

interface CatalogRow {
  sku: string;
  name: string;
  stock_qty: number;
  reserved_qty: number;
  is_combo: number;
  is_active: number;
}

interface Catalog {
  products: Map<string, CatalogRow>;
  bom: Map<string, { sku: string; k: number }[]>;
}

/** Sản phẩm được hỏi (null = tất cả) kèm thành phần của các combo trong đó; một snapshot. */
async function loadCatalog(db: D1Database, skus: string[] | null): Promise<Catalog> {
  const filter = skus === null ? null : JSON.stringify(skus);
  const [prodRes, bomRes] = await db.batch([
    db
      .prepare(
        `SELECT sku, name, stock_qty, reserved_qty, is_combo, is_active FROM products
         WHERE ?1 IS NULL
            OR sku IN (SELECT value FROM json_each(?1))
            OR sku IN (SELECT component_sku FROM bom_items WHERE combo_sku IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(filter),
    db
      .prepare(
        `SELECT combo_sku, component_sku, qty_per_combo FROM bom_items
         WHERE ?1 IS NULL OR combo_sku IN (SELECT value FROM json_each(?1))
         ORDER BY rowid`,
      )
      .bind(filter),
  ]);
  const products = new Map<string, CatalogRow>();
  for (const r of prodRes.results as CatalogRow[]) products.set(r.sku, r);
  const bom = new Map<string, { sku: string; k: number }[]>();
  for (const r of bomRes.results as { combo_sku: string; component_sku: string; qty_per_combo: number }[]) {
    const list = bom.get(r.combo_sku) ?? [];
    list.push({ sku: r.component_sku, k: r.qty_per_combo });
    bom.set(r.combo_sku, list);
  }
  return { products, bom };
}

function availabilityOf(cat: Catalog, sku: string): Availability | undefined {
  const p = cat.products.get(sku);
  if (!p) return undefined;
  if (p.is_combo !== 1) {
    return { stock: p.stock_qty, reserved: p.reserved_qty, available: p.stock_qty - p.reserved_qty, isCombo: false };
  }
  const comps = cat.bom.get(sku) ?? [];
  if (comps.length === 0) return { stock: 0, reserved: 0, available: 0, isCombo: true };
  let stock = Infinity;
  let available = Infinity;
  for (const c of comps) {
    const cp = cat.products.get(c.sku);
    const s = cp?.stock_qty ?? 0;
    const a = s - (cp?.reserved_qty ?? 0);
    stock = Math.min(stock, Math.floor(s / c.k));
    available = Math.min(available, Math.floor(a / c.k));
  }
  return { stock, reserved: stock - available, available, isCombo: true };
}

// ---------------------------------------------------------------------------
// API công khai của module
// ---------------------------------------------------------------------------

/**
 * Tách combo theo bom_items và gộp SKU trùng (giữ thứ tự xuất hiện đầu tiên).
 * SKU không tồn tại, ngừng bán, hoặc combo chưa có thành phần → 422 UNKNOWN_SKU.
 */
export async function expandToPhysical(db: D1Database, lines: Line[]): Promise<Line[]> {
  assertPositiveQty(lines);
  const cat = await loadCatalog(db, [...new Set(lines.map((l) => l.sku))]);
  const out = new Map<string, number>();
  const add = (sku: string, qty: number) => out.set(sku, (out.get(sku) ?? 0) + qty);
  for (const l of lines) {
    const p = cat.products.get(l.sku);
    if (!p || p.is_active !== 1) {
      throw new ApiError(422, 'UNKNOWN_SKU', `Sản phẩm ${l.sku} không tồn tại hoặc đã ngừng bán.`, { sku: l.sku });
    }
    if (p.is_combo !== 1) {
      add(l.sku, l.qty);
      continue;
    }
    const comps = cat.bom.get(l.sku) ?? [];
    if (comps.length === 0) {
      throw new ApiError(422, 'UNKNOWN_SKU', `Combo ${l.sku} chưa có thành phần.`, { sku: l.sku });
    }
    for (const c of comps) add(c.sku, l.qty * c.k);
  }
  return [...out].map(([sku, qty]) => ({ sku, qty }));
}

/** Giữ hàng: reserved += qty (combo tách ra thành phần). Không ghi sổ. */
export function reserveStmts(db: D1Database, lines: Line[]): D1PreparedStatement[] {
  return lineStmts(db, lines, { stockSign: 0, reservedSign: 1 });
}

/** Bỏ giữ: reserved −= qty (combo tách ra thành phần). Không ghi sổ. */
export function releaseStmts(db: D1Database, lines: Line[]): D1PreparedStatement[] {
  return lineStmts(db, lines, { stockSign: 0, reservedSign: -1 });
}

/**
 * Xuất bán theo `order_items` của đơn (đọc lúc batch chạy): mỗi SKU vật lý stock −= q
 * (và reserved −= q nếu `releaseReserved`), sổ SALE_OUT với giá vốn bình quân lúc chạy,
 * đặt `order_items.unit_cost_vnd`, `orders.stock_deducted = 1`. Mọi câu lệnh chỉ có
 * tác dụng khi `stock_deducted = 0`, nên chạy lại cho cùng đơn là vô hại.
 */
function orderSaleOutStmts(
  db: D1Database,
  orderId: number | null,
  ref: DocRef,
  releaseReserved: boolean,
): D1PreparedStatement[] {
  const order = orderId === null ? '(SELECT id FROM orders WHERE order_code = ?1)' : '?1';
  const orderKey = orderId ?? ref.docCode;
  const notDeducted = `(SELECT stock_deducted FROM orders WHERE id = ${order}) = 0`;
  const demand = `(SELECT d.sku AS sku, SUM(d.q) AS q FROM (
       SELECT b.component_sku AS sku, oi.quantity * b.qty_per_combo AS q
       FROM order_items oi
       JOIN products c ON c.sku = oi.sku AND c.is_combo = 1
       JOIN bom_items b ON b.combo_sku = oi.sku
       WHERE oi.order_id = ${order}
       UNION ALL
       SELECT oi.sku, oi.quantity
       FROM order_items oi JOIN products s ON s.sku = oi.sku AND s.is_combo = 0
       WHERE oi.order_id = ${order}
     ) d GROUP BY d.sku)`;
  const qtyOf = `(SELECT m.q FROM ${demand} m WHERE m.sku = products.sku)`;
  const reservedSet = releaseReserved ? `, reserved_qty = reserved_qty - ${qtyOf}` : '';
  return [
    db
      .prepare(
        `UPDATE products SET stock_qty = stock_qty - ${qtyOf}${reservedSet}
         WHERE sku IN (SELECT sku FROM ${demand}) AND ${notDeducted}`,
      )
      .bind(orderKey),
    db
      .prepare(
        `${LOG_COLUMNS}
         SELECT p.sku, -m.q, p.stock_qty, 'SALE_OUT', o.order_code, ?2, ?3, p.cost_avg_vnd, ?4
         FROM ${demand} m JOIN products p ON p.sku = m.sku JOIN orders o ON o.id = ${order}
         WHERE o.stock_deducted = 0`,
      )
      .bind(orderKey, ref.docType, ref.docCode, ref.userId),
    db
      .prepare(
        `UPDATE order_items SET unit_cost_vnd = CASE
           WHEN (SELECT is_combo FROM products WHERE sku = order_items.sku) = 1 THEN
             (SELECT COALESCE(SUM(p.cost_avg_vnd * b.qty_per_combo), 0)
              FROM bom_items b JOIN products p ON p.sku = b.component_sku
              WHERE b.combo_sku = order_items.sku)
           ELSE (SELECT cost_avg_vnd FROM products WHERE sku = order_items.sku)
         END
         WHERE order_id = ${order} AND ${notDeducted}`,
      )
      .bind(orderKey),
    db.prepare(`UPDATE orders SET stock_deducted = 1 WHERE id = ${order} AND stock_deducted = 0`).bind(orderKey),
  ];
}

/**
 * Đóng gói đơn đang giữ hàng (PENDING → PACKED): stock −= q, reserved −= q, sổ SALE_OUT.
 * `orderId` null → tìm đơn theo `order_code = ref.docCode` lúc chạy (dùng trong cùng batch tạo đơn).
 */
export async function saleOutStmts(db: D1Database, orderId: number | null, ref: DocRef): Promise<D1PreparedStatement[]> {
  return orderSaleOutStmts(db, orderId, ref, true);
}

/** Như `saleOutStmts` nhưng không trừ reserved (đơn sàn nhập ở trạng thái đã giao). */
export async function directSaleOutStmts(
  db: D1Database,
  orderId: number | null,
  ref: DocRef,
): Promise<D1PreparedStatement[]> {
  return orderSaleOutStmts(db, orderId, ref, false);
}

/** Nhập lại kho (huỷ sau đóng gói / trả hàng): stock += qty, sổ theo `reason`. */
export function restockStmts(
  db: D1Database,
  lines: Line[],
  reason: 'CANCEL_RESTOCK' | 'RETURN_RESTOCK',
  ref: DocRef,
): D1PreparedStatement[] {
  return lineStmts(db, lines, { stockSign: 1, reservedSign: 0 }, { reason, ref, logSign: 1 });
}

/** Hàng trả về bị hỏng: chỉ ghi sổ RETURN_DAMAGED delta 0, tồn không đổi. */
export function damagedLogStmts(db: D1Database, lines: Line[], ref: DocRef): D1PreparedStatement[] {
  return lineStmts(db, lines, { stockSign: 0, reservedSign: 0 }, { reason: 'RETURN_DAMAGED', ref, logSign: 0 });
}

/** Nhập kho SKU lẻ: cập nhật giá vốn bình quân rồi stock += qty, sổ RECEIPT với đơn giá nhập. */
export function receiveStmts(
  db: D1Database,
  lines: { sku: string; qty: number; unitCost: number }[],
  ref: DocRef,
): D1PreparedStatement[] {
  assertPositiveQty(lines);
  return lines.flatMap((l) => {
    if (!Number.isSafeInteger(l.unitCost) || l.unitCost < 0) throw invalidQty(l.sku);
    return [
      db
        .prepare(
          `UPDATE products SET
             cost_avg_vnd = CAST(ROUND((stock_qty * cost_avg_vnd + ?2 * ?3) * 1.0 / (stock_qty + ?2)) AS INTEGER),
             stock_qty = stock_qty + ?2
           WHERE sku = ?1 AND is_combo = 0`,
        )
        .bind(l.sku, l.qty, l.unitCost),
      physicalLogStmt(db, l.sku, l.qty, 'RECEIPT', l.unitCost, ref),
    ];
  });
}

/** Xuất khác / huỷ hàng SKU lẻ: stock −= qty, sổ ISSUE. Không được làm stock < reserved (CHECK). */
export function issueStmts(db: D1Database, lines: Line[], ref: DocRef): D1PreparedStatement[] {
  assertPositiveQty(lines);
  return lines.flatMap((l) => physicalDeltaStmts(db, l.sku, -l.qty, 'ISSUE', ref));
}

/** Điều chỉnh / kiểm kê SKU lẻ: stock += delta (âm hoặc dương), sổ theo `reason`. */
export function adjustStmts(
  db: D1Database,
  lines: { sku: string; delta: number }[],
  reason: 'ADJUST' | 'STOCKTAKE',
  ref: DocRef,
): D1PreparedStatement[] {
  return lines.flatMap((l) => {
    if (!Number.isSafeInteger(l.delta)) throw invalidQty(l.sku);
    return physicalDeltaStmts(db, l.sku, l.delta, reason, ref);
  });
}

/**
 * Tồn theo SKU (mặc định mọi sản phẩm). Combo: available = min ⌊có thể bán / qty_per_combo⌋,
 * stock = min ⌊tồn / qty_per_combo⌋, reserved = stock − available; combo chưa có thành phần → 0.
 * SKU không tồn tại không có trong kết quả.
 */
export async function availability(db: D1Database, skus?: string[]): Promise<Map<string, Availability>> {
  const wanted = skus === undefined ? null : [...new Set(skus)];
  const cat = await loadCatalog(db, wanted);
  const out = new Map<string, Availability>();
  for (const sku of wanted ?? cat.products.keys()) {
    const a = availabilityOf(cat, sku);
    if (a) out.set(sku, a);
  }
  return out;
}

/**
 * Sau khi batch lỗi CHECK: duyệt các dòng theo thứ tự, trừ dần phần có thể bán của từng SKU
 * vật lý; dòng đầu tiên không đủ → "Sản phẩm <tên> chỉ còn N có thể bán" với N là số còn đáp
 * ứng được cho dòng đó (combo nêu tên combo và số combo). Không tìm ra dòng thiếu → câu chung.
 */
export async function stockConflictMessage(db: D1Database, lines: Line[]): Promise<string> {
  const cat = await loadCatalog(db, [...new Set(lines.map((l) => l.sku))]);
  const remaining = new Map<string, number>();
  for (const p of cat.products.values()) {
    if (p.is_combo !== 1) remaining.set(p.sku, p.stock_qty - p.reserved_qty);
  }
  for (const l of lines) {
    const p = cat.products.get(l.sku);
    if (!p) continue;
    const parts = p.is_combo === 1 ? (cat.bom.get(l.sku) ?? []) : [{ sku: l.sku, k: 1 }];
    const canSell = Math.max(
      0,
      parts.reduce((min, c) => Math.min(min, Math.floor((remaining.get(c.sku) ?? 0) / c.k)), parts.length ? Infinity : 0),
    );
    if (canSell < l.qty) return `Sản phẩm ${p.name} chỉ còn ${canSell} có thể bán`;
    for (const c of parts) remaining.set(c.sku, (remaining.get(c.sku) ?? 0) - l.qty * c.k);
  }
  return STOCK_CONFLICT_FALLBACK;
}
