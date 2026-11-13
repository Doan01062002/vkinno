import { defineConfig } from 'vitest/config';

// Test giao diện quản trị (React) chạy trên jsdom, tách khỏi bộ test Worker (node).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    environment: 'jsdom',
    // Node 26 có localStorage riêng (cảnh báo khi thiếu --localstorage-file); dùng của jsdom.
    execArgv: ['--no-experimental-webstorage'],
    include: ['test/ui/**/*.test.{ts,tsx}'],
    setupFiles: ['test/ui/setup.ts'],
  },
});
