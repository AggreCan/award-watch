"""Builds the Award Watch mark from Inter Bold: lowercase "aw", the second v of the w as a check.

The a and the w are Inter Bold's own glyphs (SIL OFL, fonts/Inter-Bold.ttf, the static file
from the Inter release; the variable font's instances keep overlapping contours that leave
notches). The w's last up-stroke is carried on past x-height along its own direction, so the
second v reads as a check mark; a hairline cut along the check's left edge, lying wholly on
the w's side, separates the two; the two-tone version splits on that same edge and fills the
check with the accent.

Run:  python brand/make_mark.py
Writes into brand/: mark.svg (one colour, currentColor, the hairline cut), mark-two-tone.svg
(check in the accent), favicon.svg and favicon-w.svg (two tile candidates), lockup.svg (mark
beside the name), wordmark.svg (the name with the check built into its own "aw"), and
preview-final.html plus preview-final-sheet.png to look at them.
"""
import pathlib
import sys

import numpy as np
from fontTools.ttLib import TTFont
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from PySide6.QtCore import QByteArray, QPointF, QRectF
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter, QPainterPath, QPolygonF, QTransform
from PySide6.QtSvg import QSvgRenderer

HERE = pathlib.Path(__file__).resolve().parent
FONT = HERE / "fonts" / "Inter-Bold.ttf"
ACCENT = "#0f7b4f"      # emerald: the check
INK = "#1b2a41"         # preview ink only; the site uses currentColor
OVERSHOOT = 0.5         # the check rises past x-height by this share of the x-height
GAP = 0.9               # the hairline cut, in canvas units (the canvas is 32 wide)

app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])
PROP = FontProperties(fname=str(FONT))
_FT = TTFont(str(FONT))
_CMAP, _HMTX, _UPM = _FT.getBestCmap(), _FT["hmtx"], _FT["head"].unitsPerEm


def advance(ch):
    return _HMTX[_CMAP[ord(ch)]][0] * 1000 / _UPM


def glyph_polys(ch, x=0.0):
    """The glyph as flattened polygons in font units (y up), placed at x."""
    return [np.asarray(p) for p in TextPath((x, 0), ch, size=1000, prop=PROP).to_polygons()]


def qpath(polys):
    p = QPainterPath()
    for poly in polys:
        p.addPolygon(QPolygonF([QPointF(x, -y) for x, y in poly]))   # y down
        p.closeSubpath()
    return p.simplified()


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


def transform(paths, scale, dx, dy):
    t = QTransform()
    t.translate(dx, dy)
    t.scale(scale, scale)
    return [t.map(p) for p in paths]


def fit(paths, box):
    """Scale and move several paths together so their union fits the box."""
    union = QPainterPath()
    for p in paths:
        union = union.united(p)
    r = union.boundingRect()
    x0, y0, x1, y1 = box
    s = min((x1 - x0) / r.width(), (y1 - y0) / r.height())
    dx = x0 + ((x1 - x0) - r.width() * s) / 2 - r.left() * s
    dy = y0 + ((y1 - y0) - r.height() * s) / 2 - r.top() * s
    return transform(paths, s, dx, dy)


def analyse_w(poly):
    """Key vertices of the w outline (font units, y up)."""
    xs, ys = poly[:, 0], poly[:, 1]
    ymax, ymin, xmin, xmax = ys.max(), ys.min(), xs.min(), xs.max()
    h, w = ymax - ymin, xmax - xmin
    top = poly[ys > ymax - 0.06 * h]
    top = top[np.argsort(top[:, 0])]
    tr2 = top[-1]                                      # outer corner of the right terminal
    right_term = top[top[:, 0] > xmax - 0.22 * w]
    tr1 = right_term[np.argmin(right_term[:, 0])]      # inner corner of the right terminal
    bottom = poly[ys < ymin + 0.06 * h]
    b2 = bottom[np.argmax(bottom[:, 0])]               # outer bottom-right vertex
    mid = poly[(np.abs(xs - (xmin + xmax) / 2) < 0.16 * w) & (ys > ymin + 0.2 * h)]
    u = mid[np.argmin(mid[:, 1])]                      # the notch under the middle peak
    b1 = bottom[np.argmin(bottom[:, 0])]               # outer bottom-left vertex
    second = bottom[bottom[:, 0] > u[0]]
    b2_left = second[np.argmin(second[:, 0])]          # left corner of the second v's bottom
    return tr1, tr2, b2, u, h, b1, b2_left


def check_w(x=0.0):
    """The modified w at x, in font units flipped to y down: (whole with the hairline, w part, check part)."""
    polys = glyph_polys("w", x)
    tr1, tr2, b2, u, xh, b1, b2_left = analyse_w(max(polys, key=len))
    d = tr2 - b2
    d = d / np.linalg.norm(d)
    E = OVERSHOOT * xh / d[1]
    ext = np.array([tr1, tr2, tr2 + d * E, tr1 + d * E])
    whole = qpath(polys).united(qpath([ext])).simplified()
    # The cut runs along the glyph's own edge from the second v's bottom corner
    # through the notch and out the top; the sliver sits on the w's side only.
    v = u - b2_left
    v = v / np.linalg.norm(v)
    n = np.array([-v[1], v[0]])
    if np.dot(b1 - u, n) < 0:
        n = -n
    L = 4000.0
    cut_w = GAP * (xh / 20.0)
    sliver = np.array([u, u + n * cut_w, u + n * cut_w + v * L, u + v * L])
    cut = whole.subtracted(qpath([sliver])).simplified()
    p = u + n * 0.5
    left = qpath([np.array([p - v * L, p + v * L, p + v * L + n * L, p - v * L + n * L])])
    return cut, cut.intersected(left).simplified(), cut.subtracted(left).simplified()


def svg_doc(parts, fills, view, size_attr=True):
    vw, vh = view
    body = "\n".join(f'  <path fill="{f}" fill-rule="evenodd" d="{to_svg(p)}"/>' for p, f in zip(parts, fills))
    wh = f' width="{vw}" height="{vh}"' if size_attr else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}"{wh}>\n{body}\n</svg>\n'


# ---- the mark on the 32 canvas -------------------------------------------------------
a_path = qpath(glyph_polys("a"))
w_cut, w_left, w_right = check_w(advance("a"))
a32, cut32, left32, right32 = fit([a_path, w_cut, w_left, w_right], (0.5, 1.0, 31.5, 31.0))
(HERE / "mark.svg").write_text(svg_doc([a32, cut32], ["currentColor", "currentColor"], (32, 32)), encoding="utf-8")
(HERE / "mark-two-tone.svg").write_text(svg_doc([a32, left32, right32], ["currentColor", "currentColor", ACCENT], (32, 32)), encoding="utf-8")

# ---- favicon candidates: a white tile, the mark inside; and the w alone, larger -------
tile = QPainterPath()
tile.addRoundedRect(QRectF(0, 0, 64, 64), 12, 12)
fa, fl, fr = fit([a_path, w_left, w_right], (5, 14, 59, 50))
(HERE / "favicon.svg").write_text(svg_doc([tile, fa, fl, fr], ["#ffffff", INK, INK, ACCENT], (64, 64)), encoding="utf-8")
gl, gr = fit([w_left, w_right], (8, 8, 56, 56))
(HERE / "favicon-w.svg").write_text(svg_doc([tile, gl, gr], ["#ffffff", INK, ACCENT], (64, 64)), encoding="utf-8")

# ---- the wordmark: "award watch" with the check built into its own aw -----------------
text = "award watch"
x, parts, fills = 0.0, [], []
for i, ch in enumerate(text):
    if ch == " ":
        x += advance(ch)
        continue
    if i == 1:
        _, wl, wr = check_w(x)
        parts += [wl, wr]
        fills += ["currentColor", ACCENT]
    else:
        parts.append(qpath(glyph_polys(ch, x)))
        fills.append("currentColor")
    x += advance(ch)
union = QPainterPath()
for p in parts:
    union = union.united(p)
r = union.boundingRect()
s = 32.0 / r.height()
word = transform(parts, s, -r.left() * s + 1, -r.top() * s + 1)
WW, WH = int(r.width() * s) + 2, 34
(HERE / "wordmark.svg").write_text(svg_doc(word, fills, (WW, WH)), encoding="utf-8")

# ---- the lockup: the mark, then the name in Inter Bold as live-text-free paths --------
name_parts, x = [], 0.0
for ch in "Award Watch":
    if ch != " ":
        name_parts.append(qpath(glyph_polys(ch, x)))
    x += advance(ch)
nu = QPainterPath()
for p in name_parts:
    nu = nu.united(p)
nr = nu.boundingRect()
ns = 18.0 / nr.height()
name = transform(name_parts, ns, 40 - nr.left() * ns, 7 - nr.top() * ns)
LW = int(40 + nr.width() * ns) + 2
(HERE / "lockup.svg").write_text(
    svg_doc([a32, left32, right32] + name, ["currentColor", "currentColor", ACCENT] + ["currentColor"] * len(name), (LW, 32)),
    encoding="utf-8")

# ---- preview page and sheet ------------------------------------------------------------
def inline(name, size=None, h=None):
    s = (HERE / name).read_text(encoding="utf-8")
    if size:
        s = s.replace(f'width="{s.split("width=")[1].split()[0][1:-1]}"', f'width="{size}"', 1) if False else s
    return s


def show(name, w, h):
    svg = (HERE / name).read_text(encoding="utf-8").split("\n", 1)
    head = svg[0].split(" width=")[0] + f' width="{w}" height="{h}">'
    return head + "\n" + svg[1]


SIZES = (16, 24, 32, 64, 128)
rows = []
for label, fname in (("mark.svg (one colour)", "mark.svg"), ("mark-two-tone.svg", "mark-two-tone.svg"),
                     ("favicon.svg", "favicon.svg"), ("favicon-w.svg", "favicon-w.svg")):
    cells = "".join(f"<div>{show(fname, s, s)}<span>{s}</span></div>" for s in SIZES)
    rows.append(f'<div class="item"><div class="sizes">{cells}</div><div class="cap">{label}</div>'
                f'<span class="tab">{show(fname, 16, 16)} Award Watch</span></div>')
wordmark_row = f'<div class="item">{show("wordmark.svg", WW * 4, WH * 4)}<div class="cap">wordmark.svg (the check inside the name)</div>{show("wordmark.svg", WW, WH)}</div>'
lockup_row = f'<div class="item">{show("lockup.svg", LW * 3, 96)}<div class="cap">lockup.svg</div>{show("lockup.svg", LW, 32)}</div>'
cell_body = "".join(rows) + wordmark_row + lockup_row
css = """
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#111;background:#fff}.wrap{padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 12px;max-width:72ch}
.row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd}.cell{padding:16px 18px;display:flex;flex-direction:column;gap:22px}
.cell.dark{background:#15171a;color:#f3f3f3}.cell.light{background:#fff;color:#1b2a41}
.sizes{display:flex;align-items:flex-end;gap:14px}.sizes svg{display:block}.sizes span{display:block;font-size:10px;opacity:.55;text-align:center;margin-top:3px}
.cap{font-size:12px;opacity:.75;margin:4px 0}.tab{display:inline-block;padding:7px 8px;background:#e9eaec;color:#111;border-radius:6px 6px 0 0;font-size:12px}
.tab svg{vertical-align:-3px;margin-right:4px}.dark .tab{background:#2b2e33;color:#eee}
"""
html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award Watch: the mark</title>'
        f'<style>{css}</style></head><body><div class="wrap"><h1>Award Watch: the mark</h1>'
        f'<p>Inter Bold, lowercase, the second v of the w as a check in emerald {ACCENT}. One colour for the '
        'favicon and anywhere a single colour is needed; two-tone for the header. Regenerate with '
        '<code>python brand/make_mark.py</code>.</p>'
        f'<div class="row"><div class="cell light">{cell_body}</div><div class="cell dark">{cell_body}</div></div>'
        '</div></body></html>')
(HERE / "preview-final.html").write_text(html, encoding="utf-8")

sheet = QImage(900, 560, QImage.Format_ARGB32)
sheet.fill(QColor("#ffffff"))
qp = QPainter(sheet)
qp.fillRect(450, 0, 450, 560, QColor("#15171a"))
for col, (ink) in enumerate((INK, "#f3f3f3")):
    y = 16
    for fname in ("mark.svg", "mark-two-tone.svg", "favicon.svg", "favicon-w.svg"):
        r = QSvgRenderer(QByteArray((HERE / fname).read_text(encoding="utf-8").replace("currentColor", ink).encode()))
        x = 450 * col + 16
        for s in (16, 24, 32, 64, 96):
            r.render(qp, QRectF(x, y + (96 - s), s, s)); x += s + 12
        y += 108
    r = QSvgRenderer(QByteArray((HERE / "wordmark.svg").read_text(encoding="utf-8").replace("currentColor", ink).encode()))
    r.render(qp, QRectF(450 * col + 16, y, WW * 2.2, WH * 2.2))
    r = QSvgRenderer(QByteArray((HERE / "lockup.svg").read_text(encoding="utf-8").replace("currentColor", ink).encode()))
    r.render(qp, QRectF(450 * col + 16, y + 60, LW * 1.6, 32 * 1.6))
qp.end()
sheet.save(str(HERE / "preview-final-sheet.png"))
print("wrote mark.svg mark-two-tone.svg favicon.svg favicon-w.svg wordmark.svg lockup.svg preview-final.html")
