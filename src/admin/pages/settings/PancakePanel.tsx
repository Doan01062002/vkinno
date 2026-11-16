import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/Button';
import { Field, inputClass } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { apiFetch, errorMessage, type ListResult } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { SkuMapper } from '../orders/SkuMapper';

// ---------------------------------------------------------------------------
// Kiểu dữ liệu API (worker/admin/pancake-admin.ts, pancake-sync.ts)
// ---------------------------------------------------------------------------

interface Status {
  shop_id: string | null;
  warehouse_id: string | null;
  enabled: boolean;
  has_api_key: boolean;
  has_webhook_secret: boolean;
  last_reconcile_at: string | null;
  reconcile_failures: number;
  last_event_at: string | null;
  open_count: number;
  counts_7d: Partial<Record<EventResult, number>>;
}

type EventResult = 'RECEIVED' | 'CREATED' | 'UPDATED' | 'SKIPPED' | 'NEEDS_MAPPING' | 'NEEDS_ATTENTION' | 'ERROR';

interface PancakeEvent {
  id: number;
  pancake_order_id: string;
  status: number;
  result: EventResult;
  message: string;
  order_id: number | null;
  order_code: string | null;
  via: 'WEBHOOK' | 'RECONCILE';
  received_at: string;
  resolved_at: string | null;
  marketplace_id: string | null;
  marketplace_order_id: string | null;
  customer_name: string | null;
}

interface Unmapped {
  available: boolean;
  truncated?: boolean;
  items: { variation_id: string; display_id: string; name: string; detail: string }[];
}

interface SyncResult {
  skipped?: string;
  reconcile?: { fetched?: number; created?: number; updated?: number; problems?: number; error?: string };
  stock?: { pushed?: number; unchanged?: number; unmapped?: number; skipped?: string; error?: string };
}

const STATUS_KEY = ['/pancake/status'];
const OPEN_KEY = ['/pancake/events', 'open'];
const UNMAPPED_KEY = ['/pancake/unmapped'];

const RESULT_LABEL: Record<EventResult, { label: string; className: string }> = {
  RECEIVED: { label: 'Đang xử lý', className: 'bg-muted/10 text-muted' },
  CREATED: { label: 'Đã tạo đơn', className: 'bg-success/10 text-success' },
  UPDATED: { label: 'Đã cập nhật', className: 'bg-success/10 text-success' },
  SKIPPED: { label: 'Bỏ qua', className: 'bg-muted/10 text-muted' },
  NEEDS_MAPPING: { label: 'Chưa gán SKU', className: 'bg-warning/10 text-warning' },
  NEEDS_ATTENTION: { label: 'Cần xử lý', className: 'bg-warning/10 text-warning' },
  ERROR: { label: 'Lỗi', className: 'bg-danger/10 text-danger' },
};

const MARKETPLACE: Record<string, string> = { '-3': 'Shopee', '-9': 'TikTok', '-4': 'Lazada', '-2': 'Tiki' };

/** Thời gian lưu trong D1 (`YYYY-MM-DD HH:MM:SS`, UTC) → ISO để formatDate đổi sang giờ VN. */
const sqlTime = (s: string | null) => (s && !s.includes('T') ? `${s.replace(' ', 'T')}Z` : s);

function ResultBadge({ result }: { result: EventResult }) {
  const r = RESULT_LABEL[result];
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${r.className}`}>{r.label}</span>;
}

// ---------------------------------------------------------------------------
// Tình trạng kết nối
// ---------------------------------------------------------------------------

function health(s: Status): { tone: 'success' | 'warning' | 'danger' | 'muted'; text: string; hint?: string } {
  if (!s.enabled) return { tone: 'muted', text: 'Đang tắt', hint: 'Webhook trả 503 và không đối soát cho tới khi bật lại.' };
  if (!s.shop_id) return { tone: 'danger', text: 'Chưa nhập mã shop', hint: 'Nhập mã shop Pancake ở phần Cấu hình bên dưới.' };
  if (!s.has_webhook_secret) return { tone: 'danger', text: 'Chưa nạp khoá webhook', hint: 'Cần nạp PANCAKE_WEBHOOK_SECRET trên máy chủ.' };
  if (s.reconcile_failures >= 3) return { tone: 'danger', text: `Đối soát lỗi ${s.reconcile_failures} lần liên tiếp`, hint: 'Kiểm tra API key Pancake.' };
  if (!s.has_api_key) return { tone: 'warning', text: 'Chỉ nhận webhook', hint: 'Chưa có API key: không đối soát và không đẩy tồn.' };
  return { tone: 'success', text: 'Đang hoạt động' };
}

const DOT: Record<string, string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', muted: 'bg-muted' };

function StatusCard({ status }: { status: Status }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sync = useMutation({
    mutationFn: () => apiFetch<SyncResult>('/pancake/sync', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/pancake') });
      void qc.invalidateQueries({ queryKey: ['/orders'] });
    },
    onError: (e) => toast.error(e, { action: { label: 'Thử lại', onClick: () => sync.mutate() } }),
  });
  const h = health(status);
  const c = status.counts_7d;
  const stats = [
    { label: 'Đơn tạo mới · 7 ngày', value: c.CREATED ?? 0 },
    { label: 'Lần cập nhật · 7 ngày', value: c.UPDATED ?? 0 },
    { label: 'Bỏ qua · 7 ngày', value: c.SKIPPED ?? 0 },
    { label: 'Đang cần xử lý', value: status.open_count, warn: status.open_count > 0 },
  ];
  return (
    <section aria-labelledby="pk-status" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="pk-status" className="text-base font-semibold text-fg">
            Pancake POS
          </h2>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-fg">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${DOT[h.tone]}`} />
            {h.text}
          </p>
          {h.hint && <p className="mt-0.5 text-sm text-muted">{h.hint}</p>}
        </div>
        <Button variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending} disabled={!status.has_api_key || !status.enabled}>
          <RefreshCw size={16} aria-hidden /> Đồng bộ ngay
        </Button>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Mã shop</dt>
          <dd className="font-medium text-fg">{status.shop_id ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Đối soát gần nhất</dt>
          <dd className="font-medium text-fg">{formatDate(status.last_reconcile_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Sự kiện gần nhất</dt>
          <dd className="font-medium text-fg">{formatDate(sqlTime(status.last_event_at))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Khoá</dt>
          <dd className="font-medium text-fg">
            Webhook {status.has_webhook_secret ? '✓' : '✗'} · API {status.has_api_key ? '✓' : '✗'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-subtle px-3 py-2">
            <p className="text-xs text-muted">{s.label}</p>
            <p className={`text-xl font-semibold tabular-nums ${s.warn ? 'text-warning' : 'text-fg'}`}>{formatNumber(s.value)}</p>
          </div>
        ))}
      </div>

      {sync.data && <SyncSummary result={sync.data} />}
    </section>
  );
}

function SyncSummary({ result }: { result: SyncResult }) {
  if (result.skipped) return <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{result.skipped}</p>;
  const r = result.reconcile ?? {};
  const s = result.stock ?? {};
  return (
    <div role="status" className="mt-3 space-y-1 rounded-lg bg-subtle px-3 py-2 text-sm text-fg">
      <p>
        <span className="font-medium">Đối soát: </span>
        {r.error ? (
          <span className="text-danger">{r.error}</span>
        ) : (
          `kéo ${formatNumber(r.fetched ?? 0)} đơn · tạo ${formatNumber(r.created ?? 0)} · cập nhật ${formatNumber(r.updated ?? 0)}${
            r.problems ? ` · ${formatNumber(r.problems)} cần xử lý` : ''
          }`
        )}
      </p>
      <p>
        <span className="font-medium">Đẩy tồn: </span>
        {s.error ? (
          <span className="text-danger">{s.error}</span>
        ) : s.skipped ? (
          <span className="text-warning">{s.skipped}</span>
        ) : (
          `gửi ${formatNumber(s.pushed ?? 0)} mẫu mã · không đổi ${formatNumber(s.unchanged ?? 0)} · chưa gán ${formatNumber(s.unmapped ?? 0)}`
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

function SettingsForm({ status }: { status: Status }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [enabled, setEnabled] = useState(status.enabled);
  const [shopId, setShopId] = useState(status.shop_id ?? '');
  const [warehouseId, setWarehouseId] = useState(status.warehouse_id ?? '');
  useEffect(() => {
    setEnabled(status.enabled);
    setShopId(status.shop_id ?? '');
    setWarehouseId(status.warehouse_id ?? '');
  }, [status.enabled, status.shop_id, status.warehouse_id]);
  const save = useMutation({
    mutationFn: () => apiFetch('/pancake/settings', { method: 'PUT', json: { enabled, shop_id: shopId.trim(), warehouse_id: warehouseId.trim() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
      toast.success('Đã lưu cấu hình Pancake.');
    },
    onError: (e) => toast.error(e),
  });
  const dirty = enabled !== status.enabled || shopId.trim() !== (status.shop_id ?? '') || warehouseId.trim() !== (status.warehouse_id ?? '');
  return (
    <section aria-labelledby="pk-settings" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="pk-settings" className="text-base font-semibold text-fg">
        Cấu hình
      </h2>
      <form
        className="mt-3 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex items-center gap-2 text-sm font-medium text-fg sm:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Nhận đơn sàn từ Pancake và đẩy tồn lên Pancake
        </label>
        <Field label="Mã shop Pancake" htmlFor="pk-shop" hint="Số trong địa chỉ pos.pancake.vn/shop/…">
          <input id="pk-shop" inputMode="numeric" value={shopId} onChange={(e) => setShopId(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Mã kho Pancake nhận tồn" htmlFor="pk-wh" hint="Để trống thì không đẩy tồn.">
          <input id="pk-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={`${inputClass} font-mono`} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Lưu cấu hình
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sự kiện
// ---------------------------------------------------------------------------

function EventItem({ ev, actions }: { ev: PancakeEvent; actions?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/pancake') });
    void qc.invalidateQueries({ queryKey: ['/orders'] });
  };
  const retry = useMutation({
    mutationFn: () => apiFetch<{ result: EventResult; message: string }>(`/pancake/events/${ev.id}/retry`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      if (r.result === 'CREATED' || r.result === 'UPDATED') toast.success('Đã xử lý lại đơn.');
      else toast.error(new Error(`${RESULT_LABEL[r.result].label}: ${r.message}`));
    },
    onError: (e) => toast.error(e),
  });
  const resolve = useMutation({
    mutationFn: () => apiFetch(`/pancake/events/${ev.id}/resolve`, { method: 'POST' }),
    onSuccess: () => {
      refresh();
      toast.success('Đã đánh dấu đã xử lý.');
    },
    onError: (e) => toast.error(e),
  });
  const market = ev.marketplace_id ? (MARKETPLACE[ev.marketplace_id] ?? `Sàn ${ev.marketplace_id}`) : 'Pancake';
  const busy = retry.isPending || resolve.isPending;
  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ResultBadge result={ev.result} />
        <span className="text-sm font-medium text-fg">
          {market} {ev.marketplace_order_id ?? `#${ev.pancake_order_id.split('-').pop()}`}
        </span>
        {ev.customer_name && <span className="text-sm text-muted">{ev.customer_name}</span>}
        <span className="ml-auto text-xs text-muted">
          {formatDate(sqlTime(ev.received_at))} · {ev.via === 'WEBHOOK' ? 'webhook' : 'đối soát'}
        </span>
      </div>
      {ev.message && <p className="mt-1 text-sm text-fg">{ev.message}</p>}
      {(ev.order_code || actions) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ev.order_code && ev.order_id && (
            <Link to={`/don-hang/${ev.order_id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              Đơn {ev.order_code}
            </Link>
          )}
          {actions && (ev.result === 'NEEDS_MAPPING' || ev.result === 'ERROR') && (
            <Button size="sm" variant="secondary" onClick={() => retry.mutate()} loading={retry.isPending} disabled={busy}>
              <RotateCcw size={14} aria-hidden /> Xử lý lại
            </Button>
          )}
          {actions && (
            <Button size="sm" variant="ghost" onClick={() => resolve.mutate()} loading={resolve.isPending} disabled={busy}>
              <Check size={14} aria-hidden /> Đã xử lý
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function OpenEvents() {
  const open = useQuery({
    queryKey: OPEN_KEY,
    queryFn: () => apiFetch<ListResult<PancakeEvent>>('/pancake/events', { query: { open: 1, page_size: 50 } }),
  });
  if (open.isLoading) return null;
  if (open.isError) return <p className="text-sm text-danger">{errorMessage(open.error)}</p>;
  const items = open.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pk-open" className="rounded-xl border border-warning/40 bg-surface p-4">
      <h2 id="pk-open" className="flex items-center gap-2 text-base font-semibold text-fg">
        <AlertTriangle size={18} className="text-warning" aria-hidden /> Việc cần xử lý ({formatNumber(open.data!.total)})
      </h2>
      <p className="mt-1 text-sm text-muted">
        Chưa gán SKU: gán mẫu mã ở phần dưới rồi bấm "Xử lý lại". Trả hàng hoặc huỷ sau khi giao: xử lý kho trong đơn rồi bấm "Đã xử lý".
      </p>
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
        {items.map((ev) => (
          <EventItem key={ev.id} ev={ev} actions />
        ))}
      </ul>
    </section>
  );
}

function UnmappedVariations() {
  const qc = useQueryClient();
  const toast = useToast();
  const unmapped = useQuery({ queryKey: UNMAPPED_KEY, queryFn: () => apiFetch<Unmapped>('/pancake/unmapped'), retry: false });
  const map = useMutation({
    mutationFn: (v: { variationId: string; label: string; sku: string }) =>
      apiFetch('/channel-sku-map', { method: 'PUT', json: { channel: 'PANCAKE', mappings: [{ external_sku: v.variationId, sku: v.sku }] } }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: UNMAPPED_KEY });
      toast.success(`Đã gán ${v.label} cho ${v.sku}.`);
    },
    onError: (e) => toast.error(e),
  });
  return (
    <section aria-labelledby="pk-unmapped" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="pk-unmapped" className="text-base font-semibold text-fg">
        Mẫu mã Pancake chưa gán SKU
      </h2>
      <p className="mt-1 text-sm text-muted">
        Cách nhanh nhất: đặt mã mẫu mã trên Pancake trùng SKU VKINNO (vd. <code className="font-mono">VK-DEGREASER-500ML</code>), khi đó không cần gán ở đây.
      </p>
      {unmapped.isLoading && <p className="mt-3 text-sm text-muted">Đang lấy mẫu mã từ Pancake…</p>}
      {unmapped.isError && (
        <p className="mt-3 text-sm text-danger">
          {errorMessage(unmapped.error)}{' '}
          <button type="button" className="underline" onClick={() => void unmapped.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      {unmapped.data && !unmapped.data.available && (
        <p className="mt-3 text-sm text-muted">Cần API key Pancake để đọc danh sách mẫu mã.</p>
      )}
      {unmapped.data?.available && unmapped.data.items.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-success">
          <Check size={16} aria-hidden /> Mọi mẫu mã trên Pancake đã khớp SKU.
        </p>
      )}
      {unmapped.data?.available && unmapped.data.items.length > 0 && (
        <ul aria-label="Mẫu mã chưa gán" className="mt-3 divide-y divide-line rounded-lg border border-line">
          {unmapped.data.items.map((v) => {
            const label = v.display_id || v.variation_id;
            return (
              <SkuMapper
                key={v.variation_id}
                label="Mẫu mã"
                externalSku={label}
                hint={[v.name, v.detail].filter(Boolean).join(' · ')}
                busy={map.isPending}
                onMap={(_ext, sku) => map.mutate({ variationId: v.variation_id, label, sku })}
              />
            );
          })}
        </ul>
      )}
      {unmapped.data?.truncated && <p className="mt-2 text-xs text-muted">Shop có nhiều mẫu mã: mới hiển thị một phần.</p>}
    </section>
  );
}

const FILTERS: { value: '' | EventResult; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'CREATED', label: 'Đã tạo đơn' },
  { value: 'UPDATED', label: 'Đã cập nhật' },
  { value: 'SKIPPED', label: 'Bỏ qua' },
  { value: 'NEEDS_MAPPING', label: 'Chưa gán SKU' },
  { value: 'NEEDS_ATTENTION', label: 'Cần xử lý' },
  { value: 'ERROR', label: 'Lỗi' },
];
const PAGE_SIZE = 20;

function EventLog() {
  const [result, setResult] = useState<'' | EventResult>('');
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: ['/pancake/events', result, page],
    queryFn: () => apiFetch<ListResult<PancakeEvent>>('/pancake/events', { query: { result, page, page_size: PAGE_SIZE } }),
    placeholderData: (prev) => prev,
  });
  const total = events.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <section aria-labelledby="pk-log" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pk-log" className="text-base font-semibold text-fg">
          Nhật ký đồng bộ
        </h2>
        <select
          aria-label="Lọc theo kết quả"
          value={result}
          onChange={(e) => {
            setResult(e.target.value as '' | EventResult);
            setPage(1);
          }}
          className={`${inputClass} sm:w-48`}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {events.isError && <p className="mt-3 text-sm text-danger">{errorMessage(events.error)}</p>}
      {events.data && events.data.items.length === 0 && <p className="mt-3 text-sm text-muted">Chưa có sự kiện nào.</p>}
      {events.data && events.data.items.length > 0 && (
        <ul className={`mt-3 divide-y divide-line rounded-lg border border-line ${events.isFetching ? 'opacity-60' : ''}`}>
          {events.data.items.map((ev) => (
            <EventItem key={ev.id} ev={ev} />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trước
          </Button>
          <span className="tabular-nums">
            {page}/{pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Sau
          </Button>
        </div>
      )}
    </section>
  );
}

/** Cài đặt → Pancake: tình trạng, việc cần xử lý, gán mẫu mã, cấu hình, nhật ký (Dự án 1b). */
export function PancakePanel() {
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => apiFetch<Status>('/pancake/status') });
  if (status.isLoading) return <p className="text-sm text-muted">Đang tải…</p>;
  if (status.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {errorMessage(status.error)}{' '}
        <button type="button" className="underline" onClick={() => void status.refetch()}>
          Thử lại
        </button>
      </p>
    );
  }
  const s = status.data!;
  return (
    <div className="max-w-4xl space-y-4">
      <StatusCard status={s} />
      <OpenEvents />
      <UnmappedVariations />
      <SettingsForm status={s} />
      <EventLog />
    </div>
  );
}
