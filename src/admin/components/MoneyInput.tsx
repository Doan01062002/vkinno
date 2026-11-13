import { useCallback, useLayoutEffect, useReducer, useRef, type KeyboardEvent, type Ref } from 'react';
import { formatNumber, parseVnd } from '../lib/format';
import { inputClass } from './Field';

export interface MoneyInputProps {
  /** Số nguyên VND; null = để trống. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Đánh dấu lỗi (viền đỏ). */
  invalid?: boolean;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Số chữ số đứng trước vị trí `pos`. */
function digitsBefore(text: string, pos: number): number {
  return (text.slice(0, pos).match(/\d/g) ?? []).length;
}

/** Vị trí ngay sau chữ số thứ `n` (0 → đầu chuỗi). */
function caretAfterDigits(text: string, n: number): number {
  if (n <= 0) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i])) {
      count += 1;
      if (count === n) return i + 1;
    }
  }
  return text.length;
}

function toValue(digits: string): number | null {
  const n = parseVnd(digits);
  return n !== null && n > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : n;
}

/**
 * Ô nhập tiền VND số nguyên, hiển thị nhóm hàng nghìn vi-VN ("1.250.000") kèm hậu tố ₫.
 * Con trỏ giữ đúng vị trí theo chữ số khi dấu chấm nhóm thay đổi; Backspace ngay sau dấu chấm xoá chữ số trước nó.
 * Dùng với react-hook-form qua `<Controller render={({ field }) => <MoneyInput {...field} />} />`.
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  id,
  name,
  placeholder = '0',
  disabled,
  invalid,
  className = '',
  ref,
}: MoneyInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Số chữ số phải đứng trước con trỏ sau lần vẽ tới. */
  const pendingCaret = useRef<number | null>(null);
  // Vẽ lại cả khi giá trị số không đổi (vd. gõ chữ cái) để đặt lại con trỏ.
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const display = value === null || value === undefined ? '' : formatNumber(value);

  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
    },
    [ref],
  );

  useLayoutEffect(() => {
    const el = inputRef.current;
    const n = pendingCaret.current;
    if (!el || n === null) return;
    pendingCaret.current = null;
    if (document.activeElement !== el) return;
    const pos = caretAfterDigits(el.value, n);
    el.setSelectionRange(pos, pos);
  });

  const commit = (digitsText: string, caretDigits: number) => {
    pendingCaret.current = caretDigits;
    onChange(toValue(digitsText));
    rerender();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Backspace') return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    if (start !== el.selectionEnd || start === 0 || /\d/.test(el.value[start - 1])) return;
    // Con trỏ ngay sau dấu chấm nhóm: xoá chữ số đứng trước dấu chấm.
    const n = digitsBefore(el.value, start);
    if (n === 0) return;
    e.preventDefault();
    const digits = el.value.replace(/\D/g, '');
    commit(digits.slice(0, n - 1) + digits.slice(n), n - 1);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={setRefs}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={display}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const raw = e.target.value;
          const caret = e.target.selectionStart ?? raw.length;
          // Số 0 ở đầu bị bỏ khi định dạng nên trừ đi để con trỏ không lệch.
          const leadingZeros = (raw.replace(/\D/g, '').match(/^0+(?=\d)/)?.[0].length ?? 0);
          const before = Math.max(0, digitsBefore(raw, caret) - leadingZeros);
          commit(raw, before);
        }}
        onBlur={onBlur}
        className={`${inputClass} pr-8 text-right tabular-nums`}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">₫</span>
    </div>
  );
}
