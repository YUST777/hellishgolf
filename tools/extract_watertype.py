from pathlib import Path
import re

src = Path(
    "reference/source-kindahardgolf/mirror/kindahardgolf.com/assets/main-BJB3UXaN.js"
).read_text(errors="ignore")

# Find all `s[NUM]="water"` style assignments anywhere.
for m in re.finditer(r'\[(\d+)\]="water"', src):
    print("water id:", m.group(1), "at", m.start())

# Also show the region right around the big id->type map start (offset ~852000)
# to capture any water assignment near it.
region = src[852000:853200]
print("\n--- id->type map region ---")
print(region)
