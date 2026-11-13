import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field, inputClass } from '../../components/Field';
import { FormDialog } from '../../components/FormDialog';
import { useToast } from '../../components/Toast';
import { ApiClientError, apiFetch, fieldErrors } from '../../lib/api';

export interface SupplierRow {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  tax_code: string;
  note: string;
  is_active: number;
  created_at: string;
}

interface Props {
  open: boolean;
  /** null = tạo mới. */
  supplier: SupplierRow | null;
  onClose: () => void;
}

interface Values {
  name: string;
  phone: string;
  email: string;
  address: string;
  tax_code: string;
  note: string;
  is_active: boolean;
}

const toValues = (s: SupplierRow | null): Values => ({
  name: s?.name ?? '',
  phone: s?.phone ?? '',
  email: s?.email ?? '',
  address: s?.address ?? '',
  tax_code: s?.tax_code ?? '',
  note: s?.note ?? '',
  is_active: s ? s.is_active === 1 : true,
});

/** Tạo/sửa nhà cung cấp. */
export function SupplierFormDialog({ open, supplier, onClose }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState<Values>(toValues(supplier));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    if (!open) return;
    setV(toValues(supplier));
    setErrors({});
    setServerError('');
    // Khởi tạo lại mỗi lần mở hộp thoại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((cur) => ({ ...cur, [k]: value }));

  const save = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<SupplierRow>(supplier ? `/suppliers/${supplier.id}` : '/suppliers', {
        method: supplier ? 'PUT' : 'POST',
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/suppliers'] });
      toast.success(supplier ? 'Đã cập nhật nhà cung cấp.' : 'Đã thêm nhà cung cấp.');
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

  return (
    <FormDialog
      open={open}
      title={supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      submitting={save.isPending}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.name.trim()) {
          setErrors({ name: 'Vui lòng nhập tên nhà cung cấp.' });
          return;
        }
        setErrors({});
        setServerError('');
        save.mutate({
          name: v.name.trim(),
          phone: v.phone.trim(),
          email: v.email.trim(),
          address: v.address.trim(),
          tax_code: v.tax_code.trim(),
          note: v.note.trim(),
          is_active: v.is_active ? 1 : 0,
        });
      }}
    >
      <div className="space-y-4">
        {serverError && Object.keys(errors).length === 0 && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {serverError}
          </p>
        )}
        <Field label="Tên nhà cung cấp" htmlFor="sup-name" required error={errors.name}>
          <input id="sup-name" value={v.name} onChange={(e) => set('name', e.target.value)} className={inputClass} aria-invalid={errors.name ? true : undefined} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Số điện thoại" htmlFor="sup-phone" error={errors.phone}>
            <input id="sup-phone" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Email" htmlFor="sup-email" error={errors.email}>
            <input id="sup-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Mã số thuế" htmlFor="sup-tax" error={errors.tax_code}>
            <input id="sup-tax" value={v.tax_code} onChange={(e) => set('tax_code', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Địa chỉ" htmlFor="sup-address" error={errors.address}>
            <input id="sup-address" value={v.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Ghi chú" htmlFor="sup-note" error={errors.note}>
          <textarea id="sup-note" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={v.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Đang hợp tác
        </label>
      </div>
    </FormDialog>
  );
}
