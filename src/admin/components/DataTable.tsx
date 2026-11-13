import { ChevronLeft, ChevronRight, Inbox, Loader2, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ListResult } from '../lib/api';
import { formatNumber } from '../lib/format';
import { inputClass } from './Field';

export interface Column<T> {
  /** Khoá cột; khi không có `cell` thì hiển thị `row[key]`. */
  key: string;
  header: ReactNode;
  /** Nội dung ô tuỳ biến. */
  cell?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Lớp thêm cho cả `<th>` và `<td>` (vd. độ rộng). */
  className?: string;
}

export interface DataTableSearch {
  /** Giá trị đang áp dụng (từ state của trang). */
  value: string;
  /** Gọi sau khi người dùng ngừng gõ `delay` ms (mặc định 300). */
  onChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Khoá React cho dòng; mặc định `row.id` hoặc chỉ số. */
  rowKey?: (row: T, index: number) => string | number;
  /** Tổng số dòng phía máy chủ. */
  total: number;
  /** Trang hiện tại (bắt đầu từ 1). */
  page: number;
  /** Số dòng mỗi trang (mặc định 50, khớp API). */
  pageSize?: number;
  onPageChange: (page: number) => void;
  /** Ô tìm kiếm phía máy chủ (có debounce). */
  search?: DataTableSearch;
  /** Bộ lọc (select, ngày…) đặt cạnh ô tìm kiếm. */
  filters?: ReactNode;
  /** Nút thao tác bên phải thanh công cụ (vd. "Thêm mới"). */
  actions?: ReactNode;
  loading?: boolean;
  /** Nội dung khi không có dòng nào (mặc định "Chưa có dữ liệu"). */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

/** Chuyển `{items,total,page,page_size}` sang props của DataTable: `<DataTable {...listProps(data)} …/>`. */
export function listProps<T>(data: ListResult<T> | undefined): {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
} {
  return {
    rows: data?.items ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    pageSize: data?.page_size ?? 50,
  };
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function SearchBox({ search }: { search: DataTableSearch }) {
  const [text, setText] = useState(search.value);
  const onChangeRef = useRef(search.onChange);
  onChangeRef.current = search.onChange;
  const delay = search.delay ?? 300;

  // Giá trị đổi từ bên ngoài (vd. xoá bộ lọc) thì đồng bộ ô nhập; giữ khoảng trắng người dùng đang gõ.
  useEffect(() => setText((prev) => (prev.trim() === search.value ? prev : search.value)), [search.value]);

  useEffect(() => {
    if (text.trim() === search.value) return;
    const t = setTimeout(() => onChangeRef.current(text.trim()), delay);
    return () => clearTimeout(t);
  }, [text, search.value, delay]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={search.placeholder ?? 'Tìm kiếm…'}
        aria-label={search.placeholder ?? 'Tìm kiếm'}
        className={`${inputClass} pl-9`}
      />
    </div>
  );
}

/**
 * Bảng dữ liệu phân trang phía máy chủ: thanh công cụ (tìm/lọc/thao tác), trạng thái tải/rỗng,
 * phân trang. Màn hình hẹp (390px) cuộn ngang trong khung bảng.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize = 50,
  onPageChange,
  search,
  filters,
  actions,
  loading = false,
  empty,
  onRowClick,
}: DataTableProps<T>) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const keyOf = (row: T, i: number) =>
    rowKey ? rowKey(row, i) : ((row as { id?: string | number }).id ?? i);
  const showToolbar = search || filters || actions;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {showToolbar && (
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {search && <SearchBox search={search} />}
            {filters}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle/60">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-4 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-line last:border-b-0 ${onRowClick ? 'cursor-pointer hover:bg-subtle' : ''} ${loading ? 'opacity-60' : ''}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle text-fg ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}>
                    {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-sm text-muted">
            {loading ? (
              <>
                <Loader2 size={22} className="animate-spin" aria-hidden />
                <span>Đang tải…</span>
              </>
            ) : (
              <>
                <Inbox size={28} aria-hidden />
                <span>{empty ?? 'Chưa có dữ liệu'}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>
          {total === 0 ? 'Không có kết quả' : `Hiển thị ${formatNumber(from)}–${formatNumber(to)} / ${formatNumber(total)}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Trang trước"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-fg hover:bg-subtle disabled:opacity-40"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span className="min-w-[90px] text-center whitespace-nowrap">{`Trang ${page} / ${pageCount}`}</span>
          <button
            type="button"
            aria-label="Trang sau"
            disabled={page >= pageCount || loading}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-fg hover:bg-subtle disabled:opacity-40"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
