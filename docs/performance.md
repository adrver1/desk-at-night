# Finding what makes a page slow

Three tools, from quickest to deepest:

1. **The performance panel** in the game itself. Works on any device,
   including the iPhone, with nothing to install.
2. **A Chrome Performance recording**, with our named markers around every
   render pass and update step. Shows the whole frame on a timeline.
3. **Perfetto** (ui.perfetto.dev), to open that recording in the same tool
   JUCE's melatonin_perfetto uses, and query it.

All of it lives in `web/src/perf.js`.

## 1. The performance panel

Every game page (`play.html`, `control.html`, `intro.html`, `story.html`,
the Sola opening in story mode, and the prototypes) shows a small frame rate
readout at the top: `60 fps · 18 ms`, the frame rate and the worst frame of
the last half second. It's green from 50 fps, yellow from 30, red below.

**Open the full panel:** tap the readout, press <kbd>`</kbd> (left of 1), or
open the page with `?perf=1`, for example
`play.html?perf=1`. Tap the panel's first line to fold it back to the
readout. <kbd>`</kbd> steps readout → panel → hidden; "Hide" leaves a faint
`fps` tab to tap. The page remembers your choice; `?fps=0` and `?fps=1`
override it.

**Reading it, top to bottom:**

| Line | What it means |
|---|---|
| `60 fps 16.7 ms worst 24 112 draws gpu 9.1` | Frame rate, average and worst frame time, draw calls per frame, GPU time per frame |
| `gpu · update · draw` | GPU time; the page's own JavaScript (moving things, the story, CCTV scheduling); three.js turning the scene into draw calls (CPU) |
| `tris · geo · tex · progs · heap` | Triangles per frame; geometries, textures and shader programs on the GPU; JavaScript memory (Chrome only) |
| grey line | Canvas size and pixel ratio, the GPU, and how GPU time is measured |
| `sea look` | Which sea the page is drawing (C cinematic, B reflections) and whether it steps down by itself |
| **pass table** | One row per render pass, the most expensive first. `×` is how many times per frame it runs (0.50 = every other frame), then draws, triangles, CPU ms and GPU ms per frame. The blue bar is its share of the frame |
| **update step table** | The page's update steps (player, sky + sea, vessel, seabirds, screens, cctv, story…), CPU ms per frame. A step that draws (cctv) includes its passes |

Pass names are `target: scene`. No target means the screen.

| Pass | What it is |
|---|---|
| `room` / `platform` | The main view (control room, or the platform in the intro) |
| `half-res: sky + sea` | Sky and sea, drawn at half resolution |
| `sea upscale` | That half-res picture stretched onto the screen |
| `mirror: room` | The scene upside down, for the sea's reflection |
| `sun shadow room: …` | The sun's shadow map through the window |
| `cctv: sky + sea`, `cctv: platform`, `cctv feed: copy` | One CCTV picture, spread over two frames |
| `characters`, `epilogue`, `sola heliport` | Story mode's own passes |
| `call · video call` | The video call window (its own renderer) |

**GPU time.** Desktop Chrome and Firefox have a GPU timer
(`EXT_disjoint_timer_query_webgl2`); the grey line then says "GPU timer".
Safari, and so the iPhone, does not: the GPU column shows `–`. Tap
**Sync GPU** (or open with `?perf=sync`) to make the page wait for the GPU
after every pass. The page gets slower, so read those numbers as shares of
the frame, not as the real frame time.

**Scan objects** (or <kbd>Shift</kbd>+<kbd>`</kbd>) times every single draw
for 30 frames (8 with Sync GPU) and lists:

- the ten most expensive objects, with how many passes draw them, their
  triangles and milliseconds per frame (`(shadow)` marks the shadow map copy)
- an estimate of GPU memory for textures and render targets
- **could save**: likely wins, such as one object taking a big share,
  meshes over 100k triangles in one draw, objects drawn in three or more
  passes, eight or more small meshes sharing a material (merge or instance
  them), textures over 2048 px, many shader programs or transparent draws.
  These are hints to look at, not certainties.

**Copy report** puts everything (device, all numbers, the scan) on the
clipboard as text, to paste into a chat with Claude. If the browser won't
allow the clipboard, the report shows in a text box to select by hand.

**Typical session on the iPhone:** open
`https://adrver1.github.io/desk-at-night/play.html?perf=1`, walk to where it
feels slow, look at which pass has the biggest bar, tap Sync GPU if you want
GPU shares, tap Scan objects, then Copy report and paste it.

## 2. Recording a trace in Chrome

The panel averages over half a second. A trace shows every single frame,
which is how you catch hitches (a texture upload, shader compile, garbage
collection).

1. Open the page in desktop Chrome with `?trace=1`, for example
   `http://localhost:5173/play.html?trace=1` (or open the full panel, which
   also turns the markers on). `?trace=1` keeps the panel folded, so the page
   runs as normal.
2. Open DevTools (<kbd>F12</kbd>, or <kbd>⌥⌘I</kbd> on a Mac) and go to the
   **Performance** tab.
3. Optional: in its settings (the gear) set CPU throttling to 4× or 6× to
   act like a phone, and tick "Enable advanced paint instrumentation" only
   if you need it (it slows things down).
4. Click **Record** (●), play for 3 to 5 seconds around the slow moment,
   click **Stop**.
5. Read it:
   - The **Frames** track shows each frame; red ones were dropped. Click one.
   - The **Timings** track holds our markers: `frame` (one animation frame),
     `step cctv`, `step sky + sea`… and `render room`, `render mirror: room`,
     `render half-res: sky + sea`… Their width is CPU time.
   - The **Main** track underneath shows the JavaScript inside each one;
     **Bottom-Up** at the bottom lists the functions that took longest.
   - The **GPU** track shows when the GPU was busy. A long GPU block with a
     short `frame` marker means the GPU is the limit, not JavaScript.
6. **Save** it with the download arrow (↓) at the top of the panel. You get
   a `.json` or `.json.gz` file.

## 3. Opening the trace in Perfetto

1. Go to **ui.perfetto.dev** and choose **Open trace file**, then pick the
   file you saved. Nothing is uploaded; it runs in the browser.
2. Expand the Chrome **Renderer** process. Our markers are slices named
   `frame`, `step …` and `render …` (category `blink.user_timing`), on
   tracks of their own next to the main thread (`CrRendererMain`), nested
   the way they ran, like the blocks in a JUCE trace.
3. Use <kbd>W</kbd>/<kbd>S</kbd> to zoom and <kbd>A</kbd>/<kbd>D</kbd> to
   pan; click a slice for its duration, drag over a range for a summary.
4. For numbers over the whole recording, open **Query (SQL)** and run:

   ```sql
   select name, count(*) as n, round(avg(dur) / 1e6, 2) as avg_ms,
          round(max(dur) / 1e6, 2) as max_ms
   from slice
   where name like 'render %' or name like 'step %' or name = 'frame'
   group by name order by avg_ms desc;
   ```

   That lists every pass and step with its average and worst time.

Perfetto can also record Chrome directly (Record new trace → Chrome, with
its browser extension), but saving from DevTools is simpler and holds the
same markers.

## 4. Profiling the iPhone itself

The panel is the easy way. For a full profile you need a Mac and a cable:

1. On the iPhone: **Settings → Apps → Safari → Advanced → Web Inspector** on.
2. On the Mac: Safari **Settings → Advanced → Show features for web
   developers** on.
3. Connect the iPhone by cable, open the page in Safari on the iPhone
   (with `?trace=1` or `?perf=1`).
4. On the Mac, Safari's **Develop** menu → your iPhone → the page.
5. In Web Inspector's **Timelines** tab, turn on JavaScript & Events and
   Rendering Frames, press record, play, stop. Frames over budget show as tall
   bars; select one to see what ran.

Safari's Timelines show frames and JavaScript, but as far as I know they
don't list our `frame`/`step`/`render` markers by name. For per-pass numbers
on the phone, use the panel's **Copy report**.

## Switches for before/after checks

The room pages (`play.html`, `control.html`, `story.html`) take these, to
see what one thing costs on your own GPU. Compare the `gpu` line and the
pass table with and without:

| Option | What it turns back on |
|---|---|
| `?seaclip=0` | Sky, sea and mirror drawn over the whole screen. Normally, seen from inside, they are drawn only in the window's box on screen, and not at all while the window is out of view |
| `?aniso=old` | 16× anisotropic filtering on every baked map. Normally the light maps have none (they are smooth) and the albedo and whiteboards 4× |
| `?aa=msaa` / `?aa=0` | Edges are smoothed by an FXAA pass over the finished frame (2026-10-31; pass `fxaa`). `?aa=msaa` is the old multisampling, which took half the GPU time on the Intel Arc laptop (14.5 against 7.7 ms a frame); `?aa=0` turns both off. `play.html` and `story.html` only |
| `?cull=0` | Draws what is out of sight again (2026-10-30): the room's sun shadow map while the sun can't get in through the window (all of story mode's day), the supply vessel and the sea's depth-only surface while the walls hide them, camera pictures for screens out of view, and the sea's surface in the rest corner clock's close-up |
| `?closeup=0` | Story mode without the sharp close-up canvases (2026-10-31): a room screen that fills at least 12% of the picture normally gets its content drawn in a page canvas laid over it, so it is sharp without a WebGL upload |
| `?sharp=1` | Screens drawn at the size they show at (2026-10-31): each screen in view gets a texture as wide as it covers on the canvas (up to 4× its slot, 2048 texels), so close-ups are sharp, and live screens out of view wait. Off by default: on the Intel Arc laptop the big canvas uploads took story mode's GPU time from 16 to 134 ms a frame (`story.html?bench=quick&sharp=1` against `&sharp=0`) |

For example `story.html?perf=1&seaclip=0&aniso=old` is the page as it was
before 2026-10-26.

## The story benchmark

`story.html?bench=1` plays eight of the story's heaviest beats under each
pixel ratio the screen allows (2, 1.5, 1.25, 1, 0.75) with multisampling,
reloads with FXAA and with neither and plays them again: about 4.5 s per
beat and setting, some 9 minutes in all (`?bench=quick`: three beats, two ratios, under two minutes).
`?bench=closeup` plays six close-up beats at the page's own pixel ratio
with the sharp close-up canvases (`web/src/story/closeups.js`) and without
(`?closeup=0`), about a minute. All modes show the longest frame per beat,
to show hitches, and the top GPU passes of the slowest beats.
It then shows a table of frame rate and GPU time per setting and per beat,
with a Copy button, to paste into a chat. GPU time needs a GPU timer
(desktop Chrome, Edge, Firefox); on the iPhone only the frame rate means
anything. Frame rates stop at the screen's refresh rate, so compare GPU
times. Code: `web/src/story/bench.js`.

## Other tools

- **Spector.js** (Chrome/Firefox extension): captures one frame and lists
  every draw call with its shader, textures and state. Good for "why is this
  object drawn three times".
- **`web/qa/perf-shots.mjs`**: screenshots the panel on each page and saves
  the copied report, for before/after comparisons. Headless Chrome draws in
  software, so its milliseconds mean nothing; compare draw calls and
  triangles.

- **`web/qa/story-draws.mjs`**: walks every beat of story mode and writes,
  per beat, each pass's draw calls and triangles, plus an ID render of the
  room and characters: every object gets a flat colour, drawn from the story
  camera, and the ones in the camera's view that put no pixel on screen are
  listed (`drawnNotSeen`, `wasted`). Run it on two servers to compare
  before and after: `node qa/story-draws.mjs out.json [chapters] [s per beat] [url]`.

## Adding to it

- A new render pass names itself: give its scene a `name`, and its render
  target `target.texture.name`.
- Wrap a new update step in `perfStep('name', () => …)`.
- A page specific line: `perfRow('label', () => value)`.
- A new renderer: `perfWatch(renderer, 'name')`.
