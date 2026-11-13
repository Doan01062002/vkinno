// Đơn hàng mọi nguồn (WEB, MANUAL, IMPORT, QUOTE): tạo, sửa khi PENDING, chuyển trạng thái
// theo bảng spec mục 5, thông tin giao hàng. Mọi tác động kho đi qua inventory.ts và nằm
// cùng một batch với thay đổi của đơn; câu lệnh đầu của batch chuyển trạng thái là guard
// (sai trạng thái → giá trị ngoài CHECK → cả batch rollback), nên bấm hai lần hay hai
// người cùng thao tác không bao giờ giữ/trừ/nhập lại kho hai lần.
import { z } from 'zod';
import {
  createOrderInput,
  idSchema,
  orderListQuery,
  orderShippingInput,
  orderTransitionInput,
  updateOrderInput,
  type CreateOrderInput,
} from '../../src/shared/schemas';
import type { Env } from '../lib/env';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { generateOrderCode } from '../lib/codes';
import { mirrorEvent } from '../lib/notify';
import { isValidVnPhone, normalizeVnPhone } from '../lib/phone';
import { auditStmt } from './audit';
import type { AdminCtx } from './auth';
import { upsertCustomerByPhoneStmts } from './customers';
import {
  damagedLogStmts,
  directSaleOutStmts,
  expandToPhysical,
  releaseStmts,
  reserveStmts,
  restockStmts,
  saleOutStmts,
  stockConflictMessage,
  type DocRef,
  type Line,
} from './inventory';
import { isCheckError, isUniqueError } from '../lib/db-errors';
import { marketplaceReceiptStmts, paymentStatusSql } from './payments';
import { route } from './router';

export type OrderStatus = 'PENDING' | 'PACKED' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED' | 'RETURNED';
export type TransitionTarget = Exclude<OrderStatus, 'PENDING'>;
export type OrderSource = 'WEB' | 'MANUAL' | 'IMPORT' | 'QUOTE';
export interface ReturnLine {
  order_item_id: number;
  action: 'RESTOCK' | 'DAMAGED';
}

/** Bảng chuyển trạng thái hợp lệ (spec mục 5); mọi cặp khác → 409 INVALID_TRANSITION. */
const NEXT: Record<OrderStatus, readonly TransitionTarget[]> = {
  PENDING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['COMPLETED', 'RETURNED'],
  COMPLETED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'chờ xử lý',
  PACKED: 'đã đóng gói',
  SHIPPING: 'đang giao',
  COMPLETED: 'hoàn thành',
  CANCELLED: 'đã huỷ',
  RETURNED: 'đã trả hàng',
};

/**
 * Dấu phiên bản dòng hàng: danh sách id order_items. Sửa đơn xoá rồi chèn lại dòng (id
 * AUTOINCREMENT mới), nên dấu đổi mỗi lần sửa; guard so dấu đọc trước batch để câu lệnh
 * bỏ giữ dựng từ dòng cũ không chạy trên dòng đã bị người khác thay.
 */
const ITEMS_STAMP = `COALESCE((SELECT group_concat(id) FROM
  (SELECT id FROM order_items WHERE order_id = orders.id ORDER BY id)), '')`;

const notFound = () => new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.');

/** Đơn web chờ thanh toán quá 48 giờ (alias bảng `o`): chỉ để nhân viên rà soát, không tự huỷ. */
export const STALE_WEB_SQL = `(o.channel = 'WEB' AND o.order_status = 'PENDING' AND o.payment_status = 'UNPAID'
  AND o.created_at < datetime('now', '-48 hours'))`;

function invalidTransition(from: OrderStatus, to: TransitionTarget | 'EDIT' | 'SHIPPING_INFO'): ApiError {
  const action =
    to === 'EDIT'
      ? 'sửa đơn'
      : to === 'SHIPPING_INFO'
        ? 'cập nhật giao hàng'
        : `chuyển sang "${STATUS_LABEL[to]}"`;
  return new ApiError(409, 'INVALID_TRANSITION', `Đơn đang ${STATUS_LABEL[from]}, không thể ${action}.`, { from, to });
}

const orderChanged = () =>
  new ApiError(409, 'ORDER_CHANGED', 'Đơn vừa được người khác thay đổi, vui lòng tải lại.');

function validationError(error: z.ZodError): ApiError {
  return new ApiError(422, 'VALIDATION', 'Dữ liệu đơn hàng không hợp lệ.', z.flattenError(error).fieldErrors);
}

// ---------------------------------------------------------------------------
// Đọc đơn
// ---------------------------------------------------------------------------

interface OrderRow {
  id: number;
  order_code: string;
  order_status: OrderStatus;
  stock_deducted: number;
  items_stamp: string;
}

interface ItemRow {
  id: number;
  sku: string;
  quantity: number;
}

async function loadOrder(db: D1Database, id: number): Promise<OrderRow> {
  const row = await db
    .prepare(`SELECT id, order_code, order_status, stock_deducted, ${ITEMS_STAMP} AS items_stamp FROM orders WHERE id = ?`)
    .bind(id)
    .first<OrderRow>();
  if (!row) throw notFound();
  return row;
}

async function loadItems(db: D1Database, orderId: number): Promise<ItemRow[]> {
  const res = await db
    .prepare('SELECT id, sku, quantity FROM order_items WHERE order_id = ? ORDER BY id')
    .bind(orderId)
    .all<ItemRow>();
  return res.results;
}

const toLines = (items: { sku: string; quantity: number }[]): Line[] =>
  items.map((i) => ({ sku: i.sku, qty: i.quantity }));

export async function orderDetail(db: D1Database, id: number) {
  const [order, items, payments, logs] = await db.batch([
    db.prepare('SELECT * FROM orders WHERE id = ?').bind(id),
    db
      .prepare(
        `SELECT id, sku, product_name, unit_price, quantity, line_total, unit_cost_vnd
         FROM order_items WHERE order_id = ? ORDER BY id`,
      )
      .bind(id),
    db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').bind(id),
    db
      .prepare(
        `SELECT l.id, l.sku, l.delta, l.stock_after, l.reason, l.doc_type, l.doc_code, l.unit_cost_vnd,
                l.created_by, l.created_at
         FROM inventory_logs l
         WHERE l.ref_order_code = (SELECT order_code FROM orders WHERE id = ?) ORDER BY l.id`,
      )
      .bind(id),
  ]);
  const row = order.results[0] as Record<string, unknown> | undefined;
  if (!row) throw notFound();
  return { ...row, items: items.results, payments: payments.results, inventory_logs: logs.results };
}

// ---------------------------------------------------------------------------
// Chuẩn bị dữ liệu đơn (dùng chung tạo và sửa)
// ---------------------------------------------------------------------------

type ParsedOrder = ReturnType<typeof updateOrderInput.parse>;

interface PreparedOrder {
  phone: string;
  customer: Awaited<ReturnType<typeof upsertCustomerByPhoneStmts>>;
  items: { sku: string; product_name: string; unit_price: number; quantity: number; line_total: number }[];
  lines: Line[];
  subtotal: number;
  discount: number;
  total: number;
}

/**
 * Kiểm tra toàn bộ đầu vào trước khi dựng batch: SĐT, SKU (tồn tại, đang bán, combo có
 * thành phần), giảm giá ≤ tạm tính. Giá dòng không gửi lấy theo hạng giá của khách.
 */
async function prepareOrder(
  db: D1Database,
  input: ParsedOrder,
  opts: { lenientPhone?: boolean } = {},
): Promise<PreparedOrder> {
  const lines = toLines(input.items);
  // Đơn nhập từ sàn: SĐT người mua thường bị che (****) → không tạo khách, giữ nguyên chuỗi gốc.
  const rawPhone = input.customer.phone;
  const skipCustomer =
    opts.lenientPhone === true && (rawPhone.includes('*') || !isValidVnPhone(normalizeVnPhone(rawPhone)));
  const customer = skipCustomer
    ? { stmts: [] as D1PreparedStatement[], customerIdSql: 'NULL', bind: [] as unknown[] }
    : await upsertCustomerByPhoneStmts(db, {
        phone: input.customer.phone,
        name: input.customer.name,
        email: input.customer.email,
        address: input.customer.address,
      });
  const phone = skipCustomer ? rawPhone : (customer.bind[0] as string);
  await expandToPhysical(db, lines);

  const [prodRes, custRes] = await db.batch([
    db
      .prepare(
        'SELECT sku, name, price_vnd, wholesale_price_vnd FROM products WHERE sku IN (SELECT value FROM json_each(?))',
      )
      .bind(JSON.stringify(lines.map((l) => l.sku))),
    db.prepare('SELECT price_tier FROM customers WHERE phone = ?').bind(phone),
  ]);
  const products = new Map(
    (prodRes.results as { sku: string; name: string; price_vnd: number; wholesale_price_vnd: number | null }[]).map(
      (p) => [p.sku, p],
    ),
  );
  const wholesale = (custRes.results[0] as { price_tier: string } | undefined)?.price_tier === 'WHOLESALE';

  const items = input.items.map((i) => {
    const p = products.get(i.sku)!;
    const unit_price = i.unit_price ?? (wholesale ? (p.wholesale_price_vnd ?? p.price_vnd) : p.price_vnd);
    return { sku: i.sku, product_name: p.name, unit_price, quantity: i.quantity, line_total: unit_price * i.quantity };
  });
  const subtotal = items.reduce((s, i) => s + i.line_total, 0);
  const discount = input.discount_vnd;
  if (discount > subtotal) {
    throw new ApiError(422, 'VALIDATION', 'Giảm giá không được lớn hơn tạm tính.', {
      discount_vnd: ['Giảm giá không được lớn hơn tạm tính'],
    });
  }
  const total = subtotal - discount + input.shipping_fee_vnd;
  if (!Number.isSafeInteger(total)) throw new ApiError(422, 'VALIDATION', 'Tổng tiền không hợp lệ.');
  return { phone, customer, items, lines, subtotal, discount, total };
}

function insertItemStmts(db: D1Database, orderSql: string, bind: unknown[], items: PreparedOrder['items']) {
  return items.map((i) =>
    db
      .prepare(
        `INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total)
         VALUES (${orderSql}, ?, ?, ?, ?, ?)`,
      )
      .bind(...bind, i.sku, i.product_name, i.unit_price, i.quantity, i.line_total),
  );
}

/**
 * Đơn B2B (kênh B2B hoặc khách B2B) chưa có hạn thanh toán: đặt hạn = ngày xuất kho (giờ VN)
 * + payment_terms_days của khách. `orderSql` là biểu thức id đơn.
 */
function dueDateStmt(db: D1Database, orderSql: string, bind: unknown[]): D1PreparedStatement {
  const terms = 'COALESCE((SELECT payment_terms_days FROM customers WHERE id = orders.customer_id), 0)';
  return db
    .prepare(
      `UPDATE orders SET due_date = date('now', '+7 hours', '+' || ${terms} || ' days')
       WHERE id = ${orderSql} AND due_date IS NULL
         AND (channel = 'B2B' OR (SELECT type FROM customers WHERE id = orders.customer_id) = 'B2B')`,
    )
    .bind(...bind);
}

// ---------------------------------------------------------------------------
// Tạo đơn
// ---------------------------------------------------------------------------

const QUOTE_CONVERTIBLE_SQL = `status IN ('SENT', 'ACCEPTED') AND (valid_until IS NULL OR valid_until >= date('now', '+7 hours'))`;

export const quoteNotConvertible = () =>
  new ApiError(409, 'QUOTE_NOT_CONVERTIBLE', 'Báo giá không thể chuyển thành đơn (sai trạng thái hoặc đã hết hạn).');

/** Câu lệnh đầu batch chuyển báo giá → đơn: không còn chuyển được thì CHECK lỗi, cả batch rollback. */
function quoteConvertGuard(db: D1Database, quoteId: number): D1PreparedStatement {
  return db
    .prepare(`UPDATE quotes SET status = CASE WHEN ${QUOTE_CONVERTIBLE_SQL} THEN 'CONVERTED' ELSE 'INVALID' END WHERE id = ?`)
    .bind(quoteId);
}

async function quoteIsConvertible(db: D1Database, quoteId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM quotes WHERE id = ? AND ${QUOTE_CONVERTIBLE_SQL}`).bind(quoteId).first();
  return row !== null;
}

/** Đơn nhập từ sàn: SĐT có thể thiếu/bị che nên cho phép chuỗi rỗng (xem prepareOrder). */
const importOrderInput = createOrderInput.extend({
  customer: createOrderInput.shape.customer.extend({ phone: z.string().trim().max(30) }),
});

export interface CreateOrderOpts {
  source: OrderSource;
  userId: number | null;
  status?: 'PENDING' | 'SHIPPING' | 'COMPLETED';
  quoteId?: number;
  /** Chỉ dùng khi source = 'IMPORT': thời điểm đặt hàng của sàn, UTC `YYYY-MM-DD HH:MM:SS`. */
  createdAt?: string;
}

/**
 * Tạo đơn trong MỘT batch: upsert khách theo SĐT, INSERT đơn + dòng (id đơn qua subquery
 * `order_code`), rồi giữ hàng (PENDING) hoặc xuất kho ngay (SHIPPING/COMPLETED, đơn sàn đã giao).
 * Thiếu hàng → 409 STOCK_CONFLICT với tên sản phẩm và số còn có thể bán.
 */
export async function createOrder(
  env: Env,
  rawInput: CreateOrderInput,
  opts: CreateOrderOpts,
  ctx?: ExecutionContext,
): Promise<{ id: number; order_code: string }> {
  const isImport = opts.source === 'IMPORT';
  const parsed = (isImport ? importOrderInput : createOrderInput).safeParse(rawInput);
  if (!parsed.success) throw validationError(parsed.error);
  const input = parsed.data;
  const status = opts.status ?? 'PENDING';
  const db = env.DB;
  const p = await prepareOrder(db, input, { lenientPhone: isImport });

  let orderCode = '';
  for (let attempt = 0; ; attempt++) {
    orderCode = generateOrderCode();
    const ref: DocRef = { docType: 'ORDER', docCode: orderCode, userId: opts.userId };
    const byCode = '(SELECT id FROM orders WHERE order_code = ?)';
    const stockStmts =
      status === 'PENDING'
        ? reserveStmts(db, p.lines)
        : [
            ...(await directSaleOutStmts(db, null, ref)),
            dueDateStmt(db, byCode, [orderCode]),
            // Đơn sàn tạo thẳng COMPLETED: sàn đã thu hộ → ghi nhận thu ngay trong cùng batch.
            ...(status === 'COMPLETED' ? marketplaceReceiptStmts(db, { sql: byCode, bind: [orderCode] }) : []),
          ];
    try {
      await db.batch([
        ...(opts.quoteId === undefined ? [] : [quoteConvertGuard(db, opts.quoteId)]),
        ...p.customer.stmts,
        db
          .prepare(
            `INSERT INTO orders (order_code, external_order_id, channel, customer_name, customer_phone, customer_email,
               shipping_address, notes, subtotal_vnd, shipping_fee_vnd, discount_vnd, total_amount, payment_method,
               order_status, customer_id, due_date, source, created_by, quote_id, voucher_code, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${p.customer.customerIdSql}, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
          )
          .bind(
            orderCode,
            input.external_order_id ?? null,
            input.channel,
            input.customer.name,
            p.phone,
            input.customer.email ?? '',
            input.shipping_address,
            input.notes,
            p.subtotal,
            input.shipping_fee_vnd,
            p.discount,
            p.total,
            input.payment_method,
            status,
            ...p.customer.bind,
            input.due_date ?? null,
            opts.source,
            opts.userId,
            opts.quoteId ?? null,
            input.voucher_code,
            isImport ? (opts.createdAt ?? null) : null,
          ),
        ...insertItemStmts(db, byCode, [orderCode], p.items),
        ...stockStmts,
        auditStmt(db, opts.userId, 'order.create', 'order', orderCode, {
          source: opts.source,
          channel: input.channel,
          status,
          total_amount: p.total,
        }),
      ]);
      break;
    } catch (e) {
      if (isUniqueError(e, 'orders.order_code') && attempt < 4) continue;
      if (isUniqueError(e, 'orders.external_order_id')) {
        throw new ApiError(409, 'DUPLICATE_ORDER', `Đơn ${input.external_order_id} đã có trong hệ thống.`, {
          external_order_id: input.external_order_id,
        });
      }
      if (isCheckError(e)) {
        if (opts.quoteId !== undefined && !(await quoteIsConvertible(db, opts.quoteId))) throw quoteNotConvertible();
        throw new ApiError(409, 'STOCK_CONFLICT', await stockConflictMessage(db, p.lines));
      }
      throw e;
    }
  }

  const row = await db.prepare('SELECT id FROM orders WHERE order_code = ?').bind(orderCode).first<{ id: number }>();
  // Đơn nhập từ sàn không đẩy sự kiện từng đơn (tránh fetch ra ngoài mỗi đơn); runImport đẩy một sự kiện import.batch cho cả request.
  if (ctx && !isImport) {
    mirrorEvent(env, ctx, 'order.created', {
      order_code: orderCode,
      channel: input.channel,
      source: opts.source,
      order_status: status,
      subtotal_vnd: p.subtotal,
      discount_vnd: p.discount,
      shipping_fee_vnd: input.shipping_fee_vnd,
      total_amount: p.total,
      payment_method: input.payment_method,
      items: p.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unit_price: i.unit_price })),
    });
  }
  return { id: row!.id, order_code: orderCode };
}

// ---------------------------------------------------------------------------
// Chuyển trạng thái
// ---------------------------------------------------------------------------

/**
 * Câu lệnh đầu của mọi batch đổi đơn: chỉ áp dụng khi trạng thái là `from` và dòng hàng chưa
 * bị thay kể từ lúc đọc (`stamp`); ngược lại gán 'INVALID' → CHECK lỗi → cả batch rollback.
 */
function guardStmt(db: D1Database, order: OrderRow, to: OrderStatus): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE orders SET
         order_status = CASE WHEN order_status = ?2 AND ${ITEMS_STAMP} = ?3 THEN ?4 ELSE 'INVALID' END,
         updated_at = datetime('now')
       WHERE id = ?1`,
    )
    .bind(order.id, order.order_status, order.items_stamp, to);
}

/** Batch lỗi CHECK: đọc lại đơn để phân biệt sai trạng thái, đơn vừa bị sửa, hay thiếu hàng. */
async function explainFailure(
  db: D1Database,
  before: OrderRow,
  to: TransitionTarget | 'EDIT',
  conflictLines: Line[],
): Promise<ApiError> {
  const now = await loadOrder(db, before.id);
  if (now.order_status !== before.order_status) return invalidTransition(now.order_status, to);
  if (now.items_stamp !== before.items_stamp) return orderChanged();
  return new ApiError(409, 'STOCK_CONFLICT', await stockConflictMessage(db, conflictLines));
}

function splitReturnLines(items: ItemRow[], returnLines: ReturnLine[] | undefined) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<number>();
  const restock: Line[] = [];
  const damaged: Line[] = [];
  for (const r of returnLines ?? []) {
    const item = byId.get(r.order_item_id);
    if (!item || seen.has(r.order_item_id) || (r.action !== 'RESTOCK' && r.action !== 'DAMAGED')) {
      throw new ApiError(422, 'INVALID_RETURN_LINES', 'Dòng trả hàng không hợp lệ hoặc bị trùng.', {
        order_item_id: r.order_item_id,
      });
    }
    seen.add(r.order_item_id);
    (r.action === 'RESTOCK' ? restock : damaged).push({ sku: item.sku, qty: item.quantity });
  }
  if (seen.size !== items.length) {
    throw new ApiError(422, 'INVALID_RETURN_LINES', 'Cần chọn nhập lại kho hoặc ghi hỏng cho từng dòng hàng.', {
      missing: items.filter((i) => !seen.has(i.id)).map((i) => i.id),
    });
  }
  return { restock, damaged };
}

/** Tác động kho của một bước chuyển (spec mục 5), sau câu lệnh guard. */
async function transitionStmts(
  db: D1Database,
  order: OrderRow,
  to: TransitionTarget,
  items: ItemRow[],
  opts: { userId: number | null; returnLines?: ReturnLine[] },
): Promise<D1PreparedStatement[]> {
  const ref = (docType: 'ORDER' | 'RETURN'): DocRef => ({ docType, docCode: order.order_code, userId: opts.userId });
  const lines = toLines(items);
  // Đơn cũ (trước module kho) có thể chưa từng trừ kho: không nhập lại thứ chưa xuất.
  const deducted = order.stock_deducted === 1;
  switch (`${order.order_status}>${to}`) {
    case 'PENDING>PACKED':
      return [...(await saleOutStmts(db, order.id, ref('ORDER'))), dueDateStmt(db, '?', [order.id])];
    case 'SHIPPING>COMPLETED':
      // Đơn sàn: sàn đã thu hộ, tự ghi nhận phần còn thiếu (SQL tính số tiền lúc chạy batch).
      return marketplaceReceiptStmts(db, order.id);
    case 'PENDING>CANCELLED':
      return releaseStmts(db, lines);
    case 'PACKED>CANCELLED':
      return deducted ? restockStmts(db, lines, 'CANCEL_RESTOCK', ref('ORDER')) : [];
    case 'SHIPPING>RETURNED':
    case 'COMPLETED>RETURNED': {
      const { restock, damaged } = splitReturnLines(items, opts.returnLines);
      if (!deducted) return [];
      return [
        ...restockStmts(db, restock, 'RETURN_RESTOCK', ref('RETURN')),
        ...damagedLogStmts(db, damaged, ref('RETURN')),
      ];
    }
    default:
      return [];
  }
}

/**
 * Chuyển trạng thái đơn theo bảng spec mục 5 trong một batch: guard trạng thái + tác động kho
 * + nhật ký. RETURNED cần `returnLines` phủ mỗi dòng hàng đúng một lần (RESTOCK | DAMAGED).
 */
export async function transitionOrder(
  env: Env,
  orderId: number,
  to: TransitionTarget,
  opts: { userId: number | null; returnLines?: ReturnLine[] },
  ctx?: ExecutionContext,
): Promise<void> {
  const db = env.DB;
  const order = await loadOrder(db, orderId);
  if (!NEXT[order.order_status].includes(to)) throw invalidTransition(order.order_status, to);
  const items = await loadItems(db, orderId);
  const stmts = await transitionStmts(db, order, to, items, opts);
  try {
    await db.batch([
      guardStmt(db, order, to),
      ...stmts,
      auditStmt(db, opts.userId, 'order.transition', 'order', orderId, {
        code: order.order_code,
        from: order.order_status,
        to,
        ...(opts.returnLines ? { lines: opts.returnLines } : {}),
      }),
    ]);
  } catch (e) {
    if (!isCheckError(e)) throw e;
    throw await explainFailure(db, order, to, toLines(items));
  }
  if (ctx) mirrorEvent(env, ctx, 'order.status_changed', { order_code: order.order_code, from: order.order_status, to });
}

// ---------------------------------------------------------------------------
// Sửa đơn (PENDING) và giao hàng
// ---------------------------------------------------------------------------

/** Phần tăng thêm theo SKU so với dòng cũ, để thông báo thiếu hàng không tính phần đơn đang giữ. */
function addedLines(oldLines: Line[], newLines: Line[]): Line[] {
  const held = new Map<string, number>();
  for (const l of oldLines) held.set(l.sku, (held.get(l.sku) ?? 0) + l.qty);
  const out: Line[] = [];
  for (const l of newLines) {
    const keep = Math.min(held.get(l.sku) ?? 0, l.qty);
    held.set(l.sku, (held.get(l.sku) ?? 0) - keep);
    if (l.qty > keep) out.push({ sku: l.sku, qty: l.qty - keep });
  }
  return out;
}

async function updateOrder(env: Env, id: number, input: ParsedOrder, userId: number): Promise<void> {
  const db = env.DB;
  const order = await loadOrder(db, id);
  if (order.order_status !== 'PENDING') throw invalidTransition(order.order_status, 'EDIT');
  const oldLines = toLines(await loadItems(db, id));
  const p = await prepareOrder(db, input);
  try {
    await db.batch([
      ...p.customer.stmts,
      db
        .prepare(
          `UPDATE orders SET
             order_status = CASE WHEN order_status = 'PENDING' AND ${ITEMS_STAMP} = ? THEN 'PENDING' ELSE 'INVALID' END,
             channel = ?, customer_name = ?, customer_phone = ?, customer_email = ?, customer_id = ${p.customer.customerIdSql},
             shipping_address = ?, notes = ?, subtotal_vnd = ?, shipping_fee_vnd = ?, discount_vnd = ?, total_amount = ?,
             payment_method = ?, due_date = ?, ${paymentStatusSql('?')}, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(
          order.items_stamp,
          input.channel,
          input.customer.name,
          p.phone,
          input.customer.email ?? '',
          ...p.customer.bind,
          input.shipping_address,
          input.notes,
          p.subtotal,
          input.shipping_fee_vnd,
          p.discount,
          p.total,
          input.payment_method,
          input.due_date ?? null,
          p.total,
          p.total, // paymentStatusSql('?') dùng tổng mới hai lần
          id,
        ),
      ...releaseStmts(db, oldLines),
      db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
      ...insertItemStmts(db, '?', [id], p.items),
      ...reserveStmts(db, p.lines),
      auditStmt(db, userId, 'order.update', 'order', id, { code: order.order_code, total_amount: p.total }),
    ]);
  } catch (e) {
    if (!isCheckError(e)) throw e;
    throw await explainFailure(db, order, 'EDIT', addedLines(oldLines, p.lines));
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function parseId(c: AdminCtx): number {
  const parsed = idSchema.safeParse(c.params.id);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

route('GET', '/orders', async ({ env, url }) => {
  const q = parseQuery(url, orderListQuery);
  const text = q.q || null;
  // Chỉ chuẩn hoá khi chuỗi tìm trông như SĐT ("+84 912…"), để mã đơn "VK2A3B…" không thành "23".
  const phone = text && /^[\d\s+().-]+$/.test(text) ? normalizeVnPhone(text) || null : null;
  const where = `WHERE (?1 IS NULL OR o.channel = ?1) AND (?2 IS NULL OR o.order_status = ?2)
      AND (?3 IS NULL OR o.payment_status = ?3)
      AND (?4 IS NULL OR date(o.created_at, '+7 hours') >= ?4)
      AND (?5 IS NULL OR date(o.created_at, '+7 hours') <= ?5)
      AND (?6 IS NULL OR o.customer_id = ?6)
      AND (?7 IS NULL OR o.order_code LIKE '%' || ?7 || '%' OR o.customer_name LIKE '%' || ?7 || '%'
           OR o.customer_phone LIKE '%' || ?7 || '%'
           OR (?8 IS NOT NULL AND o.customer_phone LIKE '%' || ?8 || '%'))
      AND (?9 IS NULL OR ${STALE_WEB_SQL})`;
  const filters = [
    q.channel ?? null,
    q.status ?? null,
    q.payment_status ?? null,
    q.from ?? null,
    q.to ?? null,
    q.customer_id ?? null,
    text,
    phone,
    q.stale_web === '1' ? 1 : null,
  ];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT o.id, o.order_code, o.external_order_id, o.channel, o.source, o.customer_id, o.customer_name,
              o.customer_phone, o.subtotal_vnd, o.shipping_fee_vnd, o.discount_vnd, o.voucher_code, o.total_amount,
              o.payment_method, o.payment_status, o.paid_amount, o.order_status, o.due_date,
              o.shipping_carrier, o.shipping_tracking_code, o.created_at, o.updated_at,
              (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o ${where} ORDER BY o.id DESC LIMIT ?10 OFFSET ?11`,
    ).bind(...filters, q.page_size, (q.page - 1) * q.page_size),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM orders o ${where}`).bind(...filters),
  ]);
  return ok({
    items: items.results,
    total: (total.results[0] as { n: number }).n,
    page: q.page,
    page_size: q.page_size,
  });
});

route('GET', '/orders/:id', async (c) => ok(await orderDetail(c.env.DB, parseId(c))));

route('POST', '/orders', async ({ env, ctx, req, user }) => {
  const input = await parseBody(req, createOrderInput);
  const { id } = await createOrder(env, input, { source: 'MANUAL', userId: user.id }, ctx);
  return ok(await orderDetail(env.DB, id), 201);
});

route('PUT', '/orders/:id', async (c) => {
  const id = parseId(c);
  const input = await parseBody(c.req, updateOrderInput);
  await updateOrder(c.env, id, input, c.user.id);
  return ok(await orderDetail(c.env.DB, id));
});

route('POST', '/orders/:id/transition', async (c) => {
  const id = parseId(c);
  const { to, lines } = await parseBody(c.req, orderTransitionInput);
  await transitionOrder(c.env, id, to, { userId: c.user.id, returnLines: lines }, c.ctx);
  return ok(await orderDetail(c.env.DB, id));
});

route('PUT', '/orders/:id/shipping', async (c) => {
  const { env, req, user } = c;
  const id = parseId(c);
  const input = await parseBody(req, orderShippingInput);
  const order = await loadOrder(env.DB, id);
  if (order.order_status === 'CANCELLED' || order.order_status === 'RETURNED') {
    throw invalidTransition(order.order_status, 'SHIPPING_INFO');
  }
  const total = 'subtotal_vnd - discount_vnd + ?3';
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE orders SET
           order_status = CASE WHEN order_status IN ('CANCELLED', 'RETURNED') THEN 'INVALID' ELSE order_status END,
           shipping_carrier = ?1, shipping_tracking_code = ?2, shipping_fee_vnd = ?3, total_amount = ${total},
           ${paymentStatusSql(`(${total})`)}, updated_at = datetime('now')
         WHERE id = ?4`,
      ).bind(input.shipping_carrier, input.shipping_tracking_code, input.shipping_fee_vnd, id),
      auditStmt(env.DB, user.id, 'order.shipping', 'order', id, { code: order.order_code, ...input }),
    ]);
  } catch (e) {
    if (!isCheckError(e)) throw e;
    throw invalidTransition((await loadOrder(env.DB, id)).order_status, 'SHIPPING_INFO');
  }
  return ok(await orderDetail(env.DB, id));
});
