import { STATUS_LABELS } from '../../components/StatusBadge';
import { formatDate, formatVnd } from '../../lib/format';
import type { OrderDetailData } from './types';

export interface TimelineEvent {
  key: string;
  at: string;
  text: string;
}

const LOG_TEXT: Record<string, string> = {
  SALE_OUT: 'Xuất kho khi đóng gói',
  CANCEL_RESTOCK: 'Trả hàng về kho do huỷ đơn',
  RETURN_RESTOCK: 'Hàng trả nhập lại kho',
  RETURN_DAMAGED: 'Hàng trả bị hỏng, ghi nhận hao hụt',
};

/** Dòng thời gian dựng từ dữ liệu có sẵn trong chi tiết đơn: tạo đơn, sổ kho, thu/hoàn tiền. */
export function buildTimeline(order: OrderDetailData): TimelineEvent[] {
  const events: TimelineEvent[] = [{ key: 'created', at: order.created_at, text: 'Tạo đơn' }];

  // Một sự kiện kho gồm nhiều SKU cùng lý do và cùng thời điểm.
  const groups = new Map<string, { at: string; reason: string; skus: number }>();
  for (const l of order.inventory_logs ?? []) {
    if (!LOG_TEXT[l.reason]) continue;
    const k = `${l.reason}|${l.created_at}`;
    const g = groups.get(k) ?? { at: l.created_at, reason: l.reason, skus: 0 };
    g.skus += 1;
    groups.set(k, g);
  }
  for (const [k, g] of groups) events.push({ key: `inv-${k}`, at: g.at, text: `${LOG_TEXT[g.reason]} (${g.skus} sản phẩm)` });

  for (const p of order.payments ?? []) {
    events.push({
      key: `pay-${p.id}`,
      at: p.received_at,
      text: `${p.kind === 'REFUND' ? 'Hoàn tiền' : 'Thu tiền'} ${formatVnd(p.amount_vnd)}`,
    });
  }

  // Trạng thái hiện tại lấy mốc cập nhật gần nhất (đơn chưa lưu thời điểm riêng cho từng bước).
  if (order.order_status !== 'PENDING') {
    const label = STATUS_LABELS.order[order.order_status]?.label ?? order.order_status;
    events.push({ key: 'status', at: order.updated_at, text: `Trạng thái: ${label}` });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

export function OrderTimeline({ order }: { order: OrderDetailData }) {
  const events = buildTimeline(order);
  return (
    <ol aria-label="Dòng thời gian" className="space-y-3 border-l border-line pl-4">
      {events.map((e) => (
        <li key={e.key} className="relative">
          <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
          <p className="text-sm text-fg">{e.text}</p>
          <p className="text-xs text-muted">{formatDate(e.at, { time: true })}</p>
        </li>
      ))}
    </ol>
  );
}
