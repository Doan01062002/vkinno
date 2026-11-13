import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/admin/App';
import { formatVnd } from '../../src/admin/lib/format';
import { NEXT_QUOTE_STATUSES, canConvertQuote, canEditQuote, nextQuoteStatuses } from '../../src/admin/lib/quoteFlow';

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

const b2bCustomer = (over: Record<string, unknown> = {}) => ({
  id: 3,
  phone: '0987654321',
  name: 'Anh Hùng',
  type: 'B2B',
  company_name: 'Công ty Hùng Phát',
  tax_code: '0101234567',
  email: 'hung@example.com',
  address: '5 Hàng Bài, Hà Nội',
  credit_limit_vnd: 50000000,
  payment_terms_days: 30,
  price_tier: 'WHOLESALE',
  note: '',
  total_spent_vnd: 12500000,
  order_count: 4,
  created_at: '2026-10-01 01:00:00',
  ...over,
});

const quote = (over: Record<string, unknown> = {}) => ({
  id: 7,
  code: 'BG261113-AB12',
  customer_id: 3,
  customer_name: 'Anh Hùng',
  status: 'DRAFT',
  valid_until: '2099-12-31',
  note: '',
  discount_vnd: 0,
  shipping_fee_vnd: 0,
  subtotal_vnd: 240000,
  total_amount: 240000,
  created_at: '2026-11-13 01:00:00',
  items: [{ id: 1, sku: 'VK-001', product_name: 'Nước tăng lực', unit_price: 120000, quantity: 2, line_total: 240000 }],
  ...over,
});

const pickerRoutes = (): Record<string, Handler> => ({
  'GET /inventory': () =>
    list([{ sku: 'VK-001', name: 'Nước tăng lực', unit: 'chai', min_stock: 10, is_combo: 0, is_active: 1, stock: 50, reserved: 0, available: 50 }]),
  'GET /products': () => list([{ sku: 'VK-001', name: 'Nước tăng lực', price_vnd: 150000, wholesale_price_vnd: 120000 }]),
});

beforeEach(() => {
  window.history.pushState({}, '', '/quan-tri');
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('quoteFlow', () => {
  it('bảng chuyển trạng thái khớp máy chủ: DRAFT→SENT, SENT→ACCEPTED|REJECTED, còn lại không có lối ra', () => {
    expect(NEXT_QUOTE_STATUSES.DRAFT).toEqual(['SENT']);
    expect(NEXT_QUOTE_STATUSES.SENT).toEqual(['ACCEPTED', 'REJECTED']);
    for (const s of ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED']) expect(nextQuoteStatuses(s)).toEqual([]);
    expect(canEditQuote('SENT')).toBe(true);
    expect(canEditQuote('ACCEPTED')).toBe(false);
    expect(canConvertQuote('ACCEPTED')).toBe(true);
    expect(canConvertQuote('DRAFT')).toBe(false);
    expect(canConvertQuote('EXPIRED')).toBe(false);
  });
});

describe('Khách hàng', () => {
  it('danh sách gửi bộ lọc lẻ/sỉ và từ khoá tìm kiếm lên API', async () => {
    const calls = stubApi('STAFF', { 'GET /customers': () => list([b2bCustomer()]) });
    open('/khach-hang');
    expect(await screen.findByText('Anh Hùng')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Loại khách'), { target: { value: 'B2B' } });
    await waitFor(() => expect(calls.filter((c) => c.path === '/customers').at(-1)!.query.get('type')).toBe('B2B'));
    fireEvent.change(screen.getByPlaceholderText(/Tìm tên, SĐT/), { target: { value: 'Hùng' } });
    await waitFor(() => expect(calls.filter((c) => c.path === '/customers').at(-1)!.query.get('q')).toBe('Hùng'));
  });

  it('khách lẻ không có trường B2B; chọn Sỉ thì hiện và gửi hạn mức, số ngày nợ, công ty, MST', async () => {
    const calls = stubApi('STAFF', {
      'GET /customers': () => list([]),
      'POST /customers': () => b2bCustomer({ id: 9 }),
      'GET /customers/9': () => b2bCustomer({ id: 9 }),
      'GET /customers/9/orders': () => list([]),
    });
    open('/khach-hang');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm khách hàng' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/^Hạn mức công nợ/)).toBeNull();
    expect(within(dialog).queryByLabelText('Tên công ty')).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('Loại khách hàng'), { target: { value: 'B2B' } });
    fireEvent.change(within(dialog).getByLabelText('Bảng giá'), { target: { value: 'WHOLESALE' } });
    fireEvent.change(within(dialog).getByLabelText(/^Số điện thoại/), { target: { value: '0987654321' } });
    fireEvent.change(within(dialog).getByLabelText(/^Tên khách/), { target: { value: 'Anh Hùng' } });
    fireEvent.change(within(dialog).getByLabelText('Tên công ty'), { target: { value: 'Công ty Hùng Phát' } });
    fireEvent.change(within(dialog).getByLabelText('Mã số thuế'), { target: { value: '0101234567' } });
    fireEvent.change(within(dialog).getByLabelText(/^Hạn mức công nợ/), { target: { value: '50000000' } });
    fireEvent.change(within(dialog).getByLabelText(/^Số ngày nợ/), { target: { value: '30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/customers')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'B2B',
      phone: '0987654321',
      name: 'Anh Hùng',
      email: '',
      address: '',
      price_tier: 'WHOLESALE',
      note: '',
      company_name: 'Công ty Hùng Phát',
      tax_code: '0101234567',
      credit_limit_vnd: 50000000,
      payment_terms_days: 30,
    });
    // Tạo xong chuyển tới chi tiết khách.
    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/khach-hang/9'));
  });

  it('chọn khách sỉ mà chưa chọn bảng giá → mặc định giá sỉ (WHOLESALE)', async () => {
    const calls = stubApi('STAFF', {
      'GET /customers': () => list([]),
      'POST /customers': () => b2bCustomer({ id: 9 }),
      'GET /customers/9': () => b2bCustomer({ id: 9 }),
      'GET /customers/9/orders': () => list([]),
    });
    open('/khach-hang');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm khách hàng' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Bảng giá') as HTMLSelectElement).value).toBe('RETAIL');
    fireEvent.change(within(dialog).getByLabelText('Loại khách hàng'), { target: { value: 'B2B' } });
    expect((within(dialog).getByLabelText('Bảng giá') as HTMLSelectElement).value).toBe('WHOLESALE');
    fireEvent.change(within(dialog).getByLabelText(/^Số điện thoại/), { target: { value: '0987654321' } });
    fireEvent.change(within(dialog).getByLabelText(/^Tên khách/), { target: { value: 'Anh Hùng' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/customers')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body.price_tier).toBe('WHOLESALE');
  });

  it('đã tự chọn bảng giá thì đổi sang khách sỉ không ghi đè', async () => {
    stubApi('STAFF', { 'GET /customers': () => list([]) });
    open('/khach-hang');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm khách hàng' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Bảng giá'), { target: { value: 'WHOLESALE' } });
    fireEvent.change(within(dialog).getByLabelText('Bảng giá'), { target: { value: 'RETAIL' } });
    fireEvent.change(within(dialog).getByLabelText('Loại khách hàng'), { target: { value: 'B2B' } });
    expect((within(dialog).getByLabelText('Bảng giá') as HTMLSelectElement).value).toBe('RETAIL');
  });

  it('lỗi trùng SĐT của máy chủ hiện ngay trong hộp thoại', async () => {
    stubApi('STAFF', {
      'GET /customers': () => list([]),
      'POST /customers': () => apiError(409, 'DUPLICATE_PHONE', 'Số điện thoại đã thuộc về khách hàng khác.'),
    });
    open('/khach-hang');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm khách hàng' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Số điện thoại/), { target: { value: '0912345678' } });
    fireEvent.change(within(dialog).getByLabelText(/^Tên khách/), { target: { value: 'Chị Lan' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(dialog).findByText('Số điện thoại đã thuộc về khách hàng khác.')).toBeTruthy();
  });

  it('chi tiết hiện tổng chi tiêu và lịch sử đơn, bấm đơn mở chi tiết đơn', async () => {
    stubApi('STAFF', {
      'GET /customers/3': () => b2bCustomer(),
      'GET /customers/3/orders': () =>
        list([
          {
            id: 41,
            order_code: 'VK-OLD-1',
            channel: 'B2B',
            order_status: 'COMPLETED',
            payment_status: 'PAID',
            total_amount: 5000000,
            paid_amount: 5000000,
            created_at: '2026-10-20 03:00:00',
          },
        ]),
    });
    open('/khach-hang/3');
    expect((await screen.findByTestId('total-spent')).textContent).toBe(formatVnd(12500000));
    fireEvent.click(await screen.findByText('VK-OLD-1'));
    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/don-hang/41'));
  });
});

describe('Nhà cung cấp', () => {
  it('thêm nhà cung cấp gửi đúng nội dung', async () => {
    const calls = stubApi('STAFF', {
      'GET /suppliers': () => list([]),
      'POST /suppliers': () => ({ id: 1, name: 'NCC Một' }),
    });
    open('/nha-cung-cap');
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm nhà cung cấp' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Tên nhà cung cấp/), { target: { value: 'NCC Một' } });
    fireEvent.change(within(dialog).getByLabelText('Mã số thuế'), { target: { value: '0300000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'NCC Một',
      phone: '',
      email: '',
      address: '',
      tax_code: '0300000000',
      note: '',
      is_active: 1,
    });
  });

  it('chi tiết liệt kê phiếu nhập của nhà cung cấp, bấm dòng mở phiếu', async () => {
    const calls = stubApi('STAFF', {
      'GET /suppliers/2': () => ({ id: 2, name: 'NCC Hai', phone: '', email: '', address: '', tax_code: '', note: '', is_active: 1, created_at: '' }),
      'GET /suppliers/2/stock-docs': () =>
        list([{ id: 88, code: 'PN261110-ZZ99', type: 'RECEIPT', status: 'POSTED', note: '', line_count: 3, created_at: '2026-11-10 01:00:00', posted_at: null }]),
    });
    open('/nha-cung-cap/2');
    fireEvent.click(await screen.findByText('PN261110-ZZ99'));
    expect(calls.some((c) => c.path === '/suppliers/2/stock-docs')).toBe(true);
    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/kho/phieu/88'));
  });
});

describe('Báo giá', () => {
  it('soạn báo giá: giá mặc định theo bảng giá sỉ của khách, sửa đơn giá, gửi đúng nội dung', async () => {
    const calls = stubApi('ADMIN', {
      ...pickerRoutes(),
      'GET /customers': () => list([b2bCustomer()]),
      'POST /quotes': () => quote({ id: 7 }),
      'GET /quotes/7': () => quote({ id: 7 }),
      'GET /customers/3': () => b2bCustomer(),
      'GET /settings': () => ({ 'company.name': 'VKINNO' }),
    });
    open('/bao-gia/moi');

    const select = (await screen.findByRole('combobox', { name: /^Khách hàng/ })) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByText(/Anh Hùng/)).toBeTruthy());
    expect(calls.find((c) => c.path === '/customers')?.query.get('type')).toBe('B2B');
    fireEvent.change(select, { target: { value: '3' } });
    expect(await screen.findByText('Bảng giá: sỉ')).toBeTruthy();

    fireEvent.focus(screen.getByLabelText('Tìm sản phẩm'));
    fireEvent.click(await screen.findByRole('button', { name: /Nước tăng lực/ }));
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));

    // Giá sỉ 120.000 ₫ × 2 = 240.000 ₫ (không phải giá lẻ 150.000 ₫).
    expect((await screen.findByLabelText('Thành tiền VK-001')).textContent).toBe(formatVnd(240000));
    // Đơn giá sửa được theo từng dòng: 110.000 ₫ × 2 = 220.000 ₫.
    fireEvent.change(screen.getByPlaceholderText('Đơn giá'), { target: { value: '110000' } });
    expect(screen.getByLabelText('Thành tiền VK-001').textContent).toBe(formatVnd(220000));
    fireEvent.change(screen.getByLabelText('Giảm giá'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('Phí vận chuyển'), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText('Hiệu lực đến'), { target: { value: '2099-12-31' } });
    expect(screen.getByTestId('total').textContent).toBe(formatVnd(230000));

    fireEvent.click(screen.getByRole('button', { name: 'Tạo báo giá' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/quotes')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      customer_id: 3,
      valid_until: '2099-12-31',
      discount_vnd: 20000,
      shipping_fee_vnd: 30000,
      note: '',
      items: [{ sku: 'VK-001', quantity: 2, unit_price: 110000 }],
    });
    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/bao-gia/7'));
  });

  it('không cho lưu khi chưa chọn khách hay sản phẩm', async () => {
    const calls = stubApi('ADMIN', { ...pickerRoutes(), 'GET /customers': () => list([b2bCustomer()]) });
    open('/bao-gia/moi');
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo báo giá' }));
    expect(await screen.findByText('Vui lòng chọn khách hàng.')).toBeTruthy();
    expect(screen.getByText('Báo giá cần ít nhất một sản phẩm.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  const buttonsOf = () => within(screen.getByRole('group', { name: 'Thao tác báo giá' })).getAllByRole('button').map((b) => b.textContent);
  const detailRoutes = (q: Record<string, unknown>): Record<string, Handler> => ({
    ...pickerRoutes(),
    'GET /quotes/7': () => q,
    'GET /customers/3': () => b2bCustomer(),
    'GET /customers': () => list([b2bCustomer()]),
  });

  it('nút theo trạng thái: DRAFT chỉ có "Đánh dấu đã gửi"', async () => {
    stubApi('STAFF', detailRoutes(quote({ status: 'DRAFT' })));
    open('/bao-gia/7');
    await screen.findByRole('group', { name: 'Thao tác báo giá' });
    expect(buttonsOf()).toEqual(['Đánh dấu đã gửi']);
  });

  it('SENT có chấp nhận/từ chối và chuyển thành đơn; chấp nhận gọi POST status sau khi xác nhận', async () => {
    let current = 'SENT';
    const calls = stubApi('STAFF', {
      ...detailRoutes(quote()),
      'GET /quotes/7': () => quote({ status: current }),
      'POST /quotes/7/status': () => {
        current = 'ACCEPTED';
        return quote({ status: current });
      },
    });
    open('/bao-gia/7');
    await screen.findByRole('group', { name: 'Thao tác báo giá' });
    expect(buttonsOf()).toEqual(['Khách chấp nhận', 'Khách từ chối', 'Chuyển thành đơn']);

    fireEvent.click(screen.getByRole('button', { name: 'Khách chấp nhận' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/quotes/7/status')).toBe(true));
    expect(calls.find((c) => c.path === '/quotes/7/status')?.body).toEqual({ to: 'ACCEPTED' });
    // Sau khi chấp nhận không còn nút chấp nhận/từ chối, vẫn chuyển thành đơn được.
    await waitFor(() => expect(buttonsOf()).toEqual(['Chuyển thành đơn']));
  });

  it('báo giá hết hạn hiện nhãn "Hết hạn", khoá biểu mẫu và không có nút thao tác', async () => {
    stubApi('STAFF', detailRoutes(quote({ status: 'EXPIRED', valid_until: '2020-01-01' })));
    open('/bao-gia/7');
    expect((await screen.findAllByText('Hết hạn')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('group', { name: 'Thao tác báo giá' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chuyển thành đơn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu báo giá' })).toBeNull();
  });

  it('chuyển thành đơn: xác nhận rồi mở đơn vừa tạo', async () => {
    const calls = stubApi('STAFF', {
      ...detailRoutes(quote({ status: 'ACCEPTED' })),
      'POST /quotes/7/convert': () => ({ quote: quote({ status: 'CONVERTED' }), order: { id: 55, order_code: 'VK261113-NEW1' } }),
    });
    open('/bao-gia/7');
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển thành đơn' }));
    expect(calls.some((c) => c.path === '/quotes/7/convert')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chuyển thành đơn' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/quotes/7/convert')).toBe(true));
    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/don-hang/55'));
  });

  it.each([
    ['QUOTE_NOT_CONVERTIBLE', 409, 'Báo giá chưa được gửi hoặc đã hết hạn nên không thể chuyển thành đơn.'],
    ['STOCK_CONFLICT', 409, 'Không đủ hàng: Nước tăng lực (cần 2, có thể bán 1).'],
  ])('lỗi %s hiện thông báo của máy chủ và ở lại màn hình báo giá', async (code, status, message) => {
    stubApi('STAFF', {
      ...detailRoutes(quote({ status: 'SENT' })),
      'POST /quotes/7/convert': () => apiError(status, code, message),
    });
    open('/bao-gia/7');
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển thành đơn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chuyển thành đơn' }));
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
    expect(window.location.pathname).toBe('/quan-tri/bao-gia/7');
  });

  it('danh sách lọc theo trạng thái gồm "Hết hạn"', async () => {
    const calls = stubApi('STAFF', { 'GET /quotes': () => list([quote({ status: 'EXPIRED' })]) });
    open('/bao-gia');
    expect(await screen.findByText('BG261113-AB12')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Trạng thái báo giá'), { target: { value: 'EXPIRED' } });
    await waitFor(() => expect(calls.filter((c) => c.path === '/quotes').at(-1)!.query.get('status')).toBe('EXPIRED'));
  });

  it('in báo giá hiện bản xem trước A4 với tên công ty mặc định cho STAFF', async () => {
    stubApi('STAFF', detailRoutes(quote({ status: 'SENT' })));
    open('/bao-gia/7');
    fireEvent.click(await screen.findByRole('button', { name: 'In báo giá' }));
    const sheet = await screen.findByRole('article', { name: 'Báo giá' });
    expect(within(sheet).getByText('VKINNO')).toBeTruthy();
    expect(within(sheet).getByText('Số: BG261113-AB12')).toBeTruthy();
    expect(within(sheet).getByText(/Công ty Hùng Phát/)).toBeTruthy();
  });
});

describe('Công nợ', () => {
  const debts = {
    customer: { id: 3, name: 'Anh Hùng', type: 'B2B', credit_limit_vnd: 50000000, payment_terms_days: 30 },
    items: [
      { id: 21, order_code: 'VK-DEBT-LATE', order_status: 'SHIPPING', total_amount: 3000000, paid_amount: 1000000, outstanding_vnd: 2000000, due_date: '2026-11-01', days_overdue: 12 },
      { id: 22, order_code: 'VK-DEBT-OK', order_status: 'PACKED', total_amount: 1500000, paid_amount: 0, outstanding_vnd: 1500000, due_date: '2099-01-01', days_overdue: 0 },
    ],
  };

  it('danh sách hiện nợ, quá hạn đỏ, hạn mức và nhãn vượt hạn mức', async () => {
    stubApi('STAFF', {
      'GET /debts': () =>
        list([
          { customer_id: 3, name: 'Anh Hùng', outstanding_vnd: 3500000, overdue_vnd: 2000000, oldest_due_date: '2026-11-01', credit_limit_vnd: 3000000, over_limit: true },
          { customer_id: 4, name: 'Chị Mai', outstanding_vnd: 800000, overdue_vnd: 0, oldest_due_date: '2099-01-01', credit_limit_vnd: 0, over_limit: false },
        ]),
    });
    open('/cong-no');
    expect(await screen.findByText('Anh Hùng')).toBeTruthy();
    expect(screen.getByText(formatVnd(2000000)).className).toContain('text-danger');
    expect(screen.getByText('Vượt hạn mức')).toBeTruthy();
    expect(screen.getAllByText('Vượt hạn mức')).toHaveLength(1);
    expect(screen.getByText(formatVnd(0)).className).not.toContain('text-danger');
    fireEvent.click(screen.getByText('Anh Hùng'));
    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/cong-no/3'));
  });

  it('chi tiết tô đỏ đơn quá hạn kèm số ngày, đơn chưa tới hạn không đỏ', async () => {
    stubApi('STAFF', { 'GET /debts/3': () => debts });
    open('/cong-no/3');
    const late = (await screen.findByText('VK-DEBT-LATE')).closest('tr')!;
    const fine = screen.getByText('VK-DEBT-OK').closest('tr')!;
    expect(late.getAttribute('data-overdue')).toBe('true');
    expect(late.className).toContain('text-danger');
    expect(within(late).getByText('Quá hạn 12 ngày')).toBeTruthy();
    expect(fine.getAttribute('data-overdue')).toBe('false');
    expect(fine.className).not.toContain('text-danger');
    expect(screen.getByTestId('outstanding').textContent).toBe(formatVnd(3500000));
    expect(screen.getByTestId('overdue').textContent).toBe(formatVnd(2000000));
  });

  it('thu tiền nhanh: số mặc định là phần còn nợ, gửi RECEIPT rồi tải lại công nợ', async () => {
    let paid = false;
    const calls = stubApi('STAFF', {
      'GET /debts/3': () => (paid ? { ...debts, items: [debts.items[1]] } : debts),
      'POST /orders/21/payments': () => {
        paid = true;
        return { payment_status: 'PAID' };
      },
    });
    open('/cong-no/3');
    fireEvent.click(await screen.findByRole('button', { name: 'Thu tiền VK-DEBT-LATE' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/^Số tiền/) as HTMLInputElement).value).toBe('2.000.000');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu tiền' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/orders/21/payments')).toBe(true));
    expect(calls.find((c) => c.path === '/orders/21/payments')?.body).toEqual({
      kind: 'RECEIPT',
      amount_vnd: 2000000,
      method: 'BANK_TRANSFER',
      reference: '',
      note: '',
    });
    // Đã tải lại: đơn vừa thu đủ biến mất khỏi danh sách nợ.
    await waitFor(() => expect(screen.queryByText('VK-DEBT-LATE')).toBeNull());
    expect(calls.filter((c) => c.path === '/debts/3').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('outstanding').textContent).toBe(formatVnd(1500000));
  });

  it('lỗi khi thu tiền hiện ngay trong hộp thoại', async () => {
    stubApi('STAFF', {
      'GET /debts/3': () => debts,
      'POST /orders/21/payments': () => apiError(409, 'ORDER_CLOSED', 'Đơn đã đóng, không ghi nhận thêm.'),
    });
    open('/cong-no/3');
    fireEvent.click(await screen.findByRole('button', { name: 'Thu tiền VK-DEBT-LATE' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu tiền' }));
    expect(await within(dialog).findByText('Đơn đã đóng, không ghi nhận thêm.')).toBeTruthy();
  });
});
