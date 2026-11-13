import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import { apiFetch } from '../../lib/api';
import { SETTINGS_KEY, type SettingsMap } from './useSettings';

/** Bật/tắt thông báo Telegram (lưu ngay khi bấm). */
export function TelegramForm({ settings }: { settings: SettingsMap }) {
  const qc = useQueryClient();
  const toast = useToast();
  const enabled = settings['telegram.enabled'] === true;
  const save = useMutation({
    mutationFn: (value: boolean) => apiFetch('/settings', { method: 'PUT', json: { 'telegram.enabled': value } }),
    onSuccess: (_d, value) => {
      void qc.invalidateQueries({ queryKey: [SETTINGS_KEY] });
      toast.success(value ? 'Đã bật thông báo Telegram.' : 'Đã tắt thông báo Telegram.');
    },
    onError: (e, value) => toast.error(e, { action: { label: 'Thử lại', onClick: () => save.mutate(value) } }),
  });
  return (
    <div className="max-w-2xl space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-fg">
        <input type="checkbox" checked={enabled} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
        Gửi thông báo đơn mới và thanh toán qua Telegram
      </label>
      <p className="text-sm text-muted">Token bot và chat ID được cấu hình ở biến môi trường của máy chủ, không nhập tại đây.</p>
    </div>
  );
}
