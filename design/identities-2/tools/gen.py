"""Write the nine second-round mockup pages (Sheet, Console, Dossier) from
data.json (extract.py) and extra.json (extract2.py). The stylesheets are
hand-written beside the pages; this script writes HTML only."""
import html
import json
import re
import urllib.parse
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
REPO = OUT.parents[1]
D = json.loads((HERE / "data.json").read_text(encoding="utf-8"))
X = json.loads((HERE / "extra.json").read_text(encoding="utf-8"))
TODAY = date(2026, 10, 31)
ORG_ID = "org-269e65b4fe"  # normalize.org_id("wsp canada")
NAMES = {"sheet": "Sheet", "console": "Console", "dossier": "Dossier"}
FONT = {
    "sheet": "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap",
    "console": "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap",
    "dossier": "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap",
}
DS_AWARDS = "https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb"
DS_HISTORY = "https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4"
DS_TENDERS = "https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2"


def e(s) -> str:
    return html.escape(str(s), quote=True)


# ---------------------------------------------------------------- brand
_mark = (REPO / "brand" / "mark-two-tone.svg").read_text(encoding="utf-8")
MARK = ("<!-- brand/mark-two-tone.svg as filed -->"
        + re.search(r"<svg\s.*</svg>", _mark, re.S).group(0).replace("<svg ", '<svg class="mark" aria-hidden="true" focusable="false" ', 1))
CHECK_D = re.findall(r' d="([^"]+)"', _mark)[2]
# The mark's own check path, cropped to its bounds, defined once per page and reused by <use>.
CHECK_DEF = ('<svg width="0" height="0" style="position:absolute" aria-hidden="true">'
             f'<symbol id="ck" viewBox="19.6 6.9 12.2 17.9"><path fill="currentColor" d="{CHECK_D}"/></symbol></svg>')
CK = '<svg class="ck" aria-hidden="true" focusable="false"><use href="#ck"/></svg>'
_wm = (REPO / "brand" / "wordmark.svg").read_text(encoding="utf-8")
WORDMARK = ("<!-- brand/wordmark.svg as filed -->"
            + re.search(r"<svg\s.*</svg>", _wm, re.S).group(0).replace("<svg ", '<svg aria-hidden="true" focusable="false" ', 1))

HEAD_JS = ('<script>try{var t=localStorage.getItem("aw-theme");'
           'if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>')
LANG = '<span class="lang"><b>EN</b><a href="#" hreflang="fr" lang="fr" title="French (not wired in this mockup)">FR</a></span>'
TOG = '<button class="tog" type="button" data-theme-toggle>Dark</button>'
DATE = 'Data as of <time datetime="2026-10-31">2026-10-31</time>'

# Theme toggle, removable filter chips, watch buttons, sortable headers.
JS = """<script>
(function(){
var r=document.documentElement,b=document.querySelector("[data-theme-toggle]");
function cur(){return r.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}
function lab(){var d=cur()==="dark";b.textContent=d?"Light":"Dark";b.setAttribute("aria-label",d?"Switch to the light scheme":"Switch to the dark scheme")}
if(b){b.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";r.setAttribute("data-theme",n);try{localStorage.setItem("aw-theme",n)}catch(e){}lab()});lab()}
document.addEventListener("click",function(ev){
var x=ev.target.closest(".fchip button");if(x){x.parentNode.remove();return}
var w=ev.target.closest("[data-watch]");if(w){var p=w.getAttribute("aria-pressed")==="true";w.setAttribute("aria-pressed",String(!p));w.querySelector("span").textContent=p?w.dataset.off:w.dataset.on;return}
var g=ev.target.closest("[data-toggle]");if(g){g.setAttribute("aria-pressed",String(g.getAttribute("aria-pressed")!=="true"))}
var s=ev.target.closest("th[data-k] button");if(!s)return;
var th=s.parentNode,t=th.closest("table"),i=[].indexOf.call(th.parentNode.children,th),d=th.getAttribute("aria-sort")==="ascending"?-1:1,n=th.dataset.k==="n",tb=t.tBodies[0];
[].slice.call(tb.rows).sort(function(a,c){var p=a.cells[i],q=c.cells[i],u=p.dataset.v||p.textContent.trim(),v=q.dataset.v||q.textContent.trim();if(n){u=+u;v=+v}return u<v?-d:u>v?d:0}).forEach(function(row){tb.appendChild(row)});
t.querySelectorAll("th[aria-sort]").forEach(function(h){h.removeAttribute("aria-sort")});th.setAttribute("aria-sort",d>0?"ascending":"descending")});
})();
</script>"""


# ---------------------------------------------------------------- formatting
def dleft(closing: str) -> int:
    return (date.fromisoformat(closing[:10]) - TODAY).days


def dtext(n: int) -> str:
    return "Closes today" if n == 0 else ("1 day left" if n == 1 else f"{n} days left")


def buyer(b: str) -> str:
    return b[len("Department of "):] if b.startswith("Department of ") else b


def acr(b: str) -> str:
    m = re.search(r"\(([^)]+)\)\s*$", b)
    return m.group(1) if m else "".join(w[0] for w in b.split() if w[:1].isupper())


def t_url(ref: str) -> str:
    return "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/" + urllib.parse.quote(ref.lower(), safe="-._")


def a_url(ref: str) -> str:
    return "https://canadabuys.canada.ca/en/tender-opportunities/award-notice/" + urllib.parse.quote(ref.lower(), safe="-._")


def regions(r: list) -> str:
    if not r:
        return "Not stated"
    if len(r) <= 2:
        return ", ".join(r)
    return f"{r[0]}, {r[1]} and {len(r) - 2} more"


def cat(t) -> str:
    return " and ".join(t["category"]) or "Not stated"


def m2(v: float) -> str:
    return f"{v:,.2f}"


def usd(v: float) -> str:
    return f"${v:,.2f}"


def method_parts(m: str) -> tuple[str, str, bool]:
    """(label, detail, non-competitive?) from the publisher's procurement method."""
    if not m:
        return "Not stated", "", False
    if m in ("Non-competitive", "Advance contract award notice"):
        return "Non-competitive", "" if m == "Non-competitive" else m, True
    if " - " in m:
        a, b = m.split(" - ", 1)
        return a, b, False
    return m, "", False


def long_date(d: date) -> str:
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B %Y')}"


# ---------------------------------------------------------------- data
TENDERS = sorted(D["tenders"], key=lambda t: (t["closing"], t["title"].lower()))
for _t in D["tenders"]:
    _t["days"] = dleft(_t["closing"])
    _t["soon"] = _t["days"] <= 7
FILE_ORDER = D["tenders"]
FAC = X["facets"]
DET = X["details"]
RECENT = D["recent"][:8]
TOP = D["top_orgs"]
P = D["profile"]
H = X["wsp_history"]
YEST = X["awards_yesterday_rows"]
ST = D["stats"]
N_NEW = len(TENDERS)
N_SOON_NEW = sum(t["soon"] for t in TENDERS)
WEEK, PREV = X["awards_this_week"], X["awards_prev_week"]
Y26_N, Y26_V = ST["awards_2026_rows"], ST["awards_2026_value"]
WSP_ZERO = sum(1 for a in P["awards"] if a["value"] == 0)
WSP_ZERO_SOSA = sum(1 for a in P["awards"] if a["value"] == 0 and a["instrument"] in ("Standing Offer", "Supply Arrangement"))
WSP_NONCOMP_V = sum(y["noncomp_total"] for y in P["years"].values())
WSP_NONCOMP_N = sum(y["noncomp_n"] for y in P["years"].values())
AWARD_REFS = {a["reference"] for a in P["awards"]}
PROV = {"Quebec": "QC", "QC": "QC", "Québec": "QC", "Ontario": "ON", "BC": "BC", "British Columbia": "BC"}
CITY = {"Quebec": "Québec"}
_places = {}
for p in P["places"]:
    key = (CITY.get(p["city"], p["city"]), PROV.get(p["prov"], p["prov"]))
    _places[key] = _places.get(key, 0) + p["n"]
PLACES = sorted(_places.items(), key=lambda kv: -kv[1])
GROUPS = [("w7", "Closing within 7 days", [t for t in TENDERS if t["days"] <= 7]),
          ("w30", "Closing in 8 to 30 days", [t for t in TENDERS if 7 < t["days"] <= 30]),
          ("later", "Closing in more than 30 days", [t for t in TENDERS if t["days"] > 30])]
assert sum(len(g[2]) for g in GROUPS) == N_NEW
CHIP_LABEL = {"open": "Open", "soon": "Closing soon", "awarded": "Awarded", "expired": "Expired", "cancelled": "Cancelled"}
NOTE_NONCOMP = ("Non-competitive: the notice gives its procurement method as “Non-competitive” or "
                "“Advance contract award notice”. The method is the publisher's own field, shown as published; "
                "Award Watch does not reclassify it. The share is given by count and by value, each with its denominator.")
NOTE_VALUE = ("Value: one contract per reference number, at the total contract value on the newest amendment when above zero, "
              "otherwise the contract amount. A cancelled notice counts zero. Amounts in other currencies are shown "
              "with their currency and left out of totals.")
NOTE_SOURCES = ("Award notices and PSPC contract history are separate publications. One contract can appear in both, "
                "so each is totalled by its own rule, shown in its own column, and never added to the other.")
NOTE_SAMPLE = ("Mockup data: the fiscal-year 2026-2027 files read on 2026-10-31. The site reads the complete and historical "
               "files, so earlier years will hold more records than shown here.")


def status_of(t) -> str:
    return "soon" if t["soon"] else "open"


def award_status(a) -> str:
    return {"Active": "awarded", "Expired": "expired", "Cancelled": "cancelled"}.get(a["status"], "awarded")


def chip(d: str, kind: str, label: str | None = None) -> str:
    label = e(label or CHIP_LABEL[kind])
    if d == "sheet":
        return f'<span class="chip {kind}">{CK if kind == "awarded" else ""}{label}</span>'
    if d == "console":
        return f'<span class="chip {kind}"><i></i><span>{label}</span></span>'
    return f'<span class="chip {kind}">{label}</span>'


def th(label: str, cls: str = "", k: str | None = None, sort: str | None = None) -> str:
    c = f' class="{cls}"' if cls else ""
    if not k:
        return f"<th{c}>{label}</th>"
    s = f' aria-sort="{sort}"' if sort else ""
    return f'<th{c} data-k="{k}"{s}><button type="button">{label}</button></th>'


def td(label: str, body: str, cls: str = "", v: str | None = None) -> str:
    c = f' class="{cls}"' if cls else ""
    dv = f' data-v="{e(v)}"' if v is not None else ""
    dl = f' data-label="{e(label)}"' if label else ""
    return f'<td{c}{dl}{dv}>{body}</td>'


def closing_cell(t, cls="when") -> str:
    d, tm = t["closing"][:10], t["closing"][11:16]
    soon = " soon" if t["soon"] else ""
    return td("Closing", f'{d} <span class="mute">{tm}</span><span class="left{soon}">{dtext(t["days"])}</span>', cls, t["closing"][:16])


def ref_line(t, with_buyer=False) -> str:
    bits = [e(t["reference"])]
    if t["amendment"] not in ("", "000"):
        bits.append(f"amendment {int(t['amendment'])}")
    if with_buyer:
        bits.append(e(acr(t["buyer"])))
    return " · ".join(bits)


def fig(label: str, value: str, note: str, cls: str = "") -> str:
    c = f' class="fig {cls}"' if cls else ' class="fig"'
    return f'<div{c}><dt>{label}</dt><dd><span class="v">{value}</span><span class="n">{note}</span></dd></div>'


def page(d: str, title: str, pg: str, body: str, extra_js: str = "") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · Award Watch ({NAMES[d]} mockup)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONT[d]}">
<link rel="stylesheet" href="style.css">
<link rel="icon" type="image/svg+xml" href="../../../brand/favicon-w.svg">
{HEAD_JS}
</head>
<body class="p-{pg}">
<a class="skip" href="#main">Skip to content</a>
{CHECK_DEF if d == "sheet" else ""}
{body}
{JS}{extra_js}
</body>
</html>
"""


NAV = [("home", "home.html", "Today"), ("tenders", "tenders.html", "Tenders"), ("awards", "#", "Awards"),
       ("orgs", "organization.html", "Organizations"), ("buyers", "#", "Buyers"), ("cats", "#", "Categories"),
       ("rank", "#", "Rankings"), ("data", "#", "Data"), ("method", "#", "Methodology")]


def nav_links(cur: str, labels: dict | None = None) -> str:
    out = []
    for k, h, l in NAV:
        l = (labels or {}).get(k, l)
        cur_attr = ' aria-current="page"' if k == cur else ""
        out.append(f'<a href="{h}"{cur_attr}>{l}</a>')
    return "".join(out)


FOOT_TEXT = ("Award Watch reads the Government of Canada's open-data files each night and files every record under the "
             "organization named in it. Records are shown as published. Contains information licensed under the "
             "Open Government Licence, Canada.")
FOOT_NAV = ('<nav aria-label="Site"><a href="#">Methodology</a><a href="#">Data and downloads</a><a href="#">Feeds</a>'
            '<a href="#">Cite</a><a href="#">Corrections</a><a href="../index.html">All mockups</a></nav>')


# ================================================================ SHEET
def sheet_mast(cur: str) -> str:
    return (f'<header class="mast"><div class="wrap mast-in">'
            f'<a class="brand" href="home.html">{MARK}<span>Award Watch</span></a>'
            f'<nav class="nav" aria-label="Main">{nav_links(cur)}</nav>'
            f'<div class="meta"><span>{DATE}</span>{LANG}{TOG}</div></div></header>')


def sheet_foot() -> str:
    return (f'<footer class="foot"><div class="wrap foot-in"><p style="max-width:640px">{FOOT_TEXT}</p>'
            f'{FOOT_NAV}</div></footer>')


def sheet_tender_rows(rows, full: bool) -> str:
    out = []
    for t in rows:
        url = t_url(t["reference"])
        cells = [td("Status", chip("sheet", status_of(t)), "st"),
                 td("", f'<a class="tt" href="#">{e(t["title"])}</a><span class="sm">{ref_line(t, True)}</span>', "lead")]
        if full:
            cells += [td("Buyer", e(buyer(t["buyer"])), "mdh"),
                      td("Category", f'{e(cat(t))}<span class="sm">{e(t["notice_type"])}</span>', "mdh"),
                      td("Delivery", e(regions(t["regions"])), "mdh"),
                      td("Published", e(t["published"] or "Not stated"), "mdh when", t["published"] or "0")]
        else:
            cells += [td("Buyer", e(buyer(t["buyer"])), "mdh"), td("Category", e(cat(t)), "mdh")]
        cells += [closing_cell(t), td("Source", f'<a href="{url}">CanadaBuys</a>', "src")]
        out.append("<tr>" + "".join(cells) + "</tr>")
    return "\n".join(out)


def sheet_home() -> str:
    figs = "".join([
        fig("Open tender notices", "[n]", f"+{N_NEW} first seen since yesterday"),
        fig("Closing within 7 days", "[n]", f"{N_SOON_NEW} of today's {N_NEW} new notices", "soon"),
        fig("Award notices this week", f"{WEEK}", f"{PREV} the week before"),
        fig("Award notices dated 2026", f"${Y26_V / 1e9:.2f} <small>billion</small>", f"{Y26_N:,} notices, by the counting rules"),
    ])
    new = sheet_tender_rows(TENDERS[:10], False)
    rec = []
    for a in RECENT:
        sup = f'<a href="#">{e(a["supplier"])}</a>'
        rec.append("<tr>" + "".join([
            td("Status", f'{CK}<span class="lbl">Awarded</span>', "gut"),
            td("Awarded", e(a["awarded"]), "when", a["awarded"]),
            td("", f'{sup}<span class="sm">{e(a["title"])}</span>', "lead"),
            td("Buyer", e(buyer(a["buyer"])), "mdh"),
            td("Value, CAD", m2(a["value"]), "amt" + (" z" if a["value"] == 0 else ""), f"{a['value']:.2f}"),
            td("Source", f'<a href="{a_url(a["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    top = []
    for i, o in enumerate(TOP, 1):
        top.append("<tr>" + "".join([
            td("Rank", str(i), "num", str(i)),
            td("", f'<a href="#">{e(o["name"])}</a>', "lead"),
            td("Notices", str(o["n"]), "num", str(o["n"])),
            td("Value, CAD", m2(o["total"]), "amt", f"{o['total']:.2f}"),
            td("Source", f'<a href="{DS_AWARDS}">Open data</a>', "src")]) + "</tr>")
    body = f"""{sheet_mast("home")}
<main id="main" class="wrap">
<div class="head"><div><h1>Federal tenders and contract awards</h1>
<p class="sub">Tender and award notices, published contracts, grants and lobbying reports from the Government of Canada's open data, filed under the organizations named in them.</p></div>
<div class="acts"><a class="btn q" href="#">Atom feeds</a><a class="btn q" href="#">Downloads</a></div></div>
<dl class="figs">{figs}</dl>
<section class="sec" aria-labelledby="h-new">
<div class="sec-h"><h2 id="h-new">New today<span class="c">{N_NEW}</span></h2><div class="tools"><a class="btn q" href="#">Export CSV</a><a href="tenders.html">All {N_NEW} new notices</a></div></div>
<table class="t"><thead><tr>{th("Status")}{th("Notice", "", "s")}{th("Buyer", "mdh", "s")}{th("Category", "mdh")}{th("Closing", "", "s", "ascending")}{th("Source", "src")}</tr></thead>
<tbody>
{new}
</tbody></table>
</section>
<section class="sec" aria-labelledby="h-rec">
<div class="sec-h"><h2 id="h-rec">Recent award notices</h2><div class="tools"><a class="btn q" href="#">Export CSV</a><a href="#">All award notices</a></div></div>
<table class="t"><thead><tr>{th('<span class="vh">Status</span>', "gut")}{th("Awarded", "", "s", "descending")}{th("Supplier and notice", "", "s")}{th("Buyer", "mdh", "s")}{th("Value, CAD", "amt", "n")}{th("Source", "src")}</tr></thead>
<tbody>
{chr(10).join(rec)}
</tbody></table>
<p class="note">Award date on or before 2026-10-31, newest first. {sum(a["value"] == 0 for a in RECENT)} of these {len(RECENT)} carry a value of 0.00 as published; {sum(a["value"] == 0 and a["instrument"] == "Supply Arrangement" for a in RECENT)} of them are supply arrangements.</p>
</section>
<section class="sec" aria-labelledby="h-top">
<div class="sec-h"><h2 id="h-top">Largest recipients of award notices, 2026</h2><div class="tools"><a href="#">Rankings</a></div></div>
<table class="t"><thead><tr>{th("#", "num")}{th("Organization", "", "s")}{th("Notices", "num", "n")}{th("Value, CAD", "amt", "n", "descending")}{th("Source", "src")}</tr></thead>
<tbody>
{chr(10).join(top)}
</tbody></table>
<p class="note">Award notices dated 2026, grouped by organization. {e(NOTE_VALUE)} {ST["awards_2026_noncad"]} notices in other currencies are left out.</p>
</section>
</main>
{sheet_foot()}"""
    return page("sheet", "Today", "home", body)


def status_toggles(d: str) -> str:
    counts = {"open": N_NEW, "soon": N_SOON_NEW}
    out = []
    for k in ("open", "soon", "awarded", "expired", "cancelled"):
        c = counts.get(k)
        pressed = "true" if k == "open" else "false"
        cnt = f'<span class="c">{c}</span>' if c is not None else ""
        out.append(f'<button class="tg" type="button" data-toggle aria-pressed="{pressed}">{chip(d, k)}{cnt}</button>')
    return "".join(out)


def selects() -> str:
    def sel(lid, label, opts):
        o = "".join(f"<option>{e(x)}</option>" for x in opts)
        return f'<label for="{lid}">{label}<select id="{lid}">{o}</select></label>'
    cats = ["All categories"] + [f"{k} ({v})" for k, v in FAC["category"].items()]
    regs = ["All regions", "National Capital Region (NCR)", "Alberta", "British Columbia", "Manitoba", "New Brunswick",
            "Newfoundland and Labrador", "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan",
            "Northwest Territories", "Nunavut", "Yukon"]
    buy = ["All buyers"] + [f"{buyer(k)} ({v})" for k, v in FAC["buyer"].items()]
    nt = ["All notice types"] + [f"{k} ({v})" for k, v in FAC["notice_type"].items()]
    cl = ["Any closing date", "Within 7 days", "Within 30 days", "In more than 30 days"]
    return (sel("f-cat", "Category", cats) + sel("f-reg", "Region of delivery", regs) + sel("f-buy", "Buyer", buy)
            + sel("f-nt", "Notice type", nt) + sel("f-cl", "Closing", cl))


def active_chips(d: str) -> str:
    return ('<span class="fchip">First seen: <b>2026-10-31</b><button type="button" aria-label="Remove filter: first seen 2026-10-31">×</button></span>'
            '<span class="fchip">Status: <b>Open</b><button type="button" aria-label="Remove filter: status open">×</button></span>'
            '<a class="clear" href="#">Clear all</a>')


DEFS_TENDERS = [
    ("Closing soon", f"the closing date falls within 7 days of the data date (2026-10-31). Days left count calendar days to the closing date; times are as CanadaBuys publishes them."),
    ("Status", "Open, Expired, Awarded and Cancelled are the tender statuses CanadaBuys publishes. A notice missing from tonight's open file whose closing date has passed shows as Expired until the weekly complete file says otherwise."),
    ("Source", "each row links to its notice on CanadaBuys, which also holds the contracting officer's contact details. Award Watch does not republish those."),
]


def sheet_tenders() -> str:
    rows = sheet_tender_rows(TENDERS, True)
    defs = "".join(f"<p><b>{e(a)}:</b> {e(b)}</p>" for a, b in DEFS_TENDERS)
    body = f"""{sheet_mast("tenders")}
<main id="main" class="wrap">
<div class="head"><div><h1>Open tender notices</h1>
<p class="sub">Every open notice on CanadaBuys, filtered in your browser. This mockup holds the {N_NEW} notices first seen today; the full list comes from the open-notices file.</p></div>
<div class="acts"><button class="btn" type="button" data-watch aria-pressed="false" data-on="Search saved" data-off="Save search"><span>Save search</span></button><a class="btn" href="#">Export CSV</a></div></div>
<form class="filters" role="search" onsubmit="return false">
<div class="frow"><label for="f-q">Search<input id="f-q" type="search" placeholder="Title, reference or buyer"></label>{selects()}</div>
<div class="frow mid"><span class="lab">Status</span>{status_toggles("sheet")}</div>
<div class="frow mid"><span class="lab">Filtered by</span>{active_chips("sheet")}</div>
</form>
<div class="count-line"><span>{N_NEW} notices, soonest closing first</span><span>[n] open in total · Page 1 of 1</span></div>
<table class="t"><thead><tr>{th("Status", "", "s")}{th("Notice", "", "s")}{th("Buyer", "mdh", "s")}{th("Category", "mdh", "s")}{th("Delivery", "mdh")}{th("Published", "mdh", "s")}{th("Closing", "", "s", "ascending")}{th("Source", "src")}</tr></thead>
<tbody>
{rows}
</tbody></table>
<section class="sec fn" aria-label="Definitions">{defs}</section>
</main>
{sheet_foot()}"""
    return page("sheet", "Open tender notices", "tenders", body)


def year_rows(d: str) -> tuple[list, list]:
    years = sorted(P["years"].keys(), reverse=True)
    rows = []
    for y in years:
        a = P["years"][y]
        h = H["years"].get(y, {"n": 0, "total": 0.0})
        rows.append((y, a, h))
    tot_a = {"n": P["rows"], "total": P["total"], "noncomp_n": WSP_NONCOMP_N, "noncomp_total": WSP_NONCOMP_V}
    tot_h = {"n": H["references"], "total": H["total"]}
    return rows, [("All years", tot_a, tot_h)]


def award_rows(d: str, gut: bool, money=m2, status: bool = True) -> str:
    out = []
    for a in P["awards"]:
        lab, det, nc = method_parts(a["method"])
        meth = e(lab) + ('<sup class="fm">1</sup>' if nc else "") + (f'<span class="sm">{e(det)}</span>' if det else "")
        z = " z" if a["value"] == 0 else ""
        cells = []
        if gut:
            cells.append(td("Status", f'{CK}<span class="lbl">Awarded</span>', "gut"))
        cells += [td("Awarded", e(a["awarded"]), "when", a["awarded"]),
                  td("", f'<span class="tt">{e(a["title"])}</span><span class="sm">{e(a["reference"])}</span>', "lead"),
                  td("Buyer", e(buyer(a["buyer"])), "mdh"),
                  td("Instrument", e(a["instrument"] or "Not stated"), "mdh"),
                  td("Method", meth)]
        if not gut and status:
            cells.append(td("Status", chip(d, award_status(a)), "mdh st"))
        cells += [td("Value, CAD", money(a["value"]), "amt" + z, f"{a['value']:.2f}"),
                  td("Source", f'<a href="{a_url(a["reference"])}">CanadaBuys</a>', "src")]
        out.append("<tr>" + "".join(cells) + "</tr>")
    return "\n".join(out)


def history_rows(gut: bool, money=m2) -> str:
    out = []
    for h in H["list"]:
        z = " z" if h["value"] == 0 else ""
        link = (f'<a href="{a_url(h["reference"])}">CanadaBuys</a>' if h["reference"] in AWARD_REFS
                else f'<a href="{DS_HISTORY}">Open data</a>')
        amend = f' · amendment {int(h["amendment"])}' if h["amendment"] not in ("", "000") else ""
        cells = []
        if gut:
            cells.append(td("Status", f'{CK}<span class="lbl">Awarded</span>', "gut"))
        cells += [td("Awarded", e(h["awarded"]), "when", h["awarded"]),
                  td("", f'<span class="tt">{e(h["title"])}</span><span class="sm">{e(h["reference"])}{amend}</span>', "lead"),
                  td("Client", e(buyer(h["end_user"]) or "Not stated"), "mdh"),
                  td("Instrument", e(h["instrument"] or "Not stated"), "mdh"),
                  td("Value, CAD", money(h["value"]), "amt" + z, f"{h['value']:.2f}"),
                  td("Source", link, "src")]
        out.append("<tr>" + "".join(cells) + "</tr>")
    return "\n".join(out)


def buyer_rows(money=m2) -> str:
    out = []
    for b in P["buyers"]:
        out.append("<tr>" + "".join([
            td("", e(buyer(b["buyer"])), "lead"),
            td("Award notices", str(b["n"]), "num", str(b["n"])),
            td("Value, CAD", money(b["total"]), "amt" + (" z" if b["total"] == 0 else ""), f"{b['total']:.2f}"),
            td("Source", f'<a href="{DS_AWARDS}">Open data</a>', "src")]) + "</tr>")
    return "\n".join(out)


def names_places(cls_h="kv-h") -> str:
    names = "".join(f"<li><span>{e(k)}</span><span>{v}</span></li>" for k, v in P["spellings"].items())
    places = "".join(f"<li><span>{e(c)} {e(p)}</span><span>{n}</span></li>" for (c, p), n in PLACES)
    return (f'<div class="cols"><div><p class="{cls_h}">Spellings in award notices</p><ul class="kv">{names}</ul></div>'
            f'<div><p class="{cls_h}">Supplier addresses</p><ul class="kv">{places}</ul></div></div>')


def sheet_org() -> str:
    yrows, ytot = year_rows("sheet")
    yr = []
    for y, a, h in yrows:
        yr.append("<tr>" + "".join([
            td("", f'<span class="tt">{y}</span>', "lead"),
            td("Award notices", str(a["n"]), "num", str(a["n"])),
            td("Value, CAD", m2(a["total"]), "amt", f"{a['total']:.2f}"),
            td("Non-competitive", f'{a["noncomp_n"]} of {a["n"]}<span class="sm">{m2(a["noncomp_total"])}</span>', "num"),
            td("Contract history", str(h["n"]), "num" + (" mute" if not h["n"] else ""), str(h["n"])),
            td("Value, CAD", m2(h["total"]), "amt" + (" z" if not h["total"] else ""), f"{h['total']:.2f}"),
            td("Source", f'<a href="{DS_AWARDS}">Awards</a> <a href="{DS_HISTORY}">History</a>', "src srcw")]) + "</tr>")
    _, a, h = ytot[0]
    yfoot = ("<tr>" + td("", "All years", "lead") + td("Award notices", str(a["n"]), "num")
             + td("Value, CAD", m2(a["total"]), "amt") + td("Non-competitive", f'{a["noncomp_n"]} of {a["n"]}<span class="sm">{m2(a["noncomp_total"])}</span>', "num")
             + td("Contract history", str(h["n"]), "num") + td("Value, CAD", m2(h["total"]), "amt") + td("Source", "", "src") + "</tr>")
    figs = "".join([
        fig("Award notices", f"{P['rows']}", f"under {len(P['spellings'])} spellings of the name"),
        fig("Value of award notices", f"${P['total'] / 1e6:.2f} <small>million</small>", f"{usd(P['total'])} by the counting rules"),
        fig('Non-competitive<sup class="fm">1</sup>', f"{WSP_NONCOMP_N} <small>of {P['rows']}</small>", f"{usd(WSP_NONCOMP_V)} of {usd(P['total'])} by value"),
        fig("PSPC contract history", f"{H['references']}", f"{usd(H['total'])}, not added to awards"),
    ])
    body = f"""{sheet_mast("orgs")}
<main id="main" class="wrap">
<p class="crumbs"><a href="#">Organizations</a> / <a href="#">Quebec</a> / WSP Canada Inc.</p>
<div class="head"><div><h1>{e(P["display"])}</h1>
<p class="rec"><span>Supplier</span><span>Montreal QC</span><span>{P["rows"]} award notices</span><span>First award {P["first"]}, latest {P["last"]}</span></p></div>
<div class="acts"><button class="btn" type="button" data-watch aria-pressed="false" data-on="Watching" data-off="Watch"><span>Watch</span></button><a class="btn" href="#">Export CSV</a><a class="btn q" href="#">Respond to this page</a></div></div>
<dl class="figs">{figs}</dl>
<p class="note">{e(NOTE_SAMPLE)}</p>
<section class="sec" aria-labelledby="h-y">
<div class="sec-h"><h2 id="h-y">Figures by year and source</h2><div class="tools"><a class="btn q" href="#">Export CSV</a></div></div>
<table class="t"><thead><tr>{th("Year")}{th("Award notices", "num")}{th("Value, CAD", "amt")}{th('Non-competitive<sup class="fm">1</sup>', "num")}{th("Contract history", "num")}{th("Value, CAD", "amt")}{th("Source", "src")}</tr></thead>
<tbody>
{chr(10).join(yr)}
</tbody><tfoot>{yfoot}</tfoot></table>
<p class="note">{e(NOTE_SOURCES)} Published contracts, grants and contributions, and lobbying reports are not loaded in this mockup.</p>
</section>
<section class="sec" aria-labelledby="h-a">
<div class="sec-h"><h2 id="h-a">Award notices<span class="c">{P["rows"]}</span></h2><div class="tools"><a class="btn q" href="#">Export CSV</a></div></div>
<table class="t"><thead><tr>{th('<span class="vh">Status</span>', "gut")}{th("Awarded", "", "s", "descending")}{th("Notice", "", "s")}{th("Buyer", "mdh", "s")}{th("Instrument", "mdh", "s")}{th("Method", "", "s")}{th("Value, CAD", "amt", "n")}{th("Source", "src")}</tr></thead>
<tbody>
{award_rows("sheet", True)}
</tbody><tfoot><tr>{td("", "", "gut")}{td("", f"{P['rows']} notices", "lead")}{td("", "", "")}{td("", "", "mdh")}{td("", "", "mdh")}{td("", "", "")}{td("Total, CAD", m2(P["total"]), "amt")}{td("", "", "src")}</tr></tfoot></table>
<p class="note">{WSP_ZERO} of the {P["rows"]} notices carry a value of 0.00 as published; {WSP_ZERO_SOSA} of them are standing offers or supply arrangements.</p>
</section>
<section class="sec" aria-labelledby="h-h">
<div class="sec-h"><h2 id="h-h">PSPC contract history<span class="c">{H["references"]}</span></h2><div class="tools"><a class="btn q" href="#">Export CSV</a></div></div>
<table class="t"><thead><tr>{th('<span class="vh">Status</span>', "gut")}{th("Awarded", "", "s", "descending")}{th("Contract", "", "s")}{th("Client", "mdh", "s")}{th("Instrument", "mdh", "s")}{th("Value, CAD", "amt", "n")}{th("Source", "src")}</tr></thead>
<tbody>
{history_rows(True)}
</tbody><tfoot><tr>{td("", "", "gut")}{td("", f"{H['references']} contracts", "lead")}{td("", "", "")}{td("", "", "mdh")}{td("", "", "mdh")}{td("Total, CAD", m2(H["total"]), "amt")}{td("", "", "src")}</tr></tfoot></table>
<p class="note">{H["rows"]} rows in the file, one contract per reference number at its newest amendment. The client is the department the contract serves; PSPC let it.</p>
</section>
<section class="sec" aria-labelledby="h-b">
<div class="sec-h"><h2 id="h-b">Buyers</h2></div>
<table class="t"><thead><tr>{th("Contracting entity")}{th("Award notices", "num", "n")}{th("Value, CAD", "amt", "n", "descending")}{th("Source", "src")}</tr></thead>
<tbody>
{buyer_rows()}
</tbody></table>
</section>
<section class="sec" aria-labelledby="h-n">
<div class="sec-h"><h2 id="h-n">Names and places</h2></div>
{names_places()}
</section>
<section class="sec fn" aria-label="Notes">
<p><sup class="fm">1</sup> {e(NOTE_NONCOMP)}</p>
<p>{e(NOTE_VALUE)}</p>
<p>Records are filed under one organization when their names match after accents, punctuation and legal suffixes are set aside. Record id {ORG_ID}.</p>
</section>
</main>
{sheet_foot()}"""
    return page("sheet", P["display"], "org", body)


# ================================================================ CONSOLE
def console_shell(cur: str, main: str) -> str:
    def ri(key, label, count, href="#", cls=""):
        c = f' class="ri {cls}"' if cls else ' class="ri"'
        a = ' aria-current="page"' if key == cur else ""
        b = f"<b>{count}</b>" if count != "" else ""
        return f'<a{c} href="{href}"{a}><span>{label}</span>{b}</a>'
    rail = "".join([
        '<nav class="rail" aria-label="Index">',
        '<div class="rg"><h2>Overview</h2>', ri("today", "Today", "", "home.html"), "</div>",
        '<div class="rg"><h2>Tenders</h2>', ri("open", "Open tenders", "[n]", "tenders.html"),
        ri("new", "New today", str(N_NEW), "tenders.html"), ri("soon", "Closing within 7 days", "[n]", "tenders.html", "soon"), "</div>",
        '<div class="rg"><h2>Awards</h2>', ri("week", "Awards this week", str(WEEK)), ri("y26", "Awarded in 2026", f"{Y26_N:,}"), "</div>",
        '<div class="rg"><h2>Watching</h2>', ri("watch", "Watched organizations", "1"),
        ri("wsp", f'<em>WSP Canada Inc.</em>', "", "organization.html", "sub"), ri("saved", "Saved searches", "0"), "</div>",
        '<div class="rg browse"><h2>Browse</h2>', ri("orgs", "Organizations", ""), ri("buyers", "Buyers", ""),
        ri("cats", "Categories", ""), ri("rank", "Rankings", ""), ri("feeds", "Feeds", ""), ri("data", "Data", ""),
        ri("method", "Methodology", ""), "</div>",
        f'<p class="asof">{DATE}</p></nav>'])
    top = (f'<header class="top"><a class="brand" href="home.html">{MARK}<span>Award Watch</span></a>'
           '<form class="search" role="search" onsubmit="return false"><label class="vh" for="q">Search</label>'
           '<input id="q" type="search" placeholder="Search notices, organizations, buyers"><kbd>/</kbd></form>'
           f'<div class="tmeta"><span>{DATE}</span>{LANG}{TOG}</div></header>')
    foot = (f'<footer class="foot"><div class="foot-in"><p style="max-width:640px">{FOOT_TEXT}</p>{FOOT_NAV}</div></footer>')
    return f'{top}<div class="shell">{rail}<main id="main" class="main">{main}</main></div>{foot}'


def tile(label, value, delta, cls=""):
    c = f' class="tile {cls}"' if cls else ' class="tile"'
    return f'<div{c}><dt>{label}</dt><dd><span class="v">{value}</span><span class="d">{delta}</span></dd></div>'


def panel(title, count, tools, inner, foot="", cls="", pid=""):
    c = f' class="panel {cls}"' if cls else ' class="panel"'
    i = f' id="{pid}"' if pid else ""
    cnt = f'<span class="c">{count}</span>' if count != "" else ""
    f = f'<div class="pnf">{foot}</div>' if foot else ""
    return f'<section{c}{i}><div class="pnh"><h2>{title}{cnt}</h2><div class="tools">{tools}</div></div>{inner}{f}</section>'


def console_home() -> str:
    tiles = "".join([
        tile("Open tender notices", "[n]", f"<b>+{N_NEW}</b> new since yesterday"),
        tile("Closing within 7 days", "[n]", f"<b>{N_SOON_NEW}</b> of them first seen today", "soon"),
        tile("Award notices this week", str(WEEK), f"<b>−{PREV - WEEK}</b> on the week before ({PREV})"),
        tile("Awarded in 2026", f"${Y26_V / 1e9:.2f}<small>B</small>", f"<b>+{X['awards_2026_published_this_week']}</b> notices published this week"),
    ])
    new_rows = []
    for t in FILE_ORDER[:8]:
        new_rows.append("<tr>" + "".join([
            td("", f'{chip("console", status_of(t))}<a class="tt" href="tenders.html">{e(t["title"])}</a><span class="sm">{e(acr(t["buyer"]))} · {e(cat(t))}</span>', "lead"),
            closing_cell(t), td("Source", f'<a href="{t_url(t["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    soon_rows = []
    for t in TENDERS[:8]:
        soon_rows.append("<tr>" + "".join([
            closing_cell(t),
            td("", f'<a class="tt" href="tenders.html">{e(t["title"])}</a><span class="sm">{e(buyer(t["buyer"]))}</span>', "lead"),
            td("Source", f'<a href="{t_url(t["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    rec = []
    for a in RECENT:
        rec.append("<tr>" + "".join([
            td("Awarded", e(a["awarded"]), "when", a["awarded"]),
            td("", f'<a class="tt" href="#">{e(a["supplier"])}</a><span class="sm">{e(a["title"])}</span>', "lead"),
            td("Buyer", e(buyer(a["buyer"])), "mdh"),
            td("Status", chip("console", award_status(a)), "mdh st"),
            td("Value, CAD", usd(a["value"]), "amt" + (" z" if a["value"] == 0 else ""), f"{a['value']:.2f}"),
            td("Source", f'<a href="{a_url(a["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    top = []
    for i, o in enumerate(TOP, 1):
        top.append("<tr>" + "".join([
            td("Rank", str(i), "num"), td("", f'<a class="tt" href="#">{e(o["name"])}</a>', "lead"),
            td("Notices", str(o["n"]), "num", str(o["n"])), td("Value, CAD", usd(o["total"]), "amt", f"{o['total']:.2f}")]) + "</tr>")
    last = P["awards"][0]
    watched = ('<table class="t"><thead><tr><th>Organization</th><th>Latest award notice</th><th class="num">2026</th></tr></thead><tbody><tr>'
               + td("", '<a class="tt" href="organization.html">WSP Canada Inc.</a><span class="sm">Montreal QC</span>', "lead")
               + td("Latest award notice", f'{e(last["awarded"])} · {usd(last["value"])}<span class="sm">{e(last["reference"])} · {e(buyer(last["buyer"]))}</span>')
               + td("2026", f'{P["years"]["2026"]["n"]} notices<span class="sm">{usd(P["years"]["2026"]["total"])}</span>', "num")
               + "</tr></tbody></table>")
    main = f"""<div class="ph"><div><h1>Today</h1><p class="sub"><span>{long_date(TODAY)}</span><span>{DATE}</span></p></div>
<div class="acts"><a class="btn" href="#">Atom feeds</a><a class="btn" href="#">Downloads</a></div></div>
<dl class="tiles">{tiles}</dl>
<div class="grid2">
{panel("New today", N_NEW, '<a href="tenders.html">View all</a>', '<table class="t"><thead><tr>' + th("Notice") + th("Closing") + th("Source", "src") + '</tr></thead><tbody>' + "".join(new_rows) + "</tbody></table>", f"<span>8 of {N_NEW}, in file order</span><span>CanadaBuys new-notices file</span>")}
{panel("Closing soon", "", '<a href="tenders.html">Open tenders</a>', '<table class="t"><thead><tr>' + th("Closing", "", "s", "ascending") + th("Notice") + th("Source", "src") + '</tr></thead><tbody>' + "".join(soon_rows) + "</tbody></table>", "<span>The 8 soonest among today's new notices</span><span>Amber: within 7 days</span>")}
</div>
{panel("Recent award notices", "", '<a class="btn" href="#">Export CSV</a><a href="#">All awards</a>', '<table class="t"><thead><tr>' + th("Awarded", "", "s", "descending") + th("Supplier and notice", "", "s") + th("Buyer", "mdh", "s") + th("Status", "mdh") + th("Value, CAD", "amt", "n") + th("Source", "src") + '</tr></thead><tbody>' + "".join(rec) + "</tbody></table>", "<span>Award date on or before 2026-10-31, newest first</span><span>A value of $0.00 is as published</span>")}
<div class="grid2">
{panel("Watched organizations", "1", '<a href="#">Manage</a>', watched, "<span>Stored in this browser only</span>")}
{panel("Largest recipients, 2026", "", '<a href="#">Rankings</a>', '<table class="t"><thead><tr>' + th("#", "num") + th("Organization") + th("Notices", "num", "n") + th("Value, CAD", "amt", "n", "descending") + '</tr></thead><tbody>' + "".join(top) + "</tbody></table>", f'<span>Award notices dated 2026, by the counting rules</span><a href="{DS_AWARDS}">Source: open data</a>')}
</div>"""
    return page("console", "Today", "home", console_shell("today", main))


def excerpt(text: str, n: int = 300) -> str:
    # Contact details stay on CanadaBuys (rule 3): cut the excerpt before any email or phone number.
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}", text)
    if m:
        text = text[:m.start()]
    if len(text) <= n:
        return text.strip()
    cut = text[:n].rsplit(" ", 1)[0].rstrip(",;:.")
    return cut + "…"


def detail_record(t) -> dict:
    d = DET[t["reference"]]
    trade = d["trade"]
    tr = ", ".join(trade[:2]) + (f" and {len(trade) - 2} more" if len(trade) > 2 else "")
    codes = [f"{c} {x}" for c, x in zip(d["unspsc"], d["unspsc_desc"])] or ["Not stated"]
    per = f"{d['start']} to {d['end']}" if d["start"].strip() and d["end"].strip() else "Not stated"
    return {"t": t["title"], "r": t["reference"], "a": str(int(t["amendment"] or 0)), "s": d["solicitation"],
            "b": buyer(t["buyer"]), "eu": d["end_user"].strip(), "p": t["published"] or "Not stated",
            "c": t["closing"][:10] + " " + t["closing"][11:16], "dl": dtext(t["days"]), "soon": t["soon"],
            "nt": d["notice_type"], "m": d["method"], "sel": d["selection"] or "Not stated", "cat": cat(t),
            "u": codes[:2], "rg": ", ".join(d["regions"]) or "Not stated", "tr": tr or "Not stated", "per": per,
            "x": excerpt(d["description"]) or "No description in the file.", "url": t_url(t["reference"])}


DETAIL_JS = r"""<script>
(function(){
var D=JSON.parse(document.getElementById("notice-data").textContent),pane=document.getElementById("detail"),tb=document.querySelector(".list tbody");
function h(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function kv(k,v){return"<dt>"+k+"</dt><dd>"+v+"</dd>"}
function render(d){
var st=d.soon?'<span class="chip soon"><i></i><span>Closing soon</span></span>':'<span class="chip open"><i></i><span>Open</span></span>';
pane.innerHTML='<div class="dt-h"><div class="chips2">'+st+'<span class="chip"><span>'+h(d.cat)+'</span></span></div><h2>'+h(d.t)+'</h2><p class="sm">'+h(d.r)+' · solicitation '+h(d.s)+' · amendment '+h(d.a)+'</p>'
+'<div class="acts"><a class="btn pri" href="'+h(d.url)+'">CanadaBuys notice ↗</a><button class="btn" type="button" data-watch aria-pressed="false" data-on="Watching" data-off="Watch notice"><span>Watch notice</span></button></div></div>'
+'<dl class="kvs">'+kv("Closing",h(d.c)+'<span class="left'+(d.soon?" soon":"")+'">'+h(d.dl)+"</span>")+kv("Published",h(d.p))+kv("Buyer",h(d.b))+(d.eu?kv("End user",h(d.eu)):"")
+kv("Notice type",h(d.nt))+kv("Method",h(d.m))+kv("Selection",h(d.sel))+kv("UNSPSC",d.u.map(h).join("<br>"))+kv("Delivery",h(d.rg))+kv("Trade agreements",h(d.tr))+kv("Contract period",h(d.per))+"</dl>"
+'<div class="dt-d"><h3>Description, as published</h3><p>'+h(d.x)+'</p></div>';
}
function rows(){return[].slice.call(tb.rows)}
function cur(){return rows().findIndex(function(r){return r.classList.contains("is-sel")})}
function sel(n,scroll){var rs=rows();if(n<0||n>=rs.length)return;rs.forEach(function(r){r.classList.remove("is-sel");r.removeAttribute("aria-selected")});var r=rs[n];r.classList.add("is-sel");r.setAttribute("aria-selected","true");render(D[r.dataset.ref]);if(scroll)r.scrollIntoView({block:"nearest"})}
tb.addEventListener("click",function(ev){if(ev.target.closest("a"))return;var r=ev.target.closest("tr");if(r)sel(rows().indexOf(r))});
document.addEventListener("keydown",function(ev){var t=ev.target.tagName;if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(t)||ev.metaKey||ev.ctrlKey||ev.altKey)return;
if(ev.key==="j"){sel(cur()+1,1);ev.preventDefault()}else if(ev.key==="k"){sel(cur()-1,1);ev.preventDefault()}
else if(ev.key==="Enter"&&t!=="A"){var r=rows()[cur()];if(r)location.href=D[r.dataset.ref].url}
else if(ev.key==="/"){ev.preventDefault();document.getElementById("q").focus()}});
})();
</script>"""


def console_detail_static(t) -> str:
    d = detail_record(t)
    kv = lambda k, v: f"<dt>{k}</dt><dd>{v}</dd>"
    st = chip("console", "soon" if d["soon"] else "open")
    soon = " soon" if d["soon"] else ""
    return ('<div class="dt-h"><div class="chips2">' + st + f'<span class="chip"><span>{e(d["cat"])}</span></span></div>'
            f'<h2>{e(d["t"])}</h2><p class="sm">{e(d["r"])} · solicitation {e(d["s"])} · amendment {e(d["a"])}</p>'
            f'<div class="acts"><a class="btn pri" href="{e(d["url"])}">CanadaBuys notice ↗</a>'
            '<button class="btn" type="button" data-watch aria-pressed="false" data-on="Watching" data-off="Watch notice"><span>Watch notice</span></button></div></div>'
            '<dl class="kvs">' + kv("Closing", f'{e(d["c"])}<span class="left{soon}">{e(d["dl"])}</span>') + kv("Published", e(d["p"]))
            + kv("Buyer", e(d["b"])) + (kv("End user", e(d["eu"])) if d["eu"] else "") + kv("Notice type", e(d["nt"]))
            + kv("Method", e(d["m"])) + kv("Selection", e(d["sel"])) + kv("UNSPSC", "<br>".join(e(u) for u in d["u"]))
            + kv("Delivery", e(d["rg"])) + kv("Trade agreements", e(d["tr"])) + kv("Contract period", e(d["per"])) + "</dl>"
            f'<div class="dt-d"><h3>Description, as published</h3><p>{e(d["x"])}</p></div>')


def console_tenders() -> str:
    rows = []
    for i, t in enumerate(TENDERS):
        sel = ' class="is-sel" aria-selected="true"' if i == 0 else ""
        rows.append(f'<tr data-ref="{e(t["reference"])}"{sel}>' + "".join([
            td("Status", chip("console", status_of(t)), "st"),
            td("", f'<span class="tt">{e(t["title"])}</span><span class="sm">{e(buyer(t["buyer"]))} · {e(cat(t))} · {e(t["reference"])}</span>', "lead"),
            closing_cell(t), td("Source", f'<a href="{t_url(t["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    data = {t["reference"]: detail_record(t) for t in TENDERS}
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    dds = "".join(f'<button class="dd" type="button">{x}</button>' for x in
                  ("Category", "Segment", "Province", "Buyer", "Notice type", "Method", "Closing"))
    seg = "".join(f'<button type="button" data-toggle aria-pressed="{"true" if k == "open" else "false"}">'
                  + chip("console", k).replace("</span></span>", f'</span>{f"<b>{c}</b>" if c is not None else ""}</span>')
                  + "</button>"
                  for k, c in (("open", N_NEW), ("soon", N_SOON_NEW), ("awarded", None), ("expired", None), ("cancelled", None)))
    main = f"""<div class="ph"><div><h1>Open tenders</h1><p class="sub"><span>{N_NEW} shown</span><span>[n] open in total</span><span>Sorted by closing date</span></p></div>
<div class="acts"><button class="btn" type="button" data-watch aria-pressed="false" data-on="Search saved" data-off="Save search"><span>Save search</span></button><a class="btn" href="#">Export CSV</a></div></div>
<div class="tb" role="toolbar" aria-label="Filters"><label class="vh" for="fq">Filter this list</label><input id="fq" type="search" placeholder="Filter by title, reference, buyer"><span class="sep"></span>{dds}</div>
<div class="chips"><span>Filters</span>{active_chips("console")}</div>
<div class="split">
<section class="panel" aria-label="Notices">
<div class="pnh"><div class="seg" role="group" aria-label="Status">{seg}</div><div class="tools"><span class="mute">{N_NEW} of {N_NEW}</span><button class="dd on" type="button">Sort: Closing date</button></div></div>
<table class="t list"><thead><tr>{th("Status", "", "s")}{th("Notice", "", "s")}{th("Closing", "", "s", "ascending")}{th("Source", "src")}</tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody></table>
<div class="pnf"><span><kbd>j</kbd> / <kbd>k</kbd> to move, <kbd>Enter</kbd> to open</span><span>Page 1 of 1</span></div>
</section>
<aside class="panel detail" id="detail" aria-label="Selected notice" aria-live="polite">{console_detail_static(TENDERS[0])}</aside>
</div>
<p class="pnote" style="border:0;padding-left:0">{e(DEFS_TENDERS[0][0])}: {e(DEFS_TENDERS[0][1])} Contact details stay on CanadaBuys.</p>
<script type="application/json" id="notice-data">{blob}</script>"""
    return page("console", "Open tenders", "tenders", console_shell("new", main), DETAIL_JS)


def console_org() -> str:
    yrows, ytot = year_rows("console")
    yr = []
    for y, a, h in yrows + ytot:
        foot = y == "All years"
        yr.append(("<tr>" if not foot else "") + "".join([
            td("", f'<span class="tt">{y}</span>', "lead"),
            td("Award notices", str(a["n"]), "num", str(a["n"])),
            td("Value, CAD", usd(a["total"]), "amt", f"{a['total']:.2f}"),
            td("Non-competitive", f'{a["noncomp_n"]} of {a["n"]}<span class="sm">{usd(a["noncomp_total"])}</span>', "num"),
            td("Contract history", str(h["n"]), "num" + (" mute" if not h["n"] else ""), str(h["n"])),
            td("Value, CAD", usd(h["total"]), "amt" + (" z" if not h["total"] else ""), f"{h['total']:.2f}")]) + ("</tr>" if not foot else ""))
    years_tbl = ('<table class="t"><thead><tr>' + th("Year") + th("Award notices", "num") + th("Value, CAD", "amt")
                 + th('Non-competitive<sup class="fm">1</sup>', "num") + th("Contract history", "num") + th("Value, CAD", "amt")
                 + "</tr></thead><tbody>" + "".join(yr[:-1]) + "</tbody><tfoot><tr>" + yr[-1] + "</tr></tfoot></table>")
    aw = ('<table class="t"><thead><tr>' + th("Awarded", "", "s", "descending") + th("Notice", "", "s") + th("Buyer", "mdh", "s")
          + th("Instrument", "mdh", "s") + th("Method", "", "s") + th("Status", "mdh") + th("Value, CAD", "amt", "n") + th("Source", "src")
          + "</tr></thead><tbody>" + award_rows("console", False, usd) + "</tbody></table>")
    hi = ('<table class="t"><thead><tr>' + th("Awarded", "", "s", "descending") + th("Contract", "", "s") + th("Client", "mdh", "s")
          + th("Instrument", "mdh", "s") + th("Value, CAD", "amt", "n") + th("Source", "src")
          + "</tr></thead><tbody>" + history_rows(False, usd) + "</tbody></table>")
    by = ('<table class="t"><thead><tr>' + th("Contracting entity") + th("Notices", "num", "n") + th("Value, CAD", "amt", "n", "descending")
          + th("Source", "src") + "</tr></thead><tbody>" + buyer_rows(usd) + "</tbody></table>")
    names = "".join(f"<li><span>{e(k)}</span><span>{v}</span></li>" for k, v in P["spellings"].items())
    places = "".join(f"<li><span>{e(c)} {e(p)}</span><span>{n}</span></li>" for (c, p), n in PLACES)
    tiles = "".join([
        tile("Award notices", str(P["rows"]), f"<b>{P['years']['2026']['n']}</b> dated 2026"),
        tile("Value of award notices", f"${P['total'] / 1e6:.2f}<small>M</small>", f"<b>{usd(P['total'])}</b> by the counting rules"),
        tile('Non-competitive<sup class="fm">1</sup>', f"{WSP_NONCOMP_N}<small> of {P['rows']}</small>", f"<b>{usd(WSP_NONCOMP_V)}</b> of {usd(P['total'])}"),
        tile("PSPC contract history", str(H["references"]), f"<b>{usd(H['total'])}</b>, not added to awards"),
    ])
    main = f"""<p class="crumbs"><a href="#">Organizations</a> / <a href="#">Quebec</a> / WSP Canada Inc.</p>
<div class="ph"><div><h1>{e(P["display"])}</h1><p class="sub"><span>Supplier</span><span>Montreal QC</span><span>{P["rows"]} award notices since {P["first"]}</span><span>Latest {P["last"]}</span></p></div>
<div class="acts"><button class="btn" type="button" data-watch aria-pressed="true" data-on="Watching" data-off="Watch"><span>Watching</span></button><a class="btn" href="#">Export CSV</a><a class="btn" href="#">Respond</a></div></div>
<nav class="tabs" aria-label="Sections"><a href="#main" aria-current="page">Overview</a><a href="#awards">Award notices<b>{P["rows"]}</b></a><a href="#history">Contract history<b>{H["references"]}</b></a><a class="off" href="#">Published contracts<b>[n]</b></a><a class="off" href="#">Grants<b>[n]</b></a><a class="off" href="#">Lobbying<b>[n]</b></a></nav>
<dl class="tiles">{tiles}</dl>
{panel("Figures by year and source", "", '<a class="btn" href="#">Export CSV</a>', years_tbl + f'<p class="pnote">{e(NOTE_SOURCES)} {e(NOTE_SAMPLE)}</p>')}
{panel("Award notices", P["rows"], '<button class="dd" type="button">Year: all</button><button class="dd" type="button">Buyer: all</button><a class="btn" href="#">Export CSV</a>', aw, f"<span>{WSP_ZERO} of {P['rows']} carry a value of $0.00 as published; {WSP_ZERO_SOSA} of them are standing offers or supply arrangements</span><span>Sorted by award date</span>", pid="awards")}
{panel("PSPC contract history", H["references"], '<a class="btn" href="#">Export CSV</a>', hi, f"<span>{H['rows']} rows, one contract per reference at its newest amendment</span><span>Client: the department served</span>", pid="history")}
<div class="grid2">
{panel("Buyers", len(P["buyers"]), "", by)}
{panel("Names and places", "", "", f'<ul class="kv">{names}</ul><div class="pnh" style="border-top:1px solid var(--border)"><h2>Supplier addresses</h2></div><ul class="kv">{places}</ul>')}
</div>
<section class="panel fn" aria-label="Notes" style="margin-top:16px"><p><sup class="fm">1</sup> {e(NOTE_NONCOMP)}</p><p>{e(NOTE_VALUE)}</p><p>Records are filed under one organization when their names match after accents, punctuation and legal suffixes are set aside. Record id {ORG_ID}.</p></section>"""
    return page("console", P["display"], "org", console_shell("wsp", main))


# ================================================================ DOSSIER
def dossier_mast(cur: str) -> str:
    return (f'<header class="wrap mast"><div class="mast-top">'
            f'<a class="wm" href="home.html" aria-label="Award Watch">{WORDMARK}</a>'
            f'<div class="meta"><span>{DATE}</span>{LANG}{TOG}</div></div>'
            f'<nav class="nav" aria-label="Main">{nav_links(cur, {"home": "Today&#8217;s sheet"})}</nav></header>')


def dossier_foot() -> str:
    return (f'<footer class="wrap foot"><div class="foot-in"><p style="max-width:624px">{FOOT_TEXT}</p>'
            f'<div>{FOOT_NAV}<button type="button" data-grid>Show the 24 px grid</button></div></div></footer>')


GRID_JS = ('<script>(function(){var g=document.querySelector("[data-grid]"),r=document.documentElement;'
           'function set(on){r.classList.toggle("showgrid",on);g.textContent=on?"Hide the grid":"Show the 24 px grid"}'
           'g.addEventListener("click",function(){set(!r.classList.contains("showgrid"))});if(location.hash==="#grid")set(true)})()</script>')


def sec(no, sid, title, count, inner, tools="", lede="", cls="sec"):
    n = f'<span class="no">{no}.</span>' if no else ""
    c = f'<span class="c">{count}</span>' if count != "" else ""
    t = f'<div class="tools">{tools}</div>' if tools else ""
    l = f'<p class="lede">{lede}</p>' if lede else ""
    return f'<section class="{cls}" id="{sid}" aria-labelledby="h-{sid}"><div class="sec-h">{n}<h2 id="h-{sid}">{title}{c}</h2>{t}</div>{l}<div class="inset">{inner}</div></section>'


def dossier_tender_table(rows, ntype=True) -> str:
    body = []
    for t in rows:
        body.append("<tr>" + "".join([
            closing_cell(t),
            td("", f'<a class="tt" href="#">{e(t["title"])}</a><span class="sm">{ref_line(t)}</span>', "lead"),
            td("Buyer", e(buyer(t["buyer"])), "mdh"),
            td("Category", e(cat(t)) + (f'<span class="sm">{e(t["notice_type"])}</span>' if ntype else ""), "mdh"),
            td("Status", chip("dossier", status_of(t)), "st"),
            td("Source", f'<a href="{t_url(t["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    return ('<table class="t grp"><thead><tr>' + th("Closing", "", "s", "ascending") + th("Notice", "", "s") + th("Buyer", "mdh", "s")
            + th("Category", "mdh", "s") + th("Status") + th("Source", "src") + "</tr></thead><tbody>\n" + "\n".join(body) + "\n</tbody></table>")


def toc(items) -> str:
    li = "".join(f'<li><b>{n}</b><a href="#{sid}">{t}</a><span>{c}</span></li>' for n, sid, t, c in items)
    return f'<nav class="toc" aria-label="Contents"><h2>Contents</h2><ol>{li}</ol></nav>'


def dossier_home() -> str:
    figs = "".join([
        fig("Open tender notices", "[n]", f"+{N_NEW} first seen since yesterday"),
        fig("Closing within 7 days", "[n]", f"{N_SOON_NEW} of today's new notices", "soon"),
        fig("Award notices this week", str(WEEK), f"{PREV} the week before"),
        fig("Awarded in 2026", f"${Y26_V / 1e9:.2f} <small>billion</small>", f"{Y26_N:,} notices"),
    ])
    yrows = []
    for a in YEST:
        lab, det, nc = method_parts(a["method"])
        yrows.append("<tr>" + "".join([
            td("Awarded", e(a["awarded"]), "when", a["awarded"]),
            td("", f'<a class="tt" href="#">{e(a["supplier"])}</a><span class="sm">{e(a["title"])} · {e(a["reference"])}</span>', "lead"),
            td("Method", e(lab) + ('<sup class="fm">1</sup>' if nc else ""), "mdh"),
            td("Status", chip("dossier", award_status(a)), "mdh st"),
            td("Value, CAD", m2(a["value"]), "amt" + (" z" if a["value"] == 0 else ""), f"{a['value']:.2f}"),
            td("Source", f'<a href="{a_url(a["reference"])}">CanadaBuys</a>', "src")]) + "</tr>")
    ytab = ('<table class="t"><thead><tr>' + th("Awarded", "", "s") + th("Supplier and notice", "", "s") + th("Method", "mdh", "s")
            + th("Status", "mdh") + th("Value, CAD", "amt", "n", "descending") + th("Source", "src") + "</tr></thead><tbody>\n"
            + "\n".join(yrows) + "\n</tbody></table>" + f'<div class="notes"><p><b>1.</b> {e(NOTE_NONCOMP)}</p></div>')
    series = X["awards_by_pub_28"]
    mx = max(series.values())
    bars = []
    for day, n in series.items():
        lab = f"{day}: {n} award notice{'s' if n != 1 else ''}"
        em = f"<em>{n}</em>" if n == mx else ""
        h = f"{100 * n / mx:.1f}%"
        cls = "b zero" if n == 0 else "b"
        bars.append(f'<div class="{cls}" style="height:{h}" title="{lab}">{em}</div>')
    days = list(series.items())
    tv = "".join(f"<tr><td>{d}</td><td class=\"num\">{n}</td></tr>" for d, n in days)
    chart = (f'<div class="chart" role="img" aria-label="Award notices published per day, 2026-10-03 to 2026-10-30; highest {mx}">{"".join(bars)}</div>'
             f'<div class="axis"><span>{days[0][0]}</span><span>{days[7][0]}</span><span>{days[14][0]}</span><span>{days[21][0]}</span><span>{days[-1][0]}</span></div>'
             f'<p class="legend-line">Award notices by publication date, from the fiscal-year 2026-2027 file. Highest: {mx}, on {" and ".join(d for d, n in days if n == mx)}.</p>'
             f'<details class="tv"><summary>Show as a table</summary><table class="t"><thead><tr><th>Published</th><th class="num">Notices</th></tr></thead><tbody>{tv}</tbody></table></details>')
    top = []
    for i, o in enumerate(TOP, 1):
        top.append("<tr>" + "".join([
            td("Rank", str(i), "num"), td("", f'<a class="tt" href="#">{e(o["name"])}</a>', "lead"),
            td("Notices", str(o["n"]), "num", str(o["n"])), td("Value, CAD", m2(o["total"]), "amt", f"{o['total']:.2f}"),
            td("Source", f'<a href="{DS_AWARDS}">Open data</a>', "src")]) + "</tr>")
    ttab = ('<table class="t"><thead><tr>' + th("#", "num") + th("Organization", "", "s") + th("Notices", "num", "n")
            + th("Value, CAD", "amt", "n", "descending") + th("Source", "src") + "</tr></thead><tbody>\n" + "\n".join(top) + "\n</tbody></table>")
    srcs = [("Tender notices, new", "newTenderNotice-nouvelAvisAppelOffres.csv", f"{N_NEW}", DS_TENDERS),
            ("Award notices, 2026-2027", "2026-2027-awardNotice-avisAttribution.csv", f"{ST['awards_rows']:,}", DS_AWARDS),
            ("Contract history, 2026-2027", "2026-2027-contractHistory-contratsOctroyes.csv", "2,466", DS_HISTORY)]
    stab = ('<table class="t"><thead><tr>' + th("Publication") + th("File") + th("Rows read", "num") + th("Source", "src")
            + "</tr></thead><tbody>" + "".join("<tr>" + td("", e(a), "lead") + td("File", f'<span class="sm" style="display:inline">{e(b)}</span>')
                                                + td("Rows read", c, "num") + td("Source", f'<a href="{u}">Open data</a>', "src") + "</tr>"
                                                for a, b, c, u in srcs) + "</tbody></table>")
    w7 = GROUPS[0][2]
    body = f"""{dossier_mast("home")}
<main id="main" class="wrap">
<div class="title"><p class="rec kick"><span>Today&#8217;s sheet</span><span>{DATE}</span></p>
<h1>{long_date(TODAY)}</h1>
<p class="stand">{N_NEW} tender notices first seen in today&#8217;s refresh, {len(YEST)} award notices published yesterday and {WEEK} this week. Every row links to the government record it came from.</p></div>
<dl class="figs">{figs}</dl>
{toc([("", "new", "New today", N_NEW), (1, "soon", "Closing within 7 days", len(w7)), (2, "yesterday", "Award notices published yesterday", len(YEST)), (3, "days", "Award notices by day", "28 days"), (4, "top", "Largest recipients, 2026", len(TOP)), (5, "sources", "Sources read for this issue", 3)])}
{sec("", "new", "New today", N_NEW, dossier_tender_table(TENDERS, False), '<a class="btn q" href="#">Export CSV</a><a href="tenders.html">Open tenders</a>', "The notices first seen in this morning&#8217;s CanadaBuys file, soonest closing first.", "sec lead-sec")}
{sec(1, "soon", "Closing within 7 days", len(w7), dossier_tender_table(w7, False), "", f"Among today&#8217;s new notices, {len(w7)} closes by 2026-11-07. The count across every open notice, [n], comes from the open-notices file.")}
{sec(2, "yesterday", "Award notices published yesterday", len(YEST), ytab, '<a class="btn q" href="#">Export CSV</a>', "Published 2026-10-30, largest value first. Four security-guard supply arrangements were published without a value.")}
{sec(3, "days", "Award notices by day of publication", "", chart)}
{sec(4, "top", "Largest recipients of award notices, 2026", "", ttab, '<a href="#">Rankings</a>', f"Grouped by organization over notices dated 2026. {ST['awards_2026_noncad']} notices in other currencies are left out of the value; cancelled notices count zero.")}
{sec(5, "sources", "Sources read for this issue", "", stab, "", "Open Government Licence, Canada. Each file is read whole; nothing is scraped from web pages.")}
</main>
{dossier_foot()}"""
    return page("dossier", "Today's sheet", "home", body, GRID_JS)


def dossier_tenders() -> str:
    secs = []
    for i, (sid, title, rows) in enumerate(GROUPS, 1):
        secs.append(sec(i, sid, title, len(rows), dossier_tender_table(rows)))
    defs = "".join(f"<p><b>{e(a)}:</b> {e(b)}</p>" for a, b in DEFS_TENDERS)
    body = f"""{dossier_mast("tenders")}
<main id="main" class="wrap">
<div class="title"><p class="rec kick"><span>Tenders</span><span>{DATE}</span></p>
<h1>Open tender notices</h1>
<p class="rec"><span>{N_NEW} shown</span><span>First seen 2026-10-31</span><span class="ph">[n] open in total</span></p></div>
<p class="stand">Every open notice on CanadaBuys, grouped by how soon it closes. This mockup holds the {N_NEW} notices first seen today.</p>
<div class="acts"><button class="btn" type="button" data-watch aria-pressed="false" data-on="Search saved" data-off="Save search"><span>Save search</span></button><a class="btn q" href="#">Export CSV</a><a class="btn q" href="#">Atom feed</a></div>
<form class="filters" role="search" onsubmit="return false">
<div class="frow"><label for="f-q">Search<input id="f-q" type="search" placeholder="Title, reference or buyer"></label>{selects()}</div>
<div class="frow mid"><span class="lab">Status</span>{status_toggles("dossier")}</div>
<div class="frow mid"><span class="lab">Filtered by</span>{active_chips("dossier")}</div>
</form>
{"".join(secs)}
{sec(4, "defs", "Definitions", "", f'<div class="notes">{defs}</div>')}
</main>
{dossier_foot()}"""
    return page("dossier", "Open tender notices", "tenders", body, GRID_JS)


def dossier_org() -> str:
    yrows, ytot = year_rows("dossier")
    yr = []
    for y, a, h in yrows:
        yr.append("<tr>" + "".join([
            td("", f'<span class="tt">{y}</span>', "lead"),
            td("Award notices", str(a["n"]), "num", str(a["n"])),
            td("Value, CAD", m2(a["total"]), "amt", f"{a['total']:.2f}"),
            td("Non-competitive", f'{a["noncomp_n"]} of {a["n"]}', "num"),
            td("Contract history", str(h["n"]), "num" + (" mute" if not h["n"] else ""), str(h["n"])),
            td("Value, CAD", m2(h["total"]), "amt" + (" z" if not h["total"] else ""), f"{h['total']:.2f}")]) + "</tr>")
    _, a, h = ytot[0]
    yfoot = ("<tr>" + td("", "All years", "lead") + td("Award notices", str(a["n"]), "num") + td("Value, CAD", m2(a["total"]), "amt")
             + td("Non-competitive", f'{a["noncomp_n"]} of {a["n"]}', "num") + td("Contract history", str(h["n"]), "num")
             + td("Value, CAD", m2(h["total"]), "amt") + "</tr>")
    ytab = ('<table class="t"><thead><tr>' + th("Year") + th("Award notices", "num") + th("Value, CAD", "amt")
            + th('Non-competitive<sup class="fm">1</sup>', "num") + th("Contract history", "num") + th("Value, CAD", "amt")
            + "</tr></thead><tbody>" + "".join(yr) + f"</tbody><tfoot>{yfoot}</tfoot></table>"
            + f'<div class="notes"><p>{e(NOTE_SOURCES)}</p><p>{e(NOTE_SAMPLE)} Published contracts, grants and contributions, and lobbying reports are not loaded in this mockup.</p></div>')
    aw = ('<table class="t"><thead><tr>' + th("Awarded", "", "s", "descending") + th("Notice", "", "s") + th("Buyer", "mdh", "s")
          + th("Instrument", "mdh", "s") + th("Method", "", "s") + th("Value, CAD", "amt", "n") + th("Source", "src")
          + "</tr></thead><tbody>\n" + award_rows("dossier", False, m2, False) + "\n</tbody></table>"
          + f'<div class="notes"><p>{WSP_ZERO} of the {P["rows"]} notices carry a value of 0.00 as published; {WSP_ZERO_SOSA} of them are standing offers or supply arrangements.</p></div>')
    hi = ('<table class="t"><thead><tr>' + th("Awarded", "", "s", "descending") + th("Contract", "", "s") + th("Client", "mdh", "s")
          + th("Instrument", "mdh", "s") + th("Value, CAD", "amt", "n") + th("Source", "src")
          + "</tr></thead><tbody>\n" + history_rows(False) + "\n</tbody></table>"
          + f'<div class="notes"><p>{H["rows"]} rows in the file, one contract per reference number at its newest amendment. The client is the department the contract serves.</p></div>')
    by = ('<table class="t"><thead><tr>' + th("Contracting entity") + th("Notices", "num", "n") + th("Value, CAD", "amt", "n", "descending")
          + th("Source", "src") + "</tr></thead><tbody>" + buyer_rows() + "</tbody></table>")
    figs = "".join([
        fig("Award notices", str(P["rows"]), f"{P['years']['2026']['n']} dated 2026"),
        fig("Value of award notices", f"${P['total'] / 1e6:.2f} <small>million</small>", usd(P["total"])),
        fig('Non-competitive<sup class="fm">1</sup>', f"{WSP_NONCOMP_N} <small>of {P['rows']}</small>", f"{usd(WSP_NONCOMP_V)} by value"),
        fig("PSPC contract history", str(H["references"]), f"{usd(H['total'])}, kept apart"),
    ])
    notes = (f'<div class="notes"><p><b>1. Non-competitive.</b> {e(NOTE_NONCOMP)}</p><p><b>Value.</b> {e(NOTE_VALUE)}</p>'
             f'<p><b>Identity.</b> Records are filed under one organization when their names match after accents, punctuation and legal suffixes are set aside. Record id {ORG_ID}.</p>'
             f'<p><b>Sources.</b> <a href="{DS_AWARDS}">CanadaBuys award notices</a> and <a href="{DS_HISTORY}">CanadaBuys contract history</a>, Open Government Licence, Canada.</p></div>')
    body = f"""{dossier_mast("orgs")}
<main id="main" class="wrap">
<div class="title"><p class="rec kick"><span>Organizations</span><span>Quebec</span></p>
<h1>{e(P["display"])}</h1>
<p class="rec"><span>Supplier</span><span>{P["rows"]} award notices since {P["first"][:4]}</span><span>Montreal QC</span><span class="ph">Corporations Canada: [match pending]</span></p></div>
<div class="acts"><button class="btn" type="button" data-watch aria-pressed="false" data-on="Watching" data-off="Watch"><span>Watch</span></button><a class="btn q" href="#">Export CSV</a><a class="btn q" href="#">Respond to this record</a></div>
<dl class="figs">{figs}</dl>
{toc([(1, "years", "Figures by year", ""), (2, "awards", "Award notices", P["rows"]), (3, "history", "PSPC contract history", H["references"]), (4, "buyers", "Buyers", len(P["buyers"])), (5, "names", "Names and places", ""), (6, "notes", "Definitions and sources", "")])}
{sec(1, "years", "Figures by year", "", ytab, '<a class="btn q" href="#">Export CSV</a>')}
{sec(2, "awards", "Award notices", P["rows"], aw, '<a class="btn q" href="#">Export CSV</a>')}
{sec(3, "history", "PSPC contract history", H["references"], hi, '<a class="btn q" href="#">Export CSV</a>')}
{sec(4, "buyers", "Buyers", len(P["buyers"]), by)}
{sec(5, "names", "Names and places", "", names_places())}
{sec(6, "notes", "Definitions and sources", "", notes)}
</main>
{dossier_foot()}"""
    return page("dossier", P["display"], "org", body, GRID_JS)


# ================================================================ write
PAGES = {
    "sheet": {"home": sheet_home, "tenders": sheet_tenders, "organization": sheet_org},
    "console": {"home": console_home, "tenders": console_tenders, "organization": console_org},
    "dossier": {"home": dossier_home, "tenders": dossier_tenders, "organization": dossier_org},
}

if __name__ == "__main__":
    for d, pages in PAGES.items():
        (OUT / d).mkdir(exist_ok=True)
        for name, fn in pages.items():
            text = fn()
            assert "—" not in text, (d, name, "em-dash")
            (OUT / d / f"{name}.html").write_text(text, encoding="utf-8", newline="\n")
            print(f"{d}/{name}.html {len(text.encode('utf-8')):,} bytes")
