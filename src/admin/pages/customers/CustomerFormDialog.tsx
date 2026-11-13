import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { FormDialog } from '../../components/FormDialog';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { ApiClientError, apiFetch, fieldErrors } from '../../lib/api';
import { CUSTOMER_TYPE_LABELS, PRICE_TIER_LABELS, type CustomerRow } from './types';

interface Props {
  open: boolean;
  /** null = tạo mới. */
  customer: CustomerRow | null;
  onClose: () => void;
  onSaved?: (c: CustomerRow) => void;
}

interface Values {
  type: string;
  phone: string;
  name: string;
  email: string;
  address: string;
  price_tier: string;
  note: string;
  company_name: string;
  tax_code: string;
  credit_limit_vnd: number | null;
  payment_terms_days: string;
}

const EMPTY: Values = {
  type: 'RETAIL',
  phone: '',
  name: '',
  email: '',
  address: '',
  price_tier: 'RETAIL',
  note: '',
  company_name: '',
  tax_code: '',
  credit_limit_vnd: 0,
  payment_terms_days: '0',
};

const toValues = (c: CustomerRow | null): Values =>
  c
    ? {
        type: c.type,
        phone: c.phone,
        name: c.name,
        email: c.email,
        address: c.address,
        price_tier: c.price_tier,
        note: c.note,
        company_name: c.company_name,
        tax_code: c.tax_code,
        credit_limit_vnd: c.credit_limit_vnd,
        payment_terms_days: String(c.payment_terms_days),
      }
    : EMPTY;

/** Tạo/sửa khách hàng. Trường công nợ (công ty, MST, hạn mức, số ngày nợ) chỉ hiện và chỉ gửi khi là khách sỉ. */
export function CustomerFormDialog({ open, customer, onClose, onSaved }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState<Values>(toValues(customer));
  // Khách mới chưa tự chọn bảng giá: đổi sang khách sỉ thì mặc định giá sỉ.
  const [tierChosen, setTierChosen] = useState(customer !== null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    if (!open) return;
    setV(toValues(customer));
    setTierChosen(customer !== null);
    setErrors({});
    setServerError('');
    // Khởi tạo lại mỗi lần mở hộp thoại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((cur) => ({ ...cur, [k]: value }));
  const b2b = v.type === 'B2B';

  const save = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<CustomerRow>(customer ? `/customers/${customer.id}` : '/customers', {
        method: customer ? 'PUT' : 'POST',
        json: body,
      }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['/customers'] });
      toast.success(customer ? 'Đã cập nhật khách hàng.' : 'Đã thêm khách hàng.');
      onSaved?.(saved);
      onClose();
    },
    onError: (e, body) => {
      setErrors(fieldErrors(e));
      setServerError(e instanceof ApiClientError ? e.message : '');
      if (e instanceof ApiClientError && e.status === 0) {
        toast.error(e, { action: { label: 'Thử lại', onClick: () => save.mutate(body) } });
      } else toast.error(e);
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!v.phone.trim()) next.phone = 'Vui lòng nhập số điện thoại.';
    if (!v.name.trim()) next.name = 'Vui lòng nhập tên khách.';
    const days = Number(v.payment_terms_days);
    if (b2b) {
      if (v.credit_limit_vnd === null) next.credit_limit_vnd = 'Vui lòng nhập hạn mức công nợ (từ 0).';
      if (!Number.isInteger(days) || days < 0 || v.payment_terms_days.trim() === '') {
        next.payment_terms_days = 'Số ngày nợ phải là số nguyên từ 0.';
      }
    }
    setErrors(next);
    setServerError('');
    if (Object.keys(next).length > 0) return;
    save.mutate({
      type: v.type,
      phone: v.phone.trim(),
      name: v.name.trim(),
      email: v.email.trim(),
      address: v.address.trim(),
      price_tier: v.price_tier,
      note: v.note.trim(),
      ...(b2b
        ? {
            company_name: v.company_name.trim(),
            tax_code: v.tax_code.trim(),
            credit_limit_vnd: v.credit_limit_vnd ?? 0,
            payment_terms_days: days,
          }
        : {}),
    });
  };

  return (
    <FormDialog
      open={open}
      title={customer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
      size="lg"
      submitting={save.isPending}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {serverError && Object.keys(errors).length === 0 && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-2">
            {serverError}
          </p>
        )}
        <Field label="Loại khách hàng" htmlFor="cus-type">
          <select
            id="cus-type"
            value={v.type}
            onChange={(e) => {
              const type = e.target.value;
              setV((cur) => ({ ...cur, type, price_tier: tierChosen ? cur.price_tier : type === 'B2B' ? 'WHOLESALE' : 'RETAIL' }));
            }}
            className={inputClass}
          >
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bảng giá" htmlFor="cus-tier">
          <select
            id="cus-tier"
            value={v.price_tier}
            onChange={(e) => {
              setTierChosen(true);
              set('price_tier', e.target.value);
            }}
            className={inputClass}
          >
            {Object.entries(PRICE_TIER_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Số điện thoại" htmlFor="cus-phone" required error={errors.phone}>
          <input
            id="cus-phone"
            inputMode="tel"
            value={v.phone}
            onChange={(e) => set('phone', e.target.value)}
            className={inputClass}
            aria-invalid={errors.phone ? true : undefined}
          />
        </Field>
        <Field label="Tên khách" htmlFor="cus-name" required error={errors.name}>
          <input
            id="cus-name"
            value={v.name}
            onChange={(e) => set('name', e.target.value)}
            className={inputClass}
            aria-invalid={errors.name ? true : undefined}
          />
        </Field>
        <Field label="Email" htmlFor="cus-email" error={errors.email}>
          <input id="cus-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Địa chỉ" htmlFor="cus-address" error={errors.address}>
          <input id="cus-address" value={v.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
        </Field>
        {b2b && (
          <>
            <Field label="Tên công ty" htmlFor="cus-company" error={errors.company_name}>
              <input id="cus-company" value={v.company_name} onChange={(e) => set('company_name', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Mã số thuế" htmlFor="cus-tax" error={errors.tax_code}>
              <input id="cus-tax" value={v.tax_code} onChange={(e) => set('tax_code', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Hạn mức công nợ" htmlFor="cus-limit" required error={errors.credit_limit_vnd} hint="0 = không giới hạn.">
              <MoneyInput id="cus-limit" value={v.credit_limit_vnd} onChange={(n) => set('credit_limit_vnd', n)} invalid={!!errors.credit_limit_vnd} />
            </Field>
            <Field label="Số ngày nợ" htmlFor="cus-days" required error={errors.payment_terms_days} hint="Hạn thanh toán tính từ lúc đóng gói đơn.">
              <input
                id="cus-days"
                type="number"
                min={0}
                step={1}
                value={v.payment_terms_days}
                onChange={(e) => set('payment_terms_days', e.target.value)}
                className={inputClass}
                aria-invalid={errors.payment_terms_days ? true : undefined}
              />
            </Field>
          </>
        )}
        <Field label="Ghi chú" htmlFor="cus-note" className="sm:col-span-2" error={errors.note}>
          <textarea id="cus-note" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} className={inputClass} />
        </Field>
      </div>
    </FormDialog>
  );
}
