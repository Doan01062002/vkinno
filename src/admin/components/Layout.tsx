import { ChevronRight, LogOut, Menu as MenuIcon, Moon, Sun, Warehouse, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, matchPath, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { menuItem, ROUTES, visibleMenu } from '../routes';
import { useToast } from './Toast';

/** Tìm route đang mở để dựng breadcrumb: "Quản trị › Đơn hàng › Chi tiết đơn". */
function useCrumbs(): { label: string; to?: string }[] {
  const { pathname } = useLocation();
  const hit = ROUTES.find((r) => matchPath({ path: `/${r.path}`, end: true }, pathname));
  if (!hit) return [{ label: 'Quản trị' }];
  const section = menuItem(hit.section);
  const crumbs: { label: string; to?: string }[] = [{ label: 'Quản trị', to: '/tong-quan' }];
  if (section && section.label !== hit.title) crumbs.push({ label: section.label, to: `/${section.slug}` });
  crumbs.push({ label: hit.title });
  return crumbs;
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { isAdmin } = useMe();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
          <Warehouse size={16} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-fg">VKINNO</p>
          <p className="truncate text-xs text-muted">Quản trị kho & bán hàng</p>
        </div>
      </div>
      <nav aria-label="Menu chính" className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {visibleMenu(isAdmin).map((item) => (
          <NavLink
            key={item.slug}
            to={`/${item.slug}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
                isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-subtle hover:text-fg'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-primary" aria-hidden />}
                <item.icon size={18} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Vỏ ứng dụng: menu trái (ngăn kéo trên điện thoại), đầu trang có breadcrumb, chế độ tối, đăng xuất. */
export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, isAdmin } = useMe();
  const { theme, toggle } = useTheme();
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const crumbs = useCrumbs();

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const onLogout = () =>
    logout.mutate(undefined, {
      onSuccess: () => navigate('/dang-nhap', { replace: true }),
      onError: (e) => toast.error(e),
    });

  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      <a
        href="#noi-dung"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Bỏ qua menu
      </a>

      {/* Menu trái cố định trên màn hình rộng */}
      <aside className="vk-no-print sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-surface md:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      {/* Ngăn kéo trên điện thoại */}
      {drawerOpen && (
        <div className="vk-no-print fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface shadow-xl">
            <button
              type="button"
              aria-label="Đóng menu"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 rounded-lg p-1.5 text-muted hover:bg-subtle"
            >
              <X size={18} aria-hidden />
            </button>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="vk-no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-5">
          <button
            type="button"
            aria-label="Mở menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg md:hidden"
          >
            <MenuIcon size={20} aria-hidden />
          </button>

          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1 text-sm">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />}
                  {c.to && i < crumbs.length - 1 ? (
                    <Link to={c.to} className="truncate text-muted hover:text-fg">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-fg" aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            title={theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}
            className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg"
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>

          {user && (
            <div className="hidden text-right leading-tight sm:block">
              <p className="max-w-[160px] truncate text-sm font-medium text-fg">{user.name}</p>
              <p className="text-xs text-muted">{isAdmin ? 'Quản trị viên' : 'Nhân viên'}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onLogout}
            disabled={logout.isPending}
            aria-label="Đăng xuất"
            title="Đăng xuất"
            className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-danger disabled:opacity-50"
          >
            <LogOut size={18} aria-hidden />
          </button>
        </header>

        <main id="noi-dung" className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
