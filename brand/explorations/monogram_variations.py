"""Monogram variations for Award Watch: typefaces, case and arrangement, containers, two-tone.

Writes brand/preview-monogram.html (browser) and brand/preview-monogram-sheet.png (quick look).
Fonts are fetched from the google/fonts repository (all SIL OFL) into brand/fonts/variations/;
variable fonts are instantiated to a static weight with fontTools.
"""
import json
import pathlib
import sys
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from matplotlib.font_manager import FontProperties
from matplotlib.path import Path
from matplotlib.textpath import TextPath

HERE = pathlib.Path(sys.argv[1]).resolve()
VAR = HERE / "fonts" / "variations"
VAR.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "brand-build/0.1 (font fetch for a mockup)"}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def google_font(family, want_static, axes):
    """Return a path to a static TTF for the family: a static file when the repo has one, else an instance."""
    for name in want_static:
        local = VAR / name
        if local.exists():
            return local
    listing = json.loads(fetch(f"https://api.github.com/repos/google/fonts/contents/ofl/{family}"))
    files = {f["name"]: f["download_url"] for f in listing if f["name"].lower().endswith(".ttf")}
    for name in want_static:
        if name in files:
            local = VAR / name
            local.write_bytes(fetch(files[name]))
            return local
    variable = [n for n in files if "[" in n and "Italic" not in n]
    if not variable:
        raise FileNotFoundError(f"{family}: {list(files)}")
    src = VAR / variable[0]
    if not src.exists():
        src.write_bytes(fetch(files[variable[0]]))
    out = VAR / (family + "-instance.ttf")
    if not out.exists():
        font = TTFont(str(src))
        present = {a.axisTag for a in font["fvar"].axes}
        instancer.instantiateVariableFont(font, {k: v for k, v in axes.items() if k in present}, inplace=True)
        font.save(str(out))
    return out


FACES = [
    ("Source Serif 4 Bold", HERE / "fonts" / "SourceSerif4-Bold.ttf", None),
    ("Public Sans Bold", HERE / "fonts" / "PublicSans-Bold.ttf", None),
    ("Inter Bold", None, ("inter", ["Inter-Bold.ttf"], {"wght": 700, "opsz": 32})),
    ("IBM Plex Sans Bold", None, ("ibmplexsans", ["IBMPlexSans-Bold.ttf"], {"wght": 700})),
    ("IBM Plex Mono Bold", None, ("ibmplexmono", ["IBMPlexMono-Bold.ttf"], {"wght": 700})),
    ("Libre Franklin ExtraBold", None, ("librefranklin", ["LibreFranklin-ExtraBold.ttf"], {"wght": 800})),
    ("Archivo Narrow Bold", None, ("archivonarrow", ["ArchivoNarrow-Bold.ttf"], {"wght": 700})),
    ("Archivo Black", None, ("archivoblack", ["ArchivoBlack-Regular.ttf"], {})),
    ("Oswald SemiBold", None, ("oswald", ["Oswald-SemiBold.ttf"], {"wght": 600})),
    ("Playfair Display ExtraBold", None, ("playfairdisplay", ["PlayfairDisplay-ExtraBold.ttf"], {"wght": 800})),
    ("DM Serif Display", None, ("dmserifdisplay", ["DMSerifDisplay-Regular.ttf"], {})),
    ("Spectral Bold", None, ("spectral", ["Spectral-Bold.ttf"], {})),
    ("Zilla Slab Bold", None, ("zillaslab", ["ZillaSlab-Bold.ttf"], {})),
    ("Bitter Bold", None, ("bitter", ["Bitter-Bold.ttf"], {"wght": 700})),
    ("Fraunces Black", None, ("fraunces", ["Fraunces-Black.ttf"], {"wght": 900, "opsz": 144, "SOFT": 0, "WONK": 0})),
    ("Instrument Serif", None, ("instrumentserif", ["InstrumentSerif-Regular.ttf"], {})),
]


def glyph_path(text, font, box, tracking=0.0):
    """SVG path for text fitted in box (x0, y0, x1, y1); tracking in em units, negative tightens."""
    prop = FontProperties(fname=str(font))
    if tracking:
        # TextPath has no tracking; lay the glyphs out one by one on a common
        # baseline from the font's own advance widths (kerning is dropped).
        import numpy as np
        ft = TTFont(str(font))
        cmap, hmtx, upm = ft.getBestCmap(), ft["hmtx"], ft["head"].unitsPerEm
        parts, x = [], 0.0
        for ch in text:
            parts.append(TextPath((x, 0), ch, size=100, prop=prop))
            x += hmtx[cmap[ord(ch)]][0] * 100 / upm + tracking * 100
        tp = Path(np.concatenate([p.vertices for p in parts]), np.concatenate([p.codes for p in parts]))
    else:
        tp = TextPath((0, 0), text, size=100, prop=prop)
    verts, codes = tp.vertices, tp.codes
    xs, ys = verts[:, 0], -verts[:, 1]
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
    bw, bh = bx1 - bx0, by1 - by0
    x0, y0, x1, y1 = box
    s = min((x1 - x0) / bw, (y1 - y0) / bh)
    ox = x0 + ((x1 - x0) - bw * s) / 2 - bx0 * s
    oy = y0 + ((y1 - y0) - bh * s) / 2 - by0 * s

    def f(x, y):
        return f"{x * s + ox:.2f} {y * s + oy:.2f}"

    out, i = [], 0
    while i < len(codes):
        c = codes[i]
        if c == Path.MOVETO:
            out.append("M" + f(xs[i], ys[i])); i += 1
        elif c == Path.LINETO:
            out.append("L" + f(xs[i], ys[i])); i += 1
        elif c == Path.CURVE3:
            out.append("Q" + f(xs[i], ys[i]) + " " + f(xs[i + 1], ys[i + 1])); i += 2
        elif c == Path.CURVE4:
            out.append("C" + f(xs[i], ys[i]) + " " + f(xs[i + 1], ys[i + 1]) + " " + f(xs[i + 2], ys[i + 2])); i += 3
        elif c == Path.CLOSEPOLY:
            out.append("Z"); i += 1
        else:
            i += 1
    return "".join(out)


def stacked_path(font, box):
    """A over W, each fitted to half the box."""
    x0, y0, x1, y1 = box
    mid = (y0 + y1) / 2
    return glyph_path("A", font, (x0, y0, x1, mid - 1)) + glyph_path("W", font, (x0, mid + 1, x1, y1))


def nested_path(font, box):
    """A small A sitting in the W's central notch, above the W."""
    x0, y0, x1, y1 = box
    w = glyph_path("W", font, (x0, y0 + 9, x1, y1))
    a = glyph_path("A", font, (x0 + 10, y0, x1 - 10, y0 + 12))
    return w + a


# Containers around the serif monogram.
SQUARE = "M0 0h32v32H0z"
ROUNDED = "M4 0h24a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z"
CIRCLE = "M16 0a16 16 0 1 1 0 32a16 16 0 1 1 0-32z"
RECEIPT = "M0 0h32v28l-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2z"
TAG = "M0 0h26l6 6v26H0z"  # a cut corner, like an index tab
# Outline containers: the ring is the outer minus the inner (evenodd handles both).
LEDGER_BOX = "M0 0h32v32H0z M2 2v28h28V2z M4 25h24v1.5H4z"  # a frame with a rule under the letters
DOUBLE_RULE = "M0 0h32v32H0z M1.5 1.5v29h29v-29z M3 3v26h26V3z M4 4v24h24V4z"


def svg(path, rule="nonzero", size=32, extra=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">'
        f'{extra}<path fill="currentColor" fill-rule="{rule}" d="{path}"/></svg>'
    )


def two_tone(path_a, path_w, size, ink="currentColor", accent="#8a1c2b"):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">'
        f'<path fill="{ink}" d="{path_a}"/><path fill="{accent}" d="{path_w}"/></svg>'
    )


SIZES = (16, 24, 32, 64)


def strip(items):
    """One row of (label, svg-maker) rendered at the preview sizes in both schemes."""
    cells = []
    for label, maker in items:
        sizes = "".join(f"<div>{maker(s)}<span>{s}</span></div>" for s in SIZES)
        cells.append(f'<div class="item"><div class="sizes">{sizes}</div><div class="cap">{label}</div></div>')
    body = "".join(cells)
    return f'<div class="row"><div class="cell light">{body}</div><div class="cell dark">{body}</div></div>'


sections = []
resolved = []
for label, local, remote in FACES:
    try:
        path = local if local else google_font(*remote)
        resolved.append((label, path))
    except Exception as exc:  # a face that cannot be fetched is skipped, not fatal
        print("skip", label, exc)
print("faces:", [r[0] for r in resolved])

# 1. Typefaces: letters, and the tile.
items = []
for label, path in resolved:
    letters = glyph_path("AW", path, (3, 7, 29, 25))
    items.append((label, lambda s, p=letters: svg(p, "nonzero", s)))
    items.append((label + ", tile", lambda s, p=SQUARE + letters: svg(p, "evenodd", s)))
sections.append(("1. Typefaces (letters, then the tile)", strip(items)))

# 2. Case and arrangement, in the serif and in one grotesque.
serif = resolved[0][1]
sans = next((p for l, p in resolved if l.startswith("Inter")), resolved[1][1])
items = []
for face_label, face in (("serif", serif), ("sans", sans)):
    for text, cap in (("AW", "caps"), ("Aw", "mixed"), ("aw", "lowercase")):
        p = glyph_path(text, face, (3, 6, 29, 26))
        items.append((f"{face_label}: {cap}", lambda s, p=p: svg(p, "nonzero", s)))
        items.append((f"{face_label}: {cap}, tile", lambda s, p=SQUARE + p: svg(p, "evenodd", s)))
    tight = glyph_path("AW", face, (3, 7, 29, 25), tracking=-0.08)
    items.append((f"{face_label}: tight", lambda s, p=tight: svg(p, "nonzero", s)))
    st = stacked_path(face, (6, 2, 26, 30))
    items.append((f"{face_label}: stacked", lambda s, p=st: svg(p, "nonzero", s)))
    items.append((f"{face_label}: stacked, tile", lambda s, p=SQUARE + st: svg(p, "evenodd", s)))
    ne = nested_path(face, (2, 2, 30, 30))
    items.append((f"{face_label}: A in the notch", lambda s, p=ne: svg(p, "nonzero", s)))
sections.append(("2. Case and arrangement", strip(items)))

# 3. Containers around the serif caps.
letters = glyph_path("AW", serif, (4, 8, 28, 24))
small = glyph_path("AW", serif, (5, 8, 27, 23))
items = [
    ("square", lambda s: svg(SQUARE + letters, "evenodd", s)),
    ("rounded", lambda s: svg(ROUNDED + letters, "evenodd", s)),
    ("circle", lambda s: svg(CIRCLE + small, "evenodd", s)),
    ("receipt foot", lambda s: svg(RECEIPT + glyph_path("AW", serif, (4, 6, 28, 22)), "evenodd", s)),
    ("cut corner", lambda s: svg(TAG + letters, "evenodd", s)),
    ("ledger box", lambda s: svg(LEDGER_BOX + glyph_path("AW", serif, (5, 6, 27, 22)), "evenodd", s)),
    ("double rule", lambda s: svg(DOUBLE_RULE + glyph_path("AW", serif, (7, 9, 25, 23)), "evenodd", s)),
    ("letters, rule under", lambda s: svg(letters + "M4 27h24v2H4z", "nonzero", s)),
    ("letters, rule over and under", lambda s: svg(letters + "M4 3h24v2H4z M4 27h24v2H4z", "nonzero", s)),
]
sections.append(("3. Containers (serif caps)", strip(items)))

# 4. Two-tone: A in ink, W in the accent; and the reverse.
a_only = glyph_path("A", serif, (3, 7, 14.5, 25))
w_only = glyph_path("W", serif, (14, 7, 29, 25))
items = [
    ("A ink, W oxblood", lambda s: two_tone(a_only, w_only, s)),
    ("A oxblood, W ink", lambda s: two_tone(w_only, a_only, s)),
    ("A ink, W emerald", lambda s: two_tone(a_only, w_only, s, accent="#0f7b4f")),
    ("A ink, W ochre", lambda s: two_tone(a_only, w_only, s, accent="#c8891a")),
]
sections.append(("4. Two-tone (where two colours are allowed; the favicon stays one colour)", strip(items)))

css = """
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#111;background:#fff}.wrap{padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 6px}p{margin:0 0 12px;max-width:72ch}
.row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd;margin:0 0 8px}.cell{padding:14px 18px;display:flex;flex-wrap:wrap;gap:18px 26px}
.cell.dark{background:#15171a;color:#f3f3f3}.cell.light{background:#fff;color:#111}
.item{display:flex;flex-direction:column;align-items:flex-start}.sizes{display:flex;align-items:flex-end;gap:10px}.sizes svg{display:block}
.sizes span{display:block;font-size:10px;opacity:.55;text-align:center;margin-top:3px}.cap{font-size:11.5px;opacity:.75;margin-top:4px}
"""
html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award Watch: monogram variations</title>',
    f"<style>{css}</style></head><body><div class=\"wrap\"><h1>Award Watch: monogram variations</h1>",
    "<p>Every variation is one SVG path filled with <code>currentColor</code> (the two-tone row excepted), shown at "
    "16, 24, 32 and 64 px in both schemes. All typefaces are under the SIL Open Font License. The 16 px cell is the "
    "test: a monogram that muddies there is not a favicon.</p>",
]
for title, body in sections:
    html.append(f"<h2>{title}</h2>{body}")
html.append("</div></body></html>")
(HERE / "preview-monogram.html").write_text("\n".join(html), encoding="utf-8")
print("wrote preview-monogram.html")

# Contact sheet: section 1 tiles in the light scheme at 32 and 96 px, so the typefaces can be compared quickly.
from PySide6.QtCore import QByteArray, QRectF  # noqa: E402
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter, QFont  # noqa: E402
from PySide6.QtSvg import QSvgRenderer  # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])
cols, cw, ch = 4, 220, 120
rows = (len(resolved) + cols - 1) // cols
sheet = QImage(cols * cw, rows * ch, QImage.Format_ARGB32)
sheet.fill(QColor("#ffffff"))
p = QPainter(sheet)
p.setFont(QFont("Segoe UI", 8))
for i, (label, path) in enumerate(resolved):
    x, y = (i % cols) * cw, (i // cols) * ch
    letters = glyph_path("AW", path, (3, 7, 29, 25))
    for j, (d, rule) in enumerate(((letters, "nonzero"), (SQUARE + letters, "evenodd"))):
        r = QSvgRenderer(QByteArray(svg(d, rule).replace("currentColor", "#1b2a41").encode()))
        r.render(p, QRectF(x + 10 + j * 100, y + 10, 80, 80))
        r.render(p, QRectF(x + 10 + j * 100 + 82, y + 74, 16, 16))
    p.setPen(QColor("#333"))
    p.drawText(x + 10, y + 108, label)
p.end()
sheet.save(str(HERE / "preview-monogram-sheet.png"))
print("sheet", cols * cw, rows * ch)
