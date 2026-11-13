import { NavLink } from 'react-router';

const TABS = [
  { to: '/cai-dat', label: 'Công ty & mẫu in', end: true },
  { to: '/cai-dat/telegram', label: 'Telegram', end: false },
  { to: '/cai-dat/file-san', label: 'File sàn', end: false },
  { to: '/cai-dat/tai-khoan', label: 'Tài khoản', end: false },
  { to: '/cai-dat/nhat-ky', label: 'Nhật ký', end: false },
  { to: '/cai-dat/sao-luu', label: 'Sao lưu', end: false },
];

/** Thanh chuyển giữa các màn hình của mục Cài đặt. */
export function SettingsTabs() {
  return (
    <nav aria-label="Cài đặt" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap ${
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
