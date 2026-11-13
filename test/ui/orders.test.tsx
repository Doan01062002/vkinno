import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const xlsx = vi.hoisted(() => ({
  rows: [] as Record<string, string>[],
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: { sheet_to_json: vi.fn() },
}));
vi.mock('xlsx', () => ({
  read: xlsx.read,
  utils: { sheet_to_json: () => xlsx.rows },
}));

import { App } from '../../src/admin/App';
import { formatVnd } from '../../src/admin/lib/format';
import { DEFAULT_COLUMN_MAPS } from '../../src/shared/marketplace';

type Role = 'ADMIN' | 'STAFF';
interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}
type Handler = (call: Call) => unknown;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string, message: string, details?: unknown) =>
  json(status, { ok: false, error: { code, message, details } });

/** Giả lập /api/admin: khoá `METHOD /đường-dẫn`; giá trị trả về là `data` (hoặc một Response). */
function stubApi(role: Role, routes: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.pathname.replace('/api/admin', '');
      if (path === '/auth/me') return json(200, { ok: true, data: { id: 1, email: 'a@b.c', name: 'Người dùng', role } });
      const call: Call = {
        method,
        path,
        query: url.searchParams,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      if (!handler) return apiError(404, 'NOT_FOUND', 'Không tìm thấy.');
      const out = handler(call);
      return out instanceof Response ? out : json(200, { ok: true, data: out });
    }),
  );
  return calls;
}

const list = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 50 });
const open = (path: string) => {
  window.history.pushState({}, '', `/quan-tri${path}`);
  return render(<App />);
};

const orderItems = [
  { id: 1, sku: 'VK-001', product_name: 'Nước tăng lực', unit_price: 150000, quantity: 2, line_total: 300000 },
  { id: 2, sku: 'VK-002', product_name: 'Nước ép đào', unit_price: 100000, quantity: 1, line_total: 100000 },
];

const order = (over: Record<string, unknown> = {}) => ({
  id: 5,
  order_code: 'VK261113-AB12',
  external_order_id: null,
  channel: 'ZALO',
  source: 'MANUAL',
  customer_name: 'Chị Lan',
  customer_phone: '0912345678',
  customer_email: '',
  shipping_address: '12 Lê Lợi, Hà Nội',
  notes: '',
  shipping_carrier: '',
  shipping_tracking_code: '',
  subtotal_vnd: 400000,
  shipping_fee_vnd: 30000,
  discount_vnd: 0,
  voucher_code: '',
  total_amount: 430000,
  payment_method: 'COD',
  payment_status: 'UNPAID',
  paid_amount: 0,
  paid_at: null,
  due_date: null,
  order_status: 'PENDING',
  item_count: 2,
  created_at: '2026-11-13 01:00:00',
  updated_at: '2026-11-13 01:00:00',
  items: orderItems,
  payments: [],
  inventory_logs: [],
  ...over,
});

const pickerRoutes = (): Record<string, Handler> => ({
  'GET /inventory': () =>
    list([
      { sku: 'VK-001', name: 'Nước tăng lực', unit: 'chai', min_stock: 10, is_combo: 0, is_active: 1, stock: 50, reserved: 0, available: 50 },
    ]),
  'GET /products': () => list([{ sku: 'VK-001', name: 'Nước tăng lực', price_vnd: 150000, wholesale_price_vnd: 120000 }]),
});

beforeEach(() => {
  window.history.pushState({}, '', '/quan-tri');
  xlsx.rows = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('Danh sách đơn', () => {
  it('hiện đơn và gửi bộ lọc kênh/trạng thái/thanh toán/ngày lên API', async () => {
    const calls = stubApi('STAFF', { 'GET /orders': () => list([order({ id: 9, order_code: 'VK-LIST-1' })]) });
    open('/don-hang');

    expect(await screen.findByText('VK-LIST-1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Kênh'), { target: { value: 'ZALO' } });
    fireEvent.change(screen.getByLabelText('Trạng thái đơn'), { target: { value: 'PACKED' } });
    fireEvent.change(screen.getByLabelText('Thanh toán'), { target: { value: 'PARTIAL' } });
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-11-01' } });
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/orders').at(-1)!;
      expect(last.query.get('channel')).toBe('ZALO');
      expect(last.query.get('status')).toBe('PACKED');
      expect(last.query.get('payment_status')).toBe('PARTIAL');
      expect(last.query.get('from')).toBe('2026-11-01');
    });
  });
});

describe('Tạo đơn', () => {
  it('khách cũ hạng sỉ: giá sỉ, gửi đúng nội dung và chuyển sang trang chi tiết', async () => {
    const calls = stubApi('STAFF', {
      ...pickerRoutes(),
      'GET /customers': () =>
        list([{ id: 3, phone: '0912345678', name: 'Khách Sỉ', address: '5 Hàng Bài', email: '', price_tier: 'WHOLESALE' }]),
      'POST /orders': () => order({ id: 5 }),
      'GET /orders/5': () => order({ id: 5 }),
    });
    open('/don-hang/moi');

    fireEvent.change(await screen.findByLabelText(/^Số điện thoại/), { target: { value: '0912 345 678' } });
    await screen.findByText(/Khách cũ: Khách Sỉ/);
    expect((screen.getByLabelText(/^Tên khách/) as HTMLInputElement).value).toBe('Khách Sỉ');
    expect((screen.getByLabelText(/^Địa chỉ giao hàng/) as HTMLInputElement).value).toBe('5 Hàng Bài');
    expect(calls.find((c) => c.path === '/customers')?.query.get('q')).toBe('0912345678');

    fireEvent.focus(screen.getByLabelText('Tìm sản phẩm'));
    fireEvent.click(await screen.findByRole('button', { name: /Nước tăng lực/ }));
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));

    // Giá sỉ 120.000 ₫ × 2 = 240.000 ₫; tổng = tạm tính − giảm giá + phí ship.
    expect(await screen.findByLabelText('Thành tiền VK-001')).toHaveProperty('textContent', formatVnd(240000));
    fireEvent.change(screen.getByLabelText('Phí vận chuyển'), { target: { value: '30000' } });
    expect(screen.getByTestId('total').textContent).toBe(formatVnd(270000));

    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/orders')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      channel: 'ZALO',
      customer: { phone: '0912 345 678', name: 'Khách Sỉ', address: '5 Hàng Bài' },
      shipping_address: '5 Hàng Bài',
      notes: '',
      items: [{ sku: 'VK-001', quantity: 2, unit_price: 120000 }],
      shipping_fee_vnd: 30000,
      discount_vnd: 0,
      payment_method: 'CASH',
    });
    expect(await screen.findByRole('heading', { name: /VK261113-AB12/ })).toBeTruthy();
  });

  const typeInto = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const customers: Record<string, unknown> = {
    '0912345678': { id: 1, phone: '0912345678', name: 'Khách A', address: 'Địa chỉ A', email: '', price_tier: 'RETAIL' },
    '0987654321': { id: 2, phone: '0987654321', name: 'Khách B', address: 'Địa chỉ B', email: '', price_tier: 'RETAIL' },
  };
  const customerRoutes = (): Record<string, Handler> => ({
    'GET /customers': (c) => list(customers[c.query.get('q') ?? ''] ? [customers[c.query.get('q') ?? '']] : []),
  });
  const val = (label: RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;

  it('đổi SĐT A sang B thì thay tên/địa chỉ tự điền; B không có thì xoá', async () => {
    stubApi('STAFF', customerRoutes());
    open('/don-hang/moi');
    await screen.findByLabelText(/^Số điện thoại/);
    typeInto(/^Số điện thoại/, '0912345678');
    await waitFor(() => expect(val(/^Tên khách/)).toBe('Khách A'));
    expect(val(/^Địa chỉ giao hàng/)).toBe('Địa chỉ A');
    typeInto(/^Số điện thoại/, '0987654321');
    await waitFor(() => expect(val(/^Tên khách/)).toBe('Khách B'));
    expect(val(/^Địa chỉ giao hàng/)).toBe('Địa chỉ B');
    typeInto(/^Số điện thoại/, '0900000000');
    await waitFor(() => expect(val(/^Tên khách/)).toBe(''));
    expect(val(/^Địa chỉ giao hàng/)).toBe('');
  });

  it('không ghi đè chữ người dùng đã gõ khi tra cứu khách', async () => {
    stubApi('STAFF', customerRoutes());
    open('/don-hang/moi');
    await screen.findByLabelText(/^Số điện thoại/);
    typeInto(/^Tên khách/, 'Tên tự gõ');
    typeInto(/^Số điện thoại/, '0912345678');
    await waitFor(() => expect(val(/^Địa chỉ giao hàng/)).toBe('Địa chỉ A'));
    expect(val(/^Tên khách/)).toBe('Tên tự gõ');
    typeInto(/^Số điện thoại/, '0987654321');
    await waitFor(() => expect(val(/^Địa chỉ giao hàng/)).toBe('Địa chỉ B'));
    expect(val(/^Tên khách/)).toBe('Tên tự gõ');
  });

  it('SĐT bị che hoặc quá ngắn không gửi request tra cứu', async () => {
    const calls = stubApi('STAFF', customerRoutes());
    open('/don-hang/moi');
    await screen.findByLabelText(/^Số điện thoại/);
    typeInto(/^Số điện thoại/, '09123****5678');
    await new Promise((r) => setTimeout(r, 600));
    typeInto(/^Số điện thoại/, '091234');
    await new Promise((r) => setTimeout(r, 600));
    expect(calls.some((c) => c.path === '/customers')).toBe(false);
  });

  it('giảm giá 0 hiện "0 ₫", không có dấu trừ', async () => {
    stubApi('STAFF', customerRoutes());
    open('/don-hang/moi');
    const row = (await screen.findByText('Giảm giá', { selector: 'dt' })).parentElement!;
    expect(row.textContent).toBe(`Giảm giá${formatVnd(0)}`);
  });

  it('409 STOCK_CONFLICT hiện thông báo của máy chủ', async () => {
    const message = 'Không đủ hàng: Nước tăng lực (cần 2, có thể bán 1).';
    stubApi('STAFF', {
      ...pickerRoutes(),
      'GET /customers': () => list([]),
      'POST /orders': () => apiError(409, 'STOCK_CONFLICT', message),
    });
    open('/don-hang/moi');

    fireEvent.change(await screen.findByLabelText(/^Số điện thoại/), { target: { value: '0987654321' } });
    fireEvent.change(screen.getByLabelText(/^Tên khách/), { target: { value: 'Anh Nam' } });
    fireEvent.focus(screen.getByLabelText('Tìm sản phẩm'));
    fireEvent.click(await screen.findByRole('button', { name: /Nước tăng lực/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn' }));

    const alerts = await screen.findAllByText(message);
    expect(alerts.length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/quan-tri/don-hang/moi');
  });
});

describe('Chi tiết đơn', () => {
  const buttonsOf = () => within(screen.getByRole('group', { name: 'Chuyển trạng thái' })).getAllByRole('button').map((b) => b.textContent);

  it.each([
    ['PENDING', ['Đóng gói', 'Huỷ đơn']],
    ['PACKED', ['Giao hàng', 'Huỷ đơn']],
    ['SHIPPING', ['Hoàn tất', 'Trả hàng']],
    ['COMPLETED', ['Trả hàng']],
  ])('đơn %s chỉ có nút chuyển hợp lệ', async (status, expected) => {
    stubApi('STAFF', { 'GET /orders/5': () => order({ order_status: status }) });
    open('/don-hang/5');
    await screen.findByRole('heading', { name: /VK261113-AB12/ });
    expect(buttonsOf()).toEqual(expected);
  });

  it.each(['CANCELLED', 'RETURNED'])('đơn %s không có nút chuyển trạng thái', async (status) => {
    stubApi('STAFF', { 'GET /orders/5': () => order({ order_status: status }) });
    open('/don-hang/5');
    await screen.findByRole('heading', { name: /VK261113-AB12/ });
    expect(screen.queryByRole('group', { name: 'Chuyển trạng thái' })).toBeNull();
  });

  it('chuyển trạng thái phải qua hộp xác nhận rồi gọi đúng endpoint', async () => {
    let status = 'PACKED';
    const calls = stubApi('STAFF', {
      'GET /orders/5': () => order({ order_status: status }),
      'POST /orders/5/transition': () => order({ order_status: (status = 'SHIPPING') }),
    });
    open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Giao hàng' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giao hàng' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/orders/5/transition')).toBe(true));
    expect(calls.find((c) => c.path === '/orders/5/transition')?.body).toEqual({ to: 'SHIPPING' });
    expect(await screen.findByText('Đang giao')).toBeTruthy();
  });

  it('409 INVALID_TRANSITION hiện lỗi của máy chủ', async () => {
    const message = 'Đơn đang đã đóng gói, không thể huỷ.';
    stubApi('STAFF', {
      'GET /orders/5': () => order({ order_status: 'PENDING' }),
      'POST /orders/5/transition': () => apiError(409, 'INVALID_TRANSITION', message),
    });
    open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ đơn' }));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
  });

  it('trả hàng: chọn RESTOCK/DAMAGED từng dòng và gửi lines', async () => {
    let status = 'SHIPPING';
    const calls = stubApi('STAFF', {
      'GET /orders/5': () => order({ order_status: status }),
      'POST /orders/5/transition': () => order({ order_status: (status = 'RETURNED') }),
    });
    open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Trả hàng' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Xử lý VK-002'), { target: { value: 'DAMAGED' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận trả hàng' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/orders/5/transition')).toBe(true));
    expect(calls.find((c) => c.path === '/orders/5/transition')?.body).toEqual({
      to: 'RETURNED',
      lines: [
        { order_item_id: 1, action: 'RESTOCK' },
        { order_item_id: 2, action: 'DAMAGED' },
      ],
    });
    expect(await screen.findByText('Trả hàng', { selector: 'span' })).toBeTruthy();
  });

  it('thu tiền: số mặc định là phần còn phải thu và gửi RECEIPT', async () => {
    const calls = stubApi('STAFF', {
      'GET /orders/5': () => order({ paid_amount: 200000, payment_status: 'PARTIAL', payments: [] }),
      'POST /orders/5/payments': () => ({ payment_status: 'PAID', total_amount: 430000, paid_amount: 430000 }),
    });
    open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Thu tiền' }));

    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/^Số tiền/) as HTMLInputElement).value).toBe('230.000');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu tiền' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/orders/5/payments')).toBe(true));
    expect(calls.find((c) => c.path === '/orders/5/payments')?.body).toEqual({
      kind: 'RECEIPT',
      amount_vnd: 230000,
      method: 'COD',
      reference: '',
      note: '',
    });
  });

  it('hoàn tiền mặc định bằng số đã thu; thu dư hiện cảnh báo', async () => {
    const calls = stubApi('STAFF', {
      'GET /orders/5': () => order({ paid_amount: 500000, payment_status: 'PAID' }),
      'POST /orders/5/payments': () => ({ payment_status: 'PAID' }),
    });
    open('/don-hang/5');
    expect(await screen.findByText(/Đơn đang thu dư/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tiền' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/^Số tiền/) as HTMLInputElement).value).toBe('500.000');
    fireEvent.change(within(dialog).getByLabelText(/^Số tiền/), { target: { value: '70000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hoàn tiền' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/orders/5/payments')).toBe(true));
    expect(calls.find((c) => c.path === '/orders/5/payments')?.body).toMatchObject({ kind: 'REFUND', amount_vnd: 70000 });
  });

  it('giảm giá 0 trong chi tiết đơn không hiện dấu trừ', async () => {
    stubApi('STAFF', { 'GET /orders/5': () => order() });
    open('/don-hang/5');
    const row = (await screen.findByText('Giảm giá', { selector: 'dt' })).parentElement!;
    expect(row.textContent).toBe(`Giảm giá${formatVnd(0)}`);
  });

  it('lỗi máy chủ khi thu tiền hiện ngay trong hộp thoại', async () => {
    stubApi('STAFF', {
      'GET /orders/5': () => order(),
      'POST /orders/5/payments': () => apiError(409, 'ORDER_CLOSED', 'Đơn đã đóng, không ghi nhận thêm.'),
    });
    open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Thu tiền' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu tiền' }));
    expect(await within(dialog).findByText('Đơn đã đóng, không ghi nhận thêm.')).toBeTruthy();
  });

  it('hoàn tiền vượt số đã thu bị chặn ở client', async () => {
    const calls = stubApi('STAFF', { 'GET /orders/5': () => order({ paid_amount: 100000, payment_status: 'PARTIAL' }) });
    open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tiền' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Số tiền/), { target: { value: '150000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hoàn tiền' }));
    expect(await within(dialog).findByText(/không được lớn hơn số đã thu/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('lưu thông tin giao hàng gọi PUT /orders/:id/shipping', async () => {
    const calls = stubApi('STAFF', {
      'GET /orders/5': () => order({ order_status: 'PACKED' }),
      'PUT /orders/5/shipping': () => order({ order_status: 'PACKED', shipping_carrier: 'GHN' }),
    });
    open('/don-hang/5');
    fireEvent.change(await screen.findByLabelText('Hãng vận chuyển'), { target: { value: 'GHN' } });
    fireEvent.change(screen.getByLabelText('Mã vận đơn'), { target: { value: 'GHN123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin giao hàng' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      shipping_carrier: 'GHN',
      shipping_tracking_code: 'GHN123',
      shipping_fee_vnd: 30000,
    });
  });

  it('in phiếu: A5 mặc định, đổi A4, STAFF không gọi /settings', async () => {
    const calls = stubApi('STAFF', { 'GET /orders/5': () => order() });
    const { container } = open('/don-hang/5');
    fireEvent.click(await screen.findByRole('button', { name: 'In phiếu' }));

    expect(await screen.findByLabelText('Phiếu giao hàng')).toBeTruthy();
    expect(container.querySelector('style')?.textContent).toContain('size: A5');
    fireEvent.change(screen.getByLabelText('Khổ giấy'), { target: { value: 'A4' } });
    expect(container.querySelector('style')?.textContent).toContain('size: A4');
    fireEvent.change(screen.getByLabelText('Loại phiếu'), { target: { value: 'packing' } });
    expect(screen.getByLabelText('Phiếu đóng gói')).toBeTruthy();
    expect(calls.some((c) => c.path === '/settings')).toBe(false);
  });
});

describe('Nhập file sàn', () => {
  const shopeeRow = (i: number, sku = 'SKU-A') => ({
    'Mã đơn hàng': `SP${i}`,
    'Ngày đặt hàng': '2026-11-01 10:00',
    'Trạng Thái Đơn Hàng': 'Hoàn thành',
    'SKU phân loại hàng': sku,
    'Tên sản phẩm': 'Nước tăng lực',
    'Số lượng': '1',
    'Giá ưu đãi': '100000',
    'Phí vận chuyển (dự kiến)': '0',
    'Tên Người nhận': 'Khách',
    'Số điện thoại': '0912345678',
    'Địa chỉ nhận hàng': 'Hà Nội',
  });

  const pickFile = async () => {
    const input = (await screen.findByLabelText(/^File đơn hàng/)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'don-shopee.xlsx')] } });
  };

  it('23 đơn chia 3 request nhập, từ request thứ hai gửi batch_id và cộng dồn kết quả', async () => {
    xlsx.rows = Array.from({ length: 23 }, (_, i) => shopeeRow(i + 1));
    const previews: number[] = [];
    const imports: Call[] = [];
    const calls = stubApi('ADMIN', {
      'GET /orders/import/columns': () => DEFAULT_COLUMN_MAPS.SHOPEE,
      'POST /orders/import/preview': (c) => {
        previews.push(c.body.orders.length);
        return { new: c.body.orders.length, duplicates: [], skipped_status: 0, unmapped_skus: [] };
      },
      'POST /orders/import': (c) => {
        imports.push(c);
        const n = c.body.orders.length;
        if (imports.length === 2) {
          return {
            batch_id: 77,
            created: n - 2,
            skipped_duplicates: 1,
            errors: [{ external_order_id: 'SP15', message: 'Không đủ hàng' }],
          };
        }
        return { batch_id: 77, created: n, skipped_duplicates: 0, errors: [] };
      },
    });
    open('/don-hang/nhap-file');
    await pickFile();

    expect(await screen.findByRole('region', { name: 'Xem trước' })).toBeTruthy();
    expect(previews).toEqual([10, 10, 3]);
    fireEvent.click(screen.getByRole('button', { name: 'Nhập 23 đơn' }));
    const dialog = await screen.findByRole('dialog');
    expect(imports).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nhập đơn' }));

    const result = await screen.findByRole('region', { name: 'Kết quả nhập' });
    expect(imports.map((c) => c.body.orders.length)).toEqual([10, 10, 3]);
    expect(imports[0].body).not.toHaveProperty('batch_id');
    expect(imports[1].body.batch_id).toBe(77);
    expect(imports[2].body.batch_id).toBe(77);
    expect(imports.every((c) => c.body.channel === 'SHOPEE' && c.body.file_name === 'don-shopee.xlsx')).toBe(true);
    // 10 + 8 + 3 đơn tạo, 1 trùng, 1 lỗi.
    const text = result.textContent ?? '';
    expect(text).toContain('Đơn đã tạo21');
    expect(text).toContain('Đơn trùng bỏ qua1');
    expect(text).toContain('Đơn lỗi1');
    expect(within(result).getByText(/Không đủ hàng/)).toBeTruthy();
    expect(calls.filter((c) => c.path === '/orders/import')).toHaveLength(3);
  });

  it('SKU chưa gán: gán ngay qua PUT /channel-sku-map rồi xem trước lại', async () => {
    xlsx.rows = [shopeeRow(1), shopeeRow(2)];
    let mapped = false;
    const calls = stubApi('ADMIN', {
      'GET /orders/import/columns': () => DEFAULT_COLUMN_MAPS.SHOPEE,
      'POST /orders/import/preview': () => ({
        new: 2,
        duplicates: [],
        skipped_status: 0,
        unmapped_skus: mapped ? [] : ['SKU-A'],
      }),
      'GET /products': () => list([{ sku: 'VK-001', name: 'Nước tăng lực' }]),
      'PUT /channel-sku-map': () => {
        mapped = true;
        return { updated: 1 };
      },
    });
    open('/don-hang/nhap-file');
    await pickFile();

    const unmappedList = await screen.findByRole('list', { name: 'SKU chưa gán' });
    expect(within(unmappedList).getByText('SKU-A')).toBeTruthy();
    fireEvent.change(within(unmappedList).getByLabelText('Tìm sản phẩm cho SKU-A'), { target: { value: 'nước' } });
    fireEvent.click(await within(unmappedList).findByRole('button', { name: 'Gán SKU-A cho VK-001' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/channel-sku-map')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      channel: 'SHOPEE',
      mappings: [{ external_sku: 'SKU-A', sku: 'VK-001' }],
    });
    await waitFor(() => expect(screen.queryByRole('list', { name: 'SKU chưa gán' })).toBeNull());
    expect(calls.filter((c) => c.path === '/orders/import/preview')).toHaveLength(2);
  });

  it('xem trước gộp đơn mới, trùng và SKU chưa gán từ nhiều nhóm', async () => {
    xlsx.rows = Array.from({ length: 23 }, (_, i) => shopeeRow(i + 1));
    const answers = [
      { new: 8, duplicates: ['SP1', 'SP2'], skipped_status: 0, unmapped_skus: ['A', 'B'] },
      { new: 10, duplicates: [], skipped_status: 0, unmapped_skus: ['B', 'C'] },
      { new: 3, duplicates: ['SP21'], skipped_status: 1, unmapped_skus: [] },
    ];
    let n = 0;
    stubApi('ADMIN', {
      'GET /orders/import/columns': () => DEFAULT_COLUMN_MAPS.SHOPEE,
      'POST /orders/import/preview': () => answers[n++],
    });
    open('/don-hang/nhap-file');
    await pickFile();
    const region = await screen.findByRole('region', { name: 'Xem trước' });
    const text = region.textContent ?? '';
    expect(text).toContain('Đơn mới21');
    expect(text).toContain('Đơn trùng3');
    expect(text).toContain('Đã huỷ/hoàn (bỏ qua)1');
    expect(text).toContain('SKU chưa gán3');
    expect(within(within(region).getByRole('list', { name: 'SKU chưa gán' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('file rỗng giữ thông báo cụ thể', async () => {
    xlsx.rows = [];
    stubApi('ADMIN', { 'GET /orders/import/columns': () => DEFAULT_COLUMN_MAPS.SHOPEE });
    open('/don-hang/nhap-file');
    await pickFile();
    expect((await screen.findAllByText('File không có dòng dữ liệu nào.')).length).toBeGreaterThan(0);
  });

  it('nhóm thứ hai lỗi: hiện trạng thái dở dang rồi tiếp tục với cùng batch_id', async () => {
    xlsx.rows = Array.from({ length: 23 }, (_, i) => shopeeRow(i + 1));
    const imports: Call[] = [];
    let failSecond = true;
    stubApi('ADMIN', {
      'GET /orders/import/columns': () => DEFAULT_COLUMN_MAPS.SHOPEE,
      'POST /orders/import/preview': (c) => ({ new: c.body.orders.length, duplicates: [], skipped_status: 0, unmapped_skus: [] }),
      'POST /orders/import': (c) => {
        imports.push(c);
        if (imports.length === 2 && failSecond) {
          failSecond = false;
          return apiError(500, 'INTERNAL', 'Lỗi máy chủ tạm thời.');
        }
        return { batch_id: 77, created: c.body.orders.length, skipped_duplicates: 0, errors: [] };
      },
    });
    open('/don-hang/nhap-file');
    await pickFile();
    await screen.findByRole('region', { name: 'Xem trước' });
    fireEvent.click(screen.getByRole('button', { name: 'Nhập 23 đơn' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Nhập đơn' }));

    const partial = await screen.findByRole('region', { name: 'Nhập dở dang' });
    expect(partial.textContent).toContain('Đã nhập 1/3 nhóm (đợt #77), 10 đơn đã tạo; lỗi ở nhóm 2: Lỗi máy chủ tạm thời.');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(partial).getByRole('button', { name: 'Tiếp tục nhập' }));
    const result = await screen.findByRole('region', { name: 'Kết quả nhập' });
    expect(imports.map((c) => c.body.orders.length)).toEqual([10, 10, 10, 3]);
    expect(imports[2].body.batch_id).toBe(77);
    expect(imports[3].body.batch_id).toBe(77);
    expect(result.textContent).toContain('Đơn đã tạo23');
  });

  it('lỗi đọc file hiện số dòng', async () => {
    xlsx.rows = [{ ...shopeeRow(1), 'Trạng Thái Đơn Hàng': 'Không rõ' }];
    stubApi('ADMIN', { 'GET /orders/import/columns': () => DEFAULT_COLUMN_MAPS.SHOPEE });
    open('/don-hang/nhap-file');
    await pickFile();
    const region = await screen.findByRole('region', { name: 'Lỗi đọc file' });
    expect(within(region).getByText(/Dòng 2:/)).toBeTruthy();
  });
});
