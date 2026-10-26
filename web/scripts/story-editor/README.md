# Story script editor

A private claude.ai page where Adriaen edits the default story run like a
PowerPoint: one beat on screen (a still of its camera shot with the slide,
subtitle and pointers drawn over it), its text beside it, and a timeline of the
whole run at the bottom with tracks for chapters, beats, slides and cards,
camera, spoken lines, chat, people and pointers. He can edit slides, spoken
lines and subtitles, chat messages, title cards, presenter notes and pointers,
add slides, cards and lines, leave beats out, and leave notes to Claude for
anything the fields can't do (camera, people, timing).

`editor.html` is the page's source. It keeps its data in the page's database
(the `db` capability) and slide pictures in its asset store (`assets`):

- `beats/<beat id>`: one document per beat, as `seed.py` writes it, with the
  editor's changes on top (`isNew`, `hidden`, `after`, `updatedAt`).
- `notes/<id>`: `{ beat, beatId, target, text, status: open | done, reply }`.

## The game side

`src/story/story.json` holds the on-screen text the editor changes: the default
run's slides, the agents' chats, pointers per beat (`callouts`, x and y in
percent of the picture), per-beat overrides (`notes`, `card`, `cards` for the
title cards its steps show, `say` for lines added in the editor),
beats added in the editor (`inserted`), beats left out (`hidden`) and the
closing line. `content.js` reads it (`applyStory`). Spoken lines stay in
`src/story/lines.json`.

## Seeding (game to editor)

    npx vite --port 5173 &
    node scripts/story-editor/dump.mjs /tmp/dump.json
    HIDE_UI=1 node qa/story-tour.mjs /tmp/stills 2,3,4,5,6,7,8 2
    python scripts/story-editor/seed.py /tmp/dump.json /tmp/stills /tmp/seed

then write `/tmp/seed/writes.json` to the page's database as one ArtifactData
batch (pin each write to the document's current version), and publish
`editor.html` with the stills from `/tmp/seed/stills/` as `stills/*.jpg`.
Seeding replaces the editor's beats: sync first.

## Sync (editor to game)

When Adriaen says "sync": save the database with ArtifactData `list` and
`out_dir` (collections `beats` and `notes`), then

    python scripts/story-editor/sync.py <that dir>

It updates `story.json` and `lines.json` and prints what still needs a hand:
lines to voice with `scripts/voices.py`, slide pictures to download into
`public/story/slides/<id>.webp`, and the open notes. Do the notes, answer each one in the database (`status: done`,
`reply`), check the run with `qa/story-tour.mjs`, open a PR, and re-seed so
the editor shows what the game now does.

## PowerPoint clicks (builds)

A slide with `builds: N` in story.json has N clicks: the presenter's Space shows
the next click before moving to the next beat, and ← steps back. The pictures,
one per click, are `<slide id>.b00.webp` (before the first click) to
`.b<N>.webp` in `public/story/slides/` (Adriaen's CtrlBuddy deck is cleared
for publication; with `?private=1` a PNG of the same name in the git-ignored
`public/story/private/slides/` wins). Make them from the deck with
`pptx_anim_parse.py` and `pptx_anim_build.py` (PNGs), then convert to WebP at
most 1920 wide. In the editor a slide's `frames` lists the same pictures, and
sync writes `builds` from it.

## Chat beats

Deck slides where Adriaen talks to his agent play as chats in the room
instead: a beat in story.json `inserted` with `chat: <id>` shows that chat
(story.json `chats`) on Desk0Mon1 and its reports on Desk0Mon2. The beat
opens on the first message and each Space shows one more (no voice); ← steps
back. A `show` message hands over a report: the chat shows it as an
attachment and the camera turns to the next monitor, which shows its `file`
from `public/story/reports/` (a picture, or a muted looping video). `faces`
names the portraits beside the messages (`public/story/faces/<id>.png`,
rendered from the character models with `qa/portraits.mjs`). In the editor a
chat beat's doc carries `chat`, and its messages are chat items.
