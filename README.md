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

## Control room blockout

```bash
.venv/bin/python blender/control_room.py               # stills in blender/build/control_room/
.venv/bin/python blender/control_room.py --samples 8   # quick draft
```

A second, separate scene: a control room with two curved operator desks on
a shared semicircle, six monitors on each, a band of large displays on
posts a step behind them, a door with an exit sign and two teleconference
camera bars. `control_room.py` renders Cycles preview stills.

```bash
.venv/bin/python blender/bake_control_room.py          # 2048² atlas, 128 samples, ~15 min on CPU
```

bakes it for the browser: one light map for the ceiling panels, one for the
screens and one for daylight from a plain white sky. The chairs and mugs are baked with the room and then split back
out, so they can move. Two pages use the result: `control.html`, a lighting
viewer, and `play.html`, a first-person walk-around (WASD and mouse; sit in a
chair and spin it, drink the coffee, set lights, sound and temperature on the
desk touch panels, or switch the lights by the door).

### Sky, sea and weather

Outside the window, `web/src/outdoor.js` draws the sky and the sea live: the
sun and a full moon placed for the time of day at 59° N, stars, a cloud layer,
waves that grow with the wind, whitecaps, fog and rain. Both pages have
sliders for time of day, clouds, wind, fog and rain, plus weather presets
(`control.html` under the view, `play.html` on the desk touch panels). The URL
sets them too: `control.html?cam=4&time=17.2&weather=storm`.

The same numbers light the room. The sky's average colour tints the baked
sky light map, so daylight on the desks follows the window. The sun and the
moon are added live with shadows (`web/src/sunShadow.js`): two small depth
maps, one over the room for the patch of sun through the window, one over the
platform, drawn again only when the sun moves (the room's a few times a
second, for chairs that turn). Inside, a ray to the sun must also pass
through the window opening. The weather screen on the wall follows the same
weather and clock.

The helideck and flare-boom cameras on the wall are live too
(`web/src/cctv.js`): the platform as each camera sees it, drawn a few times a
second into a small texture under the same sky, sea, sun, moon and fog, with
rain, noise and the caption drawn over it. The model comes from

```bash
.venv/bin/python blender/cctv_platform.py   # web/public/control/cctv.glb + cctv.json, seconds, no bake
```

which cuts the platform down to what the three cameras see (~2.3k triangles),
parks the helicopter on the helideck and holds the cameras' positions. Add
`?heli=running` to the page URL to see its rotors turning. Where the GPU can't render to a float texture the
screens draw their old 2D camera instead.

## Offshore platform

```bash
.venv/bin/python blender/offshore_platform.py              # stills in blender/build/platform/
.venv/bin/python blender/offshore_platform.py --samples 16 # quick draft
.venv/bin/python blender/offshore_platform.py --jackup     # with a jack-up rig over the wellbay
```

A medium-detail model of Ivar Aasen, a North Sea production platform,
checked against photos: a sturdy four-leg jacket with its conductors, an
open-framed process block, a laydown deck over the wellbay, a pedestal crane,
the plant module and the living quarters with the lifeboats on the end face,
the helideck on a deep truss, a steep flare boom and the yellow name boards.
Heights follow the photos (deck underside 22 m, quarters roof 53 m, flare
tip about 115 m). It has one mesh per material, and emissive deck lights
and windows for night. Three small tileable textures drawn by
`platform_textures.py` (pipes and walkways inside the open modules,
walkways, stairs and doors on the clad walls and the quarters) make it look
as busy as the photos; they are box-mapped in world metres, and
`materials(textured=False)` gives the flat colours the room's bake uses. `build_platform()` builds it
into any scene: cut at the waterline for a view from the control room, or
down to the seabed for a scale model on a table. The control room uses it as
the view out of its window: the room sits on the top floor of the quarters,
turned so its window is in the crane-side facade, looking out to sea
(`PLATFORM_OFFSET` and `PLATFORM_YAW` in `control_room.py`), and
`cull_to_view()` keeps only the faces that window can see.

## Helicopter

```bash
.venv/bin/python blender/helicopter.py              # stills in blender/build/helicopter/
.venv/bin/python blender/helicopter.py --glb        # also helicopter.glb, the default livery alone
```

A low-poly twin-engine offshore helicopter in the AW189's proportions
(17.6 m long, 14.6 m five-blade rotor), about 1,600 triangles and no
textures. The fuselage is lofted from cross sections, so a livery's paint
bands follow its shape; `LIVERIES` keeps every paint scheme and `LIVERY`
picks the one the scene uses. `build_helicopter()` returns its moving parts
with their pivots: both rotors, the three gear legs (they swing forward into
the nose and the sponsons) and a blur disc per rotor. In the browser,
`web/src/helicopter.js` spools the rotors up and down, fading the blades into
the discs at speed, and retracts the gear.

## Supply vessel

```bash
.venv/bin/python blender/supply_vessel.py           # stills in blender/build/supply_vessel/
.venv/bin/python blender/supply_vessel.py --web     # web/public/control/vessel.glb + vessel.json
```

A medium-detail platform supply vessel, about 3,000 triangles and no
textures: hull lofted through five lines (keel, bilge, waterline, fender
belt, deck edge), superstructure with lit cabin windows and a glass bridge,
a mast with two turning radars, crash rails and deck cargo. `DESIGNS` keeps
three hulls (`modern` 88 m with a conventional bow, the default; `xbow`, an
inverted bow; `classic`, an older 70 m vessel) and `LIVERIES` three paint
schemes; `DESIGN` and `LIVERY` pick the scene's. It berths on the crane side
under the big crane (`BERTH_LOC`). In the browser, `web/src/vessel.js` sails
it in once a game day (approach from 06:45, alongside 07:00 to 10:00), crabs
it onto the berth, holds it there with small dynamic-positioning drifts and
the swell, and swings the crane's boom out over its deck on the CCTV. The
outdoor panel has a button to call it in (or send it away); the URL takes
`?vessel=call`, `?vessel=alongside` or `?vessel=off`. The crane camera
(`craneCam` in `cctv_platform.py`) shows its deck on the TV beside the band.

## Run the viewer

```bash
cd web
npm run dev        # http://localhost:5173, hot reload
npm run build      # static site in web/dist, host anywhere
```

Every push to `main` publishes `web/dist` to GitHub Pages
(`.github/workflows/pages.yml`). Turn it on once under Settings → Pages →
Source: GitHub Actions. The site then lives at
https://adrver1.github.io/desk-at-night/.

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

   Switching the lamp is just animating `w_lamp`.

4. Things that move can't be baked, so the Newton's cradle on the desk mixes
   in cheap live tricks. Its frame is baked like everything else; its balls
   are left out of the bake and

   - mirror two small panoramas Cycles renders from the middle of the toy
     (moon only and lamp only, mixed with the same weights), plus a live
     highlight for the bulb;
   - cast live shadows: each light renders a depth map of the balls alone,
     and the room shader scales that light's `E` term down where a ball
     blocks it;
   - swing with a small pendulum simulation (`web/src/cradle.js`). Drag a
     ball, or press "Swing the cradle".

   What this misses is light bouncing off the balls onto the room, which is
   too faint to notice here.

Light maps are stored as `(L / scale)^(1/3)` in 8-bit PNGs, which puts more
precision in the shadows than a linear encoding. The scales are in
`meta.json`.

## Where to go next

- Add an object to `build_room()`, give it a `texel_weight`, rebuild.
- Add a third light group (a TV, a monitor) as its own bake and weight.
- Compress for production: `npx @gltf-transform/cli optimize` for the GLB
  and KTX2 for the textures.
