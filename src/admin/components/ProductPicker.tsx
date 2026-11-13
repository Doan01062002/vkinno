import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { apiFetch, type ListResult } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { Button } from './Button';
import { inputClass } from './Field';

export type PriceTier = 'RETAIL' | 'WHOLESALE';

/** Sản phẩm đã chọn, kèm đơn giá theo bảng giá và số có thể bán. */
export interface PickedProduct {
  sku: string;
  name: string;
  unit: string;
  is_combo: boolean;
  /** Có thể bán = tồn − đang giữ (combo: theo thành phần). */
  available: number;
  /** Giá theo `priceTier` (sỉ không có thì dùng giá lẻ). */
  unit_price_vnd: number;
}

export interface ProductPickerProps {
  /** Gọi khi bấm "Thêm"; `qty` đã được kiểm tra ≤ số có thể bán còn lại. */
  onPick: (sku: string, qty: number, product: PickedProduct) => void;
  /** Bảng giá của khách (mặc định giá lẻ). */
  priceTier?: PriceTier;
  /** Số lượng đã có trong phiếu/đơn theo SKU, được trừ khỏi số có thể bán. */
  picked?: Record<string, number>;
  /** false cho phiếu nhập kho (không giới hạn theo tồn). Mặc định true. */
  limitToAvailable?: boolean;
  disabled?: boolean;
}

interface InventoryRow {
  sku: string;
  name: string;
  unit: string;
  is_combo: number;
  is_active: number;
  available: number;
}

interface ProductRow {
  sku: string;
  price_vnd: number;
  wholesale_price_vnd: number | null;
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Tìm sản phẩm (GET /inventory + /products), hiện số có thể bán và giá; chặn chọn quá số có thể bán. */
export function ProductPicker({
  onPick,
  priceTier = 'RETAIL',
  picked = {},
  limitToAvailable = true,
  disabled = false,
}: ProductPickerProps) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PickedProduct | null>(null);
  const [qty, setQty] = useState('1');
  const q = useDebounced(text.trim(), 250);

  const results = useQuery({
    queryKey: ['product-picker', q, priceTier],
    enabled: open && !disabled,
    queryFn: async ({ signal }) => {
      const query = { q, page_size: 20 };
      const [inv, prods] = await Promise.all([
        apiFetch<ListResult<InventoryRow>>('/inventory', { query, signal }),
        apiFetch<ListResult<ProductRow>>('/products', { query: { ...query, is_active: 1 }, signal }),
      ]);
      const prices = new Map(prods.items.map((p) => [p.sku, p]));
      return inv.items
        .filter((r) => r.is_active === 1 && prices.has(r.sku))
        .map<PickedProduct>((r) => {
          const p = prices.get(r.sku) as ProductRow;
          return {
            sku: r.sku,
            name: r.name,
            unit: r.unit,
            is_combo: r.is_combo === 1,
            available: r.available,
            unit_price_vnd: priceTier === 'WHOLESALE' ? (p.wholesale_price_vnd ?? p.price_vnd) : p.price_vnd,
          };
        });
    },
  });

  const remaining = selected ? Math.max(0, selected.available - (picked[selected.sku] ?? 0)) : 0;
  const qtyNum = Number(qty);
  const qtyValid = Number.isInteger(qtyNum) && qtyNum >= 1;
  const overLimit = limitToAvailable && qtyValid && qtyNum > remaining;
  const qtyError = !qtyValid
    ? 'Số lượng phải là số nguyên từ 1.'
    : overLimit
      ? `Chỉ còn ${formatNumber(remaining)} có thể bán.`
      : '';

  const reset = () => {
    setSelected(null);
    setQty('1');
    setText('');
  };

  if (selected) {
    return (
      <div className="space-y-2 rounded-xl border border-line bg-subtle/50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{selected.name}</p>
            <p className="text-xs text-muted">
              {selected.sku} · {formatVnd(selected.unit_price_vnd)} · Có thể bán:{' '}
              <span className={remaining > 0 ? 'text-success' : 'text-danger'}>{formatNumber(remaining)}</span>
            </p>
          </div>
          <button type="button" aria-label="Bỏ chọn" onClick={reset} className="text-muted hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <input
              type="number"
              min={1}
              step={1}
              max={limitToAvailable ? remaining : undefined}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-label="Số lượng"
              aria-invalid={qtyError ? true : undefined}
              className={inputClass}
            />
            {qtyError && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {qtyError}
              </p>
            )}
          </div>
          <Button
            disabled={!!qtyError || disabled}
            onClick={() => {
              onPick(selected.sku, qtyNum, selected);
              reset();
            }}
          >
            <Plus size={16} aria-hidden />
            Thêm
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={inputId}
          type="search"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Tìm sản phẩm theo tên hoặc SKU"
          aria-label="Tìm sản phẩm"
          className={`${inputClass} pl-9`}
        />
      </div>
      {open && (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-surface">
          {results.isPending ? (
            <p className="px-3 py-3 text-sm text-muted">Đang tải…</p>
          ) : results.isError ? (
            <p className="px-3 py-3 text-sm text-danger">Không tải được danh sách sản phẩm.</p>
          ) : results.data.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">Không tìm thấy sản phẩm.</p>
          ) : (
            <ul>
              {results.data.map((p) => {
                const left = p.available - (picked[p.sku] ?? 0);
                return (
                  <li key={p.sku}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(p);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-subtle"
                    >
                      <Package size={16} className="shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{p.name}</span>
                        <span className="block text-xs text-muted">
                          {p.sku}
                          {p.is_combo ? ' · Combo' : ''} · {formatVnd(p.unit_price_vnd)}
                        </span>
                      </span>
                      <span className={`text-xs whitespace-nowrap ${left > 0 ? 'text-success' : 'text-danger'}`}>
                        Có thể bán: {formatNumber(Math.max(0, left))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
