// Bake the cloth loops for the flags' option C (flags.js) into
// src/flag-cloth/<kind>.bin. Run after changing KINDS, BAKE or the simulation:
//   node scripts/bake_flags.mjs
import { writeFileSync } from 'node:fs';
import { KINDS, bakeClothData, encodeCloth } from '../src/flags.js';

for (const kind of Object.keys(KINDS)) {
  const s = performance.now();
  const buf = encodeCloth(bakeClothData(kind));
  writeFileSync(new URL(`../src/flag-cloth/${kind}.bin`, import.meta.url), new Uint8Array(buf));
  console.log(`${kind}: ${(performance.now() - s).toFixed(0)} ms, ${(buf.byteLength / 1024).toFixed(0)} KB`);
}
