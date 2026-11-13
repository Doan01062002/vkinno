import { App } from './App';
import { applyTheme, readTheme } from './lib/theme';

// Áp chế độ sáng/tối trước lần vẽ đầu (index.astro cũng làm việc này bằng script nội tuyến).
if (typeof document !== 'undefined') applyTheme(readTheme());

/** Điểm gắn vào trang Astro: `<AdminRoot client:only="react" />`. */
export default function AdminRoot() {
  return <App />;
}
