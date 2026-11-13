import type { Ref } from 'react';
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

/**
 * Ô nhập tiền VND số nguyên, hiển thị nhóm hàng nghìn vi-VN ("1.250.000") kèm hậu tố ₫.
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
  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={value === null || value === undefined ? '' : formatNumber(value)}
        onChange={(e) => {
          const n = parseVnd(e.target.value);
          onChange(n !== null && n > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : n);
        }}
        onBlur={onBlur}
        className={`${inputClass} pr-8 text-right tabular-nums`}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">₫</span>
    </div>
  );
}
