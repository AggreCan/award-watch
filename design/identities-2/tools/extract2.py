"""Figures the second round of mockups needs beyond extract.py: weekly award
counts, facet counts over the 25 new notices, one notice's detail, and WSP
Canada's rows in the FY2026-27 contract history file. Writes extra.json."""
import csv, json, re, sys, collections
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "pipeline"))
from awardwatch_pipeline.normalize import norm_name
from awardwatch_pipeline.sources.matching import is_person_name

S = REPO / "data/raw/samples"
OUT = Path(__file__).with_name("extra.json")
csv.field_size_limit(10_000_000)
TODAY = date(2026, 10, 31)


def load(name):
    with open(S / name, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def stars(text):
    return [p.strip().lstrip("*").strip() for p in (text or "").split("\n") if p.strip().lstrip("*").strip()]


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# ------------------------------------------------------------ award notices by publication date
A = load("2026-2027-awardNotice.csv")
by_pub = collections.Counter(r["publicationDate-datePublication"] for r in A)
week = [str(TODAY - timedelta(days=i)) for i in range(0, 7)]          # 10-25 .. 10-31
prev = [str(TODAY - timedelta(days=i)) for i in range(7, 14)]         # 10-18 .. 10-24
y2026_this_week = sum(1 for r in A if r["contractAwardDate-dateAttributionContrat"].startswith("2026")
                      and r["publicationDate-datePublication"] in week)

# ------------------------------------------------------------ facets over the 25 new notices
T = load("newTenderNotice.csv")
CAT = {"SRV": "Services", "GD": "Goods", "CNST": "Construction"}
facets = {"category": collections.Counter(), "notice_type": collections.Counter(), "buyer": collections.Counter(),
          "method": collections.Counter()}
closing_days = []
for r in T:
    for c in stars(r["procurementCategory-categorieApprovisionnement"]):
        facets["category"][CAT.get(c, c)] += 1
    facets["notice_type"][r["noticeType-avisType-eng"]] += 1
    facets["buyer"][r["contractingEntityName-nomEntitContractante-eng"]] += 1
    facets["method"][r["procurementMethod-methodeApprovisionnement-eng"]] += 1
    closing_days.append((date.fromisoformat(r["tenderClosingDate-appelOffresDateCloture"][:10]) - TODAY).days)

# ------------------------------------------------------------ one notice in detail (no contact fields: rule 3)
CONTACT = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}")


def opening(text: str, n: int = 320) -> str:
    """The description's opening words, cut before any email or phone number (contacts stay on CanadaBuys)."""
    text = " ".join((text or "").split())
    m = CONTACT.search(text)
    if m:
        text = text[:m.start()]
    return text[:n]

def detail(ref):
    r = next(x for x in T if x["referenceNumber-numeroReference"] == ref)
    return {
        "title": " ".join(r["title-titre-eng"].split()), "reference": ref,
        "amendment": r["amendmentNumber-numeroModification"], "solicitation": r["solicitationNumber-numeroSollicitation"],
        "published": r["publicationDate-datePublication"], "closing": r["tenderClosingDate-appelOffresDateCloture"],
        "start": r["expectedContractStartDate-dateDebutContratPrevue"], "end": r["expectedContractEndDate-dateFinContratPrevue"],
        "status": r["tenderStatus-appelOffresStatut-eng"], "unspsc": stars(r["unspsc"]),
        "unspsc_desc": stars(r["unspscDescription-eng"]),
        "category": [CAT.get(c, c) for c in stars(r["procurementCategory-categorieApprovisionnement"])],
        "notice_type": r["noticeType-avisType-eng"], "method": r["procurementMethod-methodeApprovisionnement-eng"],
        "selection": r["selectionCriteria-criteresSelection-eng"], "trade": stars(r["tradeAgreements-accordsCommerciaux-eng"]),
        "regions": stars(r["regionsOfDelivery-regionsLivraison-eng"]), "buyer": r["contractingEntityName-nomEntitContractante-eng"],
        "buyer_city": r["contractingEntityAddressCity-entiteContractanteAdresseVille-eng"],
        "buyer_prov": r["contractingEntityAddressProvince-entiteContractanteAdresseProvince-eng"],
        "end_user": r["endUserEntitiesName-nomEntitesUtilisateurFinal-eng"],
        "description": opening(r["tenderDescription-descriptionAppelOffres-eng"]),
    }

# ------------------------------------------------------------ WSP in the contract history FY file
H = load("2026-2027-contractHistory.csv")
F = {k: next(c for c in H[0] if c.startswith(p)) for k, p in {
    "ref": "referenceNumber", "amend": "amendmentNumber", "awarded": "contractAwardDate", "amount": "contractAmount",
    "total": "totalContractValue", "cur": "contractCurrency", "status": "contractStatus-statutContrat-eng",
    "method": "procurementMethod-methodeApprovisionnement-eng", "supplier": "supplierLegalName-nomLegalFournisseur-eng",
    "title": "title-titre-eng", "end_user": "endUserEntitiesName-nomEntitesUtilisateurFinal-eng",
    "instr": "instrumentType-typeInstrument-eng", "pub": "publicationDate"}.items()}
wsp = [r for r in H if norm_name(r[F["supplier"]]) == "wsp canada"]
newest = {}
for r in wsp:
    k = r[F["ref"]]
    if k not in newest or int(r[F["amend"]] or 0) > int(newest[k][F["amend"]] or 0):
        newest[k] = r


def hvalue(r):
    if r[F["status"]] == "Cancelled":
        return 0.0
    t = num(r[F["total"]])
    return t if t > 0 else num(r[F["amount"]])


NONCOMP = {"Non-competitive", "Advance contract award notice"}
hy = collections.defaultdict(lambda: {"n": 0, "total": 0.0, "noncomp_n": 0, "noncomp_total": 0.0, "stated_n": 0})
for r in newest.values():
    y = r[F["awarded"]][:4]
    v = hvalue(r) if r[F["cur"]] in ("CAD", "") else 0.0
    d = hy[y]
    d["n"] += 1
    d["total"] += v
    m = r[F["method"]]
    if m:
        d["stated_n"] += 1
        if m in NONCOMP:
            d["noncomp_n"] += 1
            d["noncomp_total"] += v
hist_rows = sorted(({"reference": r[F["ref"]], "amendment": r[F["amend"]], "awarded": r[F["awarded"]],
                     "value": hvalue(r), "currency": r[F["cur"]], "status": r[F["status"]], "method": r[F["method"]],
                     "title": " ".join(r[F["title"]].split()), "end_user": r[F["end_user"]], "instrument": r[F["instr"]],
                     "published": r[F["pub"]]} for r in newest.values()), key=lambda x: (x["awarded"], x["reference"]), reverse=True)

# Award notices published on 2026-10-30, the file's newest publication date.
NONCOMP_A = {"Non-competitive", "Advance contract award notice"}


def avalue(r):
    if r["awardStatus-attributionStatut-eng"] == "Cancelled":
        return 0.0
    t = num(r["totalContractValue-valeurTotaleContrat"])
    return t if t > 0 else num(r["contractAmount-montantContrat"])


yest = []
withheld = 0
for r in A:
    if r["publicationDate-datePublication"] != "2026-10-30":
        continue
    sup = " ".join(r["supplierLegalName-nomLegalFournisseur-eng"].split())
    if not sup or is_person_name(sup):
        withheld += 1
        continue
    m = r["procurementMethod-methodeApprovisionnement-eng"]
    yest.append({"reference": r["referenceNumber-numeroReference"], "title": " ".join(r["title-titre-eng"].split()),
                 "supplier": sup, "buyer": r["contractingEntityName-nomEntitContractante-eng"],
                 "awarded": r["contractAwardDate-dateAttributionContrat"], "value": avalue(r),
                 "currency": r["contractCurrency-contratMonnaie"] or "CAD", "status": r["awardStatus-attributionStatut-eng"],
                 "instrument": r["instrumentType-typeInstrument-eng"], "method": m,
                 "competitive": None if not m else (False if m in NONCOMP_A else (True if m.startswith("Competitive") else None))})
yest.sort(key=lambda a: (-a["value"], a["reference"]))

out = {
    "awards_by_pub": {d: by_pub.get(d, 0) for d in sorted(week + prev)},
    "awards_by_pub_28": {str(date(2026, 10, 30) - timedelta(days=i)): by_pub.get(str(date(2026, 10, 30) - timedelta(days=i)), 0)
                         for i in range(27, -1, -1)},
    "awards_this_week": sum(by_pub.get(d, 0) for d in week),
    "awards_prev_week": sum(by_pub.get(d, 0) for d in prev),
    "awards_yesterday": by_pub.get("2026-10-30", 0),
    "awards_2026_published_this_week": y2026_this_week,
    "facets": {k: dict(v.most_common()) for k, v in facets.items()},
    "closing_within_7": sum(1 for d in closing_days if d <= 7),
    "closing_within_14": sum(1 for d in closing_days if d <= 14),
    "detail": detail("cb-746-37313616"),
    "details": {r["referenceNumber-numeroReference"]: detail(r["referenceNumber-numeroReference"]) for r in T},
    "awards_yesterday_rows": yest, "awards_yesterday_withheld": withheld,
    "wsp_history": {"rows": len(wsp), "references": len(newest),
                    "years": {y: {k: round(v, 2) for k, v in d.items()} for y, d in sorted(hy.items(), reverse=True)},
                    "total": round(sum(d["total"] for d in hy.values()), 2), "list": hist_rows,
                    "spellings": dict(collections.Counter(" ".join(r[F["supplier"]].split()) for r in wsp))},
}
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps({k: v for k, v in out.items() if k in ("awards_by_pub_28",)}, ensure_ascii=False, indent=1)[:6000])
