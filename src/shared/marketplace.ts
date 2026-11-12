// Phân tích file đơn xuất từ Shopee / TikTok Shop. Chạy ở trình duyệt (giao diện quản trị đọc
// xlsx/csv rồi gửi các đơn đã parse lên API); Worker kiểm tra lại bằng `importOrdersSchema`.
import { z } from 'zod';

export type Channel = 'SHOPEE' | 'TIKTOK';
export type ImportStatus = 'SKIP' | 'PENDING' | 'SHIPPING' | 'COMPLETED';

export interface ColumnMap {
  order_id: string;
  created_at: string;
  status: string;
  sku: string;
  product_name: string;
  quantity: string;
  unit_price: string;
  shipping_fee: string;
  buyer_name: string;
  buyer_phone: string;
  address: string;
}

/**
 * Tên cột theo file xuất của từng sàn.
 * LƯU Ý: chưa có file xuất thật; các tên cột dưới đây khớp với file mẫu trong test/fixtures và
 * PHẢI được đối chiếu lại với file thật của chủ shop (sửa được ở Cài đặt, khoá app_settings
 * `import.columns.SHOPEE` / `import.columns.TIKTOK`).
 */
export const DEFAULT_COLUMN_MAPS: Record<Channel, ColumnMap> = {
  SHOPEE: {
    order_id: 'Mã đơn hàng',
    created_at: 'Ngày đặt hàng',
    status: 'Trạng Thái Đơn Hàng',
    sku: 'SKU phân loại hàng',
    product_name: 'Tên sản phẩm',
    quantity: 'Số lượng',
    unit_price: 'Giá ưu đãi',
    shipping_fee: 'Phí vận chuyển (dự kiến)',
    buyer_name: 'Tên Người nhận',
    buyer_phone: 'Số điện thoại',
    address: 'Địa chỉ nhận hàng',
  },
  TIKTOK: {
    order_id: 'Order ID',
    created_at: 'Created Time',
    status: 'Order Status',
    sku: 'Seller SKU',
    product_name: 'Product Name',
    quantity: 'Quantity',
    unit_price: 'SKU Unit Original Price',
    shipping_fee: 'Shipping Fee After Discount',
    buyer_name: 'Recipient',
    buyer_phone: 'Phone #',
    address: 'Detail Address',
  },
};

/** Cột bắt buộc phải có trong tiêu đề file; các cột còn lại thiếu thì để trống. */
const REQUIRED: (keyof ColumnMap)[] = ['order_id', 'status', 'sku', 'quantity', 'unit_price'];

/** Khoá là trạng thái của sàn, viết thường (so khớp không phân biệt hoa/thường). */
export const STATUS_MAP: Record<Channel, Record<string, ImportStatus>> = {
  SHOPEE: {
    'chưa thanh toán': 'PENDING',
    'cần xử lý': 'PENDING',
    'chờ xác nhận': 'PENDING',
    'chờ lấy hàng': 'PENDING',
    'đang giao': 'SHIPPING',
    'đã giao': 'COMPLETED',
    'hoàn thành': 'COMPLETED',
    'đã hủy': 'SKIP',
    'đã huỷ': 'SKIP',
    'đã hoàn trả': 'SKIP',
    'đang xử lý hoàn trả': 'SKIP',
  },
  TIKTOK: {
    unpaid: 'PENDING',
    'on hold': 'PENDING',
    'awaiting shipment': 'PENDING',
    'to ship': 'PENDING',
    'awaiting collection': 'PENDING',
    'in transit': 'SHIPPING',
    shipped: 'SHIPPING',
    delivered: 'COMPLETED',
    completed: 'COMPLETED',
    cancelled: 'SKIP',
    canceled: 'SKIP',
  },
};

export interface ImportItem {
  external_sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export interface ImportOrder {
  external_order_id: string;
  created_at: string;
  status: ImportStatus;
  buyer_name: string;
  buyer_phone: string;
  address: string;
  shipping_fee_vnd: number;
  items: ImportItem[];
}

export interface ParseError {
  /** Số dòng trong file (dòng 1 là tiêu đề, dữ liệu bắt đầu từ dòng 2). */
  row: number;
  message: string;
}

/** Máy chủ không tin kết quả parse của trình duyệt: kiểm tra lại bằng schema này. */
export const importOrdersSchema = z
  .array(
    z.object({
      external_order_id: z.string().trim().min(1).max(100),
      created_at: z.string().trim().max(50).default(''),
      status: z.enum(['SKIP', 'PENDING', 'SHIPPING', 'COMPLETED']),
      buyer_name: z.string().trim().max(200).default(''),
      buyer_phone: z.string().trim().max(30).default(''),
      address: z.string().trim().max(500).default(''),
      shipping_fee_vnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      items: z
        .array(
          z.object({
            external_sku: z.string().trim().min(1).max(64),
            product_name: z.string().trim().max(300).default(''),
            quantity: z.number().int().positive().max(100000),
            unit_price: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          }),
        )
        .max(200),
    }),
  )
  .max(2000);

/**
 * Số tiền VND nguyên từ ô trong file: bỏ "₫", "đ", "VND" và khoảng trắng; chấp nhận dấu phân
 * cách nghìn `.` hoặc `,` ("1.250.000", "1,250,000") và phần thập phân toàn số 0. Sai → null.
 */
export function parseVnd(raw: string): number | null {
  const s = raw.replace(/₫|đ|vnd/gi, '').replace(/\s+/g, '');
  let digits: string;
  if (/^\d+$/.test(s)) digits = s;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) digits = s.replace(/[.,]/g, '');
  else if (/^\d+([.,]\d{3})*[.,]0+$/.test(s)) digits = s.replace(/[.,]0+$/, '').replace(/[.,]/g, '');
  else return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Gộp các dòng cùng mã đơn thành một đơn (thông tin đơn lấy ở dòng đầu). Dòng sai → lỗi kèm
 * số dòng và cả đơn đó bị loại (không tạo đơn thiếu dòng). Đơn đã hủy → status 'SKIP'.
 */
export function parseMarketplaceRows(
  channel: Channel,
  rows: Record<string, string>[],
  map: ColumnMap,
): { orders: ImportOrder[]; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const header = new Set(Object.keys(rows[0] ?? {}).map((h) => h.trim()));
  const missing = REQUIRED.filter((k) => !header.has(map[k].trim())).map((k) => map[k]);
  if (rows.length > 0 && missing.length > 0) {
    return { orders: [], errors: [{ row: 1, message: `Thiếu cột bắt buộc: ${missing.join(', ')}` }] };
  }

  // Tra theo tên cột đã cắt khoảng trắng hai đầu.
  const cell = (row: Record<string, string>, key: keyof ColumnMap): string => {
    const want = map[key].trim();
    for (const k of Object.keys(row)) if (k.trim() === want) return (row[k] ?? '').trim();
    return '';
  };

  const orders = new Map<string, ImportOrder>();
  const failed = new Set<string>();
  rows.forEach((row, idx) => {
    const line = idx + 2;
    const id = cell(row, 'order_id');
    if (!id) {
      errors.push({ row: line, message: 'Thiếu mã đơn hàng' });
      return;
    }
    const fail = (message: string) => {
      errors.push({ row: line, message: `${message} (đơn ${id})` });
      failed.add(id);
    };

    let order = orders.get(id);
    if (!order) {
      const rawStatus = cell(row, 'status');
      const status = STATUS_MAP[channel][rawStatus.normalize('NFC').toLowerCase()];
      if (!status) {
        fail(`Trạng thái không nhận diện được: "${rawStatus}"`);
        return;
      }
      const feeRaw = cell(row, 'shipping_fee');
      const fee = feeRaw === '' ? 0 : parseVnd(feeRaw);
      if (fee === null && status !== 'SKIP') {
        fail(`Phí vận chuyển không hợp lệ: "${feeRaw}"`);
        return;
      }
      order = {
        external_order_id: id,
        created_at: cell(row, 'created_at'),
        status,
        buyer_name: cell(row, 'buyer_name'),
        buyer_phone: cell(row, 'buyer_phone'),
        address: cell(row, 'address'),
        shipping_fee_vnd: fee ?? 0,
        items: [],
      };
      orders.set(id, order);
    }
    if (order.status === 'SKIP') return; // đơn bỏ qua: không cần kiểm tra dòng hàng

    const sku = cell(row, 'sku');
    if (!sku) return fail('Thiếu SKU');
    const qtyRaw = cell(row, 'quantity');
    const quantity = /^\d+$/.test(qtyRaw) ? Number(qtyRaw) : 0;
    if (quantity <= 0) return fail(`Số lượng không hợp lệ: "${qtyRaw}"`);
    const priceRaw = cell(row, 'unit_price');
    const unit_price = parseVnd(priceRaw);
    if (unit_price === null) return fail(`Đơn giá không hợp lệ: "${priceRaw}"`);
    order.items.push({ external_sku: sku, product_name: cell(row, 'product_name'), quantity, unit_price });
  });

  return { orders: [...orders.values()].filter((o) => !failed.has(o.external_order_id)), errors };
}
