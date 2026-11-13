import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';

type ToastKind = 'success' | 'error' | 'info';

/** Nút trong thông báo, vd. `{ label: 'Thử lại', onClick: () => q.refetch() }`. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export interface ToastApi {
  success: (message: string, opts?: ToastOptions) => void;
  /** Nhận chuỗi hoặc lỗi bất kỳ (ApiClientError → message tiếng Việt của API). */
  error: (messageOrError: unknown, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLE: Record<ToastKind, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success' },
  error: { icon: XCircle, className: 'text-danger' },
  info: { icon: Info, className: 'text-primary' },
};

/**
 * Bọc ứng dụng để dùng `useToast()`. Thông báo tự ẩn sau 4 giây (lỗi: 6 giây, có nút thao tác: 10 giây).
 * Lỗi dùng `role="alert"`, còn lại `role="status"`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, message: string, opts?: ToastOptions) => {
      seq.current += 1;
      const id = seq.current;
      setItems((list) => [...list.slice(-3), { id, kind, message, action: opts?.action }]);
      setTimeout(() => dismiss(id), opts?.action ? 10000 : kind === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (e, o) => push('error', typeof e === 'string' ? e : errorMessage(e), o),
      info: (m, o) => push('info', m, o),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="vk-no-print pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:items-end">
        {items.map((t) => {
          const { icon: Icon, className } = STYLE[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-lg"
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${className}`} aria-hidden />
              <p className="flex-1">{t.message}</p>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="shrink-0 font-medium text-primary hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Đóng thông báo"
                onClick={() => dismiss(t.id)}
                className="text-muted hover:text-fg"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast.success('Đã lưu'); toast.error(err, { action: { label: 'Thử lại', onClick: retry } });` */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast phải nằm trong <ToastProvider>');
  return ctx;
}
