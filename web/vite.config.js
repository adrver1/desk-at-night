import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (f) => fileURLToPath(new URL(f, import.meta.url));

// The build's commit and time, shown by the story bench so a report says
// which version it measured (GitHub Pages caches pages for minutes)
const BUILD = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} ${new Date().toISOString().slice(0, 16)}Z`;

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  base: './', // relative URLs, so the build works from any folder or host
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: page('index.html'), control: page('control.html'), play: page('play.html'), screens: page('screens.html'), intro: page('intro.html'), story: page('story.html') },
    },
  },
});
