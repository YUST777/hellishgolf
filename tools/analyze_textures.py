"""Sample the dominant colours in each texture so we can build a lava palette map."""
from collections import Counter
from pathlib import Path
from PIL import Image

BASE = Path("public/game")
paths = [
    BASE / "tilemap" / "tileset.webp",
    BASE / "textures" / "checkerboard.webp",
    BASE / "textures" / "trajectory_powerup_icon.webp",
    BASE / "textures" / "slime_powerup_icon.webp",
    BASE / "textures" / "checkpoint_powerup_icon.webp",
    BASE / "textures" / "shop_icon.webp",
]

for p in paths:
    if not p.exists():
        print(f"MISSING {p}")
        continue
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    px = im.load()
    counter = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            # bucket to reduce noise
            counter[(r // 16 * 16, g // 16 * 16, b // 16 * 16)] += 1
    top = counter.most_common(12)
    print(f"\n{p.name}  {w}x{h}")
    for (r, g, b), n in top:
        print(f"  #{r:02x}{g:02x}{b:02x}  x{n}")
