import { Construction } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';

/** Trang tạm cho màn hình chưa xây (Task 16–19 thay bằng màn hình thật). */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
        <Construction size={32} className="text-muted" aria-hidden />
        <p className="text-sm text-muted">Màn hình này đang được xây dựng.</p>
      </div>
    </>
  );
}
