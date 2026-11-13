import { useEffect, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { FormDialog } from '../../components/FormDialog';
import { MoneyInput } from '../../components/MoneyInput';
import { formatVnd } from '../../lib/format';
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../../lib/orderFlow';

export interface PaymentBody {
  kind: 'RECEIPT' | 'REFUND';
  amount_vnd: number;
  method: string;
  reference: string;
  note: string;
}

interface Props {
  /** null = đóng. */
  kind: 'RECEIPT' | 'REFUND' | null;
  /** Số mặc định: thu = còn phải thu, hoàn = đã thu. */
  defaultAmount: number;
  defaultMethod: string;
  submitting: boolean;
  /** Lỗi từ máy chủ, hiện ngay trong hộp thoại. */
  error?: string;
  /** Hoàn tiền không được vượt số này (số đã thu). */
  maxRefund: number;
  onClose: () => void;
  onSubmit: (body: PaymentBody) => void;
}

/** Hộp thoại "Thu tiền" / "Hoàn tiền" của đơn. */
export function PaymentDialog({ kind, defaultAmount, defaultMethod, submitting, error: serverError, maxRefund, onClose, onSubmit }: Props) {
  const [amount, setAmount] = useState<number | null>(defaultAmount);
  const [method, setMethod] = useState(defaultMethod);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!kind) return;
    setAmount(defaultAmount);
    setMethod((MANUAL_PAYMENT_METHODS as readonly string[]).includes(defaultMethod) ? defaultMethod : 'CASH');
    setReference('');
    setNote('');
    setError('');
    // Chỉ khởi tạo lại khi mở hộp thoại (kind đổi), không ghi đè khi dữ liệu đơn tải lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const label = kind === 'REFUND' ? 'Hoàn tiền' : 'Thu tiền';
  return (
    <FormDialog
      open={kind !== null}
      title={label}
      submitLabel={label}
      submitting={submitting}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!kind) return;
        if (!amount || amount <= 0) {
          setError('Số tiền phải lớn hơn 0.');
          return;
        }
        if (kind === 'REFUND' && amount > maxRefund) {
          setError(`Số tiền hoàn không được lớn hơn số đã thu (${formatVnd(maxRefund)}).`);
          return;
        }
        setError('');
        onSubmit({ kind, amount_vnd: amount, method, reference: reference.trim(), note: note.trim() });
      }}
    >
      <div className="space-y-4">
        {serverError && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {serverError}
          </p>
        )}
        <Field label="Số tiền" htmlFor="pay-amount" required error={error}>
          <MoneyInput id="pay-amount" value={amount} onChange={setAmount} invalid={!!error} />
        </Field>
        <Field label="Phương thức" htmlFor="pay-method">
          <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mã tham chiếu" htmlFor="pay-ref" hint="Mã giao dịch ngân hàng, nếu có.">
          <input id="pay-ref" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Ghi chú" htmlFor="pay-note">
          <input id="pay-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </FormDialog>
  );
}
