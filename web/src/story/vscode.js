// One VS Code look for the whole story (Adriaen's pick, 2026-10-30: VS Code's
// Dark Modern theme with the command centre, activity bar, Explorer, tabs,
// breadcrumbs, line numbers, a Copilot style chat and the status bar).
//   vscodeWindow() the markup for a slide card: split editor groups, and
//                  parts that come in click by click (from: n, see vscodeStep)
//   vscode()       a live element you can type code into
//   drawVSCode()   the same window on a 2D canvas (an in-room monitor)
// Styles: .vsw in story.css. The window is laid out at 1440×810 px and
// scaled to its box (fitVSCode), so it reads the same at any size.
import { SANS, MONO } from '../fonts.js';

export const VS_COL = {
  bg: '#1f1f1f', bar: '#181818', side: '#181818', line: '#2b2b2b', input: '#313131', sel: '#04395e', blue: '#0078d4',
  text: '#cccccc', dim: '#9d9d9d', faint: '#6e7681', hl: '#ffffff',
  key: '#9cdcfe', str: '#ce9178', com: '#6a9955', head: '#569cd6', punct: '#808080', link: '#4ec9b0', agent: '#c586c0', num: '#b5cea8', kw: '#c586c0', fn: '#dcdcaa',
  md: '#519aba', py: '#3572a5', git: '#e2c08d', add: '#73c991', accent: '#0078d4',
};
const W0 = 1440, H0 = 810;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ICON = {
  files: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  search: 'M10.5 4.5a6 6 0 1 1 0 12a6 6 0 1 1 0-12M15 15l5 5',
  git: 'M6 3a2 2 0 1 1 0 4a2 2 0 1 1 0-4M6 17a2 2 0 1 1 0 4a2 2 0 1 1 0-4M18 6a2 2 0 1 1 0 4a2 2 0 1 1 0-4M6 7v10M18 10c0 5-8 3-11 7',
  run: 'M8 5l11 7-11 7z',
  ext: 'M4 4h7v7H4zM4 13h7v7H4zM13 13h7v7h-7zM14 4l5 1-1 5-5-1z',
  bot: 'M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM12 4v4M9 13h.01M15 13h.01M9 16h6',
  user: 'M12 5.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7M5 20c1-4 4-5 7-5s6 1 7 5',
  gear: 'M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  send: 'M4 12l16-8-6 16-2-6z',
  branch: 'M6 3a2 2 0 1 1 0 4a2 2 0 1 1 0-4M6 17a2 2 0 1 1 0 4a2 2 0 1 1 0-4M18 5a2 2 0 1 1 0 4a2 2 0 1 1 0-4M6 7v10M18 9c0 4-6 4-11 8',
  layout: 'M3 4h18v16H3zM15 4v16',
  plus: 'M12 5v14M5 12h14',
  hist: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16M12 8v4l3 2',
};
const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24"><path d="${ICON[k]}"/></svg>`;
const fileIcon = (name) => (/\.md$/.test(name) ? '<span class="ic md">M↓</span>' : /\.py$/.test(name) ? '<span class="ic py">py</span>' : /\.(json|csv)$/.test(name) ? '<span class="ic json">{}</span>' : /\.pdf$/.test(name) ? '<span class="ic pdf">▤</span>' : '<span class="ic"></span>');
const from = (o) => (o?.from !== undefined ? ` data-from="${o.from}"` : '');

// Markdown with YAML front matter, coloured like VS Code's default dark theme
export function highlight(lines) {
  let fm = 0;
  return lines.map((t) => {
    if (t === '---') { fm++; return '<span class="p">---</span>'; }
    if (fm === 1) { const m = t.match(/^([\w-]+):(.*)$/); if (m) return `<span class="k">${m[1]}</span><span class="p">:</span><span class="s">${esc(m[2])}</span>`; }
    if (t.startsWith('#')) return `<span class="h">${esc(t)}</span>`;
    return esc(t).replace(/^(- |\d+\. )/, '<span class="bul">$1</span>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="p">[[</span><span class="lk">$1</span><span class="p">]]</span>')
      .replace(/`([^`]+)`/g, '<span class="s">`$1`</span>').replace(/(@[\wæøå]+)/gi, '<span class="ag">$1</span>');
  });
}

// tree: [{ t, lvl?, dir?: 'open'|'closed', sel?, hl?, git?: 'M'|'U', from? }]
function treeHTML(project, tree) {
  const row = (n) => `<div class="row${n.sel ? ' sel' : ''}${n.hl ? ' hl' : ''}"${from(n)} style="padding-left:${0.5 + (n.lvl ?? 0) * 0.75}em"><span class="chev">${n.dir === 'open' ? '⌄' : n.dir ? '›' : ''}</span>${n.dir ? '' : fileIcon(n.t)}<span class="${n.git === 'M' ? 'gm' : n.git ? 'gu' : ''}">${esc(n.t)}</span>${n.git ? `<span class="${n.git === 'M' ? 'gm' : 'gu'} mark">${n.git}</span>` : ''}</div>`;
  return `<div class="ph">Explorer<span>···</span></div><div class="sec"><span class="chev">⌄</span>${esc(project)}</div><div class="tree">${tree.map(row).join('')}</div>`;
}

// one editor group: { tabs?: [names], tab, crumbs?: [parts], lines: [text], cur?, add?: [line numbers], from? }
function groupHTML(g) {
  const tabs = g.tabs ?? [g.tab];
  const src = g.html ?? highlight(g.lines ?? []);
  const rows = src.map((h, i) => `<div class="l${i + 1 === g.cur ? ' cur' : ''}${g.add?.includes(i + 1) ? ' add' : ''}"><i>${i + 1}</i>${h || ' '}</div>`).join('');
  return `<div class="grp"${from(g)}><div class="tabs">${tabs.map((t) => `<div class="tab${t === g.tab ? ' on' : ''}">${fileIcon(t)}${esc(t)}<span class="x">${t === g.tab ? '×' : ''}</span></div>`).join('')}</div>
<div class="crumbs">${(g.crumbs ?? [g.tab]).map(esc).join(' › ')}</div><div class="src">${rows}</div></div>`;
}

// chat: { msgs: [{ me?, who?, t (html), tools?: [{ ok?, t (html) }], from? }], input?: { text?, ctx? }, pick?, menu?: { items: [[name, note]], from? } }
function chatHTML(c = {}) {
  const msg = (m) => `<div class="msg"${from(m)}><div class="who"><span class="av ${m.me ? 'me' : 'bot'}">${svg(m.me ? 'user' : 'bot')}</span>${esc(m.who ?? (m.me ? 'Du' : (c.pick ?? 'CtrlBuddy')))}</div>
<div class="${m.me ? 'req' : 'ans'}">${m.t ? (m.me ? m.t : `<p>${m.t}</p>`) : ''}${(m.tools ?? []).map((x) => `<div class="tool"><span class="${x.ok === false ? 'run' : 'ok'}">${x.ok === false ? '' : '✓'}</span>${x.t}</div>`).join('')}</div></div>`;
  const menu = c.menu ? `<div class="menu"${from(c.menu)}><div class="g">${esc(c.menu.title ?? 'Egne agenter · .github/agents')}</div>${c.menu.items.map(([n, d], i) => `<div class="it${i === 0 ? ' sel' : ''}"><span class="av bot">${svg('bot')}</span>${esc(n)}<em>${esc(d ?? '')}</em></div>`).join('')}<div class="g">Innebygde</div><div class="it">Agent</div><div class="it">Ask</div><div class="it">Edit</div></div>` : '';
  const inp = c.input ?? {};
  return `<div class="chat"><div class="ph">Chat<span>${svg('plus')}${svg('hist')}···</span></div><div class="msgs">${(c.msgs ?? []).map(msg).join('')}</div>
<div class="input">${menu}${inp.ctx ? `<div class="ctx"><span class="chip">${svg('files')}${esc(inp.ctx)}</span></div>` : ''}<div class="ph2${inp.text ? ' typed' : ''}">${inp.text ?? `Spør ${esc(c.pick ?? 'CtrlBuddy')}, eller skriv / for kommandoer`}</div>
<div class="bar2"><span class="pick">${esc(c.pick ?? 'CtrlBuddy')} ⌄</span><span class="pick">Auto ⌄</span><span class="send">${svg('send')}</span></div></div></div>`;
}

// The whole window. groups split the editor side by side; a group with
// from: n opens at click n (the others make room). welcome: shown while no
// group is open.
export function vscodeWindow({ project = 'kontrollrom-agent', tree = [], groups = [], chat = {}, status = 'Ln 1, Col 1', lang = 'Markdown' } = {}) {
  return `<div class="vsw-in"><div class="tbar"><div class="dots"><i></i><i></i><i></i></div><div class="cmd">${svg('search')}${esc(project)}</div><div class="tr">${svg('layout')}${svg('bot')}</div></div>
<div class="body"><div class="act">${['files', 'search', 'git', 'run', 'ext'].map((k, i) => `<div class="${i === 0 ? 'on' : ''}">${svg(k)}${k === 'git' ? '<span class="badge">3</span>' : ''}</div>`).join('')}<div class="sp"></div><div>${svg('user')}</div><div>${svg('gear')}</div></div>
<div class="side">${treeHTML(project, tree)}</div>
<div class="eds"><div class="welcome"><svg viewBox="0 0 24 24"><path d="M17 3l4 2v14l-4 2-10-9 10-9zM17 7.5L11 12l6 4.5zM3 9l2-1 4 4-4 4-2-1z"/></svg><p>Vis alle kommandoer <kbd>⇧⌘P</kbd><br>Gå til fil <kbd>⌘P</kbd><br>Åpne chat <kbd>⌃⌘I</kbd></p></div>${groups.map(groupHTML).join('')}</div>
${chatHTML(chat)}</div>
<div class="sbar"><span class="remote">⟩⟨</span><span>${svg('branch')}main*</span><span>⟳</span><span>⊗ 0  ⚠ 0</span><span class="r">${esc(status)}</span><span>Spaces: 2</span><span>UTF-8</span><span>LF</span><span>${esc(lang)}</span><span>${svg('bot')}</span></div></div>`;
}

// Show the parts that belong to click b (data-from <= b), hide the rest
export function vscodeStep(root, b) {
  for (const el of root.querySelectorAll('[data-from]')) el.classList.toggle('on', b >= +el.dataset.from);
  root.classList.toggle('empty', !root.querySelector('.grp.on, .grp:not([data-from])'));
}

// Scale the 1440×810 window to its box; call when the box may have changed size
export function fitVSCode(root) {
  const inner = root.querySelector('.vsw-in'), w = root.clientWidth;
  if (inner && w && w !== root._w) { root._w = w; inner.style.transform = `scale(${w / W0})`; }
}

// Kept for older callers: one file open, a chat on the right
export function vscodeHTML({ title = 'VS Code', tree = [], tab = '', code = '', chat = [], pick = '' } = {}) {
  return vscodeWindow({
    project: title.split(' — ')[0], tree: tree.map((n) => ({ ...n, sel: n.hl })),
    groups: [{ tab, html: code.split('\n') }],
    chat: { msgs: chat.map((m) => ({ me: m.me, t: m.t })), pick: pick || 'CtrlBuddy' },
  });
}

const strip = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
const RUN = { SPAN: null, B: 'key', I: 'com', H4: 'head' };
const SPAN_RUN = { k: 'key', s: 'str', h: 'head', c: 'com', p: 'punct', lk: 'link', ag: 'agent', bul: 'head' };
const runs = (ln) => [...ln.childNodes].filter((n) => n.nodeName !== 'I' || n.parentNode !== ln || n.textContent !== ln.querySelector('i')?.textContent || n !== ln.firstChild)
  .map((n) => [n.textContent.replace(/ /g, ' '), n.nodeName === 'SPAN' ? SPAN_RUN[n.className] ?? 'text' : RUN[n.nodeName] ?? 'text']);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A live window. Extra methods on the element:
//   el.typeLine(html, { cps }) types the line's text in, then shows its markup; resolves when done
//   el.clearCode(), el.setTab(name), el.addChat(text, me), el.draw(ctx, x, y, w, h)
export function vscode(opts = {}) {
  const el = document.createElement('div');
  el.className = 'vsw';
  el.innerHTML = vscodeHTML(opts);
  const src = el.querySelector('.src'), msgs = el.querySelector('.msgs'), tab = el.querySelector('.tab.on');
  el.typeLine = async (html, { cps = 45 } = {}) => {
    const line = document.createElement('div');
    line.className = 'l typing';
    src.append(line);
    const n = `<i>${src.children.length}</i>`, text = strip(html);
    for (let i = 1; i <= text.length; i++) {
      line.innerHTML = n + esc(text.slice(0, i));
      await wait(1000 / cps);
    }
    line.innerHTML = n + (html || ' ');
    line.classList.remove('typing');
    return line;
  };
  el.clearCode = () => { src.innerHTML = ''; };
  el.setTab = (name) => { tab.lastChild.previousSibling.textContent = name; };
  el.addChat = (text, me = false) => {
    const d = document.createElement('div');
    d.innerHTML = chatHTML({ msgs: [{ me, t: text }] });
    const m = d.querySelector('.msg');
    msgs.append(m);
    return m;
  };
  // paint what the element shows right now, so typing shows up on the canvas too
  el.draw = (ctx, x, y, w, h) => drawVSCode(ctx, {
    title: el.querySelector('.cmd').textContent,
    tree: [...el.querySelectorAll('.tree .row')].map((d) => ({ t: d.textContent.replace(/^[⌄›]/, '').replace(/^M↓|^py|^\{\}/, ''), hl: d.classList.contains('sel') })),
    tab: tab.textContent.replace(/^M↓|×$/g, ''),
    lines: [...src.querySelectorAll('.l')].map((l) => [...l.childNodes].slice(1).map((c) => [c.textContent, c.nodeName === 'SPAN' ? SPAN_RUN[c.className] ?? 'text' : 'text'])),
    caret: !!src.querySelector('.typing'),
    chat: [...msgs.querySelectorAll('.msg')].map((m) => ({ t: m.querySelector('.req, .ans').textContent, me: !!m.querySelector('.req') })),
    pick: el.querySelector('.pick')?.textContent.replace(' ⌄', ''),
  }, x, y, w, h);
  return el;
}

// ------------------------------------------------------------ on a canvas
// The same window painted for an in-room monitor. lines: one per row, either
// [[text, colour key], ...] runs or a plain string (coloured by a guess).
// tree rows may still carry '▾ '/'▸ ' in front of folder names.
export function drawVSCode(ctx, { title = 'VS Code', tree = [], tab = '', tabs, lines = [], caret = false, chat = [], pick = '' } = {}, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height) {
  const C = VS_COL, fs = w / 64, lh = fs * 1.45, pad = fs * 0.8;
  const mono = `${fs}px ${MONO}`, ui = (k = 1, wt = 400) => `${wt} ${fs * k}px ${SANS}`;
  const top = y + fs * 2.2, bot = y + h - fs * 1.6, a1 = x + fs * 2.6, c1 = a1 + w * 0.2, c2 = x + w - w * 0.27;
  const rect = (fill, rx, ry, rw, rh) => { ctx.fillStyle = fill; ctx.fillRect(rx, ry, rw, rh); };
  const icon = (k, cx, cy, s, col) => {
    ctx.save(); ctx.translate(cx - s / 2, cy - s / 2); ctx.scale(s / 24, s / 24);
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(new Path2D(ICON[k])); ctx.restore();
  };
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  rect(C.bg, x, y, w, h);
  // title bar with the command centre
  rect(C.bar, x, y, w, top - y); rect(C.line, x, top - 1, w, 1);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + pad + fs * 0.4 + i * fs * 1.1, y + (top - y) / 2, fs * 0.38, 0, 7); ctx.fill(); });
  const cw = w * 0.36, cx0 = x + (w - cw) / 2;
  ctx.fillStyle = '#252526'; ctx.strokeStyle = '#3c3c3c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(cx0, y + fs * 0.45, cw, fs * 1.3, fs * 0.35); ctx.fill(); ctx.stroke();
  ctx.font = ui(0.85); ctx.fillStyle = C.dim; ctx.textAlign = 'center';
  ctx.fillText(title.split(' — ')[0], x + w / 2, y + fs * 1.1);
  ctx.textAlign = 'left';
  // activity bar
  rect(C.bar, x, top, a1 - x, bot - top); rect(C.line, a1 - 1, top, 1, bot - top);
  ['files', 'search', 'git', 'run', 'ext'].forEach((k, i) => icon(k, x + (a1 - x) / 2, top + fs * (1.4 + i * 2.4), fs * 1.3, i === 0 ? C.hl : '#868686'));
  rect(C.blue, x, top + fs * 0.4, fs * 0.12, fs * 2);
  // explorer
  rect(C.side, a1, top, c1 - a1, bot - top); rect(C.line, c1 - 1, top, 1, bot - top);
  ctx.font = ui(0.72); ctx.fillStyle = C.text; ctx.fillText('EXPLORER', a1 + pad, top + fs * 1.1);
  ctx.font = ui(0.72, 700); ctx.fillText('⌄  ' + title.split(' — ')[0].toUpperCase(), a1 + pad * 0.5, top + fs * 2.6);
  ctx.save(); ctx.beginPath(); ctx.rect(a1, top, c1 - a1 - 1, bot - top); ctx.clip();
  const proj = title.split(' — ')[0].toUpperCase();
  tree.filter((n, i) => !(i === 0 && n.t.replace(/^[▾▸]\s*/, '').toUpperCase() === proj)).forEach((n, i) => {
    const ty = top + fs * (4 + i * 1.45), dir = /^[▾▸]/.test(n.t) || n.dir, name = n.t.replace(/^[▾▸]\s*/, '');
    if (n.hl) { rect(C.sel, a1, ty - fs * 0.7, c1 - a1, fs * 1.4); rect(C.blue, a1, ty - fs * 0.7, c1 - a1, 1); rect(C.blue, a1, ty + fs * 0.7 - 1, c1 - a1, 1); }
    let tx = a1 + pad * 0.5 + (n.lvl ?? 0) * fs * 0.9;
    ctx.font = ui(0.85);
    if (dir) { ctx.fillStyle = C.text; ctx.fillText(n.t.startsWith('▸') || n.dir === 'closed' ? '›' : '⌄', tx, ty); }
    else if (/\.(md|py|json|csv|pdf)$/.test(name)) {
      const ext = name.split('.').pop();
      ctx.font = `700 ${fs * 0.62}px ${MONO}`; ctx.fillStyle = ext === 'md' ? C.md : ext === 'py' ? C.py : '#cbcb41';
      ctx.fillText(ext === 'md' ? 'M↓' : ext === 'py' ? 'py' : '{}', tx + fs * 0.9, ty);
    }
    ctx.font = ui(0.85); ctx.fillStyle = n.hl ? C.hl : C.text;
    ctx.fillText(name, tx + fs * 2.1, ty);
  });
  ctx.restore();
  // editor: tab, breadcrumbs, line numbers, code
  rect(C.bar, c1, top, c2 - c1, fs * 2.2); rect(C.line, c1, top + fs * 2.2 - 1, c2 - c1, 1);
  let tx = c1;
  ctx.font = ui(0.85);
  for (const t of tabs ?? [tab]) {
    const tw = ctx.measureText(t).width + fs * 3.4;
    if (t === tab) { rect(C.bg, tx, top, tw, fs * 2.2); rect(C.blue, tx, top, tw, Math.max(1, fs * 0.08)); }
    rect(C.line, tx + tw - 1, top, 1, fs * 2.2);
    ctx.font = `700 ${fs * 0.62}px ${MONO}`; ctx.fillStyle = C.md; ctx.fillText(/\.py$/.test(t) ? 'py' : 'M↓', tx + fs * 0.7, top + fs * 1.1);
    ctx.font = ui(0.85); ctx.fillStyle = t === tab ? C.hl : C.dim; ctx.fillText(t, tx + fs * 2, top + fs * 1.1);
    if (t === tab) ctx.fillText('×', tx + tw - fs * 1.1, top + fs * 1.1);
    tx += tw;
  }
  ctx.font = ui(0.78); ctx.fillStyle = C.dim; ctx.fillText(tab, c1 + pad * 1.4, top + fs * 3);
  // a plain line coloured by a guess: '# heading', comments, 'key: value', '---'
  const guess = (t) => {
    const s = t.trim(), m = t.match(/^(\s*)([\w-]+)(:)(.*)$/);
    if (s === '---') return [[t, 'punct']];
    if (s.startsWith('#')) return [[t, 'head']];
    if (s.startsWith('//') || s.startsWith('<!--')) return [[t, 'com']];
    return m ? [[m[1] + m[2], 'key'], [m[3], 'punct'], [m[4], 'str']] : [[t, 'text']];
  };
  const gx = c1 + fs * 2.6, l0 = top + fs * 4.5, rows = Math.floor((bot - l0) / lh);
  const shown = lines.slice(-rows);
  let endX = gx + pad;
  ctx.font = mono;
  shown.forEach((l, i) => {
    const ly = l0 + i * lh, last = i === shown.length - 1;
    if (last && caret) rect('#ffffff0a', c1, ly - lh / 2, c2 - c1, lh);
    ctx.textAlign = 'right'; ctx.fillStyle = last && caret ? C.text : C.faint;
    ctx.fillText(String(lines.length - shown.length + i + 1), gx, ly);
    ctx.textAlign = 'left';
    let lx = gx + pad;
    for (const [t, k] of typeof l === 'string' ? guess(l) : l) {
      ctx.fillStyle = C[k] ?? C.text;
      ctx.fillText(t, lx, ly);
      lx += ctx.measureText(t).width;
    }
    endX = lx;
  });
  if (caret && shown.length && (performance.now() / 500 | 0) % 2 === 0) rect(C.hl, endX + 1, l0 + (shown.length - 1) * lh - fs * 0.55, Math.max(1, fs * 0.1), fs * 1.1);
  // chat, word-wrapped, with the input box and the agent picker at the bottom
  rect(C.side, c2, top, x + w - c2, bot - top); rect(C.line, c2, top, 1, bot - top);
  ctx.font = ui(0.72); ctx.fillStyle = C.text; ctx.fillText('CHAT', c2 + pad, top + fs * 1.1);
  let cy = top + fs * 2.8;
  const cwid = x + w - c2 - pad * 2;
  for (const m of chat) {
    ctx.fillStyle = m.me ? '#3a6ea5' : '#2b2b2b';
    ctx.beginPath(); ctx.arc(c2 + pad + fs * 0.55, cy, fs * 0.55, 0, 7); ctx.fill();
    icon(m.me ? 'user' : 'bot', c2 + pad + fs * 0.55, cy, fs * 0.75, m.me ? C.hl : C.agent);
    ctx.font = ui(0.85, 600); ctx.fillStyle = '#e0e0e0'; ctx.fillText(m.me ? 'Du' : pick || 'CtrlBuddy', c2 + pad + fs * 1.5, cy);
    cy += fs * 1.5;
    ctx.font = ui(0.85);
    const rowsC = [];
    let cur = '';
    for (const word of m.t.split(' ')) { const nx = cur ? cur + ' ' + word : word; if (ctx.measureText(nx).width > cwid - fs * 2.2 && cur) { rowsC.push(cur); cur = word; } else cur = nx; }
    rowsC.push(cur);
    const bx = c2 + pad + fs * 1.5;
    if (m.me) { ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.roundRect(bx - fs * 0.5, cy - fs * 0.8, cwid - fs * 1, rowsC.length * fs * 1.25 + fs * 0.6, fs * 0.4); ctx.fill(); }
    ctx.fillStyle = m.me ? '#e8e8e8' : C.text;
    rowsC.forEach((r, i) => ctx.fillText(r, bx, cy + i * fs * 1.25));
    cy += rowsC.length * fs * 1.25 + fs * 1.4;
  }
  const ib = bot - fs * 4.6;
  ctx.fillStyle = C.bg; ctx.strokeStyle = '#3c3c3c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(c2 + pad, ib, cwid, fs * 4, fs * 0.5); ctx.fill(); ctx.stroke();
  ctx.font = ui(0.8); ctx.fillStyle = '#8b8b8b'; ctx.fillText(`Spør ${pick || 'CtrlBuddy'} …`, c2 + pad * 1.6, ib + fs * 1.1);
  const pl = `${pick || 'CtrlBuddy'} ⌄`, pw = ctx.measureText(pl).width + fs;
  ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.roundRect(c2 + pad * 1.5, ib + fs * 2.3, pw, fs * 1.2, fs * 0.25); ctx.fill();
  ctx.fillStyle = C.text; ctx.fillText(pl, c2 + pad * 1.5 + fs * 0.5, ib + fs * 2.9);
  icon('send', x + w - pad * 2.2, ib + fs * 2.9, fs * 0.9, C.dim);
  // status bar
  rect(C.bar, x, bot, w, y + h - bot); rect(C.line, x, bot, w, 1); rect(C.blue, x, bot, fs * 2.2, y + h - bot);
  ctx.font = ui(0.72); ctx.fillStyle = C.hl; ctx.fillText('⟩⟨', x + fs * 0.55, bot + fs * 0.8);
  ctx.fillStyle = C.text; ctx.fillText('main*   ⟳   ⊗ 0  ⚠ 0', x + fs * 3.4, bot + fs * 0.8);
  ctx.textAlign = 'right'; ctx.fillText(`Ln ${lines.length}, Col 1    Spaces: 2    UTF-8    LF    ${/\.py$/.test(tab) ? 'Python' : 'Markdown'}`, x + w - pad, bot + fs * 0.8);
  ctx.restore();
}
