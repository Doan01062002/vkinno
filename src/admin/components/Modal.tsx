import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<ModalSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Gọi khi bấm X, Esc hoặc nền mờ (không gọi khi `dismissible=false`). */
  onClose: () => void;
  size?: ModalSize;
  /** false khi đang lưu để tránh đóng giữa chừng. */
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** Hộp thoại nền: overlay, Esc để đóng, khoá cuộn trang, tự focus ô đầu tiên. Màn hẹp hiện dạng tấm dưới. */
export function Modal({ open, title, onClose, size = 'md', dismissible = true, children, footer }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select, textarea, [data-autofocus]',
    );
    (first ?? panelRef.current)?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissible]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-hidden
        onClick={dismissible ? () => onCloseRef.current() : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface text-fg shadow-xl outline-none sm:rounded-2xl ${WIDTH[size]}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Đóng"
            disabled={!dismissible}
            onClick={() => onCloseRef.current()}
            className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg disabled:opacity-40"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
