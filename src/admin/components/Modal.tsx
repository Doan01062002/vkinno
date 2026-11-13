import { X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<ModalSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Các hộp thoại đang mở, theo thứ tự mở: chỉ hộp trên cùng nhận Esc và giữ Tab. */
interface StackEntry {
  id: string;
  escape: () => void;
}
const modalStack: StackEntry[] = [];

function isTop(id: string): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1].id === id;
}

function onDocumentKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || modalStack.length === 0) return;
  e.stopPropagation();
  modalStack[modalStack.length - 1].escape();
}

function pushModal(entry: StackEntry) {
  if (modalStack.length === 0) document.addEventListener('keydown', onDocumentKeyDown);
  modalStack.push(entry);
}

function removeModal(id: string) {
  const i = modalStack.findIndex((m) => m.id === id);
  if (i >= 0) modalStack.splice(i, 1);
  if (modalStack.length === 0) document.removeEventListener('keydown', onDocumentKeyDown);
}

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

/**
 * Hộp thoại nền: overlay, khoá cuộn trang, giữ Tab/Shift+Tab trong hộp, trả focus về nút đã mở khi đóng.
 * Focus đầu tiên: phần tử `[data-autofocus]`, nếu không có thì ô nhập đầu tiên.
 * Mở chồng nhiều hộp: Esc chỉ đóng hộp trên cùng. Màn hẹp hiện dạng tấm dưới.
 */
export function Modal({ open, title, onClose, size = 'md', dismissible = true, children, footer }: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    pushModal({
      id,
      escape: () => {
        if (dismissibleRef.current) onCloseRef.current();
      },
    });
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea');
    (first ?? panel)?.focus();
    return () => {
      removeModal(id);
      document.body.style.overflow = prevOverflow;
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open, id]);

  /** Giữ Tab trong hộp trên cùng. */
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !isTop(id)) return;
    const panel = panelRef.current;
    if (!panel || !panel.contains(e.target as Node)) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstItem || active === panel)) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && (active === lastItem || active === panel)) {
      e.preventDefault();
      firstItem.focus();
    }
  };

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
        onKeyDown={onPanelKeyDown}
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
