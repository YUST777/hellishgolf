"""
Prepare game-ready assets from the free lava tileset pack.

Outputs into public/game/hellish/gen/:
  lava_anim.webp  - 7-frame 16x16 animated molten-lava strip (112x16)
  torch_anim.webp - 7-frame 16x32 animated torch strip (112x32)
  rock_fill.webp  - 16x16 rock ground fill
  rock_top.webp   - 16x16 rock with lit lava top edge

Everything stays on the native 16px grid so it lines up with the game tiles.
"""
from pathlib import Path
from PIL import Image

PACK = Path(
    "public/game/hellish/Top Down Lava Tileset 16x16 Free/FREE TILESET FILES"
)
OUT = Path("public/game/hellish/gen")
OUT.mkdir(parents=True, exist_ok=True)
T = 16


def opacity(im):
    a = im.split()[-1]
    px = a.load()
    w, h = im.size
    n = sum(1 for y in range(h) for x in range(w) if px[x, y] > 20)
    return n / (w * h)


# --- animated lava: crop a consistent 16x16 window from each Burning Lava frame
lava_frames = []
for i in range(1, 8):
    f = Image.open(PACK / "Environment ( With Animations )" / "Burning Lava" / f"burninglava{i}.png").convert("RGBA")
    # Frame is 112x64; take a centered 16x16 window of flowing lava.
    cx, cy = (f.width - T) // 2, (f.height - T) // 2
    lava_frames.append(f.crop((cx, cy, cx + T, cy + T)))
lava = Image.new("RGBA", (T * len(lava_frames), T), (0, 0, 0, 0))
for i, fr in enumerate(lava_frames):
    lava.paste(fr, (i * T, 0))
lava.save(OUT / "lava_anim.webp", lossless=True, method=6)
print(f"lava_anim.webp {lava.size}")

# --- animated torch: 7 frames of 16x32
torch_frames = [
    Image.open(PACK / "PROPS ( With Animations )" / "Torch ( No Light )" / f"torch{i}.png").convert("RGBA")
    for i in range(1, 8)
]
tw, th = torch_frames[0].size
torch = Image.new("RGBA", (tw * len(torch_frames), th), (0, 0, 0, 0))
for i, fr in enumerate(torch_frames):
    torch.paste(fr, (i * tw, 0))
torch.save(OUT / "torch_anim.webp", lossless=True, method=6)
print(f"torch_anim.webp {torch.size} (frame {tw}x{th})")

# --- rock tiles from the main sheet: auto-pick a solid fill and a lit-top edge
sheet = Image.open(PACK / "freelavatileset-Sheet.png").convert("RGBA")
cols, rows = sheet.width // T, sheet.height // T


def tile(cx, ry):
    return sheet.crop((cx * T, ry * T, cx * T + T, ry * T + T))


def warmth_top(im):
    """Fraction of warm (lava) pixels in the top third -> lit edge score."""
    px = im.load()
    warm = 0
    for y in range(T // 3):
        for x in range(T):
            r, g, b, a = px[x, y]
            if a > 20 and r > 120 and r > g + 40 and r > b + 40:
                warm += 1
    return warm


# Fill: fully-opaque tile in the interior rows with the least warm pixels (plain rock).
best_fill, best_fill_score = None, 1e9
for ry in range(4, 9):
    for cx in range(cols):
        t = tile(cx, ry)
        if opacity(t) > 0.98:
            score = warmth_top(t)
            if score < best_fill_score:
                best_fill_score, best_fill = score, t
# Top edge: opaque tile in upper rows with the most warm pixels along the top.
best_top, best_top_score = None, -1
for ry in range(1, 5):
    for cx in range(cols):
        t = tile(cx, ry)
        if opacity(t) > 0.9:
            score = warmth_top(t)
            if score > best_top_score:
                best_top_score, best_top = score, t

(best_fill or tile(0, 7)).save(OUT / "rock_fill.webp", lossless=True, method=6)
(best_top or best_fill or tile(0, 3)).save(
    OUT / "rock_top.webp", lossless=True, method=6
)
print(f"rock_fill (warm={best_fill_score}) rock_top (warm={best_top_score}) saved")
print("done")
