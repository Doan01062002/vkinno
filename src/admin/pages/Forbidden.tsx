import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import { buttonClass } from '../components/Button';
import { PageHeader } from '../components/PageHeader';

/** Trang hiện cho STAFF khi mở thẳng URL của màn hình chỉ dành cho ADMIN. */
export function Forbidden() {
  return (
    <>
      <PageHeader title="Không có quyền" />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface px-6 py-16 text-center">
        <ShieldAlert size={32} className="text-muted" aria-hidden />
        <p className="text-sm text-muted">Bạn không có quyền truy cập màn hình này. Liên hệ quản trị viên nếu cần.</p>
        <Link to="/tong-quan" className={buttonClass('secondary')}>
          Về Tổng quan
        </Link>
      </div>
    </>
  );
}
