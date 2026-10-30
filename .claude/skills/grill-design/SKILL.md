---
name: grill-design
description: Interview Adriaen in rounds to sharpen a game or feature plan before building it, and write the settled decisions down. Use when a new station, scene, feature or bigger change is being planned, or on any "grill me" request.
---

# Grill the design

Interview the user relentlessly until you reach a shared understanding of what to build and why. Do this **before** writing code or baking anything for a new station, scene, feature or bigger change. A bake takes minutes and a wrong guess about intent costs a whole round of previews.

Map the plan as a **design tree**: every decision branches into the decisions that hang off it.

## Rounds

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the answers before the next round.

```
❓ **Q1** - **<question title>**: <question body, with the options when there are several>

➡️ <your recommended answer>

---

❓ **Q2** - ...
```

Word each question so "yes" accepts your recommended answer. Keep a round to the frontier (often 3 to 6 questions); a question that depends on another one still open belongs to a later round.

Finding _facts_ is your job, never the user's. Look things up in the repo, the design record, the reference photos and project memory yourself before asking. The _decisions_ are the user's: put each one to them and wait.

## Questions worth asking in this project

Pick the ones that apply; don't run through them as a checklist.

- **Audience and message.** What should the platform management team (possibly the CEO) feel or decide after this part? Which of their KPIs does it end on?
- **The story.** What does the player do, what happens on the screens, and where does the AI step in or deliberately not step in?
- **Realism.** Which reference photo or video frame is this based on? What do real operators do here?
- **Confidentiality.** Does it name or depict the real platform? Then it must not go into this public repo or GitHub Pages.
- **Budget.** Triangles, draw calls, texture memory and download size against the web budget, and whether it needs a re-bake.
- **Done.** What preview does the user want to see first, and what does "good enough" look like?

## Write it down as you go

Capture each decision the moment it settles, not in one batch at the end:

- **Game design, story, audience, anything platform-specific:** the private design record `/mnt/project-files/control-room-game/design.md` (an index; write to the matching topic file in `design/`, or add a new file and an index line). Never put platform-specific content in the repo.
- **Words:** when a term gets pinned down (a "station", the "band", a "light map"), add it to `GLOSSARY.md` at the repo root: one or two sentences each, what it _is_, with rejected synonyms under `_Avoid_`. Generic terms only, no platform names. Create the file when the first term settles.
- **Hard technical decisions:** add a short ADR in `docs/adr/NNNN-slug.md` (next free number; a single paragraph of context, decision and why is enough) only when the decision is hard to reverse, would surprise a future reader, and came from a real trade-off. Examples: baking strategy, how screens get their content, where private content is hosted.

When the user's words clash with the glossary, the design record or the code, say so immediately: "The design record says the ESD panel is hands-off for AI, but this plan has the assistant triggering it. Which is right?"

## Done

The session is done when the frontier is empty: every branch visited, nothing silently assumed. Summarise the settled plan in a few lines and do not start building until the user confirms it. The next step is usually the `prototype` skill.

Adapted from Matt Pocock's `grilling` and `domain-modeling` skills (MIT, https://github.com/mattpocock/skills).
