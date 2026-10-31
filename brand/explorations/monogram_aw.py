"""Lowercase "aw" from straight-edged sans faces, the w's second v turned into a check mark.

For each face: the a and the w are the font's glyphs; the w's last up-stroke is extended past
x-height along its own direction; a hairline cut from the inner notch under the middle peak
up through the top separates the first v (the w) from the second v (the check); the second
v can take the accent colour. Writes brand/aw-lower-*.svg, brand/preview-aw.html and
brand/preview-aw-sheet.png.
"""
import json
import math
import pathlib
import sys
import urllib.request

import numpy as np
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from PySide6.QtCore import QByteArray, QPointF, QRectF
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter, QPainterPath, QPolygonF, QTransform
from PySide6.QtSvg import QSvgRenderer

HERE = pathlib.Path(sys.argv[1]).resolve()
VAR = HERE / "fonts" / "variations"
VAR.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "brand-build/0.1 (font fetch for a mockup)"}
app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def google_font(family, want_static, axes):
    for name in want_static:
        if (VAR / name).exists():
            return VAR / name
    out = VAR / (family + "-instance.ttf")
    if out.exists():
        return out
    listing = json.loads(fetch(f"https://api.github.com/repos/google/fonts/contents/ofl/{family}"))
    files = {f["name"]: f["download_url"] for f in listing if f["name"].lower().endswith(".ttf")}
    for name in want_static:
        if name in files:
            (VAR / name).write_bytes(fetch(files[name]))
            return VAR / name
    variable = [n for n in files if "[" in n and "Italic" not in n]
    src = VAR / variable[0]
    if not src.exists():
        src.write_bytes(fetch(files[variable[0]]))
    font = TTFont(str(src))
    present = {a.axisTag for a in font["fvar"].axes}
    instancer.instantiateVariableFont(font, {k: v for k, v in axes.items() if k in present}, inplace=True)
    font.save(str(out))
    return out


FACES = [
    ("Inter Bold", ("inter", ["Inter-Bold.ttf"], {"wght": 700, "opsz": 32})),
    ("Archivo Bold", ("archivo", ["Archivo-Bold.ttf"], {"wght": 700, "wdth": 100})),
    ("Archivo Narrow Bold", ("archivonarrow", ["ArchivoNarrow-Bold.ttf"], {"wght": 700})),
    ("Libre Franklin ExtraBold", ("librefranklin", ["LibreFranklin-ExtraBold.ttf"], {"wght": 800})),
    ("IBM Plex Sans Bold", ("ibmplexsans", ["IBMPlexSans-Bold.ttf"], {"wght": 700})),
    ("Barlow Bold", ("barlow", ["Barlow-Bold.ttf"], {})),
    ("Work Sans Bold", ("worksans", ["WorkSans-Bold.ttf"], {"wght": 700})),
    ("Public Sans Bold", None),
]


def glyph_polys(font, ch, x=0.0):
    """The glyph as flattened polygons in font units (y up), placed at x."""
    tp = TextPath((x, 0), ch, size=1000, prop=FontProperties(fname=str(font)))
    return [np.asarray(p) for p in tp.to_polygons()]


def advance(font, ch):
    ft = TTFont(str(font))
    return ft["hmtx"][ft.getBestCmap()[ord(ch)]][0] * 1000 / ft["head"].unitsPerEm


def qpath(polys):
    p = QPainterPath()
    for poly in polys:
        p.addPolygon(QPolygonF([QPointF(x, -y) for x, y in poly]))   # flip to y down
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


def fit(paths, box=(1.0, 1.5, 31.0, 30.5)):
    """Scale and move several paths together so their union fits the box on the 32 canvas."""
    union = QPainterPath()
    for p in paths:
        union = union.united(p)
    r = union.boundingRect()
    x0, y0, x1, y1 = box
    s = min((x1 - x0) / r.width(), (y1 - y0) / r.height())
    t = QTransform()
    t.translate(x0 + ((x1 - x0) - r.width() * s) / 2 - r.left() * s, y0 + ((y1 - y0) - r.height() * s) / 2 - r.top() * s)
    t.scale(s, s)
    return [t.map(p) for p in paths]


def analyse_w(poly):
    """Key vertices of a lowercase w outline (font units, y up): the top-right terminal corners,
    the outer bottom-right vertex, the inner vertex under the middle peak."""
    xs, ys = poly[:, 0], poly[:, 1]
    ymax, ymin, xmin, xmax = ys.max(), ys.min(), xs.min(), xs.max()
    h, w = ymax - ymin, xmax - xmin
    top = poly[ys > ymax - 0.06 * h]
    top = top[np.argsort(top[:, 0])]
    tr2 = top[-1]                                    # outer corner of the right terminal
    right_term = top[top[:, 0] > xmax - 0.22 * w]
    tr1 = right_term[np.argmin(right_term[:, 0])]    # inner corner of the right terminal
    bottom = poly[ys < ymin + 0.06 * h]
    b2 = bottom[np.argmax(bottom[:, 0])]             # outer bottom-right vertex
    mid = poly[(np.abs(xs - (xmin + xmax) / 2) < 0.16 * w) & (ys > ymin + 0.2 * h)]
    u = mid[np.argmin(mid[:, 1])]                    # the inner notch under the middle peak
    mid_top = mid[mid[:, 1] > ymax - 0.06 * h]
    m_right = mid_top[np.argmax(mid_top[:, 0])]      # the peak's right corner: the top of the check's short arm
    inner2 = poly[(xs > u[0] + 0.08 * w) & (xs < xmax - 0.08 * w) & (ys > ymin + 0.15 * h) & (ys < ymax - 0.15 * h)]
    i2 = inner2[np.argmin(inner2[:, 1])]             # the inner notch of the second v, the bottom of that arm's right edge
    b1 = bottom[np.argmin(bottom[:, 0])]             # outer bottom-left vertex, to tell the sides apart
    second = bottom[bottom[:, 0] > u[0]]
    b2_left = second[np.argmin(second[:, 0])]        # the left corner of the second v's bottom: the foot of the check's left edge
    return tr1, tr2, b2, u, h, m_right, i2, b1, b2_left


def build(face, font, overshoot=0.5, gap=0.9):
    a_polys = glyph_polys(font, "a")
    w_x = advance(font, "a")
    w_polys = glyph_polys(font, "w", w_x)
    outer = max(w_polys, key=len)
    tr1, tr2, b2, u, xh, m_right, i2, b1, b2_left = analyse_w(outer)
    d = tr2 - b2
    d = d / np.linalg.norm(d)
    E = overshoot * xh / d[1]                        # rise past x-height by `overshoot` of the x-height
    ext = np.array([tr1, tr2, tr2 + d * E, tr1 + d * E])
    w_path = qpath(w_polys).united(qpath([ext])).simplified()
    # The cut runs along the check's own left edge, which is the glyph's straight
    # edge from the second v's bottom corner up to the notch under the middle
    # peak; above the notch it continues through the peak and out the top. The
    # sliver lies wholly on the w's side of that line, so the check keeps every
    # bit of its stroke and only the w's second arm loses a hairline, ending in
    # a slanted cut. The two-tone split uses the same line, nudged a hair toward
    # the w so no sliver of the check's edge is left behind in the ink colour.
    v = u - b2_left
    v = v / np.linalg.norm(v)
    n = np.array([-v[1], v[0]])
    if np.dot(b1 - u, n) < 0:
        n = -n                                       # n points to the w's side
    L = 4000.0
    p = u + n * 0.5
    left_poly = np.array([p - v * L, p + v * L, p + v * L + n * L, p - v * L + n * L])
    cut_w = gap * (xh / 20.0)                        # `gap` in canvas units when the x-height is about 20 of 32
    sliver = np.array([u, u + n * cut_w, u + n * cut_w + v * L, u + v * L])
    w_cut = w_path.subtracted(qpath([sliver])).simplified()
    left_half = qpath([left_poly])
    w_left = w_cut.intersected(left_half).simplified()
    w_right = w_cut.subtracted(left_half).simplified()
    a_path = qpath(a_polys)
    control = qpath(a_polys).united(qpath(w_polys)).simplified()
    a_f, wl_f, wr_f, wc_f, ctrl_f = fit([a_path, w_left, w_right, w_cut, control])
    # the control is fitted on its own so the plain "aw" shows at full size
    (ctrl_only,) = fit([control])
    return {"a": a_f, "w_left": wl_f, "w_right": wr_f, "w_cut": wc_f, "control": ctrl_only}


def svg_paths(parts, size=32, fills=None):
    fills = fills or ["currentColor"] * len(parts)
    body = "".join(f'<path fill="{f}" fill-rule="evenodd" d="{to_svg(p)}"/>' for p, f in zip(parts, fills))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">{body}</svg>'


built = []
for label, spec in FACES:
    try:
        font = HERE / "fonts" / "PublicSans-Bold.ttf" if spec is None else google_font(*spec)
        built.append((label, build(label, font)))
        print("built", label)
    except Exception as exc:
        print("skip", label, repr(exc))

ACCENTS = [("emerald", "#0f7b4f"), ("oxblood", "#8a1c2b"), ("ochre", "#c8891a")]
for label, parts in built:
    slug = label.lower().replace(" ", "-")
    one = svg_paths([parts["a"], parts["w_cut"]])
    (HERE / f"aw-lower-{slug}.svg").write_text(one.replace("><path", ">\n  <path").replace("</svg>", "\n</svg>\n"), encoding="utf-8")
    two = svg_paths([parts["a"], parts["w_left"], parts["w_right"]], fills=["currentColor", "currentColor", ACCENTS[0][1]])
    (HERE / f"aw-lower-{slug}-two-tone.svg").write_text(two.replace("><path", ">\n  <path").replace("</svg>", "\n</svg>\n"), encoding="utf-8")

SIZES = (16, 24, 32, 64, 128)


def cell(theme, items):
    out = []
    for label, maker in items:
        sizes = "".join(f"<div>{maker(s)}<span>{s}</span></div>" for s in SIZES)
        out.append(f'<div class="item"><div class="sizes">{sizes}</div><div class="cap">{label}</div>'
                   f'<div class="lockup">{maker(26)}<span>award watch</span></div></div>')
    return f'<div class="cell {theme}">{"".join(out)}</div>'


sections = []
for label, parts in built:
    items = [
        ("plain aw (control)", lambda s, p=parts: svg_paths([p["control"]], s)),
        ("check, one colour, hairline cut", lambda s, p=parts: svg_paths([p["a"], p["w_cut"]], s)),
    ]
    for name, hexv in ACCENTS:
        items.append((f"check in {name}", lambda s, p=parts, h=hexv: svg_paths([p["a"], p["w_left"], p["w_right"]], s, ["currentColor", "currentColor", h])))
    sections.append((label, f'<div class="row">{cell("light", items)}{cell("dark", items)}</div>'))

css = """
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#111;background:#fff}.wrap{padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 6px}p{margin:0 0 12px;max-width:72ch}
.row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd;margin:0 0 8px}.cell{padding:14px 18px;display:flex;flex-wrap:wrap;gap:16px 28px}
.cell.dark{background:#15171a;color:#f3f3f3}.cell.light{background:#fff;color:#111}
.item{display:flex;flex-direction:column}.sizes{display:flex;align-items:flex-end;gap:12px}.sizes svg{display:block}
.sizes span{display:block;font-size:10px;opacity:.55;text-align:center;margin-top:3px}.cap{font-size:12px;opacity:.75;margin-top:4px}
.lockup{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:19px;letter-spacing:-.01em;margin-top:4px}
"""
html = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award Watch: lowercase aw, the second v as a check</title>',
        f'<style>{css}</style></head><body><div class="wrap"><h1>Award Watch: lowercase aw, the second v of the w as a check</h1>',
        "<p>The a and the w are the typeface's own glyphs. The w's last up-stroke is carried on past x-height in its own "
        "direction, so the second v reads as a check; a hairline cut from the notch under the middle peak separates it "
        "from the first v, and in the two-tone version it takes the accent. All faces are under the SIL Open Font "
        "License. Each row: the plain aw for comparison, the one-colour cut version (the favicon form), then three accents.</p>"]
for label, body in sections:
    html.append(f"<h2>{label}</h2>{body}")
html.append("</div></body></html>")
(HERE / "preview-aw.html").write_text("\n".join(html), encoding="utf-8")

# contact sheet: each face, one-colour cut at 32/64/128 and the oxblood two-tone at 128, light scheme
cw, ch = 440, 150
sheet = QImage(cw * 2, ch * ((len(built) + 1) // 2), QImage.Format_ARGB32)
sheet.fill(QColor("#ffffff"))
qp = QPainter(sheet)
for i, (label, parts) in enumerate(built):
    x0, y0 = (i % 2) * cw, (i // 2) * ch
    one = svg_paths([parts["a"], parts["w_cut"]]).replace("currentColor", "#1b2a41")
    two = svg_paths([parts["a"], parts["w_left"], parts["w_right"]], fills=["#1b2a41", "#1b2a41", "#8a1c2b"])
    r1, r2 = QSvgRenderer(QByteArray(one.encode())), QSvgRenderer(QByteArray(two.encode()))
    x = x0 + 10
    for s in (16, 32, 64, 128):
        r1.render(qp, QRectF(x, y0 + 10 + (128 - s), s, s)); x += s + 10
    r2.render(qp, QRectF(x, y0 + 10, 128, 128))
    qp.setPen(QColor("#333")); qp.drawText(QRectF(x0 + 10, y0 + 130, cw, 18), label)
qp.end()
sheet.save(str(HERE / "preview-aw-sheet.png"))
print("sheet", sheet.width(), sheet.height())
