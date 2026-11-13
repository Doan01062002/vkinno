// Bảng trạng thái đơn hàng ở phía giao diện. PHẢI khớp `NEXT` trong worker/admin/orders.ts (spec mục 5);
// máy chủ vẫn là nơi quyết định cuối cùng (409 INVALID_TRANSITION).

export type OrderStatus = 'PENDING' | 'PACKED' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED' | 'RETURNED';
export type TransitionTarget = Exclude<OrderStatus, 'PENDING'>;

export const NEXT_STATUSES: Record<OrderStatus, readonly TransitionTarget[]> = {
  PENDING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['COMPLETED', 'RETURNED'],
  COMPLETED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

export function nextStatuses(status: string): readonly TransitionTarget[] {
  return NEXT_STATUSES[status as OrderStatus] ?? [];
}

export interface TransitionInfo {
  /** Nhãn nút. */
  label: string;
  /** Tiêu đề hộp xác nhận. */
  title: string;
  /** Hệ quả lên kho, nói rõ cho người bấm. */
  message: string;
  danger?: boolean;
}

export const TRANSITIONS: Record<TransitionTarget, TransitionInfo> = {
  PACKED: {
    label: 'Đóng gói',
    title: 'Đóng gói đơn hàng',
    message: 'Hàng sẽ được xuất khỏi kho (tồn thực tế giảm). Bạn chắc chắn muốn đóng gói đơn này?',
  },
  SHIPPING: {
    label: 'Giao hàng',
    title: 'Chuyển đơn sang đang giao',
    message: 'Đơn sẽ chuyển sang trạng thái đang giao. Bạn chắc chắn?',
  },
  COMPLETED: {
    label: 'Hoàn tất',
    title: 'Hoàn tất đơn hàng',
    message: 'Đơn được ghi nhận là đã giao thành công. Bạn chắc chắn?',
  },
  CANCELLED: {
    label: 'Huỷ đơn',
    title: 'Huỷ đơn hàng',
    message: 'Đơn sẽ bị huỷ và hàng đang giữ/đã xuất được trả lại kho. Thao tác này không thể hoàn tác.',
    danger: true,
  },
  RETURNED: {
    label: 'Trả hàng',
    title: 'Trả hàng',
    message: 'Chọn cách xử lý từng dòng hàng trả về.',
    danger: true,
  },
};

export const CHANNEL_LABELS: Record<string, string> = {
  WEB: 'Website',
  SHOPEE: 'Shopee',
  TIKTOK: 'TikTok Shop',
  ZALO: 'Zalo',
  B2B: 'B2B',
  PHONE: 'Điện thoại',
  FACEBOOK: 'Facebook',
};

/** Kênh chọn được khi tạo đơn tay (WEB/SHOPEE/TIKTOK đến từ website hoặc nhập file). */
export const MANUAL_CHANNELS = ['ZALO', 'PHONE', 'FACEBOOK', 'B2B'] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  COD: 'Thu hộ (COD)',
  VIETQR: 'VietQR',
  SHOPEE: 'Shopee',
  BANK_B2B: 'Chuyển khoản B2B',
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  MARKETPLACE: 'Sàn thương mại',
};

/** Phương thức chọn được khi tạo đơn tay hoặc thu/hoàn tiền. */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'COD', 'VIETQR', 'BANK_B2B'] as const;

export const RETURN_ACTION_LABELS = {
  RESTOCK: 'Nhập lại kho',
  DAMAGED: 'Hàng hỏng',
} as const;
