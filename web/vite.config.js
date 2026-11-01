import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (f) => fileURLToPath(new URL(f, import.meta.url));

// The build's commit and time, shown by the story bench so a report says
// which version it measured (GitHub Pages caches pages for minutes)
const BUILD = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} ${new Date().toISOString().slice(0, 16)}Z`;

// The newest merged PR in this build's history, shown in a corner of the game
// pages (src/buildTag.js) so a look at the page says which version it is.
// Merge commits say "Merge pull request #N", squash merges end "(#N)".
// The Pages workflow fetches enough history for a direct push to main.
function latestPr() {
  try {
    const log = execSync('git log -200 --format=%s', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of log.split('\n')) {
      const m = line.match(/^Merge pull request #(\d+)/) ?? line.match(/\(#(\d+)\)$/);
      if (m) return Number(m[1]);
    }
  } catch { /* no git: no number */ }
  return null;
}
const PR = latestPr();

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD), __PR__: JSON.stringify(PR), __SHA__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7)) },
  base: './', // relative URLs, so the build works from any folder or host
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: page('index.html'), control: page('control.html'), play: page('play.html'), screens: page('screens.html'), intro: page('intro.html'), story: page('story.html') },
    },
  },
});
