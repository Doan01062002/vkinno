export type StatusKind = 'order' | 'payment' | 'doc' | 'quote';

type Tone = 'gray' | 'blue' | 'amber' | 'violet' | 'green' | 'red';

/** Nhãn tiếng Việt + màu cho từng trạng thái (khớp CHECK trong migrations/0003_admin.sql). */
export const STATUS_LABELS: Record<StatusKind, Record<string, { label: string; tone: Tone }>> = {
  order: {
    PENDING: { label: 'Chờ xử lý', tone: 'amber' },
    PACKED: { label: 'Đã đóng gói', tone: 'blue' },
    SHIPPING: { label: 'Đang giao', tone: 'violet' },
    COMPLETED: { label: 'Hoàn tất', tone: 'green' },
    CANCELLED: { label: 'Đã huỷ', tone: 'gray' },
    RETURNED: { label: 'Trả hàng', tone: 'red' },
  },
  payment: {
    UNPAID: { label: 'Chưa thanh toán', tone: 'red' },
    PARTIAL: { label: 'Thanh toán một phần', tone: 'amber' },
    PAID: { label: 'Đã thanh toán', tone: 'green' },
  },
  doc: {
    DRAFT: { label: 'Nháp', tone: 'gray' },
    POSTED: { label: 'Đã ghi sổ', tone: 'green' },
    CANCELLED: { label: 'Đã huỷ', tone: 'red' },
  },
  quote: {
    DRAFT: { label: 'Nháp', tone: 'gray' },
    SENT: { label: 'Đã gửi', tone: 'blue' },
    ACCEPTED: { label: 'Đã chấp nhận', tone: 'green' },
    REJECTED: { label: 'Bị từ chối', tone: 'red' },
    EXPIRED: { label: 'Hết hạn', tone: 'amber' },
    CONVERTED: { label: 'Đã chuyển đơn', tone: 'violet' },
  },
};

const TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  red: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
};

/** Danh sách `{ value, label }` để dựng bộ lọc trạng thái. */
export function statusOptions(kind: StatusKind): { value: string; label: string }[] {
  return Object.entries(STATUS_LABELS[kind]).map(([value, s]) => ({ value, label: s.label }));
}

export interface StatusBadgeProps {
  kind: StatusKind;
  /** Mã trạng thái từ API, vd. "PENDING". Mã lạ hiển thị nguyên văn. */
  value: string;
}

/** Nhãn trạng thái có màu cho đơn hàng, thanh toán, phiếu kho, báo giá. */
export function StatusBadge({ kind, value }: StatusBadgeProps) {
  const s = STATUS_LABELS[kind][value] ?? { label: value, tone: 'gray' as Tone };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[s.tone]}`}
    >
      {s.label}
    </span>
  );
}
