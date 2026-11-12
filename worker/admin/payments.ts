// Thu tiền và hoàn tiền của đơn. Nguồn sự thật là bảng payments:
// orders.paid_amount = Σ RECEIPT − Σ REFUND, tính lại bằng SQL ngay trong batch (không dùng
// số đọc trước bằng JS) nên hai thao tác đồng thời không làm lệch. Hoàn quá số đã thu làm
// paid_amount < 0 → CHECK lỗi → cả batch rollback. Webhook SePay, gán giao dịch chưa khớp và
// tự thu đơn sàn đều đi qua cùng các câu lệnh này.
import { z } from 'zod';
import { idSchema, pageQuerySchema, paymentMethodSchema } from '../../src/shared/schemas';
import type { Env } from '../lib/env';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { mirrorEvent } from '../lib/notify';
import { auditStmt } from './audit';
import type { AdminCtx } from './auth';
import { route } from './router';

export const paymentInput = z.object({
  kind: z.enum(['RECEIPT', 'REFUND']),
  amount_vnd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: paymentMethodSchema,
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  received_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Thời điểm không hợp lệ')
    .optional(),
});

export type PaymentInput = z.infer<typeof paymentInput>;

/**
 * Quy tắc trạng thái thanh toán DUY NHẤT (dùng cả khi đổi tổng đơn): 0 → UNPAID,
 * nhỏ hơn tổng → PARTIAL, từ tổng trở lên → PAID; `paid_at` đặt khi thành PAID (giữ mốc cũ)
 * và xoá khi không còn PAID. `total` là biểu thức SQL (có thể chứa placeholder).
 */
export const paymentStatusSql = (total: string) => `payment_status = CASE
    WHEN paid_amount <= 0 THEN 'UNPAID' WHEN paid_amount < ${total} THEN 'PARTIAL' ELSE 'PAID' END,
  paid_at = CASE WHEN paid_amount > 0 AND paid_amount >= ${total} THEN COALESCE(paid_at, datetime('now')) ELSE NULL END`;

/** Tính lại paid_amount từ payments rồi trạng thái, sau một INSERT payments của đơn. */
export function recomputePaymentStmts(db: D1Database, orderId: number, andWhere = ''): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE orders SET paid_amount = COALESCE((SELECT SUM(CASE kind WHEN 'RECEIPT' THEN amount_vnd ELSE -amount_vnd END)
           FROM payments WHERE order_id = ?1), 0), updated_at = datetime('now') WHERE id = ?1 ${andWhere}`,
      )
      .bind(orderId),
    // Hai UPDATE riêng vì SET đọc giá trị cũ của hàng: trạng thái phải dựa trên paid_amount mới.
    db
      .prepare(`UPDATE orders SET ${paymentStatusSql('total_amount')} WHERE id = ? ${andWhere}`)
      .bind(orderId),
  ];
}

/** `YYYY-MM-DD HH:MM:SS` UTC (cùng định dạng datetime('now')) hoặc null → dùng mặc định. */
function toSqlTime(s: string | undefined): string | null {
  return s ? new Date(s).toISOString().slice(0, 19).replace('T', ' ') : null;
}

/** INSERT payments + tính lại paid_amount/payment_status/paid_at của đơn (cùng một batch). */
export function addPaymentStmts(
  db: D1Database,
  orderId: number,
  input: PaymentInput,
  opts: { userId: number | null; sepayTxId?: number },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO payments (order_id, kind, amount_vnd, method, reference, sepay_tx_id, received_at, created_by, note)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`,
      )
      .bind(
        orderId,
        input.kind,
        input.amount_vnd,
        input.method,
        input.reference ?? '',
        opts.sepayTxId ?? null,
        toSqlTime(input.received_at),
        opts.userId,
        input.note ?? '',
      ),
    ...recomputePaymentStmts(db, orderId),
  ];
}

/** Tự thu phần còn thiếu của đơn sàn (số tiền tính trong SQL; không làm gì nếu đã đủ). */
export function marketplaceReceiptStmts(db: D1Database, orderId: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO payments (order_id, kind, amount_vnd, method, note)
         SELECT id, 'RECEIPT', total_amount - paid_amount, 'MARKETPLACE', 'Tự thu khi đơn sàn hoàn thành'
         FROM orders WHERE id = ? AND payment_method = 'MARKETPLACE' AND total_amount - paid_amount > 0`,
      )
      .bind(orderId),
    // Đơn không phải MARKETPLACE: không đụng paid_amount/payment_status.
    ...recomputePaymentStmts(db, orderId, "AND payment_method = 'MARKETPLACE'"),
  ];
}

export const isCheckError = (e: unknown) => e instanceof Error && e.message.includes('CHECK constraint failed');
export const isUniqueError = (e: unknown, column: string) =>
  e instanceof Error && e.message.includes('UNIQUE constraint failed') && e.message.includes(column);

interface PaymentOrder {
  id: number;
  order_code: string;
  total_amount: number;
  paid_amount: number;
  payment_status: string;
  order_status: string;
}

const orderNotFound = () => new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.');

async function loadPaymentOrder(db: D1Database, id: number): Promise<PaymentOrder> {
  const row = await db
    .prepare('SELECT id, order_code, total_amount, paid_amount, payment_status, order_status FROM orders WHERE id = ?')
    .bind(id)
    .first<PaymentOrder>();
  if (!row) throw orderNotFound();
  return row;
}

const isClosed = (status: string) => status === 'CANCELLED' || status === 'RETURNED';
const orderClosed = () =>
  new ApiError(409, 'ORDER_CLOSED', 'Đơn đã huỷ hoặc đã trả hàng, không thể gán giao dịch.');

const refundExceeds = (paid: number) =>
  new ApiError(422, 'REFUND_EXCEEDS_PAID', 'Số tiền hoàn lớn hơn số đã thu của đơn.', { paid_amount: paid });

/** Kết quả sau khi ghi: trạng thái mới của đơn và số tiền thu dư (nếu có). */
async function paymentResult(db: D1Database, orderId: number) {
  const o = await loadPaymentOrder(db, orderId);
  const over = o.paid_amount - o.total_amount;
  return {
    order_id: o.id,
    order_code: o.order_code,
    total_amount: o.total_amount,
    paid_amount: o.paid_amount,
    payment_status: o.payment_status,
    ...(over > 0 ? { overpaid_vnd: over } : {}),
  };
}

export async function addPayment(env: Env, orderId: number, input: PaymentInput, userId: number, ctx?: ExecutionContext) {
  const db = env.DB;
  const order = await loadPaymentOrder(db, orderId);
  if (input.kind === 'REFUND' && input.amount_vnd > order.paid_amount) throw refundExceeds(order.paid_amount);
  const action = input.kind === 'REFUND' ? 'payment.refund' : 'payment.create';
  try {
    await db.batch([
      ...addPaymentStmts(db, orderId, input, { userId }),
      auditStmt(db, userId, action, 'order', orderId, {
        code: order.order_code,
        kind: input.kind,
        amount_vnd: input.amount_vnd,
        method: input.method,
      }),
    ]);
  } catch (e) {
    // Hoàn đồng thời làm paid_amount âm: CHECK chặn cả batch.
    if (isCheckError(e)) throw refundExceeds((await loadPaymentOrder(db, orderId)).paid_amount);
    throw e;
  }
  const result = await paymentResult(db, orderId);
  if (ctx) {
    mirrorEvent(env, ctx, 'payment.created', {
      order_code: order.order_code,
      kind: input.kind,
      amount_vnd: input.amount_vnd,
      method: input.method,
      payment_status: result.payment_status,
      paid_amount: result.paid_amount,
    });
  }
  return result;
}

interface UnmatchedLog {
  id: number;
  sepay_tx_id: number;
  transfer_amount: number;
  match_status: string;
  content: string | null;
  reference_code: string | null;
}

export async function assignSepay(env: Env, txId: number, orderId: number, userId: number, ctx?: ExecutionContext) {
  const db = env.DB;
  const log = await db
    .prepare(
      `SELECT id, sepay_tx_id, transfer_amount, match_status, content, reference_code
       FROM sepay_webhook_logs WHERE sepay_tx_id = ?`,
    )
    .bind(txId)
    .first<UnmatchedLog>();
  if (!log) throw new ApiError(404, 'SEPAY_TX_NOT_FOUND', 'Không tìm thấy giao dịch SePay.');
  if (log.match_status !== 'UNMATCHED') {
    throw new ApiError(409, 'SEPAY_ALREADY_HANDLED', 'Giao dịch này đã được ghi nhận hoặc bị bỏ qua.');
  }
  const order = await loadPaymentOrder(db, orderId);
  if (isClosed(order.order_status)) throw orderClosed();
  const input: PaymentInput = {
    kind: 'RECEIPT',
    amount_vnd: log.transfer_amount,
    method: 'VIETQR',
    reference: log.reference_code ?? '',
    note: 'Gán giao dịch SePay chưa khớp',
  };
  try {
    await db.batch([
      // Guard đầu batch: đơn vừa bị huỷ/trả → 'INVALID' ngoài CHECK → rollback cả batch.
      db
        .prepare(
          `UPDATE orders SET order_status = CASE WHEN order_status IN ('CANCELLED', 'RETURNED') THEN 'INVALID' ELSE order_status END
           WHERE id = ?`,
        )
        .bind(orderId),
      // payments.sepay_tx_id UNIQUE: hai lần gán đồng thời thì lần sau rollback cả batch.
      ...addPaymentStmts(db, orderId, input, { userId, sepayTxId: txId }),
      db
        .prepare(
          `UPDATE sepay_webhook_logs SET matched_order_code = ?2,
             match_status = (SELECT CASE WHEN payment_status = 'PAID' THEN 'PAID' ELSE 'PARTIAL' END FROM orders WHERE id = ?3)
           WHERE sepay_tx_id = ?1 AND match_status = 'UNMATCHED'`,
        )
        .bind(txId, order.order_code, orderId),
      auditStmt(db, userId, 'sepay.assign', 'order', orderId, {
        code: order.order_code,
        sepay_tx_id: txId,
        amount_vnd: log.transfer_amount,
      }),
    ]);
  } catch (e) {
    if (isUniqueError(e, 'payments.sepay_tx_id')) {
      throw new ApiError(409, 'SEPAY_ALREADY_HANDLED', 'Giao dịch này đã được ghi nhận.');
    }
    if (isCheckError(e)) throw orderClosed();
    throw e;
  }
  const result = await paymentResult(db, orderId);
  if (ctx) {
    mirrorEvent(env, ctx, 'payment.created', {
      order_code: order.order_code,
      kind: 'RECEIPT',
      amount_vnd: log.transfer_amount,
      method: 'VIETQR',
      sepay_tx_id: txId,
      payment_status: result.payment_status,
      paid_amount: result.paid_amount,
    });
  }
  return { ...result, sepay_tx_id: txId, match_status: result.payment_status === 'PAID' ? 'PAID' : 'PARTIAL' };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function parseParam(c: AdminCtx, name: string, err: () => ApiError): number {
  const parsed = idSchema.safeParse(c.params[name]);
  if (!parsed.success) throw err();
  return parsed.data;
}

route('GET', '/orders/:id/payments', async (c) => {
  const id = parseParam(c, 'id', orderNotFound);
  const q = parseQuery(c.url, pageQuerySchema);
  await loadPaymentOrder(c.env.DB, id);
  const [items, total] = await c.env.DB.batch([
    c.env.DB
      .prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id LIMIT ? OFFSET ?')
      .bind(id, q.page_size, (q.page - 1) * q.page_size),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').bind(id),
  ]);
  return ok({ items: items.results, total: (total.results[0] as { n: number }).n, page: q.page, page_size: q.page_size });
});

route('POST', '/orders/:id/payments', async (c) => {
  const id = parseParam(c, 'id', orderNotFound);
  const input = await parseBody(c.req, paymentInput);
  return ok(await addPayment(c.env, id, input, c.user.id, c.ctx), 201);
});

route('GET', '/sepay/unmatched', async (c) => {
  const q = parseQuery(c.url, pageQuerySchema);
  const [items, total] = await c.env.DB.batch([
    c.env.DB
      .prepare(
        `SELECT id, sepay_tx_id, gateway, account_number, transfer_amount, reference_code, content, received_at
         FROM sepay_webhook_logs WHERE match_status = 'UNMATCHED' ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .bind(q.page_size, (q.page - 1) * q.page_size),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM sepay_webhook_logs WHERE match_status = 'UNMATCHED'"),
  ]);
  return ok({ items: items.results, total: (total.results[0] as { n: number }).n, page: q.page, page_size: q.page_size });
});

const assignInput = z.object({ order_id: idSchema });

route('POST', '/sepay/:txId/assign', async (c) => {
  const txId = parseParam(c, 'txId', () => new ApiError(404, 'SEPAY_TX_NOT_FOUND', 'Không tìm thấy giao dịch SePay.'));
  const { order_id } = await parseBody(c.req, assignInput);
  return ok(await assignSepay(c.env, txId, order_id, c.user.id, c.ctx));
});
