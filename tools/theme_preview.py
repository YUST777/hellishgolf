"""Make a large, nearest-neighbour preview of the themed atlas for quick review."""
from pathlib import Path
from PIL import Image

BASE = Path("public/game")
ts = Image.open(BASE / "tilemap" / "tileset.webp").convert("RGBA")
scale = 3
preview = ts.resize((ts.width * scale, ts.height * scale), Image.NEAREST)
out = Path("tools/lava_tileset_preview.webp")
preview.save(out, lossless=True, method=6)
print(f"wrote {out} ({preview.width}x{preview.height})")
