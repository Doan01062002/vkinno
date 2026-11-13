// Định dạng số tiền VND và thời gian theo giờ Việt Nam.

const numberFmt = new Intl.NumberFormat('vi-VN');
const TZ = 'Asia/Ho_Chi_Minh';

/** Số nguyên có nhóm hàng nghìn kiểu Việt Nam: 1234567 → "1.234.567". */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return numberFmt.format(n);
}

/** Tiền VND: 1234567 → "1.234.567 ₫"; null/undefined → "—". */
export function formatVnd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${numberFmt.format(n)} ₫`;
}

/** Đọc chuỗi chữ số (bỏ dấu chấm, khoảng trắng, ₫) thành số nguyên; rỗng → null. */
export function parseVnd(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  return Number(digits);
}

/**
 * Chuẩn hoá thời gian từ API: D1 trả `YYYY-MM-DD HH:MM:SS` (UTC, không có Z);
 * ngày thuần `YYYY-MM-DD` giữ nguyên ngày.
 */
function toDate(iso: string): { date: Date; dateOnly: boolean } | null {
  let s = iso.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (dateOnly) s = `${s}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly };
}

/**
 * Hiển thị thời gian theo giờ Việt Nam: "12/11/2026 14:05" (hoặc "12/11/2026" khi `time:false`
 * hay khi đầu vào chỉ có ngày). Rỗng → "—".
 */
export function formatDate(iso: string | null | undefined, opts: { time?: boolean } = {}): string {
  if (!iso) return '—';
  const parsed = toDate(iso);
  if (!parsed) return iso;
  const withTime = (opts.time ?? true) && !parsed.dateOnly;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: parsed.dateOnly ? 'UTC' : TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: withTime ? '2-digit' : undefined,
    minute: withTime ? '2-digit' : undefined,
    hourCycle: 'h23',
  }).formatToParts(parsed.date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = `${get('day')}/${get('month')}/${get('year')}`;
  return withTime ? `${day} ${get('hour')}:${get('minute')}` : day;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng `YYYY-MM-DD` (dùng cho bộ lọc từ/đến). */
export function todayVn(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
