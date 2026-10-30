// Which story and which language. The default run is the short one
// (design.md 18b/18c) with Norwegian on screen; ?story=full is the three-act
// version, in English. ?lang=en or ?lang=no picks the language for either.
const q = new URLSearchParams(location.search);
export const FULL = q.get('story') === 'full';
export const LANG = q.get('lang') === 'en' || q.get('lang') === 'no' ? q.get('lang') : (FULL ? 'en' : 'no');
// T('Norsk', 'English'): the text for the current language
export const T = (no, en) => (LANG === 'en' ? en : no);

// What is heard and what is read of the spoken lines, set apart (Adriaen,
// 2026-10-29): the voice in Norwegian, English or none, the subtitles in
// Norwegian, English or none, in any combination. Both follow the on-screen
// language unless ?voice= / ?subs= (no | en | off) or the V / U keys set them
// (the keys' choice is kept for next time). A line with no Norwegian
// recording yet is heard in English (sound.js).
const OPTS = ['no', 'en', 'off'];
const kept = (k) => { try { return localStorage.getItem(`story.${k}`); } catch { return null; } };
const pick = (k) => (OPTS.includes(q.get(k)) ? q.get(k) : OPTS.includes(kept(k)) ? kept(k) : LANG);
export const SPEECH = { voice: pick('voice'), subs: pick('subs') };
// V / U: the next of no, en, off; returns the new setting
export function cycleSpeech(k) {
  SPEECH[k] = OPTS[(OPTS.indexOf(SPEECH[k]) + 1) % OPTS.length];
  try { localStorage.setItem(`story.${k}`, SPEECH[k]); } catch {}
  return SPEECH[k];
}
