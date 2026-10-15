import { defineConfig } from 'vite';

// No React plugin needed: esbuild handles JSX. Dev page talks to the backend on :4777 directly.
export default defineConfig({
  root: 'web',
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
