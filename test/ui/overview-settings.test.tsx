import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/admin/App';
import { completeMap } from '../../src/admin/pages/settings/ColumnMaps';
import { salesSheetRows, topSheetRows } from '../../src/admin/pages/reports/sheets';
import { DEFAULT_COLUMN_MAPS } from '../../src/shared/marketplace';

const xlsxMock = vi.hoisted(() => ({ sheets: [] as string[], written: '' }));
vi.mock('xlsx', () => ({
  utils: {
    book_new: () => ({}),
    json_to_sheet: (rows: unknown) => rows,
    book_append_sheet: (_b: unknown, _s: unknown, name: string) => xlsxMock.sheets.push(name),
  },
  writeFile: (_b: unknown, name: string) => {
    xlsxMock.written = name;
  },
}));
vi.mock('../../src/admin/pages/reports/ReportChart', () => ({ default: () => <div data-testid="chart" /> }));

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

function stubApi(role: Role, routes: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.pathname.replace('/api/admin', '');
      if (path === '/auth/me') return json(200, { ok: true, data: { id: 1, email: 'a@b.c', name: 'Người dùng', role } });
      const call: Call = { method, path, query: url.searchParams, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      if (!handler) return apiError(404, 'NOT_FOUND', 'Không tìm thấy.');
      const out = await handler(call);
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

const dashboard = (over: Record<string, unknown> = {}) => ({
  orders_by_status: { PENDING: 3, PACKED: 1, SHIPPING: 0, COMPLETED: 5, CANCELLED: 0, RETURNED: 0 },
  pending_orders: 3,
  alerts_count: 2,
  sepay_unmatched: 1,
  ...over,
});
const tx = { id: 7, sepay_tx_id: 555, gateway: 'MB', account_number: '1', transfer_amount: 250000, reference_code: 'R1', content: 'CK VK2A3B', received_at: '2026-11-13 01:00:00' };
const order = { id: 42, order_code: 'VK2A3B', customer_name: 'Chị Lan', total_amount: 250000, order_status: 'PENDING' };

const baseRoutes = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
  'GET /reports/dashboard': () => dashboard(),
  'GET /inventory/alerts': () => ({ low_stock: [], expiring: [] }),
  'GET /sepay/unmatched': () => list([tx]),
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Tổng quan', () => {
  it('STAFF không thấy doanh thu, không có chữ undefined và không gọi /reports/sales, /settings', async () => {
    const calls = stubApi('STAFF', baseRoutes());
    const { container } = open('/tong-quan');
    expect(await screen.findByText('Đơn chờ xử lý')).toBeTruthy();
    expect(calls.some((c) => c.path === '/reports/sales' || c.path === '/settings')).toBe(false);
    expect(screen.queryByText('Doanh thu hôm nay')).toBeNull();
    expect(screen.queryByText('Doanh thu tháng này')).toBeNull();
    expect(container.textContent).not.toContain('undefined');
  });

  it('thẻ "Đơn web chờ thanh toán quá 48 giờ" hiện số và dẫn tới danh sách đã lọc (cả STAFF)', async () => {
    stubApi('STAFF', baseRoutes({ 'GET /reports/dashboard': () => dashboard({ stale_web_orders: 4 }) }));
    open('/tong-quan');
    const label = await screen.findByText('Đơn web chờ thanh toán quá 48 giờ');
    const link = label.closest('a')!;
    expect(link.getAttribute('href')).toBe('/quan-tri/don-hang?stale_web=1');
    expect(link.textContent).toContain('4');
  });

  it('ADMIN thấy doanh thu hôm nay và tháng', async () => {
    stubApi('ADMIN', baseRoutes({ 'GET /reports/dashboard': () => dashboard({ today_revenue_vnd: 1500000, month_revenue_vnd: 9000000 }) }));
    open('/tong-quan');
    expect(await screen.findByText('1.500.000 ₫')).toBeTruthy();
    expect(screen.getByText('9.000.000 ₫')).toBeTruthy();
  });

  it('gán giao dịch SePay vào đơn: gửi đúng order_id rồi tải lại danh sách', async () => {
    const calls = stubApi('ADMIN', baseRoutes({
      'GET /orders': () => list([order]),
      'POST /sepay/555/assign': () => ({ payment_status: 'PAID' }),
    }));
    open('/tong-quan');
    fireEvent.click(await screen.findByRole('button', { name: 'Gán đơn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Tìm đơn hàng'), { target: { value: 'VK2A3B' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /VK2A3B/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gán đơn' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xác nhận gán giao dịch' });
    expect(confirm.textContent).toContain('VK2A3B');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Gán đơn' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/sepay/555/assign')).toBe(true));
    expect(calls.find((c) => c.path === '/sepay/555/assign')?.body).toEqual({ order_id: 42 });
    expect(calls.find((c) => c.path === '/orders')?.query.get('q')).toBe('VK2A3B');
    await waitFor(() => expect(calls.filter((c) => c.path === '/sepay/unmatched').length).toBeGreaterThan(1));
    expect(calls.filter((c) => c.path === '/reports/dashboard').length).toBeGreaterThan(0);
  });

  it('đơn đã đóng: hiện thông báo ORDER_CLOSED trong hộp thoại', async () => {
    stubApi('ADMIN', baseRoutes({
      'GET /orders': () => list([order]),
      'POST /sepay/555/assign': () => apiError(409, 'ORDER_CLOSED', 'Đơn đã huỷ hoặc đã trả hàng, không thể gán giao dịch.'),
    }));
    open('/tong-quan');
    fireEvent.click(await screen.findByRole('button', { name: 'Gán đơn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Tìm đơn hàng'), { target: { value: 'VK2A3B' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /VK2A3B/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gán đơn' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Xác nhận gán giao dịch' })).getByRole('button', { name: 'Gán đơn' }));
    expect(await screen.findByText('Đơn đã huỷ hoặc đã trả hàng, không thể gán giao dịch.')).toBeTruthy();
  });
});

describe('SePay đã được xử lý', () => {
  it.each([
    [409, 'SEPAY_ALREADY_HANDLED', 'Giao dịch này đã được ghi nhận hoặc bị bỏ qua.'],
    [404, 'SEPAY_TX_NOT_FOUND', 'Không tìm thấy giao dịch SePay.'],
  ])('%s %s: làm mới danh sách và tổng quan', async (status, code, message) => {
    const calls = stubApi('ADMIN', baseRoutes({
      'GET /orders': () => list([order]),
      'POST /sepay/555/assign': () => apiError(status, code, message),
    }));
    open('/tong-quan');
    fireEvent.click(await screen.findByRole('button', { name: 'Gán đơn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Tìm đơn hàng'), { target: { value: 'VK2A3B' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /VK2A3B/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gán đơn' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Xác nhận gán giao dịch' })).getByRole('button', { name: 'Gán đơn' }));
    expect(await screen.findByText(message)).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.path === '/sepay/unmatched').length).toBeGreaterThan(1));
    expect(calls.filter((c) => c.path === '/reports/dashboard').length).toBeGreaterThan(1);
  });
});

describe('Đơn hàng lọc theo URL', () => {
  it('bỏ qua status không hợp lệ trong URL', async () => {
    const calls = stubApi('ADMIN', { 'GET /orders': () => list([]) });
    open('/don-hang?status=HACKED');
    await waitFor(() => expect(calls.some((c) => c.path === '/orders')).toBe(true));
    expect(calls.find((c) => c.path === '/orders')?.query.get('status') ?? '').toBe('');
  });
  it('stale_web=1 trong URL gửi lên API; bỏ lọc thì không gửi nữa', async () => {
    const calls = stubApi('ADMIN', { 'GET /orders': () => list([]) });
    open('/don-hang?stale_web=1');
    await waitFor(() => expect(calls.some((c) => c.path === '/orders')).toBe(true));
    expect(calls.find((c) => c.path === '/orders')?.query.get('stale_web')).toBe('1');
    expect(screen.getByText(/Đơn web chờ thanh toán quá 48 giờ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc' }));
    await waitFor(() => expect(calls.at(-1)?.query.get('stale_web') ?? '').toBe(''));
  });
  it('nhận status hợp lệ', async () => {
    const calls = stubApi('ADMIN', { 'GET /orders': () => list([]) });
    open('/don-hang?status=PENDING');
    await waitFor(() => expect(calls.some((c) => c.path === '/orders')).toBe(true));
    expect(calls.find((c) => c.path === '/orders')?.query.get('status')).toBe('PENDING');
  });
});

describe('Báo cáo', () => {
  const rows = [
    { key: '2026-11-01', orders: 2, returns: 0, revenue_vnd: 1000000, cost_total_vnd: 600000, gross_profit_vnd: 400000, gross_margin: 0.4 },
    { key: '2026-11-02', orders: 1, returns: 1, revenue_vnd: 500000, cost_total_vnd: 300000, gross_profit_vnd: 200000, gross_margin: 0.2345 },
  ];

  it('hiển thị bảng từ dữ liệu, biên lãi theo %', async () => {
    const calls = stubApi('ADMIN', {
      'GET /reports/sales': (c) => (c.query.get('group') === 'channel' ? [{ ...rows[0], key: 'SHOPEE' }] : c.query.get('group') === 'product' ? [{ ...rows[0], key: 'SP1', name: 'Tinh dầu' }] : rows),
      'GET /reports/top-products': () => [{ sku: 'SP1', name: 'Tinh dầu', quantity: 12, revenue_vnd: 700000 }],
    });
    open('/bao-cao');
    expect(await screen.findByText('2026-11-02')).toBeTruthy();
    expect(screen.getByText('23,45%')).toBeTruthy();
    expect(screen.getAllByText('1.000.000 ₫').length).toBeGreaterThan(0);
    expect(await screen.findByText('Shopee')).toBeTruthy();
    expect(screen.getAllByText('Tinh dầu').length).toBeGreaterThan(0);
    const sales = calls.find((c) => c.path === '/reports/sales' && c.query.get('group') === 'day');
    expect(sales?.query.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(screen.getByRole('button', { name: /Xuất Excel/ })).toBeTruthy();
  });

  const reportRoutes = (top: Handler): Record<string, Handler> => ({
    'GET /reports/sales': (c) => (c.query.get('group') === 'channel' ? [{ ...rows[0], key: 'SHOPEE' }] : c.query.get('group') === 'product' ? [{ ...rows[0], key: 'SP1', name: 'Tinh dầu' }] : rows),
    'GET /reports/top-products': top,
  });

  it('Xuất Excel bị khoá khi truy vấn phụ còn chờ, mở khi đủ dữ liệu và xuất đủ 4 sheet', async () => {
    xlsxMock.sheets.length = 0;
    let release: (v: unknown) => void = () => undefined;
    const pending = new Promise((r) => (release = r));
    stubApi('ADMIN', reportRoutes(() => pending));
    open('/bao-cao');
    await screen.findByText('2026-11-02');
    await screen.findByText('Shopee');
    const btn = screen.getByRole('button', { name: /Xuất Excel/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    release([{ sku: 'SP1', name: 'Tinh dầu', quantity: 12, revenue_vnd: 700000 }]);
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(xlsxMock.sheets).toHaveLength(4));
    expect(xlsxMock.sheets).toEqual(['Kỳ - ngày', 'Theo kênh', 'Theo sản phẩm', 'Top sản phẩm']);
  });

  it('một truy vấn lỗi: khoá Xuất Excel và hiện lý do', async () => {
    stubApi('ADMIN', reportRoutes(() => apiError(500, 'INTERNAL', 'Lỗi hệ thống, vui lòng thử lại.')));
    open('/bao-cao');
    expect(await screen.findByText(/Lỗi hệ thống, vui lòng thử lại/, {}, { timeout: 5000 })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Xuất Excel/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('khoảng ngày mặc định theo giờ Việt Nam', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-30T18:00:00Z'));
    try {
      stubApi('ADMIN', reportRoutes(() => []));
      open('/bao-cao');
      expect(((await screen.findByLabelText('Từ ngày')) as HTMLInputElement).value).toBe('2026-12-01');
      expect((screen.getByLabelText('Đến ngày') as HTMLInputElement).value).toBe('2026-12-01');
    } finally {
      vi.useRealTimers();
    }
  });

  it('xuất Excel: hàng là số, không phải chuỗi đã định dạng', () => {
    const out = salesSheetRows('period', rows);
    expect(out[1]).toEqual({
      Kỳ: '2026-11-02',
      'Số đơn': 1,
      'Đơn trả': 1,
      'Doanh thu (₫)': 500000,
      'Giá vốn (₫)': 300000,
      'Lãi gộp (₫)': 200000,
      'Biên lãi gộp (%)': 23.45,
    });
    expect(salesSheetRows('channel', [{ ...rows[0], key: 'SHOPEE' }])[0].Kênh).toBe('Shopee');
    expect(salesSheetRows('product', [{ ...rows[0], key: 'SP1', name: 'A' }])[0].SKU).toBe('SP1');
    expect(topSheetRows([{ sku: 'SP1', name: 'A', quantity: 3, revenue_vnd: 90000 }])[0]['Số lượng bán']).toBe(3);
    for (const v of Object.values(out[0]).slice(1)) expect(typeof v).toBe('number');
  });
});

describe('Cài đặt', () => {
  const settings = {
    'company.name': 'VKINNO',
    'company.address': null,
    'company.phone': '0900000000',
    'company.tax_code': null,
    'company.bank_account': null,
    'company.bank_name': null,
    'print.invoice_footer': null,
    'print.show_logo': null,
    'telegram.enabled': null,
    'import.columns.SHOPEE': null,
    'import.columns.TIKTOK': null,
  };

  it('chỉ gửi các khoá đã đổi', async () => {
    const calls = stubApi('ADMIN', { 'GET /settings': () => settings, 'PUT /settings': () => ({ updated: [] }) });
    open('/cai-dat');
    const phone = await screen.findByLabelText('Số điện thoại');
    await waitFor(() => expect((phone as HTMLInputElement).value).toBe('0900000000'));
    const save = screen.getByRole('button', { name: 'Lưu cài đặt' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Địa chỉ'), { target: { value: ' 1 Lê Lợi ' } });
    fireEvent.click(screen.getByLabelText('Hiện logo trên phiếu in'));
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ 'company.address': '1 Lê Lợi', 'print.show_logo': true });
  });

  it('bật Telegram gửi đúng khoá', async () => {
    const calls = stubApi('ADMIN', { 'GET /settings': () => settings, 'PUT /settings': () => ({ updated: [] }) });
    open('/cai-dat/telegram');
    fireEvent.click(await screen.findByRole('checkbox'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ 'telegram.enabled': true }));
  });

  it('ánh xạ cột: placeholder là mặc định, khôi phục gửi bản đồ mặc định', async () => {
    const calls = stubApi('ADMIN', { 'GET /settings': () => settings, 'PUT /settings': () => ({ updated: [] }) });
    open('/cai-dat/file-san');
    const shopee = await screen.findByRole('region', { name: 'Ánh xạ cột Shopee' });
    expect((within(shopee).getByLabelText('Mã đơn') as HTMLInputElement).placeholder).toBe(DEFAULT_COLUMN_MAPS.SHOPEE.order_id);
    fireEvent.click(within(shopee).getByRole('button', { name: 'Khôi phục mặc định' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ 'import.columns.SHOPEE': DEFAULT_COLUMN_MAPS.SHOPEE });
    expect(completeMap({ order_id: ' Mã ' }, 'TIKTOK')).toEqual({ ...DEFAULT_COLUMN_MAPS.TIKTOK, order_id: 'Mã' });
  });

  it('hạ quyền quản trị viên cuối cùng: hiện thông báo LAST_ADMIN', async () => {
    const admin = { id: 1, email: 'a@b.c', name: 'Chủ shop', role: 'ADMIN', is_active: 1, last_login_at: null, created_at: '2026-01-01 00:00:00' };
    const calls = stubApi('ADMIN', {
      'GET /users': () => ({ items: [admin] }),
      'PUT /users/1': () => apiError(409, 'LAST_ADMIN', 'Không thể hạ quyền hoặc khoá quản trị viên cuối cùng.'),
    });
    open('/cai-dat/tai-khoan');
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa a@b.c' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Vai trò'), { target: { value: 'STAFF' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(dialog).findByText('Không thể hạ quyền hoặc khoá quản trị viên cuối cùng.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'Chủ shop', role: 'STAFF', is_active: true });
  });

  it('tạo tài khoản gửi đủ email, tên, vai trò, mật khẩu', async () => {
    const calls = stubApi('ADMIN', { 'GET /users': () => ({ items: [] }), 'POST /users': () => ({ id: 2 }) });
    open('/cai-dat/tai-khoan');
    fireEvent.click(await screen.findByRole('button', { name: /Thêm tài khoản/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Email/), { target: { value: 'nv@vkinno.vn' } });
    fireEvent.change(within(dialog).getByLabelText(/Họ tên/), { target: { value: 'Nhân viên' } });
    fireEvent.change(within(dialog).getByLabelText(/Mật khẩu/), { target: { value: 'matkhau-dai-123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo tài khoản' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'nv@vkinno.vn', name: 'Nhân viên', role: 'STAFF', password: 'matkhau-dai-123' });
  });

  it('đặt lại mật khẩu gửi {password} và xoá mật khẩu khi mở lại', async () => {
    const u = { id: 3, email: 'nv@b.c', name: 'Nhân viên', role: 'STAFF', is_active: 1, last_login_at: null, created_at: '2026-01-01 00:00:00' };
    const calls = stubApi('ADMIN', { 'GET /users': () => ({ items: [u] }), 'POST /users/3/reset-password': () => ({}) });
    open('/cai-dat/tai-khoan');
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt lại mật khẩu nv@b.c' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Mật khẩu mới/), { target: { value: 'mat-khau-moi-123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ password: 'mat-khau-moi-123' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu nv@b.c' }));
    dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/Mật khẩu mới/) as HTMLInputElement).value).toBe('');
  });

  it('nhật ký: lọc theo đối tượng gửi tham số entity', async () => {
    const calls = stubApi('ADMIN', {
      'GET /users': () => ({ items: [] }),
      'GET /audit-logs': () => list([{ id: 1, user_id: 1, user_name: 'Chủ shop', action: 'order.transition', entity: 'order', entity_id: '5', detail_json: '{"to":"PACKED"}', created_at: '2026-11-13 01:00:00' }]),
    });
    open('/cai-dat/nhat-ky');
    expect(await screen.findByText('order.transition')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Đối tượng'), { target: { value: 'order' } });
    await waitFor(() => expect(calls.some((c) => c.path === '/audit-logs' && c.query.get('entity') === 'order')).toBe(true));
  });

  it('hiện bản sao lưu gần nhất; chưa có thì báo chưa có', async () => {
    stubApi('ADMIN', {
      'GET /backup/latest': () => ({ key: 'backups/2026-11-12.json.gz', uploaded: '2026-11-12T19:00:05.000Z', size: 51200 }),
    });
    open('/cai-dat/sao-luu');
    const info = await screen.findByText(/Bản sao lưu gần nhất:/);
    expect(info.textContent).toContain('backups/2026-11-12.json.gz');
    expect(info.textContent).toContain('13/11/2026');
    expect(info.textContent).toContain('50 KB');
  });

  it('chưa có bản sao lưu nào', async () => {
    stubApi('ADMIN', { 'GET /backup/latest': () => null });
    open('/cai-dat/sao-luu');
    expect(await screen.findByText(/Bản sao lưu gần nhất: chưa có/)).toBeTruthy();
  });

  it('"Sao lưu ngay" hiện khoá tệp và dung lượng KB', async () => {
    const calls = stubApi('ADMIN', {
      'POST /backup/run': () => ({ key: 'backups/2026-11-13.json.gz', bytes: 20480 }),
      'GET /backup/latest': () => null,
    });
    open('/cai-dat/sao-luu');
    fireEvent.click(await screen.findByRole('button', { name: /Sao lưu ngay/ }));
    const info = await screen.findByText(/20 KB/);
    expect(info.textContent).toContain('backups/2026-11-13.json.gz');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/backup/run')).toBe(true);
    await waitFor(() => expect(calls.filter((c) => c.path === '/backup/latest').length).toBeGreaterThan(1));
  });

  it('STAFF mở thẳng /cai-dat/tai-khoan thấy Không có quyền', async () => {
    stubApi('STAFF', {});
    open('/cai-dat/tai-khoan');
    expect(await screen.findByRole('heading', { name: 'Không có quyền' })).toBeTruthy();
  });
});
