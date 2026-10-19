"""Fold the Vite build (dist/) into one HTML file with inline JS and CSS, for
hosts that only take a single page plus data files (like a Claude artifact).
The scene files stay separate and are fetched from scene/ next to the page.

    npm run build && python3 qa/assemble_preview.py
"""
import glob
import os
import re

here = os.path.dirname(os.path.abspath(__file__))
dist = os.path.join(here, "..", "dist")
html = open(os.path.join(dist, "index.html"), encoding="utf-8").read()

js = "".join(open(p, encoding="utf-8").read() for p in glob.glob(os.path.join(dist, "assets", "*.js")))
css = "".join(open(p, encoding="utf-8").read() for p in glob.glob(os.path.join(dist, "assets", "*.css")))

head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
title = re.search(r"<title>.*?</title>", head).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]+>', head).group(0)
body = re.sub(r"<script[^>]*src=[^>]*></script>", "", body)

js = js.replace("</script", "<\\/script")


def glb_to_gltf_json(src, dst):
    """Some static hosts refuse .glb. glTF's JSON form with the binary chunk
    embedded as a data URI holds the same scene, and GLTFLoader reads both."""
    import base64, json, struct
    data = open(src, "rb").read()
    magic, _, _ = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF"
    off, doc, binary = 12, None, b""
    while off < len(data):
        length, kind = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + length]
        if kind == b"JSON":
            doc = json.loads(chunk)
        elif kind == b"BIN\x00":
            binary = chunk
        off += 8 + length
    doc["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(binary).decode()
    open(dst, "w").write(json.dumps(doc, separators=(",", ":")))


if os.environ.get("GLTF_AS_JSON"):
    glb_to_gltf_json(os.path.join(dist, "scene", "scene.glb"), os.path.join(dist, "scene", "scene.gltf.json"))
    js = js.replace("scene.glb", "scene.gltf.json")
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
