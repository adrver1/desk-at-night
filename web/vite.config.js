import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative URLs, so the build works from any folder or host
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
