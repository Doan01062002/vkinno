import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field, inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch } from '../lib/api';
import { formatNumber } from '../lib/format';
import {
  loadColumns,
  parseFile,
  previewAll,
  readSheetRows,
  runImport,
  startImport,
  type Channel,
  type ImportOrder,
  type ImportRun,
  type ImportTotals,
  type ParseError,
  type PreviewResult,
  type Progress,
} from './orders/importFlow';
import { SkuMapper } from './orders/SkuMapper';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'TIKTOK', label: 'TikTok Shop' },
];

const MAX_SHOWN_ERRORS = 50;

function ProgressBar({ label, progress }: { label: string; progress: Progress }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div role="status" aria-label={label} className="space-y-1">
      <p className="text-sm text-fg">
        {label}: nhóm {Math.min(progress.done + 1, progress.total)}/{progress.total}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-subtle">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Nhập đơn Shopee/TikTok từ file: chọn sàn → chọn file → xem trước → gán SKU → xác nhận → kết quả. */
export function OrderImport() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const runRef = useRef<ImportRun | null>(null);

  const [channel, setChannel] = useState<Channel>('SHOPEE');
  const [fileName, setFileName] = useState('');
  const [orders, setOrders] = useState<ImportOrder[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewProgress, setPreviewProgress] = useState<Progress | null>(null);
  const [importProgress, setImportProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ImportTotals | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState('');

  const reset = () => {
    setFileName('');
    setOrders([]);
    setParseErrors([]);
    setPreview(null);
    setResult(null);
    setFailure('');
    runRef.current = null;
    if (fileInput.current) fileInput.current.value = '';
  };

  const showError = (e: unknown, retry?: () => void) => {
    setFailure(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : '');
    if (e instanceof ApiClientError && e.status === 0 && retry) {
      toast.error(e, { action: { label: 'Thử lại', onClick: retry } });
    } else toast.error(e instanceof Error && !(e instanceof ApiClientError) ? e.message : e);
  };

  const runPreview = useMutation({
    mutationFn: (list: ImportOrder[]) => previewAll(channel, list, setPreviewProgress),
    onSuccess: (p) => setPreview(p),
    onError: (e, list) => showError(e, () => runPreview.mutate(list)),
    onSettled: () => setPreviewProgress(null),
  });

  const readFile = useMutation({
    mutationFn: async (file: File) => {
      const [rows, columns] = await Promise.all([readSheetRows(file), loadColumns(channel)]);
      if (rows.length === 0) throw new Error('File không có dòng dữ liệu nào.');
      return parseFile(channel, rows, columns);
    },
    onSuccess: (parsed) => {
      setOrders(parsed.orders);
      setParseErrors(parsed.errors);
      if (parsed.orders.length > 0) runPreview.mutate(parsed.orders);
    },
    onError: (e) => showError(e instanceof ApiClientError ? e : new Error('Không đọc được file. Hãy chọn file .xlsx hoặc .csv xuất từ sàn.')),
  });

  const mapSku = useMutation({
    mutationFn: (v: { externalSku: string; sku: string }) =>
      apiFetch('/channel-sku-map', {
        method: 'PUT',
        json: { channel, mappings: [{ external_sku: v.externalSku, sku: v.sku }] },
      }),
    onSuccess: (_r, v) => {
      toast.success(`Đã gán ${v.externalSku} cho ${v.sku}.`);
      setFailure('');
      runPreview.mutate(orders);
    },
    onError: (e, v) => showError(e, () => mapSku.mutate(v)),
  });

  const doImport = useMutation({
    mutationFn: async () => {
      // Tiếp tục đợt đang dở nếu có (sau lỗi mạng); nếu không thì bắt đầu đợt mới.
      const run = runRef.current ?? (runRef.current = startImport(channel, fileName, orders));
      return runImport(run, setImportProgress);
    },
    onSuccess: (totals) => {
      setConfirming(false);
      setFailure('');
      runRef.current = null;
      setResult({ ...totals, errors: [...totals.errors] });
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      void qc.invalidateQueries({ queryKey: ['/customers'] });
      void qc.invalidateQueries({ queryKey: ['product-picker'] });
      void qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/inventory'),
      });
      toast.success(`Đã nhập ${totals.created} đơn.`);
    },
    onError: (e) => {
      setConfirming(false);
      showError(e, () => doImport.mutate());
    },
    onSettled: () => setImportProgress(null),
  });

  const busy = readFile.isPending || runPreview.isPending || mapSku.isPending || doImport.isPending;
  const unmapped = preview?.unmapped_skus ?? [];
  const partial = runRef.current !== null && runRef.current.next > 0;

  return (
    <>
      <PageHeader
        title="Nhập file sàn"
        description="Nhập đơn từ file xuất của Shopee hoặc TikTok Shop. Đơn đã có (trùng mã sàn) được bỏ qua."
        actions={
          <Link to="/don-hang" className={buttonClass('secondary')}>
            Quay lại danh sách
          </Link>
        }
      />
      <div className="space-y-4">
        {failure && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {failure}
          </p>
        )}

        {result ? (
          <section aria-label="Kết quả nhập" className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">Kết quả nhập</h2>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Đơn đã tạo</dt>
                <dd className="text-lg font-semibold text-success">{formatNumber(result.created)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Đơn trùng bỏ qua</dt>
                <dd className="text-lg font-semibold text-fg">{formatNumber(result.skipped_duplicates)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Đơn lỗi</dt>
                <dd className="text-lg font-semibold text-danger">{formatNumber(result.errors.length)}</dd>
              </div>
            </dl>
            {result.errors.length > 0 && (
              <ul aria-label="Đơn lỗi" className="divide-y divide-line rounded-lg border border-line text-sm">
                {result.errors.slice(0, MAX_SHOWN_ERRORS).map((er, i) => (
                  <li key={`${er.external_order_id}-${i}`} className="px-3 py-2">
                    <span className="font-medium text-fg">{er.external_order_id}</span>: {er.message}
                  </li>
                ))}
                {result.errors.length > MAX_SHOWN_ERRORS && (
                  <li className="px-3 py-2 text-muted">… và {result.errors.length - MAX_SHOWN_ERRORS} lỗi khác.</li>
                )}
              </ul>
            )}
            <div className="flex gap-2">
              <Link to="/don-hang" className={buttonClass('primary')}>
                Xem danh sách đơn
              </Link>
              <Button variant="secondary" onClick={reset}>
                Nhập file khác
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section aria-label="Chọn file" className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
              <Field label="Sàn" htmlFor="import-channel">
                <select
                  id="import-channel"
                  value={channel}
                  disabled={busy || orders.length > 0}
                  onChange={(e) => setChannel(e.target.value as Channel)}
                  className={inputClass}
                >
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="File đơn hàng (.xlsx hoặc .csv)" htmlFor="import-file">
                <input
                  id="import-file"
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setOrders([]);
                    setParseErrors([]);
                    setPreview(null);
                    setFailure('');
                    runRef.current = null;
                    setFileName(file.name);
                    readFile.mutate(file);
                  }}
                  className={inputClass}
                />
              </Field>
              {readFile.isPending && <p className="text-sm text-muted sm:col-span-2">Đang đọc file…</p>}
            </section>

            {parseErrors.length > 0 && (
              <section aria-label="Lỗi đọc file" className="space-y-2 rounded-xl border border-danger/40 bg-surface p-4">
                <h2 className="text-sm font-semibold text-danger">
                  {parseErrors.length} dòng không đọc được{orders.length > 0 ? ' (các đơn này sẽ bị bỏ qua)' : ''}
                </h2>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {parseErrors.slice(0, MAX_SHOWN_ERRORS).map((er, i) => (
                    <li key={i}>
                      <span className="font-medium">Dòng {er.row}:</span> {er.message}
                    </li>
                  ))}
                  {parseErrors.length > MAX_SHOWN_ERRORS && <li className="text-muted">… và {parseErrors.length - MAX_SHOWN_ERRORS} lỗi khác.</li>}
                </ul>
              </section>
            )}

            {previewProgress && <ProgressBar label="Đang xem trước" progress={previewProgress} />}

            {preview && (
              <section aria-label="Xem trước" className="space-y-4 rounded-xl border border-line bg-surface p-4">
                <h2 className="text-sm font-semibold text-fg">Xem trước · {fileName}</h2>
                <dl className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">Đơn mới</dt>
                    <dd className="text-lg font-semibold text-success">{formatNumber(preview.new)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Đơn trùng</dt>
                    <dd className="text-lg font-semibold text-fg">{formatNumber(preview.duplicates.length)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Đã huỷ/hoàn (bỏ qua)</dt>
                    <dd className="text-lg font-semibold text-fg">{formatNumber(preview.skipped_status)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">SKU chưa gán</dt>
                    <dd className={`text-lg font-semibold ${unmapped.length > 0 ? 'text-warning' : 'text-fg'}`}>
                      {formatNumber(unmapped.length)}
                    </dd>
                  </div>
                </dl>

                {unmapped.length > 0 && (
                  <div className="space-y-2">
                    <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                      Các SKU dưới đây chưa khớp sản phẩm nào. Đơn có SKU chưa gán sẽ bị báo lỗi và không được tạo; hãy gán
                      ngay rồi xem trước lại.
                    </p>
                    <ul aria-label="SKU chưa gán" className="divide-y divide-line rounded-lg border border-line">
                      {unmapped.map((s) => (
                        <SkuMapper
                          key={s}
                          externalSku={s}
                          busy={busy}
                          onMap={(externalSku, sku) => mapSku.mutate({ externalSku, sku })}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                  <Button variant="secondary" disabled={busy} onClick={reset}>
                    Chọn file khác
                  </Button>
                  <Button disabled={busy || (preview.new === 0 && !partial)} onClick={() => setConfirming(true)}>
                    {partial ? 'Tiếp tục nhập' : `Nhập ${formatNumber(preview.new)} đơn`}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Nhập đơn từ file"
        message={
          <div className="space-y-3">
            <p>
              Hệ thống sẽ tạo {formatNumber(preview?.new ?? 0)} đơn mới từ {fileName}, giữ hàng theo trạng thái trên sàn. Đơn
              trùng được bỏ qua. Bạn chắc chắn muốn nhập?
            </p>
            {doImport.isPending && importProgress && <ProgressBar label="Đang nhập" progress={importProgress} />}
          </div>
        }
        confirmLabel="Nhập đơn"
        busy={doImport.isPending}
        onConfirm={() => doImport.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
