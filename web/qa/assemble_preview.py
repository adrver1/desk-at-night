"""Fold the Vite build into one HTML file with inline JS and CSS, for hosts
that only take a single page plus data files (like a Claude artifact).
The scene files stay separate and are fetched from scene/ next to the page.

Such hosts may also refuse binary .glb files and block data: URIs, so the
model ships as base64 inside a JSON file and main.js decodes it.

    VITE_MODEL=scene.glb.b64.json npx vite build --outDir dist-preview
    python3 qa/assemble_preview.py
"""
import base64
import glob
import json
import os
import re

here = os.path.dirname(os.path.abspath(__file__))
dist = os.path.join(here, "..", os.environ.get("DIST", "dist-preview"))
html = open(os.path.join(dist, "index.html"), encoding="utf-8").read()

js = "".join(open(p, encoding="utf-8").read() for p in glob.glob(os.path.join(dist, "assets", "*.js")))
css = "".join(open(p, encoding="utf-8").read() for p in glob.glob(os.path.join(dist, "assets", "*.css")))

head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
title = re.search(r"<title>.*?</title>", head).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]+>', head).group(0)
body = re.sub(r"<script[^>]*src=[^>]*></script>", "", body)
js = js.replace("</script", "<\\/script")

glb = open(os.path.join(dist, "scene", "scene.glb"), "rb").read()
with open(os.path.join(dist, "scene", "scene.glb.b64.json"), "w") as f:
    json.dump({"base64": base64.b64encode(glb).decode()}, f)

page = f"""{title}
<meta name="claude:viewport-fit-sides" content="cover">
{fonts}
<style>{css}</style>
{body.strip()}
<script type="module">{js}</script>
"""
out = os.path.join(here, "..", "preview.html")
open(out, "w", encoding="utf-8").write(page)
print(f"wrote {out} ({len(page) / 1e3:.0f} kB)")
