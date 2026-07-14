"""Study the free lava tileset: per-tile fill map + dominant hue classification."""
import colorsys
from pathlib import Path
from PIL import Image

root = Path("public/game/hellish/Top Down Lava Tileset 16x16 Free/FREE TILESET FILES")
sheet = Image.open(root / "freelavatileset-Sheet.png").convert("RGBA")
W, H = sheet.size
T = 16
cols, rows = W // T, H // T
px = sheet.load()


def classify(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue = h * 360
    if s < 0.18:
        return "." if v > 0.4 else "#"  # grey/rock
    if hue < 40 or hue > 330:
        return "L"  # lava red/orange
    if hue < 70:
        return "o"  # orange/ember
    return "?"


print(f"main sheet {W}x{H} = {cols}x{rows} tiles\n")
for ry in range(rows):
    line = []
    for cx in range(cols):
        # sample tile: fraction opaque + average colour
        rs = gs = bs = n = 0
        opaque = 0
        for y in range(ry * T, ry * T + T):
            for x in range(cx * T, cx * T + T):
                r, g, b, a = px[x, y]
                if a > 20:
                    rs += r
                    gs += g
                    bs += b
                    n += 1
                    opaque += 1
        if n == 0:
            line.append(" ")
        else:
            line.append(classify(rs // n, gs // n, bs // n))
    print(f"{ry:2d} " + "".join(line))

# Scaled preview for eyeballing.
preview = sheet.resize((W * 4, H * 4), Image.NEAREST)
preview.save("tools/lava_pack_sheet_preview.png")
print("\nwrote tools/lava_pack_sheet_preview.png")
