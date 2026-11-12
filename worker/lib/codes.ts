const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Mã chứng từ: <TIỀN TỐ><YYMMDD theo giờ VN>-<4 ký tự A-Z0-9>. */
export function docCode(prefix: 'PN' | 'PX' | 'DC' | 'KK' | 'BG', now = new Date()): string {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  const yy = String(vn.getUTCFullYear()).slice(2);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}${yy}${mm}${dd}-${suffix}`;
}
