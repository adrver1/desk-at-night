// One year ago, after the learning curve (Adriaen, 2026-10-29): the
// operator's face with the things he had to learn round it in thought
// bubbles, one more per click: the organisation, the lingo, the three-letter
// abbreviations, petroleum engineering, the assets (the plants he looks after)
// and AI, each with a question mark.
//
// State key (content.js): thoughts: true shows his face; Space (main.js
// next) brings in the next bubble before the story moves on, ← takes one
// away, and a beat stepped back into shows them all. thoughts: 'dim' keeps
// only the dark behind them (Adriaen, 2026-10-30: the learning curve again,
// over the same dark): the face and the bubbles fade away.
import { T } from './lang.js';

// Line-drawn icons, 48 units square: stroke only, so they take the bubble's colour
const ICONS = {
  org: '<rect x="18" y="4" width="12" height="9" rx="1.5"/><rect x="4" y="33" width="12" height="9" rx="1.5"/><rect x="18" y="33" width="12" height="9" rx="1.5"/><rect x="32" y="33" width="12" height="9" rx="1.5"/><path d="M24 13v10M10 33v-10h28v10M24 23v10"/>',
  lingo: '<path d="M6 8h36a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H22l-9 8v-8H6a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z"/><path d="M12 17h10M26 17h10M12 23h6M22 23h14"/>',
  oil: '<path d="M24 4C24 4 10 21 10 30a14 14 0 0 0 28 0C38 21 24 4 24 4z"/><path d="M17 31a7 7 0 0 0 6 7"/>',
  assets: '<path d="M4 40h40M9 40V28h30v12M14 28V18h20v10M20 18V8M20 8h10l-10 6M34 18l6-10M12 34h4M22 34h4M32 34h4"/>',
};
// [icon or the letters it shows instead, Norwegian, English], in the order they come in
const THINGS = [
  ['org', 'Organisasjon', 'Organisation'],
  ['lingo', 'Fagspråk', 'Lingo'],
  [T('TBF', 'TLA'), 'Forkortelser', 'Acronyms'],
  ['oil', 'Petroleumsfag', 'Petroleum engineering'],
  ['assets', 'Assetene', 'The assets'],
  [T('KI', 'AI'), 'Kunstig intelligens', 'Artificial intelligence'],   // (Adriaen, 2026-10-29; KI in Norwegian, 2026-10-30)
];
// Where the bubbles sit round the face, as % of the overlay (x, y of their centre)
const SPOTS = [[24, 20], [76, 20], [12, 52], [88, 52], [30, 84], [70, 84]];

export class Thoughts {
  constructor() {
    const el = this.el = document.createElement('div');
    el.className = 'thoughts';
    el.innerHTML = `<img class="face" src="story/faces/adriaen.png" alt="">` + THINGS.map(([icon, no, en], i) => {
      const art = ICONS[icon] ? `<svg viewBox="0 0 48 48" aria-hidden="true">${ICONS[icon]}</svg>` : `<b class="letters">${icon}</b>`;
      const [x, y] = SPOTS[i];
      // the two little circles trail off toward his head
      const dx = 50 - x, dy = (52 - y) * 0.56, l = Math.hypot(dx, dy), [ux, uy] = [dx / l, dy / l];
      const dot = (k, cls) => `<i class="dot ${cls}" style="left:${50 + ux * k}%;top:${50 + uy * k * 1.25}%;transform:translate(-50%,-50%)"></i>`;
      return `<div class="bubble" style="left:${x}%;top:${y}%">${art}<span>${T(no, en)}<em>?</em></span>${dot(62, 'd1')}${dot(80, 'd2')}</div>`;
    }).join('');
    (document.getElementById('game') ?? document.body).append(el);
    this.bubbles = [...el.querySelectorAll('.bubble')];
    this.on = false;
    this.n = 0;
  }

  // The story's state: shown or not; a fresh showing starts with no bubbles
  // (or all of them, stepping back into the beat)
  set(mode, all = false) {
    const on = Boolean(mode);
    if (on && !this.on) this.show(all ? this.bubbles.length : 0);
    this.on = on;
    this.bare = mode === 'dim';
    this.el.classList.toggle('on', on);
    this.el.classList.toggle('bare', this.bare);
  }

  show(n) {
    this.n = Math.min(n, this.bubbles.length);
    this.bubbles.forEach((b, i) => b.classList.toggle('in', i < n));
  }

  // Space / ←: one bubble more or less; false when there is none left to step
  step(dir) {
    if (!this.on || this.bare) return false;
    const n = this.n + dir;
    if (n < 0 || n > this.bubbles.length) return false;
    this.show(n);
    return true;
  }
}
