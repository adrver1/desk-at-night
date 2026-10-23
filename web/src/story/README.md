# Story mode: A day in the life of EIGA

`story.html` is the on-rails presentation. Two runs:

- **Default** (design.md 18b/18c): the prologue, about 1.5 minutes in the
  control room of tomorrow (Brage and his business-plan agent on the band,
  Adriaen and his anti-slug agent at his desk, running by itself), "How did
  we get here?", the rewind to one year ago, then presenter-led chapters:
  Trondheim and onboarding, the decision, the tools, the how (knowledge
  graphs, multi-agent work, MCP tools), back to tomorrow, the epilogue.
  Norwegian on screen; voiced lines in English with Norwegian subtitles.
- **`?story=full`**: the three-act version (yesterday, today, tomorrow with
  the clipboard, stars and votes), in English.

`?lang=en` or `?lang=no` switches the on-screen language of either run.

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
`?sola=1` (the Sola apron opening, see below), `?story=full`, `?lang=en|no`.

## Files

- `content.js`: the whole script. Chapters, beats and their steps, the
  clipboard, stars, cards, slides, logs, the knowledge graph. Edit here.
- `lines.json`: every spoken line, with who says it and an optional `fx`
  (`radio`, `phone`). The subtitles come from here too: `no` holds the
  Norwegian subtitle, `name` the name shown instead of the speaker's role.
- `lang.js`: which run (`FULL`) and language (`LANG`, `T(no, en)`).
- `main.js`: the engine (state per beat, keys, prologue, free mode).
- `cast.js`, `shots.js`, `call.js`: people, the camera, the video and phone
  window. `epilogue.js`: the fly-out to the whole platform.
- `ui.js`, `story.css`: overlays. `storyScreens.js`, `graph.js`: what the
  room's monitors and the display band show in story mode.
- `sola.js`: the optional opening on the apron at Sola.

A beat's `set` is state (shot, cast, screens, overlay...). States add up
through a chapter, so back and jumping always land in the right state. `do`
is the timed part (lines, waits, sounds, chat messages, the rewind); skipping
a beat jumps to its `end`. A beat with `auto` goes on by itself when its
steps are done (the cold open), and `card` shows a title card on entering.

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

The repo is public. Real initiative names, statuses, slides and tool
screenshots go in `public/story/private/` (git-ignored) and show with
`?private=1`:

- `overrides.json`: `{ "lines": { id: text }, "cards": { id: { "initiative", "status" } }, "slides": { id: { "title", "bullets" } } }`
- `slides/<slide id>.png`: a slide image instead of the placeholder (ids `a2-01` to `a2-08` in `content.js`)
- `tools/<id>.png`: real screenshots for the Act 2 tools (`stepTest`, `riser`, `antiSlug`, `scd`)

## Open items for Adriaen

Search for `TODO(Adriaen)`: credit wording, slides, talking points,
tool screenshots, the phone poll URL (`VOTE_URL`) and honest statuses for the
three stars cards.
