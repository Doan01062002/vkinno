import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DEFAULT_COLUMN_MAPS, type Channel, type ColumnMap } from '../../../shared/marketplace';
import { Button } from '../../components/Button';
import { Field, inputClass } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { apiFetch, errorMessage } from '../../lib/api';
import { SETTINGS_KEY, type SettingsMap } from './useSettings';

const FIELD_LABELS: Record<keyof ColumnMap, string> = {
  order_id: 'Mã đơn',
  created_at: 'Ngày đặt',
  status: 'Trạng thái',
  sku: 'SKU',
  product_name: 'Tên sản phẩm',
  quantity: 'Số lượng',
  unit_price: 'Đơn giá',
  shipping_fee: 'Phí vận chuyển',
  buyer_name: 'Người nhận',
  buyer_phone: 'SĐT',
  address: 'Địa chỉ',
};
const FIELDS = Object.keys(FIELD_LABELS) as (keyof ColumnMap)[];
const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'SHOPEE', label: 'Shopee' },
  { id: 'TIKTOK', label: 'TikTok Shop' },
];

/** Ô trống khi lưu được điền bằng tên cột mặc định (API yêu cầu đủ mọi trường). */
export function completeMap(draft: Partial<ColumnMap>, channel: Channel): ColumnMap {
  const out = { ...DEFAULT_COLUMN_MAPS[channel] };
  for (const f of FIELDS) {
    const v = (draft[f] ?? '').trim();
    if (v) out[f] = v;
  }
  return out;
}

function ChannelEditor({ channel, label, stored }: { channel: Channel; label: string; stored: unknown }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isSet = !!stored && typeof stored === 'object';
  const [draft, setDraft] = useState<Partial<ColumnMap>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(isSet ? { ...(stored as ColumnMap) } : {});
  }, [stored, isSet]);

  const save = useMutation({
    mutationFn: (map: ColumnMap) => apiFetch('/settings', { method: 'PUT', json: { [`import.columns.${channel}`]: map } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [SETTINGS_KEY] });
      setError('');
      toast.success(`Đã lưu ánh xạ cột ${label}.`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label={`Ánh xạ cột ${label}`}>
      <h2 className="mb-1 text-sm font-semibold text-fg">{label}</h2>
      <p className="mb-3 text-sm text-muted">
        {isSet ? 'Đang dùng ánh xạ tuỳ chỉnh.' : 'Chưa tuỳ chỉnh: đang dùng tên cột mặc định (hiện mờ trong ô).'} Ô để trống sẽ dùng tên mặc
        định.
      </p>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f} label={FIELD_LABELS[f]} htmlFor={`cm-${channel}-${f}`}>
            <input
              id={`cm-${channel}-${f}`}
              value={draft[f] ?? ''}
              placeholder={DEFAULT_COLUMN_MAPS[channel][f]}
              onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
              className={inputClass}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button loading={save.isPending} onClick={() => save.mutate(completeMap(draft, channel))}>
          Lưu ánh xạ {label}
        </Button>
        <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate({ ...DEFAULT_COLUMN_MAPS[channel] })}>
          Khôi phục mặc định
        </Button>
      </div>
    </section>
  );
}

/** Ánh xạ cột file xuất của Shopee / TikTok Shop. */
export function ColumnMaps({ settings }: { settings: SettingsMap }) {
  return (
    <div className="max-w-3xl space-y-4">
      {CHANNELS.map((c) => (
        <ChannelEditor key={c.id} channel={c.id} label={c.label} stored={settings[`import.columns.${c.id}`]} />
      ))}
    </div>
  );
}
