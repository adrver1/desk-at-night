"""Pack the built story game for the story script editor's live stage.

The editor is a claude.ai artifact, which cannot frame or fetch another
site, so it carries the game as its own files. The artifact service only
serves web media types, so .glb/.bin go up as .glb.wasm/.bin.wasm and a
small fetch shim in story.html asks for those names.

    cd web && npx vite build && python scripts/story-editor/pack_game.py dist <out>

Then publish the editor with <out> as `root` and its files under `files`
(see README.md, "Live stage").
"""
import os, re, shutil, sys

src, out = sys.argv[1], sys.argv[2]
KEEP = ['story.html', 'assets', 'control', 'scene', 'intro', 'story']
SKIP = {os.path.join('story', 'private')}   # the private build's own files never go up
SHIM = '''<script>
// pack_game.py: binaries are served as .glb.wasm / .bin.wasm inside the editor artifact
(() => { const f = window.fetch.bind(window), re = /\\.(glb|bin)(?=\\?|#|$)/;
  const fix = (u) => (re.test(u) ? u.replace(re, '.$1.wasm') : u);
  window.fetch = (u, o) => f(typeof u === 'string' ? fix(u) : u instanceof Request && re.test(u.url) ? new Request(fix(u.url), u) : u, o); })();
</script>
'''

if os.path.exists(out): shutil.rmtree(out)
n = size = 0
for top in KEEP:
    p = os.path.join(src, top)
    walk = [(src, [], [top])] if os.path.isfile(p) else os.walk(p)
    for d, dirs, files in walk:
        rel_d = os.path.relpath(d, src)
        dirs[:] = [x for x in dirs if os.path.normpath(os.path.join(rel_d, x)) not in SKIP]
        for f in files:
            if f.startswith('.'): continue
            rel = os.path.normpath(os.path.join(rel_d, f))
            dst = os.path.join(out, rel + ('.wasm' if re.search(r'\.(glb|bin)$', f) else ''))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(d, f), dst)
            n += 1; size += os.path.getsize(dst)
page = os.path.join(out, 'story.html')
html = open(page).read()
i = html.index('<script')
open(page, 'w').write(html[:i] + SHIM + html[i:])
print(f'{n} files, {size / 1e6:.1f} MB in {out}')
if n > 255 or size > 64e6: print('too big for one publish (255 files, 64 MB): publish in parts to the same url')
