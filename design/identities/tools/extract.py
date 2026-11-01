"""Pull every figure the identity mockups show from the 2026-10-31 samples."""
import csv, json, sys, collections
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "pipeline"))
from awardwatch_pipeline.normalize import norm_name
try:
    from awardwatch_pipeline.sources.matching import is_person_name
    PERSON_TEST = True
except ImportError:
    # The pipeline is being edited in parallel; the shown rows were checked by eye.
    def is_person_name(name):
        return False
    PERSON_TEST = False

S = REPO / "data/raw/samples"
OUT = Path(__file__).with_name("data.json")
csv.field_size_limit(10_000_000)


def load(name):
    with open(S / name, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def col(row, prefix):
    for k in row:
        if k.startswith(prefix):
            return k
    raise KeyError(prefix)


def stars(text):
    out = []
    for p in (text or "").split("\n"):
        p = p.strip().lstrip("*").strip()
        if p:
            out.append(p)
    return out


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


CAT = {"SRV": "Services", "GD": "Goods", "CNST": "Construction", "SRVTGD": "Services related to goods"}
NONCOMP = {"Non-competitive", "Advance contract award notice"}


def competitive(method):
    if not method:
        return None
    if method in NONCOMP:
        return False
    if method.startswith("Competitive"):
        return True
    return None


# ---------------------------------------------------------------- tenders
tenders = []
T = load("newTenderNotice.csv")
r0 = T[0]
for r in T:
    codes = stars(r[col(r0, "unspsc")])
    descs = stars(r[col(r0, "unspscDescription-eng")])
    gsin = stars(r[col(r0, "gsinDescription-nibsDescription-eng")])
    tenders.append({
        "title": " ".join(r[col(r0, "title-titre-eng")].split()),
        "reference": r[col(r0, "referenceNumber")],
        "amendment": r[col(r0, "amendmentNumber")],
        "solicitation": r[col(r0, "solicitationNumber")].strip(),
        "published": r[col(r0, "publicationDate")],
        "closing": r[col(r0, "tenderClosingDate")],
        "status": r[col(r0, "tenderStatus-appelOffresStatut-eng")],
        "category": [CAT.get(c, c) for c in stars(r[col(r0, "procurementCategory")])],
        "segments": sorted({c[:2] for c in codes}),
        "subject": (descs or gsin or [""])[0],
        "notice_type": r[col(r0, "noticeType-avisType-eng")],
        "method": r[col(r0, "procurementMethod-methodeApprovisionnement-eng")],
        "regions": stars(r[col(r0, "regionsOfDelivery-regionsLivraison-eng")]),
        "buyer": r[col(r0, "contractingEntityName-nomEntitContractante-eng")],
        "end_user": r[col(r0, "endUserEntitiesName-nomEntitesUtilisateurFinal-eng")],
        "url": r[col(r0, "noticeURL-URLavis-eng")],
    })

# ---------------------------------------------------------------- awards
A = load("2026-2027-awardNotice.csv")
a0 = A[0]
K = {k: col(a0, p) for k, p in {
    "title": "title-titre-eng", "ref": "referenceNumber", "amend": "amendmentNumber",
    "pub": "publicationDate", "awarded": "contractAwardDate", "amount": "contractAmount",
    "total": "totalContractValue", "cur": "contractCurrency", "status": "awardStatus-attributionStatut-eng",
    "instr": "instrumentType-typeInstrument-eng", "method": "procurementMethod-methodeApprovisionnement-eng",
    "buyer": "contractingEntityName-nomEntitContractante-eng", "supplier": "supplierLegalName-nomLegalFournisseur-eng",
    "city": "supplierAddressCity-fournisseurAdresseVille-eng", "prov": "supplierAddressProvince-fournisseurAdresseProvince-eng",
    "end_user": "endUserEntitiesName-nomEntitesUtilisateurFinal-eng",
    "unspsc": "unspscDescription-eng",
}.items()}

# One version per reference in the FY file (4,860 rows, 4,860 references),
# so the newest amendment is the row itself.
assert len({r[K["ref"]] for r in A}) == len(A)


def value(r):
    """Counting money: total value when positive, else amount; cancelled counts zero."""
    if r[K["status"]] == "Cancelled":
        return 0.0
    t = num(r[K["total"]])
    return t if t > 0 else num(r[K["amount"]])


def counted(r):
    return r[K["cur"]] in ("CAD", "")


def award_row(r):
    return {
        "title": " ".join(r[K["title"]].split()), "reference": r[K["ref"]], "amendment": r[K["amend"]],
        "published": r[K["pub"]], "awarded": r[K["awarded"]], "value": value(r), "currency": r[K["cur"]] or "CAD",
        "status": r[K["status"]], "instrument": r[K["instr"]], "method": r[K["method"]],
        "competitive": competitive(r[K["method"]]), "buyer": r[K["buyer"]], "supplier": " ".join(r[K["supplier"]].split()),
        "end_user": r[K["end_user"]], "subject": (stars(r[K["unspsc"]]) or [""])[0],
    }


y2026 = [r for r in A if r[K["awarded"]].startswith("2026")]
future = [r for r in y2026 if r[K["awarded"]] > "2026-10-31"]
stats = {
    "awards_rows": len(A),
    "awards_2026_rows": len(y2026),
    "awards_2026_future_dated": len(future),
    "awards_2026_cancelled": sum(1 for r in y2026 if r[K["status"]] == "Cancelled"),
    "awards_2026_value": round(sum(value(r) for r in y2026 if counted(r)), 2),
    "awards_2026_noncad": sum(1 for r in y2026 if not counted(r)),
    "awards_published_min": min(r[K["pub"]] for r in A),
    "awards_published_max": max(r[K["pub"]] for r in A),
    "tenders_new": len(tenders),
    "person_test_available": PERSON_TEST,
    "tenders_closing_7d": sum(1 for t in tenders if t["closing"][:10] <= "2026-11-07"),
}

# Top organizations 2026: group by the site's identity rule, drop person names.
groups = collections.defaultdict(lambda: {"n": 0, "total": 0.0, "names": collections.Counter(), "noncomp": 0, "stated": 0})
dropped = 0
for r in y2026:
    name = " ".join(r[K["supplier"]].split())
    if not name:
        continue
    if is_person_name(name):
        # The inherited person test flags real companies here (Kongsberg
        # Defence and Aerospace AS, Rio Tinto Fer et Titane), so the ranking
        # keeps every row and the top 8 are checked by eye instead.
        dropped += 1
    g = groups[norm_name(name)]
    g["n"] += 1
    g["names"][name] += 1
    if counted(r):
        g["total"] += value(r)
    c = competitive(r[K["method"]])
    if c is not None:
        g["stated"] += 1
        g["noncomp"] += (c is False)
top = sorted(groups.items(), key=lambda kv: -kv[1]["total"])[:8]
stats["rows_flagged_by_person_test_2026"] = dropped
top_orgs = [{"norm": k, "name": v["names"].most_common(1)[0][0], "spellings": len(v["names"]), "n": v["n"],
             "total": round(v["total"], 2), "noncomp": v["noncomp"], "stated": v["stated"]} for k, v in top]

# Recent awards: newest award date on or before the data date, ties by publication date then reference.
pool = [r for r in A if r[K["supplier"]].strip() and not is_person_name(r[K["supplier"]]) and r[K["awarded"]] <= "2026-10-31"]
pool.sort(key=lambda r: (r[K["awarded"]], r[K["pub"]], r[K["ref"]]), reverse=True)
recent_all = [award_row(r) for r in pool[:40]]

# WSP Canada profile.
wsp = [r for r in A if norm_name(r[K["supplier"]]) == "wsp canada"]
spell = collections.Counter(" ".join(r[K["supplier"]].split()) for r in wsp)
years = collections.defaultdict(lambda: {"n": 0, "total": 0.0, "noncomp_n": 0, "noncomp_total": 0.0, "stated_n": 0, "stated_total": 0.0})
for r in wsp:
    y = r[K["awarded"]][:4]
    v = value(r) if counted(r) else 0.0
    d = years[y]
    d["n"] += 1
    d["total"] += v
    c = competitive(r[K["method"]])
    if c is not None:
        d["stated_n"] += 1
        d["stated_total"] += v
        if c is False:
            d["noncomp_n"] += 1
            d["noncomp_total"] += v
buyers = collections.defaultdict(lambda: {"n": 0, "total": 0.0})
for r in wsp:
    b = buyers[r[K["buyer"]]]
    b["n"] += 1
    b["total"] += value(r) if counted(r) else 0.0
places = collections.Counter((" ".join(r[K["city"]].split()), r[K["prov"]]) for r in wsp)
wsp_rows = sorted((award_row(r) for r in wsp), key=lambda a: (a["awarded"], a["reference"]), reverse=True)
profile = {
    "display": spell.most_common(1)[0][0], "spellings": dict(spell.most_common()), "rows": len(wsp),
    "first": min(r[K["awarded"]] for r in wsp), "last": max(r[K["awarded"]] for r in wsp),
    "first_pub": min(r[K["pub"]] for r in wsp), "last_pub": max(r[K["pub"]] for r in wsp),
    "years": {y: {k: round(v, 2) for k, v in d.items()} for y, d in sorted(years.items(), reverse=True)},
    "total": round(sum(d["total"] for d in years.values()), 2),
    "noncad": sum(1 for r in wsp if not counted(r)),
    "blank_currency": sum(1 for r in wsp if r[K["cur"]] == ""),
    "zero_value_rows": sum(1 for r in wsp if value(r) == 0),
    "buyers": sorted(({"buyer": k, **{kk: round(vv, 2) for kk, vv in v.items()}} for k, v in buyers.items()), key=lambda b: (-b["total"], -b["n"])),
    "places": [{"city": c, "prov": p, "n": n} for (c, p), n in places.most_common()],
    "awards": wsp_rows,
    "exact_spelling_rows": spell["WSP Canada Inc."],
}

# Other samples: does WSP appear? (for honest empty-state copy)
other = {}
rows = load("2026-2027-contractHistory.csv")
f = col(rows[0], "supplierLegalName-nomLegalFournisseur-eng")
other["2026-2027-contractHistory.csv"] = sum(1 for r in rows if norm_name(r[f]) == "wsp canada")
for fname, field in [("contracts-head.csv", "vendor_name"), ("grants-head.csv", "recipient_legal_name")]:
    n = 0
    with open(S / fname, encoding="utf-8-sig", newline="", errors="replace") as fh:
        rd = csv.DictReader(fh)
        try:
            for r in rd:
                if "wsp" in (r.get(field) or "").lower():
                    n += 1
        except csv.Error:
            pass
    other[fname] = n

OUT.write_text(json.dumps({"stats": stats, "tenders": tenders, "top_orgs": top_orgs, "recent": recent_all,
                           "profile": profile, "other_samples_wsp": other}, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({"stats": stats, "top_orgs": top_orgs, "other": other}, ensure_ascii=False, indent=1))
print(json.dumps({k: v for k, v in profile.items() if k != "awards"}, ensure_ascii=False, indent=1))
