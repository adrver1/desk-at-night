// The private build's real names (?private=1). The public repo and GitHub
// Pages carry made-up stand-ins only (Ola, Per, Nordhav Energi, Nordhav Alfa,
// Nordfeltet...); the git-ignored story/private/overrides.json maps them back:
//
//   names  { "Ola": "Adriaen", "Nordhav Energi": "<company>", ... }   whole words, case kept as written
//   crew   { cast model: [first name, department] }                     the Sola captions
//   logo   [[colour, [[u, v], ...]], ...]                               the company logo (flags.js)
//
// Loaded with a top-level await, so every module that imports this sees the
// map before its own code runs; without ?private=1 nothing is fetched and
// real() hands strings back unchanged.

export const PRIVATE = new URLSearchParams(location.search).get('private') === '1';
export const PRIVATE_BASE = 'story/private/';

export const OVERRIDES = PRIVATE
  ? await fetch(`${PRIVATE_BASE}overrides.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
  : {};

const NAMES = Object.entries(OVERRIDES.names ?? {}).sort((a, b) => b[0].length - a[0].length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const RE = NAMES.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${NAMES.map(([k]) => esc(k)).join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
const MAP = Object.fromEntries(NAMES);

// A string with the stand-ins swapped for the real names
export const real = (s) => (RE && typeof s === 'string' ? s.replace(RE, (m) => MAP[m]) : s);

// The same over every string in an object or array, in place
export function realDeep(o, seen = new WeakSet()) {
  if (!RE || !o || typeof o !== 'object' || seen.has(o)) return o;
  seen.add(o);
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string') o[k] = real(v);
    else if (v && typeof v === 'object') realDeep(v, seen);
  }
  return o;
}

// Swap the textures overrides.json `signs` names ({ public image name: file in
// story/private/signs/ }) on a loaded model: the platform's name boards
export function privateSigns(root) {
  const signs = OVERRIDES.signs;
  if (!signs) return;
  root.traverse((o) => {
    for (const mat of [].concat(o.material ?? [])) {
      const t = mat.map, file = t && signs[t.name];
      if (!file) continue;
      const img = new Image();
      img.onload = () => { t.image = img; t.needsUpdate = true; };
      img.src = `${PRIVATE_BASE}signs/${file}`;
    }
  });
}
