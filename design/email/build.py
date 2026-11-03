"""Email prototypes in the site's identity: the sign-in code, a saved-search
digest of new tender notices, and the weekly radar of contracts entering the
3-month window, each in English and French.

Writes, beside this file: <kind>.<lang>.html (the template as a client would
receive it: tables, inline styles, a hosted PNG wordmark with text fallback),
<kind>.<lang>.txt (the plain-text part), and prototypes.html, one sheet that
shows every rendering with the site's own Inter inlined and two switches
(system fonts, dark).

Constraints the markup keeps to: a 600 px single column; every style inline
(Gmail drops <style> for some senders); no web fonts in the templates (most
clients ignore them, and a font request is a third-party call); the wordmark
as a hosted PNG because Gmail strips SVG; both an HTML and a plain-text part;
no images that carry meaning. Dark mode: a color-scheme meta and class
overrides under prefers-color-scheme, which Apple Mail and iOS honour; Gmail
inverts on its own, and the palette survives inversion.
"""
import base64
import html
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORDMARK_SVG = (ROOT / "brand" / "wordmark.svg").read_text(encoding="utf-8")
FONT_B64 = base64.b64encode((ROOT / "site" / "public" / "fonts" / "InterVariable.woff2").read_bytes()).decode()

C = {
    "page": "#f8fafc", "panel": "#ffffff", "head": "#eef2f7", "border": "#e2e8f0", "border2": "#cbd5e1",
    "ink": "#0f172a", "ink2": "#334155", "muted": "#5b6b80", "accent": "#0f7b4f", "amber": "#b45309",
}
FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
SITE = "https://awardwatch.ca"
NBSP = " "


def T(s: str, **kw) -> str:
    for k, v in kw.items():
        s = s.replace("{{" + k + "}}", str(v))
    return s


# -- the shell ------------------------------------------------------------------------------

# Overrides for a dark client, as rules under a selector prefix: the media
# query in the templates, the .dark class on the sheet.
DARK_RULES = [
    (".bg", "background:#0b1220!important"),
    (".card", "background:#111a2b!important;border-color:#243044!important"),
    (".ink, .ink a", "color:#e5edf7!important"),
    (".ink2", "color:#c7d2e0!important"),
    (".muted, .muted a", "color:#8da0b8!important"),
    (".band", "background:#17233a!important;border-color:#2b3a52!important"),
    (".rule", "border-color:#243044!important"),
    (".btn", "background:#e5edf7!important"),
    (".btn a", "color:#0f172a!important"),
    (".chip", "border-color:#3b4a63!important;color:#c7d2e0!important"),
    (".logo-light", "display:none!important"),
    (".logo-dark", "display:block!important"),
]


def dark_css(prefix: str) -> str:
    return "".join(f"{prefix}{sel}{{{rule}}}" for sel, rule in DARK_RULES)


HEAD_CSS = T("""
  body{margin:0;padding:0;background:{{page}};}
  table{border-collapse:collapse;}
  img{border:0;outline:none;text-decoration:none;}
  @media (prefers-color-scheme: dark){ {{dark}} }
  @media only screen and (max-width:620px){ .wrap{width:100%!important;} .pad{padding-left:18px!important;padding-right:18px!important;} }
""", page=C["page"], dark=dark_css(""))

# The wordmark: two hosted PNGs at 2x, 142 by 20 CSS pixels, with the name
# as the fallback text for a client that shows no images. The light one is
# ink on a baked white ground, so a client that darkens the page on its own
# and leaves images alone (the Gmail apps) still shows it as a white tab;
# the dark one is light ink on a transparent ground, shown instead by the
# clients that honour the dark query (Apple Mail, iOS Mail, Outlook for Mac).
WORDMARK_IMG = T(
    '<a href="{{site}}" style="text-decoration:none;">'
    '<img class="logo-light" src="{{site}}/brand/wordmark.png" width="142" height="20" alt="Award Watch" '
    'style="display:block;border:0;width:142px;height:20px;font:700 18px {{font}};color:{{ink}};">'
    '<img class="logo-dark" src="{{site}}/brand/wordmark-dark.png" width="142" height="20" alt="Award Watch" '
    'style="display:none;border:0;width:142px;height:20px;font:700 18px {{font}};color:#e5edf7;"></a>',
    site=SITE, ink=C["ink"], font=FONT)

SHELL = T("""<!DOCTYPE html>
<html lang="{{lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{{subject}}</title>
<style>{{css}}</style>
</head>
<body class="bg" style="margin:0;padding:0;background:{{page}};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{{preheader}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:{{page}};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="wrap card" style="width:600px;max-width:600px;background:{{panel}};border:1px solid {{border}};">
  <tr><td class="pad" style="padding:18px 28px 14px 28px;border-bottom:2px solid {{accent}};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="logo" style="vertical-align:middle;color:{{ink}};">{{wordmark}}</td>
      <td align="right" class="muted" style="vertical-align:middle;font:13px/1 {{font}};color:{{muted}};"><a href="{{site}}{{langq}}" style="color:{{muted}};text-decoration:none;">awardwatch.ca</a></td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:24px 28px 8px 28px;">{{body}}</td></tr>
  <tr><td class="pad rule" style="padding:14px 28px 20px 28px;border-top:1px solid {{border}};">
    <p class="muted" style="margin:0 0 6px 0;font:12px/1.5 {{font}};color:{{muted}};">{{why}}</p>
    <p class="muted" style="margin:0;font:12px/1.5 {{font}};color:{{muted}};">{{tagline}} · <a href="mailto:contact@awardwatch.ca" style="color:{{muted}};">contact@awardwatch.ca</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
""", css=HEAD_CSS, **C, font=FONT, site=SITE, wordmark=WORDMARK_IMG)


def p(text: str, cls: str = "ink2", size: int = 15, margin: str = "0 0 14px 0") -> str:
    color = C["ink2"] if cls == "ink2" else C["ink"] if cls == "ink" else C["muted"]
    return f'<p class="{cls}" style="margin:{margin};font:{size}px/1.5 {FONT};color:{color};">{text}</p>'


def h1(text: str) -> str:
    return f'<h1 class="ink" style="margin:0 0 12px 0;font:700 20px/1.3 {FONT};color:{C["ink"]};">{text}</h1>'


def button(href: str, label: str) -> str:
    return T("""<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px 0;"><tr>
  <td class="btn" style="background:{{ink}};"><a href="{{href}}" style="display:inline-block;padding:11px 18px;font:600 14px/1 {{font}};color:#ffffff;text-decoration:none;">{{label}}</a></td>
</tr></table>""", ink=C["ink"], href=href, font=FONT, label=label)


def code_box(code: str, aria: str) -> str:
    return T("""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;"><tr>
  <td class="band" align="center" style="background:{{head}};border:1px solid {{border2}};padding:18px;">
    <span class="ink" role="text" aria-label="{{aria}}" style="font:700 30px/1 {{font}};letter-spacing:0.22em;color:{{ink}};font-variant-numeric:tabular-nums;">{{code}}</span>
  </td>
</tr></table>""", head=C["head"], border2=C["border2"], aria=aria, font=FONT, ink=C["ink"], code=code)


def chip(text: str) -> str:
    return (f'<span class="chip" style="display:inline-block;border:1px solid {C["border2"]};padding:1px 6px;'
            f'font:12px/1.4 {FONT};color:{C["ink2"]};white-space:nowrap;">{text}</span>')


def row(title: str, href: str, line2: str, line3: str, first: bool) -> str:
    border = "" if first else f"border-top:1px solid {C['border']};"
    return T("""<tr><td class="rule" style="padding:12px 0;{{border}}">
  <a class="ink" href="{{href}}" style="font:600 15px/1.4 {{font}};color:{{ink}};text-decoration:none;">{{title}}</a>
  <div class="ink2" style="margin-top:3px;font:13px/1.5 {{font}};color:{{ink2}};">{{line2}}</div>
  <div class="muted" style="margin-top:2px;font:13px/1.5 {{font}};color:{{muted}};">{{line3}}</div>
</td></tr>""", border=border, href=href, font=FONT, ink=C["ink"], title=title, line2=line2, ink2=C["ink2"], line3=line3, muted=C["muted"])


def rows(items: list) -> str:
    return ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 10px 0;">'
            + "".join(items) + "</table>")


def amber(text: str) -> str:
    return f'<span style="color:{C["amber"]};font-weight:600;">{text}</span>'


# -- the content ---------------------------------------------------------------------------

TAGLINE = {
    "en": "Award Watch · Federal tenders, awards, contracts and grants, by organization.",
    "fr": "Award Watch · Appels d'offres, attributions, contrats et subventions du fédéral, par organisation.",
}
LANGQ = {"en": "", "fr": "/?lang=fr"}
FOOT_SEARCH = {
    "en": 'You receive this {{when}} for a saved search in your account. <a href="{{site}}/account/searches" style="color:{{muted}};">Saved searches</a> · <a href="{{site}}/account/searches" style="color:{{muted}};">Stop this delivery</a>',
    "fr": 'Vous recevez ce message {{when}} pour une recherche enregistrée dans votre compte. <a href="{{site}}/account/searches?lang=fr" style="color:{{muted}};">Recherches enregistrées</a> · <a href="{{site}}/account/searches?lang=fr" style="color:{{muted}};">Arrêter cet envoi</a>',
}

NOTICES = [
    {"title": "Solenoid Procurement", "ref": "cb-746-37313616",
     "buyer": {"en": "National Defence · Ontario", "fr": "Défense nationale · Ontario"},
     "closing": "2026-11-05 14:00", "days": 3, "chip": {"en": "31 Manufacturing components", "fr": "31 Composants de fabrication"}},
    {"title": "Pacific Science Enterprise Center (PSEC) - Power Distribution Upgrade", "ref": "cb-106-83883729",
     "buyer": {"en": "Fisheries and Oceans Canada · British Columbia", "fr": "Pêches et Océans Canada · Colombie-Britannique"},
     "closing": "2026-11-16 14:00", "days": 14, "chip": {"en": "72 Construction", "fr": "72 Construction"}},
    {"title": "Open license for lidar data and data analysis", "ref": "cb-29-37893161",
     "buyer": {"en": "Natural Resources Canada · Canada-wide", "fr": "Ressources naturelles Canada · Partout au Canada"},
     "closing": "2026-11-16 14:00", "days": 14, "chip": {"en": "81 Engineering", "fr": "81 Ingénierie"}},
]
CONTRACTS = [
    {"title": "Robotics targets", "ref": "w8486-091234-001-abc", "supplier": "Marathon Targets Inc.", "ends": "2027-01-15", "value": 188345},
    {"title": "Multiple Victoria-Class Systems - POWER PACK", "ref": "w8486-091235-001-abc", "supplier": "JHT Defense Inc.", "ends": "2027-01-20", "value": 90476},
    {"title": "LIGHT SUPPORT VEHICLE WHEELED", "ref": "w8486-091236-001-abc", "supplier": "Simex Defence Inc.", "ends": "2027-01-29", "value": 135192},
    {"title": "Sprinkler Parts", "ref": "w8486-091237-001-abc", "supplier": "OCPROC LTD", "ends": "2027-01-31", "value": 80428},
]


def money(n: int, lang: str) -> str:
    if lang == "fr":
        return f"{n:,}".replace(",", NBSP) + NBSP + "$"
    return f"${n:,}"


def fr_time(closing: str) -> str:
    d, t = closing.split(" ")
    return f"{d} à {t.replace(':00', '')}{NBSP}h HE"


def closing_line(n: dict, lang: str) -> str:
    days = n["days"]
    if lang == "fr":
        when = f"Ferme le {fr_time(n['closing'])}"
        left = f"ferme dans {days}{NBSP}jours"
    else:
        when = f"Closes {n['closing']} ET"
        left = f"closes in {days} days"
    left_html = amber(left) if days <= 7 else left
    return f"{when} · {left_html} &nbsp;{chip(n['chip'][lang])}"


def notice_rows(lang: str) -> str:
    q = "?lang=fr" if lang == "fr" else ""
    return rows([row(html.escape(n["title"]), f"{SITE}/tenders/{n['ref']}{q}", n["buyer"][lang], closing_line(n, lang), i == 0)
                 for i, n in enumerate(NOTICES)])


def contract_rows(lang: str) -> str:
    q = "?lang=fr" if lang == "fr" else ""
    buyer = "National Defence" if lang == "en" else "Défense nationale"
    src = "Award notice" if lang == "en" else "Avis d'attribution"
    out = []
    for i, k in enumerate(CONTRACTS):
        ends = f"Ends {k['ends']}" if lang == "en" else f"Prend fin le {k['ends']}"
        out.append(row(html.escape(k["title"]), f"{SITE}/awards/{k['ref']}{q}", f"{html.escape(k['supplier'])} · {buyer}",
                       f"{ends} · {money(k['value'], lang)} · {src}", i == 0))
    return rows(out)


FOOT_LINES = {
    "en": "{tag}\ncontact@awardwatch.ca\n",
    "fr": "{tag}\ncontact@awardwatch.ca\n",
}


def email(kind: str, lang: str):
    """(subject, html, text) for one kind in one language."""
    muted = C["muted"]
    fr = lang == "fr"
    tag = TAGLINE[lang]
    if kind == "sign-in":
        code = "482913"
        token = "0f3a9c1e5d7b2a4c8e6f0a1b3c5d7e9f.2b4d6f8a0c2e4a6c8e0a2c4e6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c0e2a4c"
        link = f"{SITE}/account/check?token={token}" + ("&lang=fr" if fr else "")
        if not fr:
            subject = "Your Award Watch sign-in code"
            pre = "A sign-in was requested for this address on awardwatch.ca."
            body = (h1("Your sign-in code")
                    + p("Enter this code on the page where you asked for it, or use the button. Either one works once, within 15 minutes.")
                    + code_box(code, "4 8 2 9 1 3")
                    + button(link, "Sign in to Award Watch")
                    + p("If you did not ask for this, ignore this message. Nothing happens without the code.", "muted", 13))
            why = "This message was sent because this address was entered on awardwatch.ca."
            text = ("Your sign-in code\n\n" + code + "\n\nEnter it on the page where you asked for it, or open this link:\n" + link
                    + "\n\nEither one works once, within 15 minutes.\n\nIf you did not ask for this, ignore this message. Nothing happens without the code.\n\n"
                    + why + "\n" + tag + "\ncontact@awardwatch.ca\n")
        else:
            subject = "Votre code de connexion à Award Watch"
            pre = "Une connexion a été demandée pour cette adresse sur awardwatch.ca."
            body = (h1("Votre code de connexion")
                    + p("Saisissez ce code sur la page où vous l'avez demandé, ou utilisez le bouton. L'un ou l'autre fonctionne une seule fois, pendant 15 minutes.")
                    + code_box(code, "4 8 2 9 1 3")
                    + button(link, "Se connecter à Award Watch")
                    + p("Si vous n'avez rien demandé, ignorez ce message. Rien ne se passe sans le code.", "muted", 13))
            why = "Ce message a été envoyé parce que cette adresse a été saisie sur awardwatch.ca."
            text = ("Votre code de connexion\n\n" + code + "\n\nSaisissez-le sur la page où vous l'avez demandé, ou ouvrez ce lien" + NBSP + ":\n" + link
                    + "\n\nL'un ou l'autre fonctionne une seule fois, pendant 15 minutes.\n\nSi vous n'avez rien demandé, ignorez ce message. Rien ne se passe sans le code.\n\n"
                    + why + "\n" + tag + "\ncontact@awardwatch.ca\n")
    elif kind == "digest":
        all_url = f"{SITE}/tenders?segment=81&province=BC" + ("&lang=fr" if fr else "")
        if not fr:
            subject = "3 new tender notices: Engineering in British Columbia"
            pre = "Solenoid Procurement, Pacific Science Enterprise Center power distribution, and 1 more."
            body = (h1("New tender notices")
                    + p("3 notices published since yesterday's refresh match your saved search <b>Engineering (81) · British Columbia</b>. Data date 2026-11-02.")
                    + notice_rows("en")
                    + button(all_url, "See all open notices")
                    + p("Closing times are the buyer's, shown in Eastern time. Days left count from the data date.", "muted", 13))
            why = T(FOOT_SEARCH["en"], when="each day", site=SITE, muted=muted)
            lines = [f"- {n['title']}\n  {n['buyer']['en']}\n  Closes {n['closing']} ET, closes in {n['days']} days · {n['chip']['en']}\n  {SITE}/tenders/{n['ref']}" for n in NOTICES]
            text = ("New tender notices\n\n3 notices published since yesterday's refresh match your saved search Engineering (81) · British Columbia. Data date 2026-11-02.\n\n"
                    + "\n\n".join(lines) + "\n\nSee all open notices: " + all_url
                    + "\n\nClosing times are the buyer's, shown in Eastern time. Days left count from the data date.\n\n"
                    + "You receive this each day for a saved search in your account. Saved searches and delivery: " + SITE + "/account/searches\n"
                    + tag + "\ncontact@awardwatch.ca\n")
        else:
            subject = "3 nouveaux avis d'appel d'offres" + NBSP + ": Ingénierie en Colombie-Britannique"
            pre = "Solenoid Procurement, Pacific Science Enterprise Center, et 1 autre."
            body = (h1("Nouveaux avis d'appel d'offres")
                    + p("3 avis publiés depuis la mise à jour d'hier correspondent à votre recherche enregistrée <b>Ingénierie (81) · Colombie-Britannique</b>. Date des données" + NBSP + ": 2026-11-02.")
                    + notice_rows("fr")
                    + button(all_url, "Voir tous les avis ouverts")
                    + p("Les heures de clôture sont celles de l'acheteur, en heure de l'Est. Les jours restants se comptent à partir de la date des données.", "muted", 13))
            why = T(FOOT_SEARCH["fr"], when="chaque jour", site=SITE, muted=muted)
            lines = [f"- {n['title']}\n  {n['buyer']['fr']}\n  Ferme le {fr_time(n['closing'])}, ferme dans {n['days']}{NBSP}jours · {n['chip']['fr']}\n  {SITE}/tenders/{n['ref']}?lang=fr" for n in NOTICES]
            text = ("Nouveaux avis d'appel d'offres\n\n3 avis publiés depuis la mise à jour d'hier correspondent à votre recherche enregistrée Ingénierie (81) · Colombie-Britannique. Date des données" + NBSP + ": 2026-11-02.\n\n"
                    + "\n\n".join(lines) + "\n\nVoir tous les avis ouverts" + NBSP + ": " + all_url
                    + "\n\nLes heures de clôture sont celles de l'acheteur, en heure de l'Est. Les jours restants se comptent à partir de la date des données.\n\n"
                    + "Vous recevez ce message chaque jour pour une recherche enregistrée dans votre compte. Recherches enregistrées et envoi" + NBSP + ": " + SITE + "/account/searches?lang=fr\n"
                    + tag + "\ncontact@awardwatch.ca\n")
    else:
        radar = f"{SITE}/expiring/3m?buyer=dnd-mdn" + ("&lang=fr" if fr else "")
        if not fr:
            subject = "4 contracts entering the 3-month window: National Defence"
            pre = "Robotics targets, Multiple Victoria-Class Systems power pack, and 2 more."
            body = (h1("Contracts ending within 3 months")
                    + p("4 contracts whose end date now falls within 3 months of the data date, under your saved search <b>National Defence</b>. Weekly. Data date 2026-11-02.")
                    + contract_rows("en")
                    + button(radar, "Open the radar")
                    + p("A contract's value is the one on its newest amendment. Nothing is summed across sources.", "muted", 13))
            why = T(FOOT_SEARCH["en"], when="each week", site=SITE, muted=muted)
            lines = [f"- {k['title']}\n  {k['supplier']} · National Defence\n  Ends {k['ends']} · {money(k['value'], 'en')} · Award notice\n  {SITE}/awards/{k['ref']}" for k in CONTRACTS]
            text = ("Contracts ending within 3 months\n\n4 contracts whose end date now falls within 3 months of the data date, under your saved search National Defence. Weekly. Data date 2026-11-02.\n\n"
                    + "\n\n".join(lines) + "\n\nOpen the radar: " + radar
                    + "\n\nA contract's value is the one on its newest amendment. Nothing is summed across sources.\n\n"
                    + "You receive this each week for a saved search in your account. Saved searches and delivery: " + SITE + "/account/searches\n"
                    + tag + "\ncontact@awardwatch.ca\n")
        else:
            subject = "4 contrats entrant dans la fenêtre de 3 mois" + NBSP + ": Défense nationale"
            pre = "Robotics targets, Multiple Victoria-Class Systems power pack, et 2 autres."
            body = (h1("Contrats prenant fin d'ici 3 mois")
                    + p("4 contrats dont la date de fin tombe désormais dans les 3 mois suivant la date des données, sous votre recherche enregistrée <b>Défense nationale</b>. Chaque semaine. Date des données" + NBSP + ": 2026-11-02.")
                    + contract_rows("fr")
                    + button(radar, "Ouvrir le radar")
                    + p("La valeur d'un contrat est celle de sa plus récente modification. Rien n'est additionné entre les sources.", "muted", 13))
            why = T(FOOT_SEARCH["fr"], when="chaque semaine", site=SITE, muted=muted)
            lines = [f"- {k['title']}\n  {k['supplier']} · Défense nationale\n  Prend fin le {k['ends']} · {money(k['value'], 'fr')} · Avis d'attribution\n  {SITE}/awards/{k['ref']}?lang=fr" for k in CONTRACTS]
            text = ("Contrats prenant fin d'ici 3 mois\n\n4 contrats dont la date de fin tombe désormais dans les 3 mois suivant la date des données, sous votre recherche enregistrée Défense nationale. Chaque semaine. Date des données" + NBSP + ": 2026-11-02.\n\n"
                    + "\n\n".join(lines) + "\n\nOuvrir le radar" + NBSP + ": " + radar
                    + "\n\nLa valeur d'un contrat est celle de sa plus récente modification. Rien n'est additionné entre les sources.\n\n"
                    + "Vous recevez ce message chaque semaine pour une recherche enregistrée dans votre compte. Recherches enregistrées et envoi" + NBSP + ": " + SITE + "/account/searches?lang=fr\n"
                    + tag + "\ncontact@awardwatch.ca\n")
    page = T(SHELL, lang=lang, subject=html.escape(subject), preheader=html.escape(pre), body=body, why=why,
             tagline=tag, langq=LANGQ[lang])
    return subject, page, text


# -- the sheet --------------------------------------------------------------------------------

KINDS = [
    ("sign-in", "Sign-in code · Code de connexion",
     "On every sign-in request. The code works once, within 15 minutes; the button carries the link token."),
    ("digest", "Saved-search digest, daily · Résumé quotidien d'une recherche enregistrée",
     "Phase 2 delivery: the notices published since the last refresh that match a saved search. Rows closing within 7 days carry the amber time left."),
    ("expiring", "Radar digest, weekly · Résumé hebdomadaire du radar",
     "Phase 2 delivery: contracts whose end date entered the 3-month window since last week, for a saved buyer, organization or segment."),
]

SHEET = T("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Award Watch email prototypes</title>
<style>
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,{{font_b64}}) format('woff2');}
body{margin:0;background:#e6eaf0;font:15px/1.5 {{font}};color:{{ink}};}
.top{background:#ffffff;border-bottom:2px solid {{accent}};padding:18px 28px;}
.top h1{margin:0 0 6px 0;font:700 20px/1.3 {{font}};}
.top p{margin:0 0 4px 0;max-width:72ch;color:{{ink2}};}
.switches{margin-top:12px;display:flex;gap:20px;flex-wrap:wrap;font-size:14px;}
.switches label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;}
section{padding:24px 28px 8px 28px;}
section h2{margin:0 0 4px 0;font:700 16px/1.3 {{font}};}
section .note{margin:0 0 14px 0;max-width:80ch;color:{{ink2}};font-size:14px;}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(600px,1fr));gap:24px;align-items:start;}
.email{border:1px solid #cfd6e0;background:{{page}};}
.email .subject{padding:10px 14px;border-bottom:1px solid #cfd6e0;background:#ffffff;font-size:13px;color:{{ink2}};}
.email .subject b{color:{{ink}};}
.email .subject span{display:block;color:{{muted}};}
details{margin:10px 0 0 0;font-size:13px;}
details pre{white-space:pre-wrap;background:#ffffff;border:1px solid #cfd6e0;padding:12px 14px;font:13px/1.5 ui-monospace,Consolas,monospace;max-width:600px;}
.sys .email .mail, .sys .email .mail *{font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif!important;}
{{dark_sheet}}
.dark .email{border-color:#243044;}
.dark .email .subject{background:#111a2b;border-color:#243044;color:#c7d2e0;}
.dark .email .subject b{color:#e5edf7;}
body.dark{background:#070d18;color:#e5edf7;}
.dark .top{background:#111a2b;border-color:#1f9a68;}
.dark .top p, .dark section .note{color:#c7d2e0;}
.dark details pre{background:#111a2b;border-color:#243044;color:#e5edf7;}
</style>
</head>
<body>
<div class="top">
  <h1>Award Watch email prototypes</h1>
  <p>Three messages in the site's identity, English and French: the sign-in code (built now) and the two phase-2 deliveries. 600 px single column, every style inline, the wordmark as a hosted PNG with the name as its fallback text, a plain-text part beside each HTML part, no tracking of any kind.</p>
  <p>The sheet shows Inter as the site ships it. Most mail clients will not load it and show their own sans-serif instead; the first switch shows that case. The second shows the dark treatment Apple Mail and iOS apply; Gmail inverts colours on its own.</p>
  <div class="switches">
    <label><input type="checkbox" id="sys"> System fonts (Gmail, Outlook)</label>
    <label><input type="checkbox" id="dark"> Dark</label>
  </div>
</div>
{{sections}}
<script>
  for (const id of ["sys", "dark"]) {
    document.getElementById(id).addEventListener("change", (e) => document.body.classList.toggle(id, e.target.checked));
  }
</script>
</body>
</html>
""", font_b64=FONT_B64, font=FONT, ink=C["ink"], ink2=C["ink2"], muted=C["muted"], accent=C["accent"], page=C["page"],
     dark_sheet=dark_css(".dark "))

def inline_logo(cls: str, color: str, shown: bool) -> str:
    svg = WORDMARK_SVG.replace('width="241" height="34"', 'width="142" height="20"', 1)
    return f'<span class="{cls}" style="display:{"block" if shown else "none"};color:{color};line-height:0;">{svg}</span>'


def embed(page: str) -> str:
    """The email's body content for the sheet, with the hosted PNGs swapped for inline SVGs in each colour."""
    m = re.search(r"<body[^>]*>(.*)</body>", page, re.S)
    inner = m.group(1)
    inner = re.sub(r'<img class="logo-light"[^>]*>', inline_logo("logo-light", C["ink"], True), inner)
    inner = re.sub(r'<img class="logo-dark"[^>]*>', inline_logo("logo-dark", "#e5edf7", False), inner)
    return f'<div class="mail bg" style="background:{C["page"]};">{inner}</div>'


def main() -> None:
    sections = []
    for kind, name, note in KINDS:
        pair = []
        texts = []
        for lang in ("en", "fr"):
            subject, page, text = email(kind, lang)
            (HERE / f"{kind}.{lang}.html").write_text(page, encoding="utf-8", newline="\n")
            (HERE / f"{kind}.{lang}.txt").write_text(text, encoding="utf-8", newline="\n")
            pre = re.search(r'overflow:hidden;">(.*?)</div>', page, re.S).group(1)
            pair.append(f'<div class="email"><div class="subject"><b>{html.escape(subject)}</b><span>{pre}</span></div>{embed(page)}</div>')
            texts.append(f"<details><summary>Plain-text part ({lang})</summary><pre>{html.escape(text)}</pre></details>")
        sections.append(f'<section><h2>{name}</h2><p class="note">{note}</p>'
                        f'<div class="pair">{pair[0]}{pair[1]}</div>{texts[0]}{texts[1]}</section>')
    (HERE / "prototypes.html").write_text(SHEET.replace("{{sections}}", "".join(sections)), encoding="utf-8", newline="\n")
    print("wrote", len(KINDS) * 2, "templates and prototypes.html")


if __name__ == "__main__":
    main()
