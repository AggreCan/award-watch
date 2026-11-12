"""The product images for the payment page (Stripe's Checkout shows a product's image beside its name).

One square page per paid plan, drawn from the brand's own files: the mark of brand/mark-two-tone.svg in white on
the plan's colour (Pro's emerald, the site's accent; Ultra's sapphire), and under it the plan's glyph and name as
the site's chip writes them, in the site's display face. The page is written to brand/product/<plan>.html; a
1024 by 1024 capture of it is the image (brand/product/award-watch-<plan>.png).

Run `python brand/make_product_images.py`, then capture each page at 1024 by 1024 with any headless browser,
with the repository's root served over HTTP so the font loads:

    python -m http.server 8000 --bind 127.0.0.1
    msedge --headless=new --window-size=1024,1024 --screenshot=brand/product/award-watch-pro.png \
        http://127.0.0.1:8000/brand/product/pro.html
"""

import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "product"
SIZE = 1024

# The plans' colours (site/public/styles.css: --accent and --ultra) and glyphs (site/src/pro.tsx).
PLANS = {
    "pro": {"name": "Pro", "colour": "#0f7b4f", "glyph": "M3 6.2 6 2h4l3 4.2L8 14.5z"},
    "ultra": {"name": "Ultra", "colour": "#0f52ba", "glyph": "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"},
}

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Award Watch {name}</title>
<style>
@font-face {{ font-family: "Bricolage Grotesque"; src: url("../../site/public/fonts/BricolageGrotesque-Variable.woff2") format("woff2"); font-weight: 200 800; }}
html, body {{ margin: 0; width: {size}px; height: {size}px; overflow: hidden; background: {colour}; }}
.tile {{ box-sizing: border-box; width: {size}px; height: {size}px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 56px; padding: 0 96px 24px; background: {colour}; color: #ffffff; }}
.mark {{ width: 560px; height: auto; }}
.plan {{ display: flex; align-items: center; gap: 28px; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 176px; line-height: 1;
  letter-spacing: -0.03em; }}
.plan svg {{ width: 104px; height: 104px; fill: currentColor; }}
.rule {{ width: 560px; height: 6px; background: rgba(255, 255, 255, 0.35); }}
</style>
</head>
<body>
<div class="tile">
  <svg class="mark" viewBox="{box}" role="img" aria-label="Award Watch">
{paths}
  </svg>
  <div class="rule"></div>
  <div class="plan"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="{glyph}"/></svg><span>{name}</span></div>
</div>
</body>
</html>
"""


def mark_paths() -> tuple[str, str]:
    """The mark's three paths in white, and the view box that holds them without the file's margins."""
    svg = (HERE / "mark-two-tone.svg").read_text(encoding="utf-8")
    found = re.findall(r'<path fill="[^"]+" fill-rule="evenodd" d="([^"]+)"', svg)
    if len(found) != 3:
        raise SystemExit(f"mark-two-tone.svg holds {len(found)} paths, not the three this script draws")
    xs: list[float] = []
    ys: list[float] = []
    for d in found:
        numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
        xs += numbers[0::2]
        ys += numbers[1::2]
    box = f"{min(xs):.2f} {min(ys):.2f} {max(xs) - min(xs):.2f} {max(ys) - min(ys):.2f}"
    paths = "\n".join(f'    <path fill="#ffffff" fill-rule="evenodd" d="{d}"/>' for d in found)
    return paths, box


def main() -> None:
    OUT.mkdir(exist_ok=True)
    paths, box = mark_paths()
    for key, plan in PLANS.items():
        page = PAGE.format(size=SIZE, box=box, paths=paths, **plan)
        (OUT / f"{key}.html").write_bytes(page.encode("utf-8"))
        print(f"wrote brand/product/{key}.html")


if __name__ == "__main__":
    main()
