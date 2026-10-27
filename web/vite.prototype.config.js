import { defineConfig } from 'vite';
export default defineConfig({ root: '/home/user/desk-at-night/web', base: './', publicDir: false, assetsInclude: ['**/*.glb'],
  build: { target: 'es2022', assetsInlineLimit: process.env.INLINE ? 1e8 : 4096, outDir: process.env.OUT ?? 'dist-prototype', emptyOutDir: true, modulePreload: false,
    rollupOptions: { input: process.env.PAGE ?? '/home/user/desk-at-night/web/ocean-prototype.html' } } });
