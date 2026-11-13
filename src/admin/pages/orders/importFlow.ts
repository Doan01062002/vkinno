// Logic nhập file sàn ở trình duyệt: đọc xlsx/csv, chia nhóm ≤ MAX_IMPORT_ORDERS_PER_REQUEST đơn mỗi request
// (giới hạn truy vấn D1 của Workers gói Free) cho cả xem trước lẫn nhập.
import {
  MAX_IMPORT_ORDERS_PER_REQUEST,
  parseMarketplaceRows,
  type Channel,
  type ColumnMap,
  type ImportOrder,
  type ParseError,
} from '../../../shared/marketplace';
import { apiFetch } from '../../lib/api';

export type { Channel, ImportOrder, ParseError };

export interface PreviewResult {
  new: number;
  duplicates: string[];
  skipped_status: number;
  unmapped_skus: string[];
}

export interface ImportError {
  external_order_id: string;
  message: string;
}

export interface ImportTotals {
  batch_id: number | null;
  created: number;
  skipped_duplicates: number;
  errors: ImportError[];
}

export interface Progress {
  done: number;
  total: number;
}

export function chunk<T>(items: T[], size = MAX_IMPORT_ORDERS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Không đọc được file.'));
    r.readAsArrayBuffer(file);
  });
}

/** Đọc sheet đầu của file .xlsx/.csv thành các dòng `{ tên cột: giá trị chữ }`. */
export async function readSheetRows(file: File): Promise<Record<string, string>[]> {
  const XLSX = await import('xlsx');
  const bytes = await readBytes(file);
  const isCsv = /\.csv$/i.test(file.name);
  // CSV đọc từ mảng byte bị SheetJS đoán sai bảng mã; giải mã UTF-8 trước để giữ tiếng Việt.
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string' })
    : XLSX.read(bytes, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });
}

export async function loadColumns(channel: Channel): Promise<ColumnMap> {
  return apiFetch<ColumnMap>('/orders/import/columns', { query: { channel } });
}

export function parseFile(channel: Channel, rows: Record<string, string>[], columns: ColumnMap) {
  return parseMarketplaceRows(channel, rows, columns);
}

/** Xem trước theo từng nhóm rồi gộp: đơn mới, đơn trùng, SKU chưa gán. */
export async function previewAll(
  channel: Channel,
  orders: ImportOrder[],
  onProgress?: (p: Progress) => void,
): Promise<PreviewResult> {
  const merged: PreviewResult = { new: 0, duplicates: [], skipped_status: 0, unmapped_skus: [] };
  const groups = chunk(orders);
  const unmapped = new Set<string>();
  for (let i = 0; i < groups.length; i++) {
    onProgress?.({ done: i, total: groups.length });
    const r = await apiFetch<PreviewResult>('/orders/import/preview', {
      method: 'POST',
      json: { channel, orders: groups[i] },
    });
    merged.new += r.new;
    merged.skipped_status += r.skipped_status;
    merged.duplicates.push(...r.duplicates);
    r.unmapped_skus.forEach((s) => unmapped.add(s));
  }
  onProgress?.({ done: groups.length, total: groups.length });
  merged.unmapped_skus = [...unmapped];
  return merged;
}

export interface ImportRun {
  channel: Channel;
  fileName: string;
  groups: ImportOrder[][];
  /** Nhóm kế tiếp cần gửi (để tiếp tục sau lỗi mạng). */
  next: number;
  totals: ImportTotals;
}

export function startImport(channel: Channel, fileName: string, orders: ImportOrder[]): ImportRun {
  return {
    channel,
    fileName,
    groups: chunk(orders),
    next: 0,
    totals: { batch_id: null, created: 0, skipped_duplicates: 0, errors: [] },
  };
}

/**
 * Gửi tuần tự từng nhóm; nhóm đầu tạo đợt nhập, các nhóm sau gửi `batch_id` nhận được.
 * Lỗi giữa chừng: ném lại, `run.next` vẫn trỏ nhóm lỗi nên gọi lại sẽ tiếp tục (đơn đã tạo được bỏ qua do trùng mã).
 */
export async function runImport(run: ImportRun, onProgress?: (p: Progress) => void): Promise<ImportTotals> {
  const total = run.groups.length;
  while (run.next < total) {
    onProgress?.({ done: run.next, total });
    const r = await apiFetch<{
      batch_id: number;
      created: number;
      skipped_duplicates: number;
      errors: ImportError[];
    }>('/orders/import', {
      method: 'POST',
      json: {
        channel: run.channel,
        file_name: run.fileName,
        orders: run.groups[run.next],
        ...(run.totals.batch_id !== null ? { batch_id: run.totals.batch_id } : {}),
      },
    });
    run.totals.batch_id = r.batch_id;
    run.totals.created += r.created;
    run.totals.skipped_duplicates += r.skipped_duplicates;
    run.totals.errors.push(...r.errors);
    run.next += 1;
  }
  onProgress?.({ done: total, total });
  return run.totals;
}
