"""Print small context windows around the physics-relevant tokens in the bundle."""
from pathlib import Path

src = Path(
    "reference/source-kindahardgolf/mirror/kindahardgolf.com/assets/main-BJB3UXaN.js"
).read_text(errors="ignore")


def show(token, before=90, after=260, n=3):
    print(f"\n===== {token!r} =====")
    i, count = 0, 0
    while count < n:
        j = src.find(token, i)
        if j < 0:
            break
        seg = src[max(0, j - before) : j + after]
        print(f"[{j}] ...{seg}...")
        i = j + 1
        count += 1


show("setLinvel", n=4)
show("Math.pow(He.power")
show(":jl", before=140, after=80)
show("=Sa,", before=40, after=60)
show("PlaySound(On.BallHit", before=80, after=40)
