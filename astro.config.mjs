// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://vkinno.vn',
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/quan-tri'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
