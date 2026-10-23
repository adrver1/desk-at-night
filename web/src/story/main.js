// Story mode: "A day in the life of EIGA", on rails like an advanced
// PowerPoint (design.md section 11). The room and everything in it come
// from play.js; this file steps through the chapters and beats of
// content.js, moves the camera, places the people, plays the lines with
// subtitles and drives the overlays.
//
// Keys: Space or → next, ← back, 1-9 chapter, F free mode (and back), P
// presenter notes, O debug overlay (free mode). A presentation clicker sends
// the same keys. URL: ?chapter=N, ?mode=free, ?sola=1 (the optional Sola
// apron scene before the flight), ?nofs (no fullscreen on start).
import * as THREE from 'three';
import '../play.js';
import { CHAPTERS, ACTS, TITLE, CREDITS, SPEAKERS } from './content.js';
import lines from './lines.json';
import { StoryUI } from './ui.js';
import { Sound } from './sound.js';
import { Cast } from './cast.js';
import { Call } from './call.js';
import { S, addStoryScreens } from './storyScreens.js';
import { DEFAULT_LAYOUT, contentOf } from '../screens.js';
import { Shots } from './shots.js';
import { Epilogue } from './epilogue.js';
import { Sola } from './sola.js';

const game = window.__game;
const q = new URLSearchParams(location.search);
const PRIVATE = 'story/private/';
const MUSIC = 'story/music/flight.mp3';   // from the Sola opening (or the flight) until 'press Space'
addStoryScreens();

const host = document.getElementById('game');
const ui = new StoryUI(host, { privateBase: PRIVATE });
// The chapter navigator along the bottom (?nav=a|b|c, off with ?nav=0); see ui.nav
const NAV = new URLSearchParams(location.search).get('nav') ?? 'b';
if (NAV !== '0') ui.nav(CHAPTERS, NAV, (c, i) => (c === 'next' ? next() : c === 'back' ? back() : enter(c, i, { instant: true })));
const sound = new Sound();
const call = new Call(ui.el.call);
let cast = null, shots = null, epilogue = null;
// The Sola opening (?sola=1) and its callback stills in Acts 1 and 3
// (?solastills=1, on with ?sola=1 unless ?solastills=0). Both off by default.
const SOLA_OPEN = q.get('sola') === '1';
const SOLA_STILLS = (q.get('solastills') ?? (SOLA_OPEN ? '1' : '0')) === '1';
const sola = SOLA_OPEN || SOLA_STILLS ? Object.assign(new Sola(game, { open: SOLA_OPEN }), { sound, titleText: TITLE, credits: CREDITS, music: MUSIC }) : null;
for (const ch of CHAPTERS) ch.beats = ch.beats.filter((b) => !b.sola || SOLA_STILLS);

// Private overrides (git-ignored, ?private=1): real names and statuses,
// slide images and tool screenshots for the private build
const PRIVATE_ON = q.get('private') === '1';
if (PRIVATE_ON) fetch(`${PRIVATE}overrides.json`).then((r) => (r.ok ? r.json() : null)).then((o) => { if (o) applyOverrides(o); }).catch(() => {});
if (q.get('fps') === '1' || q.has('perf')) document.documentElement.classList.add('show-fps');   // the panel sits on <body>, outside the game
function applyOverrides(o) {
  // { lines: { id: text }, cards: { id: { initiative, status } }, slides: { id: {...} } }
  for (const [id, text] of Object.entries(o.lines ?? {})) if (lines[id]) lines[id].text = text;
  import('./content.js').then((c) => {
    for (const [id, v] of Object.entries(o.cards ?? {})) Object.assign(c.CARDS[id] ?? {}, v);
    for (const [id, v] of Object.entries(o.slides ?? {})) c.SLIDES[id] = { ...c.SLIDES[id], ...v };
  });
}
if (PRIVATE_ON) ui.findSlides();
if (PRIVATE_ON) for (const id of ['stepTest', 'riser', 'antiSlug', 'scd']) {
  const img = new Image();
  img.onload = () => { S.images[id] = img; };
  img.src = `${PRIVATE}tools/${id}.png`;
}

// ---------------------------------------------------------------- state

let chapter = 0, beat = 0;     // where we are
let token = 0;                 // bumps when a beat is left, so its steps stop
let running = false, waiting = false;
let state = {};                // the state the current beat set up
let free = false, notesOn = false;
const prologue = { frame: null, t: 0, cues: new Set(), ended: false };

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (k === 'screens' || k === 'cast') out[k] = v === null ? {} : (k === 'cast' ? { ...v } : { ...(a[k] ?? {}), ...v });
    else out[k] = v;
  }
  return out;
};

// The state on entering beat i of chapter c: its chapter's base, every
// earlier beat's set and end, then its own set
function stateAt(c, i) {
  const ch = CHAPTERS[c];
  let s = merge({ act: 0, graph: 0, alarms: null, overlay: null, boatLabel: null, org: null, tool: null, sound: 'room' }, ch.base);
  for (let k = 0; k < i; k++) s = merge(merge(s, ch.beats[k].set), ch.beats[k].end);
  return merge(s, ch.beats[i].set);
}

// ---------------------------------------------------------------- applying state

let lastGrade = null;
function apply(s, { instant = false } = {}) {
  const prev = state;
  state = s;
  // Colour grade per act
  if (lastGrade !== s.act) { host.classList.remove(`grade-${lastGrade}`); host.classList.add(`grade-${s.act}`); lastGrade = s.act; }
  // Game time (the red clock, the sun, the vessel's schedule)
  if (s.time !== undefined && (instant || s.time !== prev.time)) setTime(s.time);
  // Screens: the default layout plus this state's changes
  if (game.room) {
    const want = { ...DEFAULT_LAYOUT, ...(s.act === 1 ? { Desk0Mon5Screen: 'procedures', Desk1Mon5Screen: 'log' } : {}), ...(s.screens ?? {}) };
    for (const [name, id] of Object.entries(want)) if (contentOf(name) !== id) game.room.setContent(name, id);
  }
  if (S.wi !== (s.wi ?? 'normal')) { S.wi = s.wi ?? 'normal'; S.wiAt = S.now; }
  if (s.alarms) S.alarms = s.alarms.count;
  if ((s.graph ?? 0) !== S.graph) { S.graph = s.graph ?? 0; S.graphAt = instant ? -99 : S.now; }
  if (s.tool !== prev.tool) S.toolAt = S.now;
  S.tool = s.tool;
  cast?.place(s.cast);
  ui.clipboard(s.clipboard);
  ui.clipAway(Boolean(s.shot?.startsWith('monitor:') || s.overlay?.startsWith('slide:') || s.overlay?.startsWith('log:') || s.overlay?.startsWith('vote:') || s.overlay?.startsWith('card:') || s.graphOn === 'overlay'));
  ui.stars(s.stars);
  ui.banner(s.alarms);
  ui.overlay(s.overlay, { call });
  ui.org(s.org, S.graph, 99, S.now);
  if (s.graphOn === 'overlay') ui.org('graph', S.graph, 99, S.now);
  shots?.go(s.shot, instant);
  // Sound bed
  if (s.sound === 'alarm') sound.startAlarm(); else sound.stopAlarm();
  if (game.controls) game.controls.setVolume(s.sound === 'silence' ? 0 : roomVolume);
}
let roomVolume = 40;

function setTime(h) {
  game.outdoor({ time: h });
  S.clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- beats

async function enter(c, i, { instant = false, skipDo = false } = {}) {
  token++;
  const my = token;
  sound.cut();
  cast?.quiet();
  call.quiet();
  ui.subs();
  ui.title(null);
  chapter = c; beat = i;
  const ch = CHAPTERS[c], b = ch.beats[i];
  location.hash = `${ch.key}.${i + 1}`;
  if (ch.prologue) { if (sola?.open) sola.done = false; return startPrologue(); }
  stopPrologue();
  if (sola) sola.hide();
  if (ch.id === 'epilogue') { await epilogueReady(); } else epilogue?.hide();
  if (my !== token) return;
  ui.clearNotices();
  apply(stateAt(c, i), { instant });
  if (b.sola && sola) { ui.clipAway(true); sola.still(b.sola, ui); }
  if (b.title) ui.title({ eyebrow: `Act ${b.title}`, text: ACTS[b.title].name, sub: ACTS[b.title].sub, solid: true });
  showHud();
  ui.notes(b.notes, notesOn);
  running = true; waiting = false;
  if (!skipDo) {
    for (const step of b.do ?? []) {
      if (my !== token) return;
      if (step.at !== undefined) { run(step, my); continue; }  // timed steps run alongside
      await run(step, my);
    }
  } else if (b.end) apply(merge(state, b.end), { instant: true });
  if (my !== token) return;
  running = false; waiting = true;
  showHud();
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function run(step, my) {
  if (step.at !== undefined) { await sleep(step.at); if (my !== token) return; }
  if (step.say) return say(step.say, my);
  if (step.wait) return sleep(step.wait);
  if (step.set) return apply(merge(state, step.set));
  if (step.sound === 'ring') { sound.ring(2); return; }
  if (step.sound === 'alarmShort') { sound.startAlarm(3, 0.06); setTimeout(() => sound.stopAlarm(), 5000); return; }
  if (step.notice) {
    ui.notice(step.notice);
    sound.chime();
    const { NOTICES } = await import('./content.js');
    S.notices.push([...NOTICES[step.notice], S.now]);
    return sleep(0.6);
  }
  if (step.graph) { apply(merge(state, { graph: step.graph })); S.graphAt = S.now; return; }
  if (step.tick) {
    const [k, v] = step.tick, cb = state.clipboard;
    if (!cb) return;
    const ticks = [...(cb.ticks ?? [])];
    ticks[k] = v;
    state.clipboard = { ...cb, ticks };
    ui.clipboard(state.clipboard, k);
    return sleep(0.4);
  }
  if (step.stars) { state.stars = { row: step.stars, show: 'mini' }; ui.stars(state.stars); return sleep(0.4); }
  if (step.clock) {
    const [from, to, over] = step.clock, t0 = performance.now();
    while (performance.now() - t0 < over * 1000) {
      if (my !== token) return;
      const k = (performance.now() - t0) / (over * 1000);
      setTime(from + (to - from) * k * k * (3 - 2 * k));
      await sleep(1 / 30);
    }
    setTime(to);
    state.time = to;
    return;
  }
  if (step.alarms) {
    const [from, to, over] = step.alarms, t0 = performance.now();
    state.alarms = { count: from };
    while (performance.now() - t0 < over * 1000) {
      if (my !== token) return;
      const k = (performance.now() - t0) / (over * 1000);
      S.alarms = from + (to - from) * k ** 1.6;
      ui.banner({ count: S.alarms });
      await sleep(1 / 15);
    }
    S.alarms = to;
    ui.banner({ count: to });
  }
}

async function say(id, my) {
  const line = lines[id];
  if (!line) return;
  ui.subs(line.who, line.text);
  const mouth = sound.index[id]?.mouth ?? '';
  cast?.talk(line.who, mouth);
  call.talk(line.who, mouth);
  shots?.speaker(line.who);
  await sound.line(id);
  if (my === token) { ui.subs(); await sleep(0.35); }
}

function showHud() {
  const ch = CHAPTERS[chapter];
  ui.hud(ch, beat, ch.beats.length, waiting);
  ui.navUpdate(chapter, beat, waiting);
}

// ---------------------------------------------------------------- moving on

function next() {
  if (free) return;
  if (CHAPTERS[chapter].prologue) return prologueNext();
  if (ui.advanceVote()) return;
  const b = CHAPTERS[chapter].beats[beat];
  if (running && b.skip !== 'next') {
    // Mid-beat: finish it at once (lines stop, its end state shows)
    token++;
    sound.cut();
    cast?.quiet(); call.quiet();
    ui.subs();
    if (b.end) apply(merge(state, b.end));
    if (state.sound === 'alarm') sound.startAlarm(0.1);
    running = false; waiting = true;
    showHud();
    return;
  }
  if (beat + 1 < CHAPTERS[chapter].beats.length) enter(chapter, beat + 1);
  else if (chapter + 1 < CHAPTERS.length) enter(chapter + 1, 0);
}

function back() {
  if (free) return;
  if (beat > 0) enter(chapter, beat - 1, { instant: true, skipDo: true });
  else if (chapter > 0) enter(chapter - 1, CHAPTERS[chapter - 1].beats.length - 1, { instant: true, skipDo: true });
}

function toggleFree() {
  if (!game.room) return;
  free = !free;
  host.classList.toggle('mode-free', free);
  if (free) {
    token++;
    sound.cut();
    stopPrologue();
    const cam = game.camera, e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    cast?.place(state.cast);
    shots.release();
    game.free(cam.position, e.y, e.x);
    ui.el.debug.hidden = true;
  } else {
    game.stop();
    enter(chapter, beat, { instant: true, skipDo: true });
  }
}

addEventListener('keydown', (e) => {
  if (begin.parentNode) { if (e.code === 'Space' || e.code === 'Enter') start(); return; }
  handleKey(e);
});
function handleKey(e) {
  if (e.repeat) return;
  if (e.code === 'KeyF') return toggleFree();
  if (e.code === 'KeyO' && free) { ui.el.debug.hidden = !ui.el.debug.hidden; return debugPanel(); }
  if (free) return;
  if (e.code === 'KeyP') { notesOn = !notesOn; ui.notes(CHAPTERS[chapter].beats[beat]?.notes, notesOn); return; }
  if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'PageDown' || e.code === 'Enter') { e.preventDefault(); next(); return; }
  if (e.code === 'ArrowLeft' || e.code === 'PageUp' || e.code === 'Backspace') { e.preventDefault(); back(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= 9) { const c = CHAPTERS.findIndex((ch) => ch.key === n); if (c >= 0) enter(c, 0, { instant: true }); }
}
// A click on the picture (not on a button) also moves on, like a clicker
host.addEventListener('click', (e) => {
  if (free || begin.parentNode || e.target.closest('button, .clickable, .debug')) return;
  next();
});

// The debug overlay (free mode): chapters and beats to jump to
function debugPanel() {
  const d = ui.el.debug;
  d.innerHTML = `<div>${CHAPTERS[chapter].name} · beat ${beat + 1} · ${S.clock}</div>`;
  for (const [c, ch] of CHAPTERS.entries()) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<b style="min-width:2ch">${ch.key}</b>`;
    ch.beats.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.textContent = b.id;
      btn.className = c === chapter && i === beat ? 'on' : '';
      btn.addEventListener('click', () => { chapter = c; beat = i; apply(stateAt(c, i), { instant: true }); shots.release(); debugPanel(); });
      row.append(btn);
    });
    d.append(row);
  }
}

// ---------------------------------------------------------------- prologue
// intro.html in a frame on top; the control room loads underneath. We read
// its clock (same origin) to cue the title, credits and the pilot.

function startPrologue() {
  game.hooks.hidden = true;
  ui.clipboard(null); ui.stars(null); ui.banner(null); ui.overlay(null, { call }); ui.org(null); ui.clearNotices(); ui.clock(null);
  host.classList.remove(`grade-${lastGrade}`); lastGrade = 0;
  showHud();
  if (sola && !sola.done) return sola.play(host, ui, (id) => say(id, token)).then(() => { if (CHAPTERS[chapter].prologue) startPrologue(); });
  stopPrologue({ keepMusic: true });   // the music carries on from the Sola opening
  game.hooks.hidden = true;            // again: stopPrologue() shows the room, which would then draw behind the intro all along
  const f = document.createElement('iframe');
  f.className = 'prologue';
  const pass = new URLSearchParams([...q].filter(([key]) => ['weather', 'perf', 'trace'].includes(key)));   // debug overlays too
  f.src = `intro.html${pass.size ? `?${pass}` : ''}`;
  f.allow = 'autoplay; fullscreen';
  host.append(f);
  prologue.frame = f;
  prologue.cues.clear();
  prologue.ended = false;
  const black = document.createElement('div');
  black.className = 'blackout on';
  host.append(black);
  prologue.black = black;
  f.addEventListener('load', () => {
    const doc = f.contentDocument;
    const style = doc.createElement('style');
    style.textContent = '.caption, .skip, .end, .clock, .fps, .fps-counter:not(.full) { display: none !important; }';
    doc.head.append(style);
    f.contentWindow.addEventListener('keydown', (e) => handleKey(e));
    f.contentWindow.addEventListener('click', () => { if (prologue.ended) next(); });
  });
}

function stopPrologue({ keepMusic = false } = {}) {
  prologue.frame?.remove();
  prologue.frame = null;
  prologue.black?.remove();
  prologue.black = null;
  sola?.hide();
  sound.rotor(0, 0.6);
  if (!keepMusic) sound.stopMusic(1.5);
  ui.credit(null);
  if (game.hooks) game.hooks.hidden = false;
}

function prologueNext() {
  const intro = prologue.frame?.contentWindow?.intro;
  if (sola?.playing) return sola.skip();
  if (!intro) return;
  if (prologue.ended) { enter(chapter + 1, 0); return; }
  intro.t = intro.t < intro.FLIGHT - 8 ? intro.FLIGHT - 7 : intro.t < intro.T_LAND + 1 ? intro.T_LAND + 1.5 : intro.T_END - 1;
}

function prologueFrame() {
  const intro = prologue.frame?.contentWindow?.intro;
  if (!intro) return;
  const t = intro.t;
  if (prologue.black && t > 0.5) prologue.black.classList.remove('on');
  const cue = (name, at, fn) => { if (t >= at && !prologue.cues.has(name)) { prologue.cues.add(name); fn(); } };
  // Title over the flight (unless the Sola opening had it). Our eyes follow
  // the supply vessel first, then turn to each person as their name comes
  // up; the AI credit runs over the outside camera on the descent
  if (!sola?.open) {
    cue('title', 2, () => ui.title({ text: TITLE }));
    cue('title-off', 9, () => ui.title(null));
  }
  const headOf = (cast) => {
    const p = intro.passengers.find((x) => x.userData.cast === cast);
    return p && (() => (p.userData.bones.head ?? p).getWorldPosition(new THREE.Vector3()));
  };
  const vessel = intro.vessel && (() => intro.vessel.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 8, 0)));
  cue('aim-vessel', 0, () => { intro.aim = vessel; });
  CREDITS.forEach(([role, name, focus], i) => {
    if (focus === 'descent') {
      cue(`credit${i}`, intro.cut ? t : Infinity, () => ui.credit([role, name]));
      cue(`credit${i}-off`, intro.T_LAND - 0.3, () => ui.credit(null));
      return;
    }
    const at = 13 + i * 7;
    cue(`aim${i}`, at - 1.2, () => { intro.aim = headOf(focus) ?? vessel; });
    cue(`credit${i}`, at, () => ui.credit([role, name]));
    cue(`credit${i}-off`, at + 5, () => ui.credit(null));
  });
  cue('aim-back', 13 + (CREDITS.length - 1) * 7, () => { intro.aim = vessel; });
  cue('aim-free', 38, () => { intro.aim = null; });
  // Rotor sound: a drone in the cabin, the thump outside on the descent,
  // running down after touchdown
  cue('rotor-in', 0, () => sound.rotor(0.09, 2, 'inside'));
  // Music over the flight if the file is there (see story/README.md), unless
  // the Sola opening started it already; it plays on until Space
  cue('music', 0.5, () => sound.music(MUSIC));
  cue('rotor-out', intro.cut ? t : Infinity, () => sound.rotor(0.12, 1, 'outside'));
  cue('rotor-down', intro.T_LAND + 0.5, () => sound.rotor(0, 9, 'outside'));
  cue('p1', 5, () => say('pro.pilot1', token));
  cue('p2', 31, () => say('pro.pilot2', token));
  if (intro.FLIGHT > 70) cue('p3', intro.FLIGHT - 32, () => say('pro.pilot3', token));
  cue('p4', intro.T_LAND + 1.5, () => say('pro.pilot4', token));
  cue('end', intro.T_END - 1, () => {
    prologue.ended = true;
    ui.title({ text: 'Click or press Space to continue', small: true });
    showHudWaiting();
  });
}
function showHudWaiting() { waiting = true; showHud(); }

// ---------------------------------------------------------------- epilogue

async function epilogueReady() {
  if (!epilogue) epilogue = new Epilogue(game);
  await epilogue.load();
  epilogue.show();
  shots.custom = () => epilogue.pose();
}

// ---------------------------------------------------------------- the frame

function frame(dt, now) {
  S.now = now / 1000;
  if (!free) {
    shots?.update(dt);
    if (state.boatLabel && shots) {
      const p = shots.vesselPoint();
      if (p) ui.boat(state.boatLabel, p.x, p.y, /No /.test(state.boatLabel) ? 'bad' : 'good'); else ui.boat(null);
    } else ui.boat(null);
    if (state.org || state.graphOn === 'overlay') ui.org(state.graphOn === 'overlay' ? 'graph' : state.org, S.graph, S.now - S.graphAt, S.now);
    ui.clock(CHAPTERS[chapter]?.prologue ? null : S.clock);
  }
  cast?.update(dt, game.camera, S.now);
  epilogue?.update(dt);
}

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  call.update(dt, now / 1000);
  if (CHAPTERS[chapter]?.prologue) prologueFrame();
  sola?.update(dt);
  if (!game.room) S.now = now / 1000;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- start

const begin = document.createElement('div');
begin.className = 'begin';
begin.innerHTML = `<div class="inner"><p class="eyebrow">Story mode</p><h1>${TITLE}</h1>
  <p>A day on the platform, three times: yesterday, today and tomorrow. It waits for you at every step.</p>
  <dl class="keys"><dt>Space / →</dt><dd>next</dd><dt>←</dt><dd>back</dd><dt>1 – 9</dt><dd>jump to a chapter</dd><dt>F</dt><dd>free mode and back</dd><dt>P</dt><dd>presenter notes</dd></dl>
  <button type="button" id="storyGo" disabled>Loading the control room…</button></div>`;
host.append(begin);
const go = begin.querySelector('#storyGo');
begin.addEventListener('click', start);

game.ready.then(async () => {
  shots = new Shots(game);
  cast = new Cast(game);
  shots.cast = cast;
  game.hooks.frame.push(frame);
  await Promise.all([cast.load(), sound.loadIndex()]);
  go.disabled = false;
  go.textContent = 'Begin';
  if (!begin.parentNode) enter(chapter, beat, { instant: true });
}).catch((e) => { go.textContent = `Could not load: ${e.message}`; console.error(e); });
sound.loadIndex();

function start() {
  if (!begin.parentNode) return;
  if (go.disabled && !q.has('chapter')) {
    // The prologue can start before the room is ready: it loads underneath
  }
  begin.remove();
  if (!q.has('nofs') && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  game.controls.startAudio();
  sound.start(game.controls.audio?.ctx);
  sound.preload(Object.keys(lines).filter((k) => !k.startsWith('_')));
  const c = Math.max(0, CHAPTERS.findIndex((ch) => ch.key === Number(q.get('chapter') ?? 1)));
  const [hc, hb] = location.hash.slice(1).split('.').map(Number);
  const fromHash = hc ? CHAPTERS.findIndex((ch) => ch.key === hc) : -1;
  chapter = fromHash >= 0 && !q.has('chapter') ? fromHash : c;
  beat = fromHash >= 0 && !q.has('chapter') ? Math.max(0, (hb || 1) - 1) : 0;
  if (CHAPTERS[chapter].prologue || game.room) enter(chapter, beat, { instant: true });
  if (q.get('mode') === 'free') game.ready.then(() => setTimeout(toggleFree, 300));
}

// For automated screenshots and checks
window.__story = {
  start, next, back, enter: (key, i = 0, o) => enter(CHAPTERS.findIndex((ch) => ch.key === key), i, o),
  get state() { return { chapter: CHAPTERS[chapter].id, beat: CHAPTERS[chapter].beats[beat]?.id, running, waiting, free, s: state }; },
  beats: (key) => CHAPTERS.find((ch) => ch.key === key)?.beats.length ?? 0,
  sola: () => sola, epilogue: () => epilogue,
  ui, cast: () => cast, shots: () => shots, S, sound, toggleFree, SPEAKERS,
};
