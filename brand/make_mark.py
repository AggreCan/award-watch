"""Builds the Award Watch mark from Inter Bold: lowercase "aw", the second v of the w drawn as a tick.

The a and the w are Inter Bold's own glyphs (SIL OFL, fonts/Inter-Bold.ttf, the static file
from the Inter release; the variable font's instances keep overlapping contours that leave
notches). The w's first v and its middle peak stay as Inter draws them. The second v becomes
the tick: its short down-stroke is cut straight across at half x-height, it turns on a rounded
joint that sits on the baseline, and its long up-stroke is carried on past x-height, turning
outward and tapering as it rises, to end in Inter's flat cut parallel to the baseline. A
hairline across the down-stroke, lying wholly on the w's side of the cut, separates the tick
from the w; the two-tone version fills the tick with the accent.

The tick is swept with a round brush (a chain of capsules) along a centreline that starts on
the stroke edges fitted to the glyph's own outline, so it keeps Inter's stroke width and angle,
and the rounded joint and the taper stay a true stroke outline. Every other letter is the
glyph unchanged.

Run:  python brand/make_mark.py
Writes into brand/: mark.svg (one colour, currentColor, the hairline cut), mark-two-tone.svg
(tick in the accent), favicon.svg and favicon-w.svg (two tile candidates), lockup.svg (mark
beside the name), wordmark.svg (the name with the tick built into its own "aw"), and
preview-final.html plus preview-final-sheet.png to look at them.
"""
import math
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
ACCENT = "#0f7b4f"      # emerald: the tick
INK = "#1b2a41"         # preview ink only; the site uses currentColor
CROSS_H = 0.5           # the tick's short down-stroke is cut straight across at this share of the x-height
FLARE = 26              # degrees the long stroke turns outward as it rises, so the tick opens like a written one
STRAIGHT = 0.4          # x-heights the long stroke runs straight on from the joint before it starts to turn
TAPER = 0.75            # the long stroke's width at its tip, as a share of its width at the joint
TOP = 1.5               # the tip's flat cut, in x-heights above the baseline
GAP = 0.9               # the hairline cut, in canvas units (the canvas is 32 wide)
DIP = 0.012             # the rounded joint dips this share of the x-height below the baseline, as round letters do
SIMPLIFY = 0.01         # the tick's outline keeps every point that matters to a hundredth of an output unit

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


def poly_path(points):
    """A polygon already in y-down coordinates."""
    p = QPainterPath()
    p.addPolygon(QPolygonF([QPointF(float(x), float(y)) for x, y in points]))
    p.closeSubpath()
    return p


def merge(paths):
    u = QPainterPath()
    for p in paths:
        u = u.united(p)
    return u.simplified()


def halfplane(p, normal, big=6000.0):
    """The half-plane of points q with (q - p) . normal >= 0, as a large square."""
    normal = normal / np.linalg.norm(normal)
    t = np.array([-normal[1], normal[0]])
    return poly_path(np.array([p - t * big, p + t * big, p + t * big + normal * big, p - t * big + normal * big]))


# ---- the w's strokes, measured from its outline -------------------------------------
# Coordinates from here on are font units at size 1000 with y down: the baseline is y = 0
# and x-height is y = -XH. A stroke edge is a line x = a + b * y, kept as (a, b).

def subpolys(path):
    return [np.array([(p.x(), p.y()) for p in poly]) for poly in path.toSubpathPolygons()]


def scan(polys, y):
    """Where a horizontal line at y crosses the outline: the (left, right) of each stroke it meets."""
    xs = []
    for P in polys:
        for (x0, y0), (x1, y1) in zip(P, np.roll(P, -1, axis=0)):
            if (y0 <= y < y1) or (y1 <= y < y0):
                xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]


def fit_edge(polys, ys, idx, side, count=None):
    """A straight line fitted to one edge of one stroke over the heights ys."""
    pts = []
    for y in ys:
        iv = scan(polys, y)
        if count is not None and len(iv) != count:
            continue
        if -len(iv) <= idx < len(iv):
            pts.append((y, iv[idx][side]))
    pts = np.array(pts)
    b, a = np.polyfit(pts[:, 0], pts[:, 1], 1)
    return a, b


def line_x(line, y):
    return line[0] + line[1] * y


XH = -qpath(glyph_polys("x")).boundingRect().top()


def analyse_w(w):
    """The edges of the w's four strokes s1 to s4, fitted where a scanline crosses all four
    (between the second v's crotch and the notch under the middle peak), and the last
    up-stroke's own edges over its straight run."""
    polys = subpolys(w)
    hs = np.linspace(0.02, 0.98, 240)
    four = [h for h in hs if len(scan(polys, -h * XH)) == 4]
    lo, hi, m = min(four), max(four), 0.04
    ys = -np.linspace(lo + m, hi - m, 30) * XH
    ys4 = -np.linspace(max(0.22, lo + m), 0.62, 30) * XH
    return dict(s2R=fit_edge(polys, ys, 1, 1, 4), s3L=fit_edge(polys, ys, 2, 0, 4), s3R=fit_edge(polys, ys, 2, 1, 4),
                s4L=fit_edge(polys, ys4, -1, 0), s4R=fit_edge(polys, ys4, -1, 1))


def stroke_frame(lineL, lineR, h):
    """A stroke's centre, upward direction and width at h x-heights, from its two edges."""
    y = -h * XH
    pl, pr = np.array([line_x(lineL, y), y]), np.array([line_x(lineR, y), y])
    dl, dr = np.array([-lineL[1], -1.0]), np.array([-lineR[1], -1.0])
    d = dl / np.linalg.norm(dl) + dr / np.linalg.norm(dr)
    d /= np.linalg.norm(d)
    n = np.array([-d[1], d[0]])
    return (pl + pr) / 2, d, abs(np.dot(pr - pl, n))


# ---- the brush the tick is drawn with --------------------------------------------------
def capsule(c1, r1, c2, r2):
    """The hull of two circles: one link of a brush stroke whose width may change."""
    d = np.linalg.norm(c2 - c1)
    if d < 1e-6:
        return None
    u = (c2 - c1) / d
    n = np.array([-u[1], u[0]])
    s = max(-0.999, min(0.999, (r1 - r2) / d))
    cb = math.sqrt(1 - s * s)
    m1, m2 = n * cb + u * s, -n * cb + u * s
    return np.array([c1 + r1 * m1, c2 + r2 * m1, c2 + r2 * m2, c1 + r1 * m2])


def brush(points, radii):
    """A round brush swept along the centreline: capsules between the points, circles on them."""
    parts = []
    for i in range(len(points) - 1):
        q = capsule(points[i], radii[i], points[i + 1], radii[i + 1])
        if q is not None:
            parts.append(poly_path(q))
    t = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    for p, r in zip(points, radii):
        parts.append(poly_path(np.stack([p[0] + r * np.cos(t), p[1] + r * np.sin(t)], 1)))
    return merge(parts)


def flared(start, d, straight, end_h, step=4.0):
    """Centreline from start: straight along d for `straight` units, then an arc turning outward
    by FLARE degrees until it reaches end_h x-heights."""
    n = max(2, int(straight / step))
    pts = [start + d * straight * i / n for i in range(n + 1)]
    p = pts[-1]
    th0 = math.atan2(-d[1], d[0])
    th1 = th0 - math.radians(FLARE)
    R = (p[1] + end_h * XH) / (math.cos(th1) - math.cos(th0))
    m = max(8, int(R * math.radians(FLARE) / step))
    for i in range(1, m + 1):
        th = th0 - (th0 - th1) * i / m
        pts.append(np.array([p[0] + R * (math.sin(th0) - math.sin(th)), p[1] - R * (math.cos(th) - math.cos(th0))]))
    return np.array(pts)


def tick_w(x=0.0):
    """The w at x with its second v redrawn as the tick, in font units, y down:
    (the whole with the hairline, the w part, the tick)."""
    w = qpath(glyph_polys("w", x))
    A = analyse_w(w)
    s3L, s3R, s4L = A["s3L"], A["s3R"], A["s4L"]
    mid3 = ((s3L[0] + s3R[0]) / 2, (s3L[1] + s3R[1]) / 2)          # the down-stroke's centreline
    d3 = np.array([mid3[1], 1.0])
    d3 /= np.linalg.norm(d3)                                          # down along it
    n3 = np.array([-d3[1], d3[0]])
    y0 = -0.5 * XH
    W3 = abs(np.dot(np.array([line_x(s3R, y0) - line_x(s3L, y0), 0.0]), n3))
    c4, d4, W4 = stroke_frame(s4L, A["s4R"], 0.5)                     # d4: up along the long stroke
    Wm = (W3 + W4) / 2
    # The two centrelines meet below the baseline (Inter's v has a flat foot). The joint is the
    # arc tangent to both whose outer edge dips DIP below the baseline.
    p3 = np.array([line_x(mid3, 0.0), 0.0])
    t = np.linalg.solve(np.array([d3, -d4]).T, c4 - p3)
    B = p3 + d3 * t[0]
    up3 = -d3
    alpha = math.acos(max(-1.0, min(1.0, float(np.dot(up3, d4)))))
    s = math.sin(alpha / 2)
    bis = (up3 + d4) / np.linalg.norm(up3 + d4)
    r = max(0.15 * Wm, (DIP * XH - Wm / 2 - B[1]) / (1 + bis[1] / s))
    centre = B + bis * r / s
    tl = r / math.tan(alpha / 2)
    T3, T4 = B + up3 * tl, B + d4 * tl
    # Centreline: from above the cut down the short stroke, round the joint, up the long stroke.
    y_c = -CROSS_H * XH
    S = np.array([line_x(mid3, y_c), y_c]) - d3 * Wm
    pts = [S + (T3 - S) * i / 30 for i in range(31)]
    radii = [W3 / 2] * 31
    a0 = math.atan2(T3[1] - centre[1], T3[0] - centre[0])
    a1 = math.atan2(T4[1] - centre[1], T4[0] - centre[0])
    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi                 # the short way, through the foot
    for i in range(1, 25):
        a = a0 + da * i / 24
        pts.append(centre + r * np.array([math.cos(a), math.sin(a)]))
        radii.append(W3 / 2 + (W4 - W3) / 2 * i / 24)
    tail = flared(T4, d4, STRAIGHT * XH, TOP + 0.2)
    pts += list(tail[1:])
    radii += [W4 / 2] * (len(tail) - 1)
    pts, radii = np.array(pts), np.array(radii)
    k = len(tail) - 1
    radii[-k:] = (W4 / 2) * (1 - (1 - TAPER) * np.linspace(0, 1, k) ** 2)
    tick = brush(pts, radii).intersected(halfplane(np.array([0.0, -TOP * XH]), np.array([0.0, 1.0])))
    # What stays ink: everything left of the down-stroke's left edge (moved a little further left,
    # so the glyph's own edge, a fraction off the fitted line, cannot leave a thread of ink across
    # the hairline, though never more than 40 % of the counter beside it), plus everything above
    # the cut and its hairline that lies left of the middle of the counter inside the second v.
    p = np.array([line_x(mid3, y_c), y_c])
    gap = GAP * (XH / 20.0)
    margin = max(0.0, min(0.03 * XH, 0.4 * (line_x(s3L, y_c) - line_x(A["s2R"], y_c))))
    left = halfplane(np.array([line_x(s3L, y_c) - margin, y_c]), np.array([-1.0, s3L[1]]))
    above = halfplane(p - d3 * gap, -d3)
    ya, yb = y_c, y_c - 2 * XH
    qa = np.array([(line_x(s3R, ya) + line_x(s4L, ya)) / 2, ya])
    qb = np.array([(line_x(s3R, yb) + line_x(s4L, yb)) / 2, yb])
    tc = (qb - qa) / np.linalg.norm(qb - qa)
    nc = np.array([-tc[1], tc[0]])
    if nc[0] > 0:
        nc = -nc
    counter_left = halfplane(qa, nc)
    ink = w.intersected(left.united(above.intersected(counter_left)))
    tick = tick.subtracted(halfplane(p, -d3).intersected(counter_left))
    return ink.united(tick), ink, tick


def rdp(pts, tol):
    """Ramer-Douglas-Peucker on an open polyline: drops points within tol of the line kept."""
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = q - p
        L2 = float(seg @ seg)
        mid = pts[a + 1:b]
        if L2 == 0:
            dist = np.linalg.norm(mid - p, axis=1)
        else:
            dist = np.abs(seg[0] * (mid[:, 1] - p[1]) - seg[1] * (mid[:, 0] - p[0])) / np.sqrt(L2)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            k += a + 1
            keep[k] = True
            stack += [(a, k), (k, b)]
    return pts[keep]


def to_svg_simplified(path):
    """The tick's outline: the brush leaves a point every few units along every arc, so the
    points that change nothing at the output's scale are dropped."""
    out = []
    for poly in path.toSubpathPolygons():
        pts = np.array([(q.x(), q.y()) for q in poly])
        if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            continue
        kept = rdp(np.vstack([pts, pts[:1]]), SIMPLIFY)[:-1]
        if len(kept) >= 3:
            out.append("M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in kept) + " Z")
    return " ".join(out)


def svg_doc(parts, fills, view, size_attr=True, ticks=()):
    """ticks: the indexes of the parts drawn with the brush, written simplified."""
    vw, vh = view
    body = "\n".join(f'  <path fill="{f}" fill-rule="evenodd" d="{to_svg_simplified(p) if i in ticks else to_svg(p)}"/>'
                     for i, (p, f) in enumerate(zip(parts, fills)))
    wh = f' width="{vw}" height="{vh}"' if size_attr else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}"{wh}>\n{body}\n</svg>\n'


# ---- the mark on the 32 canvas -------------------------------------------------------
a_path = qpath(glyph_polys("a"))
w_cut, w_left, w_right = tick_w(advance("a"))
a32, cut32, left32, right32 = fit([a_path, w_cut, w_left, w_right], (0.5, 1.0, 31.5, 31.0))
(HERE / "mark.svg").write_text(svg_doc([a32, cut32], ["currentColor", "currentColor"], (32, 32), ticks={1}), encoding="utf-8")
(HERE / "mark-two-tone.svg").write_text(svg_doc([a32, left32, right32], ["currentColor", "currentColor", ACCENT], (32, 32), ticks={2}), encoding="utf-8")

# ---- favicon candidates: a white tile, the mark inside; and the w alone, larger -------
tile = QPainterPath()
tile.addRoundedRect(QRectF(0, 0, 64, 64), 12, 12)
fa, fl, fr = fit([a_path, w_left, w_right], (5, 14, 59, 50))
(HERE / "favicon.svg").write_text(svg_doc([tile, fa, fl, fr], ["#ffffff", INK, INK, ACCENT], (64, 64), ticks={3}), encoding="utf-8")
gl, gr = fit([w_left, w_right], (8, 8, 56, 56))
(HERE / "favicon-w.svg").write_text(svg_doc([tile, gl, gr], ["#ffffff", INK, ACCENT], (64, 64), ticks={2}), encoding="utf-8")

# ---- the wordmark: "award watch" with the tick built into its own aw ------------------
text = "award watch"
x, parts, fills = 0.0, [], []
for i, ch in enumerate(text):
    if ch == " ":
        x += advance(ch)
        continue
    if i == 1:
        _, wl, wr = tick_w(x)
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
(HERE / "wordmark.svg").write_text(svg_doc(word, fills, (WW, WH), ticks={fills.index(ACCENT)}), encoding="utf-8")

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
    svg_doc([a32, left32, right32] + name, ["currentColor", "currentColor", ACCENT] + ["currentColor"] * len(name), (LW, 32),
            ticks={2}),
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
wordmark_row = f'<div class="item">{show("wordmark.svg", WW * 4, WH * 4)}<div class="cap">wordmark.svg (the tick inside the name)</div>{show("wordmark.svg", WW, WH)}</div>'
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
        f'<p>Inter Bold, lowercase, the second v of the w redrawn as a tick in emerald {ACCENT}. One colour for the '
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
