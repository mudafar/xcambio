"""Outline text set in Space Grotesk Bold as SVG path data, so icons do not depend on installed fonts.

Usage: python3 scripts/text-to-path.py fonts/space-grotesk-latin-wght-normal.woff2 '{"bs": ["Bs", 19, 9, 30]}'
(each entry: text, font size, x, baseline y, in the icon viewBox units). Needs: pip install fonttools brotli
"""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font = TTFont(sys.argv[1])
font = instancer.instantiateVariableFont(font, {"wght": 700})
gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
upm = font["head"].unitsPerEm

def text_path(text, size, x, y, anchor="start"):
    scale = size / upm
    width = sum(hmtx[cmap[ord(c)]][0] for c in text) * scale
    if anchor == "middle":
        x -= width / 2
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    cursor = 0
    for c in text:
        name = cmap[ord(c)]
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + cursor * scale, y)))
        cursor += hmtx[name][0]
    return pen.getCommands(), width

out = {}
for key, (text, size, x, y) in json.loads(sys.argv[2]).items():
    out[key] = text_path(text, size, x, y)[0]
print(json.dumps(out))
