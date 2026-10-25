// Slim a lean scene .glb for the web: merge duplicate accessors and textures, then
// quantize the vertex data (16-bit positions: flat parts laid 1 cm off a wall stay
// clear of it; KHR_mesh_quantization, which three's GLTFLoader reads
// as is, no decoder needed).
//
//   node web/scripts/slim_glb.mjs <in.glb> <out.glb>
//
// blender/preview_trondheim.py runs it on the Føniks export when node is there.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node slim_glb.mjs <in.glb> <out.glb>');
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(dedup(), prune(), quantize({ quantizePosition: 16, quantizeNormal: 8, quantizeTexcoord: 12, quantizeColor: 8 }));
await io.write(out, doc);
