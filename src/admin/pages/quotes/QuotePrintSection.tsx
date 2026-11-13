import { PrintFrame } from '../../components/PrintFrame';
import { QuotePrint } from '../../print/QuotePrint';
import { useCompany } from '../../print/useCompany';
import type { CustomerRow } from '../customers/types';
import type { QuoteDetailData } from './types';

/** Xem trước và in/lưu PDF báo giá khổ A4 (hộp thoại in của trình duyệt có "Lưu thành PDF"). */
export function QuotePrintSection({ quote, customer }: { quote: QuoteDetailData; customer: CustomerRow | null }) {
  const company = useCompany();
  return (
    <PrintFrame paper="A4" printLabel="In / lưu PDF">
      <QuotePrint quote={quote} customer={customer} company={company} />
    </PrintFrame>
  );
}
