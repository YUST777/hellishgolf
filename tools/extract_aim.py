"""Print context windows around aim-rendering tokens in the bundle."""
from pathlib import Path

src = Path(
    "reference/source-kindahardgolf/mirror/kindahardgolf.com/assets/main-BJB3UXaN.js"
).read_text(errors="ignore")


def show(token, before=40, after=520, n=6):
    print(f"\n===== {token!r} =====")
    i, count = 0, 0
    while count < n:
        j = src.find(token, i)
        if j < 0:
            break
        seg = src[max(0, j - before) : j + after]
        print(f"[{j}] ...{seg}...\n")
        i = j + 1
        count += 1


# Reading dragX for rendering (the state def is at ~ the AIM object; renders read .dragX)
show(".dragX", n=8)
show("powerPct", n=8)
