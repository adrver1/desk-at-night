# Story mode: A day in the life of EIGA

`story.html` is the on-rails presentation. Two runs:

- **Default** (design.md 18b/18c): the prologue, about 1.5 minutes in the
  control room of tomorrow (the supervisor and his business-plan agent on the band,
  Adriaen and his anti-slug agent at his desk, running by itself), "How did
  we get here?", the rewind to one year ago, then presenter-led chapters:
  Trondheim and onboarding, the decision, the tools, the how (knowledge
  graphs, multi-agent work, MCP tools), back to tomorrow, the epilogue.
  Norwegian on screen; voiced lines in English with Norwegian subtitles.
- **`?story=full`**: the three-act version (yesterday, today, tomorrow with
  the clipboard, stars and votes), in English.

`?lang=en` or `?lang=no` switches the on-screen language of either run.

Every spoken line has its text in both languages (`lines.json` `text` and
`no`), and what is heard and what is read are set apart: `?voice=no|en|off`
and `?subs=no|en|off` (or the V and U keys, which cycle them and remember
the choice), both following `?lang` by default. Norwegian takes go in
`public/story/voice/no/` with their own `voice.json`; until a line has one
it is heard in English.

`story.html`  It loads the first-person game
(`src/play.js`) underneath and drives it beat by beat: camera shots, people,
screens, sounds, overlays, subtitles. Free mode (F) hands the game back to
WASD and the mouse, for questions and for debugging.

| Key | |
|---|---|
| Space, →, click | next (finishes the running beat first, then moves on) |
| ← | back |
| 1 to 9 | jump to a chapter |
| F | free mode and back (O in free mode opens a debug panel) |
| P | presenter notes |

URL options: `?chapter=N` (or `#chapter.beat`), `?mode=free`, `?nofs` (no
fullscreen on Begin), `?fps=1`, `?weather=...` (prologue), `?private=1`,
`?sola=0` (skips the Sola apron opening, on by default; see below), `?tags=a|b|c|0` (how the crew's first names and BU show as they board at Sola: lower third, default; tags over heads; roll call; off), `?ceo=1` (Trondheim: the CEO welcomes Adriaen at the Føniks steps and they shake hands; off by default, he walks straight in), `?story=full`, `?lang=en|no`, `?grade=1` (the old colour grades per act, off by default). `?kglook=c|b|deck`: how the knowledge-graph slides of chapter 6 (deck slides 7 to 14) look: `c` drawn live as a light slide with the game's figures (default), `b` the same as a hologram over a low-poly deck, `deck` the PowerPoint pictures.

## Room sound

`ambience.js` is the control room's background life while the room is on
screen (mix B of the Sound Lab, picked by Adriaen 2026-11-01): the
generators' rumble under the aircon (roomControls.js, story level 34%),
sounds that follow the seated idles on their clip clocks (mouse slide and
clicks, a recorded slurp and the cup going down, a chair creak), short
typing bursts in the typing pose every 25 to 60 s, SAS alarms (1 to 4, every
40 to 100 s) that the operator acks with his next mouse idle, and muffled
radio calls every 50 to 120 s, half of them answered (with
`cast.radioReply` when the cast has the radio clip). Each person does one
thing at a time; it all dips to half under a spoken line, and goes quiet
for `sound: 'silence'` beats; no random SAS while the scripted alarm runs.
The coffee pour plays while the jug's stream shows, and every 3 to 6 minutes
someone out of shot yawns (there is no yawn clip yet, so never on screen). `?ambience=0` turns it
off (only the aircon, as before).

The recordings in `public/story/sfx/` are CC0 from freesound.org:
`slurp-5/6/7.mp3` are benkenart's "coffee slurp" 5 to 7 (568043, 568042,
568041) and `pour.mp3` is naxxfish's "kettle pour coffee" (121211), all
mono, trimmed, 96 kb/s; `yawn-1/2.mp3` are owlstorm's "yawn" 1 and 2 (151240,
151239), raised to a -6 dB peak. Originals in the private project files
(`control-room-game/sounds/`).

## Files

- `content.js`: the whole script. Chapters, beats and their steps, the
  clipboard, stars, cards, slides, logs, the knowledge graph. Edit here.
- `story.json`: the default run's on-screen text that the story script
  editor changes: slides, the agents' chats, pointers per beat, notes and
  title cards per beat, beats added or left out, the closing line (see
  `web/scripts/story-editor/README.md`).
- `lines.json`: every spoken line, with who says it and an optional `fx`
  (`radio`, `phone`, `robot` for the AI agents). The subtitles come from here too: `no` holds the
  Norwegian subtitle, `name` the name shown instead of the speaker's role.
- `lang.js`: which run (`FULL`) and language (`LANG`, `T(no, en)`).
- `main.js`: the engine (state per beat, keys, prologue, free mode).
- `cast.js`, `shots.js`, `call.js`: people, the camera, the video and phone
  window. `epilogue.js`: the fly-out to the whole platform. `clockFace.js`:
  the rest corner's station clock, big over the picture during the rewind.
- `kg/`: the knowledge-graph slides drawn live (`engine.js` the slide, `graph.js` the graphs, `slides.js` the eight slides click by click). Screenshots of every click: `node qa/kg-slides.mjs http://localhost:5173/ <out dir> [c|b]`.
- `vscode.js`: the one VS Code window used across the story, in VS Code's Dark Modern look (Adriaen's pick). `vscodeWindow()` for a slide card (split editor groups, parts that come in click by click via `from` + `vscodeStep()`, scaled from 1440×810 by `fitVSCode()`), `vscode()` for a live element with `typeLine()`, `addChat()`, `setTab()` and `draw()` onto a canvas, and `drawVSCode()` for an in-room monitor (same look, same call as before). Styles: `.vsw` in `story.css`.
- `ui.js`, `story.css`: overlays. `storyScreens.js`, `graph.js`: what the
  room's monitors and the display band show in story mode.
- `sola.js`: the opening on the apron at Sola (on by default).
- `trondheim.js`: one year ago, Torvet in Trondheim as a dream (chapter 3,
  `place: 'trondheim'`), on its own canvas. Models in
  `public/story/trondheim/`: `torvet.glb` (the dream variant of
  `blender/trondheim_surroundings.py`, without Føniks) and `foniks.glb`
  (`blender/preview_trondheim.py --glb`), both in the square's frame. They are
  exported by the two Trondheim threads; re-export there, don't edit here.

A beat's `set` is state (shot, cast, screens, overlay...). States add up
through a chapter, so back and jumping always land in the right state. `do`
is the timed part (lines, waits, sounds, chat messages, the rewind); skipping
a beat jumps to its `end`. A beat with `auto` goes on by itself when its
steps are done (the cold open), and `card` shows a title card on entering.

People move with `move` steps (cast.js): `{ move: 'supervisor', walk: PATHS.doorToDesk0 }`,
`{ move, sit: 0, then: 'typing' }` (turns the chair round, sits, swings back to
the desk), `{ move, stand: 1, toward: [x, z] }`, `{ move, carry: 'jug' }`,
`{ move, pour: 'S0Mug' }`, `{ move, face: [x, z] }`. They queue per person and
run alongside the lines; `{ idle: 'supervisor' }` waits until they are done, and
`to: 'desk0typing'` names the spot (SPOTS) they end at, which the beat's `end`
should say too. `mugs: { S0Mug: [fill, x, z] }` in a state sets how full a desk
mug is and where it stands. `web/qa/story-moves.mjs` steps the moves in fixed
ticks and screenshots them, since swiftshader is too slow to watch them live.

## Voices

Lines are voiced with Kokoro (free, offline) by `web/scripts/voices.py`:

    pip install kokoro-onnx soundfile
    python web/scripts/voices.py --model /path/to/kokoro-model-dir

It only renders lines whose text or voice changed (a hash per line), and
writes `public/story/voice/<id>.mp3` plus `voice.json` (length and a mouth
track for lip movement). `--only a1.sup1 a1.sup2` and `--force` help when
iterating. A line with `"keep": true` is never re-rendered, for a recording
dropped in by hand (for example a paid voice for a main character).

## Music

`public/story/music/flight.mp3` starts with the Sola opening (or the flight,
without it), ducks under spoken lines and plays on until the "press Space"
after the walk-off. It is Wagner's *Ride of the Valkyries*
conducted by Philip Milman (PM Music, https://pmmusic.pro/), from
[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ride_of_the_Valkyries.ogg)
under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0), the whole
2:20, re-encoded at 128 kb/s. The licence asks for
credit, which the flight shows among its credits (`CREDITS` in content.js);
keep that line if the music stays.

Only a recording that is free to use belongs there. Wagner's music is in
the public domain, but most recordings are not; recordings by US military
bands (public domain as US government works), CC0 ones, and CC BY ones
with their credit shown are.

## The private build

The repo and GitHub Pages are public, so they name no real people, company,
platform or field: the story says made-up stand-ins (Ola, Per, Knut, Arne,
Lars, Geir and Jonas; the operator Nordhav Energi and its platform Nordhav
Alfa, plate "NORDHAV ALFA / 25/1-A"; the field Nordfeltet; a wave logo).
The real names, statuses, slides and pictures go in `public/story/private/`
(git-ignored; master copy in the private project files) and show with
`?private=1` (`src/privateNames.js`):

- `overrides.json`:
  - `names`: `{ "Ola": "<real name>", ... }`, whole words, applied to every line, chat, slide, card, credit and note, and to the flags' company name
  - `crew`: `{ cast model: [first name, department] }` for the Sola captions
  - `logo`: `[[colour, [[u, v], ...]], ...]`, the company logo on the flags
  - `boards`, `signs`, `chars`: which desk photo boards (`control/`), platform name boards (`signs/`, by the public texture's name) and PPE looks (`chars/`) to load from this folder instead
  - `lines`, `cards`, `slides`, `chats`, `chatText`, `beats`: wording over the public one, as before
- `voice/`: the lines that say a real name, voiced with it (`scripts/voices.py --private`)
- `slides/<slide id>.png`: a slide image instead of the placeholder (ids `a2-01` to `a2-08` in `content.js`)
- `tools/<id>.png`: real screenshots for the Act 2 tools (`stepTest`, `riser`, `antiSlug`, `scd`)

Never commit a real name: add it to `names` and write the stand-in in the
repo. The story editor's sync (`scripts/story-editor/sync.py`) does that on
the way in.

## Open items for Adriaen

Search for `TODO(Adriaen)`: credit wording, slides, talking points,
tool screenshots, the phone poll URL (`VOTE_URL`) and honest statuses for the
three stars cards.
