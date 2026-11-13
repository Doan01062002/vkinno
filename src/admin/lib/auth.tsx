import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { apiFetch } from './api';

export type Role = 'ADMIN' | 'STAFF';

/** Người dùng của phiên hiện tại (trùng `SessionUser` phía Worker). */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** Người dùng đang đăng nhập; `user` null khi chưa đăng nhập hoặc đang tải. */
export function useMe(): { user: SessionUser | null; isAdmin: boolean; isLoading: boolean } {
  const q = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<SessionUser>('/auth/me'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const user = q.data ?? null;
  return { user, isAdmin: user?.role === 'ADMIN', isLoading: q.isPending };
}

/** Đăng nhập; thành công thì ghi user vào cache `useMe`. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch<SessionUser>('/auth/login', { method: 'POST', json: input }),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(ME_QUERY_KEY, user);
    },
  });
}

/** Đăng xuất; xoá toàn bộ cache (dữ liệu của phiên cũ không được giữ lại). */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Record<string, never>>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(ME_QUERY_KEY, null);
    },
  });
}

/** Chỉ hiện `children` khi đã đăng nhập; chưa đăng nhập → về trang đăng nhập (nhớ trang đang mở). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Đang tải…</div>;
  }
  if (!user) return <Navigate to="/dang-nhap" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Chỉ ADMIN; STAFF bị chuyển về Tổng quan. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useMe();
  if (user && !isAdmin) return <Navigate to="/tong-quan" replace />;
  return <>{children}</>;
}
