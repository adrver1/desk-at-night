# desk-at-night

Blender (bpy) scenes baked in Cycles plus a Vite + Three.js viewer and a first-person control room game. See README.md for build commands.

## How we work on the game

The project skills in `.claude/skills/` set the order of work, so the result matches what Adriaen intends:

1. **Plan with `grill-design`** before building any new station, scene, feature or bigger change. Ask in rounds with a recommended answer for each question, and write settled decisions down as they happen.
2. **Preview with `prototype`** before full integration or a long bake. Show 2 to 3 structurally different options as stills or screenshots and wait for a pick.
3. **Build** the chosen option, then run the QA (`npm run qa` in `web/`, or a Playwright screenshot of the changed view) and look at the result before opening a PR.
4. **Debug with `diagnosing-bugs`** when something breaks or looks wrong: build a reproducible check first, then hypotheses, then the fix.

Use `to-questionnaire` when an answer has to come from someone else, such as operators or the platform team.

## Rules

- This repo is public. Reference photos, the real platform's name, people or numbers stay in the private project files (`/mnt/project-files/control-room-game/`), never in commits or on GitHub Pages.
- Game design decisions live in `/mnt/project-files/control-room-game/design.md`. Shared vocabulary goes in `GLOSSARY.md`, hard-to-reverse technical decisions in `docs/adr/`.
- `blender/*.py` scripts are the source of truth; never hand-edit generated `.blend` files or baked assets.
