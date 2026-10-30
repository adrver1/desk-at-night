# desk-at-night

Blender (bpy) scenes baked in Cycles plus a Vite + Three.js viewer and a first-person control room game. See README.md for build commands (read only the section you need).

## How we work on the game

The project skills in `.claude/skills/` set the order of work, so the result matches what Adriaen intends:

1. **Plan with `grill-design`** before building any new station, scene, feature or bigger change. Ask in rounds with a recommended answer for each question, and write settled decisions down as they happen.
2. **Preview with `prototype`** before full integration or a long bake. Show 2 to 3 structurally different options as stills or screenshots and wait for a pick.
3. **Build** the chosen option, then look at the changed view with a Playwright screenshot (see Fast checks) before opening a PR.
4. **Debug with `diagnosing-bugs`** when something breaks or looks wrong: build a reproducible check first, then hypotheses, then the fix.

Use `to-questionnaire` when an answer has to come from someone else, such as operators or the platform team.

## Rules

- This repo is public. Reference photos, the real platform's name, people or numbers stay in the private project files (`/mnt/project-files/control-room-game/`), never in commits or on GitHub Pages.
- Game design decisions live in `/mnt/project-files/control-room-game/design.md`, a short index pointing to one file per topic in `design/`. Read the index, then only the topic file you need; add new decisions to that file. Shared vocabulary goes in `GLOSSARY.md` and hard-to-reverse technical decisions in `docs/adr/`; create them when the first entry is needed.
- `blender/*.py` scripts are the source of truth; never hand-edit generated `.blend` files or baked assets.

## Code map

Every source file starts with a comment saying what it does, so `head -5` a file before reading it whole. Several files are 40 to 90 KB: grep for the function and read a line range.

- `web/*.html`: one page each. `story.html` (story mode, the main presentation), `play.html` (free mode), `control.html` (lighting viewer), `intro.html` (helicopter fly-in), `screens.html` (flat screen previews), `index.html` (old desk scene). `*-prototype.html` pages are throwaway option previews.
- `web/src/story/`: story mode. `content.js` is the script (chapters, beats, lines), `main.js` runs it, `shots.js` cameras, `cast.js` characters, `ui.js` overlays, `storyScreens.js` screen content, `lang.js` URL options.
- `web/src/`: the room and world shared by all pages. `controlScene.js` loads the baked room, `shaders.js` the light-map shading, `screens.js` monitor content, `outdoor.js` sky and sea, `perf.js` the fps panel. Props with live parts have their own file (`curtains.js`, `valve.js`, `separator*.js`, `helicopter.js`, `vessel.js`, `gulls.js`, `flags.js`, `coilCord.js`).
- `blender/`: generators and bakes. `build.py` (desk scene), `control_room.py` + `bake_control_room.py` (room), `props.py` (desk and room props, all variants kept), `offshore_platform.py`, `helicopter.py`, `supply_vessel.py`, `trondheim_*.py` and `preview_trondheim.py` (Torvet scene), `preview_*.py` quick stills.
- `characters/`: low-poly cast. `_shared/` is the kit (body, hair, faces, outfits, anims); one folder per character holds its build script and exported GLBs.
- `web/public/`: generated assets (GLB, light maps, voice mp3s, slides). Never read or grep these; regenerate them from the scripts.
- `web/qa/`: screenshot and QA scripts. `web/scripts/`: asset tools (GLB slimming, voices, story editor sync).

## Fast checks

- `npm ci` in `web/` takes about 5 s and `npx vite build` about 3 s.
- Screenshot one page in about 20 s: start `npx vite --port 5173` in the background, then from `web/` run `node qa/story-shot.mjs "http://localhost:5173/story.html?chapter=2&nofs" out.png "__story.start()" "window.__game?.room" 3000`. The arguments after the output path are JS to run in the page, a wait condition and a delay in ms. `?beat=<id>` jumps to one beat; other pages work the same way without the start call.
- `npm run qa` only checks the old desk scene (`index.html`) against its Cycles reference. Run it when the desk scene or `shaders.js` changes, not for every change.
- Blender: `pip install bpy` fails on the proxy unless run as `NO_PROXY=localhost no_proxy=localhost .venv/bin/pip install bpy pillow`. Cycles denoising needs `libegl1`. Skip Cycles renders during design rounds; a GLB export and a viewer screenshot is enough until Adriaen asks for a proper render.
