import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { ApiClientError, apiFetch } from '../../lib/api';
import {
  QUOTE_TRANSITIONS,
  canConvertQuote,
  nextQuoteStatuses,
  type QuoteTarget,
} from '../../lib/quoteFlow';
import { quoteKey, type QuoteDetailData } from './types';

interface Props {
  quote: QuoteDetailData;
  /** Có thay đổi chưa lưu: các thao tác dùng bản đã lưu nên bị khoá. */
  dirty: boolean;
}

/** Nút đổi trạng thái (theo bảng quoteFlow) và "Chuyển thành đơn" của một báo giá đã lưu. */
export function QuoteActions({ quote, dirty }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<QuoteTarget | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');

  const fail = (e: unknown, retry: () => void) => {
    setError(e instanceof ApiClientError ? e.message : '');
    // Trạng thái/hạn/kho có thể đã đổi: tải lại để màn hình đúng với máy chủ.
    void qc.invalidateQueries({ queryKey: quoteKey(quote.id) });
    if (e instanceof ApiClientError && e.status === 0) {
      toast.error(e, { action: { label: 'Thử lại', onClick: retry } });
    } else toast.error(e);
  };

  const status = useMutation({
    mutationFn: (to: QuoteTarget) =>
      apiFetch<QuoteDetailData>(`/quotes/${quote.id}/status`, { method: 'POST', json: { to } }),
    onSuccess: (updated, to) => {
      setConfirm(null);
      setError('');
      qc.setQueryData(quoteKey(quote.id), updated);
      void qc.invalidateQueries({ queryKey: ['/quotes'] });
      toast.success(`Báo giá ${updated.code}: ${QUOTE_TRANSITIONS[to].label.toLowerCase()}.`);
    },
    onError: (e, to) => {
      setConfirm(null);
      fail(e, () => status.mutate(to));
    },
  });

  const convert = useMutation({
    mutationFn: () => apiFetch<{ quote: QuoteDetailData; order: { id: number; order_code: string } }>(`/quotes/${quote.id}/convert`, { method: 'POST' }),
    onSuccess: ({ order }) => {
      setConverting(false);
      setError('');
      void qc.invalidateQueries({ queryKey: ['/quotes'] });
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      void qc.invalidateQueries({ queryKey: ['product-picker'] });
      void qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/inventory'),
      });
      toast.success(`Đã tạo đơn ${order.order_code} từ báo giá.`);
      navigate(`/don-hang/${order.id}`);
    },
    onError: (e) => {
      setConverting(false);
      fail(e, () => convert.mutate());
    },
  });

  const nexts = nextQuoteStatuses(quote.status);
  const busy = status.isPending || convert.isPending;
  const canConvert = canConvertQuote(quote.status);
  if (nexts.length === 0 && !canConvert && !error) return null;

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Thao tác báo giá">
        {nexts.map((to) => (
          <Button key={to} variant={QUOTE_TRANSITIONS[to].danger ? 'danger' : 'secondary'} disabled={busy || dirty} onClick={() => setConfirm(to)}>
            {QUOTE_TRANSITIONS[to].label}
          </Button>
        ))}
        {canConvert && (
          <Button disabled={busy || dirty} onClick={() => setConverting(true)}>
            <ArrowRightLeft size={16} aria-hidden />
            Chuyển thành đơn
          </Button>
        )}
        {dirty && <span className="text-xs text-muted">Lưu thay đổi trước khi đổi trạng thái hoặc chuyển thành đơn.</span>}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? QUOTE_TRANSITIONS[confirm].title : ''}
        message={confirm ? QUOTE_TRANSITIONS[confirm].message : ''}
        danger={confirm ? QUOTE_TRANSITIONS[confirm].danger : false}
        busy={status.isPending}
        onConfirm={() => confirm && status.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={converting}
        title="Chuyển thành đơn hàng"
        message="Hệ thống tạo đơn B2B với giá và số lượng trong báo giá, đồng thời giữ hàng trong kho. Bạn chắc chắn muốn chuyển?"
        confirmLabel="Chuyển thành đơn"
        busy={convert.isPending}
        onConfirm={() => convert.mutate()}
        onCancel={() => setConverting(false)}
      />
    </div>
  );
}
