import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/admin/components/ConfirmDialog';
import { FormDialog } from '../../src/admin/components/FormDialog';
import { MoneyInput } from '../../src/admin/components/MoneyInput';
import { ToastProvider, useToast } from '../../src/admin/components/Toast';
import { useTheme } from '../../src/admin/lib/theme';

function FormWithConfirm() {
  const [formOpen, setFormOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setFormOpen(true)}>
        Mở form
      </button>
      <FormDialog open={formOpen} title="Thêm khách hàng" onClose={() => setFormOpen(false)} onSubmit={() => {}}>
        <label htmlFor="ten">Tên</label>
        <input id="ten" />
        <button type="button" onClick={() => setConfirmOpen(true)}>
          Xoá dòng
        </button>
      </FormDialog>
      <ConfirmDialog
        open={confirmOpen}
        title="Xoá dòng?"
        message="Không hoàn tác được."
        danger
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

describe('Modal / FormDialog / ConfirmDialog', () => {
  it('Tab và Shift+Tab chỉ chạy vòng trong hộp thoại', () => {
    render(<FormWithConfirm />);
    fireEvent.click(screen.getByText('Mở form'));
    const dialog = screen.getByRole('dialog', { name: 'Thêm khách hàng' });
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(last.textContent).toBe('Lưu');

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Esc chỉ đóng hộp trên cùng; form giữ giá trị đã gõ; focus về nút đã mở', () => {
    render(<FormWithConfirm />);
    const opener = screen.getByText('Mở form');
    opener.focus();
    fireEvent.click(opener);
    const input = screen.getByLabelText('Tên') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Nguyễn Văn A' } });

    const deleteBtn = screen.getByText('Xoá dòng');
    deleteBtn.focus();
    fireEvent.click(deleteBtn);
    expect(screen.getByRole('dialog', { name: 'Xoá dòng?' })).toBeTruthy();
    // danger: focus ban đầu ở nút Huỷ của hộp xác nhận
    expect(document.activeElement?.textContent).toBe('Huỷ');
    expect(screen.getByRole('dialog', { name: 'Xoá dòng?' }).contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Xoá dòng?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Thêm khách hàng' })).toBeTruthy();
    expect((screen.getByLabelText('Tên') as HTMLInputElement).value).toBe('Nguyễn Văn A');
    expect(document.activeElement).toBe(deleteBtn);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

function ToastDemo({ onRetry }: { onRetry: () => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.error('Không kết nối được máy chủ.', { action: { label: 'Thử lại', onClick: onRetry } })}
    >
      Gây lỗi
    </button>
  );
}

describe('Toast', () => {
  it('lỗi dùng role="alert" và có nút thao tác "Thử lại"', () => {
    const onRetry = vi.fn();
    render(
      <ToastProvider>
        <ToastDemo onRetry={onRetry} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Gây lỗi'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Không kết nối được máy chủ.');

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

function MoneyHarness({ initial }: { initial: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return <MoneyInput value={v} onChange={setV} />;
}

describe('MoneyInput', () => {
  it('giữ vị trí con trỏ theo chữ số khi dấu chấm nhóm thay đổi', () => {
    render(<MoneyHarness initial={1234567} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('1.234.567');
    input.focus();
    // Gõ "8" sau "1.2": "1.2834.567", con trỏ sau chữ 8 (vị trí 4).
    fireEvent.change(input, { target: { value: '1.2834.567', selectionStart: 4, selectionEnd: 4 } });
    expect(input.value).toBe('12.834.567');
    expect(input.selectionStart).toBe(4); // "12.8|34.567"
  });

  it('Backspace ngay sau dấu chấm xoá chữ số trước nó', () => {
    render(<MoneyHarness initial={1234} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('1.234');
    input.focus();
    input.setSelectionRange(2, 2); // "1.|234"
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.value).toBe('234');
    expect(input.selectionStart).toBe(0);
  });
});

function ThemeHarness() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      {theme}
    </button>
  );
}

describe('useTheme', () => {
  it('không ghi localStorage khi mở trang, chỉ ghi khi người dùng bấm đổi', () => {
    localStorage.removeItem('vk_admin_theme');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<ThemeHarness />);
    expect(setItem).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(setItem).toHaveBeenCalledWith('vk_admin_theme', 'dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    localStorage.removeItem('vk_admin_theme');
    document.documentElement.classList.remove('dark');
  });
});
