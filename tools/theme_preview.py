"""Make a large, nearest-neighbour preview of the themed atlas for quick review."""
from pathlib import Path
from PIL import Image

BASE = Path("public/game")
ts = Image.open(BASE / "tilemap" / "tileset.png").convert("RGBA")
scale = 3
preview = ts.resize((ts.width * scale, ts.height * scale), Image.NEAREST)
out = Path("tools/lava_tileset_preview.png")
preview.save(out)
print(f"wrote {out} ({preview.width}x{preview.height})")
