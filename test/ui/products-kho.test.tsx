import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const xlsx = vi.hoisted(() => ({
  utils: { json_to_sheet: vi.fn(() => ({ sheet: true })), book_new: vi.fn(() => ({ book: true })), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));
vi.mock('xlsx', () => xlsx);

import { App } from '../../src/admin/App';

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

const product = (over: Record<string, unknown> = {}) => ({
  sku: 'VK-001',
  name: 'Nước tăng lực',
  slug: 'nuoc-tang-luc',
  price_vnd: 150000,
  listed_price_vnd: 180000,
  wholesale_price_vnd: null,
  unit: 'chai',
  category: 'Đồ uống',
  min_stock: 10,
  shelf_label: '',
  is_active: 1,
  is_combo: 0,
  image_url: '',
  gallery_json: '[]',
  description: '',
  batch_code: '',
  expiry_date: '',
  stock_qty: 20,
  reserved_qty: 2,
  available: 18,
  bom: [],
  ...over,
});

/** Máy chủ giả cho ProductPicker: một sản phẩm, có thể bán = `available`. */
const pickerRoutes = (available: number, stock = 12): Record<string, Handler> => ({
  'GET /inventory': () =>
    list([
      {
        sku: 'VK-001',
        name: 'Nước tăng lực',
        unit: 'chai',
        min_stock: 10,
        is_combo: 0,
        is_active: 1,
        stock,
        reserved: stock - available,
        available,
      },
    ]),
  'GET /products': () => list([{ sku: 'VK-001', price_vnd: 150000, wholesale_price_vnd: null }]),
});

async function pickProduct() {
  fireEvent.focus(await screen.findByLabelText('Tìm sản phẩm'));
  fireEvent.click(await screen.findByRole('button', { name: /Nước tăng lực/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm' }));
}

beforeEach(() => {
  window.history.pushState({}, '', '/quan-tri');
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('Sản phẩm', () => {
  it('thêm sản phẩm gửi đúng nội dung; STAFF không thấy ô giá vốn', async () => {
    const calls = stubApi('STAFF', {
      'POST /products': (c) => product({ ...c.body, bom: [] }),
    });
    open('/san-pham/moi');

    expect(await screen.findByRole('heading', { name: 'Thêm sản phẩm' })).toBeTruthy();
    expect(screen.queryByText(/Giá vốn/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: 'vk-test' } });
    fireEvent.change(screen.getByLabelText(/^Tên sản phẩm/), { target: { value: 'Nước ép Đào' } });
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe('nuoc-ep-dao');
    fireEvent.change(screen.getByLabelText(/^Giá bán lẻ/), { target: { value: '150000' } });
    fireEvent.change(screen.getByLabelText(/^Giá niêm yết/), { target: { value: '180000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm sản phẩm' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/products')).toBe(true));
    const body = calls.find((c) => c.method === 'POST')?.body;
    expect(body).toMatchObject({
      sku: 'VK-TEST',
      name: 'Nước ép Đào',
      slug: 'nuoc-ep-dao',
      price_vnd: 150000,
      listed_price_vnd: 180000,
      wholesale_price_vnd: null,
      unit: 'chai',
      min_stock: 10,
      is_active: 1,
      is_combo: 0,
      gallery_json: '[]',
    });
    expect(body).not.toHaveProperty('cost_avg_vnd');
  });

  it('giá vốn bình quân chỉ hiện cho ADMIN và chỉ khi API trả về', async () => {
    stubApi('ADMIN', { 'GET /products/VK-001': () => product({ cost_avg_vnd: 82500 }) });
    open('/san-pham/VK-001');
    expect(await screen.findByText('Giá vốn bình quân')).toBeTruthy();
    expect(screen.getByText('82.500 ₫')).toBeTruthy();
    expect((screen.getByLabelText(/^SKU/) as HTMLInputElement).readOnly).toBe(true);
  });

  it('STAFF sửa sản phẩm: không có giá vốn dù ô tồn vẫn hiện', async () => {
    stubApi('STAFF', { 'GET /products/VK-001': () => product() });
    open('/san-pham/VK-001');
    expect(await screen.findByText('Tồn thực tế')).toBeTruthy();
    expect(screen.queryByText(/Giá vốn/)).toBeNull();
  });

  it('BOM 409 BOM_IN_USE hiện thông báo tiếng Việt rõ ràng', async () => {
    const message = 'Combo đang có đơn chưa hoàn tất (đã giữ hàng hoặc đang giao), chưa thể đổi thành phần.';
    const calls = stubApi('ADMIN', {
      'GET /products/COMBO-1': () =>
        product({
          sku: 'COMBO-1',
          name: 'Combo quà tặng',
          is_combo: 1,
          bom: [{ component_sku: 'VK-001', component_name: 'Nước tăng lực', qty_per_combo: 2 }],
        }),
      'PUT /products/COMBO-1/bom': () => apiError(409, 'BOM_IN_USE', message, { pending_orders: 1 }),
    });
    open('/san-pham/COMBO-1');

    fireEvent.change(await screen.findByLabelText('Số lượng VK-001 mỗi combo'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thành phần' }));

    const alert = await screen.findAllByText(`Không thể đổi thành phần: ${message}`);
    expect(alert.length).toBeGreaterThan(0);
    expect(calls.find((c) => c.path === '/products/COMBO-1/bom')?.body).toEqual({
      items: [{ component_sku: 'VK-001', qty_per_combo: 3 }],
    });
  });
});

describe('Tồn kho', () => {
  const inv = [
    { sku: 'VK-001', name: 'Nước tăng lực', unit: 'chai', min_stock: 10, is_combo: 0, stock: 20, reserved: 15, available: 5 },
  ];

  it('hiện thực tế/đang giữ/có thể bán, lọc sắp hết hàng gửi low=1, STAFF không có giá vốn', async () => {
    const calls = stubApi('STAFF', {
      'GET /inventory': () => list(inv),
      'GET /inventory/alerts': () => ({ low_stock: [{ ...inv[0] }], expiring: [] }),
    });
    open('/kho');

    expect(await screen.findByRole('columnheader', { name: 'Tồn thực tế' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Đang giữ' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Có thể bán' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /Giá vốn/ })).toBeNull();
    expect(await screen.findByRole('region', { name: 'Cảnh báo kho' })).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Sắp hết hàng'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/inventory' && c.query.get('low') === '1')).toBe(true),
    );
  });
});

describe('Phiếu kho', () => {
  it('phiếu nhập: tạo nháp rồi ghi sổ gọi đúng thứ tự; không chặn theo số có thể bán', async () => {
    const calls = stubApi('ADMIN', {
      ...pickerRoutes(0),
      'GET /suppliers': () => list([{ id: 3, name: 'Công ty ABC' }]),
      'POST /stock-docs': (c) => ({ id: 7, code: 'PN261113-AB12', type: 'RECEIPT', status: 'DRAFT', lines: [], ...c.body }),
      'POST /stock-docs/7/post': () => ({
        id: 7,
        code: 'PN261113-AB12',
        type: 'RECEIPT',
        status: 'POSTED',
        supplier_id: 3,
        note: '',
        created_at: '2026-11-13 01:00:00',
        posted_at: '2026-11-13 01:01:00',
        lines: [{ sku: 'VK-001', product_name: 'Nước tăng lực', qty: 10, unit_cost_vnd: 50000, batch_code: 'L1', expiry_date: '' }],
      }),
    });
    open('/kho/phieu/moi?type=RECEIPT');

    await pickProduct(); // có thể bán = 0 nhưng vẫn thêm được
    fireEvent.change(await screen.findByLabelText('Số lượng VK-001'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('Đơn giá'), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText('Mã lô VK-001'), { target: { value: 'L1' } });
    fireEvent.change(await screen.findByLabelText('Nhà cung cấp'), { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ghi sổ' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ghi sổ' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/stock-docs/7/post')).toBe(true));
    const writes = calls.filter((c) => c.method !== 'GET' || c.path.startsWith('/stock-docs'));
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /stock-docs', 'POST /stock-docs/7/post']);
    expect(writes[0].body).toEqual({
      type: 'RECEIPT',
      supplier_id: 3,
      note: '',
      lines: [{ sku: 'VK-001', qty: 10, unit_cost_vnd: 50000, batch_code: 'L1', expiry_date: '' }],
    });
    expect(await screen.findByText('Đã ghi sổ')).toBeTruthy();
  });

  it('phiếu kiểm kê điền sẵn tồn hệ thống và hiện chênh lệch', async () => {
    const calls = stubApi('ADMIN', {
      ...pickerRoutes(10, 12),
      'POST /stock-docs': (c) => ({ id: 9, code: 'KK261113-ZZ99', type: 'STOCKTAKE', status: 'DRAFT', lines: [], ...c.body }),
    });
    open('/kho/phieu/moi?type=STOCKTAKE');

    await pickProduct();
    await waitFor(() => expect(screen.getByLabelText('Tồn hệ thống VK-001').textContent).toBe('12'));
    fireEvent.change(screen.getByLabelText('Số đếm VK-001'), { target: { value: '9' } });
    expect(screen.getByLabelText('Chênh lệch VK-001').textContent).toBe('-3');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/stock-docs')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'STOCKTAKE',
      supplier_id: null,
      note: '',
      lines: [{ sku: 'VK-001', counted_qty: 9 }],
    });
  });

  it('huỷ phiếu nháp qua hộp xác nhận', async () => {
    const draft = {
      id: 5,
      code: 'PX261113-AAAA',
      type: 'ISSUE',
      status: 'DRAFT',
      supplier_id: null,
      note: '',
      created_at: '2026-11-13 01:00:00',
      posted_at: null,
      lines: [{ sku: 'VK-001', product_name: 'Nước tăng lực', qty: 2, batch_code: '', expiry_date: '', counted_qty: null }],
    };
    let current = draft;
    const calls = stubApi('ADMIN', {
      'GET /stock-docs/5': () => current,
      'POST /stock-docs/5/cancel': () => (current = { ...draft, status: 'CANCELLED' }),
    });
    open('/kho/phieu/5');

    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ phiếu' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ phiếu' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/stock-docs/5/cancel')).toBe(true));
    expect(await screen.findByText('Đã huỷ')).toBeTruthy();
  });
});

describe('Nhập-xuất-tồn', () => {
  const rows = [
    { sku: 'VK-001', name: 'Nước tăng lực', opening: 5, received: 10, sold_out: 3, other_out: 1, adjusted: -1, closing: 10 },
    { sku: 'VK-002', name: 'Trà đào', opening: 0, received: 4, sold_out: 0, other_out: 0, adjusted: 0, closing: 4 },
  ];

  it('xuất Excel đúng các dòng đang hiển thị, số giữ dạng số', async () => {
    const calls = stubApi('STAFF', { 'GET /reports/stock-movement': () => rows });
    open('/kho/nhap-xuat-ton');

    expect(await screen.findByText('Trà đào')).toBeTruthy();
    const range = calls.find((c) => c.path === '/reports/stock-movement');
    expect(range?.query.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(range?.query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    await waitFor(() => expect(xlsx.writeFile).toHaveBeenCalledTimes(1));
    expect(xlsx.utils.json_to_sheet).toHaveBeenCalledWith([
      { SKU: 'VK-001', 'Tên sản phẩm': 'Nước tăng lực', 'Tồn đầu': 5, Nhập: 10, 'Bán ra': 3, 'Xuất khác': 1, 'Điều chỉnh': -1, 'Tồn cuối': 10 },
      { SKU: 'VK-002', 'Tên sản phẩm': 'Trà đào', 'Tồn đầu': 0, Nhập: 4, 'Bán ra': 0, 'Xuất khác': 0, 'Điều chỉnh': 0, 'Tồn cuối': 4 },
    ]);
    expect(xlsx.writeFile.mock.calls[0][1]).toMatch(/^nhap-xuat-ton_\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
