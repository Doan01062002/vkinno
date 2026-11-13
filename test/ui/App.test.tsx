import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/admin/App';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubMe(user: { role: 'ADMIN' | 'STAFF' } | null) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/admin/auth/me')) {
      return user
        ? json(200, { ok: true, data: { id: 1, email: 'a@vkinno.local', name: 'Người dùng A', ...user } })
        : json(401, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Vui lòng đăng nhập.' } });
    }
    if (url.startsWith('/api/admin/auth/login')) {
      return json(401, { ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
    }
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy.' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('App quản trị', () => {
  it('chưa đăng nhập thì về trang đăng nhập; sai mật khẩu báo lỗi tiếng Việt', async () => {
    stubMe(null);
    window.history.pushState({}, '', '/quan-tri/don-hang');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Đăng nhập quản trị' })).toBeTruthy();
    expect(window.location.pathname).toBe('/quan-tri/dang-nhap');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@vkinno.local' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'sai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText('Email hoặc mật khẩu không đúng.')).toBeTruthy();
  });

  it('STAFF không thấy Báo cáo/Cài đặt và bị chuyển khỏi /bao-cao', async () => {
    stubMe({ role: 'STAFF' });
    window.history.pushState({}, '', '/quan-tri/bao-cao');
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/quan-tri/tong-quan'));
    const nav = await screen.findByRole('navigation', { name: 'Menu chính' });
    expect(nav.textContent).toContain('Đơn hàng');
    expect(nav.textContent).not.toContain('Báo cáo');
    expect(nav.textContent).not.toContain('Cài đặt');
  });

  it('ADMIN thấy đủ menu và mở thẳng đường dẫn sâu', async () => {
    stubMe({ role: 'ADMIN' });
    window.history.pushState({}, '', '/quan-tri/cai-dat');
    render(<App />);

    const nav = await screen.findByRole('navigation', { name: 'Menu chính' });
    expect(nav.textContent).toContain('Báo cáo');
    expect(nav.textContent).toContain('Cài đặt');
    expect(window.location.pathname).toBe('/quan-tri/cai-dat');
    expect(screen.getByRole('heading', { name: 'Cài đặt' })).toBeTruthy();
  });

  it('mất mạng khi tải /auth/me: không về đăng nhập, hiện "Thử lại"; thử lại được thì vào app', async () => {
    let online = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (url.startsWith('/api/admin/auth/me')) {
        return json(200, { ok: true, data: { id: 1, email: 'a@vkinno.local', name: 'Người dùng A', role: 'ADMIN' } });
      }
      return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy.' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/quan-tri/don-hang');
    render(<App />);

    const retry = await screen.findByRole('button', { name: 'Thử lại' }, { timeout: 4000 });
    expect(screen.getByRole('alert').textContent).toMatch(/kết nối/);
    expect(window.location.pathname).toBe('/quan-tri/don-hang');
    expect(fetchMock.mock.calls.length).toBe(2); // shouldRetry: thử lại 1 lần với lỗi mạng

    online = true;
    fireEvent.click(retry);
    expect(await screen.findByRole('navigation', { name: 'Menu chính' })).toBeTruthy();
    expect(window.location.pathname).toBe('/quan-tri/don-hang');
  });

  it('ngăn kéo menu: mở thì focus vào trong, Esc đóng và trả focus về nút mở menu', async () => {
    stubMe({ role: 'ADMIN' });
    window.history.pushState({}, '', '/quan-tri/tong-quan');
    render(<App />);

    const menuButton = await screen.findByRole('button', { name: 'Mở menu' });
    fireEvent.click(menuButton);
    const closeButton = screen.getByRole('button', { name: 'Đóng menu' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đóng menu' })).toBeNull());
    expect(document.activeElement).toBe(menuButton);
  });
});
