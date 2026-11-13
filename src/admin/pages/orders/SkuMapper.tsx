import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { inputClass } from '../../components/Field';
import { apiFetch, type ListResult } from '../../lib/api';
import { useDebounced } from '../../lib/useDebounced';

interface ProductHit {
  sku: string;
  name: string;
}

interface Props {
  externalSku: string;
  busy: boolean;
  onMap: (externalSku: string, sku: string) => void;
}

/** Một SKU sàn chưa gán: tìm sản phẩm nội bộ rồi bấm để ánh xạ. */
export function SkuMapper({ externalSku, busy, onMap }: Props) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const hits = useQuery({
    queryKey: ['/products', 'sku-mapper', q],
    enabled: q.length > 0,
    queryFn: () => apiFetch<ListResult<ProductHit>>('/products', { query: { q, page_size: 6, is_active: 1 } }),
  });
  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-40 text-sm font-medium text-fg">
          <span className="text-muted">SKU sàn: </span>
          {externalSku}
        </p>
        <input
          type="search"
          aria-label={`Tìm sản phẩm cho ${externalSku}`}
          placeholder="Tìm sản phẩm theo tên hoặc SKU"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          className={`${inputClass} sm:w-72`}
        />
      </div>
      {q && hits.data && (
        <ul className="flex flex-wrap gap-2">
          {hits.data.items.length === 0 && <li className="text-xs text-muted">Không tìm thấy sản phẩm.</li>}
          {hits.data.items.map((p) => (
            <li key={p.sku}>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={`Gán ${externalSku} cho ${p.sku}`}
                onClick={() => onMap(externalSku, p.sku)}
              >
                {p.name} · {p.sku}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
