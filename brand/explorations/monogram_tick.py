"""AW monograms drawn as one stroke, where the W's last up-stroke becomes a check mark.

Writes brand/aw-tick-*.svg, brand/preview-tick.html and brand/preview-tick-sheet.png.
Geometry is built with Qt's path stroker and path booleans, so each variant is one path
that renders with the evenodd rule (no overlapping subpaths).
"""
import math
import pathlib
import sys

from PySide6.QtCore import QByteArray, QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter, QPainterPath, QPainterPathStroker, QPen
from PySide6.QtSvg import QSvgRenderer

HERE = pathlib.Path(sys.argv[1]).resolve()
app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])


def polyline(points):
    p = QPainterPath(QPointF(*points[0]))
    for x, y in points[1:]:
        p.lineTo(x, y)
    return p


def stroke(path, width, *, join="miter", cap="flat", miter_limit=4.0):
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


def ring(cx, cy, r_outer, width):
    p = QPainterPath()
    p.addEllipse(QPointF(cx, cy), r_outer, r_outer)
    q = QPainterPath()
    q.addEllipse(QPointF(cx, cy), r_outer - width, r_outer - width)
    return p.subtracted(q)


def to_svg(path):
    out, i, n = [], 0, path.elementCount()
    while i < n:
        e = path.elementAt(i)
        t = e.type
        if t == QPainterPath.ElementType.MoveToElement:
            out.append(f"M{e.x:.2f} {e.y:.2f}")
            i += 1
        elif t == QPainterPath.ElementType.LineToElement:
            out.append(f"L{e.x:.2f} {e.y:.2f}")
            i += 1
        elif t == QPainterPath.ElementType.CurveToElement:
            c2, end = path.elementAt(i + 1), path.elementAt(i + 2)
            out.append(f"C{e.x:.2f} {e.y:.2f} {c2.x:.2f} {c2.y:.2f} {end.x:.2f} {end.y:.2f}")
            i += 3
        else:
            i += 1
    return "".join(out).replace("L", " L").replace("C", " C").replace("M", " M").strip() + " Z"


def svg(path, size=32, fill="currentColor"):
    d = to_svg(path)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">'
            f'<path fill="{fill}" fill-rule="evenodd" d="{d}"/></svg>')


def svg_two(ink_path, accent_path, size=32, accent="#8a1c2b"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">'
            f'<path fill="currentColor" fill-rule="evenodd" d="{to_svg(ink_path)}"/>'
            f'<path fill="{accent}" fill-rule="evenodd" d="{to_svg(accent_path)}"/></svg>')


def swallowtail(path, end, prev, width, depth=0.9):
    """Cut a V notch into the stroke end at `end` (the stroke came from `prev`)."""
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


# ---- the letterform ---------------------------------------------------------------
# One zigzag: A left leg up, A right leg down (which is also the W's first stroke),
# W up, W down, W up and on past cap height into the tick. Baseline 27, cap 7.
W_STROKE = 4.0
A_LEFT, APEX, A_RIGHT = (2.5, 27.0), (8.0, 7.0), (13.5, 27.0)
W_PEAK, W_RIGHT = (18.5, 13.0), (23.5, 27.0)
TICK_TIP, CAP_END = (30.0, 3.0), (28.9, 7.0)   # CAP_END: where the last stroke would stop as a plain W


def crossbar(width=W_STROKE, y=19.0):
    t = (A_LEFT[1] - y) / (A_LEFT[1] - APEX[1])
    xl = A_LEFT[0] + (APEX[0] - A_LEFT[0]) * t
    xr = A_RIGHT[0] + (APEX[0] - A_RIGHT[0]) * t
    return stroke(polyline([(xl - 0.6, y), (xr + 0.6, y)]), width)


def zigzag(tip=TICK_TIP, join="miter", cap="flat", width=W_STROKE):
    return stroke(polyline([A_LEFT, APEX, A_RIGHT, W_PEAK, W_RIGHT, tip]), width, join=join, cap=cap)


def ligature(tip=TICK_TIP, join="miter", cap="flat", width=W_STROKE, bar=True):
    p = zigzag(tip, join, cap, width)
    return p.united(crossbar(width)).simplified() if bar else p


def tick_part(path):
    """The part of the figure above cap height: the tick, for the two-tone version."""
    return path.intersected(rect(0, -2, 32, 9.0)).simplified()


variants = []

# 1. the ligature with the tick (miter joins, flat caps)
lig = ligature()
variants.append(("aw-tick-ligature", "Ligature, tick", lig))
# 2. the same with round joins and caps
variants.append(("aw-tick-round", "Ligature, tick, round", ligature(join="round", cap="round")))
# 3. control: the same letterform stopping at cap height (no tick)
variants.append(("aw-tick-none", "Ligature, no tick (control)", ligature(tip=CAP_END)))
# 4. thinner stroke, longer tick
thin = stroke(polyline([A_LEFT, APEX, A_RIGHT, W_PEAK, W_RIGHT, (31.0, 1.5)]), 3.2).united(crossbar(3.2)).simplified()
variants.append(("aw-tick-thin", "Ligature, thin stroke, longer tick", thin))
# 5. ribbon: the tick end cut as a swallowtail, and the A's left foot too
rib = swallowtail(lig, TICK_TIP, W_RIGHT, W_STROKE)
rib = swallowtail(rib, A_LEFT, APEX, W_STROKE)
variants.append(("aw-tick-ribbon", "Ribbon ends (swallowtail cuts)", rib))
# 6. separate A and W, the tick on the W only
sep_a = stroke(polyline([(1.5, 27.0), (6.5, 7.0), (11.5, 27.0)]), 3.6).united(
    stroke(polyline([(3.1, 19.0), (9.9, 19.0)]), 3.6)).simplified()
sep_w = stroke(polyline([(13.5, 7.0), (17.5, 27.0), (21.5, 14.0), (25.5, 27.0), (31.0, 3.0)]), 3.6)
variants.append(("aw-tick-separate", "Separate A and W, tick on the W", sep_a.united(sep_w).simplified()))
# 7. tile: letters knocked out, the tick breaking through the frame
tile = rect(0, 6, 32, 26)
through = tile.subtracted(lig).united(lig.subtracted(tile)).simplified()
variants.append(("aw-tick-tile", "Tile, the tick breaks the frame", through))
# 8. tile, letters knocked out, tick inside (smaller figure)
small = stroke(polyline([(5.0, 25.0), (9.4, 10.0), (13.8, 25.0), (17.8, 14.5), (21.8, 25.0), (27.5, 7.0)]), 3.2)
small = small.united(stroke(polyline([(6.6, 19.0), (12.2, 19.0)]), 3.2)).simplified()
variants.append(("aw-tick-tile-inside", "Tile, tick inside", rect(0, 0, 32, 32).subtracted(small).simplified()))
# 9. watch ring: the figure inside a ring, the tick reaching the ring like a hand
inner = stroke(polyline([(7.0, 23.0), (10.5, 11.0), (14.0, 23.0), (17.2, 14.5), (20.4, 23.0), (25.2, 6.6)]), 2.8)
inner = inner.united(stroke(polyline([(8.3, 18.2), (12.7, 18.2)]), 2.8)).simplified()
variants.append(("aw-tick-ring", "Watch ring, the tick as a hand", ring(16, 16, 15.5, 2.2).united(inner).simplified()))
# 10. the crossbar itself as a small check
bar_tick = stroke(polyline([(4.4, 18.2), (6.9, 21.0), (11.6, 15.4)]), 3.0)
variants.append(("aw-tick-crossbar", "The A's crossbar as a check", zigzag(CAP_END).united(bar_tick).simplified()))

# write the files and the preview
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
two = [("Two-tone: tick in oxblood", lambda s: svg_two(lig.subtracted(tick_part(lig)), tick_part(lig), s)),
       ("Two-tone: tick in emerald", lambda s: svg_two(lig.subtracted(tick_part(lig)), tick_part(lig), s, "#0f7b4f")),
       ("Two-tone: tick in ochre", lambda s: svg_two(lig.subtracted(tick_part(lig)), tick_part(lig), s, "#c8891a"))]
css = """
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#111;background:#fff}.wrap{padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 6px}p{margin:0 0 12px;max-width:72ch}
.row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd;margin:0 0 8px}.cell{padding:16px 18px;display:flex;flex-direction:column;gap:18px}
.cell.dark{background:#15171a;color:#f3f3f3}.cell.light{background:#fff;color:#111}
.sizes{display:flex;align-items:flex-end;gap:14px}.sizes svg{display:block}
.sizes span{display:block;font-size:10px;opacity:.55;text-align:center;margin-top:3px}.cap{font-size:12px;opacity:.75;margin-top:4px}
.lockup{display:inline-flex;align-items:center;gap:9px;font-weight:700;font-size:19px;letter-spacing:-.01em;margin-top:6px}
"""
html = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award Watch: AW with a check</title>',
        f'<style>{css}</style></head><body><div class="wrap"><h1>Award Watch: the AW as one stroke, ending in a check</h1>',
        "<p>The A and the W share a stroke (the A's right leg is the W's first stroke), and the W's last up-stroke "
        "carries on past cap height to become a check mark: awarded. Every variant is one path on the 32-unit "
        "canvas, filled with <code>currentColor</code>, built from a stroked polyline rather than a typeface, so "
        "the letterform is ours. Judge at 16 px first.</p>",
        f'<h2>Variants</h2><div class="row">{cell("light", items)}{cell("dark", items)}</div>',
        f'<h2>Two-tone (header use; the favicon stays one colour)</h2><div class="row">{cell("light", two)}{cell("dark", two)}</div>',
        "</div></body></html>"]
(HERE / "preview-tick.html").write_text("\n".join(html), encoding="utf-8")

# contact sheet
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
sheet.save(str(HERE / "preview-tick-sheet.png"))
print("variants:", [v[0] for v in variants])
print("sheet", W, H)
