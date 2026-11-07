"""The match key: a looser form of a name, for the spelling merge rule (merges.py) and the review list.

normalize.norm_name already folds case, punctuation, accents, "and" and
"et", initials and a trailing legal form, so spellings that differ only in
those are one organization already (one id). What still splits a company is
something norm_name keeps: the name written in both languages in one string,
words or a vendor code after its legal form, a bracketed acronym, an
abbreviation, a space. The key leaves those out, in this order; the names in
quotes are the steps the review file records for each group:

1. the legal part only (normalize.split_trade_name): an operating name never
   makes a key;
2. brackets: dropped when the content is an acronym ("acronym": 2 to 8
   capitals, not a place, starting with the name's first letter), or when it
   follows a complete legal name and holds no legal form ("words after the
   form"). Kept when it sits before the legal form ("Thermo Fisher Scientific
   (Mississauga) Inc."), follows a name with no legal form
   ("COMMISSIONAIRES (NOVA SCOTIA DIVISION)", each division its own
   corporation) or holds a digit ("WILDERNESS HELICOPTERS (2009) LTD.", a
   successor company);
3. normalize.norm_legal with a sentinel word appended, so a trailing legal
   form stays a token the next steps can see;
4. abbreviations expanded from a fixed list ("abbreviation": "Cnslt." reads
   "consulting");
5. parties: each run of words closed by a legal form is a complete legal
   name, except a form followed by of, de, du, des, for or pour ("AC NIELSEN
   COMPANY OF CANADA" stays whole);
6. a joint venture, consortium or partnership gets no key, and neither do two
   complete legal names that share no distinctive word ("IPSS Inc.,
   ServiceNow Inc."). Two that share one are one name in two languages ("both
   languages": "IBM Canada Limited/IBM Canada Limitee"). Words after the
   first party are left out ("vendor code" when they hold a digit, "words
   after the form" otherwise);
7. the key is the first party's name words (or every word, when the name
   has no legal form), its legal form left out, with the spaces removed
   ("spacing" when two members differ only there), and only when one of the
   words is distinctive (a word of three letters or more that is no generic
   business word, stop word, legal form or place, or a number of five
   digits or more): "University of Toronto" and "City of Ottawa" get none.

Every rule here exists because an earlier form of the key merged two
different organizations; tests/test_match_key.py holds the pairs it must keep
apart. merges.py adds the guard it cannot see from one spelling: an
organization with a spelling that reads as a person gets no key at all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .normalize import LEGAL_SUFFIXES, fold_accents, has_legal_form, norm_legal, split_trade_name
from .sources.matching import GENERIC_WORDS, first_language

# Appended before norm_legal so a trailing legal form is not stripped; removed after.
SENTINEL = "zzkeyendzz"
# Words that name no one organization, besides matching.GENERIC_WORDS (merges.py reads them too).
STOP_WORDS = frozenset({"the", "of", "for", "and", "et", "de", "la", "le", "les", "du", "des", "an", "in", "on", "at",
                        "to", "canada", "canadian", "canadien", "canadienne"})
ABBREVIATIONS = {
    **dict.fromkeys(("cnslt", "cnsltg", "cons", "conslt", "consltg", "consult", "consultg"), "consulting"),
    **dict.fromkeys(("svc", "svcs", "srvcs", "serv", "servs"), "services"),
    **dict.fromkeys(("eng", "engg", "engr", "engrg"), "engineering"),
    **dict.fromkeys(("env", "envir"), "environmental"),
    "intl": "international",
    **dict.fromkeys(("assoc", "assocs"), "associates"),
    **dict.fromkeys(("mgmt", "mgt", "mngt"), "management"),
    **dict.fromkeys(("techn", "techno", "technol", "techs"), "technologies"),
    "syst": "systems",
    "devel": "development",
    "grp": "group",
    "cdn": "canadian",
}
# A spelling naming one of these names a party of its own, never one of its members.
JOINT_WORDS = frozenset({"joint", "jointventure", "jv", "consortium", "coentreprise", "partnership", "partenariat"})
# A legal form followed by one of these is part of the name ("Company of Canada", "Compagnie de ...").
OF_WORDS = frozenset({"of", "de", "du", "des", "for", "pour"})
PROVINCE_WORDS = frozenset({
    "alberta", "alta", "british", "columbia", "colombie", "britannique", "manitoba", "brunswick", "nouveau",
    "newfoundland", "labrador", "nova", "scotia", "nouvelle", "ecosse", "ontario", "ont", "prince", "edward",
    "island", "pei", "quebec", "que", "saskatchewan", "sask", "yukon", "northwest", "territories", "territoires",
    "nwt", "nunavut", "ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt",
})
CITY_WORDS = frozenset({
    "toronto", "montreal", "vancouver", "calgary", "edmonton", "ottawa", "winnipeg", "hamilton", "kitchener",
    "london", "victoria", "halifax", "dartmouth", "oshawa", "windsor", "saskatoon", "regina", "gatineau", "hull",
    "sherbrooke", "kelowna", "barrie", "guelph", "kingston", "moncton", "sudbury", "saguenay", "levis", "laval",
    "longueuil", "brampton", "mississauga", "markham", "burnaby", "surrey", "richmond", "abbotsford", "nanaimo",
    "fredericton", "charlottetown", "whitehorse", "yellowknife", "iqaluit", "waterloo", "trenton", "petawawa",
    "esquimalt", "gander",
})
REGION_WORDS = frozenset({
    "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "northern", "southern",
    "eastern", "western", "central", "atlantic", "pacific", "prairie", "prairies", "arctic", "maritimes", "region",
    "ncr", "nord", "sud", "est", "ouest",
})
PLACE_WORDS = PROVINCE_WORDS | CITY_WORDS | REGION_WORDS | {"division", "branch", "office", "canada", "usa"}

_BRACKET_RE = re.compile(r"\(([^()]*)\)")
_ACRONYM_RE = re.compile(r"^[A-Z]{2,8}$")
# "Co-operative", "Co-op": the "co" is no company form.
_CO_OP_RE = re.compile(r"\bco-(?=op)", re.I)
_SEPARATORS = " .,;:-/\\"


@dataclass(frozen=True)
class Key:
    key: str                    # the words with the spaces removed
    words: tuple[str, ...]      # the first party's name words (every word with no party)
    steps: frozenset[str]       # what was left out or changed to reach it


def distinctive(word: str) -> bool:
    """A word that can tell one organization from another: three letters or more and no generic word,
    stop word, legal form or place, or a number of five digits or more."""
    if word.isdigit():
        return len(word) >= 5
    return (len(word) >= 3 and word not in GENERIC_WORDS and word not in STOP_WORDS and word not in LEGAL_SUFFIXES
            and word not in PLACE_WORDS)


def _brackets(text: str, steps: set[str]) -> str:
    """Step 2: drop a bracketed acronym, or a bracket after a complete legal name holding no legal form."""
    out = text
    # From the last bracket back, so the positions of the earlier ones still hold.
    for m in reversed(list(_BRACKET_RE.finditer(text))):
        inner = m.group(1).strip()
        if re.search(r"\d", inner):
            continue  # a year or a number: a successor company, or a code kept for the parties step
        before = out[:m.start()].rstrip(_SEPARATORS)
        after = out[m.end():].strip(_SEPARATORS)
        first = re.search(r"[^\W\d_]", before)
        if (_ACRONYM_RE.match(inner) and inner.casefold() not in PLACE_WORDS and first
                and fold_accents(first.group(0)).upper() == inner[0]):
            out = out[:m.start()] + " " + out[m.end():]
            steps.add("acronym")
        elif not after and has_legal_form(before) and not has_legal_form(inner):
            out = out[:m.start()] + " " + out[m.end():]
            steps.add("words after the form")
    return out


def _parties(tokens: list[str]) -> tuple[list[list[str]], list[str]]:
    """Step 5: the complete legal names (their name words, the form left out), and the words after the last."""
    parties: list[list[str]] = []
    run: list[str] = []
    for i, tok in enumerate(tokens):
        nxt = tokens[i + 1] if i + 1 < len(tokens) else ""
        if tok in LEGAL_SUFFIXES and nxt not in OF_WORDS:
            if run:
                parties.append(run)
                run = []
            elif not parties:
                run.append(tok)  # a name that starts with a form word ("Corporation X") keeps it as a word
            # else: a second form straight after the first ("Inc. Ltd."), part of the same party
        else:
            run.append(tok)
    return parties, run


def match_key(raw: str | None) -> Key | None:
    """The key of one spelling, or None (a joint venture, two companies, no distinctive word)."""
    text = first_language(raw)
    if not text:
        return None
    steps: set[str] = set()
    legal = split_trade_name(text)[0]
    legal = _CO_OP_RE.sub("co", _brackets(legal, steps))
    tokens = norm_legal(f"{legal} {SENTINEL}").split()
    if not tokens or tokens[-1] != SENTINEL:
        return None
    tokens = tokens[:-1]
    expanded = [ABBREVIATIONS.get(t, t) for t in tokens]
    if expanded != tokens:
        steps.add("abbreviation")
    tokens = expanded
    if not tokens or any(t in JOINT_WORDS for t in tokens):
        return None
    parties, rest = _parties(tokens)
    if parties:
        words = parties[0]
        own = {w for w in words if distinctive(w)}
        for other in parties[1:]:
            if not own & {w for w in other if distinctive(w)}:
                return None  # two companies, not one name twice
            steps.add("both languages")
        if rest:
            if own & {w for w in rest if distinctive(w)}:
                steps.add("both languages")
            elif any(ch.isdigit() for w in rest for ch in w):
                steps.add("vendor code")
            else:
                steps.add("words after the form")
    else:
        words = rest
    if not any(distinctive(w) for w in words):
        return None
    return Key("".join(words), tuple(words), frozenset(steps))


def strip_places(words: tuple[str, ...]) -> tuple[str, ...]:
    """The words without the place words (and "of", "the") that end them: "cofomo ottawa" -> "cofomo"."""
    out = list(words)
    while out and (out[-1] in PLACE_WORDS or out[-1] in OF_WORDS or out[-1] == "the"):
        out.pop()
    return tuple(out)


def edit_distance(a: str, b: str, limit: int = 2) -> int | None:
    """The optimal string alignment distance (a transposition counts one) when it is at most limit, else None."""
    if abs(len(a) - len(b)) > limit:
        return None
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = a[i - 1] != b[j - 1]
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        if min(cur) > limit:
            return None
        prev2, prev = prev, cur
    return prev[-1] if prev[-1] <= limit else None
