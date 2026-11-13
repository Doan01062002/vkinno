import { Trash2 } from 'lucide-react';
import { inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { formatNumber, formatVnd } from '../../lib/format';
import type { DocType } from './labels';

/** Một dòng đang soạn trong phiếu nháp (số lượng giữ dạng chuỗi để gõ dở vẫn hiển thị đúng). */
export interface LineState {
  sku: string;
  name: string;
  unit: string;
  /** RECEIPT/ISSUE: số lượng; ADJUST: độ lệch ±. */
  qty: string;
  unitCost: number | null;
  batch: string;
  expiry: string;
  /** STOCKTAKE: số đếm thực tế. */
  counted: string;
  /** STOCKTAKE: tồn hệ thống (null = đang tải). */
  system: number | null;
}

export interface ServerLine {
  sku: string;
  product_name?: string | null;
  qty: number;
  unit_cost_vnd?: number | null;
  batch_code: string;
  expiry_date: string;
  counted_qty: number | null;
  system_qty?: number | null;
}

const cell = 'px-3 py-2 align-middle';
const head = 'px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap';

export function diffOf(counted: string, system: number | null): number | null {
  if (counted.trim() === '' || system === null) return null;
  const n = Number(counted);
  return Number.isFinite(n) ? n - system : null;
}

function Diff({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <span
      aria-label={label}
      className={value === 0 ? 'text-muted' : value > 0 ? 'font-medium text-success' : 'font-medium text-danger'}
    >
      {value > 0 ? '+' : ''}
      {formatNumber(value)}
    </span>
  );
}

function Product({ sku, name, unit }: { sku: string; name: string; unit?: string }) {
  return (
    <div className="min-w-40">
      <p className="font-medium text-fg">{name || sku}</p>
      <p className="text-xs text-muted">
        {sku}
        {unit ? ` · ${unit}` : ''}
      </p>
    </div>
  );
}

export function DraftLines({
  type,
  lines,
  onChange,
}: {
  type: DocType;
  lines: LineState[];
  onChange: (lines: LineState[]) => void;
}) {
  const patch = (sku: string, p: Partial<LineState>) => onChange(lines.map((l) => (l.sku === sku ? { ...l, ...p } : l)));
  const remove = (sku: string) => onChange(lines.filter((l) => l.sku !== sku));
  if (lines.length === 0) {
    return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Chưa có dòng nào. Tìm sản phẩm bên dưới để thêm.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="border-b border-line bg-subtle">
          <tr>
            <th className={head}>Sản phẩm</th>
            {type === 'RECEIPT' && (
              <>
                <th className={head}>Số lượng</th>
                <th className={head}>Đơn giá nhập</th>
                <th className={head}>Mã lô</th>
                <th className={head}>Hạn sử dụng</th>
              </>
            )}
            {type === 'ISSUE' && <th className={head}>Số lượng xuất</th>}
            {type === 'ADJUST' && <th className={head}>Độ lệch (+ tăng, − giảm)</th>}
            {type === 'STOCKTAKE' && (
              <>
                <th className={head}>Tồn hệ thống</th>
                <th className={head}>Số đếm thực tế</th>
                <th className={head}>Chênh lệch (ước tính)</th>
              </>
            )}
            <th className={head}>
              <span className="sr-only">Xoá</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.sku}>
              <td className={cell}>
                <Product sku={l.sku} name={l.name} unit={l.unit} />
              </td>
              {(type === 'RECEIPT' || type === 'ISSUE' || type === 'ADJUST') && (
                <td className={cell}>
                  <input
                    type="number"
                    step={1}
                    value={l.qty}
                    onChange={(e) => patch(l.sku, { qty: e.target.value })}
                    aria-label={`Số lượng ${l.sku}`}
                    className={`${inputClass} w-28 min-w-[7rem]`}
                  />
                </td>
              )}
              {type === 'RECEIPT' && (
                <>
                  <td className={cell}>
                    <div className="w-40 min-w-[9rem]">
                      <MoneyInput
                        value={l.unitCost}
                        onChange={(v) => patch(l.sku, { unitCost: v })}
                        placeholder="Đơn giá"
                        id={`cost-${l.sku}`}
                      />
                    </div>
                  </td>
                  <td className={cell}>
                    <input
                      value={l.batch}
                      onChange={(e) => patch(l.sku, { batch: e.target.value })}
                      aria-label={`Mã lô ${l.sku}`}
                      className={`${inputClass} w-32 min-w-[8rem]`}
                    />
                  </td>
                  <td className={cell}>
                    <input
                      type="date"
                      value={l.expiry}
                      onChange={(e) => patch(l.sku, { expiry: e.target.value })}
                      aria-label={`Hạn sử dụng ${l.sku}`}
                      className={`${inputClass} w-40 min-w-[10rem]`}
                    />
                  </td>
                </>
              )}
              {type === 'STOCKTAKE' && (
                <>
                  <td className={cell} aria-label={`Tồn hệ thống ${l.sku}`}>
                    {l.system === null ? <span className="text-muted">Đang tải…</span> : formatNumber(l.system)}
                  </td>
                  <td className={cell}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={l.counted}
                      onChange={(e) => patch(l.sku, { counted: e.target.value })}
                      aria-label={`Số đếm ${l.sku}`}
                      className={`${inputClass} w-28 min-w-[7rem]`}
                    />
                  </td>
                  <td className={cell}>
                    <Diff value={diffOf(l.counted, l.system)} label={`Chênh lệch ${l.sku}`} />
                  </td>
                </>
              )}
              <td className={cell}>
                <button
                  type="button"
                  aria-label={`Xoá dòng ${l.sku}`}
                  onClick={() => remove(l.sku)}
                  className="text-muted hover:text-danger"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phiếu đã ghi sổ hoặc đã huỷ: chỉ xem. Giá nhập chỉ hiện khi API trả (ADMIN). */
export function ReadonlyLines({ type, lines }: { type: DocType; lines: ServerLine[] }) {
  const showCost = type === 'RECEIPT' && lines.some((l) => l.unit_cost_vnd != null);
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="border-b border-line bg-subtle">
          <tr>
            <th className={head}>Sản phẩm</th>
            {type === 'STOCKTAKE' ? (
              <>
                <th className={head}>Tồn hệ thống</th>
                <th className={head}>Số đếm thực tế</th>
                <th className={head}>Chênh lệch</th>
              </>
            ) : (
              <th className={head}>{type === 'ADJUST' ? 'Độ lệch' : 'Số lượng'}</th>
            )}
            {type === 'RECEIPT' && (
              <>
                {showCost && <th className={head}>Đơn giá nhập</th>}
                <th className={head}>Mã lô</th>
                <th className={head}>Hạn sử dụng</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {lines.map((l) => (
            <tr key={l.sku}>
              <td className={cell}>
                <Product sku={l.sku} name={l.product_name ?? ''} />
              </td>
              {type === 'STOCKTAKE' ? (
                <>
                  <td className={cell}>{l.system_qty == null ? '—' : formatNumber(l.system_qty)}</td>
                  <td className={cell}>{l.counted_qty == null ? '—' : formatNumber(l.counted_qty)}</td>
                  <td className={cell}>
                    <Diff
                      value={l.counted_qty == null || l.system_qty == null ? null : l.counted_qty - l.system_qty}
                      label={`Chênh lệch ${l.sku}`}
                    />
                  </td>
                </>
              ) : (
                <td className={cell}>{formatNumber(l.qty)}</td>
              )}
              {type === 'RECEIPT' && (
                <>
                  {showCost && <td className={cell}>{formatVnd(l.unit_cost_vnd)}</td>}
                  <td className={cell}>{l.batch_code || '—'}</td>
                  <td className={cell}>{l.expiry_date || '—'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
