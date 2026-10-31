"""Build the three Award Watch mark approaches into the brand folder given as argv[1]."""
import pathlib
import sys

from matplotlib.font_manager import FontProperties
from matplotlib.path import Path
from matplotlib.textpath import TextPath

HERE = pathlib.Path(sys.argv[1]).resolve()


def text_path_svg(text, font, box=(2, 2, 30, 30)):
    """Glyph outlines as an SVG path string, fitted inside box (x0, y0, x1, y1) on the 32-unit canvas."""
    tp = TextPath((0, 0), text, size=100, prop=FontProperties(fname=str(font)))
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
            out.append("M" + f(xs[i], ys[i]))
            i += 1
        elif c == Path.LINETO:
            out.append("L" + f(xs[i], ys[i]))
            i += 1
        elif c == Path.CURVE3:
            out.append("Q" + f(xs[i], ys[i]) + " " + f(xs[i + 1], ys[i + 1]))
            i += 2
        elif c == Path.CURVE4:
            out.append("C" + f(xs[i], ys[i]) + " " + f(xs[i + 1], ys[i + 1]) + " " + f(xs[i + 2], ys[i + 2]))
            i += 3
        elif c == Path.CLOSEPOLY:
            out.append("Z")
            i += 1
        else:
            i += 1
    return "".join(out), (bw * s, bh * s)


serif = HERE / "fonts" / "SourceSerif4-Bold.ttf"
letters, size = text_path_svg("AW", serif, box=(3, 7, 29, 25))
print("monogram glyph box:", [round(v, 2) for v in size])


def svg(path, rule="nonzero"):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n'
        f'  <path fill="currentColor" fill-rule="{rule}" d="{path}"/>\n</svg>\n'
    )


# A. Monogram: the letters alone, and a tile with the letters knocked out of the
# square (evenodd brings the counters back).
tile = "M0 0h32v32H0z" + letters
(HERE / "aw-a-monogram.svg").write_text(svg(letters, "nonzero"), encoding="utf-8")
(HERE / "aw-a-monogram-tile.svg").write_text(svg(tile, "evenodd"), encoding="utf-8")
# B. Treemap: a square divided into five unequal blocks with 2-unit gutters.
treemap = "M2 2h16v18H2z M2 22h16v8H2z M20 2h10v10H20z M20 14h10v8H20z M20 24h10v6H20z"
(HERE / "aw-b-treemap.svg").write_text(svg(treemap), encoding="utf-8")
# C. Lens: a page with three lines, and a ring with a handle beside its corner.
lens = (
    "M2 2h12v16H2z M4 5v2h8v-2z M4 9v2h8v-2z M4 13v2h5v-2z "
    "M22 14a8 8 0 1 1 0 16a8 8 0 1 1 0-16z M22 17a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M27 29l2-2 3 3-2 2z"
)
(HERE / "aw-c-lens.svg").write_text(svg(lens), encoding="utf-8")

marks = {
    "A. Monogram (typographic)": [("aw-a-monogram.svg", letters, "nonzero"), ("aw-a-monogram-tile.svg", tile, "evenodd")],
    "B. Treemap (abstract data-form)": [("aw-b-treemap.svg", treemap, "nonzero")],
    "C. Lens (pictographic)": [("aw-c-lens.svg", lens, "nonzero")],
}
notes = {
    "A. Monogram (typographic)": (
        "The initials A and W cut from Source Serif 4 Bold (SIL OFL), as plain letters and as a tile with the "
        "letters knocked out of the square. Pairs with the Ledger direction; the typeface follows whichever "
        "heading face the chosen direction uses."
    ),
    "B. Treemap (abstract data-form)": (
        "One square divided into five unequal blocks: the shares of a budget, with nothing to decode. The "
        "largest block takes the accent colour where two colours are allowed. Pairs with the Signal direction."
    ),
    "C. Lens (pictographic)": (
        "A page of entries under a magnifier: the watch, without the surveillance eye. Pairs with the Civic direction."
    ),
}


def mark_svg(path, rule, s):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{s}" height="{s}">'
        f'<path fill="currentColor" fill-rule="{rule}" d="{path}"/></svg>'
    )


def cell(theme, items):
    parts = []
    for name, path, rule in items:
        sizes = "".join(f"<div>{mark_svg(path, rule, s)}<span>{s}</span></div>" for s in (16, 24, 32, 48, 96))
        parts.append(
            f'<div class="file">{name}</div><div class="sizes">{sizes}</div>'
            f'<div class="lockup">{mark_svg(path, rule, 28)}<span>Award Watch</span></div><br>'
            f'<span class="tab">{mark_svg(path, rule, 16)}Award Watch</span>'
        )
    return f'<div class="cell {theme}"><div class="label">{theme} scheme</div>{"".join(parts)}</div>'


css = """
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;color:#111;background:#fff}.wrap{padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 2px}p{margin:0 0 12px;max-width:72ch}
.row{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd;margin:0 0 8px}.cell{padding:18px 24px}
.cell.dark{background:#15171a;color:#f3f3f3}.cell.light{background:#fff;color:#111}
.sizes{display:flex;align-items:flex-end;gap:22px;margin:6px 0 12px}.sizes svg{display:block}
.sizes span{display:block;font-size:11px;opacity:.6;text-align:center;margin-top:4px}
.lockup{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:20px;letter-spacing:-.01em}
.tab{display:inline-block;padding:7px 8px 7px 10px;background:#e9eaec;color:#111;border-radius:6px 6px 0 0;font-size:12px;margin:8px 0 18px}
.tab svg{vertical-align:-3px;margin-right:6px}.dark .tab{background:#2b2e33;color:#eee}
.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.6;margin:0 0 6px}
.file{font-size:12px;opacity:.7;margin-top:10px}.notes{color:#444;font-size:14px}
"""
html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award Watch: three brand approaches</title>',
    f"<style>{css}</style></head><body><div class=\"wrap\"><h1>Award Watch: three brand approaches</h1>",
    "<p>Three different routes to a mark, not three variants of one. Each is one path on a 32-unit canvas filled "
    "with <code>currentColor</code>, so the same file serves the header, the favicon and the dark scheme. Judge at "
    "16 px first.</p>",
]
for title, items in marks.items():
    html.append(f'<h2>{title}</h2><p class="notes">{notes[title]}</p><div class="row">{cell("light", items)}{cell("dark", items)}</div>')
html.append("</div></body></html>")
(HERE / "preview-approaches.html").write_text("\n".join(html), encoding="utf-8")

# Contact sheet for a look without a browser.
from PySide6.QtCore import QByteArray, QRectF  # noqa: E402
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter  # noqa: E402
from PySide6.QtSvg import QSvgRenderer  # noqa: E402

app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])
files = ["aw-a-monogram.svg", "aw-a-monogram-tile.svg", "aw-b-treemap.svg", "aw-c-lens.svg"]
sizes = [16, 24, 32, 64, 128]
pad = 16
W = pad + sum(s + pad for s in sizes)
H = (128 + pad) * len(files) * 2 + pad
sheet = QImage(W, H, QImage.Format_ARGB32)
sheet.fill(QColor("#ffffff"))
p = QPainter(sheet)
y = pad
for theme, bg, fg in (("light", "#ffffff", "#1b2a41"), ("dark", "#15171a", "#f3f3f3")):
    for n in files:
        r = QSvgRenderer(QByteArray((HERE / n).read_text(encoding="utf-8").replace("currentColor", fg).encode()))
        p.fillRect(0, y - pad // 2, W, 128 + pad, QColor(bg))
        x = pad
        for s in sizes:
            r.render(p, QRectF(x, y + (128 - s), s, s))
            x += s + pad
        y += 128 + pad
p.end()
sheet.save(str(HERE / "preview-approaches-sheet.png"))
print("sheet written", W, H)
