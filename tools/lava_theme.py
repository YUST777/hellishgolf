"""
HellishGolf lava re-theme.

Recolours the existing pixel-art textures into a lava palette WITHOUT touching
tile positions/sizes, so every tile-ID (and therefore all physics/gameplay) is
preserved. Originals are backed up to public/game/_theme_backup/ first.

Colour mapping (per non-transparent, non-grey pixel, in HSV):
  * greens (turf)      -> charred basalt: warm dark grey rock
  * blues/cyans (water)-> molten lava: glowing orange/red
  * warm tones (dirt)  -> scorched earth: slightly darker + warmer
Near-grey / black outlines and the white ball are left untouched.
"""
import colorsys
import shutil
from pathlib import Path
from PIL import Image

BASE = Path("public/game")
BACKUP = BASE / "_theme_backup"
BACKUP.mkdir(exist_ok=True)


def remap_pixel(r, g, b, mode):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue = h * 360

    # Keep outlines, shadows, near-greys and the white ball intact.
    if s < 0.12:
        return r, g, b

    if 65 <= hue <= 175:
        # Turf greens -> charred volcanic rock (warm, dark, low saturation).
        nh = 20 / 360
        ns = 0.28
        nv = 0.22 + v * 0.34
    elif 175 <= hue <= 290:
        # Water blues/cyans -> molten lava (glowing orange/red).
        nh = 15 / 360
        ns = 0.95
        nv = min(1.0, v * 1.05 + 0.15)
    else:
        # Warm tones (dirt/brown/red) -> scorched earth.
        nh = h
        ns = min(1.0, s * 1.05)
        nv = v * 0.82

    if mode == "smoke":
        # Clouds become drifting ash/smoke: desaturated dark grey.
        nh, ns, nv = 0, 0.05, 0.20 + v * 0.28

    nr, ng, nb = colorsys.hsv_to_rgb(nh, ns, nv)
    return round(nr * 255), round(ng * 255), round(nb * 255)


def process(name, mode="tiles"):
    src = BASE / name
    if not src.exists():
        print(f"skip (missing) {name}")
        return
    backup = BACKUP / Path(name).name
    if not backup.exists():
        shutil.copy2(src, backup)
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, hgt = im.size
    for y in range(hgt):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            nr, ng, nb = remap_pixel(r, g, b, mode)
            px[x, y] = (nr, ng, nb, a)
    im.save(src, lossless=True, method=6)
    print(f"themed {name} ({w}x{hgt}, mode={mode})")


process("tilemap/tileset.webp", "tiles")
process("textures/checkerboard.webp", "tiles")
print("done")
