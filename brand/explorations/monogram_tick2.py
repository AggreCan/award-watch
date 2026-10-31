"""AW monograms drawn as one stroke, the W's last up-stroke kinking into a check mark (second pass).

Writes brand/aw-check-*.svg, brand/preview-check.html and brand/preview-check-sheet.png.
"""
import math
import pathlib
import sys

from PySide6.QtCore import QByteArray, QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter, QPainterPath, QPainterPathStroker, QTransform
from PySide6.QtSvg import QSvgRenderer

HERE = pathlib.Path(sys.argv[1]).resolve()
app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])


def polyline(points):
    p = QPainterPath(QPointF(*points[0]))
    for x, y in points[1:]:
        p.lineTo(x, y)
    return p


def stroke(path, width, *, join="miter", cap="flat", miter_limit=1.0):
    s = QPainterPathStroker()
    s.setWidth(width)
    s.setJoinStyle({"miter": Qt.PenJoinStyle.MiterJoin, "round": Qt.PenJoinStyle.RoundJoin, "bevel": Qt.PenJoinStyle.BevelJoin}[join])
    s.setCapStyle({"flat": Qt.PenCapStyle.FlatCap, "round": Qt.PenCapStyle.RoundCap, "square": Qt.PenCapStyle.SquareCap}[cap])
    s.setMiterLimit(miter_limit)
    return s.createStroke(path).simplified()


def rect(x, y, w, h):
    p = QPainterPath()
    p.addRect(QRectF(x, y, w, h))
    return p


def to_svg(path):
    out, i, n = [], 0, path.elementCount()
    while i < n:
        e = path.elementAt(i)
        t = e.type
        if t == QPainterPath.ElementType.MoveToElement:
            out.append(f"M{e.x:.2f} {e.y:.2f}"); i += 1
        elif t == QPainterPath.ElementType.LineToElement:
            out.append(f"L{e.x:.2f} {e.y:.2f}"); i += 1
        elif t == QPainterPath.ElementType.CurveToElement:
            c2, end = path.elementAt(i + 1), path.elementAt(i + 2)
            out.append(f"C{e.x:.2f} {e.y:.2f} {c2.x:.2f} {c2.y:.2f} {end.x:.2f} {end.y:.2f}"); i += 3
        else:
            i += 1
    return " ".join(out) + " Z"


def svg(path, size=32, fill="currentColor"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">'
            f'<path fill="{fill}" fill-rule="evenodd" d="{to_svg(path)}"/></svg>')


def svg_two(ink_path, accent_path, size=32, accent="#8a1c2b"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">'
            f'<path fill="currentColor" fill-rule="evenodd" d="{to_svg(ink_path)}"/>'
            f'<path fill="{accent}" fill-rule="evenodd" d="{to_svg(accent_path)}"/></svg>')


def swallowtail(path, end, prev, width, depth=0.9):
    dx, dy = end[0] - prev[0], end[1] - prev[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    h = width / 2 + 0.3
    tri = polyline([(end[0] + nx * h + ux * 0.3, end[1] + ny * h + uy * 0.3),
                    (end[0] - nx * h + ux * 0.3, end[1] - ny * h + uy * 0.3),
                    (end[0] - ux * width * depth, end[1] - uy * width * depth)])
    tri.closeSubpath()
    return path.subtracted(tri)


def moved(path, scale, dx, dy):
    t = QTransform()
    t.translate(dx, dy)
    t.scale(scale, scale)
    return t.map(path)


# ---- geometry (canvas 32; baseline 27, cap 7) ----------------------------------------
# All strokes rise at slope 3 (20 units up for 6.67 across) except the tick's tail.
BASE, CAP = 27.0, 7.0
A_LEFT, APEX, A_RIGHT = (2.0, BASE), (8.0, CAP), (14.0, BASE)
W_PEAK = (18.5, 13.5)
W_RIGHT = (23.0, BASE)
CAP_END = (W_RIGHT[0] + (BASE - CAP) / 3.0, CAP)          # (29.67, 7): a plain W's last top
STRAIGHT_TIP = (W_RIGHT[0] + (BASE - 2.0) / 3.0, 2.0)      # the same stroke carried on to y = 2
KINK_TIP = (31.6, 1.8)                                      # the tail bends outward above cap height
BAR_Y = 20.5


def crossbar(width, y=BAR_Y, left=A_LEFT, apex=APEX, right=A_RIGHT):
    t = (left[1] - y) / (left[1] - apex[1])
    xl = left[0] + (apex[0] - left[0]) * t
    xr = right[0] + (apex[0] - right[0]) * t
    return stroke(polyline([(xl - 0.5, y), (xr + 0.5, y)]), width)


def figure(tail="kink", width=4.0, join="miter", cap="flat"):
    pts = [A_LEFT, APEX, A_RIGHT, W_PEAK, W_RIGHT]
    if tail == "none":
        pts.append(CAP_END)
    elif tail == "straight":
        pts.append(STRAIGHT_TIP)
    else:
        pts += [CAP_END, KINK_TIP]
    return stroke(polyline(pts), width, join=join, cap=cap).united(crossbar(width)).simplified()


def tick_part(path):
    """What rises above cap height: the tick, for the two-tone version."""
    return path.intersected(rect(0, -2, 32, CAP + 2.0 - 0.01)).simplified()


variants = []
kink = figure("kink")
variants.append(("aw-check-kink", "Ligature, kinked tail (the check)", kink))
variants.append(("aw-check-straight", "Ligature, straight tail", figure("straight")))
variants.append(("aw-check-round", "Ligature, kinked, round joins", figure("kink", join="round", cap="round")))
variants.append(("aw-check-thin", "Ligature, kinked, thin stroke", figure("kink", width=3.2)))
variants.append(("aw-check-none", "Control: no tail", figure("none")))
rib = swallowtail(kink, KINK_TIP, CAP_END, 4.0)
rib = swallowtail(rib, A_LEFT, APEX, 4.0)
variants.append(("aw-check-ribbon", "Kinked, ribbon ends", rib))
# separate letters: A, then a W whose last stroke kinks
sa = stroke(polyline([(1.0, BASE), (6.0, CAP), (11.0, BASE)]), 3.6).united(
    crossbar(3.6, left=(1.0, BASE), apex=(6.0, CAP), right=(11.0, BASE))).simplified()
sw = stroke(polyline([(13.0, CAP), (17.0, BASE), (21.0, 14.0), (25.0, BASE), (28.6, 9.0), (31.6, 2.6)]), 3.6)
variants.append(("aw-check-separate", "Separate A and W, kinked tail on the W", sa.united(sw).simplified()))
# tile: the figure scaled into the lower part of a square, the tail breaking the frame
small = moved(kink, 0.84, 1.6, 7.0)                 # cap at y = 12.9, baseline at 29.7, tail tip at y = 8.5
tile = rect(0, 13.6, 32, 18.4)
variants.append(("aw-check-tile", "Tile, the tail breaks the frame", tile.subtracted(small).united(small.subtracted(tile)).simplified()))
# tile, full square, figure inside with the tail reaching the top edge
inside = moved(kink, 0.86, 1.8, 3.0)
variants.append(("aw-check-tile-inside", "Tile, tail inside", rect(0, 0, 32, 32).subtracted(inside).simplified()))
# wide: the figure stretched across a 32 by 20 band for header use, shown here letterboxed
variants.append(("aw-check-wide", "Lockup proportion (letterboxed)", moved(kink, 1.0, 0.0, 0.0)))

for name, label, path in variants:
    (HERE / f"{name}.svg").write_text(svg(path).replace("><path", ">\n  <path").replace("</svg>", "\n</svg>\n"), encoding="utf-8")

SIZES = (16, 24, 32, 64, 128)


def cell(theme, items):
    parts = []
    for label, maker in items:
        sizes = "".join(f"<div>{maker(s)}<span>{s}</span></div>" for s in SIZES)
        parts.append(f'<div class="item"><div class="sizes">{sizes}</div><div class="cap">{label}</div>'
                     f'<div class="lockup">{maker(26)}<span>Award Watch</span></div></div>')
    return f'<div class="cell {theme}">{"".join(parts)}</div>'


items = [(label, (lambda s, p=path: svg(p, s))) for _, label, path in variants]
body_ink = kink.subtracted(tick_part(kink))
tick = tick_part(kink)
tile_ink = tile.subtracted(small)
tile_nub = small.subtracted(tile)
two = [("Tail in oxblood", lambda s: svg_two(body_ink, tick, s)),
       ("Tail in emerald", lambda s: svg_two(body_ink, tick, s, "#0f7b4f")),
       ("Tail in ochre", lambda s: svg_two(body_ink, tick, s, "#c8891a")),
       ("Tile, nub in oxblood", lambda s: svg_two(tile_ink, tile_nub, s)),
       ("Tile, nub in emerald", lambda s: svg_two(tile_ink, tile_nub, s, "#0f7b4f"))]
css = """
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#111;background:#fff}.wrap{padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 6px}p{margin:0 0 12px;max-width:72ch}
.row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd;margin:0 0 8px}.cell{padding:16px 18px;display:flex;flex-direction:column;gap:18px}
.cell.dark{background:#15171a;color:#f3f3f3}.cell.light{background:#fff;color:#111}
.sizes{display:flex;align-items:flex-end;gap:14px}.sizes svg{display:block}
.sizes span{display:block;font-size:10px;opacity:.55;text-align:center;margin-top:3px}.cap{font-size:12px;opacity:.75;margin-top:4px}
.lockup{display:inline-flex;align-items:center;gap:9px;font-weight:700;font-size:19px;letter-spacing:-.01em;margin-top:6px}
"""
html = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award Watch: AW with a check, second pass</title>',
        f'<style>{css}</style></head><body><div class="wrap"><h1>Award Watch: the AW as one stroke, the tail kinking into a check</h1>',
        "<p>Second pass. The A's right leg is the W's first stroke; the W's last up-stroke reaches cap height and "
        "then bends outward into the tail of a check mark. Every variant is one path filled with "
        "<code>currentColor</code>, drawn from a stroked polyline, so the letterform is ours. Judge at 16 px first.</p>",
        f'<h2>Variants</h2><div class="row">{cell("light", items)}{cell("dark", items)}</div>',
        f'<h2>Two-tone (header use; the favicon stays one colour)</h2><div class="row">{cell("light", two)}{cell("dark", two)}</div>',
        "</div></body></html>"]
(HERE / "preview-check.html").write_text("\n".join(html), encoding="utf-8")

pad, sizes = 14, (16, 24, 32, 64, 128)
W = pad + sum(s + pad for s in sizes) + 10
H = (128 + pad) * len(variants) * 2 + pad
sheet = QImage(W, H, QImage.Format_ARGB32)
sheet.fill(QColor("#ffffff"))
qp = QPainter(sheet)
y = pad
for theme, bg, fg in (("light", "#ffffff", "#1b2a41"), ("dark", "#15171a", "#f3f3f3")):
    for name, label, path in variants:
        r = QSvgRenderer(QByteArray(svg(path, fill=fg).encode()))
        qp.fillRect(0, y - pad // 2, W, 128 + pad, QColor(bg))
        x = pad
        for s in sizes:
            r.render(qp, QRectF(x, y + (128 - s), s, s))
            x += s + pad
        qp.setPen(QColor(fg))
        qp.drawText(QRectF(pad, y, W, 14), label)
        y += 128 + pad
qp.end()
sheet.save(str(HERE / "preview-check-sheet.png"))
print("variants:", [v[0] for v in variants], "sheet", W, H)
