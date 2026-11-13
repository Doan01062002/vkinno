import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // test/ui chạy bằng vitest.ui.config.mts (jsdom).
    exclude: [...configDefaults.exclude, 'test/ui/**'],
  },
});
