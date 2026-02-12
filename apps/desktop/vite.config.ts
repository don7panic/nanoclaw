import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { setupApiPlugin } from './setup-api-plugin';

export default defineConfig({
  plugins: [setupApiPlugin(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@setup-engine': fileURLToPath(new URL('../../src/setup-engine', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['..', '../..'],
    },
  },
});
