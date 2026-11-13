/** Nhãn tiếng Việt dùng chung cho các màn hình Kho. */
export type DocType = 'RECEIPT' | 'ISSUE' | 'ADJUST' | 'STOCKTAKE';

export const DOC_TYPES: DocType[] = ['RECEIPT', 'ISSUE', 'ADJUST', 'STOCKTAKE'];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất khác / huỷ',
  ADJUST: 'Điều chỉnh',
  STOCKTAKE: 'Kiểm kê',
};

export const isDocType = (v: unknown): v is DocType => typeof v === 'string' && v in DOC_TYPE_LABELS;

export const REASON_LABELS: Record<string, string> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất khác / huỷ',
  ADJUST: 'Điều chỉnh',
  STOCKTAKE: 'Kiểm kê',
  SALE_OUT: 'Bán hàng',
  CANCEL_RESTOCK: 'Huỷ đơn, hoàn kho',
  RETURN_RESTOCK: 'Trả hàng, nhập lại kho',
  RETURN_DAMAGED: 'Trả hàng, hàng hỏng',
};
