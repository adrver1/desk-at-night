// One year ago, CtrlBuddy waving on the operator's screen (Adriaen,
// 2026-10-29): before the pointer clicks him, what he is, one part per beat
// on a half-slide beside him in the look of his deck's slides. The agent,
// its harness and model, its instructions, its tools and its knowledge base.
//
// The text is the story slide EXPLAIN_SLIDE (story.json slides, editable in
// the story editor's slides lane): its title, and one bullet per part written
// "Heading: line", or "Heading: line | note" for a small aside under it
// (e.g. "more about this later"). State key (content.js): explain: n shows the panel with the
// first n parts, null hides it.
import { SLIDES } from './content.js';
import { real } from '../privateNames.js';

export const EXPLAIN_SLIDE = 'cb-what';

// Line-drawn icons, 48 units square: stroke only, so they take the text's
// colour. One per bullet, in order.
const ICONS = [
  // agent
  '<rect x="10" y="12" width="28" height="22" rx="5"/><path d="M24 12V5M18 23h.01M30 23h.01M18 29h12M6 21v6M42 21v6M17 34v8h14v-8"/>',
  // model
  '<circle cx="24" cy="24" r="6"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l6 6M32 32l6 6M38 10l-6 6M16 32l-6 6"/>',
  // instructions
  '<path d="M12 4h18l8 8v32H12z"/><path d="M30 4v8h8M18 20h14M18 27h14M18 34h9"/>',
  // tools
  '<path d="M40 12.6L35.7 16.8L31.2 12.3L35.4 8A10 10 0 0 0 22.1 21.6L6.6 37.2A3 3 0 0 0 10.8 41.4L26.4 25.9A10 10 0 0 0 40 12.6Z"/><circle cx="9.9" cy="37.8" r="1"/>',
  // knowledge base
  '<path d="M6 10c6-3 12-3 18 2v30c-6-5-12-5-18-2zM42 10c-6-3-12-3-18 2v30c6-5 12-5 18-2z"/>',
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Explain {
  constructor() {
    const el = this.el = document.createElement('div');
    el.className = 'explain';
    (document.getElementById('game') ?? document.body).append(el);
    this.drawn = null;
    this.parts = [];
  }

  // (Re)build from the slide, only when its text changed (the editor's Live
  // can push new wording at any time)
  draw() {
    const s = SLIDES[EXPLAIN_SLIDE] ?? { title: '', bullets: [] };
    const key = JSON.stringify([s.title, s.bullets]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.el.innerHTML = `<h2>${esc(real(s.title))}</h2><ol>` + (s.bullets ?? []).map((b, i) => {
      const [t, note] = real(b).split(' | '), at = t.indexOf(': ');
      const head = at < 0 ? t : t.slice(0, at), line = at < 0 ? '' : t.slice(at + 2);
      return `<li><svg viewBox="0 0 48 48" aria-hidden="true">${ICONS[i % ICONS.length]}</svg><div><b>${esc(head)}</b><span>${esc(line)}</span>${note ? `<i>${esc(note)} →</i>` : ''}</div></li>`;
    }).join('') + '</ol>';
    this.parts = [...this.el.querySelectorAll('li')];
  }

  set(n) {
    const on = n != null && n !== false;
    if (on) this.draw();
    this.el.classList.toggle('on', on);
    if (on) this.parts.forEach((p, i) => p.classList.toggle('in', i < n));
  }
}
