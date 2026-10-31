"""Write the nine identity mockup pages from data.json (computed by extract.py)."""
import html
import json
import re
from datetime import date
from pathlib import Path

REPO = Path(r"C:/Users/kylep/OneDrive/Desktop/Repositories/public-money-watch")
OUT = REPO / "design" / "identities"
D = json.loads(Path(__file__).with_name("data.json").read_text(encoding="utf-8"))
TODAY = date(2026, 10, 31)
SITE = "Award Watch"
TAGLINE = "Federal tenders, contract awards, grants and lobbying, filed under the organizations named in them."


def e(s) -> str:
    return html.escape(str(s), quote=True)


# ---------------------------------------------------------------- directions
MARK_FILES = {"ledger": "aw-a-monogram-tile.svg", "signal": "aw-b-treemap.svg", "civic": "aw-c-lens.svg"}


def mark_path(fname: str) -> str:
    text = (REPO / "brand" / fname).read_text(encoding="utf-8")
    return re.search(r"<path\b[^>]*/>", text).group(0)


def mark_two_tone() -> str:
    """brand/mark-two-tone.svg as the file has it, with a class and aria-hidden added to the root."""
    text = (REPO / "brand" / "mark-two-tone.svg").read_text(encoding="utf-8")
    svg = re.search(r"<svg\s.*</svg>", text, re.S).group(0)
    svg = svg.replace("<svg ", '<svg class="mark" aria-hidden="true" focusable="false" ', 1)
    return "<!-- Mark: brand/mark-two-tone.svg as the file has it (built by brand/make_mark.py). -->" + svg


MARK = mark_two_tone()


def mark_svg(d: str) -> str:
    fname = MARK_FILES[d]
    extra = ""
    note = f"Mark: brand/{fname}. To re-pair, replace the path with the one from another mark file."
    if d == "signal":
        # The largest block repeated on top so it can take the accent; delete for a one-colour mark.
        extra = '<path class="mark-accent" d="M2 2h16v18H2z"/>'
        note += " The second path repeats the largest block in the accent colour."
    return (f'<!-- {note} -->'
            f'<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">{mark_path(fname)}{extra}</svg>')


FONTS = {
    "ledger": "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap",
    "signal": "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    "civic": "https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap",
}
NAMES = {"ledger": "Ledger", "signal": "Signal", "civic": "Civic"}

# ---------------------------------------------------------------- reference lists
SEGMENTS = {
    "25": "Commercial and Military and Private Vehicles and their Accessories and Components",
    "31": "Manufacturing Components and Supplies",
    "32": "Electronic Components and Supplies",
    "40": "Distribution and Conditioning Systems and Equipment and Components",
    "41": "Laboratory and Measuring and Observing and Testing Equipment",
    "46": "Defense and Law Enforcement and Security and Safety Equipment and Supplies",
    "72": "Building and Facility Construction and Maintenance Services",
    "80": "Management and Business Professionals and Administrative Services",
    "81": "Engineering and Research and Technology Based Services",
    "86": "Education and Training Services",
    "95": "Land and Buildings and Structures and Land Ways",
}
PROVINCES = ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador",
             "Northwest Territories", "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island",
             "Quebec", "Saskatchewan", "Yukon"]
PROV_CODE = {"Quebec": "QC", "QC": "QC", "Québec": "QC", "Ontario": "ON", "BC": "BC"}
CITY_FOLD = {"Quebec": "Québec"}


# ---------------------------------------------------------------- formatting
def money(v: float, d: str) -> str:
    if d == "ledger":
        return f"{v:,.2f}"
    return f"${v:,.0f}"


def big_money(v: float) -> str:
    if v >= 1e9:
        return f"${v / 1e9:.2f} billion"
    return f"${v / 1e6:.2f} million"


def closing(t) -> tuple[str, str]:
    return t["closing"][:10], t["closing"][11:16]


def days_left(t) -> int:
    return (date.fromisoformat(t["closing"][:10]) - TODAY).days


def days_text(n: int) -> str:
    return "in 1 day" if n == 1 else f"in {n} days"


def regions(t) -> str:
    r = t["regions"]
    if not r:
        return "Not stated"
    if len(r) <= 3:
        return ", ".join(r)
    return ", ".join(r[:2]) + f" and {len(r) - 2} more"


def category(t) -> str:
    return " and ".join(t["category"]) or "Not stated"


def amend_n(x: str) -> int:
    try:
        return int(x)
    except ValueError:
        return 0


def competitive_parts(a) -> tuple[str, str]:
    m = a["method"]
    if a["competitive"] is None:
        return "Not stated", ""
    if a["competitive"]:
        return "Competitive", m.split(" - ", 1)[1] if " - " in m else ""
    return "Non-competitive", "" if m == "Non-competitive" else m


def award_url(ref: str) -> str:
    return f"https://canadabuys.canada.ca/en/tender-opportunities/award-notice/{ref.lower()}"


def tags(t, d: str) -> str:
    n = amend_n(t["amendment"])
    if d == "signal":
        out = f'<span class="status">{e(t["status"])}</span>'
        if n:
            out += f'<span class="badge">Amendment {n}</span>'
        return out
    out = f'<span class="tag tag-open">{e(t["status"])}</span>'
    if n:
        out += f'<span class="tag tag-quiet">Amendment {n}</span>'
    return out


def bar(pct: float, cls_track: str = "bar-track") -> str:
    if pct <= 0:
        return ""
    return f'<span class="{cls_track}"><span class="bar" style="--w:{pct:.2f}%"></span></span>'


# ---------------------------------------------------------------- table builder
def td(label: str, inner: str, cls: str = "") -> str:
    c = f' class="{cls}"' if cls else ""
    return f'<td data-label="{e(label)}"{c}><div class="v">{inner}</div></td>'


def table(cls: str, caption: str, heads, rows, foot=None) -> str:
    th = []
    for label, hcls, sort in heads:
        c = f' class="{hcls}"' if hcls else ""
        if sort == "asc":
            th.append(f'<th scope="col"{c} aria-sort="ascending"><button type="button" class="sort">{label} <span aria-hidden="true">&#8593;</span></button></th>')
        elif sort:
            th.append(f'<th scope="col"{c}><button type="button" class="sort">{label} <span aria-hidden="true">&#8597;</span></button></th>')
        else:
            th.append(f"<th scope=\"col\"{c}>{label}</th>")
    body = "\n".join("<tr>" + "".join(r) + "</tr>" for r in rows)
    tf = ""
    if foot:
        tf = "<tfoot>" + "".join("<tr>" + "".join(r) + "</tr>" for r in foot) + "</tfoot>"
    return (f'<table class="data {cls}">\n<caption class="visually-hidden">{e(caption)}</caption>\n'
            f'<thead><tr>{"".join(th)}</tr></thead>\n<tbody>\n{body}\n</tbody>{tf}\n</table>')


# ---------------------------------------------------------------- rows
TENDERS = D["tenders"]
BY_CLOSING = sorted(TENDERS, key=lambda t: (t["closing"], t["title"]))


def buyer_cell(t) -> str:
    out = e(t["buyer"])
    if t["end_user"] and t["end_user"] != t["buyer"]:
        out += f'<span class="meta">for {e(t["end_user"])}</span>'
    return out


def tender_title(t, with_published: bool = False) -> str:
    bits = [e(t["reference"]), e(t["notice_type"])]
    n = amend_n(t["amendment"])
    if n and not with_published:
        bits.append(f"Amendment {n}")
    if with_published:
        bits.append('<span class="nw">Published ' + (e(t["published"]) if t["published"] else "date not stated") + "</span>")
    return f'<a href="{e(t["url"])}">{e(t["title"])}</a><span class="meta">{" · ".join(bits)}</span>'


def category_cell(t) -> str:
    out = e(category(t))
    if t["subject"]:
        out += f'<span class="meta">{e(t["subject"])}</span>'
    return out


def new_today_table(d: str) -> str:
    rows = []
    for t in TENDERS:
        dt, tm = closing(t)
        rows.append([
            td("Notice", tender_title(t), "lead"),
            td("Buyer", buyer_cell(t)),
            td("Category", category_cell(t)),
            td("Closes", f'{dt}<span class="when">{tm}</span>', "num"),
            td("Region", e(regions(t))),
        ])
    heads = [("Notice", "", None), ("Buyer", "", None), ("Category", "", None), ("Closes", "num", None), ("Region of delivery", "", None)]
    return table("t-new", "Tender notices new today", heads, rows)


def closing_soon_table(d: str) -> str:
    rows = []
    for t in BY_CLOSING[:8]:
        dt, tm = closing(t)
        rows.append([
            td("Closes", f'{dt}<span class="when">{days_text(days_left(t))}, {tm}</span>', "num"),
            td("Notice", tender_title(t), "lead"),
            td("Buyer", buyer_cell(t)),
        ])
    heads = [("Closes", "num", None), ("Notice", "", None), ("Buyer", "", None)]
    return table("t-closing", "Notices closing soonest", heads, rows)


RECENT = D["recent"][:8]


def instrument_label(a) -> str:
    return a["instrument"] or "Instrument not stated"


def recent_table(d: str) -> str:
    rows = []
    for a in RECENT:
        label, detail = competitive_parts(a)
        v = a["value"]
        amt = money(v, d)
        amt_html = f'<span class="zero">{amt}</span>' if v == 0 else amt
        rows.append([
            td("Award", f'<a href="{award_url(a["reference"])}">{e(a["title"])}</a><span class="meta">{e(a["reference"])} · {e(instrument_label(a))}</span>', "lead"),
            td("Supplier", f'<a href="#">{e(a["supplier"])}</a>'),
            td("Buyer", e(a["buyer"])),
            td("Amount", amt_html, "num amt"),
            td("Awarded", e(a["awarded"]), "num"),
            td("Process", e(label) + (f'<span class="meta">{e(detail)}</span>' if detail else "")),
        ])
    heads = [("Award", "", None), ("Supplier", "", None), ("Buyer", "", None),
             ("Amount ($)" if d == "ledger" else "Amount", "num amt", None), ("Awarded", "num", None), ("Competitive or not", "", None)]
    return table("t-awards", "Most recent awards", heads, rows)


TOP = D["top_orgs"]


def top_table(d: str) -> str:
    rows = []
    mx = TOP[0]["total"]
    for i, o in enumerate(TOP, 1):
        name = f'<a href="#">{e(o["name"])}</a>'
        if o["spellings"] > 1:
            name += f'<span class="meta">{o["spellings"]} spellings</span>'
        if d == "signal":
            name += bar(100 * o["total"] / mx)
        rows.append([
            td("Rank", str(i), "num"),
            td("Organization", name, "lead"),
            td("Notices", str(o["n"]), "num"),
            td("Non-competitive", f'{o["noncomp"]} of {o["stated"]}', "num"),
            td("Total", money(o["total"], d), "num amt"),
        ])
    heads = [("Rank", "num", None), ("Organization", "", None), ("Notices", "num", None),
             ("Non-competitive", "num", None), ("Total ($)" if d == "ledger" else "Total", "num amt", None)]
    return table("t-top", "Top organizations by award value, 2026", heads, rows)


def tenders_table(d: str) -> str:
    rows = []
    for t in BY_CLOSING:
        dt, tm = closing(t)
        rows.append([
            td("Status", tags(t, d)),
            td("Notice", tender_title(t, with_published=True), "lead"),
            td("Buyer", buyer_cell(t)),
            td("Category", category_cell(t)),
            td("Region", e(regions(t))),
            td("Closes", f'{dt}<span class="when">{tm}, {days_text(days_left(t))}</span>', "num"),
        ])
    heads = [("Status", "", None), ("Notice", "", "sort"), ("Buyer", "", "sort"), ("Category", "", None),
             ("Region of delivery", "", None), ("Closes", "num", "asc")]
    return table("t-tenders", "Open tender notices, sorted by closing date", heads, rows)


# ---------------------------------------------------------------- profile data
P = D["profile"]
YEARS = P["years"]


def places() -> list[tuple[str, int]]:
    folded: dict[str, int] = {}
    for p in P["places"]:
        city = CITY_FOLD.get(p["city"], p["city"])
        key = f'{city}, {PROV_CODE.get(p["prov"], p["prov"])}'
        folded[key] = folded.get(key, 0) + p["n"]
    return sorted(folded.items(), key=lambda kv: -kv[1])


PLACES = places()
ZERO_ROWS = [a for a in P["awards"] if a["value"] == 0]
ZERO_SO_SA = sum(1 for a in ZERO_ROWS if a["instrument"] in ("Standing Offer", "Supply Arrangement"))


def fig_cell(y: dict, d: str) -> str:
    n = y["n"]
    inner = (f'<span class="total">{money(y["total"], d)}</span>'
             f'<span class="n">{n} notice{"s" if n != 1 else ""}</span>'
             f'<span class="nc">Non-competitive {y["noncomp_n"]} of {y["stated_n"]}</span>'
             f'<span class="nc">by value {money(y["noncomp_total"], d)} of {money(y["stated_total"], d)}</span>')
    return inner


def none_cell(label: str) -> str:
    return f'<td data-label="{e(label)}" class="fig-cell none"><div class="v">Not loaded</div></td>'


SOURCES = ["PSPC contract history", "Published contracts", "Grants and contributions", "Lobbying"]


def figures_table(d: str) -> str:
    rows = []
    for yr, y in YEARS.items():
        rows.append([td("Year", yr), f'<td data-label="Award notices" class="fig-cell"><div class="v">{fig_cell(y, d)}</div></td>']
                    + [none_cell(s) for s in SOURCES])
    tot = {"n": P["rows"], "total": P["total"],
           "noncomp_n": sum(y["noncomp_n"] for y in YEARS.values()),
           "stated_n": sum(y["stated_n"] for y in YEARS.values()),
           "noncomp_total": sum(y["noncomp_total"] for y in YEARS.values()),
           "stated_total": sum(y["stated_total"] for y in YEARS.values())}
    foot = [[td("Year", "All years"), f'<td data-label="Award notices" class="fig-cell"><div class="v">{fig_cell(tot, d)}</div></td>']
            + [none_cell(s) for s in SOURCES]]
    heads = [("Year", "", None), ("Award notices", "num", None)] + [(s, "num", None) for s in SOURCES]
    return table("figures", "Figures by year and source", heads, rows, foot)


def wsp_awards_table(d: str, limit: int = 10) -> str:
    rows = []
    for a in P["awards"][:limit]:
        label, detail = competitive_parts(a)
        v = a["value"]
        amt = money(v, d)
        meta = [e(a["reference"]), e(instrument_label(a))]
        if amend_n(a["amendment"]):
            meta.append(f'Amendment {amend_n(a["amendment"])}')
        buyer = e(a["buyer"])
        if a["end_user"] and a["end_user"] != a["buyer"]:
            buyer += f'<span class="meta">for {e(a["end_user"])}</span>'
        rows.append([
            td("Awarded", e(a["awarded"]), "num"),
            td("Notice", f'<a href="{award_url(a["reference"])}">{e(a["title"])}</a><span class="meta">{" · ".join(meta)}</span>', "lead"),
            td("Buyer", buyer),
            td("Process", e(label) + (f'<span class="meta">{e(detail)}</span>' if detail else "")),
            td("Amount", f'<span class="zero">{amt}</span>' if v == 0 else amt, "num amt"),
        ])
    heads = [("Awarded", "num", "asc"), ("Notice", "", None), ("Buyer", "", None), ("Competitive or not", "", None),
             ("Amount ($)" if d == "ledger" else "Amount", "num amt", "sort")]
    return table("t-wsp", "Award notices, newest first", heads, rows)


def buyers_table(d: str) -> str:
    rows = []
    mx = P["buyers"][0]["total"]
    for b in P["buyers"]:
        name = e(b["buyer"])
        if d in ("signal", "civic"):
            name += bar(100 * b["total"] / mx, "bar-track" if d == "signal" else "track")
        rows.append([td("Buyer", name, "lead"), td("Notices", str(int(b["n"])), "num"), td("Total", money(b["total"], d), "num amt")])
    heads = [("Buyer", "", None), ("Notices", "num", None), ("Total ($)" if d == "ledger" else "Total", "num amt", None)]
    return table("t-buyers", "Buyers of this organization's award notices", heads, rows)


EMPTY = [
    ("PSPC contract history", "Contracts awarded through Public Services and Procurement Canada, from its monthly contract history file.",
     "CanadaBuys contract history (PSPC)"),
    ("Published contracts", "Contracts over $10,000 that federal departments publish each quarter.",
     "open.canada.ca, proactive publication of contracts over $10,000"),
    ("Grants and contributions", "Grant and contribution agreements that federal departments publish each quarter.",
     "open.canada.ca, proactive publication of grants and contributions"),
    ("Lobbying", "Monthly communication reports filed for this organization.",
     "Office of the Commissioner of Lobbying of Canada, Registry of Lobbyists"),
]


def empties(d: str) -> str:
    out = []
    for title, desc, src in EMPTY:
        out.append(f'<section class="empty-sec"><h3>{e(title)}</h3><div class="empty"><p>No records loaded for this mockup.</p>'
                   f'<p class="src">{e(desc)} Source: {e(src)}.</p></div></section>')
    return "\n".join(out)


def footnotes() -> str:
    return f"""<h2 id="counting">How these figures are counted</h2>
<ol>
<li id="fn-noncomp">Non-competitive counts the notices whose procurement method CanadaBuys gives as "Non-competitive" or "Advance contract award notice". Every "Competitive" method counts as competitive. A notice with no method is unstated and sits outside both numbers. The share is shown by count and by value, each with its denominator. Where a limited tendering reason applies, the notice on CanadaBuys gives it.</li>
<li>Award notices count one contract per reference number. Its value is the total contract value on the newest amendment when that is above zero, otherwise the contract amount. A cancelled notice counts zero. {len(ZERO_ROWS)} of the {P["rows"]} notices here carry a value of zero ({ZERO_SO_SA} of them standing offers or supply arrangements) and are shown as published.</li>
<li>Amounts in a currency other than Canadian dollars are shown with their currency and left out of totals. None of this organization's notices are in another currency.</li>
<li>Years are calendar years of the award date. Each source is totalled by its own rules, and no figure on this page adds two sources together.</li>
<li>Names are merged when they match once case, punctuation and legal suffixes are set aside. The {len(P["spellings"])} spellings listed above reduce to the same name.</li>
</ol>
<p class="mock-note">This mockup reads one file: the CanadaBuys award notices for fiscal year 2026-2027, published from 2026-04-01. The 2023 and 2024 rows are older contracts whose notices were published or amended since then; the complete award file adds the rest.</p>"""


def spellings_list() -> str:
    return "".join(f"<li>{e(k)} ({v})</li>" for k, v in P["spellings"].items())


def places_text() -> str:
    return "; ".join(f"{e(k)} ({v})" for k, v in PLACES)


# ---------------------------------------------------------------- page chrome
NAV = [("Tenders", "tenders.html"), ("Awards", "#"), ("Organizations", "organization.html"), ("Buyers", "#"),
       ("Categories", "#"), ("Rankings", "#"), ("Data", "#")]


def nav_items(current: str) -> str:
    out = []
    for label, href in NAV:
        cur = ' aria-current="page"' if label == current else ""
        out.append(f'<li><a href="{href}"{cur}>{label}</a></li>')
    return "".join(out)


ASOF = '<span class="asof">Data as of <time datetime="2026-10-31">2026-10-31</time></span>'
LANG = '<a class="lang" href="#" lang="fr" hreflang="fr" aria-label="Français">FR</a>'
TOGGLE = ('<button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch colour scheme">'
          '<span class="to-dark">Dark</span><span class="to-light">Light</span></button>')


def header(d: str, current: str) -> str:
    brand = f'<a class="brand" href="home.html">{MARK}<span class="brand-name">{SITE}</span></a>'
    if d == "ledger":
        return f"""<header class="site-head">
<div class="wrap head-inner">
{brand}
<p class="tagline">{TAGLINE}</p>
<div class="utils">{ASOF}{LANG}{TOGGLE}</div>
</div>
<nav class="site-nav" aria-label="Main"><div class="wrap"><ul>{nav_items(current)}</ul></div></nav>
</header>"""
    if d == "signal":
        return f"""<header class="site-head">
<div class="wrap head-inner">
<div class="brand-block">{brand}<p class="tagline">{TAGLINE}</p></div>
<nav class="site-nav" aria-label="Main"><ul>{nav_items(current)}</ul></nav>
<div class="utils">{ASOF}{LANG}{TOGGLE}</div>
</div>
</header>"""
    return f"""<header class="site-head">
<div class="wrap">
<div class="dateline"><span>Data as of <time datetime="2026-10-31">Saturday, 2026-10-31</time></span><span class="utils">{LANG}{TOGGLE}</span></div>
<div class="nameplate">{brand}<p class="tagline">{TAGLINE}</p></div>
</div>
<nav class="site-nav" aria-label="Main"><div class="wrap"><ul>{nav_items(current)}</ul></div></nav>
</header>"""


def footer(d: str) -> str:
    return f"""<footer class="site-foot"><div class="wrap"><div>
<p>Source: CanadaBuys tender and award notices (Public Services and Procurement Canada), Open Government Licence, Canada.</p>
<ul class="foot-links"><li><a href="#">Methodology</a></li><li><a href="#">Data downloads</a></li><li><a href="#">Feeds</a></li><li><a href="#">Cite</a></li><li><a href="#">Corrections</a></li></ul>
<p>{SITE} · awardwatch.ca</p>
<p class="mock-note">Design mockup, {NAMES[d]} direction. Every row is a real record from the CanadaBuys files of 2026-10-31. Counts in square brackets need files the samples do not include.</p>
</div></div></footer>"""


THEME_INIT = ('<script>try{var t=localStorage.getItem("aw-theme");'
              'if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>')
THEME_TOGGLE = ('<script>document.querySelector("[data-theme-toggle]").addEventListener("click",function(){'
                'var r=document.documentElement,c=r.getAttribute("data-theme")||'
                '(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),n=c==="dark"?"light":"dark";'
                'r.setAttribute("data-theme",n);try{localStorage.setItem("aw-theme",n)}catch(e){}});</script>')
CHIPS_JS = ('<script>document.querySelectorAll(".chips").forEach(function(g){g.addEventListener("click",function(ev){'
            'var b=ev.target.closest(".chip");if(!b)return;g.querySelectorAll(".chip").forEach(function(x){'
            'x.setAttribute("aria-pressed",x===b?"true":"false")})})});</script>')


def page(d: str, title: str, body_cls: str, current: str, main: str, extra_js: str = "") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · {SITE} ({NAMES[d]} mockup)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS[d]}">
<link rel="stylesheet" href="style.css">
<link rel="icon" type="image/svg+xml" href="../../../brand/favicon.svg">
{THEME_INIT}
</head>
<body class="{body_cls}">
<a class="skip" href="#main">Skip to content</a>
{header(d, current)}
<main id="main" class="wrap">
{main}
</main>
{footer(d)}
{THEME_TOGGLE}{extra_js}
</body>
</html>
"""


# ---------------------------------------------------------------- home
S = D["stats"]
CLOSING_7 = S["tenders_closing_7d"]
TILES = [
    ("Open tenders", "[count]", True, "", "Counted from the open-notices file, which the samples do not include.", "Browse open notices", "tenders.html"),
    ("New today", f'{S["tenders_new"]}', False, "", "Notices in the new-notices file of 2026-10-31.", "See today's notices", "#new"),
    ("Closing within 7 days", "[count]", True, "",
     f"{CLOSING_7} of today's {S['tenders_new']} new notices closes by 2026-11-07. The full count needs the open-notices file.", "See what closes soon", "#closing"),
    ("Awards this year", f'{S["awards_2026_rows"]:,}', False, big_money(S["awards_2026_value"]),
     f'Award notices dated 2026 in the 2026-2027 award file, valued by the counting rules. {S["awards_2026_noncad"]} in other currencies are left out of the value.',
     "See recent awards", "#awards"),
]


def tiles(d: str) -> str:
    out = []
    for label, fig, pending, sub, note, go, href in TILES:
        cls = "fig pending" if pending else "fig"
        sub_html = f'<dd class="sub">{e(sub)}</dd>' if sub else ""
        go_html = f'<dd class="go"><a href="{href}">{e(go)}</a></dd>' if d == "signal" else ""
        wrap = "pull" if d == "civic" else "tile"
        out.append(f'<div class="{wrap}"><dt>{e(label)}</dt><dd class="{cls}">{e(fig)}</dd>{sub_html}<dd class="note">{e(note)}</dd>{go_html}</div>')
    cls = "band" if d == "civic" else "tiles"
    return f'<dl class="{cls}">' + "".join(out) + "</dl>"


SUB_NEW = (f"{sum(1 for t in TENDERS if t['published'])} published on CanadaBuys on 2026-10-30; "
           f"{sum(1 for t in TENDERS if not t['published'])} give no publication date. Each title links to the notice.")
SUB_CLOSING = "The eight soonest closing dates among today's notices. The site lists every open notice closing in the next 7 days."
SUB_AWARDS = "The most recent award dates in the 2026-2027 award file. Amounts are as published, zero included."
SUB_TOP = "Ranked by the value of award notices dated 2026. Other sources are ranked separately."


def home(d: str) -> str:
    if d == "ledger":
        main = f"""<div class="folio"><h1>Daily summary</h1><p>Tender and award notices from CanadaBuys, as read on 2026-10-31.</p></div>
<section aria-label="Figures">{tiles(d)}</section>
<section class="sec" id="new"><div class="sec-head"><h2>New today</h2><p class="sec-sub">{e(SUB_NEW)}</p></div>
{new_today_table(d)}
<p class="sec-foot"><a href="tenders.html">All open notices</a></p></section>
<section class="sec" id="closing"><div class="sec-head"><h2>Closing soon</h2><p class="sec-sub">{e(SUB_CLOSING)}</p></div>
{closing_soon_table(d)}</section>
<section class="sec" id="awards"><div class="sec-head"><h2>Recent awards</h2><p class="sec-sub">{e(SUB_AWARDS)}</p></div>
{recent_table(d)}
<p class="sec-foot"><a href="#">All awards</a></p></section>
<section class="sec" id="top"><div class="sec-head"><h2>Top organizations, 2026 so far</h2><p class="sec-sub">{e(SUB_TOP)}</p></div>
{top_table(d)}
<p class="sec-foot"><a href="#">Rankings by source</a></p></section>"""
        return page(d, "Daily summary", "p-home", "", main)

    if d == "signal":
        main = f"""<div class="page-head"><h1>Federal procurement, 2026-10-31</h1><p>Tender and award notices from CanadaBuys, read once a day.</p></div>
<section aria-label="Figures">{tiles(d)}</section>
<section class="card" id="new"><div class="card-head"><h2>New today</h2><p>{e(SUB_NEW)}</p></div>
{new_today_table(d)}
<div class="card-foot"><a href="tenders.html">All open notices</a></div></section>
<div class="grid-2">
<section class="card" id="closing"><div class="card-head"><h2>Closing soon</h2><p>{e(SUB_CLOSING)}</p></div>
{closing_soon_table(d)}</section>
<section class="card" id="top"><div class="card-head"><h2>Top organizations, 2026 so far</h2><p>{e(SUB_TOP)}</p></div>
{top_table(d)}
<div class="card-foot"><a href="#">Rankings by source</a></div></section>
</div>
<section class="card" id="awards"><div class="card-head"><h2>Recent awards</h2><p>{e(SUB_AWARDS)}</p></div>
{recent_table(d)}
<div class="card-foot"><a href="#">All awards</a></div></section>"""
        return page(d, "Federal procurement today", "p-home", "", main)

    # Civic: a two-column front page.
    closing_items = []
    for t in BY_CLOSING[:8]:
        dt, tm = closing(t)
        closing_items.append(
            f'<li><div class="row" style="margin-top:0"><span class="date">{dt}</span><span>{days_text(days_left(t))}, {tm}</span></div>'
            f'<a class="t" href="{e(t["url"])}">{e(t["title"])}</a><span class="sm">{e(t["buyer"])}</span></li>')
    award_items = []
    for a in RECENT:
        label, detail = competitive_parts(a)
        proc = label + (f" ({detail})" if detail else "")
        award_items.append(
            f'<li><a class="t" href="{award_url(a["reference"])}">{e(a["title"])}</a>'
            f'<span class="sm"><a href="#">{e(a["supplier"])}</a> · {e(a["buyer"])}</span>'
            f'<div class="row"><span class="amt">{money(a["value"], d)}</span><span>Awarded {e(a["awarded"])}</span></div>'
            f'<span class="sm">{e(instrument_label(a))} · {e(proc)}</span></li>')
    mx = TOP[0]["total"]
    top_items = []
    for o in TOP:
        sp = f" · {o['spellings']} spellings" if o["spellings"] > 1 else ""
        top_items.append(
            f'<li><a class="t" href="#">{e(o["name"])}</a><span class="amt">{big_money(o["total"])}</span>'
            f'<span class="sm">{o["n"]} notice{"s" if o["n"] != 1 else ""} · non-competitive {o["noncomp"]} of {o["stated"]}{sp}</span>'
            f'{bar(100 * o["total"] / mx, "track")}</li>')
    main = f"""<h1 class="visually-hidden">{SITE}, 2026-10-31</h1>
<section aria-label="Figures">{tiles(d)}</section>
<div class="front">
<section class="lead-col" id="new">
<span class="kicker">Tender watch</span>
<h2 class="headline">{S["tenders_new"]} new tender notices</h2>
<p class="dek">{e(SUB_NEW)}</p>
{new_today_table(d)}
<p class="sec-foot"><a href="tenders.html">All open notices</a></p>
</section>
<aside class="side" aria-label="Closing soon, recent awards and top organizations">
<section class="sec" id="closing"><div class="sec-head"><h2>Closing soon</h2><p>{e(SUB_CLOSING)}</p></div>
<ol class="list">{"".join(closing_items)}</ol></section>
<section class="sec" id="awards"><div class="sec-head"><h2>Recent awards</h2><p>{e(SUB_AWARDS)}</p></div>
<ol class="list">{"".join(award_items)}</ol>
<p class="sec-foot"><a href="#">All awards</a></p></section>
<section class="sec" id="top"><div class="sec-head"><h2>Top organizations, 2026 so far</h2><p>{e(SUB_TOP)}</p></div>
<ol class="list rank">{"".join(top_items)}</ol>
<p class="sec-foot"><a href="#">Rankings by source</a></p></section>
</aside>
</div>"""
    return page(d, "Front page", "p-home", "", main)


# ---------------------------------------------------------------- tenders
def options(values, all_label: str) -> str:
    return f'<option value="">{e(all_label)}</option>' + "".join(f'<option>{e(v)}</option>' for v in values)


SEG_OPTS = [f"{k} {SEGMENTS[k]}" for k in sorted({s for t in TENDERS for s in t["segments"]})]
BUYERS = sorted({t["buyer"] for t in TENDERS})
NOTICE_TYPES = sorted({t["notice_type"] for t in TENDERS})
METHODS = sorted({t["method"] for t in TENDERS})
WINDOWS = ["Within 7 days", "Within 14 days", "Within 30 days", "After 30 days"]


def field(fid: str, label: str, control: str, cls: str = "field") -> str:
    return f'<div class="{cls}"><label for="{fid}">{e(label)}</label>{control}</div>'


def sel(fid: str, values, all_label: str) -> str:
    return f'<select id="{fid}">{options(values, all_label)}</select>'


def filter_form() -> str:
    return f"""<form class="filters" role="search" aria-label="Filter open notices" onsubmit="return false">
{field("f-q", "Search titles", '<input id="f-q" type="search" placeholder="Words in the title or reference">')}
{field("f-cat", "Category", sel("f-cat", ["Goods", "Services", "Construction"], "All categories"))}
{field("f-seg", "Segment (UNSPSC)", sel("f-seg", SEG_OPTS, "All segments"))}
{field("f-prov", "Province or territory", sel("f-prov", PROVINCES, "All of Canada"))}
{field("f-buyer", "Buyer", sel("f-buyer", BUYERS, "All buyers"))}
{field("f-type", "Notice type", sel("f-type", NOTICE_TYPES, "All notice types"))}
{field("f-method", "Procurement method", sel("f-method", METHODS, "All methods"))}
{field("f-close", "Closing", sel("f-close", WINDOWS, "Any closing date"))}
<div class="actions"><button type="reset" class="btn btn-quiet">Reset</button><button type="submit" class="btn">Apply filters</button></div>
</form>"""


def pager() -> str:
    return """<nav class="pager" aria-label="Pages"><p>Rows 1 to 25 of [open count], sorted by closing date</p>
<ul><li><span class="off">Previous</span></li><li><a href="#" aria-current="page">1</a></li><li><a href="#">2</a></li><li><a href="#">3</a></li><li><span class="gap">&#8230;</span></li><li><a href="#">[last]</a></li><li><a href="#">Next</a></li></ul></nav>"""


ABOUT = """<h2>About this list</h2>
<p>Every tender notice CanadaBuys lists as open, from its open-notices file, read once a day. A notice leaves the list when it closes, is cancelled or is awarded. Filters and sorting run in your browser.</p>
<p>Region is the region of delivery the notice names. A notice for the National Capital Region appears under both Ontario and Quebec. Closing times are shown as the file gives them, without a time zone, so check the notice on CanadaBuys before bidding.</p>
<p>Each title links to the notice on CanadaBuys, where the solicitation documents, amendments and the contracting officer's contact details are published. This list does not copy contact details.</p>
<p class="mock-note">In this mockup the 25 rows are the notices from the new-notices file of 2026-10-31; the full list reads the open-notices file.</p>"""

LEAD_TENDERS = "Tender notices open on CanadaBuys, soonest closing first. Narrow the list by category, segment, region, buyer, notice type, method or closing date."


def tenders(d: str) -> str:
    if d == "ledger":
        main = f"""<div class="folio"><h1>Open tender notices</h1><p>{e(LEAD_TENDERS)}</p></div>
{filter_form()}
{tenders_table(d)}
{pager()}
<section class="note-box">{ABOUT}</section>"""
        return page(d, "Open tender notices", "p-tenders", "Tenders", main)
    if d == "civic":
        main = f"""<div class="page-title"><span class="kicker">Tender watch</span><h1>Open tender notices</h1><p>{e(LEAD_TENDERS)}</p></div>
{filter_form()}
<div class="resline"><span><strong>Rows 1 to 25</strong> of [open count]</span><span>Sorted by closing date, soonest first</span></div>
{tenders_table(d)}
{pager()}
<section class="note-box">{ABOUT}</section>"""
        return page(d, "Open tender notices", "p-tenders", "Tenders", main)
    chips_cat = "".join(f'<button type="button" class="chip" aria-pressed="{"true" if c == "All" else "false"}">{c}</button>'
                        for c in ["All", "Goods", "Services", "Construction"])
    chips_close = "".join(f'<button type="button" class="chip" aria-pressed="{"true" if c == "Any time" else "false"}">{c}</button>'
                          for c in ["Any time", "7 days", "14 days", "30 days"])
    selects = "".join([
        field("f-seg", "Segment (UNSPSC)", sel("f-seg", SEG_OPTS, "All segments"), "fb-field"),
        field("f-prov", "Province or territory", sel("f-prov", PROVINCES, "All of Canada"), "fb-field"),
        field("f-buyer", "Buyer", sel("f-buyer", BUYERS, "All buyers"), "fb-field"),
        field("f-type", "Notice type", sel("f-type", NOTICE_TYPES, "All notice types"), "fb-field"),
        field("f-method", "Procurement method", sel("f-method", METHODS, "All methods"), "fb-field"),
    ])
    main = f"""<div class="page-head"><h1>Open tender notices</h1><p>{e(LEAD_TENDERS)}</p></div>
<div class="filter-panel" role="group" aria-label="More filters"><div class="fb-selects">{selects}</div></div>
<div class="filterbar" role="search" aria-label="Filter open notices"><div class="fb-row">
<div class="search"><label class="visually-hidden" for="f-q">Search titles</label><input id="f-q" type="search" placeholder="Search titles and references"></div>
<div class="chips" role="group" aria-label="Category"><span class="lbl">Category</span>{chips_cat}</div>
<div class="chips" role="group" aria-label="Closing"><span class="lbl">Closes</span>{chips_close}</div>
<span class="fb-count">25 shown</span>
</div></div>
<section class="card"><div class="card-head"><h2>Rows 1 to 25 of [open count]</h2><p>Sorted by closing date, soonest first</p></div>
{tenders_table(d)}
{pager().replace('<nav class="pager" aria-label="Pages"><p>Rows 1 to 25 of [open count], sorted by closing date</p>', '<nav class="pager" aria-label="Pages"><p>Page 1</p>')}
</section>
<section class="note-box">{ABOUT}</section>"""
    return page(d, "Open tender notices", "p-tenders", "Tenders", main, CHIPS_JS)


# ---------------------------------------------------------------- organization
MORE = P["rows"] - 10
FIG_LEGEND = ('Each award notices cell gives the total value, the number of notices, and the non-competitive notices as n of N, '
              'by count and by value<sup><a href="#fn-noncomp">1</a></sup>. The other sources fill in on the site; '
              'this mockup loads award notices only.')
RESPOND_P = "If you represent this organization, you can send a response to these records or report one that is wrong."


def organization(d: str) -> str:
    name = e(P["display"])
    nsp = len(P["spellings"])
    first, last = P["first"], P["last"]
    more_line = (f'{MORE} more rows · <a href="#">Download CSV ({P["rows"]} rows)</a>')
    if d == "ledger":
        main = f"""<p class="crumbs"><a href="#">Organizations</a> / {name}</p>
<div class="org-head"><span class="kicker">Organization</span><h1>{name}</h1>
<dl class="facts">
<div><dt>Places seen</dt><dd>{places_text()}</dd></div>
<div><dt>Spellings</dt><dd>{nsp} spellings<details><summary>Show them</summary><ul>{spellings_list()}</ul></details></dd></div>
<div><dt>First and last seen</dt><dd>{first} to {last}<br><span class="sc" style="font-size:11px;color:var(--muted)">by award date</span></dd></div>
<div><dt>Award notices</dt><dd>{P["rows"]} notices, {money(P["total"], d)} dollars</dd></div>
</dl></div>
<section class="sec"><div class="sec-head"><h2>Figures by year</h2><p class="sec-sub">{FIG_LEGEND}</p></div>
{figures_table(d)}</section>
<section class="sec"><div class="sec-head"><h2>Award notices</h2><p class="sec-sub">Newest first, from CanadaBuys. Each title links to the notice.</p></div>
{wsp_awards_table(d)}
<p class="sec-foot">{more_line}</p></section>
<section class="sec"><div class="sec-head"><h2>Buyers</h2><p class="sec-sub">The contracting entity on each award notice. PSPC contracts on behalf of other departments, named under it.</p></div>
{buyers_table(d)}</section>
<section class="sec"><div class="sec-head"><h2>Other sources</h2><p class="sec-sub">Each source keeps its own column and its own total.</p></div>
<div class="empties">{empties(d)}</div></section>
<div class="respond"><p>{RESPOND_P}</p><p><a href="#">Respond to these records</a> · <a href="#">Report a correction</a></p></div>
<section class="footnotes">{footnotes()}</section>"""
        return page(d, P["display"], "p-org", "Organizations", main)

    if d == "signal":
        main = f"""<p class="crumbs"><a href="#">Organizations</a> / {name}</p>
<div class="org-head"><span class="kicker">Organization</span><h1>{name}</h1>
<dl class="facts">
<div><dt>Award notices</dt><dd class="big">{P["rows"]}</dd></div>
<div><dt>Value in award notices</dt><dd class="big">{money(P["total"], d)}</dd></div>
<div><dt>Places seen</dt><dd class="big">{len(PLACES)}</dd><dd>{places_text()}</dd></div>
<div><dt>Spellings</dt><dd class="big">{nsp}</dd><dd><details><summary>Show them</summary><ul>{spellings_list()}</ul></details></dd></div>
<div><dt>First and last seen</dt><dd>{first}<br>{last}</dd><dd style="color:var(--muted);font-size:12px">by award date</dd></div>
</dl></div>
<section class="card"><div class="card-head"><h2>Figures by year</h2><p>{FIG_LEGEND}</p></div>
{figures_table(d)}</section>
<div class="grid-main">
<section class="card"><div class="card-head"><h2>Award notices</h2><p>Newest first, from CanadaBuys</p></div>
{wsp_awards_table(d)}
<div class="card-foot">{more_line}</div></section>
<div>
<section class="card"><div class="card-head"><h2>Buyers</h2><p>Contracting entity on each notice</p></div>
{buyers_table(d)}
<div class="card-foot">PSPC contracts on behalf of other departments, named under each notice.</div></section>
<section class="card respond-card"><div class="card-head"><h2>Respond</h2></div><div class="card-body"><p>{RESPOND_P}</p>
<a class="btn" href="#">Respond to these records</a> <a class="btn btn-quiet" href="#">Report a correction</a></div></section>
</div>
</div>
<section class="card"><div class="card-head"><h2>Other sources</h2><p>Each source keeps its own column and its own total.</p></div>
<div class="grid-4">{empties(d)}</div></section>
<section class="card footnotes"><div class="card-head">{footnotes().split(chr(10), 1)[0]}</div>{footnotes().split(chr(10), 1)[1]}</section>"""
        return page(d, P["display"], "p-org", "Organizations", main)

    band = f"""<dl class="band org-band">
<div class="pull"><dt>Award notices, total value</dt><dd class="fig">{big_money(P["total"]).replace(" million", "M")}</dd><dd class="note">{money(P["total"], d)} over {P["rows"]} notices, {first[:4]} to {last[:4]}, by the counting rules.</dd></div>
<div class="pull"><dt>Award notices</dt><dd class="fig">{P["rows"]}</dd><dd class="note">Newest awarded {last}.</dd></div>
<div class="pull"><dt>Buyers</dt><dd class="fig">{len(P["buyers"])}</dd><dd class="note">Contracting entities on the notices.</dd></div>
<div class="pull"><dt>Places seen</dt><dd class="fig">{len(PLACES)}</dd><dd class="note">Supplier addresses on the notices.</dd></div>
</dl>"""
    main = f"""<p class="crumbs"><a href="#">Organizations</a> / {name}</p>
<div class="org-head"><span class="kicker">Organization profile</span><h1>{name}</h1>
<p class="facts-line"><span><strong>Places seen:</strong> {places_text()}</span><span><strong>{nsp} spellings</strong> (listed at right)</span><span><strong>First seen</strong> {first}, <strong>last seen</strong> {last}, by award date</span></p></div>
{band}
<section class="sec"><div class="sec-head"><h2>Figures by year</h2><p>{FIG_LEGEND}</p></div>
{figures_table(d)}</section>
<div class="cols" style="margin-top:1.9rem">
<div class="main">
<section class="sec"><div class="sec-head"><h2>Award notices</h2><p>Newest first, from CanadaBuys. Each title links to the notice.</p></div>
{wsp_awards_table(d)}
<p class="sec-foot">{more_line}</p></section>
</div>
<aside class="side" aria-label="Buyers, spellings and responses">
<section class="side-box"><div class="sec-head"><h2>Buyers</h2><p>Contracting entity on each notice. PSPC contracts on behalf of other departments.</p></div>
{buyers_table(d)}</section>
<section class="side-box"><div class="sec-head"><h2>Spellings</h2><p>Names on the notices that reduce to this one.</p></div>
<ol class="list">{"".join(f'<li><span class="t">{e(k)}</span><span class="sm">{v} notice{"s" if v != 1 else ""}</span></li>' for k, v in P["spellings"].items())}</ol></section>
<section class="side-box respond"><h2>Respond</h2><p>{RESPOND_P}</p><p><a href="#">Respond to these records</a></p><p><a href="#">Report a correction</a></p></section>
</aside>
</div>
<section class="sec"><div class="sec-head"><h2>Other sources</h2><p>Each source keeps its own column and its own total.</p></div>
<div class="empties">{empties(d)}</div></section>
<section class="footnotes">{footnotes()}</section>"""
    return page(d, P["display"], "p-org", "Organizations", main)


# ---------------------------------------------------------------- write
def main() -> None:
    for d in ("ledger", "signal", "civic"):
        for fname, fn in (("home.html", home), ("tenders.html", tenders), ("organization.html", organization)):
            (OUT / d / fname).write_text(fn(d), encoding="utf-8", newline="\n")
    print("written")


if __name__ == "__main__":
    main()
