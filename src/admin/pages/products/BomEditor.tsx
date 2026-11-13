import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { inputClass } from '../../components/Field';
import { ProductPicker } from '../../components/ProductPicker';
import { useToast } from '../../components/Toast';
import { ApiClientError, apiFetch, errorMessage } from '../../lib/api';

export interface BomRow {
  component_sku: string;
  component_name?: string | null;
  qty_per_combo: number;
}

/** "Thành phần combo": mỗi dòng là một SKU thường và số lượng trong một combo. Lưu bằng PUT /products/:sku/bom. */
export function BomEditor({ sku, initial }: { sku: string; initial: BomRow[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [rows, setRows] = useState<BomRow[]>(initial);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/products/${encodeURIComponent(sku)}/bom`, {
        method: 'PUT',
        json: { items: rows.map((r) => ({ component_sku: r.component_sku, qty_per_combo: r.qty_per_combo })) },
      }),
    onSuccess: () => {
      setError('');
      toast.success('Đã lưu thành phần combo.');
      void qc.invalidateQueries({ queryKey: ['/products'] });
      void qc.invalidateQueries({ queryKey: ['/inventory'] });
      void qc.invalidateQueries({ queryKey: ['product-picker'] });
    },
    onError: (e) => {
      const msg =
        e instanceof ApiClientError && e.code === 'BOM_IN_USE'
          ? `Không thể đổi thành phần: ${e.message}`
          : errorMessage(e);
      setError(msg);
      toast.error(msg);
    },
  });

  const setQty = (componentSku: string, v: string) =>
    setRows((rs) =>
      rs.map((r) => (r.component_sku === componentSku ? { ...r, qty_per_combo: Math.floor(Number(v)) || 0 } : r)),
    );
  const invalidReason =
    rows.length === 0
      ? 'Cần ít nhất một thành phần.'
      : rows.some((r) => !(r.qty_per_combo >= 1))
        ? 'Số lượng phải lớn hơn 0.'
        : '';
  const invalid = invalidReason !== '';

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="Thành phần combo">
      <h2 className="text-sm font-semibold text-fg">Thành phần combo</h2>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Chưa có thành phần. Chọn sản phẩm bên dưới để thêm.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.component_sku} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{r.component_name || r.component_sku}</p>
                <p className="text-xs text-muted">{r.component_sku}</p>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={r.qty_per_combo || ''}
                onChange={(e) => setQty(r.component_sku, e.target.value)}
                aria-label={`Số lượng ${r.component_sku} mỗi combo`}
                className={`${inputClass} w-24`}
              />
              <button
                type="button"
                aria-label={`Xoá ${r.component_sku}`}
                onClick={() => setRows((rs) => rs.filter((x) => x.component_sku !== r.component_sku))}
                className="text-muted hover:text-danger"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ProductPicker
        limitToAvailable={false}
        excludeCombos
        onPick={(s, qty, p) =>
          setRows((rs) =>
            rs.some((r) => r.component_sku === s)
              ? rs.map((r) => (r.component_sku === s ? { ...r, qty_per_combo: r.qty_per_combo + qty } : r))
              : [...rs, { component_sku: s, component_name: p.name, qty_per_combo: qty }],
          )
        }
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {invalid && <p className="text-xs text-muted">{invalidReason}</p>}
        <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
          Lưu thành phần
        </Button>
      </div>
    </section>
  );
}
