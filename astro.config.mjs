// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const DEV_API = 'http://127.0.0.1:8787'; // npm run dev:api (chỉ nghe trên 127.0.0.1)

/**
 * Dev: mọi đường dẫn /quan-tri/* không có phần mở rộng đều trả trang /quan-tri/ (SPA),
 * giống Worker ở production, để tải lại /quan-tri/don-hang vẫn đúng trang.
 * @returns {import('vite').Plugin}
 */
function adminSpaFallback() {
  return {
    name: 'vk-admin-spa-fallback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, search = ''] = (req.url ?? '').split('?');
        const isPage = (req.method === 'GET' || req.method === 'HEAD') && !pathname.split('/').pop()?.includes('.');
        if (isPage && pathname.startsWith('/quan-tri/') && pathname !== '/quan-tri/') {
          req.url = `/quan-tri/${search ? `?${search}` : ''}`;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  site: 'https://vkinno.vn',
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/quan-tri'),
    }),
  ],
  vite: {
    plugins: [tailwindcss(), adminSpaFallback()],
    server: {
      proxy: {
        '/api': { target: DEV_API, xfwd: true },
        '/files': { target: DEV_API, xfwd: true },
      },
    },
  },
});
