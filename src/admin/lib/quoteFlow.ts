// Bảng trạng thái báo giá ở phía giao diện. PHẢI khớp `NEXT` trong worker/admin/quotes.ts;
// máy chủ vẫn là nơi quyết định cuối cùng (409 INVALID_TRANSITION, QUOTE_EXPIRED).

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';
export type QuoteTarget = 'SENT' | 'ACCEPTED' | 'REJECTED';

/** Một bảng duy nhất: trạng thái hiện tại → các trạng thái được chuyển tới. EXPIRED không có lối ra. */
export const NEXT_QUOTE_STATUSES: Record<QuoteStatus, readonly QuoteTarget[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CONVERTED: [],
};

export function nextQuoteStatuses(status: string): readonly QuoteTarget[] {
  return NEXT_QUOTE_STATUSES[status as QuoteStatus] ?? [];
}

export interface QuoteTransitionInfo {
  label: string;
  title: string;
  message: string;
  danger?: boolean;
}

export const QUOTE_TRANSITIONS: Record<QuoteTarget, QuoteTransitionInfo> = {
  SENT: { label: 'Đánh dấu đã gửi', title: 'Đánh dấu đã gửi', message: 'Báo giá sẽ chuyển sang trạng thái đã gửi cho khách.' },
  ACCEPTED: { label: 'Khách chấp nhận', title: 'Khách chấp nhận báo giá', message: 'Ghi nhận khách đã chấp nhận báo giá này?' },
  REJECTED: {
    label: 'Khách từ chối',
    title: 'Khách từ chối báo giá',
    message: 'Ghi nhận khách đã từ chối báo giá này? Không thể hoàn tác.',
    danger: true,
  },
};

/** Chỉ sửa được báo giá nháp hoặc đã gửi (còn hạn). */
export const canEditQuote = (status: string) => status === 'DRAFT' || status === 'SENT';

/** Chỉ chuyển thành đơn khi đã gửi hoặc đã chấp nhận và chưa hết hạn. */
export const canConvertQuote = (status: string) => status === 'SENT' || status === 'ACCEPTED';
