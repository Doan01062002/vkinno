import { useEffect, useState } from 'react';

/** Giá trị trễ `delay` ms sau lần đổi cuối (dùng cho ô tìm kiếm). */
export function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
