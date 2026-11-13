import { Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

export type PaperSize = 'A4' | 'A5' | '80mm';

const SCREEN_WIDTH: Record<PaperSize, string> = {
  A4: 'max-w-[210mm]',
  A5: 'max-w-[148mm]',
  '80mm': 'max-w-[80mm]',
};

export interface PrintFrameProps {
  /** Nội dung phiếu cần in (phiếu giao hàng, phiếu kho, báo giá…). */
  children: ReactNode;
  /** Khổ giấy (đặt `@page size`), mặc định A4. */
  paper?: PaperSize;
  /** Nhãn nút in (mặc định "In"). */
  printLabel?: string;
  /** Nút thêm cạnh nút in (ẩn khi in). */
  toolbar?: ReactNode;
}

/**
 * Khung xem trước + in bằng `window.print()`. CSS `@media print` (admin.css) chỉ in phần
 * `.vk-print-area`, ẩn menu, header và thanh công cụ.
 */
export function PrintFrame({ children, paper = 'A4', printLabel = 'In', toolbar }: PrintFrameProps) {
  const pageSize = paper === '80mm' ? '80mm auto' : paper;
  return (
    <div className="space-y-3">
      <style>{`@media print { @page { size: ${pageSize}; margin: ${paper === '80mm' ? '4mm' : '12mm'}; } }`}</style>
      <div className="vk-no-print flex flex-wrap items-center justify-end gap-2">
        {toolbar}
        <Button onClick={() => window.print()}>
          <Printer size={16} aria-hidden />
          {printLabel}
        </Button>
      </div>
      <div
        className={`vk-print-area mx-auto w-full rounded-lg border border-line bg-white p-6 text-black shadow-sm ${SCREEN_WIDTH[paper]}`}
      >
        {children}
      </div>
    </div>
  );
}
