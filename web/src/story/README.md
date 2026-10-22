# Story mode: A day in the life of EIGA

`story.html` is the on-rails presentation. It loads the first-person game
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
`?sola=1` (the Sola apron opening, see below).

## Files

- `content.js`: the whole script. Chapters, beats and their steps, the
  clipboard, stars, cards, slides, logs, the knowledge graph. Edit here.
- `lines.json`: every spoken line, with who says it and an optional `fx`
  (`radio`, `phone`). The subtitles come from here too.
- `main.js`: the engine (state per beat, keys, prologue, free mode).
- `cast.js`, `shots.js`, `call.js`: people, the camera, the video and phone
  window. `epilogue.js`: the fly-out to the whole platform.
- `ui.js`, `story.css`: overlays. `storyScreens.js`, `graph.js`: what the
  room's monitors and the display band show in story mode.
- `sola.js`: the optional opening on the apron at Sola.

A beat's `set` is state (shot, cast, screens, overlay...). States add up
through a chapter, so back and jumping always land in the right state. `do`
is the timed part (lines, waits, sounds); skipping a beat jumps to its `end`.

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

The flight plays `public/story/music/flight.mp3` if it is there, ducked
under the pilot's lines and faded out after landing. Only a recording that
is free to use belongs there. Wagner's music is in the public domain, but
most recordings are not; recordings by US military bands (public domain as
US government works) and CC0 ones from Musopen or Wikimedia Commons are.

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
