"""Generate a seamless, looping, tileable animated lava spritesheet.

Output: public/game/lava_anim.png  (N frames of 16x16 laid out horizontally).
Uses integer-frequency sine fields so it tiles perfectly in x/y and loops in
time, mapped through a molten palette with bright moving cracks.
"""
import math
from pathlib import Path
from PIL import Image

T = 16
N = 8
OUT = Path("public/game/lava_anim.png")

# Palette stops (position, RGB).
STOPS = [
    (0.00, (58, 12, 6)),
    (0.38, (150, 40, 10)),
    (0.66, (226, 86, 18)),
    (0.86, (255, 150, 32)),
    (1.00, (255, 224, 96)),
]


def palette(v):
    v = max(0.0, min(1.0, v))
    for i in range(len(STOPS) - 1):
        p0, c0 = STOPS[i]
        p1, c1 = STOPS[i + 1]
        if v <= p1:
            t = (v - p0) / (p1 - p0) if p1 > p0 else 0
            return tuple(round(c0[k] + (c1[k] - c0[k]) * t) for k in range(3))
    return STOPS[-1][1]


sheet = Image.new("RGBA", (T * N, T), (0, 0, 0, 255))
px = sheet.load()

for f in range(N):
    t = f / N
    for y in range(T):
        for x in range(T):
            u, v = x / T, y / T
            n = 0.5 + 0.5 * math.sin(2 * math.pi * (1 * u + 1 * v + t))
            n += 0.5 + 0.5 * math.sin(2 * math.pi * (2 * u - 1 * v - t))
            n += 0.5 + 0.5 * math.sin(2 * math.pi * (1 * u - 2 * v + 2 * t))
            n /= 3.0
            # sharpen a little so cracks read as bright veins
            n = n ** 1.3
            r, g, b = palette(n)
            px[f * T + x, y] = (r, g, b, 255)

sheet.save(OUT)
print(f"wrote {OUT} ({sheet.width}x{sheet.height}, {N} frames)")
