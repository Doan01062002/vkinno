import { describe, expect, it } from 'vitest';
import { formatDate, formatVnd, parseVnd } from '../../src/admin/lib/format';

describe('format', () => {
  it('formatVnd nhóm hàng nghìn kiểu vi-VN và thêm ₫', () => {
    expect(formatVnd(1234567)).toBe('1.234.567 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(null)).toBe('—');
  });

  it('parseVnd bỏ dấu chấm và ký hiệu', () => {
    expect(parseVnd('1.234.567 ₫')).toBe(1234567);
    expect(parseVnd('')).toBeNull();
  });

  it('formatDate đổi giờ UTC của D1 sang giờ Việt Nam', () => {
    expect(formatDate('2026-11-12 18:30:00')).toBe('13/11/2026 01:30');
    expect(formatDate('2026-11-12T18:30:00Z', { time: false })).toBe('13/11/2026');
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
    expect(formatDate(null)).toBe('—');
  });
});
