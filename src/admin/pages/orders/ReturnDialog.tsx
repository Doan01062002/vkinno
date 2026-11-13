import { useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { FormDialog } from '../../components/FormDialog';
import { formatNumber } from '../../lib/format';
import { RETURN_ACTION_LABELS } from '../../lib/orderFlow';
import type { OrderItem } from './types';

export type ReturnAction = keyof typeof RETURN_ACTION_LABELS;
export interface ReturnLine {
  order_item_id: number;
  action: ReturnAction;
}

interface Props {
  open: boolean;
  items: OrderItem[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (lines: ReturnLine[]) => void;
}

/** Trả hàng: mỗi dòng của đơn chọn "Nhập lại kho" hoặc "Hàng hỏng" (máy chủ yêu cầu đủ mọi dòng). */
export function ReturnDialog({ open, items, submitting, onClose, onSubmit }: Props) {
  const [actions, setActions] = useState<Record<number, ReturnAction>>({});
  const actionOf = (id: number): ReturnAction => actions[id] ?? 'RESTOCK';
  return (
    <FormDialog
      open={open}
      size="lg"
      title="Trả hàng"
      submitLabel="Xác nhận trả hàng"
      submitting={submitting}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(items.map((i) => ({ order_item_id: i.id, action: actionOf(i.id) })));
      }}
    >
      <p className="mb-3 text-sm text-muted">
        Chọn cách xử lý cho từng dòng hàng. Hàng nhập lại kho được cộng vào tồn; hàng hỏng không cộng tồn và được ghi nhận
        hao hụt. Doanh thu của đơn bị trừ vào ngày trả.
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 basis-48">
              <p className="truncate text-sm font-medium text-fg">{i.product_name}</p>
              <p className="text-xs text-muted">
                {i.sku} · SL {formatNumber(i.quantity)}
              </p>
            </div>
            <Field label="Xử lý" htmlFor={`return-${i.id}`} className="w-44">
              <select
                id={`return-${i.id}`}
                aria-label={`Xử lý ${i.sku}`}
                value={actionOf(i.id)}
                onChange={(e) => setActions((cur) => ({ ...cur, [i.id]: e.target.value as ReturnAction }))}
                className={inputClass}
              >
                {(Object.keys(RETURN_ACTION_LABELS) as ReturnAction[]).map((a) => (
                  <option key={a} value={a}>
                    {RETURN_ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </Field>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
