import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Layout } from './components/Layout';
import { PageHeader } from './components/PageHeader';
import { ToastProvider } from './components/Toast';
import { LOGIN_PATH, setUnauthorizedHandler } from './lib/api';
import { ME_QUERY_KEY, RequireAdmin, RequireAuth } from './lib/auth';
import { createQueryClient } from './lib/queries';
import { Login } from './pages/Login';
import { menuItem, ROUTES } from './routes';

export const BASENAME = '/quan-tri';

/** Phiên hết hạn (401) → xoá user khỏi cache và về trang đăng nhập, nhớ trang đang mở. */
function UnauthorizedBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler((to) => {
      qc.setQueryData(ME_QUERY_KEY, null);
      const target = to.startsWith(BASENAME) ? to.slice(BASENAME.length) || '/' : to;
      if (location.pathname !== target) {
        navigate(target, { replace: true, state: { from: location.pathname + location.search } });
      }
    });
  }, [navigate, location, qc]);
  return null;
}

function NotFound() {
  return (
    <>
      <PageHeader title="Không tìm thấy trang" />
      <p className="text-sm text-muted">
        Đường dẫn không tồn tại.{' '}
        <Link to="/tong-quan" className="text-primary hover:underline">
          Về Tổng quan
        </Link>
      </p>
    </>
  );
}

/** Ứng dụng quản trị: React Query + toast + router (`basename="/quan-tri"`). */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter basename={BASENAME}>
          <UnauthorizedBridge />
          <Routes>
            <Route path={LOGIN_PATH.slice(BASENAME.length + 1)} element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/tong-quan" replace />} />
              {ROUTES.map((r) => (
                <Route
                  key={r.path}
                  path={r.path}
                  element={menuItem(r.section)?.adminOnly ? <RequireAdmin>{r.element}</RequireAdmin> : r.element}
                />
              ))}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
