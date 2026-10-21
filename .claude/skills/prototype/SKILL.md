---
name: prototype
description: Build a quick throwaway preview to answer a design question before full integration or a long bake. Use for any new object, station, screen layout or interaction, and whenever the user wants to see options first.
---

# Prototype

A prototype is **throwaway work that answers a question**. Adriaen wants a preview check-in before any new object or feature is fully rendered or wired into the scene, so this is the normal second step after `grill-design`.

## State the question first

Write it in one line at the top of the prototype and in your message: "Which of three chair shapes reads best from the operator seat?" The question decides the shape:

- **"What should this object look like?"** Render preview stills from Blender: a draft Cycles render (`--samples 8` to `16`) from the in-game camera positions, plus close-ups. Follow the existing `blender/preview_*.py` scripts. Show it in the room, not in a void: an object that looks fine on its own can be wrong in context.
- **"What should this screen or panel show?"** A 2D canvas mock in a standalone page, like `web/screens.html`, with variants switchable via `?variant=`.
- **"Does this interaction or game logic feel right?"** A minimal page or a `?variant=` flag on `play.html` that the user can click through, with the current state printed on screen after every action.

## Variants

Default to **3 variants**, at most 5. They must be **structurally different** (different shape, layout or interaction), not three colour tweaks of one idea. Put them side by side in one contact sheet or behind one switch, so the user compares them at a glance.

## Rules

1. **Throwaway and clearly marked.** Name files so it is obvious (`preview_*.py`, `*-prototype.html`). Keep them next to what they prototype.
2. **Cheap.** Draft samples, small resolutions, no full bake, no tests, no polish. Learn fast.
3. **One command to run.** Say the exact command or URL.
4. **Show, don't describe.** Save the stills or screenshots under `/mnt/project-files/control-room-game/<topic>/` and attach them to your message. Use Playwright (as in `web/qa/check.mjs`) to screenshot web prototypes.
5. **Stop and ask.** End with the question and your recommendation, then wait for the user's pick before integrating or baking.
6. **Fold it in, then clean up.** Once a variant is chosen, build it properly, record the decision (design record or ADR, see `grill-design`), and delete the losing variants or keep them out of `main`.

Never commit reference photos or platform-specific content to this public repo; previews of those stay in the project files.

Adapted from Matt Pocock's `prototype` skill (MIT, https://github.com/mattpocock/skills).
