import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field, inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { ProductPicker } from '../components/ProductPicker';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch, type ListResult } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatDate } from '../lib/format';
import { DraftLines, ReadonlyLines, type LineState, type ServerLine } from './kho/StockDocLines';
import { DOC_TYPE_LABELS, isDocType, type DocType } from './kho/labels';

interface DocDetail {
  id: number;
  code: string;
  type: DocType;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  supplier_id: number | null;
  note: string;
  created_at: string;
  posted_at: string | null;
  lines: ServerLine[];
}

const detailKey = (id: string | number) => ['/stock-docs', 'detail', String(id)];

async function fetchSystemQty(sku: string): Promise<number> {
  const res = await apiFetch<ListResult<{ sku: string; stock: number }>>('/inventory', {
    query: { q: sku, page_size: 20 },
  });
  const row = res.items.find((i) => i.sku === sku);
  if (!row) throw new Error(`Không tìm thấy tồn kho của ${sku}.`);
  return row.stock;
}

const asToast = (e: unknown): unknown => (e instanceof Error && !(e instanceof ApiClientError) ? e.message : e);

const toLineState = (l: ServerLine, type: DocType): LineState => ({
  sku: l.sku,
  name: l.product_name ?? '',
  unit: '',
  qty: type === 'STOCKTAKE' ? '' : String(l.qty),
  unitCost: l.unit_cost_vnd ?? null,
  batch: l.batch_code,
  expiry: l.expiry_date,
  counted: l.counted_qty == null ? '' : String(l.counted_qty),
  system: type === 'STOCKTAKE' ? (l.system_qty ?? null) : null,
});

/** Kiểm tra từng dòng như schema máy chủ; trả về thông báo lỗi đầu tiên hoặc null. */
function lineProblem(type: DocType, l: LineState, i: number): string | null {
  const at = `Dòng ${i + 1} (${l.sku}): `;
  const int = (s: string) => (s.trim() !== '' && Number.isInteger(Number(s)) ? Number(s) : null);
  if (type === 'STOCKTAKE') {
    const c = int(l.counted);
    return c === null || c < 0 ? `${at}số đếm phải là số nguyên từ 0.` : null;
  }
  const q = int(l.qty);
  if (q === null) return `${at}số lượng phải là số nguyên.`;
  if (type === 'ADJUST' && q === 0) return `${at}độ lệch điều chỉnh phải khác 0.`;
  if (type !== 'ADJUST' && q <= 0) return `${at}số lượng phải lớn hơn 0.`;
  if (type === 'RECEIPT' && (l.unitCost === null || l.unitCost < 0)) return `${at}vui lòng nhập đơn giá nhập.`;
  return null;
}

function buildLines(type: DocType, lines: LineState[]) {
  return lines.map((l) => {
    switch (type) {
      case 'RECEIPT':
        return { sku: l.sku, qty: Number(l.qty), unit_cost_vnd: l.unitCost, batch_code: l.batch.trim(), expiry_date: l.expiry };
      case 'STOCKTAKE':
        return { sku: l.sku, counted_qty: Number(l.counted) };
      default:
        return { sku: l.sku, qty: Number(l.qty) };
    }
  });
}

function DocEditor({ type, doc }: { type: DocType; doc?: DocDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [docId, setDocId] = useState<number | null>(doc?.id ?? null);
  const [supplierId, setSupplierId] = useState<string>(doc?.supplier_id ? String(doc.supplier_id) : '');
  const [note, setNote] = useState(doc?.note ?? '');
  const [lines, setLines] = useState<LineState[]>(() => (doc ? doc.lines.map((l) => toLineState(l, type)) : []));
  const [dirty, setDirty] = useState(!doc);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [formError, setFormError] = useState('');
  const requested = useRef(new Set<string>());
  const createdId = useRef<number | null>(null);

  const { isAdmin } = useMe();
  const readOnly = (!!doc && doc.status !== 'DRAFT') || (type === 'RECEIPT' && !isAdmin);
  const suppliers = useQuery({
    queryKey: ['/suppliers', 'options'],
    enabled: type === 'RECEIPT' && !readOnly,
    queryFn: () => apiFetch<ListResult<{ id: number; name: string }>>('/suppliers', { query: { page_size: 200 } }),
  });

  // Kiểm kê: điền sẵn tồn hệ thống cho mỗi SKU chưa có.
  useEffect(() => {
    if (type !== 'STOCKTAKE' || readOnly) return;
    for (const l of lines) {
      if (l.system !== null || requested.current.has(l.sku)) continue;
      requested.current.add(l.sku);
      fetchSystemQty(l.sku)
        .then((system) => setLines((cur) => cur.map((x) => (x.sku === l.sku ? { ...x, system } : x))))
        .catch((e) => {
          requested.current.delete(l.sku);
          toast.error(asToast(e));
        });
    }
  }, [type, readOnly, lines, toast]);

  /** Tải lại tồn hệ thống (khi mở hộp xác nhận ghi sổ) để chênh lệch hiển thị sát thực tế. */
  const refreshSystem = (skus: string[]) => {
    for (const sku of skus) {
      fetchSystemQty(sku)
        .then((system) => setLines((cur) => cur.map((x) => (x.sku === sku ? { ...x, system } : x))))
        .catch((e) => toast.error(asToast(e)));
    }
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['/stock-docs'] });
    void qc.invalidateQueries({ queryKey: ['/products'] });
    void qc.invalidateQueries({ queryKey: ['/reports/stock-movement'] });
    void qc.invalidateQueries({ queryKey: ['product-picker'] });
    void qc.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/inventory'),
    });
  };

  const buildBody = () => {
    if (lines.length === 0) {
      setFormError('Phiếu cần ít nhất một dòng.');
      return null;
    }
    for (let i = 0; i < lines.length; i++) {
      const p = lineProblem(type, lines[i], i);
      if (p) {
        setFormError(p);
        return null;
      }
    }
    setFormError('');
    return {
      type,
      supplier_id: type === 'RECEIPT' && supplierId ? Number(supplierId) : null,
      note: note.trim(),
      lines: buildLines(type, lines),
    };
  };

  /** Tạo hoặc cập nhật nháp; trả về phiếu đã lưu. */
  const persist = async (body: NonNullable<ReturnType<typeof buildBody>>): Promise<DocDetail> => {
    const saved = docId
      ? await apiFetch<DocDetail>(`/stock-docs/${docId}`, { method: 'PUT', json: body })
      : await apiFetch<DocDetail>('/stock-docs', { method: 'POST', json: body });
    setDocId(saved.id);
    createdId.current = saved.id;
    setDirty(false);
    qc.setQueryData(detailKey(saved.id), saved);
    return saved;
  };

  const onError = (e: unknown, retry?: () => void) => {
    setFormError(e instanceof ApiClientError ? e.message : '');
    if (e instanceof ApiClientError && e.status === 0 && retry) {
      toast.error(e, { action: { label: 'Thử lại', onClick: retry } });
    } else toast.error(e);
  };

  const save = useMutation({
    mutationFn: persist,
    onSuccess: (saved) => {
      refresh();
      toast.success(`Đã lưu nháp ${saved.code}.`);
      if (!doc) navigate(`/kho/phieu/${saved.id}`, { replace: true });
    },
    onError: (e, body) => onError(e, () => save.mutate(body)),
  });

  const post = useMutation({
    mutationFn: async () => {
      let id = docId;
      if (id === null || dirty) {
        const body = buildBody();
        if (!body) throw new Error('INVALID');
        id = (await persist(body)).id;
      }
      return apiFetch<DocDetail>(`/stock-docs/${id}/post`, { method: 'POST' });
    },
    onSuccess: (posted) => {
      setConfirm(null);
      qc.setQueryData(detailKey(posted.id), posted);
      refresh();
      toast.success(`Đã ghi sổ phiếu ${posted.code}.`);
      if (!doc) navigate(`/kho/phieu/${posted.id}`, { replace: true });
    },
    onError: (e) => {
      setConfirm(null);
      if (e instanceof Error && e.message === 'INVALID') return;
      onError(e);
      refresh();
      // Phiếu mới đã được lưu nháp nhưng ghi sổ lỗi: chuyển sang trang phiếu để sửa tiếp.
      if (!doc && createdId.current) navigate(`/kho/phieu/${createdId.current}`, { replace: true });
    },
  });

  const cancel = useMutation({
    mutationFn: () => apiFetch<DocDetail>(`/stock-docs/${docId}/cancel`, { method: 'POST' }),
    onSuccess: (cancelled) => {
      setConfirm(null);
      qc.setQueryData(detailKey(cancelled.id), cancelled);
      refresh();
      toast.success(`Đã huỷ phiếu ${cancelled.code}.`);
    },
    onError: (e) => {
      setConfirm(null);
      onError(e);
    },
  });

  const busy = save.isPending || post.isPending || cancel.isPending;
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };
  const picked = Object.fromEntries(lines.map((l) => [l.sku, Number(l.qty) || 0]));

  const addLine = (sku: string, qty: number, p: { name: string; unit: string }) => {
    setDirty(true);
    setLines((cur) => {
      if (cur.some((l) => l.sku === sku)) {
        return cur.map((l) => (l.sku === sku && type !== 'STOCKTAKE' ? { ...l, qty: String((Number(l.qty) || 0) + qty) } : l));
      }
      return [
        ...cur,
        {
          sku,
          name: p.name,
          unit: p.unit,
          qty: type === 'STOCKTAKE' ? '' : String(qty),
          unitCost: null,
          batch: '',
          expiry: '',
          counted: '',
          system: null,
        },
      ];
    });
  };

  const title = doc ? doc.code : `${DOC_TYPE_LABELS[type]} mới`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            {doc && <StatusBadge kind="doc" value={doc.status} />}
          </span>
        }
        description={
          doc
            ? `${DOC_TYPE_LABELS[type]} · tạo ${formatDate(doc.created_at, { time: true })}${
                doc.posted_at ? ` · ghi sổ ${formatDate(doc.posted_at, { time: true })}` : ''
              }`
            : 'Phiếu nháp chưa ảnh hưởng tồn kho cho đến khi ghi sổ.'
        }
        actions={
          <Link to="/kho/phieu" className={buttonClass('secondary')}>
            Quay lại danh sách
          </Link>
        }
      />

      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        {formError && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        {readOnly && doc ? (
          <>
            {doc.note && (
              <p className="text-sm text-fg">
                <span className="text-muted">Ghi chú: </span>
                {doc.note}
              </p>
            )}
            <ReadonlyLines type={type} lines={doc.lines} />
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {type === 'RECEIPT' && (
                <Field label="Nhà cung cấp" htmlFor="doc-supplier">
                  <select
                    id="doc-supplier"
                    value={supplierId}
                    onChange={(e) => edit(setSupplierId)(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Không chọn</option>
                    {(suppliers.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Ghi chú" htmlFor="doc-note" className={type === 'RECEIPT' ? '' : 'sm:col-span-2'}>
                <input
                  id="doc-note"
                  value={note}
                  maxLength={1000}
                  onChange={(e) => edit(setNote)(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <DraftLines type={type} lines={lines} onChange={edit(setLines)} />

            <div className="space-y-1">
              <p className="text-sm font-medium text-fg">Thêm sản phẩm</p>
              <ProductPicker
                limitToAvailable={type === 'ISSUE'}
                excludeCombos
                picked={picked}
                disabled={busy}
                onPick={(sku, qty, p) => addLine(sku, qty, p)}
              />
              {type === 'ADJUST' && (
                <p className="text-xs text-muted">Sau khi thêm, nhập số âm ở cột độ lệch để giảm tồn.</p>
              )}
              {type === 'STOCKTAKE' && (
                <p className="text-xs text-muted">
                  Tồn hệ thống được điền sẵn; nhập số đếm thực tế để xem chênh lệch. Tồn thực tế tại thời điểm ghi sổ có
                  thể khác; hệ thống tính lại khi ghi sổ.
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              {docId !== null && (
                <Button variant="danger" disabled={busy} onClick={() => setConfirm('cancel')}>
                  Huỷ phiếu
                </Button>
              )}
              <Button
                variant="secondary"
                loading={save.isPending}
                disabled={busy}
                onClick={() => {
                  const body = buildBody();
                  if (body) save.mutate(body);
                }}
              >
                Lưu nháp
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (!buildBody()) return;
                  if (type === 'STOCKTAKE') refreshSystem(lines.map((l) => l.sku));
                  setConfirm('post');
                }}
              >
                Ghi sổ
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'post'}
        title="Ghi sổ phiếu kho"
        message="Sau khi ghi sổ, tồn kho thay đổi và phiếu không thể sửa. Bạn chắc chắn muốn ghi sổ?"
        confirmLabel="Ghi sổ"
        busy={post.isPending}
        onConfirm={() => post.mutate()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        danger
        title="Huỷ phiếu kho"
        message="Phiếu nháp sẽ bị huỷ và không thể khôi phục. Tồn kho không thay đổi."
        confirmLabel="Huỷ phiếu"
        cancelLabel="Giữ lại"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

/** Soạn phiếu mới (`/kho/phieu/moi?type=…`) hoặc xem/sửa phiếu (`/kho/phieu/:id`). */
export function StockDocEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { isAdmin } = useMe();
  const isNew = !id || id === 'moi';
  const query = useQuery({
    queryKey: detailKey(id ?? 'moi'),
    enabled: !isNew,
    queryFn: () => apiFetch<DocDetail>(`/stock-docs/${id}`),
  });

  if (isNew) {
    const t = params.get('type');
    const type = isDocType(t) ? t : 'RECEIPT';
    if (type === 'RECEIPT' && !isAdmin) {
      return (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          Chỉ quản trị viên được tạo phiếu nhập kho.
        </p>
      );
    }
    return <DocEditor key={type} type={type} />;
  }
  if (query.isPending) return <p className="text-sm text-muted">Đang tải…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {query.error instanceof ApiClientError ? query.error.message : 'Không tải được phiếu.'}
      </p>
    );
  }
  return <DocEditor key={`${query.data.id}-${query.data.status}`} type={query.data.type} doc={query.data} />;
}
