// Story mode: "A day in the life of EIGA", on rails like an advanced
// PowerPoint (design.md section 11). The room and everything in it come
// from play.js; this file steps through the chapters and beats of
// content.js, moves the camera, places the people, plays the lines with
// subtitles and drives the overlays.
//
// Keys: Space or → next, ← back, 1-9 chapter, F free mode (and back), P
// presenter notes, O debug overlay (free mode). A presentation clicker sends
// the same keys. URL: ?chapter=N, ?mode=free, ?sola=1 (adds the Sola apron
// scene before the flight, off by default), ?nofs (no fullscreen on start),
// ?story=full (the three-act version), ?lang=en|no (on-screen language),
// ?bench=1 (frame rate benchmark, bench.js).
import * as THREE from 'three';
import '../play.js';
import { CHAPTERS, ACTS, TITLE, CREDITS, SPEAKERS, CHATS, CHAT_SCREEN, REPORT_SCREEN, CREW_NAMES, DISCLAIMER } from './content.js';
import { T, SPEECH, cycleSpeech } from './lang.js';
import lines from './lines.json';
import { PRIVATE as PRIVATE_ON, OVERRIDES, realDeep, real } from '../privateNames.js';
import { StoryUI } from './ui.js';
import { Sound } from './sound.js';
import { Ambience } from './ambience.js';
import { Cast } from './cast.js';
import { Call } from './call.js';
import { S, addStoryScreens } from './storyScreens.js';
import { DEFAULT_LAYOUT, contentOf } from '../screens.js';
import { Shots } from './shots.js';
import { Epilogue } from './epilogue.js';
import { Sola, LENGTH as SOLA_LENGTH } from './sola.js';
import { Trondheim } from './trondheim.js';
import { ClockFace } from './clockFace.js';
import { Buddy } from './buddy.js';
import { closeups } from './closeups.js';
import { screenSlide } from './screenSlide.js';
import { Workshop } from './workshop.js';
import { Twin } from './twin.js';
import { Retune } from './retune.js';
import { Thoughts } from './thoughts.js';
import { Explain } from './explain.js';
import { Caller } from './caller.js';

const game = window.__game;
const q = new URLSearchParams(location.search);
const PRIVATE = 'story/private/';
const MUSIC = 'story/music/flight.mp3';   // from the Sola opening (or the flight) until 'press Space'
// Colour grades per act (sepia yesterday and one year ago, blue tomorrow):
// off since 2026-10-24 (Adriaen), kept behind ?grade=1
const GRADES = q.get('grade') === '1';
addStoryScreens();

const host = document.getElementById('game');
const ui = new StoryUI(host, { privateBase: PRIVATE, publicBase: 'story/' });
// The chapter navigator along the bottom (?nav=a|b|c, off with ?nav=0); see ui.nav
const NAV = new URLSearchParams(location.search).get('nav') ?? 'b';
if (NAV !== '0') ui.nav(CHAPTERS, NAV, (c, i) => { sound.wake(); return c === 'next' ? next() : c === 'back' ? back() : enter(c, i, { instant: true }); });
const sound = new Sound();
// The room's background life (ambience.js): dips with the aircon under every spoken line
const ambience = new Ambience(sound, null);
sound.onDuck = (on) => { ambience.duck(on); if (game.controls) game.controls.duck = on ? 0.5 : 1; };
game.hooks.sip = () => { if (ambience.out) ambience.slurp(ambience.ctx.currentTime); };   // free play: the player's own sip
const call = new Call(ui.el.call);
const trondheim = new Trondheim(host);
let cast = null, shots = null, epilogue = null, clockFace = null, buddy = null, workshop = null, twin = null;
const thoughts = new Thoughts();
const explain = new Explain();
const retune = new Retune();
const caller = new Caller();
// The Sola opening (off since 2026-10-29, Adriaen: "Remove Sola beat"; kept,
// on with ?sola=1) and its callback stills in Acts 1 and 3 of the full
// version (only with ?solastills=1)
const SOLA_OPEN = q.get('sola') === '1';
const SOLA_STILLS = q.get('solastills') === '1';
const sola = SOLA_OPEN || SOLA_STILLS ? Object.assign(new Sola(game, { open: SOLA_OPEN }), { sound, titleText: TITLE, credits: CREDITS, music: MUSIC }) : null;
for (const ch of CHAPTERS) ch.beats = ch.beats.filter((b) => (!b.sola || SOLA_STILLS) && (b.pro !== 'sola' || SOLA_OPEN));

// Private overrides (git-ignored, ?private=1): real names and statuses,
// slide images and tool screenshots for the private build
// (privateNames.js has already read overrides.json; its `names` map turns
// the public stand-ins into the real names, here in the spoken lines)
if (PRIVATE_ON) { realDeep(lines); applyOverrides(OVERRIDES); }
if (q.get('fps') === '1' || q.has('perf')) document.documentElement.classList.add('show-fps');   // the panel sits on <body>, outside the game
function applyOverrides(o) {
  // { lines: { id: text | { text, no, voice, subs } }, cards: { id: { initiative, status } }, slides: { id: {...} | { no, en } },
  //   chats: { id: {...} }, chatText: { id: { index: { no, en } } }, beats: { id: { notes, callouts } } }
  //   (the last two from the story editor's live stage)
  realDeep(o);
  for (const [id, v] of Object.entries(o.lines ?? {})) if (lines[id]) Object.assign(lines[id], typeof v === 'string' ? { text: v } : v);
  const tx = (v) => (v && typeof v === 'object' ? T(v.no ?? v.en, v.en ?? v.no) : v ?? '');
  for (const [id, v] of Object.entries(o.beats ?? {})) for (const ch of CHAPTERS) for (const b of ch.beats) if (b.id === id) {
    if ('notes' in v) b.notes = v.notes;
    if ('callouts' in v) b.callouts = v.callouts?.map((c) => ({ ...c, label: tx(c.label), text: tx(c.text) }));
  }
  return import('./content.js').then((c) => {
    for (const [id, v] of Object.entries(o.cards ?? {})) Object.assign(c.CARDS[id] ?? {}, v);
    for (const [id, v] of Object.entries(o.slides ?? {})) c.SLIDES[id] = { ...c.SLIDES[id], ...(v.no || v.en ? T(v.no ?? v.en, v.en ?? v.no) : v) };
    for (const [id, v] of Object.entries(o.chats ?? {})) c.setChat(id, v);
    const own = PRIVATE_ON && o !== OVERRIDES ? OVERRIDES.chatText : null;   // the editor's Live stage in the private build
    for (const [id, v] of Object.entries(o.chatText ?? {})) c.setChatText(id, v, own?.[id], (a, b) => a === b || a === real(b));
  });
}
ui.findSlides(PRIVATE_ON);
if (PRIVATE_ON) for (const id of ['stepTest', 'riser', 'antiSlug', 'scd', 'govDocs']) {
  const img = new Image();
  img.onload = () => { S.images[id] = img; };
  img.src = `${PRIVATE}tools/${id}.png`;
}

// ---------------------------------------------------------------- state

let chapter = 0, beat = 0;     // where we are
let token = 0;                 // bumps when a beat is left, so its steps stop
let running = false, waiting = false;
let onScreen = null;           // screenSlide.js, made once the camera is there
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
  // a chapter that carries on (content.js `carry`) starts where the one before it ends
  let s = ch.carry && c > 0 ? endOf(c - 1) : merge({ act: 0, graph: 0, alarms: null, overlay: null, boatLabel: null, org: null, tool: null, chats: null, place: null, sound: 'room' }, ch.base);
  for (let k = 0; k < i; k++) s = chatDone(merge(merge(s, ch.beats[k].set), ch.beats[k].end), ch.beats[k]);
  return merge(s, ch.beats[i].set);
}

const endOf = (c) => { const bs = CHAPTERS[c].beats, b = bs[bs.length - 1]; return chatDone(merge(stateAt(c, bs.length - 1), b.end), b); };
// A chat beat once past: every message shown
const chatDone = (s, b) => (b.chat ? { ...s, chats: { ...s.chats, [b.chat]: chatEnd(b) } } : s);
// where a chat beat's messages end: the whole chat, or its part (content.js `upto`)
const chatEnd = (b) => b.upto ?? CHATS[b.chat].messages.length;

// A chat beat's clicks: one message more (or less), the camera on the chat,
// or on the report beside it when the message hands one over
function chatStep(dir) {
  const b = CHAPTERS[chapter]?.beats[beat], id = b?.chat;
  if (!id || running) return false;
  const n0 = state.chats?.[id] ?? 0, n = n0 + dir;
  // a message that sets something going in the room (the twin's corrections) does it on a click of its own
  // after it is sent, and a click back undoes that first (Adriaen, 2026-11-01)
  const act = `${id}:${n0}`;
  if (CHATS[id].messages[n0 - 1]?.[2]?.twin) {
    if (dir > 0 && !S.acts.has(act)) { S.acts.add(act); return true; }
    if (dir < 0 && S.acts.delete(act)) return true;
  }
  if (n < (b.from ?? 0) + 1 || n > chatEnd(b)) return false;
  chatTo(id, n, dir > 0);
  return true;
}
// those clicks (chatStep): had for the first `upto` messages of a chat, still to come for the rest
const actsTo = (id, n, upto) => CHATS[id]?.messages.forEach((m, i) => S.acts[i < upto ? 'add' : 'delete'](`${id}:${i + 1}`));
function chatTo(id, n, typing) {
  const show = CHATS[id].messages[n - 1][0] === 'show';
  apply(merge(state, { chats: { ...state.chats, [id]: n }, shot: show ? CHATS[id].reportShot ?? `monitor:${REPORT_SCREEN}` : CHATS[id].shot ?? `monitor:${CHAT_SCREEN}` }));
  actsTo(id, n, typing ? n - 1 : n);   // this message's click still to come when it is sent now
  // our reply to a report waits for the camera's way back from it, so the typing is seen (Adriaen, 2026-11-01)
  const wait = typing && CHATS[id].messages[n - 1]?.[0] === 'me' && CHATS[id].messages[n - 2]?.[0] === 'show' ? REPLY_WAIT : 0;
  if (typing) S.chatAt[id] = S.now + wait + typed(id, n, wait);
}
const REPLY_WAIT = 1.8;

// Our own message in a chat (Adriaen, 2026-10-29): typed out letter by letter
// to keyboard clacks, quickly; done when the result is in (s to wait). Faster since 2026-11-01
// (Adriaen: snappier chats; was 32 letters a second, 0.7 to 3.5 s)
const TYPE_CPS = 55, TYPE_TIME = [0.4, 2.0];
function typed(id, n, wait = 0) {
  const m = CHATS[id].messages[n - 1];
  if (m?.[0] !== 'me') return 0;
  const secs = Math.min(TYPE_TIME[1], Math.max(TYPE_TIME[0], String(m[1]).length / TYPE_CPS));
  sound.typing(secs, wait);
  S.chatType[id] = secs;
  return secs;
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
  for (const [id, n] of Object.entries(s.chats ?? {})) if (S.chats[id] !== n) { S.chats[id] = n; S.chatAt[id] = -99; actsTo(id, n, n); }
  game.room?.redrawNow?.();   // the screens show this state from the next frame on, not a quarter second late
  // Somewhere else than the control room (one year ago: Trondheim)
  // (its own canvas covers the room, so the room isn't drawn behind it)
  if (s.place === 'trondheim') { if (!trondheim.on) trondheim.show(); game.hooks.hidden = true; }
  else if (trondheim.on) { trondheim.hide(); game.hooks.hidden = false; }
  cast?.place(s.cast);
  buddy?.set(s);
  workshop?.set(s.build);
  twin?.set(s.twin);
  if (twin) twin.settled = s.twin === 'fix' && s.screens?.Desk0Mon0Screen !== 'twinChat';   // the sim2 chat is over: the fixed twin, from the front
  thoughts.set(s.thoughts);
  explain.set(s.explain);
  retune.set(s.retune);
  caller.set(s.call, s.callStage);
  if (!s.call || s.callStage !== 'ring') sound.hangUp();   // the phone stops ringing once the call is over or answered
  cast?.phone(s.phone, instant);
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
let roomVolume = 34;   // the aircon, a little quieter under the room's other sounds (Adriaen, 2026-11-01)

function setTime(h) {
  h = ((h % 24) + 24) % 24;
  game.outdoor({ time: h });
  S.clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- beats

async function enter(c, i, { instant = false, skipDo = false, at = 0 } = {}) {
  token++;
  const my = token;
  sound.cut();
  cast?.halt();
  cast?.quiet();
  call.quiet();
  ui.subs();
  ui.title(null);
  ui.callouts(null);
  chapter = c; beat = i;
  const ch = CHAPTERS[c], b = ch.beats[i];
  location.hash = `${ch.key}.${i + 1}`;
  if (ch.prologue) return startPrologue(b.pro, { at });
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
  ui.callouts(b.callouts);
  if (CHAPTERS[c].key === 2) trondheim.prepare();   // tomorrow: Trondheim loads and compiles now, ready for after the rewind
  running = true; waiting = false;
  if (!skipDo) {
    // at: start that many seconds in (the editor's timeline): the steps before it happen at once
    let clock = 0, rushing = at > 0;
    for (const step of b.do ?? []) {
      if (my !== token) return;
      if (rushing && clock < at && (step.at === undefined || clock + step.at < at)) { clock += rush(step, my); continue; }
      if (rushing) { rushing = false; cast?.rush(game.camera, S.now); }
      if (step.at !== undefined) { run(step, my); continue; }  // timed steps run alongside
      await run(step, my);
    }
    if (rushing) cast?.rush(game.camera, S.now);
  } else if (b.end) apply(merge(state, b.end), { instant: true });
  if (skipDo && b.chat) chatTo(b.chat, chatEnd(b), false);
  if (skipDo && thoughts.on) thoughts.show(Infinity);   // stepped back into: every bubble
  if (my !== token) return;
  if (!skipDo && b.chat && (state.chats?.[b.chat] ?? 0) <= (b.from ?? 0)) chatTo(b.chat, (b.from ?? 0) + 1, true);   // a chat (or its part) opens with its first message, typed out
  running = false; waiting = true;
  showHud();
  if (b.auto && !skipDo && !free) next();
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// A step done at once, for a start partway into a beat; returns the time it
// takes in the editor's reckoning (scripts/story-editor/seed.py), which
// places the timeline's moments
function rush(step, my) {
  if (step.say) return (sound.entry(step.say)?.dur ?? 2.5) + 0.3;
  if (step.wait) return step.wait;
  if (step.idle) return 2.5;
  if (step.rewind || step.forward) {
    setTime((state.time ?? 12) + (step.rewind ? -72 : 72));
    if (step.rewind && GRADES && lastGrade !== 5) { host.classList.remove(`grade-${lastGrade}`); host.classList.add('grade-5'); lastGrade = 5; }
    return step.rewind || step.forward;
  }
  if (step.torvet) return { meet: 4, shake: 2, in: 3 }[step.torvet] ?? 2;
  if (step.sound) return 0;
  if (step.move) { cast?.move(step.move, step); return 0; }
  if (step.set) { apply(merge(state, step.set), { instant: true }); return 0; }
  if (step.chat) {
    const id = step.chat, n = (state.chats?.[id] ?? 0) + 1;
    state.chats = { ...state.chats, [id]: n };
    S.chats[id] = n; S.chatAt[id] = -99; actsTo(id, n, n);
    return CHATS[id].messages[n - 1]?.[0] === 'ai' ? 1.2 : 0.2;
  }
  if (step.buddy === 'click') { buddy?.clicked(); return 0; }
  if (step.clock) { setTime(step.clock[1]); return 0; }
  run(step, my);   // the rest (cards, notices, the graph, ticks) are quick
  return 0;
}

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
  if (step.sound === 'ringtone') { sound.ringtone(step.times ?? 2); return; }   // 2.55 s a ring; it rings on into the next beats until picked up
  if (step.sound === 'pickup') { sound.pickup(); return; }
  if (step.sound === 'hangup') { sound.hangupClick(); return; }
  // CtrlBuddy's first appearance: the mouse pointer goes to him and clicks
  if (step.buddy === 'click') return buddy?.clickHim(() => sound.click());
  if (step.sound === 'alarmShort') { sound.startAlarm(3, 0.06); setTimeout(() => sound.stopAlarm(), 5000); return; }
  if (step.notice) {
    ui.notice(step.notice);
    sound.chime();
    const { NOTICES } = await import('./content.js');
    S.notices.push([...NOTICES[step.notice], S.now]);
    return sleep(0.6);
  }
  if (step.chat) {
    // our own message is typed out under the line that follows (spoken as it
    // is typed, Adriaen 2026-10-29); the next message waits for the typing
    const id = step.chat, left = (S.chatAt[id] ?? 0) - S.now;
    if (left > 0) { await sleep(left); if (my !== token) return; }
    const n = (state.chats?.[id] ?? 0) + 1;
    state.chats = { ...state.chats, [id]: n };
    const wait = typed(id, n);
    S.chats[id] = n; S.chatAt[id] = S.now + wait; actsTo(id, n, n);
    game.room?.redrawNow?.();
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
// tomorrow: the clock races round and the picture judders like a tape (and
// with ?grade=1 the colour drains to sepia on the way back). The screens stay
// on: going dark they looked like they were failing (Adriaen, 2026-10-29).
// The state lands where the beat's `end` says (or the next chapter's base).
async function rewind(over, my, dir) {
  const t0 = performance.now(), from = state.time ?? 12, span = 24 * 3;
  host.classList.add(dir < 0 ? 'rewinding' : 'forwarding');
  clockFace?.show(dir < 0);   // the rest corner's clock, big over the picture, on the way back to one year ago only
  sound.cut();
  while (performance.now() - t0 < over * 1000) {
    if (my !== token) { host.classList.remove('rewinding', 'forwarding'); clockFace?.show(false); return; }
    const k = (performance.now() - t0) / (over * 1000);
    setTime(from + dir * span * k * k * (3 - 2 * k));
    if (dir < 0) {
      if (GRADES && k > 0.45 && lastGrade !== 5) { host.classList.remove(`grade-${lastGrade}`); host.classList.add('grade-5'); lastGrade = 5; }
    }
    await sleep(1 / 30);
  }
  host.classList.remove('rewinding', 'forwarding');
  clockFace?.show(false);
}

async function say(id, my) {
  const line = lines[id];
  if (!line) return;
  // Each line can switch its own voice and subtitle off (lines.json
  // `voice: false` / `subs: false`, set in the editor); a line with neither
  // still takes its time
  const voiced = line.voice !== false && SPEECH.voice !== 'off';
  if (SPEECH.subs !== 'off' && line.subs !== false) ui.subs(line.name ?? line.who, SPEECH.subs === 'no' ? line.no ?? line.text : line.text);
  const mouth = voiced ? sound.entry(id)?.mouth ?? '' : '';
  cast?.talk(line.who, mouth);
  trondheim.talk(line.who, mouth);
  call.talk(line.who, mouth);
  shots?.speaker(line.who);
  if (voiced) await sound.line(id);
  else await sleep(sound.entry(id)?.dur ?? 3);
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
  if (!running && ui.stepBuild(1)) return;
  if (thoughts.step(1)) return;
  if (chatStep(1)) return;
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
  if (ui.stepBuild(-1)) return;
  if (thoughts.step(-1)) return;
  if (chatStep(-1)) return;
  // a slide we step back into shows all its clicks
  if (beat > 0 || chapter > 0) ui.buildFromEnd = true;
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

function speechToast(k) {
  const v = cycleSpeech(k), say = { no: T('norsk', 'Norwegian'), en: T('engelsk', 'English'), off: T('av', 'off') }[v];
  if (k === 'subs' && v === 'off') ui.subs();
  const el = document.querySelector('.speech-toast') ?? Object.assign(document.createElement('div'), { className: 'speech-toast' });
  el.textContent = `${k === 'voice' ? T('Tale', 'Voice') : T('Undertekst', 'Subtitles')}: ${say}${k === 'voice' && v === 'no' && !Object.keys(sound.indexNo ?? {}).length ? T(' (engelsk til norsk tale finnes)', ' (English until Norwegian takes exist)') : ''}`;
  (document.getElementById('game') ?? document.body).append(el);
  el.classList.add('on'); clearTimeout(el.t); el.t = setTimeout(() => el.classList.remove('on'), 1800);
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
  // V: the voice, U: the subtitles (undertekst), each Norwegian, English or off
  if (e.code === 'KeyV' || e.code === 'KeyU') { speechToast(e.code === 'KeyV' ? 'voice' : 'subs'); return; }
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
function startPrologue(pro = 'takeoff', { carry = false, at = 0 } = {}) {
  const my = token;
  trondheim.hide();
  game.hooks.hidden = true;
  ui.clipboard(null); ui.stars(null); ui.banner(null); ui.overlay(null, { call }); ui.org(null); ui.clearNotices();
  // The room's own overlays too (a jump from the call, the curve or the explainer straight into the prologue)
  buddy?.set({}); workshop?.set(null); twin?.set(null); thoughts.set(null); explain.set(null); retune.set(null); caller.set(null); sound.hangUp(); cast?.phone(null, true);
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
  prologue.seekAt = at;   // s into it (the editor's timeline; not for Sola, which plays from its start)
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
  if (prologue.seek) { const pro = prologue.seek, at = prologue.seekAt || 0; prologue.seek = null; if (pro !== 'takeoff' || SOLA_OPEN || at) proSeek(intro, PRO_START[pro](intro) + at, { music: true }); }
  const t = intro.t;
  if (prologue.black && t > 0.5) {
    if (irisWait) { prologue.black.remove(); prologue.black = null; irisOpen(irisWait); irisWait = null; }   // the Begin screen opens onto the flight
    else prologue.black.classList.remove('on');
  }
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
  cue('rotor-in', 0, () => sound.rotor(0.15, 2, 'inside'));   // louder over the credits (Adriaen, 2026-11-01)
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
    // no "press Space" prompt: the presenter knows (Adriaen, 2026-10-30)
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
  }
  // a live slide on a room screen (ctrl-08s): laid over the monitor, the camera pulling back on its last click
  if (shots && !free) (onScreen ??= screenSlide({ game, ui, shots, host, get cast() { return cast; } }))(state, S.now);
  caller.update(dt);
  // letters being typed into a chat: the zoomed screen redrawn every frame, not at its own rate
  if (Object.entries(S.chatAt).some(([id, at]) => at > S.now && S.chatType[id])) game.room?.redrawFocus?.();
  // the step report while it scrolls and draws (stepReport.js, about 6 s after its message): every frame, not
  // the close-up's 8 a second, which made the scroll judder (Adriaen, 2026-11-01)
  if (state.screens?.[REPORT_SCREEN] === 'report:step' && S.now - (S.chatAt.step ?? -99) < 6.5) game.room?.redrawAt?.(60, REPORT_SCREEN);
  cast?.update(dt, game.camera, S.now);
  ambience.set(Boolean(game.room) && !game.hooks.hidden && !game.hooks.covered && (free || state.sound !== 'silence'), state.sound === 'alarm');   // free: a silent beat stays behind, the room and the sips are heard
  ambience.update(dt, game.camera);
  buddy?.update(dt, S.now);
  workshop?.update(dt);
  twin?.update(dt);
  retune.update(dt);
  epilogue?.update(dt);
  // a report's video plays only while its screen is drawn
  for (const v of Object.values(S.videos)) if (!v.paused && S.now - v.seen > 0.5) v.pause();
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

// Start opens the Begin screen (with the disclaimer, Adriaen 2026-10-30) like an iris onto the show:
// a copy of it stays on top while a circle opens from the middle
function irisOpen(el) {
  const veil = el.cloneNode(true);
  veil.classList.add('iris');
  el.replaceWith(veil);
  // its own clock, a frame at most 1/30 s: entering the first beat can stall a frame or two, and the circle should still open
  const D = 1.4, R = Math.hypot(innerWidth, innerHeight) / 2 + 40;
  let k = 0, last = null;
  const step = (now) => {
    if (last != null) k = Math.min(1, k + Math.min((now - last) / 1000, 1 / 30) / D);
    last = now;
    veil.style.setProperty('--r', `${R * k * k * (3 - 2 * k)}px`);
    if (k < 1) requestAnimationFrame(step); else veil.remove();
  };
  requestAnimationFrame(step);
}
const begin = document.createElement('div');
begin.className = 'begin';
// just the title, the disclaimer and Start (Adriaen, 2026-10-30)
begin.innerHTML = `<div class="inner"><h1>${TITLE}</h1>
  <p class="disclaimer">${DISCLAIMER}</p>
  <button type="button" id="storyGo" disabled>${T('Laster kontrollrommet…', 'Loading the control room…')}</button></div>`;
host.append(begin);
ui.onCover = (on) => { game.hooks.covered = on; };   // solid act titles: nothing to draw behind them
game.hooks.hidden = true;   // the Begin screen is opaque: no need to draw the room behind it (it still warms its shaders, see play.js)
const go = begin.querySelector('#storyGo');
begin.addEventListener('click', start);

game.ready.then(async () => {
  shots = new Shots(game);
  cast = new Cast(game);
  ambience.cast = cast;
  buddy = new Buddy(game, CHAT_SCREEN);
  workshop = new Workshop(game);
  twin = new Twin(game);
  clockFace = new ClockFace(game);
  shots.cast = cast;
  game.hooks.frame.push(frame);
  await Promise.all([cast.load(), buddy.load(), workshop.load(), twin.load(), sound.loadIndex()]);
  // Their shaders compiled now, behind the Begin screen, not on the frame
  // each first shows (the bench saw 9 to 16 new programs on those frames)
  for (const x of [{ scene: game.scene }, cast, buddy, workshop, twin]) {   // the room too: things hidden until a beat shows them (the desk phones)
    if (!x?.scene) continue;
    const r = game.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(x.rt ?? null);
    r.compileAsync?.(x.scene, x.camera ?? game.camera).catch(() => {});
    r.setRenderTarget(prev);
  }
  // ... and every texture in the room and the story's scenes uploaded now:
  // the first frame after Begin uploaded ~29 Mpx (light maps, atlas) and
  // took 0.4 to 0.6 s on the Arc laptop (bench)
  const seen = new Set();
  const upload = (t) => { if (t?.isTexture && !t.isRenderTargetTexture && t.image && !seen.has(t)) { seen.add(t); game.renderer.initTexture(t); } };
  for (const root of [game.scene, cast?.scene, buddy?.scene, workshop?.scene, twin?.scene]) root?.traverse((o) => {
    for (const m of [o.material].flat()) {
      if (!m) continue;
      for (const v of Object.values(m)) upload(v);
      for (const u of Object.values(m.uniforms ?? {})) upload(u?.value);
    }
  });
  warmUp();
  go.disabled = false;
  go.textContent = T('Start', 'Begin');
  if (started && !CHAPTERS[chapter].prologue) enter(chapter, beat, { instant: true });   // started before the room was in (the flight doesn't need it)
  // Sharp close-up screens, laid over the picture (closeups.js); ?closeup=0 for none
  if (q.get('closeup') !== '0') game.hooks.frame.push(closeups(game));
  // ?bench=1: the frame rate benchmark (bench.js)
  if (q.has('bench')) import('./bench.js').then(({ runBench }) => runBench({ start, goto: window.__story.goto, game }));
}).catch((e) => { go.textContent = `Could not load: ${e.message}`; console.error(e); });
sound.loadIndex();

// Everything drawn once, out of sight, while the Begin screen is up: the
// room and the cast with frustum culling off (so every object's buffers go
// up, whatever the first beat looks at), the story's own picture scenes, and
// the sun's shadows with a sun for a moment. The first room frame took
// ~450 ms on the Arc laptop (bench, 2026-10-31): 230 ms first drawing the
// room, 150 ms the platform's first sun shadow.
function warmUp() {
  const r = game.renderer, cam = game.camera;
  const vp = r.getViewport(new THREE.Vector4()), sc = r.getScissor(new THREE.Vector4()), test = r.getScissorTest();
  const unculled = [];
  for (const root of [game.scene, cast?.scene]) root?.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
  const light = game.outdoor3?.light;
  try {
    if (light) game.room?.setDaylight({ ...light, sun: new THREE.Color(1, 1, 1), sunDir: new THREE.Vector3(-0.5, 0.6, 0.3).normalize() }, 0);
    r.setRenderTarget(null);
    r.setViewport(0, 0, 1, 1); r.setScissor(0, 0, 1, 1); r.setScissorTest(true);
    r.render(game.scene, cam);
    if (cast?.scene) r.render(cast.scene, cam);
    for (const x of [buddy, workshop, twin]) if (x?.scene && x.rt) { r.setRenderTarget(x.rt); r.render(x.scene, x.camera); }
  } catch (e) { console.warn('warm-up', e); } finally {
    r.setRenderTarget(null);
    r.setViewport(vp); r.setScissor(sc); r.setScissorTest(test);
    for (const o of unculled) o.frustumCulled = true;
    if (light) game.room?.setDaylight(light, 0);
  }
}

let wantBeat = null, wantAt = 0;   // __story.goto before Start
let started = false, irisWait = null;   // the Begin screen waiting for the intro (start, prologueFrame)
function start() {
  if (!begin.parentNode || started) return;
  if (go.disabled && !q.has('chapter')) {
    // The prologue can start before the room is ready: it loads underneath
  }
  started = true;
  game.hooks.hidden = false;   // the prologue hides it again
  if (!q.has('nofs') && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  game.controls.startAudio();
  sound.start(game.controls.audio?.ctx);
  if (q.get('ambience') !== '0') ambience.start();   // ?ambience=0: only the aircon, as before
  sound.preload(Object.keys(lines).filter((k) => !k.startsWith('_')));
  const [qc, qb] = (q.get('chapter') ?? '1').split('.').map(Number);   // ?chapter=N or N.beat
  const c = Math.max(0, CHAPTERS.findIndex((ch) => ch.key === qc));
  const [hc, hb] = location.hash.slice(1).split('.').map(Number);
  const fromHash = hc ? CHAPTERS.findIndex((ch) => ch.key === hc) : -1;
  chapter = fromHash >= 0 && !q.has('chapter') ? fromHash : c;
  beat = Math.min(CHAPTERS[chapter].beats.length - 1, fromHash >= 0 && !q.has('chapter') ? Math.max(0, (hb || 1) - 1) : Math.max(0, (qb || 1) - 1));
  // ?beat=<beat id> (the story script editor's ▶ links): that beat, wherever it is now
  const want = wantBeat ?? q.get('beat');
  if (want) CHAPTERS.forEach((ch, ci) => { const bi = ch.beats.findIndex((b) => b.id === want); if (bi >= 0) { chapter = ci; beat = bi; } });
  // Into the flight, the Begin screen stays up until the intro's first frames are in and then opens
  // straight onto them, with no fade from black (prologueFrame; Adriaen, 2026-11-01). Elsewhere it opens now.
  if (CHAPTERS[chapter].prologue && CHAPTERS[chapter].beats[beat]?.pro !== 'sola') {
    irisWait = begin;
    setTimeout(() => { if (irisWait) { irisOpen(irisWait); irisWait = null; } }, 8000);   // should the intro never get going
  } else irisOpen(begin);
  if (CHAPTERS[chapter].prologue || game.room) enter(chapter, beat, { instant: true, at: wantBeat ? wantAt : 0 });
  if (q.get('mode') === 'free') game.ready.then(() => setTimeout(toggleFree, 300));
}

// For automated screenshots and checks
window.__story = {
  start, next, back, override: applyOverrides, ambience,
  // the story editor's live stage: play a beat by its id, with its moves and lines
  // (at: seconds into it, as the editor's timeline places its moments)
  goto: (id, { at = 0 } = {}) => {
    const ci = CHAPTERS.findIndex((ch) => ch.beats.some((b) => b.id === id));
    if (ci < 0) return false;
    if (!started) { wantBeat = id; wantAt = at; return true; }   // Start (a tap in the game, so sound may play) goes there
    game.ready.then(() => enter(ci, CHAPTERS[ci].beats.findIndex((b) => b.id === id), { at }));
    return true;
  },
  enter: (key, i = 0, o) => enter(CHAPTERS.findIndex((ch) => ch.key === key), i, o),
  get state() { return { chapter: CHAPTERS[chapter].id, beat: CHAPTERS[chapter].beats[beat]?.id, running, waiting, free, s: state }; },
  beats: (key) => CHAPTERS.find((ch) => ch.key === key)?.beats.length ?? 0,
  sola: () => sola, epilogue: () => epilogue, trondheim,
  ui, cast: () => cast, shots: () => shots, caller, clockFace: () => clockFace, S, sound, toggleFree, SPEAKERS,
};
