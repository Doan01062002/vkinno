import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { ApiClientError, apiFetch, type ListResult, type QueryValue } from './api';

/** Không thử lại lỗi 4xx (dữ liệu/ quyền sai sẽ sai tiếp); lỗi mạng/5xx thử lại 1 lần. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/** Một QueryClient cho cả ứng dụng quản trị. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Danh sách phân trang phía máy chủ: `GET /api/admin<path>?page=&page_size=&q=&…`.
 * Khoá cache = `[path, params]`; giữ trang cũ khi đang tải trang mới.
 * Ví dụ: `useListQuery<Order>('/orders', { page, q, status })`.
 */
export function useListQuery<T>(path: string, params: Record<string, QueryValue> = {}) {
  return useQuery({
    queryKey: [path, params],
    queryFn: ({ signal }) => apiFetch<ListResult<T>>(path, { query: params, signal }),
    placeholderData: keepPreviousData,
  });
}
