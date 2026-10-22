"""
The shared character palette: one 256x256 texture of 16x16 px colour
swatches. Every character UV-maps each face onto the centre of one swatch,
so a whole cast shares one material and one texture.

    python characters/_shared/palette.py        # writes palette.png + palette.json

Swatches are addressed by name. Add new colours in empty cells; never move
an existing one, or every character's UVs move with it.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
GRID, CELL = 16, 16
SIZE = GRID * CELL

# One row per family, left to right. Row/column is the swatch address.
ROWS = [
    # 0 skin, light to dark
    [("skin_1", "#f6d7c3"), ("skin_2", "#eac0a2"), ("skin_3", "#d9a37f"), ("skin_4", "#c08560"),
     ("skin_5", "#9c6644"), ("skin_6", "#7a4b30"), ("skin_7", "#5b3522"), ("skin_8", "#3f2518")],
    # 1 hair
    [("hair_black", "#1e1a19"), ("hair_dark_brown", "#3b2a20"), ("hair_brown", "#5e4030"),
     ("hair_light_brown", "#8a6446"), ("hair_blond", "#d2b071"), ("hair_ginger", "#b45a2c"),
     ("hair_grey", "#8d8a86"), ("hair_white", "#dcdad4"), ("hair_auburn", "#9a4b24"),
     ("hair_strawberry", "#c4804e"), ("hair_dark_blond", "#9c7a4c"), ("hair_salt_pepper", "#7b756e"),
     ("hair_fade", "#7a6a5e"), ("hair_fade_dark", "#594a40")],
    # 2 face details
    [("eye", "#1b1d22"), ("eye_white", "#f2f0ea"), ("lip", "#a8584e"), ("lip_dark", "#6e3a33"),
     ("teeth", "#f4f1e8"), ("blush", "#d98a7a"),
     ("stubble", "#b39580"), ("stubble_dark", "#8f7563")],
    # 3 workwear: offshore coveralls, hi-vis and reflective tape
    [("coverall_orange", "#e2632a"), ("coverall_red", "#b8322a"), ("coverall_navy", "#1f2e4a"),
     ("hivis_yellow", "#ece53a"), ("hivis_orange", "#f08a24"), ("reflective", "#c9cdd0"),
     ("helmet_white", "#eceeee"), ("helmet_orange", "#e8742c"), ("helmet_blue", "#2c5ea8"),
     ("jacket_amber", "#f0a428"), ("jacket_amber_dark", "#c98318")],
    # 4 office and casual cloth
    [("navy", "#02293c"), ("blue", "#3a6ea5"), ("light_blue", "#9cc0e0"), ("denim", "#45607f"),
     ("red", "#b03a30"), ("green", "#4f7a46"), ("olive", "#6b6a3c"), ("khaki", "#b9a77c"),
     ("sand", "#d2ccb3"), ("burgundy", "#6e2433"), ("teal", "#2e7a78"), ("purple", "#5b4a86"),
     ("turquoise", "#4cc0cc"), ("turquoise_dark", "#2f98a4"), ("pale_blue", "#d7e3ee")],
    # 5 neutrals
    [("white", "#f1f1ee"), ("light_grey", "#c4c6c6"), ("grey", "#8b8f92"), ("slate", "#73838d"),
     ("charcoal", "#3c4145"), ("black", "#16181a"), ("undersuit", "#9aa0a4")],
    # 6 leather, rubber, metal, glass, plastic
    [("leather_brown", "#5a3a26"), ("leather_tan", "#a0714a"), ("rubber", "#26282a"),
     ("steel", "#9ea7ad"), ("gold", "#c9a24a"), ("glass", "#9fc4d2"), ("lens", "#202a33"),
     ("signal_red", "#d8261c"), ("screen_green", "#4cd17a"), ("plastic_black", "#2a2c2f"),
     ("glass_clear", "#cfe2e8")],
    # 7 logos and badges
    [("logo_magenta", "#c42a72"), ("logo_orange", "#ec8a3c"), ("logo_green", "#2e9a52")],
]

SWATCHES = {}
for r, row in enumerate(ROWS):
    for c, (name, hexcol) in enumerate(row):
        assert name not in SWATCHES, name
        SWATCHES[name] = (r, c, hexcol)


def uv(name):
    """UV of the centre of a swatch (V up, row 0 at the top of the image)."""
    r, c, _ = SWATCHES[name]
    return ((c + 0.5) / GRID, 1 - (r + 0.5) / GRID)


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def write(path=os.path.join(HERE, "palette.png")):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (SIZE, SIZE), (255, 0, 255))  # magenta = unused cell
    d = ImageDraw.Draw(img)
    for name, (r, c, h) in SWATCHES.items():
        d.rectangle([c * CELL, r * CELL, c * CELL + CELL - 1, r * CELL + CELL - 1], fill=hex_rgb(h))
    img.save(path)
    with open(os.path.splitext(path)[0] + ".json", "w") as f:
        json.dump({n: {"row": r, "col": c, "hex": h} for n, (r, c, h) in SWATCHES.items()}, f, indent=1)
    return path


if __name__ == "__main__":
    print(write())
