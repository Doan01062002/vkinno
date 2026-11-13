import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiClientError, apiFetch, errorMessage } from './api';
import { shouldRetry } from './queries';

export type Role = 'ADMIN' | 'STAFF';

/** Người dùng của phiên hiện tại (trùng `SessionUser` phía Worker). */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export interface MeState {
  /** null khi chưa đăng nhập, đang tải, hoặc không tải được. */
  user: SessionUser | null;
  isAdmin: boolean;
  isLoading: boolean;
  /** Lỗi không phải 401 (mất mạng, 5xx): KHÔNG chuyển về đăng nhập, hiện nút thử lại. */
  error: unknown;
  refetch: () => void;
}

/** Người dùng đang đăng nhập. Lỗi mạng/5xx được thử lại (shouldRetry); 401 thì apiFetch chuyển về đăng nhập. */
export function useMe(): MeState {
  const q = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<SessionUser>('/auth/me'),
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
  const user = q.data ?? null;
  const unauthorized = q.error instanceof ApiClientError && q.error.status === 401;
  return {
    user,
    isAdmin: user?.role === 'ADMIN',
    isLoading: q.isPending,
    error: q.isError && !unauthorized ? q.error : null,
    refetch: () => void q.refetch(),
  };
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

/**
 * Chỉ hiện `children` khi đã đăng nhập; chưa đăng nhập (401) → về trang đăng nhập (nhớ trang đang mở);
 * mất mạng/lỗi máy chủ → thông báo kèm nút "Thử lại", giữ nguyên đường dẫn.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading, error, refetch } = useMe();
  const location = useLocation();
  if (user) return <>{children}</>;
  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Đang tải…</div>;
  }
  if (error) {
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-fg">{errorMessage(error)}</p>
        <button
          type="button"
          onClick={refetch}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
        >
          Thử lại
        </button>
      </div>
    );
  }
  return <Navigate to="/dang-nhap" replace state={{ from: location.pathname + location.search }} />;
}

/** Chỉ ADMIN; STAFF bị chuyển về Tổng quan. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useMe();
  if (user && !isAdmin) return <Navigate to="/tong-quan" replace />;
  return <>{children}</>;
}
