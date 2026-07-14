from pathlib import Path

src = Path(
    "reference/source-kindahardgolf/mirror/kindahardgolf.com/assets/main-BJB3UXaN.js"
).read_text(errors="ignore")


def show(token, before=20, after=700, n=3):
    print(f"\n===== {token!r} =====")
    i, count = 0, 0
    while count < n:
        j = src.find(token, i)
        if j < 0:
            break
        print(f"[{j}] ...{src[max(0,j-before):j+after]}...\n")
        i = j + 1
        count += 1


# The aim-draw helper is defined as `function Cg(` or `Cg=(`.
show("Cg=", n=2)
show("function Cg", n=2)
show("applyPowerTint", before=60, after=420, n=2)
show("fu=", n=3)
show("const fu", n=2)
