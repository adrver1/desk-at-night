# Desk at Night

A minimal version of the pipeline behind felixrieseberg.com: a room built
entirely in Python through Blender's API, lighting path-traced offline in
Cycles and baked into textures, and a Three.js page that mixes those
textures live.

```
blender/build.py   scene → bake → denoise → export     (Python, runs headless)
web/public/scene/  generated assets: scene.glb + 3 PNG atlases + meta.json
web/src/           Vite + Three.js viewer, shaders.js holds the lighting model
web/qa/            Playwright screenshots + pixel diff against Cycles
```

## Setup

```bash
# Blender as a Python module (the bpy wheel is tied to one Python version;
# bpy 5.2 works with Python 3.13)
python3 -m venv .venv
.venv/bin/pip install bpy pillow

# Web
cd web && npm install
```

## Build the scene

```bash
.venv/bin/python blender/build.py                         # 1024² atlas, 256 samples
.venv/bin/python blender/build.py --res 512 --samples 16  # fast draft, ~20 s
.venv/bin/python blender/build.py --reference             # also render a Cycles still for QA
```

`build.py` is the single source of truth: it starts from an empty Blender
file every time. It also saves `blender/build/scene.blend`, which you can open
in Blender to inspect the result, but never edit by hand.

The build picks the fastest device on its own: OptiX on an NVIDIA RTX card,
then CUDA, Metal or HIP, and the CPU as a last resort. The first log line says
which it chose. Force one with `--device cpu|optix|cuda|metal|hip`. On an RTX
GPU, a full 1024² bake takes seconds instead of minutes, so you can afford
`--res 2048 --samples 512`.

## Run the viewer

```bash
cd web
npm run dev        # http://localhost:5173, hot reload
npm run build      # static site in web/dist, host anywhere
```

## QA

```bash
cd web
npm run build && npx vite preview --port 4173 &
npm run qa         # screenshots in qa/shots/, error check, pixel diff
```

## How the lighting works

1. Every static surface gets one non-overlapping UV layout (an atlas). Each
   object's share of the atlas is weighted by how much the camera sees it,
   so the desk gets far more pixels than the ceiling (`texel_weight`).
2. Cycles bakes three maps into that atlas: surface colour without light,
   irradiance from the moon and sky alone, and irradiance from the lamp
   alone. OpenImageDenoise removes the sampling grain.
3. Light transport is linear, so the browser reconstructs any mix:

   ```
   pixel = albedo × (w_moon · E_moon + w_lamp · E_lamp)
   ```

   Switching the lamp is just animating `w_lamp`. Objects that move would
   need live lighting instead (the bulb here is the only one).

Light maps are stored as `(L / scale)^(1/3)` in 8-bit PNGs, which puts more
precision in the shadows than a linear encoding. The scales are in
`meta.json`.

## Where to go next

- Add an object to `build_room()`, give it a `texel_weight`, rebuild.
- Add a third light group (a TV, a monitor) as its own bake and weight.
- Compress for production: `npx @gltf-transform/cli optimize` for the GLB
  and KTX2 for the textures.
