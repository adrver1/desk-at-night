// Frame rate readout for debugging, shown on every game page. On by
// default for now; toggle with the ` key (left of 1) or a tap on the
// readout, which then shrinks to a small "fps" tab so phones can get it
// back. ?fps=0 / ?fps=1 in the URL overrides the remembered choice.
// Counts its own animation frames, so pages only need to import it.
// Meant to become one row of the free mode debug overlay later.

const KEY = 'fps';

function remembered() {
  const q = new URLSearchParams(location.search).get('fps');
  if (q != null) return q !== '0';
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function fpsCounter({ parent = document.body } = {}) {
  const el = document.createElement('div');
  el.className = 'fps-counter';
  el.setAttribute('role', 'button');
  el.title = 'Frame rate (` or tap to toggle)';
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:max(8px, env(safe-area-inset-top))', 'transform:translateX(-50%)',
    'z-index:1000', 'padding:3px 8px', 'min-width:44px', 'min-height:24px', 'box-sizing:border-box',
    'border-radius:4px', 'background:#000a', 'color:#9fe0a0', 'text-align:center',
    "font:500 11px/18px 'JetBrains Mono', ui-monospace, monospace", 'letter-spacing:0.04em',
    'cursor:pointer', 'user-select:none', '-webkit-user-select:none', 'touch-action:manipulation',
  ].join(';');
  parent.appendChild(el);

  let on = remembered();
  let frames = 0, since = performance.now(), last = since, worst = 0;

  function show() {
    el.style.opacity = on ? '1' : '0.35';
    if (!on) el.textContent = 'fps';
  }
  function toggle() {
    on = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
    frames = 0; since = last = performance.now(); worst = 0;
    show();
  }

  // Stop the tap from reaching the game underneath (look, use, zoom).
  for (const type of ['pointerdown', 'touchstart', 'mousedown']) {
    el.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
  el.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' && !e.repeat) toggle();
  });

  function tick(now) {
    requestAnimationFrame(tick);
    if (!on) return;
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    if (now - since >= 500) {
      const fps = (frames * 1000) / (now - since);
      el.textContent = `${fps.toFixed(0)} fps · ${worst.toFixed(0)} ms`;
      el.style.color = fps >= 50 ? '#9fe0a0' : fps >= 30 ? '#e8d27a' : '#ff8a7a';
      frames = 0; since = now; worst = 0;
    }
  }
  show();
  if (on) el.textContent = '… fps';
  requestAnimationFrame(tick);

  return { el, toggle, get on() { return on; } };
}
