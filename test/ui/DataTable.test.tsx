import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '../../src/admin/components/DataTable';

interface Row {
  id: number;
  name: string;
  total_vnd: number;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'Tên' },
  { key: 'total_vnd', header: 'Tổng tiền', align: 'right', cell: (r) => `${r.total_vnd} ₫` },
];

describe('DataTable', () => {
  it('DataTable hiển thị trạng thái rỗng và chuyển trang', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} total={0} page={1} onPageChange={onPageChange} empty="Chưa có đơn hàng" />,
    );
    expect(screen.getByText('Chưa có đơn hàng')).toBeTruthy();

    const rows: Row[] = [
      { id: 1, name: 'Đơn A', total_vnd: 1000 },
      { id: 2, name: 'Đơn B', total_vnd: 2000 },
    ];
    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        total={120}
        page={1}
        pageSize={50}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.queryByText('Chưa có đơn hàng')).toBeNull();
    expect(screen.getAllByText('Đơn A').length).toBeGreaterThan(0);
    expect(screen.getByText('Trang 1 / 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('đang tải thì hiện thông báo tải, không hiện trạng thái rỗng', () => {
    render(<DataTable columns={columns} rows={[]} total={0} page={1} onPageChange={() => {}} loading />);
    expect(screen.getByText('Đang tải…')).toBeTruthy();
    expect(screen.queryByText('Chưa có dữ liệu')).toBeNull();
  });

  it('ô tìm kiếm gọi onChange sau khi ngừng gõ', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[]}
        total={0}
        page={1}
        onPageChange={() => {}}
        search={{ value: '', onChange, placeholder: 'Tìm đơn' }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Tìm đơn'), { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(onChange).toHaveBeenCalledWith('abc');
    vi.useRealTimers();
  });
});
