import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { DEFAULT_COMPANY, type CompanyInfo } from './types';

/** Thông tin công ty cho phiếu in, từ /settings/print (mọi vai trò đọc được). */
export function useCompany(): CompanyInfo {
  const q = useQuery({
    // Khoá con của ['/settings'] để lưu cài đặt (invalidate theo tiền tố) làm mới phiếu in.
    queryKey: ['/settings', 'print'],
    retry: false,
    queryFn: () => apiFetch<Record<string, unknown>>('/settings/print'),
  });
  const s = q.data;
  const str = (k: string) => (typeof s?.[k] === 'string' ? (s[k] as string) : '');
  return {
    name: str('company.name') || DEFAULT_COMPANY.name,
    address: str('company.address'),
    phone: str('company.phone'),
  };
}
