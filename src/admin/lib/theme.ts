import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'vk_admin_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Lựa chọn người dùng đã lưu (null nếu chưa chọn hoặc storage bị chặn). */
export function readSavedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage bị chặn (chế độ riêng tư…): bỏ qua.
  }
  return null;
}

function systemTheme(): Theme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Lựa chọn đã lưu, nếu chưa có thì theo hệ điều hành. */
export function readTheme(): Theme {
  return readSavedTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Chế độ sáng/tối của trang quản trị. Chưa bấm đổi thì theo hệ điều hành (cập nhật trực tiếp);
 * chỉ ghi localStorage khi người dùng bấm đổi (bọc try/catch).
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [saved, setSaved] = useState<Theme | null>(readSavedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = saved ?? system;

  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Không lưu được thì chỉ áp dụng cho phiên hiện tại.
    }
  }, [theme]);

  return { theme, toggle };
}
