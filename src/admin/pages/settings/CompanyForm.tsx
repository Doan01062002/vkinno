import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Field, inputClass } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { apiFetch, errorMessage } from '../../lib/api';
import { asString, SETTINGS_KEY, type SettingsMap } from './useSettings';

const TEXT_FIELDS = [
  { key: 'company.name', label: 'Tên công ty', max: 200 },
  { key: 'company.address', label: 'Địa chỉ', max: 500 },
  { key: 'company.phone', label: 'Số điện thoại', max: 30 },
  { key: 'company.tax_code', label: 'Mã số thuế', max: 20 },
  { key: 'company.bank_account', label: 'Số tài khoản ngân hàng', max: 40 },
  { key: 'company.bank_name', label: 'Ngân hàng', max: 100 },
  { key: 'print.invoice_footer', label: 'Chân trang phiếu in', max: 500 },
] as const;

/** Chỉ các khoá đã đổi so với giá trị đang lưu (khoá chưa đặt coi như chuỗi rỗng / false). */
export function changedSettings(initial: SettingsMap, text: Record<string, string>, showLogo: boolean): SettingsMap {
  const out: SettingsMap = {};
  for (const f of TEXT_FIELDS) {
    const next = (text[f.key] ?? '').trim();
    if (next !== asString(initial[f.key]).trim()) out[f.key] = next;
  }
  if (showLogo !== (initial['print.show_logo'] === true)) out['print.show_logo'] = showLogo;
  return out;
}

/** Thông tin công ty và mẫu in; chỉ gửi các khoá đã sửa. */
export function CompanyForm({ settings }: { settings: SettingsMap }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState<Record<string, string>>({});
  const [showLogo, setShowLogo] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setText(Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, asString(settings[f.key])])));
    setShowLogo(settings['print.show_logo'] === true);
  }, [settings]);

  const changes = changedSettings(settings, text, showLogo);
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: (body: SettingsMap) => apiFetch('/settings', { method: 'PUT', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [SETTINGS_KEY] });
      setError('');
      toast.success('Đã lưu cài đặt.');
    },
    onError: (e) => {
      setError(errorMessage(e));
      toast.error(e, { action: { label: 'Thử lại', onClick: () => save.mutate(changes) } });
    },
  });

  return (
    <form
      noValidate
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save.mutate(changes);
      }}
    >
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            htmlFor={`st-${f.key}`}
            className={f.key === 'company.address' || f.key === 'print.invoice_footer' ? 'sm:col-span-2' : ''}
          >
            <input
              id={`st-${f.key}`}
              value={text[f.key] ?? ''}
              maxLength={f.max}
              onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
              className={inputClass}
            />
          </Field>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} />
        Hiện logo trên phiếu in
      </label>
      <Button type="submit" loading={save.isPending} disabled={!dirty}>
        Lưu cài đặt
      </Button>
    </form>
  );
}
