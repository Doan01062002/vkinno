import { useId, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal, type ModalSize } from './Modal';

export interface FormDialogProps {
  open: boolean;
  /** Vd. "Thêm khách hàng" / "Sửa khách hàng". */
  title: ReactNode;
  onClose: () => void;
  /** Thường là `handleSubmit(fn)` của react-hook-form; mặc định đã `preventDefault`. */
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** Nhãn nút lưu (mặc định "Lưu"). */
  submitLabel?: string;
  /** Đang gửi: khoá nút và không cho đóng. */
  submitting?: boolean;
  /** Khoá nút lưu (vd. form chưa đổi). */
  submitDisabled?: boolean;
  size?: ModalSize;
  /** Các `Field`. */
  children: ReactNode;
}

/** Hộp thoại thêm/sửa: form + nút Huỷ/Lưu ở chân (nút Lưu nằm ngoài form nhưng gắn qua `form=`). */
export function FormDialog({
  open,
  title,
  onClose,
  onSubmit,
  submitLabel = 'Lưu',
  submitting = false,
  submitDisabled = false,
  size = 'md',
  children,
}: FormDialogProps) {
  const formId = useId();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size={size}
      dismissible={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button type="submit" form={formId} loading={submitting} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(e);
        }}
      >
        {children}
      </form>
    </Modal>
  );
}
