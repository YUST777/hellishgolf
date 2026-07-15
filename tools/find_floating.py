"""Find tile ids that appear 'floating' (all 4 neighbours empty) across maps.
Those are decorations that must NOT be solid. Also dump each such frame as a
zoomed WebP so we can eyeball what the glyph is."""
import json
from collections import Counter
from pathlib import Path
from PIL import Image

MAPS = Path("public/game/tilemap")
TS = Image.open(MAPS / "tileset.webp").convert("RGBA")
T = 16
COLS = TS.width // T  # 33

FLIP = 0x1FFFFFFF
floating = Counter()
allids = Counter()

for mp in sorted(MAPS.glob("map-*.json")):
    j = json.loads(mp.read_text())
    w, h = j["width"], j["height"]
    layer = next((l for l in j["layers"] if l.get("type") == "tilelayer"), None)
    if not layer:
        continue
    d = [v & FLIP for v in layer["data"]]

    def gid(c, r):
        if c < 0 or r < 0 or c >= w or r >= h:
            return 0
        return d[r * w + c]

    for r in range(h):
        for c in range(w):
            g = gid(c, r)
            if g <= 0:
                continue
            allids[g - 1] += 1
            if gid(c - 1, r) == 0 and gid(c + 1, r) == 0 and gid(c, r - 1) == 0 and gid(c, r + 1) == 0:
                floating[g - 1] += 1

print("Floating (isolated) tile ids -> count:")
for tid, n in floating.most_common(20):
    print(f"  id {tid}  x{n}")

# Dump the top floating frames as zoomed WebPs.
out = Path("tools/floating_frames")
out.mkdir(exist_ok=True)
for tid, _ in floating.most_common(12):
    fc, fr = tid % COLS, tid // COLS
    frame = TS.crop((fc * T, fr * T, fc * T + T, fr * T + T)).resize((128, 128), Image.NEAREST)
    frame.save(out / f"tile_{tid}.webp", lossless=True, method=6)
print(f"\nwrote zoomed frames to {out}")
