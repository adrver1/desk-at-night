// Story mode: "A day in the life of EIGA", on rails like an advanced
// PowerPoint (design.md section 11). The room and everything in it come
// from play.js; this file steps through the chapters and beats of
// content.js, moves the camera, places the people, plays the lines with
// subtitles and drives the overlays.
//
// Keys: Space or → next, ← back, 1-9 chapter, F free mode (and back), P
// presenter notes, O debug overlay (free mode). A presentation clicker sends
// the same keys. URL: ?chapter=N, ?mode=free, ?sola=0 (skips the Sola apron
// scene before the flight, on by default), ?nofs (no fullscreen on start),
// ?story=full (the three-act version), ?lang=en|no (on-screen language).
import * as THREE from 'three';
import '../play.js';
import { CHAPTERS, ACTS, TITLE, CREDITS, SPEAKERS, CREW_NAMES } from './content.js';
import { FULL, LANG, T } from './lang.js';
import lines from './lines.json';
import { StoryUI } from './ui.js';
import { Sound } from './sound.js';
import { Cast } from './cast.js';
import { Call } from './call.js';
import { S, addStoryScreens } from './storyScreens.js';
import { DEFAULT_LAYOUT, contentOf } from '../screens.js';
import { Shots } from './shots.js';
import { Epilogue } from './epilogue.js';
import { Sola, LENGTH as SOLA_LENGTH } from './sola.js';
import { Trondheim } from './trondheim.js';
import { ClockFace } from './clockFace.js';

const game = window.__game;
const q = new URLSearchParams(location.search);
const PRIVATE = 'story/private/';
const MUSIC = 'story/music/flight.mp3';   // from the Sola opening (or the flight) until 'press Space'
// Colour grades per act (sepia yesterday and one year ago, blue tomorrow):
// off since 2026-10-24 (Adriaen), kept behind ?grade=1
const GRADES = q.get('grade') === '1';
addStoryScreens();

const host = document.getElementById('game');
const ui = new StoryUI(host, { privateBase: PRIVATE });
// The chapter navigator along the bottom (?nav=a|b|c, off with ?nav=0); see ui.nav
const NAV = new URLSearchParams(location.search).get('nav') ?? 'b';
if (NAV !== '0') ui.nav(CHAPTERS, NAV, (c, i) => { sound.wake(); return c === 'next' ? next() : c === 'back' ? back() : enter(c, i, { instant: true }); });
const sound = new Sound();
const call = new Call(ui.el.call);
const trondheim = new Trondheim(host);
let cast = null, shots = null, epilogue = null, clockFace = null;
// The Sola opening (on by default since 2026-10-25, off with ?sola=0) and its
// callback stills in Acts 1 and 3 of the full version (only with ?solastills=1)
const SOLA_OPEN = q.get('sola') !== '0';
const SOLA_STILLS = q.get('solastills') === '1';
const sola = SOLA_OPEN || SOLA_STILLS ? Object.assign(new Sola(game, { open: SOLA_OPEN }), { sound, titleText: TITLE, credits: CREDITS, music: MUSIC }) : null;
for (const ch of CHAPTERS) ch.beats = ch.beats.filter((b) => (!b.sola || SOLA_STILLS) && (b.pro !== 'sola' || SOLA_OPEN));

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
if (PRIVATE_ON) for (const id of ['stepTest', 'riser', 'antiSlug', 'scd', 'govDocs']) {
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
  let s = merge({ act: 0, graph: 0, alarms: null, overlay: null, boatLabel: null, org: null, tool: null, chats: null, place: null, sound: 'room' }, ch.base);
  for (let k = 0; k < i; k++) s = merge(merge(s, ch.beats[k].set), ch.beats[k].end);
  return merge(s, ch.beats[i].set);
}

// ---------------------------------------------------------------- applying state

let lastGrade = null;
function apply(s, { instant = false } = {}) {
  const prev = state;
  state = s;
  // Colour grade per act
  if (GRADES && lastGrade !== s.act) { host.classList.remove(`grade-${lastGrade}`); host.classList.add(`grade-${s.act}`); lastGrade = s.act; }
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
  // Chats: as many messages as the state says, the newest already typed
  for (const [id, n] of Object.entries(s.chats ?? {})) if (S.chats[id] !== n) { S.chats[id] = n; S.chatAt[id] = -99; }
  // Somewhere else than the control room (one year ago: Trondheim)
  // (its own canvas covers the room, so the room isn't drawn behind it)
  if (s.place === 'trondheim') { if (!trondheim.on) trondheim.show(); game.hooks.hidden = true; }
  else if (trondheim.on) { trondheim.hide(); game.hooks.hidden = false; }
  cast?.place(s.cast);
  cast?.mugs(s.mugs);
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
  h = ((h % 24) + 24) % 24;
  game.outdoor({ time: h });
  S.clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- beats

async function enter(c, i, { instant = false, skipDo = false } = {}) {
  token++;
  const my = token;
  sound.cut();
  cast?.halt();
  cast?.quiet();
  call.quiet();
  ui.subs();
  ui.title(null);
  chapter = c; beat = i;
  const ch = CHAPTERS[c], b = ch.beats[i];
  location.hash = `${ch.key}.${i + 1}`;
  if (ch.prologue) return startPrologue(b.pro);
  stopPrologue();
  if (sola) sola.hide();
  if (ch.id === 'epilogue') { await epilogueReady(); } else epilogue?.hide();
  if (my !== token) return;
  ui.clearNotices();
  apply(stateAt(c, i), { instant });
  if (b.sola && sola) { ui.clipAway(true); sola.still(b.sola, ui); }
  if (b.title) ui.title({ eyebrow: `Act ${b.title}`, text: ACTS[b.title].name, sub: ACTS[b.title].sub, solid: true });
  if (b.card) ui.title(b.card);
  host.classList.remove('rewinding', 'forwarding');
  clockFace?.show(false);
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
  if (b.auto && !skipDo && !free) next();
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function run(step, my) {
  if (step.at !== undefined) { await sleep(step.at); if (my !== token) return; }
  if (step.say) return say(step.say, my);
  // People moving about: { move: who, walk | sit | stand | carry | pour | face | pose | wait, to: spot }
  // queues and goes on at once; { idle: [who, ...] } waits for them to finish
  if (step.move) { cast?.move(step.move, step); return; }
  if (step.idle) return cast?.idle(...[].concat(step.idle));
  if (step.wait) return sleep(step.wait);
  if (step.torvet) return trondheim.reach(step.torvet);   // Trondheim's own timeline: 'meet' waits, 'in' goes
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
  if (step.chat) {
    const id = step.chat, n = (state.chats?.[id] ?? 0) + 1;
    state.chats = { ...state.chats, [id]: n };
    S.chats[id] = n; S.chatAt[id] = S.now;
    return sleep(0.3);
  }
  if (step.card !== undefined) { ui.title(step.card); return; }
  if (step.rewind) return rewind(step.rewind, my, -1);
  if (step.forward) return rewind(step.forward, my, 1);
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

// The rewind (dir -1) to one year ago, or the fast forward (dir 1) back to
// tomorrow: the clock races round, the picture judders like a tape, and on
// the way back the screens go out one by one (and with ?grade=1 the colour
// drains to sepia).
// The state lands where the beat's `end` says (or the next chapter's base).
async function rewind(over, my, dir) {
  const t0 = performance.now(), from = state.time ?? 12, span = 24 * 3;
  const screens = Object.keys(state.screens ?? {}).concat(Object.keys(DEFAULT_LAYOUT)).filter((n, i, a) => a.indexOf(n) === i);
  host.classList.add(dir < 0 ? 'rewinding' : 'forwarding');
  clockFace?.show(dir < 0);   // the rest corner's clock, big over the picture, on the way back to one year ago only
  sound.cut();
  let off = 0;
  while (performance.now() - t0 < over * 1000) {
    if (my !== token) { host.classList.remove('rewinding', 'forwarding'); clockFace?.show(false); return; }
    const k = (performance.now() - t0) / (over * 1000);
    setTime(from + dir * span * k * k * (3 - 2 * k));
    if (dir < 0) {
      // Screens out, a few at a time
      const want = Math.floor(smoothstep(k / 0.7) * screens.length);
      for (; off < want; off++) game.room?.setContent(screens[off], 'blank');
      if (GRADES && k > 0.45 && lastGrade !== 5) { host.classList.remove(`grade-${lastGrade}`); host.classList.add('grade-5'); lastGrade = 5; }
    }
    await sleep(1 / 30);
  }
  host.classList.remove('rewinding', 'forwarding');
  clockFace?.show(false);
}
const smoothstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

async function say(id, my) {
  const line = lines[id];
  if (!line) return;
  ui.subs(line.name ?? line.who, LANG === 'no' ? line.no ?? line.text : line.text);
  const mouth = sound.index[id]?.mouth ?? '';
  cast?.talk(line.who, mouth);
  trondheim.talk(line.who, mouth);
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
    cast?.halt();
    ui.subs();
    if (!b.card) ui.title(null);   // a title its steps put up goes with them
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
  sound.wake();
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
  sound.wake();
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

// Where each prologue subchapter starts on the intro's clock (s)
const PRO_START = { takeoff: () => 0, credits: () => 12, landing: (i) => i.FLIGHT - 33, walk: (i) => i.T_LAND + 1 };

// pro: the subchapter to start from (content.js PROLOGUE_BEATS). Sola plays
// the apron and goes on into the take-off; any other starts the intro at its
// time, with the music where it would be had it played through. carry: the
// take-off straight after the Sola opening, its music already running.
function startPrologue(pro = 'takeoff', { carry = false } = {}) {
  const my = token;
  trondheim.hide();
  game.hooks.hidden = true;
  ui.clipboard(null); ui.stars(null); ui.banner(null); ui.overlay(null, { call }); ui.org(null); ui.clearNotices(); ui.clock(null);
  host.classList.remove(`grade-${lastGrade}`); lastGrade = 0;
  showHud();
  if (pro === 'sola' && sola?.open) {
    stopPrologue();
    sola.done = false;
    return sola.play(host, ui, (id) => say(id, token)).then(() => {
      if (my !== token || !CHAPTERS[chapter].prologue) return;   // jumped elsewhere meanwhile
      beat = CHAPTERS[chapter].beats.findIndex((b) => b.pro === 'takeoff');
      location.hash = `${CHAPTERS[chapter].key}.${beat + 1}`;
      startPrologue('takeoff', { carry: true });
    });
  }
  if (sola?.playing) sola.finish();
  if (sola) sola.done = true;
  stopPrologue({ keepMusic: carry });   // the music carries on from the Sola opening
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
  prologue.seek = carry ? null : pro;   // done in prologueFrame once the intro is up
  prologue.skipBefore = 0;
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

// Jump the running intro to a time: what was due before it (lines, credits,
// the title) is passed over, the rest (sound, where we look) catches up
function proSeek(intro, t, { music = false } = {}) {
  intro.t = t;
  prologue.skipBefore = t;
  if (music) { sound.stopMusic(); sound.music(MUSIC, 0.35, (SOLA_OPEN ? SOLA_LENGTH : -0.5) + t); }
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
  if (game.hooks) game.hooks.hidden = trondheim.on;   // the room stays hidden behind Torvet
}

function prologueNext() {
  const intro = prologue.frame?.contentWindow?.intro;
  if (sola?.playing) return sola.skip();
  if (!intro) return;
  if (prologue.ended) { enter(chapter + 1, 0); return; }
  // on to the next subchapter, or the end of the last
  const nb = CHAPTERS[chapter].beats[beat + 1];
  proSeek(intro, nb ? PRO_START[nb.pro](intro) : intro.T_END - 1);
}

function prologueFrame() {
  const intro = prologue.frame?.contentWindow?.intro;
  if (!intro) return;
  if (prologue.seek) { const pro = prologue.seek; prologue.seek = null; if (pro !== 'takeoff' || SOLA_OPEN) proSeek(intro, PRO_START[pro](intro), { music: true }); }
  const t = intro.t;
  if (prologue.black && t > 0.5) prologue.black.classList.remove('on');
  // The navigator follows the subchapters as the intro plays through them
  const beats = CHAPTERS[chapter].beats;
  let k = beat;
  for (const [j, b] of beats.entries()) if (PRO_START[b.pro] && t >= PRO_START[b.pro](intro) - 0.05) k = j;
  if (k !== beat) { beat = k; location.hash = `${CHAPTERS[chapter].key}.${beat + 1}`; showHud(); }
  const cue = (name, at, fn) => {
    if (t < at || prologue.cues.has(name)) return;
    prologue.cues.add(name);
    if (at < prologue.skipBefore - 0.05 && /^(p\d|credit\d+|title)$/.test(name)) return;   // jumped past it
    fn();
  };
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
    cue(`credit${i}`, at, () => ui.credit([role, name, CREW_NAMES[focus]?.[1]]));   // with their BU, as at Sola
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
    ui.title({ text: T('Klikk eller trykk mellomrom for å fortsette', 'Click or press Space to continue'), small: true });
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
    ui.clock(CHAPTERS[chapter]?.prologue || state.place ? null : S.clock);
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
begin.innerHTML = `<div class="inner"><p class="eyebrow">${T('Fortellermodus', 'Story mode')}</p><h1>${TITLE}</h1>
  <p>${FULL ? 'A day on the platform, three times: yesterday, today and tomorrow. It waits for you at every step.'
    : T('Kontrollrommet i morgen, og veien dit. Den venter på deg ved hvert steg.', 'The control room of tomorrow, and the road there. It waits for you at every step.')}</p>
  <dl class="keys"><dt>${T('Mellomrom', 'Space')} / →</dt><dd>${T('neste', 'next')}</dd><dt>←</dt><dd>${T('tilbake', 'back')}</dd><dt>1 – ${CHAPTERS.length}</dt><dd>${T('hopp til et kapittel', 'jump to a chapter')}</dd><dt>F</dt><dd>${T('fri modus og tilbake', 'free mode and back')}</dd><dt>P</dt><dd>${T('presentatørnotater', 'presenter notes')}</dd></dl>
  <button type="button" id="storyGo" disabled>${T('Laster kontrollrommet…', 'Loading the control room…')}</button></div>`;
host.append(begin);
ui.onCover = (on) => { game.hooks.covered = on; };   // solid act titles: nothing to draw behind them
game.hooks.hidden = true;   // the Begin screen is opaque: no need to draw the room behind it (it still warms its shaders, see play.js)
const go = begin.querySelector('#storyGo');
begin.addEventListener('click', start);

game.ready.then(async () => {
  shots = new Shots(game);
  cast = new Cast(game);
  clockFace = new ClockFace(game);
  shots.cast = cast;
  game.hooks.frame.push(frame);
  await Promise.all([cast.load(), sound.loadIndex()]);
  go.disabled = false;
  go.textContent = T('Start', 'Begin');
  if (!begin.parentNode) enter(chapter, beat, { instant: true });
}).catch((e) => { go.textContent = `Could not load: ${e.message}`; console.error(e); });
sound.loadIndex();

function start() {
  if (!begin.parentNode) return;
  if (go.disabled && !q.has('chapter')) {
    // The prologue can start before the room is ready: it loads underneath
  }
  begin.remove();
  game.hooks.hidden = false;   // the prologue hides it again
  if (!q.has('nofs') && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  game.controls.startAudio();
  sound.start(game.controls.audio?.ctx);
  sound.preload(Object.keys(lines).filter((k) => !k.startsWith('_')));
  const [qc, qb] = (q.get('chapter') ?? '1').split('.').map(Number);   // ?chapter=N or N.beat
  const c = Math.max(0, CHAPTERS.findIndex((ch) => ch.key === qc));
  const [hc, hb] = location.hash.slice(1).split('.').map(Number);
  const fromHash = hc ? CHAPTERS.findIndex((ch) => ch.key === hc) : -1;
  chapter = fromHash >= 0 && !q.has('chapter') ? fromHash : c;
  beat = Math.min(CHAPTERS[chapter].beats.length - 1, fromHash >= 0 && !q.has('chapter') ? Math.max(0, (hb || 1) - 1) : Math.max(0, (qb || 1) - 1));
  if (CHAPTERS[chapter].prologue || game.room) enter(chapter, beat, { instant: true });
  if (q.get('mode') === 'free') game.ready.then(() => setTimeout(toggleFree, 300));
}

// For automated screenshots and checks
window.__story = {
  start, next, back, enter: (key, i = 0, o) => enter(CHAPTERS.findIndex((ch) => ch.key === key), i, o),
  get state() { return { chapter: CHAPTERS[chapter].id, beat: CHAPTERS[chapter].beats[beat]?.id, running, waiting, free, s: state }; },
  beats: (key) => CHAPTERS.find((ch) => ch.key === key)?.beats.length ?? 0,
  sola: () => sola, epilogue: () => epilogue, trondheim,
  ui, cast: () => cast, shots: () => shots, clockFace: () => clockFace, S, sound, toggleFree, SPEAKERS,
};
