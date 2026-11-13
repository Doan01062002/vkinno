import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Nội dung giải thích hậu quả. */
  message: ReactNode;
  /** Mặc định "Xác nhận". */
  confirmLabel?: string;
  /** Mặc định "Huỷ". */
  cancelLabel?: string;
  /** Nút xác nhận màu đỏ (huỷ đơn, xoá…). */
  danger?: boolean;
  /** Đang xử lý: khoá nút, không cho đóng. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Hộp thoại xác nhận trước thao tác không hoàn tác được. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-sm">
        {danger && <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
        <div className="text-fg">{message}</div>
      </div>
    </Modal>
  );
}
