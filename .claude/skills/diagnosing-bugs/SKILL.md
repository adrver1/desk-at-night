---
name: diagnosing-bugs
description: Disciplined loop for hard bugs, visual glitches and slowdowns in the viewer, the game or the Blender bake. Use when something is broken, looks wrong, throws, or got slow.
---

# Diagnosing bugs

A discipline for hard bugs. Skip phases only when you can say why.

## Phase 1: Build a feedback loop

**This is the skill.** With a tight pass/fail signal that goes red on _this_ bug, you will find the cause. Without one, staring at code won't save you. Spend most of your effort here.

Ways to build one in this repo, roughly in order:

1. **Playwright script** that opens the page (`vite preview`), drives it to the broken state (`?cam=N`, key presses, clicks) and asserts on the console, the DOM or pixels. `web/qa/check.mjs` shows the setup, including the SwiftShader flags for headless WebGL.
2. **Pixel check.** Screenshot a fixed camera and compare a region against a known-good shot or the Cycles reference (`web/qa/diff.py`). Pin everything that moves: time of day, weather, animation time, random seeds.
3. **Blender check.** A headless `bpy` script that builds only the part of the scene in question and prints the numbers that matter (object bounds, UV ranges, triangle counts, material names), or a tiny low-sample bake of one object.
4. **Bisect.** If it worked at some earlier commit, script "build, check" and run `git bisect run`.
5. **Human in the loop**, last resort, when only a real device shows it (phone controls, a GPU driver): copy `scripts/hitl-loop.template.sh`, edit the steps, and have the user run it.

Then tighten the loop: faster (smaller resolution, fewer samples, skip unrelated scene parts), sharper (assert the exact symptom, not "didn't crash"), deterministic.

Phase 1 is done when you can name **one command you have already run** that drives the real code path, catches the user's exact symptom, gives the same verdict every time and finishes in seconds. If you catch yourself building theories before this command exists, stop.

If you truly cannot build a loop, say so, list what you tried, and ask the user for a screenshot, a screen recording, the console output, or the device and browser it happens on.

## Phase 2: Reproduce and minimise

Run the loop and watch it go red. Check it is the symptom the user described, not a neighbouring one. Then cut the scenario down one piece at a time until every remaining piece is needed for the failure.

## Phase 3: Hypothesise

Write **3 to 5 ranked, falsifiable hypotheses** before testing any: "If the light map UVs overlap, then rendering the UV layout will show overlapping islands on the desk." Show the list to the user; they may know something that re-ranks it. Don't block on it.

## Phase 4: Instrument

Each probe tests one prediction; change one thing at a time. Tag debug logs with a unique prefix like `[DEBUG-a4f2]` so cleanup is one grep. For slowness, measure first (frame time, draw calls, triangle and texture counts via `renderer.info`, bake time), then bisect.

## Phase 5: Fix and regression check

Where there is a real seam for it, turn the minimised loop into a check that stays in the repo (for example a new state in `web/qa/check.mjs`), watch it fail, fix, watch it pass, and re-run the original loop. If no good seam exists, say so: that is a finding too.

## Phase 6: Clean up

- The original loop no longer reproduces the bug.
- No `[DEBUG-` logs left (grep the prefix).
- Throwaway scripts deleted or kept out of `main`.
- The cause that turned out to be right is stated in the commit or PR message.

Adapted from Matt Pocock's `diagnosing-bugs` skill (MIT, https://github.com/mattpocock/skills).
