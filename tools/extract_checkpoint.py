from pathlib import Path

src = Path(
    "reference/source-kindahardgolf/mirror/kindahardgolf.com/assets/main-BJB3UXaN.js"
).read_text(errors="ignore")


def show(token, before=60, after=520, n=4):
    print(f"\n===== {token!r} =====")
    i, count = 0, 0
    while count < n:
        j = src.find(token, i)
        if j < 0:
            break
        print(f"[{j}] ...{src[max(0,j-before):j+after]}...\n")
        i = j + 1
        count += 1


show("returnToCheckpoint", n=2)
show("activateCheckpoint", n=3)
show("getCheckpointByNumber", n=2)
show("activatedCheckpoints", n=3)
show("On.Chime", n=3)
show('="checkpoint', n=3)
