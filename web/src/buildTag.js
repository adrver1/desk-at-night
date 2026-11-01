// A small "PR #111" label in the top left corner of story mode and free
// play, so a look at the page says which build it is (GitHub Pages caches
// for minutes). The number is the newest merged PR at build time, from
// vite.config.js; hover shows the commit. ?ver=0 hides it, e.g. for clean
// stills. On play.html it sits under the "← Lighting viewer" link.
import { MONO } from './fonts.js';

export function buildTag({ parent = document.body } = {}) {
  if (new URLSearchParams(location.search).get('ver') === '0') return null;
  const pr = typeof __PR__ === 'number' ? __PR__ : null;
  const sha = typeof __SHA__ === 'string' ? __SHA__ : '';
  const el = document.createElement('div');
  el.className = 'build-tag';
  el.textContent = pr ? `PR #${pr}` : 'dev';
  el.title = [pr ? `Latest merged PR #${pr}` : 'Local build', sha && `commit ${sha}`].filter(Boolean).join(' · ');
  el.style.cssText = `position: fixed; left: max(8px, env(safe-area-inset-left)); top: max(8px, env(safe-area-inset-top));
    z-index: 1000; pointer-events: none; user-select: none; font: 500 10px/1 ${MONO}; letter-spacing: 0.04em;
    color: #ffffff8c; background: #0006; padding: 3px 6px; border-radius: 4px;`;
  parent.appendChild(el);
  // Clear the page's corner link when it shows (story mode hides it)
  const place = () => {
    const c = document.querySelector('.corner');
    const r = c && getComputedStyle(c).display !== 'none' ? c.getBoundingClientRect() : null;
    el.style.top = r && r.height ? `${Math.round(r.bottom + 2)}px` : 'max(8px, env(safe-area-inset-top))';
    if (r && r.height) el.style.left = `${Math.round(r.left)}px`;
  };
  place();
  addEventListener('load', place);
  addEventListener('resize', place);
  return el;
}
