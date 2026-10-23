// Slim the character .glbs a page loads together (characters/, built by
// their own bpy scripts): every file carries the same clips on the same rig,
// so the clips go once into anims.glb and each character keeps its mesh,
// skin and palette alone, with quantized vertex data (KHR_mesh_quantization,
// which three's GLTFLoader reads as is).
//
//   node web/scripts/pack_chars.mjs <out dir> <character.glb>...
//
// blender/intro_export.py runs it for web/public/intro/chars/. Pages take
// the clips from anims.glb when a model has none of its own (sola.js,
// intro.js), so the unpacked files still work in their place.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, quantize, dedup, resample } from '@gltf-transform/functions';
import { createHash } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) {
  console.error('usage: node pack_chars.mjs <out dir> <character.glb>...');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// The clips, by target bone and data, so a character with other clips is caught
function clipHash(doc) {
  const h = createHash('sha1');
  for (const a of doc.getRoot().listAnimations()) {
    h.update(a.getName());
    for (const c of a.listChannels()) {
      const s = c.getSampler();
      h.update(`${c.getTargetNode().getName()}.${c.getTargetPath()}`);
      h.update(new Uint8Array(s.getInput().getArray().buffer));
      h.update(new Uint8Array(s.getOutput().getArray().buffer));
    }
  }
  return h.digest('hex');
}

let first = null, firstHash = null;
for (const f of files) {
  const doc = await io.read(f);
  const hash = clipHash(doc);
  if (!first) [first, firstHash] = [f, hash];
  else if (hash !== firstHash) throw new Error(`${basename(f)} has other clips than ${basename(first)}: pack it on its own`);
  for (const a of doc.getRoot().listAnimations()) {
    for (const k of [...a.listChannels(), ...a.listSamplers()]) k.dispose();   // or prune keeps their data
    a.dispose();
  }
  await doc.transform(prune({ keepLeaves: true }), dedup(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12, quantizeWeight: 8 }));
  const to = join(out, basename(f));
  await io.write(to, doc);
  console.log(`${basename(f)}: ${(statSync(f).size / 1024).toFixed(0)} KB -> ${(statSync(to).size / 1024).toFixed(0)} KB`);
}

// anims.glb: the rig's bones and the clips, no mesh
const doc = await io.read(first);
const root = doc.getRoot();
for (const n of root.listNodes()) if (n.getMesh()) { n.setMesh(null); n.setSkin(null); }
for (const k of [...root.listMeshes(), ...root.listSkins(), ...root.listMaterials(), ...root.listTextures()]) k.dispose();
// resample: drop keys the neighbours already give (linear in between, within 1e-4)
await doc.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), dedup());
const to = join(out, 'anims.glb');
await io.write(to, doc);
console.log(`anims.glb: ${root.listAnimations().length} clips, ${(statSync(to).size / 1024).toFixed(0)} KB`);
