#!/usr/bin/env python3
"""Build the palette data files in palettes/ from the raw sources in scripts/sources/.

  mard-221.json  (default)  HansBug/pindou-color-data `mard-221-alfonse-doudou` (MIT),
                            cross-checked against `mard-221-github`.
  mard-264.json             transcribed from https://www.pindoupic.com/seka/264

Chinese colour names come from the pindoupic MARD chart (same code system).
To add another brand (Artkal/Perler/Hama...), write palettes/<id>.json in the same
shape and list it in palettes/index.json.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts/sources"
SERIES = {
    "A": ("黄/橙", "Yellow/Orange"), "B": ("绿", "Green"), "C": ("蓝", "Blue"),
    "D": ("紫", "Purple"), "E": ("粉", "Pink"), "F": ("红", "Red"),
    "G": ("棕/咖啡", "Brown"), "H": ("黑白灰", "Neutral"), "M": ("莫兰迪", "Morandi"),
    "P": ("马卡龙", "Macaron"), "Q": ("荧光", "Fluorescent"), "R": ("缤纷", "Vivid"),
    "T": ("透明", "Transparent"), "Y": ("夜光", "Glow-in-dark"),
}


def series_of(code):
    return code.rstrip("0123456789")


def read_tsv(path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            code, hexv, name = line.split("\t")
            rows.append({"code": code, "hex": hexv.upper(), "name": name})
    return rows


def channel_diff(a, b):
    return max(abs(int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) for i in (1, 3, 5))


def write(pid, name, source, colors, expected):
    codes = [c["code"] for c in colors]
    assert len(colors) == expected, (pid, len(colors))
    assert len(set(codes)) == expected, f"{pid}: duplicate codes"
    used = sorted({series_of(c) for c in codes}, key=list(SERIES).index)
    out = {
        "id": pid,
        "brand": "MARD",
        "name": name,
        "source": source,
        "notes": "Hex values are screen approximations of physical beads; public charts differ by a few units.",
        "series": {k: {"zh": SERIES[k][0], "en": SERIES[k][1]} for k in used},
        "colors": [{**c, "series": series_of(c["code"])} for c in colors],
    }
    dest = ROOT / f"palettes/{pid}.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {dest.relative_to(ROOT)} ({len(colors)} colors, series {''.join(used)})")


mard264 = read_tsv(SRC / "mard-264-source.tsv")
names = {c["code"]: c["name"] for c in mard264}

primary = json.loads((SRC / "hansbug-mard-221-alfonse-doudou.json").read_text(encoding="utf-8"))["colors"]
alt = {c["code"]: c["hex"].upper() for c in json.loads((SRC / "hansbug-mard-221-github.json").read_text(encoding="utf-8"))["colors"]}
mard221 = [{"code": c["code"], "hex": c["hex"].upper(), "name": names.get(c["code"], "")} for c in primary]
assert set(alt) == {c["code"] for c in mard221}, "MARD 221 sources disagree on the code set"
far = [(c["code"], c["hex"], alt[c["code"]]) for c in mard221 if channel_diff(c["hex"], alt[c["code"]]) > 24]
print(f"mard-221 cross-check vs mard-221-github: same 221 codes; {len(far)} colours differ by >24/255 in a channel")

write("mard-221", {"zh": "MARD 221色 标准色", "en": "MARD 221-color standard set"},
      "https://github.com/HansBug/pindou-color-data/tree/main/mard-221-alfonse-doudou (MIT)", mard221, 221)
write("mard-264", {"zh": "MARD 264色全套装", "en": "MARD 264-color full set"},
      "https://www.pindoupic.com/seka/264", mard264, 264)

index = [
    {"id": "mard-221", "file": "mard-221.json", "label": "MARD 221色 标准色 · MARD 221 standard", "default": True},
    {"id": "mard-264", "file": "mard-264.json", "label": "MARD 264色全套装 · MARD 264 full set"},
]
(ROOT / "palettes/index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("wrote palettes/index.json")
