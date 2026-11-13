import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useMe } from '../lib/auth';
import { DEFAULT_COMPANY, type CompanyInfo } from './types';

/** Thông tin công ty cho phiếu in. /settings chỉ dành cho ADMIN nên STAFF dùng tên mặc định. */
export function useCompany(): CompanyInfo {
  const { isAdmin } = useMe();
  const q = useQuery({
    queryKey: ['/settings', 'company'],
    enabled: isAdmin,
    retry: false,
    queryFn: () => apiFetch<Record<string, unknown>>('/settings'),
  });
  const s = q.data;
  const str = (k: string) => (typeof s?.[k] === 'string' ? (s[k] as string) : '');
  return {
    name: str('company.name') || DEFAULT_COMPANY.name,
    address: str('company.address'),
    phone: str('company.phone'),
  };
}
