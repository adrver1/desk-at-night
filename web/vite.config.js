import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (f) => fileURLToPath(new URL(f, import.meta.url));

export default defineConfig({
  base: './', // relative URLs, so the build works from any folder or host
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: page('index.html'), control: page('control.html') },
    },
  },
});
