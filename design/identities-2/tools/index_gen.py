"""Write design/identities-2/index.html, the switcher between the three directions."""
from gen import FONT, HEAD_JS, JS, MARK, NAMES, OUT, TOG, e

SWATCHES = {
    "sheet": {"light": [("Ground", "#ffffff"), ("Ink", "#111111"), ("Secondary", "#374151"), ("Muted", "#6b7280"), ("Rule", "#e5e7eb"), ("Emerald", "#0f7b4f"), ("Amber", "#b45309")],
              "dark": [("Ground", "#101010"), ("Ink", "#ececec"), ("Secondary", "#c2c2c2"), ("Muted", "#9a9a9a"), ("Rule", "#2b2b2b"), ("Emerald", "#34d399"), ("Amber", "#fbbf24")]},
    "console": {"light": [("Page", "#f8fafc"), ("Panel", "#ffffff"), ("Border", "#e2e8f0"), ("Ink", "#0f172a"), ("Secondary", "#334155"), ("Muted", "#5b6b80"), ("Emerald", "#0f7b4f"), ("Amber", "#b45309")],
                "dark": [("Page", "#0b1120"), ("Panel", "#0f172a"), ("Border", "#1e293b"), ("Ink", "#e2e8f0"), ("Secondary", "#cbd5e1"), ("Muted", "#94a3b8"), ("Emerald", "#34d399"), ("Amber", "#fbbf24")]},
    "dossier": {"light": [("Ground", "#ffffff"), ("Ink", "#0a0a0a"), ("Secondary", "#3d3d3d"), ("Muted", "#6b6b6b"), ("Rule", "#e6e6e6"), ("Emerald", "#0f7b4f"), ("Amber", "#b45309")],
                "dark": [("Ground", "#0c0c0c"), ("Ink", "#f0f0f0"), ("Secondary", "#c6c6c6"), ("Muted", "#9e9e9e"), ("Rule", "#262626"), ("Emerald", "#34d399"), ("Amber", "#fbbf24")]},
}
POV = {
    "sheet": ("A", "The register as one ruled sheet. A white page, ink and 1 px rules, with no panels or cards anywhere. "
                   "The mark's own check is the system's awarded glyph, every table ends on a right-aligned Source column, "
                   "and amounts sit in a column ruled on both sides, as on a statement. Two hairlines make the masthead and "
                   "nothing in it is filled. The aim is a document a reader trusts on sight, made by people who make good software."),
    "console": ("B", "The product a bid manager opens every morning. A live index down the left counts what changed: open notices, "
                     "today's new ones, those closing within 7 days, this week's awards, the organizations being watched. "
                     "White panels sit on a near-white page, and each stat tile carries its change on the line beneath. On wide "
                     "screens the tender list and the selected notice sit side by side; j and k move through the list."),
    "dossier": ("C", "The organization as a file, and the site as the archive that holds it. A strong type scale, sections numbered "
                     "like a published report and a 24 px grid under every element (the footer button draws it). Each profile opens "
                     "with a record line under the name. The home page is a dated issue, Today's sheet, led by the day's new "
                     "notices. The wordmark is the masthead."),
}
MOVES = {
    "sheet": ["The check from the mark marks awarded rows and sits in the Awarded chip",
              "A right-aligned Source column closes every table",
              "A masthead of two ink hairlines, nothing filled",
              "Amounts right-aligned in a column ruled on both sides"],
    "console": ["A live index rail with counts, amber for closing within 7 days; a strip of counts below 1000 px",
                "A split view from 1200 px: list left, notice right; j / k to move, Enter to open",
                "Stat tiles with large tabular figures and a one-line change",
                "A dense toolbar with removable filter chips below it"],
    "dossier": ["A record line under every name, in tracked capitals",
                "Today's sheet: a dated issue with a lead table and numbered sections",
                "The wordmark as masthead, one line of text links under a hairline",
                "Inset tables; the hovered row takes a 2 px emerald rule"],
}
CSS = """
:root{--bg:#fff;--ink:#111;--ink-2:#3d3d3d;--muted:#6b6b6b;--rule:#e5e5e5;--accent:#0f7b4f;color-scheme:light}
:root[data-theme="dark"]{--bg:#0e0e0e;--ink:#eee;--ink-2:#c4c4c4;--muted:#9c9c9c;--rule:#2a2a2a;--accent:#34d399;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e0e0e;--ink:#eee;--ink-2:#c4c4c4;--muted:#9c9c9c;--rule:#2a2a2a;--accent:#34d399;color-scheme:dark}}
:root[data-theme="dark"] .mark [fill="#0f7b4f"]{fill:var(--accent)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .mark [fill="#0f7b4f"]{fill:var(--accent)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-underline-offset:3px}
h1,h2,p,ul{margin:0}
.wrap{max-width:1160px;margin:0 auto;padding:0 32px}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;padding:20px 0;border-bottom:1px solid var(--ink)}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:16px}
.brand .mark{width:30px;height:30px}
.top .meta{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;font-size:13px;color:var(--ink-2)}
.tog{font:inherit;font-size:13px;color:var(--ink);background:none;border:1px solid var(--rule);border-radius:0;padding:3px 10px;cursor:pointer}
.intro{padding:40px 0 8px;max-width:760px}
.intro h1{font-size:32px;line-height:1.15;font-weight:600;letter-spacing:-.025em}
.intro p{margin-top:12px;color:var(--ink-2)}
.dir{display:grid;grid-template-columns:minmax(0,1fr) 384px;gap:24px 48px;padding:40px 0;border-bottom:1px solid var(--rule)}
.k{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.dir h2{font-size:26px;font-weight:600;letter-spacing:-.02em;margin:4px 0 12px}
.txt>p{color:var(--ink-2);max-width:620px}
.moves{margin-top:14px;padding-left:18px;color:var(--ink-2);font-size:14px}
.moves li{margin:3px 0}
.links{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}
.links a{display:inline-block;border:1px solid var(--ink);color:var(--ink);text-decoration:none;padding:6px 14px;font-size:14px;font-weight:500}
.links a:hover{background:var(--ink);color:var(--bg)}
.pv{width:384px;height:240px;overflow:hidden;border:1px solid var(--rule);position:relative}
.pv iframe{width:1280px;height:800px;border:0;transform:scale(.3);transform-origin:0 0;pointer-events:none;position:absolute;left:0;top:0}
.sws{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
.swh{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.sw ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px}
.sw li{display:grid;grid-template-columns:28px minmax(0,1fr);column-gap:8px;font-size:12px;line-height:1.3}
.sq{grid-row:span 2;width:28px;height:28px;border:1px solid var(--rule)}
.sw b{font-weight:500}
.sw code{font:inherit;color:var(--muted)}
.foot{padding:24px 0 48px;font-size:13px;color:var(--ink-2)}
@media (max-width:899px){.dir{grid-template-columns:minmax(0,1fr)}.pv{order:-1}}
@media (max-width:699px){.wrap{padding:0 16px}.sws{grid-template-columns:minmax(0,1fr)}.pv{width:320px;height:200px}.pv iframe{transform:scale(.25)}.top .meta{margin-left:0;width:100%}}
"""

INTRO = ("Each direction has the same three pages with the same real records: today's page, the open tender list and the "
         "profile of WSP Canada Inc., from the CanadaBuys files of 2026-10-31. All three set Inter alone and use white and "
         "near-white neutrals, near-black ink, the mark's emerald for open, awarded, links and the check, and one amber for "
         "closing within 7 days. Corners are square, borders are 1 px, buttons are flat, and there are no shadows, gradients "
         "or images. Every page has a light and a dark scheme (the toggle is shared), restacks its tables below 700 px, and "
         "never scrolls sideways. Figures shown as [n] need the open-notices file, which the samples do not include.")


def index_page() -> str:
    blocks = []
    for d in ("sheet", "console", "dossier"):
        letter, text = POV[d]
        sw = ""
        for scheme in ("light", "dark"):
            cells = "".join(f'<li><span class="sq" style="background:{h}"></span><b>{n}</b><code>{h}</code></li>'
                            for n, h in SWATCHES[d][scheme])
            sw += f'<div class="sw"><p class="swh">{scheme.title()} scheme</p><ul>{cells}</ul></div>'
        moves = "".join(f"<li>{e(m)}</li>" for m in MOVES[d])
        blocks.append(f"""<section class="dir" id="{d}">
<div class="txt">
<p class="k">Direction {letter}</p>
<h2>{NAMES[d]}</h2>
<p>{e(text)}</p>
<ul class="moves">{moves}</ul>
<p class="links"><a href="{d}/home.html">Today</a><a href="{d}/tenders.html">Open tenders</a><a href="{d}/organization.html">WSP Canada Inc.</a></p>
</div>
<div class="pv" aria-hidden="true"><iframe src="{d}/home.html" tabindex="-1" loading="lazy" title="{NAMES[d]} home, preview"></iframe></div>
<div class="sws">{sw}</div>
</section>""")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Award Watch: identity directions, round two</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONT['sheet']}">
<link rel="icon" type="image/svg+xml" href="../../brand/favicon-w.svg">
{HEAD_JS}
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top"><span class="brand">{MARK}<span>Award Watch</span></span><div class="meta"><span>Identity directions, round two</span><span>Mockups dated 2026-10-31</span>{TOG}</div></header>
<div class="intro" id="main"><h1>Three directions for the site</h1>
<p>{e(INTRO)}</p></div>
{"".join(blocks)}
<p class="foot">Inter is under the SIL Open Font License 1.1. Data: CanadaBuys tender notices, award notices and contract history, Open Government Licence, Canada. The FR switch is not wired in the mockups.</p>
</div>
{JS}
</body>
</html>
"""


if __name__ == "__main__":
    text = index_page()
    assert "—" not in text
    (OUT / "index.html").write_text(text, encoding="utf-8", newline="\n")
    print(f"index.html {len(text.encode('utf-8')):,} bytes")
