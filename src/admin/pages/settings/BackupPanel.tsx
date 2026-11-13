import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup } from 'lucide-react';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { apiFetch } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';

interface LatestBackup {
  key: string;
  uploaded: string;
  size: number;
}

const LATEST_KEY = ['/backup/latest'];
const kb = (b: number) => formatNumber(Math.max(1, Math.round(b / 1024)));

/** Sao lưu thủ công: tạo bản sao dữ liệu lên R2 ngay (ngoài lịch tự động hằng đêm). */
export function BackupPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const latest = useQuery({ queryKey: LATEST_KEY, queryFn: () => apiFetch<LatestBackup | null>('/backup/latest') });
  const run = useMutation({
    mutationFn: () => apiFetch<{ key: string; bytes: number }>('/backup/run', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LATEST_KEY });
      toast.success('Đã sao lưu dữ liệu.');
    },
    onError: (e) => toast.error(e, { action: { label: 'Thử lại', onClick: () => run.mutate() } }),
  });
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-muted">Hệ thống tự sao lưu mỗi đêm và giữ 90 ngày. Bấm nút dưới để tạo thêm một bản ngay bây giờ.</p>
      {latest.isSuccess && (
        <p className="text-sm text-fg">
          {latest.data ? (
            <>
              Bản sao lưu gần nhất: <code className="font-mono">{latest.data.key}</code> · {formatDate(latest.data.uploaded)} ·{' '}
              {kb(latest.data.size)} KB
            </>
          ) : (
            'Bản sao lưu gần nhất: chưa có.'
          )}
        </p>
      )}
      {latest.isError && <p className="text-sm text-danger">Không tải được thông tin bản sao lưu gần nhất.</p>}
      <Button onClick={() => run.mutate()} loading={run.isPending}>
        <DatabaseBackup size={16} aria-hidden /> Sao lưu ngay
      </Button>
      {run.data && (
        <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-fg">
          Đã tạo bản sao lưu <code className="font-mono">{run.data.key}</code> ({kb(run.data.bytes)} KB).
        </p>
      )}
    </div>
  );
}
