import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { inputClass } from '../../components/Field';
import { PrintFrame, type PaperSize } from '../../components/PrintFrame';
import { apiFetch } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { DeliveryNote } from '../../print/DeliveryNote';
import { PackingSlip } from '../../print/PackingSlip';
import { DEFAULT_COMPANY, type CompanyInfo } from '../../print/types';
import type { OrderDetailData } from './types';

type Doc = 'delivery' | 'packing';

/** Thông tin công ty cho phiếu in. /settings chỉ dành cho ADMIN nên STAFF dùng tên mặc định. */
function useCompany(): CompanyInfo {
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

/** In phiếu giao hàng hoặc phiếu đóng gói, khổ A5 hoặc A4. */
export function PrintSection({ order }: { order: OrderDetailData }) {
  const company = useCompany();
  const [doc, setDoc] = useState<Doc>('delivery');
  const [paper, setPaper] = useState<Extract<PaperSize, 'A5' | 'A4'>>('A5');
  return (
    <PrintFrame
      paper={paper}
      printLabel="In phiếu"
      toolbar={
        <>
          <select aria-label="Loại phiếu" value={doc} onChange={(e) => setDoc(e.target.value as Doc)} className={`${inputClass} w-44`}>
            <option value="delivery">Phiếu giao hàng</option>
            <option value="packing">Phiếu đóng gói</option>
          </select>
          <select aria-label="Khổ giấy" value={paper} onChange={(e) => setPaper(e.target.value as 'A5' | 'A4')} className={`${inputClass} w-28`}>
            <option value="A5">Khổ A5</option>
            <option value="A4">Khổ A4</option>
          </select>
        </>
      }
    >
      {doc === 'delivery' ? <DeliveryNote order={order} company={company} /> : <PackingSlip order={order} company={company} />}
    </PrintFrame>
  );
}
