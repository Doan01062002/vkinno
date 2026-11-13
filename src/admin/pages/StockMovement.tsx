import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { apiFetch } from '../lib/api';
import { formatNumber, todayVn } from '../lib/format';
import { KhoTabs } from './kho/KhoTabs';

export interface MovementRow {
  sku: string;
  name: string;
  opening: number;
  received: number;
  sold_out: number;
  other_out: number;
  adjusted: number;
  closing: number;
}

/** Hàng xuất Excel: đúng các cột và dòng đang hiển thị, số giữ dạng số. */
export function movementSheetRows(rows: MovementRow[]) {
  return rows.map((r) => ({
    SKU: r.sku,
    'Tên sản phẩm': r.name,
    'Tồn đầu': r.opening,
    Nhập: r.received,
    'Bán ra': r.sold_out,
    'Xuất khác': r.other_out,
    'Điều chỉnh': r.adjusted,
    'Tồn cuối': r.closing,
  }));
}

const COLUMNS: { key: keyof MovementRow; header: string }[] = [
  { key: 'opening', header: 'Tồn đầu' },
  { key: 'received', header: 'Nhập' },
  { key: 'sold_out', header: 'Bán ra' },
  { key: 'other_out', header: 'Xuất khác' },
  { key: 'adjusted', header: 'Điều chỉnh' },
  { key: 'closing', header: 'Tồn cuối' },
];

/** Nhập-xuất-tồn theo kỳ (mặc định từ đầu tháng đến hôm nay, giờ Việt Nam). */
export function StockMovement() {
  const toast = useToast();
  const today = todayVn();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [exporting, setExporting] = useState(false);
  const rangeError = !from || !to ? 'Vui lòng chọn khoảng ngày.' : from > to ? 'Từ ngày phải trước hoặc bằng đến ngày.' : '';

  const query = useQuery({
    queryKey: ['/reports/stock-movement', from, to],
    enabled: !rangeError,
    queryFn: () => apiFetch<MovementRow[]>('/reports/stock-movement', { query: { from, to } }),
  });
  const rows = !rangeError ? (query.data ?? []) : [];

  const exportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(movementSheetRows(rows));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Nhập-xuất-tồn');
      XLSX.writeFile(book, `nhap-xuat-ton_${from}_${to}.xlsx`);
    } catch (e) {
      toast.error(e, { action: { label: 'Thử lại', onClick: () => void exportExcel() } });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Kho"
        description="Tồn đầu, nhập, bán ra, xuất khác, điều chỉnh và tồn cuối theo kỳ."
        actions={
          <Button variant="secondary" loading={exporting} disabled={rows.length === 0 || exporting} onClick={() => void exportExcel()}>
            <Download size={16} aria-hidden />
            Xuất Excel
          </Button>
        }
      />
      <KhoTabs />
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Field label="Từ ngày" htmlFor="mv-from">
          <input id="mv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Đến ngày" htmlFor="mv-to" error={rangeError}>
          <input id="mv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {query.isError && !rangeError ? (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          Không tải được báo cáo.{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-subtle">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted">Sản phẩm</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right text-xs font-medium whitespace-nowrap text-muted">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-muted">
                    {query.isFetching ? 'Đang tải…' : 'Không có dữ liệu trong kỳ này'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.sku}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-fg">{r.name}</p>
                      <p className="text-xs text-muted">{r.sku}</p>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(r[c.key] as number)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
