import type { ReactNode } from 'react';

/** Lớp chuẩn cho input/select/textarea. */
export const inputClass =
  'block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

export interface FieldProps {
  /** Nhãn hiển thị. */
  label: ReactNode;
  /** `id` của ô nhập để gắn nhãn. */
  htmlFor?: string;
  /** Thông báo lỗi (từ react-hook-form hoặc `fieldErrors`). */
  error?: string;
  /** Gợi ý dưới ô nhập. */
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Nhãn + ô nhập + lỗi/gợi ý, dùng trong FormDialog và các form. */
export function Field({ label, htmlFor, error, hint, required, className = '', children }: FieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
