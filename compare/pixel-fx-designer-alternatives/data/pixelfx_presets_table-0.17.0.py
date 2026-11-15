"""Prints the page's preset table rows (HTML) from the CLI measure and Pillow check results.
usage: python -I -X utf8 pixelfx_presets_table-0.17.0.py <cli.json> <check.json> <examples-dir>
(-X utf8 because -I ignores PYTHONIOENCODING, and the rows hold × and –.)"""
import json
import os
import sys

cli = json.load(open(sys.argv[1], encoding="utf-8"))
chk = {p["preset"]: p for p in json.load(open(sys.argv[2], encoding="utf-8"))["presets"]}
ex = sys.argv[3]
KIND = {"gas": "Gas", "liquid": "Liquid"}
for p in cli["presets"]:
    c = chk[p["name"]]
    kinds = sorted({e["kind"] for e in p["effects"]})
    kind = ", ".join(KIND.get(k, k.capitalize()) for k in kinds)
    src = os.path.getsize(os.path.join(ex, p["name"] + ".fluid.json"))
    text = open(os.path.join(ex, p["name"] + ".fluid.json"), encoding="utf-8").read()
    tags = [t for t, keys in (("sand", ['"granular"']), ("thick", ['"viscosity"', '"yield"']), ("rigid bodies", ['"bodies"'])) if any(k in text for k in keys)]
    if tags: kind += " (" + ", ".join(tags) + ")"
    ms = " / ".join(f"{x['ms']:,}" for x in p["compiles"])
    loop = all(c["effectsLoop"]) if c["effectsLoop"] else False
    seam = f"{c['seam']:,} (others {c['stepMin']:,}–{c['stepMax']:,})" if loop else "one-shot"
    title = p["name"].replace("-", " ").capitalize()
    print(f"<tr><td>{title}</td><td>{kind}</td><td>{p['width']}×{p['height']}</td><td>{p['frames']}</td>"
          f"<td>{src:,}</td><td>{ms}</td><td>{c['coloursUsed']} of {c['paletteSize']}</td><td>{seam}</td></tr>")
