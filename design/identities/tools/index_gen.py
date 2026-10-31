"""Write design/identities/index.html, the switcher across the three directions."""
import re

from gen import OUT, REPO, SITE, e


def paths(fname: str) -> str:
    text = (REPO / "brand" / fname).read_text(encoding="utf-8")
    return "".join(re.findall(r"<path\b[^>]*/>", text))


def viewbox(fname: str) -> str:
    text = (REPO / "brand" / fname).read_text(encoding="utf-8")
    return re.search(r'viewBox="([^"]+)"', text).group(1)


DIRS = [
    ("ledger", "Ledger", "A printed financial record: warm paper, ink, serif headings, an account-book amount column, emerald for links and the open status.",
     "Source Serif 4 (headings, figures) and Source Sans 3 (text)",
     [("Paper", "#f6f1e6"), ("Band", "#ece3d1"), ("Ink", "#1f1a14"), ("Muted", "#5e5446"), ("Rule", "#d5cab5"), ("Emerald", "#0f7b4f")],
     [("Paper", "#17130f"), ("Band", "#221c16"), ("Ink", "#efe5d0"), ("Muted", "#b5a891"), ("Rule", "#3e352b"), ("Emerald", "#36a175")]),
    ("signal", "Signal", "A modern data product: cool white ground, cards with 4 px corners, a large numeric scale, a sticky filter bar with chips, emerald for everything interactive.",
     "Inter (everything, tabular figures on amounts)",
     [("Ground", "#f4f6f9"), ("Surface", "#ffffff"), ("Text", "#0e1116"), ("Muted", "#56606d"), ("Border", "#dfe4ea"), ("Emerald", "#0f7b4f"), ("Tint", "#e5f5ef")],
     [("Ground", "#0b0f14"), ("Surface", "#111821"), ("Text", "#e6edf3"), ("Muted", "#98a4b2"), ("Border", "#212b37"), ("Emerald", "#33cc8e"), ("Tint", "#113224")]),
    ("civic", "Civic", "A broadsheet's data page: black and white with emerald, condensed headlines, heavy rules, a two-column front page and large pull-figures.",
     "Archivo Narrow (display, figures) and IBM Plex Sans (text)",
     [("Ground", "#ffffff"), ("Ink", "#111111"), ("Muted", "#545454"), ("Hairline", "#d5d5d5"), ("Emerald", "#0f7b4f"), ("Tint", "#e5f5ef")],
     [("Ground", "#1b1b1a"), ("Ink", "#f1eee8"), ("Muted", "#aca89f"), ("Hairline", "#3a3936"), ("Emerald", "#3bb080"), ("Tint", "#153729")]),
]


def swatches(items) -> str:
    return "".join(f'<li><span class="sw" style="background:{h}"></span><span>{e(n)}</span><code>{h}</code></li>' for n, h in items)


def panel(slug, name, idea, fonts, light, dark) -> str:
    wm = ('<svg class="mk-s" viewBox="{vb}" aria-hidden="true" focusable="false"><use href="#mark"/></svg>'
          '<b>Award Watch</b>').format(vb=viewbox("mark-two-tone.svg"))
    return f"""<section class="dir">
<h2>{name}</h2><p class="idea">{e(idea)}</p>
<div class="chips"><span style="background:{light[0][1]};color:{light[2][1]}">{wm}</span><span style="background:{dark[0][1]};color:{dark[2][1]}">{wm}</span></div>
<ul class="pages"><li><a href="{slug}/home.html">Home</a></li><li><a href="{slug}/tenders.html">Open tenders</a></li><li><a href="{slug}/organization.html">Organization profile (WSP Canada Inc.)</a></li></ul>
<dl><div><dt>Type</dt><dd>{e(fonts)}</dd></div></dl>
<h3>Light scheme</h3><ul class="pal">{swatches(light)}</ul>
<h3>Dark scheme</h3><ul class="pal">{swatches(dark)}</ul>
</section>"""


HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{SITE}: three identity directions</title>
<link rel="icon" type="image/svg+xml" href="../../brand/favicon.svg">
<style>
:root {{ --bg: #fafafa; --fg: #161616; --muted: #555; --line: #d9d9d9; --card: #fff; color-scheme: light dark; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #141414; --fg: #eee; --muted: #aaa; --line: #333; --card: #1c1c1c; }} }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, "Segoe UI", sans-serif; }}
main {{ max-width: 1240px; margin: 0 auto; padding: 32px clamp(16px, 4vw, 40px) 48px; }}
h1 {{ font-size: 26px; margin: 0 0 8px; }}
.intro {{ max-width: 80ch; color: var(--muted); margin: 0 0 8px; }}
a {{ color: inherit; text-underline-offset: .2em; }}
.brandrow {{ display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px; margin: 20px 0 4px; padding: 16px 20px; background: var(--card); border: 1px solid var(--line); }}
.brandrow .mk {{ width: 56px; height: 56px; flex: none; }}
.brandrow .wm {{ height: 34px; width: auto; max-width: 100%; }}
.brandrow p {{ margin: 0; flex: 1 1 280px; font-size: 14px; color: var(--muted); }}
.grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 20px; }}
.dir {{ background: var(--card); border: 1px solid var(--line); padding: 18px 20px 20px; min-width: 0; }}
h2 {{ font-size: 20px; margin: 0 0 4px; }}
.idea {{ margin: 0; color: var(--muted); font-size: 14px; }}
.chips {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; margin: 14px 0 0; }}
.chips span {{ display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); font-size: 15px; min-width: 0; }}
.chips .mk-s {{ width: 30px; height: 30px; flex: none; }}
.pages {{ list-style: none; padding: 0; margin: 14px 0; display: flex; flex-direction: column; gap: 4px; font-weight: 600; }}
dl {{ margin: 0 0 12px; font-size: 14px; }}
dl div {{ display: grid; grid-template-columns: 4.5em minmax(0, 1fr); gap: 8px; padding: 4px 0; border-top: 1px solid var(--line); }}
dt {{ color: var(--muted); }}
dd {{ margin: 0; overflow-wrap: anywhere; }}
h3 {{ font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 14px 0 6px; }}
.pal {{ list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px 10px; font-size: 13px; }}
.pal li {{ display: grid; grid-template-columns: 22px minmax(0, 1fr); column-gap: 8px; align-items: center; }}
.pal .sw {{ grid-row: span 2; width: 22px; height: 22px; border: 1px solid var(--line); }}
.pal code {{ color: var(--muted); font-size: 12px; }}
.notes {{ margin-top: 28px; max-width: 80ch; font-size: 14px; color: var(--muted); }}
.notes li {{ margin-bottom: 6px; }}
@media (max-width: 999.98px) {{ .grid {{ grid-template-columns: minmax(0, 1fr); }} }}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="wordmark" viewBox="{viewbox("wordmark.svg")}">{paths("wordmark.svg")}</symbol><symbol id="mark" viewBox="{viewbox("mark-two-tone.svg")}">{paths("mark-two-tone.svg")}</symbol></svg>
<main>
<h1>{SITE}: three identity directions</h1>
<p class="intro">The same three pages in three visual identities, built from real CanadaBuys records of 2026-10-31, so the comparison is about design and not content. Each page has a Dark or Light button in its header; the choice is kept in this browser and carries across all nine pages. The FR button does nothing here. README.md in this folder has the reasoning, the costs and the figures behind the profile page.</p>
<div class="brandrow">
<svg class="mk" viewBox="{viewbox("mark-two-tone.svg")}" aria-hidden="true" focusable="false">{paths("mark-two-tone.svg")}</svg>
<svg class="wm" viewBox="{viewbox("wordmark.svg")}" aria-hidden="true" focusable="false"><use href="#wordmark"/></svg>
<p>One mark for all three: lowercase "aw" in Inter Bold, the second v of the w a check in emerald <code>#0f7b4f</code>. Every masthead carries <code>brand/mark-two-tone.svg</code> inline, beside the name set in that direction's own type; the tab icon is <code>brand/favicon.svg</code>. The wordmark (<code>brand/wordmark.svg</code>, right) is not used on the pages, since beside the mark it would repeat "aw". The check fixed the accent, so all three directions use the same emerald and differ in ground, type and layout.</p>
</div>
<div class="grid">
{"".join(panel(*d) for d in DIRS)}
</div>
<ul class="notes">
<li>The two tiles under each direction show the mark on its light and dark ground as the file draws it. On the pages, the dark scheme lifts the check to that direction's dark emerald.</li>
<li>Counts in square brackets (open tenders, closing within 7 days) need the open-notices file, which the samples do not include.</li>
<li>Fonts load from Google Fonts in these mockups; the site would serve them itself. All five families are under the SIL Open Font License 1.1.</li>
</ul>
</main>
</body>
</html>
"""

(OUT / "index.html").write_text(HTML, encoding="utf-8", newline="\n")
print("index written", len(HTML.encode("utf-8")))
