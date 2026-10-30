// One VS Code look for the whole story: the agent files slide (knowledge graph
// section) and the "building CtrlBuddy" beat. vscodeHTML() gives the markup for
// a slide card, vscode() a live element you can type code into, and
// drawVSCode() paints the same window onto a 2D canvas (an in-room monitor).
// Styles: .vscode in story.css. Font size comes from --vs-size (default 14px).

// tree: [{ t, lvl?, hl?, dir? }]  dir: 'open' | 'closed'
// code: html for the editor (<b> key, <i> comment, <h4> heading)
// chat: [{ t, me? }], pick: agent picker label
export function vscodeHTML({ title = 'VS Code', tree = [], tab = '', code = '', chat = [], pick = '' } = {}) {
  const row = (n) => `<div class="lvl${n.lvl ?? 0}${n.hl ? ' hl' : ''}">${n.dir ? (n.dir === 'open' ? '▾ ' : '▸ ') : ''}${n.t}</div>`;
  return `<div class="bar"><span></span><span></span><span></span><em>${title}</em></div>
<div class="cols"><div class="tree"><b>EXPLORER</b>${tree.map(row).join('')}</div>
<div class="code"><div class="tab">${tab}</div><pre>${code}</pre></div>
<div class="chat"><b>CHAT</b>${chat.map((m) => `<p${m.me ? ' class="me"' : ''}>${m.t}</p>`).join('')}${pick ? `<div class="pick hl">${pick} ▾</div>` : ''}</div></div>`;
}

const strip = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
const RUN = { B: 'key', I: 'com', H4: 'head' };
// a typed line as coloured runs [[text, colour key]] from its markup
const runs = (ln) => [...ln.childNodes].map((n) => [n.textContent.replace(/\u00a0/g, ' '), RUN[n.nodeName] ?? 'text']);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A live window. Extra methods on the element:
//   el.typeLine(html, { cps }) types the line's text in, then shows its markup; resolves when done
//   el.clearCode(), el.setTab(name), el.addChat(text, me), el.draw(ctx, x, y, w, h)
export function vscode(opts = {}) {
  const el = document.createElement('div');
  el.className = 'vscode';
  el.innerHTML = vscodeHTML(opts);
  const pre = el.querySelector('pre'), chat = el.querySelector('.chat'), tab = el.querySelector('.tab');
  el.typeLine = async (html, { cps = 45 } = {}) => {
    const line = document.createElement('div');
    line.className = 'ln typing';
    pre.append(line);
    const text = strip(html);
    for (let i = 1; i <= text.length; i++) {
      line.textContent = text.slice(0, i);
      await wait(1000 / cps);
    }
    line.innerHTML = html || '&nbsp;';
    line.classList.remove('typing');
    return line;
  };
  el.clearCode = () => { pre.innerHTML = ''; };
  el.setTab = (name) => { tab.textContent = name; };
  el.addChat = (text, me = false) => {
    const p = document.createElement('p');
    if (me) p.className = 'me';
    p.innerHTML = text;
    chat.insertBefore(p, chat.querySelector('.pick'));
    return p;
  };
  // paint what the element shows right now, so typing shows up on the canvas too
  el.draw = (ctx, x, y, w, h) => drawVSCode(ctx, {
    title: el.querySelector('.bar em').textContent,
    tree: [...el.querySelectorAll('.tree > div')].map((d) => ({ t: d.textContent, lvl: +(d.className.match(/lvl(\d)/)?.[1] ?? 0), hl: d.classList.contains('hl') })),
    tab: tab.textContent,
    lines: pre.querySelector('.ln') ? [...pre.querySelectorAll('.ln')].map(runs) : pre.innerText.replace(/\n$/, '').split('\n'),
    caret: !!pre.querySelector('.typing'),
    chat: [...chat.querySelectorAll('p')].map((p) => ({ t: p.textContent, me: p.classList.contains('me') })),
    pick: el.querySelector('.pick')?.textContent.replace(' ▾', ''),
  }, x, y, w, h);
  return el;
}

// Same window on a canvas. lines: one per row, either [[text, colour key], ...]
// runs or a plain string (coloured by a guess: '#' heading, '//' comment, 'key:' key).
export const VS_COL = { bg: '#1e2229', bar: '#2d323b', side: '#252a32', text: '#d4d4d4', dim: '#9aa3ae', hl: '#ffffff', key: '#9cdcfe', com: '#6a9955', head: '#dcdcaa', accent: '#d1345b' };
export function drawVSCode(ctx, { title = 'VS Code', tree = [], tab = '', lines = [], caret = false, chat = [], pick = '' } = {}, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height) {
  const C = VS_COL, fs = w / 64, mono = `${fs}px "JetBrains Mono", ui-monospace, Menlo, monospace`, body = `${fs}px "Instrument Sans", system-ui, sans-serif`;
  const barH = fs * 2.2, c1 = x + w * (1 / 4.5), c2 = x + w * (3.2 / 4.5), lh = fs * 1.4, pad = fs * 0.8;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = C.bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.bar; ctx.fillRect(x, y, w, barH);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + pad + fs * 0.4 + i * fs * 1.1, y + barH / 2, fs * 0.38, 0, 7); ctx.fill(); });
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = mono; ctx.fillStyle = C.dim;
  ctx.fillText(title, x + w / 2, y + barH / 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  // explorer
  ctx.fillStyle = C.side; ctx.fillRect(x, y + barH, c1 - x, h - barH);
  ctx.fillStyle = C.dim; ctx.font = `${fs * 0.85}px "JetBrains Mono", monospace`;
  ctx.fillText('EXPLORER', x + pad, y + barH + pad);
  ctx.font = mono;
  tree.forEach((n, i) => { ctx.fillStyle = n.hl ? C.hl : C.text; ctx.fillText(n.t, x + pad + (n.lvl ?? 0) * fs, y + barH + pad + (i + 1.4) * fs * 1.3); });
  // editor
  ctx.fillStyle = C.bar; const tw = ctx.measureText(tab).width + fs * 1.8;
  ctx.fillRect(c1, y + barH, tw, fs * 1.9);
  ctx.fillStyle = C.accent; ctx.fillRect(c1, y + barH + fs * 1.9 - 2, tw, 2);
  ctx.fillStyle = C.hl; ctx.fillText(tab, c1 + fs * 0.9, y + barH + fs * 0.45);
  const guess = (t) => (t.startsWith('#') ? 'head' : t.startsWith('//') || t.startsWith('<!--') ? 'com' : /^[\w-]+:/.test(t) ? 'key' : 'text');
  let endX = c1 + pad;
  lines.forEach((l, i) => {
    let lx = c1 + pad;
    for (const [t, k] of typeof l === 'string' ? [[l, guess(l.trim())]] : l) {
      ctx.fillStyle = C[k] ?? C.text;
      ctx.fillText(t, lx, y + barH + fs * 2.6 + i * lh);
      lx += ctx.measureText(t).width;
    }
    endX = lx;
  });
  if (caret && lines.length && (performance.now() / 500 | 0) % 2 === 0) {
    ctx.fillStyle = C.hl; ctx.fillRect(endX + 1, y + barH + fs * 2.6 + (lines.length - 1) * lh, fs * 0.08 + 1, fs * 1.1);
  }
  ctx.strokeStyle = '#ffffff14'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(c1, y + barH); ctx.lineTo(c1, y + h); ctx.moveTo(c2, y + barH); ctx.lineTo(c2, y + h); ctx.stroke();
  // chat, word-wrapped
  ctx.fillStyle = C.dim; ctx.font = `${fs * 0.85}px "JetBrains Mono", monospace`;
  ctx.fillText('CHAT', c2 + pad, y + barH + pad);
  ctx.font = body;
  let cy = y + barH + pad + fs * 1.8;
  const cw = x + w - c2 - pad * 2;
  for (const m of chat) {
    const rows = [];
    let cur = '';
    for (const word of m.t.split(' ')) { const nx = cur ? cur + ' ' + word : word; if (ctx.measureText(nx).width > cw - (m.me ? fs : 0) && cur) { rows.push(cur); cur = word; } else cur = nx; }
    rows.push(cur);
    if (m.me) { ctx.fillStyle = C.bar; ctx.fillRect(c2 + pad, cy - fs * 0.4, cw, rows.length * lh + fs * 0.8); }
    ctx.fillStyle = C.text;
    rows.forEach((r, i) => ctx.fillText(r, c2 + pad + (m.me ? fs * 0.5 : 0), cy + i * lh));
    cy += rows.length * lh + fs * 1.2;
  }
  if (pick) {
    ctx.font = mono; const pw = ctx.measureText(pick + ' ▾').width + fs;
    ctx.strokeStyle = '#ffffff33'; ctx.strokeRect(c2 + pad, cy, pw, fs * 1.6);
    ctx.fillStyle = C.hl; ctx.fillText(pick + ' ▾', c2 + pad + fs * 0.5, cy + fs * 0.3);
  }
  ctx.restore();
}
