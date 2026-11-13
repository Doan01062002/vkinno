import { NavLink } from 'react-router';

const TABS = [
  { to: '/kho', label: 'Tồn kho', end: true },
  { to: '/kho/phieu', label: 'Phiếu kho', end: false },
  { to: '/kho/nhap-xuat-ton', label: 'Nhập-xuất-tồn', end: false },
];

/** Thanh chuyển giữa các màn hình của mục Kho. */
export function KhoTabs() {
  return (
    <nav aria-label="Kho" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
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
