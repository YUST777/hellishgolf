from pathlib import Path

src = Path(
    "reference/source-kindahardgolf/mirror/kindahardgolf.com/assets/main-BJB3UXaN.js"
).read_text(errors="ignore")


def show(token, before=40, after=620, n=3):
    print(f"\n===== {token!r} =====")
    i, count = 0, 0
    while count < n:
        j = src.find(token, i)
        if j < 0:
            break
        print(f"[{j}] ...{src[max(0,j-before):j+after]}...\n")
        i = j + 1
        count += 1


show("_squashElapsed", n=6)
show("squash", n=4)
show(".rotation+=", n=4)
show("recordShot", before=120, after=200, n=2)
show("Yn=", n=3)
