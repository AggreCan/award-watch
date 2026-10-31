"""Build awardwatch_pipeline/data/given_names.txt, the given names the person test requires.

Run from pipeline/: `python scripts/build_given_names.py`. Each source is one
open-data file fetched with the polite client; a source that cannot be
fetched (a refusal included, which is never worked around) is named in the
file's header and the list is built from the others. Names are folded as
matching.given_name_key folds them (accents, case, apostrophes); names of one
or two letters and names that are also business words in the person test are
left out, since a business word already makes a name a firm's.

Sources and thresholds (births summed over every year a file covers):

* US Social Security Administration, national baby names (public domain): 300.
* INSEE, fichier des prénoms, national file (Licence Ouverte): 300.
* Retraite Québec, banque de prénoms, boys and girls (CC BY 4.0): 50.
  A cell "<5" counts as zero, so a name passes on births actually counted.
* Ontario, top baby names, male and female (Open Government Licence -
  Ontario): 5, which is every name the file holds (Ontario publishes a name
  for a year once five babies got it). Added when the SSA file was refused,
  so that the given names of English-speaking Canada are on the list; a low
  threshold because it stands in for a far larger file.

No birth register holds the short forms people go by in business ("Doug",
"Rob", "Bill"); SHORT_FORMS adds the common English ones by hand, since a
person read as a firm is published.
"""

from __future__ import annotations

import csv
import io
import sys
import zipfile
from collections import Counter
from collections.abc import Callable
from datetime import datetime, timezone

from awardwatch_pipeline import config
from awardwatch_pipeline.http import PoliteClient
from awardwatch_pipeline.sources.matching import PUBLIC_BUSINESS_WORDS, given_name_key

OUT = config.PACKAGE_DATA / "given_names.txt"


def _ssa(data: bytes) -> Counter[str]:
    counts: Counter[str] = Counter()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for member in zf.namelist():
            if not member.lower().endswith(".txt"):
                continue
            for name, _sex, n in csv.reader(io.StringIO(zf.read(member).decode("utf-8"))):
                counts[name] += int(n)
    return counts


def _insee(data: bytes) -> Counter[str]:
    counts: Counter[str] = Counter()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        member = next(m for m in zf.namelist() if m.lower().endswith(".csv"))
        reader = csv.DictReader(io.StringIO(zf.read(member).decode("utf-8")), delimiter=";")
        for row in reader:
            name = row["preusuel"]
            if not name.startswith("_"):  # _PRENOMS_RARES pools the rare names
                counts[name] += int(row["nombre"])
    return counts


def _quebec(data: bytes) -> Counter[str]:
    counts: Counter[str] = Counter()
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig")))
    next(reader)
    for row in reader:
        counts[row[0]] += sum(int(cell) for cell in row[1:] if cell.strip().isdigit())
    return counts


def _ontario(data: bytes) -> Counter[str]:
    counts: Counter[str] = Counter()
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig")))
    next(reader)
    for row in reader:
        if len(row) >= 3 and row[2].strip().isdigit():
            counts[row[1]] += int(row[2])
    return counts


SOURCES: list[tuple[str, str, list[str], Callable[[bytes], Counter[str]], int]] = [
    ("US Social Security Administration, national baby names, public domain", "ssa",
     ["https://www.ssa.gov/oact/babynames/names.zip"], _ssa, 300),
    ("INSEE, fichier des prénoms (national file, 1900-2022), Licence Ouverte", "insee",
     ["https://www.insee.fr/fr/statistiques/fichier/7633685/nat2022_csv.zip"], _insee, 300),
    ("Retraite Québec, banque de prénoms (boys and girls, 1980-2025), CC BY 4.0, donneesquebec.ca", "quebec",
     ["https://www.donneesquebec.ca/recherche/dataset/93d640ec-d059-4768-b7ed-388604b278aa/resource/"
      "039539f5-af55-4d8f-9010-ca718e45c2a5/download/grande_listeg_csv.csv",
      "https://www.donneesquebec.ca/recherche/dataset/13db2583-427a-4e5f-b679-8532d3df571f/resource/"
      "bf77b504-54b9-4db8-be53-b92156175c12/download/grande_listef_csv.csv"], _quebec, 50),
    ("Ontario, top baby names (male and female, 1913-2024), Open Government Licence - Ontario, data.ontario.ca",
     "ontario",
     ["https://data.ontario.ca/dataset/eb4c585c-6ada-4de7-8ff1-e876fb1a6b0b/resource/"
      "5d8b8ece-fa01-43c5-955b-4b642b28c559/download/baby_names_-_male.csv",
      "https://data.ontario.ca/dataset/4d339626-98f9-49fe-aede-d64f03fa914f/resource/"
      "acc72e92-3100-4a04-8f5f-4fad9cd77cc5/download/baby_names_-_female_.csv"], _ontario, 5),
]

SHORT_FORMS = """
abe alf andy barb bart ben bernie bert bev bill billy bob bobby brad cathy chris chuck cindy dan danny dave
davey deb debbie dick don donny doug eddie fred freddy gerry greg hank herb jake jeff jen jenny jerry jim
jimmy joe joey johnny jon ken kenny larry len les liz lou matt mick mike mitch nick pam pat pete phil randy
ray rick ricky rob robbie ron ronnie russ sam sandy steve stu sue suzy ted terry tim timmy tom tommy tony
val vic vince wally walt will willy zach
""".split()


def build(client: PoliteClient) -> tuple[list[str], list[str]]:
    """The sorted names and the header lines."""
    names: set[str] = set()
    header = [
        "# Given names the person test requires (sources/matching.is_person_name), one per line,",
        "# folded by matching.given_name_key. Built by pipeline/scripts/build_given_names.py on "
        f"{datetime.now(timezone.utc).date().isoformat()}.",
        "# A name of one or two letters, or one that is also a business word of the person test, is left out.",
        "# Sources (births summed over the years each file covers, at least the threshold given):",
    ]
    for label, _key, urls, parse, threshold in SOURCES:
        counts: Counter[str] = Counter()
        try:
            for url in urls:
                counts.update(parse(client.get(url, timeout=300)))
        except Exception as exc:  # any failure leaves this source out, and the header says so
            status = getattr(exc, "status", None)
            reason = f"HTTP {status}" if status else type(exc).__name__
            header.append(f"#   NOT USED: {label}: could not be fetched ({reason}) from {', '.join(urls)}")
            print(f"{label}: not used ({reason})", file=sys.stderr)
            continue
        folded: Counter[str] = Counter()
        for raw, n in counts.items():
            key = given_name_key(raw)
            if key:
                folded[key] += n
        kept = {k for k, n in folded.items() if n >= threshold}
        names |= kept
        header.append(f"#   {label}: at least {threshold} births, {len(kept)} names; {', '.join(urls)}")
    names |= set(SHORT_FORMS)
    header.append(f"#   Short forms no birth register holds, added by hand (SHORT_FORMS in the script): {len(SHORT_FORMS)}.")
    names = {n for n in names if len(n.replace("-", "")) > 2 and n not in PUBLIC_BUSINESS_WORDS}
    header.append(f"# {len(names)} names in all.")
    return sorted(names), header


def main() -> int:
    names, header = build(PoliteClient())
    if not names:
        print("no source could be fetched; the list is left as it was", file=sys.stderr)
        return 1
    OUT.write_text("\n".join(header + names) + "\n", encoding="utf-8", newline="\n")
    print(f"{OUT}: {len(names)} names")
    return 0


if __name__ == "__main__":
    sys.exit(main())
