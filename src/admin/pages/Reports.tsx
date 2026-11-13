import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Field, inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { apiFetch, errorMessage } from '../lib/api';
import { formatNumber, formatVnd, todayVn } from '../lib/format';
import { CHANNEL_LABELS } from '../lib/orderFlow';
import { marginPercent, salesSheetRows, topSheetRows, type SalesRow, type TopProductRow } from './reports/sheets';

const ReportChart = lazy(() => import('./reports/ReportChart'));

type PeriodGroup = 'day' | 'week' | 'month';
const GROUP_LABELS: Record<PeriodGroup, string> = { day: 'Theo ngày', week: 'Theo tuần', month: 'Theo tháng' };

const moneyCols = (first: Column<SalesRow>[]): Column<SalesRow>[] => [
  ...first,
  { key: 'orders', header: 'Số đơn', align: 'right', cell: (r) => formatNumber(r.orders) },
  { key: 'returns', header: 'Đơn trả', align: 'right', cell: (r) => formatNumber(r.returns) },
  { key: 'revenue_vnd', header: 'Doanh thu', align: 'right', cell: (r) => formatVnd(r.revenue_vnd) },
  { key: 'cost_total_vnd', header: 'Giá vốn', align: 'right', cell: (r) => formatVnd(r.cost_total_vnd) },
  { key: 'gross_profit_vnd', header: 'Lãi gộp', align: 'right', cell: (r) => formatVnd(r.gross_profit_vnd) },
  { key: 'gross_margin', header: 'Biên lãi gộp', align: 'right', cell: (r) => `${marginPercent(r.gross_margin).toLocaleString('vi-VN')}%` },
];

const PERIOD_COLS = moneyCols([{ key: 'key', header: 'Kỳ', cell: (r) => <span className="font-medium text-fg">{r.key}</span> }]);
const CHANNEL_COLS = moneyCols([
  { key: 'key', header: 'Kênh', cell: (r) => <span className="font-medium text-fg">{CHANNEL_LABELS[r.key] ?? r.key}</span> },
]);
const PRODUCT_COLS = moneyCols([
  { key: 'key', header: 'SKU' },
  { key: 'name', header: 'Sản phẩm', cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
]);
const TOP_COLS: Column<TopProductRow>[] = [
  { key: 'sku', header: 'SKU' },
  { key: 'name', header: 'Sản phẩm', cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
  { key: 'quantity', header: 'Số lượng bán', align: 'right', cell: (r) => formatNumber(r.quantity) },
  { key: 'revenue_vnd', header: 'Doanh thu', align: 'right', cell: (r) => formatVnd(r.revenue_vnd) },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

const noop = () => undefined;
const fixed = (n: number) => ({ total: n, page: 1, pageSize: Math.max(n, 1), onPageChange: noop });

function useSales(from: string, to: string, group: string, enabled: boolean) {
  return useQuery({
    queryKey: ['/reports/sales', { from, to, group }],
    enabled,
    queryFn: ({ signal }) => apiFetch<SalesRow[]>('/reports/sales', { query: { from, to, group }, signal }),
  });
}

/** Báo cáo bán hàng (ADMIN): biểu đồ doanh thu/lãi, bảng theo kỳ, kênh, sản phẩm, top sản phẩm, xuất Excel. */
export function Reports() {
  const toast = useToast();
  const [from, setFrom] = useState(() => `${todayVn().slice(0, 8)}01`);
  const [to, setTo] = useState(() => todayVn());
  const [group, setGroup] = useState<PeriodGroup>('day');
  const [variant, setVariant] = useState<'line' | 'bar'>('line');
  const [exporting, setExporting] = useState(false);

  const rangeError = !from || !to ? 'Chọn đủ ngày bắt đầu và kết thúc.' : from > to ? 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.' : '';
  const ok = !rangeError;
  const period = useSales(from, to, group, ok);
  const channel = useSales(from, to, 'channel', ok);
  const product = useSales(from, to, 'product', ok);
  const top = useQuery({
    queryKey: ['/reports/top-products', { from, to }],
    enabled: ok,
    queryFn: ({ signal }) => apiFetch<TopProductRow[]>('/reports/top-products', { query: { from, to, limit: 10 }, signal }),
  });

  const error = [period, channel, product, top].find((q) => q.isError)?.error;
  const ready = !!(period.data && channel.data && product.data && top.data);
  const loading = period.isFetching || channel.isFetching || product.isFetching || top.isFetching;

  const exportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      const add = (name: string, rows: object[]) => XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name);
      add(GROUP_LABELS[group].replace('Theo ', 'Kỳ - '), salesSheetRows('period', period.data ?? []));
      add('Theo kênh', salesSheetRows('channel', channel.data ?? []));
      add('Theo sản phẩm', salesSheetRows('product', product.data ?? []));
      add('Top sản phẩm', topSheetRows(top.data ?? []));
      XLSX.writeFile(book, `bao-cao_${from}_${to}.xlsx`);
    } catch (e) {
      toast.error(e, { action: { label: 'Thử lại', onClick: () => void exportExcel() } });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Báo cáo"
        description="Doanh thu ghi nhận lúc xuất kho (không gồm phí ship); đơn trả hàng trừ vào ngày trả."
        actions={
          <Button variant="secondary" onClick={() => void exportExcel()} loading={exporting} disabled={!ok || !ready}>
            <Download size={16} aria-hidden /> Xuất Excel
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Từ ngày" htmlFor="rp-from">
          <input id="rp-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Đến ngày" htmlFor="rp-to">
          <input id="rp-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nhóm theo" htmlFor="rp-group">
          <select id="rp-group" value={group} onChange={(e) => setGroup(e.target.value as PeriodGroup)} className={inputClass}>
            {(Object.keys(GROUP_LABELS) as PeriodGroup[]).map((g) => (
              <option key={g} value={g}>
                {GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Biểu đồ" htmlFor="rp-variant">
          <select id="rp-variant" value={variant} onChange={(e) => setVariant(e.target.value as 'line' | 'bar')} className={inputClass}>
            <option value="line">Đường</option>
            <option value="bar">Cột</option>
          </select>
        </Field>
      </div>
      {ok && !ready && !error && (
        <p className="mt-3 text-sm text-muted">Nút Xuất Excel sẽ mở khi tải xong mọi bảng.</p>
      )}
      {rangeError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {rangeError}
        </p>
      )}
      {!!error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage(error)} Chưa thể xuất Excel cho đến khi tải đủ dữ liệu.
        </p>
      )}

      {ok && (
        <>
          <Section title="Doanh thu và lãi gộp">
            <div className="rounded-xl border border-line bg-surface p-4">
              <Suspense fallback={<p className="py-10 text-center text-sm text-muted">Đang tải biểu đồ…</p>}>
                {period.data && period.data.length > 0 ? (
                  <ReportChart rows={period.data} variant={variant} />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">{period.isFetching ? 'Đang tải…' : 'Chưa có doanh thu trong khoảng này.'}</p>
                )}
              </Suspense>
            </div>
          </Section>
          <Section title={`Bảng ${GROUP_LABELS[group].toLowerCase()}`}>
            <DataTable columns={PERIOD_COLS} rows={period.data ?? []} rowKey={(r) => r.key} loading={loading} {...fixed(period.data?.length ?? 0)} />
          </Section>
          <Section title="Theo kênh bán">
            <DataTable columns={CHANNEL_COLS} rows={channel.data ?? []} rowKey={(r) => r.key} loading={loading} {...fixed(channel.data?.length ?? 0)} />
          </Section>
          <Section title="Theo sản phẩm">
            <DataTable columns={PRODUCT_COLS} rows={product.data ?? []} rowKey={(r) => r.key} loading={loading} {...fixed(product.data?.length ?? 0)} />
          </Section>
          <Section title="Top 10 sản phẩm bán chạy">
            <DataTable columns={TOP_COLS} rows={top.data ?? []} rowKey={(r) => r.sku} loading={loading} {...fixed(top.data?.length ?? 0)} />
          </Section>
        </>
      )}
    </>
  );
}
