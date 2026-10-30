// Story mode's overlays: titles, credits, subtitles, the clipboard, the star
// tracker, cards and votes, slides, paper logs, agent notifications, calls,
// the alarm banner, the org chart with the knowledge graph, and labels
// pinned to things in the room. Plain DOM, styled by story.css; main.js says
// what to show.
import { SPEAKERS, CLIPBOARD, STAR_DIMS, STARS, STAR_ROWS, SAFETY_LINE, CARDS, LEVELS, VOTES, VOTE_URL, SLIDES, LOGS, NOTICES, AGENTS, ORG, NEVER, PLAIN_CARDS, SEARCH, SLIDE_ORDER } from './content.js';
import { T } from './lang.js';
import { drawGraph } from './graph.js';
import { LiveSlide, KG_LOOK } from './kg/engine.js';
import { LIVE_SLIDES } from './kg/slides.js';

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
// Show with its CSS fade: a forced layout first, so the transition runs
const fadeIn = (e) => { void e.offsetWidth; e.classList.add('on'); };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class StoryUI {
  constructor(parent, { privateBase, publicBase }) {
    this.privateBase = privateBase;
    this.publicBase = publicBase;
    this.root = h('div', 'story-ui');
    parent.append(h('div', 'tint'), h('div', 'vignette'), this.root);
    const add = (cls, html) => { const e = h('div', cls, html); this.root.append(e); return e; };
    this.el = {
      title: add('title'), credit: add('credit'), subs: add('subs'), hud: add('hud'),
      clipboard: add('clipboard'), stars: add('stars'), panel: add('panel'), slide: add('slide'), log: add('log'),
      notices: add('notices'), call: add('call'), sign: add('signoff'), search: add('search'), banner: add('banner'),
      org: add('org'), notes: add('notes'), boat: add('label3d'), callouts: add('callouts'), debug: add('debug'),
    };
    this.el.notes.hidden = true;
    this.el.debug.hidden = true;
    this.overlayId = null;
    this.voteState = null;
    this.slideImages = {};
    this.slideBuilds = {};
    // The org chart and the graph behind it
    this.graphCanvas = h('canvas', 'graph');
    this.el.org.append(this.graphCanvas, this.orgChart(), h('div', 'graph-title', T('Én kunnskapsbase · mange agentiske eksperter', 'One knowledge base · many agentic experts')));
  }

  // ------------------------------------------------------------ titles

  // A solid title hides the whole picture once it has faded in (1.2 s):
  // onCover(true) then, onCover(false) as soon as it starts to go
  title(t) {
    const e = this.el.title;
    clearTimeout(this.coverTimer);
    this.onCover?.(false);
    if (!t) { e.classList.remove('on'); return; }
    if (t.solid) this.coverTimer = setTimeout(() => this.onCover?.(true), 1300);
    e.className = `title ${t.solid ? 'solid' : ''}`;
    e.innerHTML = `<div class="inner">${t.eyebrow ? `<div class="eyebrow">${esc(t.eyebrow)}</div>` : ''}<h1 class="${t.small ? 'small' : ''}">${esc(t.text)}</h1>${t.sub ? `<p>${esc(t.sub)}</p>` : ''}</div>`;
    fadeIn(e);
  }

  credit(c) {
    const e = this.el.credit;
    if (!c) { e.classList.remove('on'); return; }
    e.innerHTML = `<small>${esc(c[0])}</small><b>${esc(c[1])}</b>${c[2] ? `<small class="bu">${esc(c[2])}</small>` : ''}`;   // [role, name, business unit?]
    fadeIn(e);
  }

  subs(who, text) {
    const e = this.el.subs;
    if (!text) { e.classList.remove('on'); return; }
    e.innerHTML = `<span>${who ? `<b>${esc(SPEAKERS[who]?.name ?? who)}:</b> ` : ''}${esc(text)}</span>`;
    e.classList.add('on');
  }

  hud(chapter, i, n, waiting) {
    this.el.hud.innerHTML = `${chapter.key} · ${esc(chapter.name)} · ${i + 1}/${n} <span class="next ${waiting ? 'on' : ''}">  ▸ Space</span>`;
  }

  // --------------------------------------------------------- navigator
  // A bar along the bottom: where we are in the whole story, and a click
  // jumps to any chapter (or any beat of the current one). Three looks,
  // kept side by side (?nav=a|b|c, NAV in main.js):
  //   a  one thin track, a segment per chapter sized by its beats
  //   b  a box per chapter with its full name, dots for the beats (the default)
  //   c  the three acts as bands with a playhead, names on hover
  // It dims when the mouse is still, so it stays out of the picture.
  nav(chapters, style, jump) {
    const e = this.el.nav = h('nav', `storynav nav-${style}`);
    this.navStyle = style;
    this.root.append(e);
    this.el.hud.hidden = true;
    const groups = [];
    chapters.forEach((ch, c) => {
      const [group, label = group] = ch.name.split(' · ');
      const g = groups.at(-1)?.name === group ? groups.at(-1) : (groups.push({ name: group, chs: [] }), groups.at(-1));
      g.chs.push({ ch, c, label });
    });
    const total = chapters.reduce((n, ch) => n + ch.beats.length, 0);
    const btn = (cls, text, title, fn) => { const b = h('button', `clickable ${cls}`, text); b.type = 'button'; b.title = title; b.onclick = (ev) => { ev.stopPropagation(); fn(); }; return b; };
    const prev = btn('nav-step', '‹', 'Back (←)', () => jump('back'));
    const next = btn('nav-step', '›', 'Next (Space)', () => jump('next'));
    const track = h('div', 'nav-track');
    this.navParts = [];
    for (const g of groups) {
      const ge = h('div', 'nav-group');
      const room = (x) => x.ch.name.length + 4;   // b: a box as wide as its name wants
      ge.style.flexGrow = style === 'b' ? g.chs.reduce((n, x) => n + room(x), 0) : g.chs.reduce((n, x) => n + x.ch.beats.length, 0);
      if (style === 'c') ge.append(h('div', 'nav-act', esc(g.name)));
      const row = h('div', 'nav-row');
      for (const { ch, c, label } of g.chs) {
        const part = btn('nav-ch', '', `${ch.key} · ${ch.name}`, () => jump(c, 0));
        part.style.flexGrow = style === 'b' ? room({ ch }) : ch.beats.length;
        part.innerHTML = style === 'b' ? `<span class="nav-key">${ch.key}</span><span class="nav-label">${esc(ch.name)}</span><span class="nav-dots"></span>`
          : `<span class="nav-fill"></span>${style === 'c' ? `<span class="nav-tip">${ch.key} · ${esc(label)}</span>` : ''}`;
        row.append(part);
        this.navParts.push(part);
      }
      ge.append(row);
      track.append(ge);
    }
    this.navInfo = h('div', 'nav-info');
    e.append(prev, track, next);
    if (style !== 'b') e.append(this.navInfo);   // b: the boxes and dots say it all (Adriaen, 2026-10-29)
    this.navTotal = total;
    this.navChapters = chapters;
    this.navJump = jump;
    // Wake on mouse movement, dim after a few still seconds
    let idle;
    const wake = () => { e.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => e.classList.remove('awake'), 2500); };
    addEventListener('pointermove', wake);
    wake();
  }

  navUpdate(c, i, waiting) {
    if (!this.el.nav) return;
    const chapters = this.navChapters;
    this.navParts.forEach((p, k) => {
      const n = chapters[k].beats.length;
      p.classList.toggle('done', k < c);
      p.classList.toggle('now', k === c);
      const fill = p.querySelector('.nav-fill');
      if (fill) fill.style.width = k < c ? '100%' : k > c ? '0%' : `${((i + 1) / n) * 100}%`;
      const dots = p.querySelector('.nav-dots');
      if (dots) {
        dots.replaceChildren(...(k === c ? chapters[k].beats.map((_, j) => {
          const d = h('button', `clickable nav-dot ${j < i ? 'done' : j === i ? 'now' : ''}`);
          d.type = 'button'; d.title = `${chapters[k].key}.${j + 1}`;
          d.onclick = (ev) => { ev.stopPropagation(); this.navJump(k, j); };
          return d;
        }) : []));
      }
    });
    const ch = chapters[c];
    this.navInfo.innerHTML = `<span>${ch.key} · ${esc(ch.name)} · ${i + 1}/${ch.beats.length}</span><span class="next ${waiting ? 'on' : ''}">▸ Space</span>`;
  }

  notes(text, show) {
    this.el.notes.hidden = !show;
    if (show) this.el.notes.innerHTML = `<b>Presenter notes</b> · ${esc(text ?? '')}`;
  }

  // --------------------------------------------------------- clipboard

  // Out of the way while a monitor or a slide fills the view; a tick then
  // brings it in for a moment
  clipAway(away) {
    this.away = away;
    this.el.clipboard.classList.toggle('away', away && !this.peek);
  }

  clipboard(state, fresh = -1) {
    const e = this.el.clipboard;
    if (fresh >= 0 && this.away) {
      this.peek = true;
      this.clipAway(true);
      clearTimeout(this.peekTimer);
      this.peekTimer = setTimeout(() => { this.peek = false; this.clipAway(this.away); }, 2600);
    }
    if (!state) { e.classList.remove('on'); return; }
    const page = CLIPBOARD[state.page];
    const key = JSON.stringify(state);
    if (this.clipKey !== key) {
      this.clipKey = key;
      const items = page.tasks.map((task, i) => {
        const t = state.ticks?.[i];
        const cls = t === true ? 'done' : t === 'x' ? 'x' : t === 'late' ? 'late' : t ? 'agent done' : '';
        const mark = t === true ? '✓' : t === 'x' ? '✗' : t === 'late' ? '~' : t ? '✓' : '';
        return `<li class="${cls}"><div class="box"><span class="mark ${i === fresh ? 'tick-new' : ''}">${mark}</span></div><span>${esc(task)}</span>${typeof t === 'string' && t.length === 2 ? `<em class="initials">${t}</em>` : '<em></em>'}</li>`;
      }).join('');
      e.innerHTML = `<div class="board"><div class="clip"></div><div class="page ${page.hand ? 'hand' : ''}"><h3>${esc(page.title)}</h3><ul>${items}</ul></div></div>`;
    }
    e.classList.add('on');
  }

  // ------------------------------------------------------------- stars

  stars(state) {
    const e = this.el.stars;
    if (!state) { e.classList.remove('on'); this.starKey = null; return; }
    const key = JSON.stringify(state);
    if (key === this.starKey) return;
    this.starKey = key;
    const row = (v) => (Array.isArray(v) ? v : STARS[v]);
    const stars = (n, prev) => `<span class="s ${prev !== undefined && n < prev ? 'drop' : ''}">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
    let html;
    if (state.show === 'all') {
      html = `<table><tr><th></th>${STAR_DIMS.map((d) => `<th>${d}</th>`).join('')}</tr>${STAR_ROWS.map(([name, k]) => `<tr><td>${name}</td>${STARS[k].map((n) => `<td>${stars(n)}</td>`).join('')}</tr>`).join('')}</table>`;
    } else {
      const v = row(state.row), prev = this.lastStars;
      html = `<table>${STAR_DIMS.map((d, i) => `<tr><td>${d}</td><td>${stars(v[i], prev?.[i])}</td></tr>`).join('')}</table>`;
      this.lastStars = v;
    }
    e.innerHTML = `${html}<div class="safety">${SAFETY_LINE}</div>`;
    e.className = `stars ${state.show === 'mini' ? '' : 'card'} ${state.show === 'all' ? 'all' : ''}`;
    fadeIn(e);
  }

  // --------------------------------------------------- the one overlay
  // slide:<id>, card:<id>, vote:<id>, log:<id>, search, sign, and the calls

  overlay(id, { cast, call } = {}) {
    const fromEnd = this.buildFromEnd; this.buildFromEnd = false;
    if (id === this.overlayId) return;
    this.overlayId = id;
    const [kind, arg] = (id ?? '').split(':');
    for (const k of ['panel', 'slide', 'log', 'search', 'sign']) this.el[k].classList.remove('on');
    call?.show(kind === 'call' || kind === 'phone' ? { who: arg, phone: kind === 'phone' } : null);
    this.voteState = null;
    if (kind !== 'slide') this.live?.hide();
    if (kind === 'slide') this.showSlide(arg, fromEnd);
    if (kind === 'card') this.showPlainCard(arg);
    if (kind === 'vote') this.showVote(arg);
    if (kind === 'log') this.showLog(arg);
    if (kind === 'search') this.showSearch();
    if (kind === 'sign') this.showSign();
  }

  showSlide(id, fromEnd = false) {
    const s = SLIDES[id], e = this.el.slide;
    const ids = SLIDE_ORDER, n = ids.indexOf(id) + 1;
    e.innerHTML = `<div class="num">${n} / ${ids.length}</div>`;
    // the knowledge-graph slides are drawn live (kg/), unless ?kglook=deck
    const live = KG_LOOK !== 'deck' && LIVE_SLIDES[id];
    e.classList.toggle('live', !!live);
    if (live) {
      this.live ??= new LiveSlide(e, { publicBase: this.publicBase });
      e.prepend(this.live.el);
      this.build = null;
      this.live.show(live, fromEnd);
      fadeIn(e);
      return;
    }
    this.live?.hide();
    let img = this.slideImages[id];
    // PowerPoint builds: one picture per click, Space steps through them
    const frames = this.slideBuilds[id];
    this.build = frames?.every(Boolean) ? { id, frames, i: fromEnd ? frames.length - 1 : 0 } : null;
    if (this.build) { img = this.build.img = frames[this.build.i].cloneNode(); }
    if (img) { e.append(img); if (s.caption) e.append(h('div', 'cap', esc(s.caption))); }
    else e.insertAdjacentHTML('afterbegin', `<h2>${esc(s.title)}</h2><ul>${s.bullets.map((b) => `<li class="${b.startsWith('TODO') ? 'todo' : ''}">${esc(b)}</li>`).join('')}</ul>${s.placeholder ? `<div class="tag">${T('Plassholder · Adriaens lysbilde kommer her', 'Placeholder · Adriaen\'s slide goes here')}</div>` : '<div></div>'}`);
    fadeIn(e);
  }

  // Look for slide images in the private folder (git-ignored)
  // Slide pictures: public/story/slides/<id>.webp and one per click
  // (<id>.bNN.webp) for slides with builds, or with ?private=1 a PNG of the
  // same name in the private folder, when there is one
  findSlides(privateOn) {
    const load = (name, done) => {
      const img = new Image();
      img.onload = () => done(img);
      if (privateOn) { img.onerror = () => { img.onerror = null; img.src = `${this.publicBase}slides/${name}.webp`; }; img.src = `${this.privateBase}slides/${name}.png`; }
      else img.src = `${this.publicBase}slides/${name}.webp`;
    };
    for (const id of Object.keys(SLIDES)) {
      const n = SLIDES[id].builds;
      if (!n && !privateOn) continue;
      load(id, (img) => { this.slideImages[id] = img; });
      if (!n) continue;
      const frames = this.slideBuilds[id] = Array(n + 1).fill(null);
      frames.forEach((_, k) => load(`${id}.b${String(k).padStart(2, '0')}`, (img) => { frames[k] = img; }));
    }
  }

  // Space/← on a slide with builds: the next or previous click first
  stepBuild(dir) {
    if (this.live?.def && this.overlayId === `slide:${this.live.def.id}`) return this.live.step(dir);
    const b = this.build;
    if (!b || this.overlayId !== `slide:${b.id}`) return false;
    const i = b.i + dir;
    if (i < 0 || i >= b.frames.length) return false;
    b.i = i; b.img.src = b.frames[i].src;
    return true;
  }

  showPlainCard(id) {
    const c = PLAIN_CARDS[id], e = this.el.panel;
    e.innerHTML = `<div class="sheet"><div class="eyebrow">${id === 'never' ? 'No-go areas' : 'Act 3'}</div><h2>${esc(c.title)}</h2>${(c.body ?? []).map((p) => `<p>${p}</p>`).join('')}${c.list ? `<ul>${c.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${c.foot ? `<div class="foot">${esc(c.foot)}</div>` : ''}</div>`;
    fadeIn(e);
  }

  showVote(id) {
    const v = VOTES[id], c = CARDS[v.card], e = this.el.panel;
    const levels = Object.entries(LEVELS).map(([k, [name, what]]) => `<button type="button" class="clickable" data-level="${k}"><b>${name}</b><small>${what}</small><div class="bar"></div></button>`).join('');
    const back = `<div class="sheet back"><div class="eyebrow">${esc(c.initiative)} · ${esc(c.status)}</div><h2>${esc(c.front)}</h2>
      <dl><dt>How</dt><dd>${esc(c.how)}</dd><dt>Who</dt><dd>${esc(c.who)}</dd><dt>Why</dt><dd>${esc(c.why)}</dd></dl>
      <div class="level-tag ${c.never ? 'never' : ''}">${LEVELS[c.level][0]} · ${esc(c.reason)}</div><div class="foot picked-line"></div></div>`;
    const front = `<div class="sheet front"><div class="eyebrow">Vote · how much may the agent do?</div><h2>${esc(v.q)}</h2><div class="levels">${levels}</div>
      <div class="vote-row"><div class="qr">${VOTE_URL ? 'QR' : 'QR code<br>(TODO poll)'}</div><div>Vote on your phone. ${VOTE_URL ? esc(VOTE_URL) : 'Until the poll is set up, the presenter clicks the room\'s answer.'}<br>Space reveals the answer.</div></div></div>`;
    e.innerHTML = `<div class="flip"><div class="faces">${front}${back}</div></div>`;
    this.voteState = { id, revealed: false, picked: null };
    e.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.voteState.picked = b.dataset.level;
      e.querySelectorAll('[data-level]').forEach((o) => o.classList.toggle('picked', o === b));
    }));
    fadeIn(e);
  }

  // Space on an open vote: show the answer first, then turn the card
  advanceVote() {
    const s = this.voteState;
    if (!s || s.revealed === 'turned') return false;
    const e = this.el.panel, c = CARDS[VOTES[s.id].card];
    if (!s.revealed) {
      s.revealed = true;
      e.querySelector(`[data-level="${c.level}"]`)?.classList.add('answer');
      return true;
    }
    s.revealed = 'turned';
    const line = e.querySelector('.picked-line');
    if (line && s.picked) line.textContent = s.picked === c.level ? 'The room got it right.' : `The room said: ${LEVELS[s.picked][0]}.`;
    e.querySelector('.flip')?.classList.add('turned');
    return true;
  }

  showLog(id) {
    const l = LOGS[id], e = this.el.log;
    e.className = `log ${l.hand ? '' : 'typed'}`;
    const lines = l.lines.map((t, i) => (l.edit && l.edit[0] === i ? `<li><del>${esc(t)}</del> <ins class="later" hidden>${esc(l.edit[1])}</ins></li>` : `<li>${esc(t)}</li>`)).join('');
    e.innerHTML = `<h2>${esc(l.title)}</h2><ol>${lines}</ol><div class="sign" ${l.edit ? 'hidden' : ''}>${esc(l.sign)}</div>`;
    if (l.edit) {
      clearTimeout(this.logTimer);
      this.logTimer = setTimeout(() => { e.querySelector('ins').hidden = false; }, 1800);
      this.logTimer2 = setTimeout(() => { e.querySelector('.sign').hidden = false; }, 3200);
    }
    fadeIn(e);
  }

  showSearch() {
    const e = this.el.search;
    e.innerHTML = `<div class="q">Document system · search: "lifting procedure supply vessel"</div><ul></ul>`;
    const ul = e.querySelector('ul');
    let i = 0;
    clearInterval(this.searchTimer);
    this.searchTimer = setInterval(() => {
      if (i >= SEARCH.length || this.overlayId !== 'search') { clearInterval(this.searchTimer); return; }
      const t = SEARCH[i], li = h('li', /superseded/.test(t) ? 'dim' : i === SEARCH.length - 1 ? 'hit' : '', esc(t));
      ul.append(li);
      i++;
    }, 1300);
    fadeIn(e);
  }

  showSign() {
    const e = this.el.sign;
    e.innerHTML = '<div><b>✓</b>Lead operator</div><div><b>✓</b>Shift supervisor</div><div><b>✓</b>Control engineer (remote)</div><div class="title-line">Act 1\'s trip: avoided</div>';
    fadeIn(e);
  }

  // --------------------------------------------------------- notices

  notice(id) {
    const [agent, text] = NOTICES[id] ?? [];
    if (!agent) return;
    const n = h('div', 'notice', `<div class="ico"></div><b>${esc(AGENTS[agent].label)}</b><div>${esc(text)}</div>`);
    for (const old of this.el.notices.children) old.classList.add('old');
    this.el.notices.append(n);
    while (this.el.notices.children.length > 3) this.el.notices.firstChild.remove();
  }
  clearNotices() { this.el.notices.replaceChildren(); }

  // ----------------------------------------------------------- banner

  banner(state, now) {
    const e = this.el.banner;
    if (!state) { e.classList.remove('on', 'flash'); return; }
    const n = Math.floor(state.count);
    if (this.bannerN !== n) {
      this.bannerN = n;
      e.innerHTML = `<span class="count">⚠ ${n}</span><span>ALARMS</span><span class="ticker">29-PT-1043 Injection header pressure low · 29-XV-1201 Pump B trip · 29-FT-1310 Injection well flow low · 29-PDT-1122 Filter dP high …</span>`;
    }
    e.classList.add('on');
    e.classList.toggle('flash', !state.frozen && n > 0);
  }

  // ------------------------------------------------------- org + graph

  orgChart() {
    const cols = ORG.map((c) => `<div class="person"><h3>${esc(SPEAKERS[c.who].name.split(',')[0])}<small>${esc(c.role)}</small></h3>${c.agents.map(([id, m]) => `<div class="agent" data-agent="${id}"><div class="ico"></div><b>${esc(AGENTS[id].label)}</b><small>${esc(m)}</small></div>`).join('')}</div>`).join('');
    return h('div', 'chart', `<h2>Who leads which agent</h2><div class="cols">${cols}</div><div class="never"><b>Never touches</b>${NEVER.map(esc).join(' · ')}</div>`);
  }

  // Mandate changed on screen (after the caught citation)
  mandate(agent, text) {
    const a = this.el.org.querySelector(`[data-agent="${agent}"]`);
    if (!a) return;
    a.classList.add('changed');
    a.querySelector('small').textContent = text;
  }

  org(mode, level, since, t) {
    const e = this.el.org;
    e.classList.toggle('on', Boolean(mode));
    e.classList.toggle('graph', mode === 'chart+graph' || mode === 'graph');
    e.classList.toggle('graphonly', mode === 'graph');
    if (!mode || mode === 'chart') return;
    const c = this.graphCanvas, dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(c.clientWidth * dpr), hh = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, hh);
    ctx.fillStyle = 'rgba(6,10,16,0.82)';
    ctx.fillRect(0, 0, w, hh);
    drawGraph(ctx, w, hh, { level, since, t, bg: null });
  }

  // Pointers from the story script editor: [{ label, text, x, y }] with x, y
  // in percent of the picture (where the editor's still puts them), or null
  callouts(list) {
    const e = this.el.callouts;
    e.innerHTML = (list ?? []).map((c) => `<div class="callout${c.x > 62 ? ' left' : ''}" style="left:${c.x}%;top:${c.y}%"><div class="pin"></div><div class="lab"><b>${esc(c.label)}</b>${esc(c.text)}</div></div>`).join('');
    e.classList.toggle('on', !!list?.length);
  }

  // A label pinned over a point on screen (x, y in px), or hidden
  boat(text, x, y, kind) {
    const e = this.el.boat;
    if (!text || x === undefined) { e.classList.remove('on'); return; }
    if (e.textContent !== text) e.textContent = text;
    e.className = `label3d on ${kind ?? ''}`;
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
  }
}
