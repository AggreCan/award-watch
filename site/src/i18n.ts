// Every user-visible string on the site, in English and French, in one place.
// Pages render them with t(lang, key); a {name} in a string is filled from
// the vars argument, and tj() fills a slot with markup (a link inside a
// sentence). The client scripts get the strings they need through a JSON
// block rendered by the page (clientStrings), so they hold no copy of their
// own.
//
// French strings are written with plain spaces and straight apostrophes; the
// typography pass in frTypography() turns them into the Canadian French forms
// when they are read: a no-break space before : % $ and inside « », and the
// typographic apostrophe. English is returned exactly as written. The site's
// name is a proper name and stays English in French strings.

import { SEGMENTS, SEGMENT_SHORT } from "./constants";
import { ACCOUNT_STRINGS } from "./account/strings";
import { CALENDAR_STRINGS } from "./calendar_strings";

export type Lang = "en" | "fr";

type Entry = { en: string; fr: string };

const STRINGS = {
  // The accounts module's strings live with the module (src/account/strings.ts).
  ...ACCOUNT_STRINGS,
  // The calendar files' strings (src/calendar_strings.ts).
  ...CALENDAR_STRINGS,
  "site.name": { en: "Award Watch", fr: "Award Watch" },
  "site.tagline": {
    en: "Federal tenders, awards, contracts and grants, by organization.",
    fr: "Appels d'offres, attributions, contrats et subventions du fédéral, par organisation.",
  },

  // -- navigation, header and footer ------------------------------------------
  "nav.tenders": { en: "Tenders", fr: "Appels d'offres" },
  "nav.awards": { en: "Awards", fr: "Attributions" },
  "nav.organizations": { en: "Organizations", fr: "Organisations" },
  "nav.buyers": { en: "Buyers", fr: "Acheteurs" },
  "nav.segments": { en: "Segments", fr: "Segments" },
  "nav.rankings": { en: "Rankings", fr: "Classements" },
  "nav.data": { en: "Data", fr: "Données" },
  "nav.methodology": { en: "Methodology", fr: "Méthodologie" },
  "nav.data_date": { en: "Data date: {date}", fr: "Date des données : {date}" },
  "nav.dark": { en: "Dark", fr: "Sombre" },
  "nav.light": { en: "Light", fr: "Clair" },
  "nav.lang": { en: "Français", fr: "English" },
  "nav.main_label": { en: "Main", fr: "Principale" },
  "nav.skip": { en: "Skip to content", fr: "Passer au contenu" },
  "nav.feeds": { en: "Feeds", fr: "Fils Atom" },
  // The top bar's two timers beside the data date (src/refresh.tsx): a label
  // over the hours and minutes to the next scheduled run, "now" within its
  // last minute.
  "refresh.daily_label": { en: "Daily refresh", fr: "Actualisation quotidienne" },
  // "Sub-daily" (operator, 2026-11-06); the same-day page explains the cadence and what a cut is.
  "refresh.same_day_label": { en: "Sub-daily refresh", fr: "Actualisation en journée" },
  // The labels from 1200 to 1439 px, where the French ones whole do not fit;
  // the English ones do, so their short form is the whole label.
  "refresh.daily_label_short": { en: "Daily refresh", fr: "Quotidienne" },
  "refresh.same_day_label_short": { en: "Sub-daily refresh", fr: "En journée" },
  "refresh.now": { en: "now", fr: "maintenant" },
  "refresh.hm": { en: "{h}h {m}m", fr: "{h} h {m} min" },
  "refresh.m": { en: "{m}m", fr: "{m} min" },

  // -- the rail: a live index of counts, the browse links, the reader's lists ---
  "rail.index": { en: "Overview", fr: "Vue d'ensemble" },
  "rail.open": { en: "Open tender notices", fr: "Avis d'appel d'offres ouverts" },
  "rail.new": { en: "New today", fr: "Nouveaux aujourd'hui" },
  "rail.closing": { en: "Closing within {n} days", fr: "Clôture d'ici {n} jours" },
  "rail.awards": { en: "Award notices", fr: "Avis d'attribution" },
  "rail.awards_year": { en: "In {year}", fr: "En {year}" },
  "rail.awards_year_full": { en: "Award notices in {year}", fr: "Avis d'attribution en {year}" },
  "rail.expiring": { en: "Contracts ending", fr: "Contrats prenant fin" },
  "rail.ending_3m_full": { en: "Ending within 3 months", fr: "Fin d'ici 3 mois" },
  "rail.browse": { en: "Browse", fr: "Parcourir" },
  "rail.lists": { en: "Your lists", fr: "Vos listes" },
  "rail.email_lists": { en: "Email lists", fr: "Listes de diffusion" },
  "rail.ending_6m_full": { en: "Ending within 6 months", fr: "Fin d'ici 6 mois" },
  "rail.ending_12m_full": { en: "Ending within 12 months", fr: "Fin d'ici 12 mois" },
  "rail.same_day": { en: "Same-day", fr: "Du jour" },
  "rail.same_day_full": { en: "Same-day notices", fr: "Avis du jour" },
  "footer.sources": {
    en: "Records from CanadaBuys, open.canada.ca and the Registry of Lobbyists.",
    fr: "Dossiers d'AchatsCanada, d'ouvert.canada.ca et du Registre des lobbyistes.",
  },
  // While the lobbying registry has not been read, the footer names the sources that have.
  "footer.sources_no_lobbying": {
    en: "Records from CanadaBuys and open.canada.ca.",
    fr: "Dossiers d'AchatsCanada et d'ouvert.canada.ca.",
  },
  "footer.sources_link": { en: "Sources and licence", fr: "Sources et licence" },
  "footer.methodology": { en: "Methodology", fr: "Méthodologie" },
  "footer.download": { en: "Download the data", fr: "Télécharger les données" },
  "footer.feeds": { en: "Feeds", fr: "Fils Atom" },
  "footer.watchlist": { en: "Watchlist", fr: "Liste de suivi" },
  "footer.corrections": { en: "Report a correction", fr: "Signaler une correction" },
  "footer.cite": { en: "Cite", fr: "Citer" },
  "footer.about": { en: "About", fr: "À propos" },
  "footer.terms": { en: "Terms", fr: "Conditions" },
  "footer.privacy": { en: "Privacy", fr: "Confidentialité" },
  "toc.label": { en: "On this page", fr: "Sur cette page" },
  "toc.title": { en: "On this page", fr: "Sur cette page" },

  // -- shared words -----------------------------------------------------------------
  "common.home": { en: "Home", fr: "Accueil" },
  "common.na": { en: "n/a", fr: "s.o." },
  "common.not_stated": { en: "Not stated", fr: "Non indiqué" },
  "common.not_applicable": { en: "Not applicable", fr: "Sans objet" },
  "common.national": { en: "Canada-wide or not stated", fr: "Tout le Canada ou non indiqué" },
  "common.breadcrumb": { en: "Breadcrumb", fr: "Fil d'Ariane" },
  "common.pagination": { en: "Pages", fr: "Pagination" },
  "common.page_n": { en: "Page {n}", fr: "Page {n}" },
  "common.source": { en: "Source", fr: "Source" },
  "common.back": { en: "Back", fr: "Retour" },
  "common.back_home": { en: "Back to the home page", fr: "Retour à l'accueil" },
  "common.sources_separate": {
    en: "Each source is totalled separately ({methodology}).",
    fr: "Chaque source est totalisée séparément ({methodology}).",
  },
  "common.dates_as_published": {
    en: "Dates are as published. Some fall after the data date.",
    fr: "Les dates sont telles que publiées. Certaines tombent après la date des données.",
  },
  "common.other_lang_only": { en: "(in French only)", fr: "(en anglais seulement)" },
  "common.segment_chips_note": {
    en: "The tags after a reference are UNSPSC segments, by number and short name.",
    fr: "Les étiquettes qui suivent une référence sont des segments UNSPSC, par numéro et nom abrégé.",
  },
  "common.not_loaded": { en: "This source has not been loaded yet.", fr: "Cette source n'a pas encore été chargée." },
  "common.not_loaded_short": { en: "Not loaded", fr: "Non chargé" },
  // A list of two or more, the last joined by "or" ("a, b or c").
  "common.list_or": { en: "{list} or {last}", fr: "{list} ou {last}" },
  // Below 700 px a long table shows its first rows; this opens the rest (public/pager.js).
  "common.show_rows": { en: "Show all {n} rows", fr: "Afficher les {n} lignes" },
  "common.show_years": { en: "Show all years", fr: "Afficher toutes les années" },
  "common.show_recent_years": { en: "Show the last {n} years only", fr: "N'afficher que les {n} dernières années" },
  "common.years_source": { en: "Source shown", fr: "Source affichée" },
  "common.years_all": { en: "All sources", fr: "Toutes les sources" },
  // The order switch above a long list.
  "common.order": { en: "Order", fr: "Ordre" },
  "common.order_records": { en: "Most records", fr: "Le plus de dossiers" },
  "common.order_name": { en: "A to Z", fr: "De A à Z" },
  "common.order_code": { en: "By code", fr: "Par code" },
  // The filters above a list fold on a phone; the button that opens them says how many are on.
  "filters.fold": { en: "Filters", fr: "Filtres" },
  "filters.fold_one": { en: "Filters (1 active)", fr: "Filtres (1 actif)" },
  "filters.fold_many": { en: "Filters ({n} active)", fr: "Filtres ({n} actifs)" },
  "common.time": { en: "{hh}:{mm}", fr: "{hh} h {mm}" },
  // Beside a closing time that names no zone: CanadaBuys publishes them in Eastern time.
  "common.zone_et": { en: "ET", fr: "HE" },
  "common.range": { en: "{first} to {last} of {n}", fr: "{first} à {last} sur {n}" },
  "money": { en: "${amount}", fr: "{amount} $" },
  "money.usd": { en: "US${amount}", fr: "{amount} $ US" },
  // The short forms, used in tiles only: millions and billions.
  "money.short_m": { en: "${amount}M", fr: "{amount}\u00a0M$" },
  "money.short_b": { en: "${amount}B", fr: "{amount}\u00a0G$" },
  "pct": { en: "{n}%", fr: "{n} %" },

  "col.notice": { en: "Notice", fr: "Avis" },
  "col.buyer": { en: "Buyer", fr: "Acheteur" },
  "col.closing": { en: "Closing", fr: "Clôture" },
  "col.published": { en: "Published", fr: "Publié" },
  "col.region": { en: "Provinces of delivery", fr: "Provinces de livraison" },
  "col.awarded": { en: "Awarded", fr: "Attribué le" },
  "col.contract": { en: "Contract", fr: "Contrat" },
  "col.organization": { en: "Organization", fr: "Organisation" },
  "col.supplier": { en: "Supplier", fr: "Fournisseur" },
  "col.client": { en: "Client department", fr: "Ministère client" },
  "col.value": { en: "Value", fr: "Valeur" },
  "col.method": { en: "Competition", fr: "Mise en concurrence" },
  "col.rank": { en: "Rank", fr: "Rang" },
  "col.records": { en: "Records", fr: "Dossiers" },
  "col.city": { en: "City", fr: "Ville" },
  "col.code": { en: "Code", fr: "Code" },
  "col.description": { en: "Description", fr: "Description" },
  "col.segment": { en: "Segment", fr: "Segment" },
  "col.amendment": { en: "Amendment", fr: "Modification" },
  "col.title": { en: "Title", fr: "Titre" },
  "col.date": { en: "Date", fr: "Date" },
  "col.record": { en: "Record", fr: "Dossier" },
  "col.source": { en: "Source", fr: "Source" },
  "col.status": { en: "Status", fr: "Statut" },
  "col.year": { en: "Year", fr: "Année" },
  "col.province": { en: "Province", fr: "Province" },
  "col.type": { en: "Type", fr: "Type" },

  // Tender statuses (normalize.tender_status), the closing-soon state the
  // site derives, and the award and contract history statuses.
  "status.open": { en: "Open", fr: "Ouvert" },
  "status.closing": { en: "Closing soon", fr: "Clôture prochaine" },
  "status.closed": { en: "Closing date passed", fr: "Date de clôture passée" },
  // The line under a closing-soon time (public/countdown.js), from the visitor's clock.
  "countdown.in_min": { en: "closes in {m} min", fr: "ferme dans {m} min" },
  "countdown.in_hm": { en: "closes in {h} h {m} min", fr: "ferme dans {h} h {m} min" },
  "countdown.in_day": { en: "closes in 1 day", fr: "ferme dans 1 jour" },
  "countdown.in_days": { en: "closes in {n} days", fr: "ferme dans {n} jours" },
  "countdown.today_at": { en: "closes today at {time}", fr: "ferme aujourd'hui à {time}" },
  "status.expired": { en: "Expired", fr: "Expiré" },
  "status.cancelled": { en: "Cancelled", fr: "Annulé" },
  "status.awarded": { en: "Awarded", fr: "Attribué" },
  "status.active": { en: "Active", fr: "Actif" },
  "status.unknown": { en: "Status unknown", fr: "Statut inconnu" },

  // "Non-competitive" is the sources' own term; the definitions ride along as
  // tooltips and on the Methodology page.
  "competitive.yes": { en: "Competitive", fr: "Concurrentiel" },
  "competitive.no": { en: "Non-competitive", fr: "Non concurrentiel" },
  "competitive.unstated": { en: "Method not stated", fr: "Méthode non précisée" },
  "competitive.def_yes": {
    en: "The source records the contract as awarded through a competition: a method it names \"Competitive\", or the solicitation codes OB, TC or ST.",
    fr: "La source indique une attribution par mise en concurrence : une méthode qu'elle qualifie de « concurrentielle », ou les codes d'invitation OB, TC ou ST.",
  },
  "competitive.def_no": {
    en: "The source's own term for a contract awarded without a competition: the method \"Non-competitive\" or an advance contract award notice, or the solicitation codes TN or AC. The limited tendering reason, where the source gives one, is on the contract's page.",
    fr: "Le terme de la source pour un contrat attribué sans mise en concurrence : la méthode « Non concurrentielle » ou un préavis d'adjudication de contrat, ou les codes d'invitation TN ou AC. Le motif de l'appel d'offres limité, lorsque la source le donne, figure sur la page du contrat.",
  },
  "competitive.def_unstated": {
    en: "The source leaves the procurement method blank for this record.",
    fr: "La source n'indique pas la méthode d'approvisionnement pour ce dossier.",
  },

  // The five record sources of a profile, and the tender notices.
  "source.tenders": { en: "Tender notices", fr: "Avis d'appel d'offres" },
  "source.awards": { en: "Award notices", fr: "Avis d'attribution" },
  "source.history": { en: "PSPC contract history", fr: "Historique des contrats de SPAC" },
  "source.contracts": { en: "Published contracts", fr: "Contrats publiés" },
  "source.grants": { en: "Grants and contributions", fr: "Subventions et contributions" },
  "source.lobbying": { en: "Lobbying communications", fr: "Communications de lobbying" },
  "source.dataset.tenders": { en: "CanadaBuys tender notices (open.canada.ca)", fr: "Avis d'appel d'offres d'AchatsCanada (ouvert.canada.ca)" },
  "source.dataset.awards": { en: "CanadaBuys award notices (open.canada.ca)", fr: "Avis d'attribution d'AchatsCanada (ouvert.canada.ca)" },
  "source.dataset.history": {
    en: "PSPC contract history (CanadaBuys, open.canada.ca)",
    fr: "Historique des contrats de SPAC (AchatsCanada, ouvert.canada.ca)",
  },
  "source.dataset.contracts": {
    en: "Proactive publication of contracts over $10,000 (open.canada.ca)",
    fr: "Divulgation proactive des contrats de plus de 10 000 $ (ouvert.canada.ca)",
  },
  "source.dataset.grants": {
    en: "Proactive publication of grants and contributions (open.canada.ca)",
    fr: "Divulgation proactive des subventions et contributions (ouvert.canada.ca)",
  },
  "source.dataset.lobbying": {
    en: "Registry of Lobbyists, monthly communication reports (open.canada.ca)",
    fr: "Registre des lobbyistes, rapports mensuels de communication (ouvert.canada.ca)",
  },

  // CanadaBuys procurement categories.
  "cat.SRV": { en: "Services", fr: "Services" },
  "cat.GD": { en: "Goods", fr: "Biens" },
  "cat.CNST": { en: "Construction", fr: "Construction" },
  "cat.SRVTGD": { en: "Services related to goods", fr: "Services liés aux biens" },

  "prov.AB": { en: "Alberta", fr: "Alberta" },
  "prov.BC": { en: "British Columbia", fr: "Colombie-Britannique" },
  "prov.MB": { en: "Manitoba", fr: "Manitoba" },
  "prov.NB": { en: "New Brunswick", fr: "Nouveau-Brunswick" },
  "prov.NL": { en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador" },
  "prov.NS": { en: "Nova Scotia", fr: "Nouvelle-Écosse" },
  "prov.NT": { en: "Northwest Territories", fr: "Territoires du Nord-Ouest" },
  "prov.NU": { en: "Nunavut", fr: "Nunavut" },
  "prov.ON": { en: "Ontario", fr: "Ontario" },
  "prov.PE": { en: "Prince Edward Island", fr: "Île-du-Prince-Édouard" },
  "prov.QC": { en: "Quebec", fr: "Québec" },
  "prov.SK": { en: "Saskatchewan", fr: "Saskatchewan" },
  "prov.YT": { en: "Yukon", fr: "Yukon" },
  "prov.XX": { en: "Outside Canada", fr: "Hors du Canada" },
  "prov.UN": { en: "No address recorded", fr: "Aucune adresse au dossier" },

  // -- errors and limits ----------------------------------------------------------
  "error.no_data": { en: "Data Not Published Yet", fr: "Données pas encore publiées" },
  "error.no_data_text": {
    en: "The nightly refresh has not published the files this page reads. Try again later.",
    fr: "La mise à jour de nuit n'a pas encore publié les fichiers que lit cette page. Réessayez plus tard.",
  },
  "error.not_found": { en: "Page Not Found", fr: "Page introuvable" },
  "error.not_found_text": {
    en: "Nothing is published at this address. Start from the {home} or the {directory}.",
    fr: "Rien n'est publié à cette adresse. Partez de la {home} ou du {directory}.",
  },
  "error.not_found_home": { en: "home page", fr: "page d'accueil" },
  "error.not_found_directory": { en: "organization directory", fr: "répertoire des organisations" },
  "error.server": { en: "Something Went Wrong", fr: "Une erreur s'est produite" },
  "error.server_text": {
    en: "The page could not be built. Try again in a moment.",
    fr: "La page n'a pas pu être produite. Réessayez dans un moment.",
  },
  "error.file": { en: "File Not Available", fr: "Fichier non disponible" },
  "error.file_text": { en: "The file {file} is not available right now.", fr: "Le fichier {file} n'est pas disponible pour l'instant." },
  "error.file_back": { en: "Back to the downloads", fr: "Retour aux téléchargements" },
  "limits.too_many": {
    en: "Too many requests from this address. Wait a minute and try again.",
    fr: "Trop de requêtes depuis cette adresse. Attendez une minute et réessayez.",
  },
  "limits.too_many_api": {
    en: "Too many requests. The API allows 60 requests a minute per address. For bulk use, start from the downloads.",
    fr: "Trop de requêtes. L'API permet 60 requêtes par minute et par adresse. Pour un usage en masse, utilisez les téléchargements.",
  },

  // -- home ----------------------------------------------------------------------------
  "home.title": { en: "Federal Tenders, Contracts and Grants, by Organization", fr: "Appels d'offres, contrats et subventions du fédéral, par organisation" },
  // The lead names what a reader comes for (docs/seo.md); home.lead_n, with
  // the organizations counted in stats.json, when the export carries the count.
  "home.lead": {
    en: "The tender notices open on CanadaBuys, who won the contracts awarded after them, and the contracts ending within a year, with a page for each department and for each organization the records name. From the Government of Canada's open data, refreshed nightly.",
    fr: "Les avis d'appel d'offres ouverts sur AchatsCanada, qui a remporté les contrats attribués ensuite et les contrats qui prennent fin d'ici un an, avec une page pour chaque ministère et pour chaque organisation que nomment les dossiers. D'après les données ouvertes du gouvernement du Canada, mises à jour chaque nuit.",
  },
  "home.quick_open": { en: "Open tenders", fr: "Appels d'offres ouverts" },
  "home.quick_closing": { en: "Closing this week", fr: "Clôture cette semaine" },
  "home.quick_new": { en: "New today", fr: "Nouveaux aujourd'hui" },
  "home.quick_awards": { en: "Latest awards", fr: "Dernières attributions" },
  "home.quick_directory": { en: "Organizations A to Z", fr: "Organisations de A à Z" },
  "home.tiles_label": { en: "Counts", fr: "Chiffres" },
  "home.records_heading": { en: "Records Held", fr: "Dossiers conservés" },
  "home.tile_open": { en: "Open tender notices", fr: "Avis d'appel d'offres ouverts" },
  // The tile notes: one line each at 1440 px, in both languages.
  "home.tile_open_note": { en: "Open on CanadaBuys at the data date", fr: "Ouverts à la date des données" },
  "home.tile_new": { en: "New tender notices", fr: "Nouveaux avis d'appel d'offres" },
  "home.tile_new_note": { en: "First seen in the last refresh", fr: "Vus à la dernière mise à jour" },
  "home.tile_awards": { en: "Award notices", fr: "Avis d'attribution" },
  "home.tile_awards_note": { en: "On CanadaBuys since 2012", fr: "Sur AchatsCanada depuis 2012" },
  "home.tile_expiring": { en: "Ending within 3 months", fr: "Contrats prenant fin d'ici 3 mois" },
  "home.tile_expiring_note": { en: "Ending within 3 months of the data date", fr: "Fin d'ici 3 mois à la date des données" },
  // The home tiles carry what the rail beside them does not: how many close
  // today, and the value of the year's award notices and of the contracts ending.
  "home.tile_closing_none": { en: "None closes today", fr: "Aucun ne ferme aujourd'hui" },
  "home.tile_closing_one": { en: "1 closes today", fr: "1 ferme aujourd'hui" },
  "home.tile_closing_many": { en: "{n} close today", fr: "{n} ferment aujourd'hui" },
  "home.tile_awards_year_note": { en: "Published on CanadaBuys this year", fr: "Publiés sur AchatsCanada cette année" },
  "home.tile_value": { en: "Worth {total}", fr: "Valeur : {total}" },
  "home.tile_organizations": { en: "Organizations", fr: "Organisations" },
  "home.tile_organizations_note": { en: "Suppliers, recipients and lobbying clients", fr: "Fournisseurs, bénéficiaires et clients de lobbying" },
  "home.tile_contracts": { en: "Published contracts", fr: "Contrats publiés" },
  "home.tile_contracts_note": { en: "Contracts over $10,000 that departments report", fr: "Contrats de plus de 10 000 $ déclarés par les ministères" },
  "home.tile_grants": { en: "Grants and contributions", fr: "Subventions et contributions" },
  "home.tile_grants_note": { en: "Agreements that departments report", fr: "Accords déclarés par les ministères" },
  "home.tile_history": { en: "PSPC contract history", fr: "Historique des contrats de SPAC" },
  "home.tile_history_note": { en: "Contracts awarded by PSPC since 2009", fr: "Contrats attribués par SPAC depuis 2009" },
  "home.tile_buyers": { en: "Buyers", fr: "Acheteurs" },
  "home.tile_buyers_note": { en: "Departments, agencies and Crown corporations", fr: "Ministères, organismes et sociétés d'État" },
  "home.new_heading": { en: "New Tender Notices Today", fr: "Nouveaux avis d'appel d'offres aujourd'hui" },
  "home.new_all": { en: "Last 30 days", fr: "30 derniers jours" },
  "home.new_none": { en: "No new notice in the last refresh.", fr: "Aucun nouvel avis à la dernière mise à jour." },
  "home.closing_heading": { en: "Closing Within 7 Days", fr: "Clôture d'ici 7 jours" },
  "home.closing_all": { en: "All closing soon", fr: "Toutes les clôtures prochaines" },
  "home.closing_none": { en: "No open notice closes in the next 7 days.", fr: "Aucun avis ouvert ne prend fin dans les 7 prochains jours." },
  "home.awards_heading": { en: "Recent Award Notices", fr: "Avis d'attribution récents" },
  "home.awards_all": { en: "All award notices", fr: "Tous les avis d'attribution" },
  "home.awards_none": { en: "No award notice is published yet.", fr: "Aucun avis d'attribution n'est encore publié." },
  "home.top_heading": { en: "Largest Award Values in {year}", fr: "Valeurs attribuées les plus élevées en {year}" },
  "home.top_all": { en: "Full ranking", fr: "Classement complet" },
  "home.top_note": {
    en: "Award notices only, by the value on each notice's newest amendment.",
    fr: "Avis d'attribution seulement, selon la valeur de la plus récente modification de chaque avis.",
  },
  "home.top_none": { en: "No award notice dated this year yet.", fr: "Aucun avis d'attribution daté de cette année pour l'instant." },
  "home.read_heading": { en: "How to Read This Site", fr: "Comment lire ce site" },
  "home.read_records": {
    en: "Each entry is a government record, linked to the notice or file it came from. Figures describe those records and draw no conclusion about anyone.",
    fr: "Chaque entrée est un dossier du gouvernement, liée à l'avis ou au fichier d'où elle vient. Les chiffres décrivent ces dossiers et ne tirent aucune conclusion sur qui que ce soit.",
  },
  "home.read_sources": {
    en: "One contract can appear in an award notice, in PSPC contract history and in a department's published contracts. Each source is totalled separately.",
    fr: "Un même contrat peut figurer dans un avis d'attribution, dans l'historique des contrats de SPAC et dans les contrats publiés d'un ministère. Chaque source est totalisée séparément.",
  },
  "home.read_competitive": {
    en: "\"Non-competitive\" is the sources' own term for a contract awarded without a competition, which the procurement rules allow in set cases.",
    fr: "« Non concurrentiel » est le terme des sources pour un contrat attribué sans mise en concurrence, ce que les règles d'approvisionnement permettent dans des cas précis.",
  },
  "home.read_more": { en: "The {methodology} page sets out each rule.", fr: "La page {methodology} expose chaque règle." },
  "home.read_about": {
    en: "The {about} page says who publishes the site and how to reach it.",
    fr: "La page {about} indique qui publie le site et comment le joindre.",
  },
  // Each tile's figures beside its main one, label and figure a line, short
  // enough for the block beside the figure at 1440 px in both languages.
  "home.side_tomorrow": { en: "Tomorrow", fr: "Demain" },
  "home.side_in_2_days": { en: "In 2 days", fr: "Dans 2 jours" },
  "home.side_days_3_7": { en: "Days 3 to {n}", fr: "Jours 3 à {n}" },
  "home.side_30d": { en: "Last 30 days", fr: "30 derniers jours" },
  "home.side_worth": { en: "Worth", fr: "Valeur" },
  "home.side_suppliers": { en: "Suppliers", fr: "Fournisseurs" },
  "home.side_6m": { en: "Within 6 months", fr: "D'ici 6 mois" },
  "home.side_12m": { en: "Within 12 months", fr: "D'ici 12 mois" },
  "home.side_no_value": { en: "No value stated", fr: "Sans valeur indiquée" },

  // -- tender lists ----------------------------------------------------------------------
  "tenders.title": { en: "Open Tender Notices", fr: "Avis d'appel d'offres ouverts" },
  "tenders.lead": {
    en: "{n} notices open on CanadaBuys at the data date.",
    fr: "{n} avis ouverts sur AchatsCanada à la date des données.",
  },
  "tenders.contact_note": {
    en: "Contacts, documents and bid submission are on each notice's CanadaBuys page.",
    fr: "Les personnes-ressources, les documents et le dépôt des soumissions se trouvent sur la page AchatsCanada de chaque avis.",
  },
  "tenders.filter_text": { en: "Words in the title or description", fr: "Mots du titre ou de la description" },
  "tenders.filter_category": { en: "Category", fr: "Catégorie" },
  "tenders.filter_segment": { en: "UNSPSC segment", fr: "Segment UNSPSC" },
  "tenders.filter_code": { en: "UNSPSC family or class", fr: "Famille ou classe UNSPSC" },
  "tenders.code_placeholder": { en: "4 or 6 digits", fr: "4 ou 6 chiffres" },
  "tenders.filter_province": { en: "Province of delivery", fr: "Province de livraison" },
  // Most notices name no province: with a province chosen they stay in unless this is unticked.
  "tenders.include_national": { en: "Include Canada-wide or not stated", fr: "Inclure pancanadien ou non indiqué" },
  "tenders.filter_buyer": { en: "Buyer", fr: "Acheteur" },
  "tenders.filter_type": { en: "Notice type", fr: "Type d'avis" },
  "tenders.filter_method": { en: "Procurement method", fr: "Méthode d'approvisionnement" },
  "tenders.filter_closing": { en: "Closing", fr: "Clôture" },
  "tenders.closing_any": { en: "Any date", fr: "Toute date" },
  "tenders.closing_days": { en: "Within {n} days", fr: "D'ici {n} jours" },
  "tenders.any": { en: "All", fr: "Tous" },
  "tenders.any_f": { en: "All", fr: "Toutes" },
  // A filter's select when the address gives it several values (each has its chip).
  "tenders.several": { en: "Several ({n})", fr: "Plusieurs ({n})" },
  "tenders.sort": { en: "Sort", fr: "Trier" },
  "tenders.sort_closing": { en: "Closing soonest", fr: "Clôture la plus proche" },
  "tenders.sort_published": { en: "Newest published", fr: "Publication la plus récente" },
  "tenders.apply": { en: "Apply", fr: "Appliquer" },
  "tenders.reset": { en: "Clear filters", fr: "Effacer les filtres" },
  "tenders.count_one": { en: "{n} notice", fr: "{n} avis" },
  "tenders.count_many": { en: "{n} notices", fr: "{n} avis" },
  "tenders.none_match": { en: "No open notice matches these filters.", fr: "Aucun avis ouvert ne correspond à ces filtres." },
  "tenders.none_next": { en: "Remove a filter above, or {reset}.", fr: "Retirez un filtre ci-dessus, ou {reset}." },
  "tenders.none_next_q": { en: "Remove a filter above, {reset}, or {search}.", fr: "Retirez un filtre ci-dessus, {reset}, ou {search}." },
  "tenders.none_reset": { en: "show every open notice", fr: "affichez tous les avis ouverts" },
  "tenders.none_search": {
    en: "look for these words among organizations and buyers",
    fr: "cherchez ces mots parmi les organisations et les acheteurs",
  },
  "tenders.page_of": { en: "Page {page} of {pages}", fr: "Page {page} sur {pages}" },
  "tenders.prev": { en: "Previous", fr: "Précédente" },
  "tenders.next": { en: "Next", fr: "Suivante" },
  "tenders.list_heading": { en: "Notices", fr: "Avis" },
  "tenders.csv": { en: "Download open notices (CSV)", fr: "Télécharger les avis ouverts (CSV)" },
  "tenders.key_enter": { en: "Enter", fr: "Entrée" },
  "tenders.filters_active": { en: "Filters", fr: "Filtres" },
  "tenders.remove_filter": { en: "Remove filter: {name}", fr: "Retirer le filtre : {name}" },
  "tenders.keys_hint": { en: "{j} / {k} to move, {enter} to open", fr: "{j} / {k} pour se déplacer, {enter} pour ouvrir" },
  "tenders.detail_heading": { en: "Selected notice", fr: "Avis sélectionné" },
  "tenders.detail_empty": { en: "Select a notice in the list to see its details here.", fr: "Choisissez un avis dans la liste pour en voir le détail ici." },
  "tenders.detail_loading": { en: "Loading the notice…", fr: "Chargement de l'avis…" },
  "tenders.detail_failed": { en: "The notice's details could not be loaded. Its page has them.", fr: "Le détail de l'avis n'a pas pu être chargé. Sa page le contient." },
  "tenders.detail_open": { en: "Open the notice", fr: "Ouvrir l'avis" },
  "tenders.detail_canadabuys": { en: "Open on CanadaBuys", fr: "Ouvrir sur AchatsCanada" },
  "tenders.detail_more": { en: "The full description is on the notice's page.", fr: "La description complète figure sur la page de l'avis." },
  "tenders.loading": { en: "Loading every open notice…", fr: "Chargement de tous les avis ouverts…" },
  "tenders.load_failed": {
    en: "The full list could not be loaded. The notices shown are the server's.",
    fr: "La liste complète n'a pas pu être chargée. Les avis affichés sont ceux du serveur.",
  },
  "tenders.waiting": {
    en: "These filters apply once the full list of open notices has loaded in your browser.",
    fr: "Ces filtres s'appliquent une fois la liste complète des avis ouverts chargée dans votre navigateur.",
  },
  "tenders.noscript": {
    en: "Filtering the full list needs JavaScript. Without it, {link} shows the open notices by closing date.",
    fr: "Le filtrage de la liste complète nécessite JavaScript. Sans lui, {link} présente les avis ouverts par date de clôture.",
  },
  "tenders.noscript_link": { en: "the unfiltered list", fr: "la liste non filtrée" },
  "tenders.new_title": { en: "New Tender Notices", fr: "Nouveaux avis d'appel d'offres" },
  "tenders.new_lead": {
    en: "The notices first seen on each of the last {days} days. Pick a day to see its notices.",
    fr: "Les avis vus pour la première fois au cours de chacun des {days} derniers jours. Choisissez un jour pour en voir les avis.",
  },
  "tenders.new_days": { en: "Days", fr: "Jours" },
  "tenders.new_day": { en: "First Seen on {day}", fr: "Vus pour la première fois le {day}" },
  "tenders.new_missing": {
    en: "No list is published for this day: no refresh ran, or the day is older than the files kept.",
    fr: "Aucune liste n'est publiée pour ce jour : aucune mise à jour n'a eu lieu, ou le jour est plus ancien que les fichiers conservés.",
  },
  "tenders.new_none": { en: "No new notice was seen on this day.", fr: "Aucun nouvel avis n'a été vu ce jour-là." },
  // The home lists' Type column: the notice type's short form (constants.ts
  // NOTICE_TYPE_SHORT), its published name on hover, the method under it.
  "type.rfp": { en: "RFP", fr: "DP" },
  "type.rfsa": { en: "RFSA", fr: "DAMA" },
  "type.rfso": { en: "RFSO", fr: "DOC" },
  "type.rfp_sa": { en: "RFP (SA)", fr: "DP (AMA)" },
  "type.rfi": { en: "RFI", fr: "DDR" },
  "type.itq": { en: "ITQ", fr: "IQ" },
  "type.acan": { en: "ACAN", fr: "PAC" },
  "type.directed": { en: "Directed", fr: "Prescrit" },
  "method.open": { en: "Open bidding", fr: "Invitation ouverte" },
  "method.selective": { en: "Selective tendering", fr: "Appel d'offres sélectif" },
  "method.traditional": { en: "Traditional", fr: "Traditionnelle" },
  "method.limited": { en: "Limited tendering", fr: "Appel d'offres limité" },
  "method.non_competitive": { en: "Non-competitive", fr: "Non concurrentielle" },
  "method.acan": { en: "ACAN", fr: "PAC" },

  // -- the same-day notices band (src/pages/intraday.tsx) ------------------------------
  "intraday.heading_one": {
    en: "{n} notice posted since this morning's refresh",
    fr: "{n} avis publié depuis la mise à jour de ce matin",
  },
  "intraday.heading_many": {
    en: "{n} notices posted since this morning's refresh",
    fr: "{n} avis publiés depuis la mise à jour de ce matin",
  },
  "intraday.note": {
    en: "Read from CanadaBuys every two hours. Each notice joins the list below at the next morning's refresh; until then its title opens the notice on CanadaBuys.",
    fr: "Lus sur AchatsCanada toutes les deux heures. Chaque avis rejoint la liste ci-dessous à la mise à jour du lendemain matin; d'ici là, son titre ouvre l'avis sur AchatsCanada.",
  },
  "intraday.new": { en: "same day", fr: "le jour même" },
  "intraday.amended": { en: "amended today", fr: "modifié aujourd'hui" },
  // The same-day notices' own page (src/pages/same_day.tsx) and the line in the tender lists' head.
  "sameday.title": { en: "Same-day Tender Notices", fr: "Avis d'appel d'offres du jour" },
  "sameday.lead": {
    en: "The notices CanadaBuys posts after the morning refresh, read every two hours through the Ottawa business day.",
    fr: "Les avis publiés sur AchatsCanada après la mise à jour du matin, lus toutes les deux heures pendant la journée de travail à Ottawa.",
  },
  "sameday.description": {
    en: "Federal tender notices CanadaBuys posts during the day, read every two hours until the next morning's refresh adds them to the lists.",
    fr: "Les avis d'appel d'offres fédéraux publiés sur AchatsCanada pendant la journée, lus toutes les deux heures jusqu'à la mise à jour du lendemain.",
  },
  "sameday.pro_text": {
    en: "With Pro, this page lists them as they are read, and the same notices show above the tender lists until the next morning's refresh adds them there.",
    fr: "Avec Pro, cette page les présente à mesure qu'ils sont lus, et les mêmes avis paraissent au-dessus des listes d'appels d'offres jusqu'à ce que la mise à jour du lendemain matin les y ajoute.",
  },
  "sameday.free": {
    en: "The {open}, the {new} and their feeds stay free, refreshed every morning.",
    fr: "La {open}, les {new} et leurs fils restent gratuits, mis à jour chaque matin.",
  },
  "sameday.free_open": { en: "list of open notices", fr: "liste des avis ouverts" },
  "sameday.free_new": { en: "new notices by day", fr: "nouveaux avis par jour" },
  "sameday.none": {
    en: "No notice posted since this morning's refresh has been read yet.",
    fr: "Aucun avis publié depuis la mise à jour de ce matin n'a encore été lu.",
  },
  "sameday.tenders_note": {
    en: "{link}: the notices CanadaBuys posts during the day show above this list, read every two hours.",
    fr: "{link} : les avis publiés sur AchatsCanada pendant la journée paraissent au-dessus de cette liste, lus toutes les deux heures.",
  },

  // -- one tender notice -----------------------------------------------------------------
  "tender.title": { en: "Tender Notice", fr: "Avis d'appel d'offres" },
  "tender.not_found": { en: "Tender Notice Not Found", fr: "Avis d'appel d'offres introuvable" },
  "tender.back": { en: "Back to the open notices", fr: "Retour aux avis ouverts" },
  "tender.amendment_n": { en: "Amendment {n}", fr: "Modification {n}" },
  "tender.on_canadabuys": { en: "Open the notice on CanadaBuys", fr: "Ouvrir l'avis sur AchatsCanada" },
  "tender.contact_note": {
    en: "The contracting officer's contact and the solicitation documents are on the CanadaBuys page. This site does not reproduce contact details.",
    fr: "Les coordonnées de l'agent de négociation des contrats et les documents d'invitation se trouvent sur la page d'AchatsCanada. Ce site ne reproduit pas les coordonnées.",
  },
  "tender.dates": { en: "Key Dates", fr: "Dates clés" },
  // The head's line under the title: when the notice closes, who buys, what kind.
  "tender.lead_closes": { en: "Closes {date}", fr: "Clôture le {date}" },
  "tender.lead_closed": { en: "Closed {date}", fr: "Clôturé le {date}" },
  "tender.buyer_open_one": { en: "{n} open notice from {buyer}", fr: "{n} avis ouvert de cet acheteur ({buyer})" },
  "tender.buyer_open_many": { en: "{n} open notices from {buyer}", fr: "{n} avis ouverts de cet acheteur ({buyer})" },
  "tender.amended": { en: "Amended", fr: "Modifié le" },
  "tender.start_expected": { en: "Expected start", fr: "Début prévu" },
  "tender.end_expected": { en: "Expected end", fr: "Fin prévue" },
  "tender.closing_zone": {
    en: "CanadaBuys publishes closing times in Eastern time (ET). Its data file gives no zone; the notice on CanadaBuys names it.",
    fr: "AchatsCanada publie les heures de clôture en heure de l'Est (HE). Son fichier de données ne précise pas le fuseau horaire; l'avis sur AchatsCanada l'indique.",
  },
  "tender.buyer": { en: "Buyer", fr: "Acheteur" },
  "tender.end_users": { en: "End users", fr: "Utilisateurs finaux" },
  "tender.solicitation": { en: "Solicitation number", fr: "Numéro de l'invitation" },
  "tender.procurement": { en: "Procurement", fr: "Approvisionnement" },
  "tender.category": { en: "Category", fr: "Catégorie" },
  "tender.notice_type": { en: "Notice type", fr: "Type d'avis" },
  "tender.method": { en: "Procurement method", fr: "Méthode d'approvisionnement" },
  "tender.selection": { en: "Selection criteria", fr: "Critères de sélection" },
  "tender.limited_reason": { en: "Limited tendering reason", fr: "Motif de l'appel d'offres limité" },
  "tender.trade_agreements": { en: "Trade agreements", fr: "Accords commerciaux" },
  "tender.regions_opportunity": { en: "Regions of opportunity", fr: "Régions de l'appel d'offres" },
  "tender.regions_delivery": { en: "Regions of delivery (as published)", fr: "Régions de livraison (telles que publiées)" },
  "tender.gsin": { en: "GSIN", fr: "NIBS" },
  "tender.codes": { en: "UNSPSC Codes", fr: "Codes UNSPSC" },
  "tender.description_heading": { en: "Description as Published", fr: "Description publiée" },
  "tender.history": { en: "Amendment History", fr: "Historique des modifications" },
  "tender.history_note": {
    en: "Each version of the notice as CanadaBuys published it, newest first.",
    fr: "Chaque version de l'avis telle qu'AchatsCanada l'a publiée, de la plus récente à la plus ancienne.",
  },
  "tender.first_seen": { en: "First seen", fr: "Vu pour la première fois" },
  "tender.related": { en: "Award Notices for This Solicitation", fr: "Avis d'attribution pour cette invitation" },
  "tender.related_note": { en: "Award notices that carry the same solicitation number.", fr: "Avis d'attribution qui portent le même numéro d'invitation." },
  "tender.related_none": {
    en: "No award notice carries this solicitation number yet.",
    fr: "Aucun avis d'attribution ne porte encore ce numéro d'invitation.",
  },
  "tender.provenance": {
    en: "Read from {file} (see {data}). First seen {first}, last seen {last}.",
    fr: "Lu dans {file} (voir {data}). Vu pour la première fois le {first}, pour la dernière fois le {last}.",
  },
  // The CanadaBuys files a notice is read from, by the start of the file's name.
  "file.open_tenders": { en: "the CanadaBuys open tender notices file", fr: "le fichier des avis d'appel d'offres ouverts d'AchatsCanada" },
  "file.new_tenders": { en: "the CanadaBuys new tender notices file", fr: "le fichier des nouveaux avis d'appel d'offres d'AchatsCanada" },
  "file.all_tenders": { en: "the CanadaBuys file of all tender notices", fr: "le fichier de tous les avis d'appel d'offres d'AchatsCanada" },
  "file.fy_awards": { en: "the CanadaBuys award notices file for {fy}", fr: "le fichier des avis d'attribution d'AchatsCanada pour {fy}" },
  "file.all_awards": { en: "the CanadaBuys file of all award notices", fr: "le fichier de tous les avis d'attribution d'AchatsCanada" },
  "file.old_awards": { en: "the CanadaBuys historical award notices file", fr: "le fichier des avis d'attribution historiques d'AchatsCanada" },
  "file.fy_history": { en: "the CanadaBuys contract history file for {fy}", fr: "le fichier de l'historique des contrats d'AchatsCanada pour {fy}" },
  "file.all_history": { en: "the CanadaBuys file of all contract history", fr: "le fichier de tout l'historique des contrats d'AchatsCanada" },
  "file.old_history": { en: "the CanadaBuys historical contract history file", fr: "le fichier des anciens dossiers de l'historique des contrats d'AchatsCanada" },
  "tender.versions_one": { en: "{n} version on record.", fr: "{n} version au dossier." },
  "tender.versions_many": { en: "{n} versions on record.", fr: "{n} versions au dossier." },
  "tender.description": {
    en: "Tender notice {reference} from {buyer} on CanadaBuys, closing {closing}: dates, codes, amendments and related awards.",
    fr: "Avis d'appel d'offres {reference} de {buyer} sur AchatsCanada, clôture le {closing} : dates, codes, modifications et attributions liées.",
  },

  // -- award notices -------------------------------------------------------------------
  "awards.title": { en: "Award Notices", fr: "Avis d'attribution" },
  "awards.lead": {
    en: "The {n} newest award notices on CanadaBuys, newest award date first.",
    fr: "Les {n} avis d'attribution les plus récents sur AchatsCanada, du plus récent au plus ancien.",
  },
  "awards.value_note": {
    en: "Value is the total contract value on the notice's newest amendment when it is positive, else that amendment's amount. A cancelled notice counts zero in every total.",
    fr: "La valeur est la valeur totale du contrat à la plus récente modification de l'avis lorsqu'elle est positive, sinon le montant de cette modification. Un avis annulé compte pour zéro dans tous les totaux.",
  },
  "awards.years": { en: "Years", fr: "Années" },
  "awards.recent": { en: "Newest", fr: "Plus récents" },
  "awards.none": { en: "No award notice to show.", fr: "Aucun avis d'attribution à afficher." },
  "awards.year_title": { en: "Award Notices in {year}", fr: "Avis d'attribution en {year}" },
  "awards.year_description": {
    en: "{n} CanadaBuys award notices with an award date in {year}, newest first, each linked to its notice.",
    fr: "{n} avis d'attribution d'AchatsCanada dont la date d'attribution tombe en {year}, du plus récent au plus ancien, chacun lié à son avis.",
  },
  "awards.year_not_found": { en: "No Award Notices for This Year", fr: "Aucun avis d'attribution pour cette année" },
  "awards.back": { en: "Back to the award notices", fr: "Retour aux avis d'attribution" },
  "awards.year_count_one": { en: "{n} award notice dated {year}.", fr: "{n} avis d'attribution daté de {year}." },
  "awards.year_count_many": { en: "{n} award notices dated {year}.", fr: "{n} avis d'attribution datés de {year}." },
  "awards.page_not_found": { en: "Page Not Found", fr: "Page introuvable" },
  "awards.back_year": { en: "Back to the first page of the year", fr: "Retour à la première page de l'année" },
  "awards.download": { en: "Download award notices dated {year} (CSV)", fr: "Télécharger les avis d'attribution datés de {year} (CSV)" },
  "awards.year_panel": { en: "Award Notices Dated {year}", fr: "Avis d'attribution datés de {year}" },

  // -- one award notice or contract history record ------------------------------------
  "contract.title_award": { en: "Award Notice", fr: "Avis d'attribution" },
  "contract.title_history": { en: "PSPC Contract History Record", fr: "Dossier de l'historique des contrats de SPAC" },
  "contract.award_not_found": { en: "Award Notice Not Found", fr: "Avis d'attribution introuvable" },
  "contract.history_not_found": { en: "Contract History Record Not Found", fr: "Dossier de l'historique des contrats introuvable" },
  "contract.on_canadabuys": { en: "Open the award notice on CanadaBuys", fr: "Ouvrir l'avis d'attribution sur AchatsCanada" },
  "contract.history_dataset": { en: "Open the dataset on open.canada.ca", fr: "Ouvrir le jeu de données sur ouvert.canada.ca" },
  "contract.tender_link": { en: "Open the tender notice", fr: "Ouvrir l'avis d'appel d'offres" },
  "contract.parties": { en: "Supplier and Buyer", fr: "Fournisseur et acheteur" },
  "contract.supplier": { en: "Supplier", fr: "Fournisseur" },
  "contract.operating_name": { en: "Operating name", fr: "Nom commercial" },
  "contract.supplier_place": { en: "Supplier location", fr: "Lieu du fournisseur" },
  "contract.contracting": { en: "Contracting entity", fr: "Entité contractante" },
  "contract.value": { en: "Contract Value", fr: "Valeur du contrat" },
  "contract.value_counted": { en: "Value counted", fr: "Valeur retenue" },
  "contract.total_value": { en: "Total contract value", fr: "Valeur totale du contrat" },
  "contract.amount": { en: "Amount", fr: "Montant" },
  "contract.value_note": {
    en: "The value counted is the total contract value on the newest amendment when it is positive, else that amendment's amount.",
    fr: "La valeur retenue est la valeur totale du contrat à la plus récente modification lorsqu'elle est positive, sinon le montant de cette modification.",
  },
  "contract.value_cancelled": {
    en: "The notice is cancelled, so it counts zero in every total on this site.",
    fr: "L'avis est annulé. Il compte donc pour zéro dans tous les totaux du site.",
  },
  "contract.non_cad": {
    en: "The amounts are in {currency} as published and are left out of the site's totals, which are in Canadian dollars.",
    fr: "Les montants sont en {currency}, tels que publiés, et sont exclus des totaux du site, établis en dollars canadiens.",
  },
  "contract.lead_ends": { en: "ends {date}", fr: "prend fin le {date}" },
  "contract.lead_ended": { en: "ended {date}", fr: "a pris fin le {date}" },
  // Beside the end date while it falls within one of the radar's windows, linked to that window.
  "contract.days_left_one": { en: "{n} day left", fr: "{n} jour restant" },
  "contract.days_left_many": { en: "{n} days left", fr: "{n} jours restants" },
  "contract.ends_today": { en: "Ends today", fr: "Prend fin aujourd'hui" },
  // The source's own term spelled out: CanadaBuys writes "Contract against SA" in English.
  "instrument.contract_sa": {
    en: "Contract against a supply arrangement",
    fr: "Contrat découlant d'un arrangement en matière d'approvisionnement",
  },
  "contract.start": { en: "Contract start", fr: "Début du contrat" },
  "contract.end": { en: "Contract end", fr: "Fin du contrat" },
  "contract.number": { en: "Contract number", fr: "Numéro de contrat" },
  "contract.procurement_number": { en: "Procurement number", fr: "Numéro d'approvisionnement" },
  "contract.instrument": { en: "Instrument type", fr: "Type d'instrument" },
  "contract.amendment_type": { en: "Amendment type", fr: "Type de modification" },
  "contract.amendments": { en: "Amendments", fr: "Modifications" },
  "contract.description_award": {
    en: "Award notice {reference} on CanadaBuys: {supplier}, awarded by {buyer} on {date}. Value, method, codes and amendments.",
    fr: "Avis d'attribution {reference} sur AchatsCanada : {supplier}, attribué par {buyer} le {date}. Valeur, méthode, codes et modifications.",
  },
  "contract.description_history": {
    en: "PSPC contract history record {reference}: {supplier}, awarded for {buyer} on {date}. Value, method and amendments.",
    fr: "Dossier {reference} de l'historique des contrats de SPAC : {supplier}, attribué pour {buyer} le {date}. Valeur, méthode et modifications.",
  },

  // -- contracts ending soon (the radar; its rules are on the Methodology page) ----------
  "expiring.title": { en: "Contracts Ending Soon", fr: "Contrats prenant fin bientôt" },
  "expiring.lead": {
    en: "Contracts whose end date, as last amended, falls within 12 months of the data date ({date}): award notices, PSPC contract history and published contracts.",
    fr: "Contrats dont la date de fin, à la plus récente modification, tombe dans les 12 mois suivant la date des données ({date}) : avis d'attribution, historique des contrats de SPAC et contrats publiés.",
  },
  "expiring.value_note": {
    en: "Each contract is listed once, from the source the {rules} prefer, with the value that source's counting rules give. Totals add those values in Canadian dollars. A contract in another currency shows its own currency and is left out of them.",
    fr: "Chaque contrat figure une seule fois, tiré de la source que privilégient les {rules}, avec la valeur que donnent les règles de calcul de cette source. Les totaux additionnent ces valeurs en dollars canadiens. Un contrat dans une autre devise affiche sa devise et en est exclu.",
  },
  "expiring.rules_link": { en: "rules of this list", fr: "règles de cette liste" },
  "expiring.tiles_label": { en: "Contracts by end date", fr: "Contrats par date de fin" },
  "expiring.window_3m": { en: "Within 3 months", fr: "D'ici 3 mois" },
  "expiring.window_6m": { en: "Within 6 months", fr: "D'ici 6 mois" },
  "expiring.window_12m": { en: "Within 12 months", fr: "D'ici 12 mois" },
  "expiring.months_3m": { en: "3 months", fr: "3 mois" },
  "expiring.months_6m": { en: "6 months", fr: "6 mois" },
  "expiring.months_12m": { en: "12 months", fr: "12 mois" },
  "expiring.tile_total": { en: "Value {total}", fr: "Valeur : {total}" },
  "expiring.download": {
    en: "Download contracts ending within 12 months (CSV)",
    fr: "Télécharger les contrats prenant fin d'ici 12 mois (CSV)",
  },
  "expiring.download_3m": {
    en: "Download contracts ending within 3 months (CSV)",
    fr: "Télécharger les contrats prenant fin d'ici 3 mois (CSV)",
  },
  "expiring.feed": {
    en: "Atom feed of contracts entering the 3-month window",
    fr: "Fil Atom des contrats qui entrent dans la période de 3 mois",
  },
  "expiring.feeds_all": { en: "Feeds by buyer and by segment", fr: "Fils par acheteur et par segment" },
  "expiring.first_heading": { en: "Ending Within 3 Months", fr: "Contrats prenant fin d'ici 3 mois" },
  "expiring.first_note": { en: "The first {n} by end date.", fr: "Les {n} premiers par date de fin." },
  "expiring.first_all": { en: "All contracts ending within 3 months", fr: "Tous les contrats prenant fin d'ici 3 mois" },
  "expiring.list_missing": { en: "The list for this window is not published yet.", fr: "La liste de cette période n'est pas encore publiée." },
  "expiring.none_window": { en: "No contract ends within this window.", fr: "Aucun contrat ne prend fin dans cette période." },
  "expiring.by_buyer": { en: "By Buyer, Within 12 Months", fr: "Par acheteur, d'ici 12 mois" },
  "expiring.by_segment": { en: "By Segment, Within 12 Months", fr: "Par segment, d'ici 12 mois" },
  "expiring.by_segment_note": {
    en: "A contract counts under every UNSPSC segment its codes fall in, so the counts overlap and are not added up.",
    fr: "Un contrat compte dans chaque segment UNSPSC où tombent ses codes. Les nombres se chevauchent donc et ne sont pas additionnés.",
  },
  "expiring.col_contracts": { en: "Contracts", fr: "Contrats" },
  "expiring.windows_nav": { en: "Windows", fr: "Périodes" },
  "expiring.window_title_3m": { en: "Contracts Ending Within 3 Months", fr: "Contrats prenant fin d'ici 3 mois" },
  "expiring.window_title_6m": { en: "Contracts Ending Within 6 Months", fr: "Contrats prenant fin d'ici 6 mois" },
  "expiring.window_title_12m": { en: "Contracts Ending Within 12 Months", fr: "Contrats prenant fin d'ici 12 mois" },
  "expiring.window_count_one": {
    en: "{n} contract ends within {months} of the data date ({date}).",
    fr: "{n} contrat prend fin dans les {months} suivant la date des données ({date}).",
  },
  "expiring.window_count_many": {
    en: "{n} contracts end within {months} of the data date ({date}).",
    fr: "{n} contrats prennent fin dans les {months} suivant la date des données ({date}).",
  },
  "expiring.window_total": { en: "Value of the contracts listed: {total}.", fr: "Valeur des contrats de la liste : {total}." },
  "expiring.window_description": {
    en: "{n} federal contracts ending within {months} of {date}: organization, buyer, value, competition and amendments, each linked to its record.",
    fr: "{n} contrats fédéraux prenant fin dans les {months} suivant le {date} : organisation, acheteur, valeur, concurrence et modifications, chacun lié à son dossier.",
  },
  "expiring.window_not_found": { en: "Window Not Found", fr: "Période introuvable" },
  "expiring.back": { en: "Back to the contracts ending soon", fr: "Retour aux contrats prenant fin bientôt" },
  "expiring.page_not_found": { en: "Page Not Found", fr: "Page introuvable" },
  "expiring.back_window": { en: "Back to the first page of the window", fr: "Retour à la première page de la période" },
  "expiring.filter_value": { en: "Value", fr: "Valeur" },
  // Two kinds of rows a reader may want out of the list, both in by default:
  // contracts ending on March 31 (the federal fiscal year's last day, where a
  // contract often ends to be renewed) and standing offers and supply
  // arrangements (frameworks under which call-ups are made, not one purchase).
  "expiring.filter_fye": { en: "Fiscal-year-end dates ({n})", fr: "Fins d'exercice ({n})" },
  "expiring.filter_sosa": { en: "Standing offers and supply arrangements ({n})", fr: "Offres à commandes et arrangements en matière d'approvisionnement ({n})" },
  "expiring.filter_include": { en: "Include", fr: "Inclure" },
  "expiring.chip_fye": { en: "Fiscal-year-end dates", fr: "Fins d'exercice" },
  "expiring.chip_sosa": { en: "Standing offers and supply arrangements", fr: "Offres à commandes et arrangements" },
  "expiring.chip_left_out": { en: "left out", fr: "exclues" },
  "expiring.tag_fye": { en: "Fiscal year end", fr: "Fin d'exercice" },
  "expiring.band_under_100k": { en: "Under $100,000", fr: "Moins de 100 000 $" },
  "expiring.band_100k_1m": { en: "$100,000 to under $1 million", fr: "De 100 000 $ à moins de 1 million de dollars" },
  "expiring.band_1m_10m": { en: "$1 million to under $10 million", fr: "De 1 à moins de 10 millions de dollars" },
  "expiring.band_over_10m": { en: "$10 million and over", fr: "10 millions de dollars et plus" },
  "expiring.band_note": {
    en: "Value bands are in Canadian dollars. A contract in another currency falls in none.",
    fr: "Les tranches de valeur sont en dollars canadiens. Un contrat dans une autre devise n'entre dans aucune.",
  },
  "expiring.filter_note": {
    en: "The filters apply to the {rows} contracts on this page (page {page} of {pages}). Each other page is filtered when you open it.",
    fr: "Les filtres s'appliquent aux {rows} contrats de cette page (page {page} sur {pages}). Chaque autre page est filtrée lorsque vous l'ouvrez.",
  },
  "expiring.match_one": { en: "{n} contract on this page matches.", fr: "{n} contrat de cette page correspond." },
  "expiring.match_many": { en: "{n} contracts on this page match.", fr: "{n} contrats de cette page correspondent." },
  "expiring.none_match": { en: "No contract on this page matches these filters.", fr: "Aucun contrat de cette page ne correspond à ces filtres." },
  "expiring.col_ends": { en: "Ends on", fr: "Prend fin le" },
  "expiring.days_left_one": { en: "{n} day left", fr: "{n} jour restant" },
  "expiring.days_left_many": { en: "{n} days left", fr: "{n} jours restants" },
  "expiring.ends_today": { en: "Ends today", fr: "Prend fin aujourd'hui" },
  "expiring.col_amendments": { en: "Amendments and value change", fr: "Modifications et variation de valeur" },
  // Under the radar list while the amendments and record columns rest (700 to 1599 px).
  "expiring.rest_note": {
    en: "Amendments, value changes and the source record of each contract are in {csv}.",
    fr: "Les modifications, les variations de valeur et le dossier source de chaque contrat se trouvent dans {csv}.",
  },
  "expiring.amendments_none": { en: "None", fr: "Aucune" },
  "expiring.amendments_one": { en: "{n} amendment", fr: "{n} modification" },
  "expiring.amendments_many": { en: "{n} amendments", fr: "{n} modifications" },
  "expiring.growth": { en: "{pct} on the original amount", fr: "{pct} par rapport au montant initial" },
  "expiring.growth_def": {
    en: "Amendments counts the versions beyond the original. Growth is the newest total value over the original amount, minus one, left blank when either is unknown.",
    fr: "Les modifications comptent les versions qui suivent l'original. La variation est la plus récente valeur totale divisée par le montant initial, moins un, laissée vide si l'un ou l'autre est inconnu.",
  },
  "expiring.kind_award": { en: "Award notice", fr: "Avis d'attribution" },
  "expiring.kind_history": { en: "PSPC contract history", fr: "Historique des contrats de SPAC" },
  "expiring.kind_contract": { en: "Published contract", fr: "Contrat publié" },
  "expiring.record_award": { en: "CanadaBuys notice", fr: "Avis sur AchatsCanada" },
  "expiring.record_history": { en: "Contract history dataset", fr: "Jeu de données de l'historique" },
  "expiring.record_contract": { en: "Contracts search", fr: "Recherche de contrats" },
  "expiring.record_tender": { en: "Tender notice", fr: "Avis d'appel d'offres" },
  "expiring.withheld": { en: "Individual, name withheld", fr: "Particulier, nom non divulgué" },
  "expiring.part_none": {
    en: "No contract ends within 12 months of the data date.",
    fr: "Aucun contrat ne prend fin dans les 12 mois suivant la date des données.",
  },
  "expiring.part_one": {
    en: "{n} contract ends within 12 months of the data date. Value: {total}.",
    fr: "{n} contrat prend fin dans les 12 mois suivant la date des données. Valeur : {total}.",
  },
  "expiring.part_many": {
    en: "{n} contracts end within 12 months of the data date. Value: {total}.",
    fr: "{n} contrats prennent fin dans les 12 mois suivant la date des données. Valeur : {total}.",
  },
  "expiring.part_shown": { en: "The first {shown} by end date are shown.", fr: "Les {shown} premiers par date de fin sont affichés." },
  "expiring.part_more_one": { en: "The other one is in {list}.", fr: "L'autre se trouve dans {list}." },
  "expiring.part_more_many": { en: "The other {more} are in {list}.", fr: "Les {more} autres se trouvent dans {list}." },
  "expiring.list_link_12m": { en: "the 12-month list", fr: "la liste de 12 mois" },
  "expiring.csv_link": { en: "the 12-month CSV file", fr: "le fichier CSV de 12 mois" },
  "expiring.csv_link_3m": { en: "the 3-month CSV file", fr: "le fichier CSV de 3 mois" },
  "expiring.see_all": { en: "All contracts ending soon", fr: "Tous les contrats prenant fin bientôt" },
  // The 6- and 12-month windows for a request whose plan lacks radar_depth,
  // once the accounts switch is on: the window's count and total, its first
  // rows, then this panel. No price is ever named here.
  "expiring.pro_asked": {
    en: "Filters and later pages are part of Pro, so this address shows the window's first contracts.",
    fr: "Les filtres et les pages suivantes font partie de Pro; cette adresse affiche donc les premiers contrats de la période.",
  },
  "expiring.pro_title": { en: "Part of Pro", fr: "Offert avec le forfait Pro" },
  "expiring.pro_text": {
    en: "The full list, with its filters and pages, is part of Pro, the site's paid plan.",
    fr: "La liste complète, avec ses filtres et ses pages, fait partie de Pro, le forfait payant du site.",
  },
  "expiring.pro_includes": { en: "Pro includes:", fr: "Le forfait Pro comprend :" },
  "expiring.pro_radar": {
    en: "the full 6-month and 12-month lists of contracts ending, with every filter and page",
    fr: "les listes complètes des contrats prenant fin d'ici 6 et 12 mois, avec tous leurs filtres et toutes leurs pages",
  },
  "expiring.pro_csv": {
    en: "the 12-month CSV file of contracts ending",
    fr: "le fichier CSV de 12 mois des contrats prenant fin",
  },
  "expiring.pro_intraday": {
    en: "same-day tender notices on the tender lists, read from CanadaBuys every two hours",
    fr: "les avis d'appel d'offres du jour même dans les listes d'appels d'offres, lus sur AchatsCanada toutes les deux heures",
  },
  "expiring.pro_searches": {
    en: "up to {cap} saved searches, with email delivery",
    fr: "jusqu'à {cap} recherches enregistrées, avec envoi par courriel",
  },
  "expiring.pro_free": {
    en: "The {list}, its feeds and every window's count and total stay free.",
    fr: "La {list}, ses fils ainsi que le nombre et le total de chaque période restent gratuits.",
  },
  "expiring.pro_free_list": { en: "3-month list", fr: "liste de 3 mois" },
  "expiring.pro_sign_in": { en: "Sign in or create an account", fr: "Se connecter ou créer un compte" },
  "expiring.pro_account": { en: "Your account", fr: "Votre compte" },
  // The Pro mark and the tease panel (src/pro.tsx). {monthly} and {yearly}
  // are the operator's figures from wrangler.jsonc, never written here.
  "pro.tag": { en: "Pro", fr: "Pro" },
  "pro.tag_hidden": { en: "(paid plan)", fr: "(forfait payant)" },
  "pro.price": {
    en: "Pro is CA${monthly} a month or CA${yearly} a year, taxes added at checkout.",
    fr: "Pro coûte {monthly} $ CA par mois ou {yearly} $ CA par année, taxes ajoutées au paiement.",
  },
  "pro.include_bugs": { en: "a form under the account to report a bug", fr: "un formulaire dans le compte pour signaler un bogue" },
  "pro.include_feeds": {
    en: "a calendar feed of each saved tender search and one of the watches, with closing and end dates as events",
    fr: "un flux de calendrier pour chaque recherche d'appels d'offres enregistrée et un pour les suivis, avec les dates de clôture et de fin comme événements",
  },

  // -- analytics (src/pages/analytics.tsx, docs/analytics.md) ---------------------------
  "analytics.title": { en: "Analytics", fr: "Analyses" },
  "analytics.title_of": { en: "Analytics: {name}", fr: "Analyses : {name}" },
  "analytics.crumb": { en: "Analytics", fr: "Analyses" },
  "analytics.eyebrow": { en: "Analytics", fr: "Analyses" },
  "analytics.link": { en: "Analytics", fr: "Analyses" },
  // The word on the Pro mark (class pro-tag): the plan's name in both languages.
  "analytics.description_buyer": {
    en: "Charts of the federal records of {name} by fiscal year: value by quarter and by segment, the non-competitive share and the largest organizations.",
    fr: "Graphiques des dossiers fédéraux de {name} par exercice : valeur par trimestre et par segment, part non concurrentielle et principales organisations.",
  },
  "analytics.description_organization": {
    en: "Charts of the federal records of {name} by fiscal year: value, the largest buyers and segments, and its share of a segment.",
    fr: "Graphiques des dossiers fédéraux de {name} par exercice : valeur, principaux acheteurs et segments, et sa part d'un segment.",
  },
  "analytics.description_segment": {
    en: "Charts of the UNSPSC segment {name} by fiscal year: buyers and organizations with a record, the largest of each, and the organizations new to it.",
    fr: "Graphiques du segment UNSPSC {name} par exercice : acheteurs et organisations ayant un dossier, les principaux de chacun et les organisations nouvelles.",
  },
  "analytics.lead": { en: "{source}, federal fiscal years {first} to {last}.", fr: "{source}, exercices fédéraux {first} à {last}." },
  "analytics.note_sources": {
    en: "One source at a time: a contract can appear in several sources, so no figure adds two of them.",
    fr: "Une source à la fois : un contrat peut figurer dans plusieurs sources, et aucun chiffre n'en additionne deux.",
  },
  "analytics.note_fiscal": {
    en: "A fiscal year runs from April 1 to March 31; the current one is counted up to the data date.",
    fr: "Un exercice va du 1er avril au 31 mars; l'exercice en cours est compté jusqu'à la date des données.",
  },
  "analytics.back_buyer": { en: "Back to the buyer", fr: "Retour à l'acheteur" },
  "analytics.back_organization": { en: "Back to the profile", fr: "Retour au profil" },
  "analytics.back_segment": { en: "Back to the segment", fr: "Retour au segment" },
  "analytics.sources_nav": { en: "Source shown", fr: "Source affichée" },
  "analytics.period_nav": { en: "Period", fr: "Période" },
  "analytics.period": { en: "{n} fiscal years", fr: "{n} exercices" },
  "analytics.csv": { en: "CSV file", fr: "Fichier CSV" },
  "analytics.unavailable_title": { en: "Analytics Are Not Available Right Now", fr: "Analyses non disponibles pour le moment" },
  "analytics.unavailable_text": {
    en: "The records database could not be read. Try again later; the rest of the site works as usual.",
    fr: "La base des dossiers n'a pas pu être lue. Réessayez plus tard; le reste du site fonctionne comme d'habitude.",
  },
  "analytics.unavailable_loading": {
    en: "The records database is being loaded again. The analytics return when the load is finished.",
    fr: "La base des dossiers est en cours de rechargement. Les analyses reviendront une fois le chargement terminé.",
  },
  "analytics.as_of": { en: "Records as of {date}.", fr: "Dossiers en date du {date}." },
  "analytics.rules": { en: "How the figures are counted: {methodology}.", fr: "Méthode de calcul des chiffres : {methodology}." },
  "analytics.rules_link": { en: "Methodology, Analytics", fr: "Méthodologie, Analyses" },
  "analytics.none": { en: "No record of this source in these fiscal years.", fr: "Aucun dossier de cette source pour ces exercices." },
  "analytics.to_date": { en: "{fy} (to date)", fr: "{fy} (à ce jour)" },
  "analytics.quarter": { en: "Q{n}", fr: "T{n}" },
  "analytics.chart_aria": { en: "Chart by fiscal year", fr: "Graphique par exercice" },
  "analytics.chart_quarters": { en: "{source}: value by fiscal quarter", fr: "{source} : valeur par trimestre d'exercice" },
  "analytics.chart_years": { en: "{source}: value by fiscal year", fr: "{source} : valeur par exercice" },
  "analytics.chart_buyers": { en: "Buyers with a record", fr: "Acheteurs ayant un dossier" },
  "analytics.chart_orgs": { en: "Organizations with a record", fr: "Organisations ayant un dossier" },
  "analytics.nc_by_count": { en: "Non-competitive share, by count", fr: "Part non concurrentielle, en nombre" },
  "analytics.nc_by_value": { en: "Non-competitive share, by value", fr: "Part non concurrentielle, en valeur" },
  "analytics.panel_quarters": { en: "Value by Fiscal Quarter", fr: "Valeur par trimestre" },
  "analytics.panel_segments": { en: "Value by Segment", fr: "Valeur par segment" },
  "analytics.panel_competition": { en: "Non-Competitive Share by Fiscal Year", fr: "Part non concurrentielle par exercice" },
  "analytics.panel_suppliers": { en: "Largest Organizations", fr: "Principales organisations" },
  "analytics.panel_years": { en: "Value by Fiscal Year", fr: "Valeur par exercice" },
  "analytics.panel_buyers": { en: "Largest Buyers", fr: "Principaux acheteurs" },
  "analytics.panel_share": { en: "Share of a Segment", fr: "Part d'un segment" },
  "analytics.panel_activity": { en: "Buyers and Organizations by Fiscal Year", fr: "Acheteurs et organisations par exercice" },
  "analytics.panel_segment_buyers": { en: "Largest Buyers in the Segment", fr: "Principaux acheteurs du segment" },
  "analytics.panel_winners": { en: "Largest Organizations in the Segment", fr: "Principales organisations du segment" },
  "analytics.panel_entrants": { en: "New to the Segment", fr: "Nouvelles venues dans le segment" },
  "analytics.foot_quarters": {
    en: "Values in Canadian dollars by the counting rules. A value in another currency, one not published and one flagged for checking are left out of the sums.",
    fr: "Valeurs en dollars canadiens selon les règles de calcul. Une valeur dans une autre devise, une valeur non publiée et une valeur signalée pour vérification sont exclues des sommes.",
  },
  "analytics.foot_segments": {
    en: "Award notices and PSPC contract history carry UNSPSC codes. A notice whose codes fall in several segments counts in each, so the shares can add up to more than 100%.",
    fr: "Les avis d'attribution et l'historique des contrats de SPAC portent des codes UNSPSC. Un avis dont les codes relèvent de plusieurs segments compte dans chacun; les parts peuvent donc dépasser 100 % au total.",
  },
  "analytics.foot_competition": {
    en: "As the source states it. The share by value is taken over positive values; records whose method is not stated count in the whole.",
    fr: "Tel que l'indique la source. La part en valeur est calculée sur les valeurs positives; les dossiers dont la méthode n'est pas précisée comptent dans le total.",
  },
  "analytics.foot_suppliers": {
    en: "Shares are of the whole value in the period, records that name no organization included.",
    fr: "Les parts portent sur toute la valeur de la période, y compris les dossiers qui ne nomment aucune organisation.",
  },
  "analytics.foot_activity": {
    en: "Distinct buyers and organizations with at least one record in the segment in that fiscal year.",
    fr: "Acheteurs et organisations distincts ayant au moins un dossier dans le segment pendant cet exercice.",
  },
  "analytics.foot_entrants": {
    en: "An organization is new in a fiscal year when it has a record in the segment that year and none in the {n} fiscal years before.",
    fr: "Une organisation est nouvelle pendant un exercice lorsqu'elle a un dossier dans le segment cet exercice et aucun pendant les {n} exercices précédents.",
  },
  "analytics.foot_share": {
    en: "The organizations to compare come from the segment's {m} largest in the period; at most {n} are shown beside this one.",
    fr: "Les organisations à comparer sont tirées des {m} principales du segment pour la période; au plus {n} figurent à côté de celle-ci.",
  },
  "analytics.no_segments": {
    en: "Published contracts and grants carry no UNSPSC segment. Choose award notices or PSPC contract history.",
    fr: "Les contrats publiés et les subventions ne portent aucun segment UNSPSC. Choisissez les avis d'attribution ou l'historique des contrats de SPAC.",
  },
  "analytics.no_competition": {
    en: "Grants and contributions carry no competitive flag.",
    fr: "Les subventions et contributions ne portent aucun indicateur de concurrence.",
  },
  "analytics.col_fy": { en: "Fiscal year", fr: "Exercice" },
  "analytics.col_year_value": { en: "Value for the year", fr: "Valeur de l'exercice" },
  "analytics.col_no_value": { en: "Without a published value", fr: "Sans valeur publiée" },
  "analytics.col_rank": { en: "Rank", fr: "Rang" },
  "analytics.col_share": { en: "Share", fr: "Part" },
  "analytics.col_buyers": { en: "Buyers", fr: "Acheteurs" },
  "analytics.col_orgs": { en: "Organizations", fr: "Organisations" },
  "analytics.top_1": { en: "Largest organization:", fr: "Principale organisation :" },
  "analytics.top_5": { en: "Five largest:", fr: "Cinq principales :" },
  "analytics.top_10": { en: "Ten largest:", fr: "Dix principales :" },
  "analytics.orgs_one": { en: "{n} organization in the period", fr: "{n} organisation pour la période" },
  "analytics.orgs_many": { en: "{n} organizations in the period", fr: "{n} organisations pour la période" },
  "analytics.entrants_one": { en: "{n} organization new to the segment in {fy}.", fr: "{n} organisation nouvelle dans le segment en {fy}." },
  "analytics.entrants_many": { en: "{n} organizations new to the segment in {fy}.", fr: "{n} organisations nouvelles dans le segment en {fy}." },
  "analytics.share_lead": {
    en: "Each organization's share of the value of segment {segment} in {source}, by fiscal year, on one scale.",
    fr: "La part de chaque organisation dans la valeur du segment {segment}, {source}, par exercice, sur une même échelle.",
  },
  "analytics.share_pick": { en: "Compare with (up to {n})", fr: "Comparer avec (jusqu'à {n})" },
  "analytics.share_apply": { en: "Show", fr: "Afficher" },
  "analytics.share_reset": { en: "Reset", fr: "Réinitialiser" },
  "analytics.free_asked": {
    en: "Longer periods, other segments and comparisons are part of Pro, so this view shows the latest {n} fiscal years.",
    fr: "Les périodes plus longues, les autres segments et les comparaisons font partie de Pro; cette vue présente donc les {n} derniers exercices.",
  },
  "analytics.free_buyer": {
    en: "The full view covers up to ten fiscal years with a table under each chart: the value by segment, the non-competitive share by fiscal year, the largest organizations and the share they hold, and a CSV file of each table.",
    fr: "La vue complète couvre jusqu'à dix exercices, avec un tableau sous chaque graphique : la valeur par segment, la part non concurrentielle par exercice, les principales organisations et la part qu'elles détiennent, et un fichier CSV de chaque tableau.",
  },
  "analytics.free_organization": {
    en: "The full view covers up to ten fiscal years with a table under each chart: the largest buyers, the largest segments, this organization's share of a segment beside up to five others, and a CSV file of each table.",
    fr: "La vue complète couvre jusqu'à dix exercices, avec un tableau sous chaque graphique : les principaux acheteurs, les principaux segments, la part de cette organisation dans un segment à côté de cinq autres au plus, et un fichier CSV de chaque tableau.",
  },
  "analytics.free_segment": {
    en: "The full view covers up to ten fiscal years with a table under each chart: the largest buyers and organizations in the segment, the organizations new to it, and a CSV file of each table.",
    fr: "La vue complète couvre jusqu'à dix exercices, avec un tableau sous chaque graphique : les principaux acheteurs et organisations du segment, les organisations nouvelles et un fichier CSV de chaque tableau.",
  },
  "analytics.pro_billing": { en: "See the Pro plan on the billing page", fr: "Voir le forfait Pro sur la page de facturation" },
  "analytics.pro_sign_in": { en: "Sign in to subscribe to Pro", fr: "Se connecter pour s'abonner à Pro" },
  "analytics.tease_buyer_segments": {
    en: "The buyer's value in each UNSPSC segment, the ten largest, with their shares.",
    fr: "La valeur de l'acheteur dans chaque segment UNSPSC, les dix principaux, avec leurs parts.",
  },
  "analytics.tease_competition": {
    en: "The share of non-competitive records by fiscal year, by count and by value.",
    fr: "La part des dossiers non concurrentiels par exercice, en nombre et en valeur.",
  },
  "analytics.tease_suppliers": {
    en: "The ten organizations with the largest values, and the share the largest one, five and ten hold.",
    fr: "Les dix organisations aux valeurs les plus élevées, et la part que détiennent la principale, les cinq et les dix principales.",
  },
  "analytics.tease_org_buyers": {
    en: "The ten buyers with the largest values for this organization.",
    fr: "Les dix acheteurs aux valeurs les plus élevées pour cette organisation.",
  },
  "analytics.tease_org_segments": {
    en: "The ten UNSPSC segments with the largest values for this organization.",
    fr: "Les dix segments UNSPSC aux valeurs les plus élevées pour cette organisation.",
  },
  "analytics.tease_share": {
    en: "This organization's share of a segment's value by fiscal year, beside up to {n} others from the segment's largest.",
    fr: "La part de cette organisation dans la valeur d'un segment par exercice, à côté de {n} autres au plus parmi les principales du segment.",
  },
  "analytics.tease_segment_buyers": {
    en: "The ten buyers with the largest values in the segment.",
    fr: "Les dix acheteurs aux valeurs les plus élevées dans le segment.",
  },
  "analytics.tease_winners": {
    en: "The ten organizations with the largest values in the segment.",
    fr: "Les dix organisations aux valeurs les plus élevées dans le segment.",
  },
  "analytics.tease_entrants": {
    en: "The organizations with a record in the segment this fiscal year and none in the {n} before.",
    fr: "Les organisations ayant un dossier dans le segment pendant l'exercice et aucun pendant les {n} précédents.",
  },

  // -- organization profile -------------------------------------------------------------
  "org.title": { en: "Organization", fr: "Organisation" },
  "org.not_found": { en: "Organization Not Found", fr: "Organisation introuvable" },
  "org.back": { en: "Back to the organizations", fr: "Retour aux organisations" },
  "org.also_recorded": { en: "Also recorded as:", fr: "Également au dossier sous :" },
  "org.seen": { en: "Records from {first} to {last}.", fr: "Dossiers du {first} au {last}." },
  "org.business_number": { en: "Business number {bn}.", fr: "Numéro d'entreprise {bn}." },
  "org.respond": { en: "Respond as this organization", fr: "Répondre au nom de cette organisation" },
  "org.correct": { en: "Report a correction", fr: "Signaler une correction" },
  "org.tiles_label": { en: "Totals by source", fr: "Totaux par source" },
  "org.tile_records_one": { en: "{n} record", fr: "{n} dossier" },
  "org.tile_records_many": { en: "{n} records", fr: "{n} dossiers" },
  "org.tile_reports_one": { en: "{n} report", fr: "{n} rapport" },
  "org.tile_reports_many": { en: "{n} reports", fr: "{n} rapports" },
  "org.places": { en: "Addresses on the Records", fr: "Adresses aux dossiers" },
  "org.rows_one": { en: "{n} record", fr: "{n} dossier" },
  "org.rows_many": { en: "{n} records", fr: "{n} dossiers" },
  "org.places_note": {
    en: "Records under this name at {n} addresses. Two organizations with the same legal name may share this page, and the addresses may belong to different ones.",
    fr: "Dossiers sous ce nom à {n} adresses. Deux organisations au même nom légal peuvent partager cette page, et les adresses peuvent appartenir à des organisations différentes.",
  },
  "org.registry": { en: "Corporate Registry", fr: "Registre des sociétés" },
  "org.years": { en: "Figures by Year and Source", fr: "Chiffres par année et par source" },
  "org.years_note": {
    en: "Calendar years of the award, contract or agreement start date, by the {methodology}.",
    fr: "Années civiles de la date d'attribution, de contrat ou de début d'accord, selon les {methodology}.",
  },
  "org.years_rules": { en: "counting rules", fr: "règles de calcul" },
  "org.years_none": { en: "No dated records with an amount.", fr: "Aucun dossier daté avec un montant." },
  "org.chart_aria": {
    en: "Value per calendar year. The table below gives every figure.",
    fr: "Valeur par année civile. Le tableau ci-dessous donne chaque chiffre.",
  },
  "org.col_nc_count": { en: "Non-competitive, by count", fr: "Non concurrentiels, en nombre" },
  "org.col_nc_value": { en: "Non-competitive, by value", fr: "Non concurrentiels, en valeur" },
  "org.nc_negative_note": {
    en: "* The year holds records below zero (an amendment that lowered a contract's value). The non-competitive share by value counts positive values only; the value column is the net total.",
    fr: "* L'année compte des dossiers inférieurs à zéro (une modification qui a réduit la valeur d'un contrat). La part non concurrentielle en valeur ne compte que les valeurs positives; la colonne Valeur donne le total net.",
  },
  "org.nc_footnote": {
    en: "Non-competitive is the sources' term for a contract awarded without a competition. The share counts the records the source marks that way out of all the year's records, including those with no method stated. Grants carry no such flag.",
    fr: "« Non concurrentiel » est le terme des sources pour un contrat attribué sans mise en concurrence. La part compte les dossiers ainsi marqués par la source sur l'ensemble des dossiers de l'année, y compris ceux dont la méthode n'est pas indiquée. Les subventions ne portent pas cet indicateur.",
  },
  "org.section_awards": { en: "Award Notices", fr: "Avis d'attribution" },
  "org.section_history": { en: "PSPC Contract History", fr: "Historique des contrats de SPAC" },
  "org.section_contracts": { en: "Published Contracts", fr: "Contrats publiés" },
  "org.section_grants": { en: "Grants and Contributions", fr: "Subventions et contributions" },
  "org.section_lobbying": { en: "Lobbying Communications", fr: "Communications de lobbying" },
  "org.none_awards": { en: "No award notice names this organization.", fr: "Aucun avis d'attribution ne nomme cette organisation." },
  "org.none_history": {
    en: "No PSPC contract history record names this organization.",
    fr: "Aucun dossier de l'historique des contrats de SPAC ne nomme cette organisation.",
  },
  "org.none_contracts": { en: "No published contract names this organization.", fr: "Aucun contrat publié ne nomme cette organisation." },
  "org.none_grants": {
    en: "No grant or contribution agreement names this organization.",
    fr: "Aucun accord de subvention ou de contribution ne nomme cette organisation.",
  },
  "org.none_lobbying": {
    en: "No lobbying communication report names this organization as a client.",
    fr: "Aucun rapport de communication de lobbying ne nomme cette organisation comme cliente.",
  },
  "org.more_rows_one": {
    en: "Showing the newest {shown} of {total} records. The other one is in {where}.",
    fr: "Les {shown} dossiers les plus récents sur {total} sont affichés. L'autre se trouve dans {where}.",
  },
  "org.more_rows_many": {
    en: "Showing the newest {shown} of {total} records. The other {more} are in {where}.",
    fr: "Les {shown} dossiers les plus récents sur {total} sont affichés. Les {more} autres se trouvent dans {where}.",
  },
  "org.more_downloads": { en: "the yearly CSV downloads", fr: "les fichiers CSV annuels" },
  "org.more_source": { en: "the publisher's file", fr: "le fichier de l'éditeur" },
  "org.non_cad_one": {
    en: "{n} record in another currency is shown with its currency and left out of the totals.",
    fr: "{n} dossier dans une autre devise est affiché avec sa devise et exclu des totaux.",
  },
  "org.non_cad_many": {
    en: "{n} records in another currency are shown with their currency and left out of the totals.",
    fr: "{n} dossiers dans une autre devise sont affichés avec leur devise et exclus des totaux.",
  },
  "org.history_note": {
    en: "Contracts PSPC awarded on behalf of client departments. The buyer column names the client.",
    fr: "Contrats attribués par SPAC au nom de ministères clients. La colonne de l'acheteur nomme le client.",
  },
  "org.contracts_note": {
    en: "Contracts over $10,000 as departments report them each quarter. Each record's value is its own. An amendment record carries the amendment's value.",
    fr: "Contrats de plus de 10 000 $ tels que les ministères les déclarent chaque trimestre. La valeur de chaque dossier lui est propre. Un dossier de modification porte la valeur de la modification.",
  },
  "org.reporting_period": { en: "Reported for {period}", fr: "Déclaré pour {period}" },
  "org.last_reported": { en: "Value as last reported: {value}", fr: "Valeur à la dernière déclaration : {value}" },
  "org.last_reported_def": {
    en: "The largest contract value among the records that share this procurement ID. It is shown for reference and never added to a total.",
    fr: "La plus grande valeur de contrat parmi les dossiers qui partagent ce numéro d'approvisionnement. Elle est affichée à titre indicatif et jamais additionnée à un total.",
  },
  "org.lobbying_note": {
    en: "Monthly communication reports in which the organization is the client. Public office holders are named in their public role, as the registry publishes them.",
    fr: "Rapports mensuels de communication dans lesquels l'organisation est la cliente. Les titulaires d'une charge publique sont nommés dans leur rôle public, tels que le registre les publie.",
  },
  "org.buyers": { en: "Main Buyers by Source", fr: "Principaux acheteurs par source" },
  "org.buyers_none": { en: "No buyer on record.", fr: "Aucun acheteur au dossier." },
  // The line after the record lists that names the sources with no record of the organization.
  "org.sources_none": { en: "No record in {list} names this organization.", fr: "Aucun dossier dans {list} ne nomme cette organisation." },
  "org.sources_not_read": { en: "Not loaded yet: {list}.", fr: "Pas encore chargées : {list}." },
  "org.in_awards": { en: "award notices", fr: "les avis d'attribution" },
  "org.in_history": { en: "PSPC contract history", fr: "l'historique des contrats de SPAC" },
  "org.in_contracts": { en: "published contracts", fr: "les contrats publiés" },
  "org.in_grants": { en: "grants and contributions", fr: "les subventions et contributions" },
  "org.in_lobbying": { en: "lobbying communications", fr: "les communications de lobbying" },
  "org.expiring": { en: "Contracts Ending", fr: "Contrats prenant fin" },
  "org.responses": { en: "Responses from the Organization", fr: "Réponses de l'organisation" },
  "org.no_responses": { en: "The organization has not published a response.", fr: "L'organisation n'a publié aucune réponse." },
  "org.received": { en: "Received {date}", fr: "Reçu le {date}" },
  "org.corrections": { en: "Corrections Log", fr: "Journal des corrections" },
  "org.no_corrections": { en: "No correction to this profile so far.", fr: "Aucune correction à ce profil jusqu'à présent." },
  "org.no_records_short": { en: "no records with an amount", fr: "aucun dossier avec un montant" },
  "org.description_tail": {
    en: "Records from CanadaBuys and open.canada.ca, each linked to its source.",
    fr: "Dossiers d'AchatsCanada et d'ouvert.canada.ca, chacun lié à sa source.",
  },
  "registry.none": { en: "No match in the federal corporate registry.", fr: "Aucune correspondance dans le registre fédéral des sociétés." },
  "registry.corporations_canada": { en: "Corporations Canada", fr: "Corporations Canada" },
  "registry.bc_orgbook": { en: "BC OrgBook", fr: "OrgBook C.-B." },
  "registry.quebec_req": { en: "Quebec enterprise register", fr: "Registraire des entreprises du Québec" },
  "registry.grade_exact": { en: "Exact name match", fr: "Correspondance exacte du nom" },
  "registry.grade_probable": { en: "Probable match", fr: "Correspondance probable" },
  "registry.grade_possible": { en: "Possible match", fr: "Correspondance possible" },
  "registry.registered": { en: "registered {date}", fr: "constituée le {date}" },
  "registry.search": { en: "Search the registry", fr: "Chercher dans le registre" },
  "grant.start": { en: "Start", fr: "Début" },
  "grant.to": { en: "to {end}", fr: "au {end}" },
  "grant.program": { en: "Program and title", fr: "Programme et titre" },
  "grant.department": { en: "Department", fr: "Ministère" },
  "grant.type": { en: "Agreement type", fr: "Type d'accord" },
  "grant.type_G": { en: "Grant", fr: "Subvention" },
  "grant.type_C": { en: "Contribution", fr: "Contribution" },
  "grant.type_O": { en: "Other transfer payment", fr: "Autre paiement de transfert" },
  "grant.amendment": { en: "amendment {n}", fr: "modification {n}" },
  "lobby.subjects": { en: "Subject matters", fr: "Sujets" },
  "lobby.institutions": { en: "Federal institutions", fr: "Institutions fédérales" },
  "lobby.officials": { en: "Public office holders", fr: "Titulaires d'une charge publique" },
  "lobby.registrant": { en: "Registrant", fr: "Déclarant" },

  // -- watchlist (the strings watchlist.js draws come through the page) --------------
  "watch.on": { en: "On your watchlist", fr: "Dans votre liste de suivi" },
  "watch.off": { en: "Add to watchlist", fr: "Ajouter à la liste de suivi" },
  "watch.button_title": { en: "Kept in this browser", fr: "Conservée dans ce navigateur" },
  "watch.full": { en: "Watchlist full ({max})", fr: "Liste de suivi pleine ({max})" },
  "watch.title": { en: "Watchlist", fr: "Liste de suivi" },
  "watch.lead": {
    en: "The organizations you follow, with what is new in their records since your last visit.",
    fr: "Les organisations que vous suivez, avec ce qui est nouveau dans leurs dossiers depuis votre dernière visite.",
  },
  "watch.panel": { en: "Organizations You Follow", fr: "Organisations suivies" },
  "watch.privacy": {
    en: "The list is kept in this browser only. Nothing about it is sent to the site.",
    fr: "La liste est conservée dans ce navigateur seulement. Rien à son sujet n'est transmis au site.",
  },
  "watch.records_note": {
    en: "The counts are the records of each source on the profile.",
    fr: "Les nombres sont les dossiers de chaque source au profil.",
  },
  "watch.limit_note": { en: "Up to {max} organizations.", fr: "Jusqu'à {max} organisations." },
  "watch.empty": {
    en: "No organization yet. Use the Watch button on a profile. The {directory} lists every organization.",
    fr: "Aucune organisation pour l'instant. Utilisez le bouton Suivre d'un profil. Le {directory} présente toutes les organisations.",
  },
  "watch.directory_link": { en: "directory", fr: "répertoire" },
  "watch.noscript": { en: "The watchlist needs JavaScript.", fr: "La liste de suivi nécessite JavaScript." },
  "watch.col_latest": { en: "Latest record", fr: "Dernier dossier" },
  "watch.col_new": { en: "New since last visit", fr: "Depuis la dernière visite" },
  "watch.col_manage": { en: "Manage", fr: "Gérer" },
  "watch.remove": { en: "Remove", fr: "Retirer" },
  "watch.remove_aria": { en: "Remove {name} from the watchlist", fr: "Retirer {name} de la liste de suivi" },
  "watch.loading": { en: "Loading {n} profiles…", fr: "Chargement de {n} profils…" },
  "watch.count_one": { en: "{n} organization.", fr: "{n} organisation." },
  "watch.count_many": { en: "{n} organizations.", fr: "{n} organisations." },
  "watch.last_visit": { en: "Compared with your visit of {date}.", fr: "Comparé à votre visite du {date}." },
  "watch.first_visit": { en: "First visit: changes show from your next one.", fr: "Première visite : les changements s'afficheront à la prochaine." },
  "watch.nothing_new": { en: "Nothing new", fr: "Rien de nouveau" },
  "watch.added_since": { en: "Added since last visit", fr: "Ajoutée depuis la dernière visite" },
  "watch.new_awards_one": { en: "{n} new award notice", fr: "{n} nouvel avis d'attribution" },
  "watch.new_awards_many": { en: "{n} new award notices", fr: "{n} nouveaux avis d'attribution" },
  "watch.new_history_one": { en: "{n} new PSPC contract", fr: "{n} nouveau contrat de SPAC" },
  "watch.new_history_many": { en: "{n} new PSPC contracts", fr: "{n} nouveaux contrats de SPAC" },
  "watch.new_contracts_one": { en: "{n} new published contract", fr: "{n} nouveau contrat publié" },
  "watch.new_contracts_many": { en: "{n} new published contracts", fr: "{n} nouveaux contrats publiés" },
  "watch.new_grants_one": { en: "{n} new grant or contribution", fr: "{n} nouvelle subvention ou contribution" },
  "watch.new_grants_many": { en: "{n} new grants and contributions", fr: "{n} nouvelles subventions et contributions" },
  "watch.new_lobbying_one": { en: "{n} new lobbying communication", fr: "{n} nouvelle communication de lobbying" },
  "watch.new_lobbying_many": { en: "{n} new lobbying communications", fr: "{n} nouvelles communications de lobbying" },
  "watch.missing": { en: "No profile with the ID {id} is published now.", fr: "Aucun profil portant l'identifiant {id} n'est publié actuellement." },
  "watch.load_failed": {
    en: "This profile could not be loaded. Try again later.",
    fr: "Ce profil n'a pas pu être chargé. Réessayez plus tard.",
  },
  "watch.no_storage": {
    en: "This browser does not let the site keep a list (a private window or blocked storage).",
    fr: "Ce navigateur ne permet pas au site de conserver une liste (fenêtre privée ou stockage bloqué).",
  },
  "watch.move_h": { en: "Move the List to Another Browser", fr: "Transférer la liste vers un autre navigateur" },
  "watch.move_text": {
    en: "Make a code for this list and paste it on the watchlist page of another browser.",
    fr: "Créez un code pour cette liste et collez-le dans la page de la liste de suivi d'un autre navigateur.",
  },
  "watch.export": { en: "Make a code", fr: "Créer un code" },
  "watch.export_label": { en: "Code for this list", fr: "Code de cette liste" },
  "watch.export_empty": { en: "The list is empty.", fr: "La liste est vide." },
  "watch.import_label": { en: "Paste a code or profile links", fr: "Collez un code ou des liens de profils" },
  "watch.import": { en: "Add to this list", fr: "Ajouter à cette liste" },
  "watch.import_one": { en: "{n} organization added.", fr: "{n} organisation ajoutée." },
  "watch.import_many": { en: "{n} organizations added.", fr: "{n} organisations ajoutées." },
  "watch.import_known": {
    en: "Every organization in the code is already on the list.",
    fr: "Toutes les organisations du code figurent déjà dans la liste.",
  },
  "watch.import_none": { en: "No organization ID found in the text.", fr: "Aucun identifiant d'organisation trouvé dans le texte." },
  "watch.import_full": {
    en: "The list holds at most {max}. The rest were left out.",
    fr: "La liste en contient au plus {max}. Les autres ont été laissées de côté.",
  },

  // -- buyers ---------------------------------------------------------------------------
  "buyers.title": { en: "Federal Buyers", fr: "Acheteurs fédéraux" },
  "buyers.lead": {
    en: "{n} federal buyers with records in at least one source.",
    fr: "{n} acheteurs fédéraux ayant des dossiers dans au moins une source.",
  },
  "buyers.note": {
    en: "For PSPC contract history the buyer is the client department.",
    fr: "Pour l'historique des contrats de SPAC, l'acheteur est le ministère client.",
  },
  "buyers.panel": { en: "All Buyers", fr: "Tous les acheteurs" },
  "buyers.csv": { en: "Download buyers (CSV)", fr: "Télécharger les acheteurs (CSV)" },
  "buyers.col_open": { en: "Open notices", fr: "Avis ouverts" },
  "buyer.not_found": { en: "Buyer Not Found", fr: "Acheteur introuvable" },
  "buyer.back": { en: "Back to the buyers", fr: "Retour aux acheteurs" },
  "buyer.kind_department": { en: "Federal department", fr: "Ministère fédéral" },
  "buyer.kind_agency": { en: "Federal agency", fr: "Organisme fédéral" },
  "buyer.kind_crown": { en: "Crown corporation", fr: "Société d'État" },
  "buyer.kind_other": { en: "Federal institution", fr: "Institution fédérale" },
  "buyer.open_data": { en: "Its page on open.canada.ca", fr: "Sa page sur ouvert.canada.ca" },
  "buyer.open_one": { en: "{n} open notice", fr: "{n} avis ouvert" },
  "buyer.open_many": { en: "{n} open notices", fr: "{n} avis ouverts" },
  "buyer.col_organizations": { en: "Organizations", fr: "Organisations" },
  // The years a buyer's records span, in the head ("de 2002 à 2026" in French, where a profile's dates read "du ... au").
  "buyer.seen": { en: "Records from {first} to {last}.", fr: "Dossiers de {first} à {last}." },
  "buyer.top": { en: "Largest Values: {source}", fr: "Valeurs les plus élevées : {source}" },
  "buyer.recent_awards": { en: "Newest Award Notices", fr: "Avis d'attribution les plus récents" },
  "buyer.expiring": { en: "Contracts Ending Soon", fr: "Contrats prenant fin bientôt" },
  "buyer.expiring_all": {
    en: "This buyer's contracts in the 12-month list",
    fr: "Les contrats de cet acheteur dans la liste de 12 mois",
  },
  "buyer.description": {
    en: "{name}: open tender notices, contract awards, published contracts and grants by year, and the organizations with the largest values in each source.",
    fr: "{name} : avis d'appel d'offres ouverts, attributions de contrats, contrats publiés et subventions par année, et les organisations aux valeurs les plus élevées dans chaque source.",
  },

  // -- categories ---------------------------------------------------------------------------
  "segments.title": { en: "Procurement by Segment", fr: "Approvisionnement par segment" },
  "segments.lead": {
    en: "The 57 UNSPSC segments, the top level of the commodity codes on every notice.",
    fr: "Les 57 segments de l'UNSPSC, le premier niveau des codes de marchandises de chaque avis.",
  },
  "segments.overlap": {
    en: "A notice or award counts under every segment its codes fall in, so the counts overlap and are not added up.",
    fr: "Un avis ou une attribution compte dans chaque segment où tombent ses codes. Les nombres se chevauchent donc et ne sont pas additionnés.",
  },
  "segments.panel": { en: "UNSPSC Segments", fr: "Segments UNSPSC" },
  "segments.col_open": { en: "Open notices", fr: "Avis ouverts" },
  "segments.col_year": { en: "Award notices in {year}", fr: "Avis d'attribution en {year}" },
  "segments.col_all": { en: "All award notices", fr: "Tous les avis d'attribution" },
  "segment.code": { en: "UNSPSC segment {code}", fr: "Segment UNSPSC {code}" },
  // A chip's accessible name holds its visible text ("86 Education").
  "segment.chip": { en: "UNSPSC segment {code} {name}", fr: "Segment UNSPSC {code} {name}" },
  "segment.all_open": { en: "Filter the open notices ({n})", fr: "Filtrer les avis ouverts ({n})" },
  "segment.open": { en: "Open Notices", fr: "Avis ouverts" },
  "segment.open_none": { en: "No open notice carries a code in this segment.", fr: "Aucun avis ouvert ne porte de code dans ce segment." },
  "segment.top": { en: "Organizations by Award Value", fr: "Organisations par valeur attribuée" },
  "segment.top_note": {
    en: "Award notices with a code in this segment, by the value on each notice's newest amendment.",
    fr: "Avis d'attribution portant un code de ce segment, selon la valeur de la plus récente modification de chaque avis.",
  },
  "segment.top_years": { en: "All years, {first} to {last}.", fr: "Toutes les années, de {first} à {last}." },
  "segment.years": { en: "Award Notices by Year", fr: "Avis d'attribution par année" },
  // The segment page's head: its open notices and the data year's award notices.
  "segment.lead_open_one": { en: "{n} open notice.", fr: "{n} avis ouvert." },
  "segment.lead_open_many": { en: "{n} open notices.", fr: "{n} avis ouverts." },
  "segment.lead_awards_one": { en: "{n} award notice worth {total} in {year}.", fr: "{n} avis d'attribution d'une valeur de {total} en {year}." },
  "segment.lead_awards_many": { en: "{n} award notices worth {total} in {year}.", fr: "{n} avis d'attribution d'une valeur totale de {total} en {year}." },
  "segment.lead_awards_none": { en: "No award notice in {year} yet.", fr: "Aucun avis d'attribution en {year} pour l'instant." },
  "segment.open_first": { en: "The {n} closing soonest.", fr: "Les {n} dont la clôture est la plus proche." },
  "segment.expiring": { en: "Contracts ending in this segment ({n})", fr: "Contrats prenant fin dans ce segment ({n})" },
  "segment.not_found": { en: "Segment Not Found", fr: "Segment introuvable" },
  "segment.back": { en: "Back to the segments", fr: "Retour aux segments" },
  "segment.description": {
    en: "UNSPSC segment {code}, {name}: {n} open tender notices, the organizations with the largest award values, and award notices by year.",
    fr: "Segment UNSPSC {code}, {name} : {n} avis d'appel d'offres ouverts, les organisations aux valeurs attribuées les plus élevées et les avis d'attribution par année.",
  },

  // -- rankings -------------------------------------------------------------------------------
  "rankings.title": { en: "Rankings", fr: "Classements" },
  "rankings.title_year": { en: "Rankings for {year}", fr: "Classements de {year}" },
  "rankings.lead": {
    en: "The organizations with the largest values and the most records in each source, one source at a time.",
    fr: "Les organisations aux valeurs les plus élevées et aux dossiers les plus nombreux dans chaque source, une source à la fois.",
  },
  "rankings.note": {
    en: "A ranking orders records by size and makes no claim about them.",
    fr: "Un classement ordonne des dossiers selon leur taille et n'affirme rien à leur sujet.",
  },
  "rankings.years": { en: "Years", fr: "Années" },
  "rankings.all_years": { en: "All years", fr: "Toutes les années" },
  "rankings.show": { en: "Show", fr: "Afficher" },
  "rankings.sources": { en: "Rank by source", fr: "Classer par source" },
  "rankings.measure": { en: "Measure", fr: "Mesure" },
  "rankings.by_value": { en: "By value", fr: "En valeur" },
  "rankings.by_count": { en: "By number of records", fr: "En nombre de dossiers" },
  "rankings.heading_value": { en: "{source}: Largest Values", fr: "{source} : valeurs les plus élevées" },
  "rankings.heading_count": { en: "{source}: Most Records", fr: "{source} : dossiers les plus nombreux" },
  "rankings.none": { en: "No ranking published for this source.", fr: "Aucun classement publié pour cette source." },
  "rankings.buyers": { en: "{source}: Buyers by Value", fr: "{source} : acheteurs par valeur" },
  "rankings.year_not_found": { en: "No Rankings for This Year", fr: "Aucun classement pour cette année" },
  "rankings.back": { en: "Back to the rankings", fr: "Retour aux classements" },
  "rankings.description_year": {
    en: "The organizations with the largest values and the most records in each federal source in {year}, and the buyers with the largest totals.",
    fr: "Les organisations aux valeurs les plus élevées et aux dossiers les plus nombreux dans chaque source fédérale en {year}, et les acheteurs aux totaux les plus élevés.",
  },

  // -- directory ------------------------------------------------------------------------------
  "directory.index_title": { en: "Organizations", fr: "Organisations" },
  "directory.index_lead": {
    en: "Find an organization by name or business number with the search field at the top of every page, or browse A to Z by province below.",
    fr: "Trouvez une organisation par son nom ou son numéro d'entreprise avec le champ de recherche en haut de chaque page, ou parcourez-les de A à Z par province ci-dessous.",
  },
  "directory.index_note": {
    en: "An organization is listed under the province it is recorded in most often.",
    fr: "Une organisation est classée sous la province où elle figure le plus souvent.",
  },
  "directory.col_place": { en: "Province or territory", fr: "Province ou territoire" },
  "directory.panel": { en: "Organizations by Province", fr: "Organisations par province" },
  "directory.col_organizations": { en: "Organizations", fr: "Organisations" },
  "directory.col_last_seen": { en: "Latest record", fr: "Dernier dossier" },
  "directory.to_rankings": { en: "Organizations ranked by source", fr: "Organisations classées par source" },
  "directory.to_buyers": { en: "Federal buyers", fr: "Acheteurs fédéraux" },
  "directory.csv": { en: "Download organizations (CSV)", fr: "Télécharger les organisations (CSV)" },
  "directory.name_xx": { en: "Outside Canada", fr: "Hors du Canada" },
  "directory.name_un": { en: "No address recorded", fr: "Aucune adresse au dossier" },
  "directory.heading": { en: "Organizations A to Z: {place}", fr: "Organisations de A à Z : {place}" },
  "directory.title_paged": { en: "{heading}, Page {n} of {pages}", fr: "{heading}, page {n} sur {pages}" },
  "directory.description": {
    en: "Organizations on record, {place}, from {first} to {last}, each linked to its profile of federal records.",
    fr: "Organisations au dossier, {place}, de {first} à {last}, chacune liée à son profil de dossiers fédéraux.",
  },
  "directory.none": { en: "No organization is listed here yet ({place}).", fr: "Aucune organisation n'est encore classée dans cette liste ({place})." },
  "directory.not_found": { en: "Directory Page Not Found", fr: "Page du répertoire introuvable" },
  "directory.back": { en: "Back to the first page", fr: "Retour à la première page" },
  "directory.lead_one": { en: "{n} organization, {size} to a page.", fr: "{n} organisation, {size} par page." },
  "directory.lead_many": { en: "{n} organizations, {size} to a page.", fr: "{n} organisations, {size} par page." },
  "directory.records_note": {
    en: "The records column counts the organization's records in every source.",
    fr: "La colonne des dossiers compte les dossiers de l'organisation dans toutes les sources.",
  },
  "directory.letters": { en: "Initials", fr: "Initiales" },
  "directory.range": { en: "This page: {first} to {last}", fr: "Cette page : de {first} à {last}" },
  "directory.pages": { en: "All Pages", fr: "Toutes les pages" },

  // -- search (the top bar's field and /search) ------------------------------------------------
  "search.placeholder": { en: "Organization or buyer", fr: "Organisation ou acheteur" },
  "search.label": {
    en: "Search organizations and buyers by name or business number",
    fr: "Rechercher des organisations et des acheteurs par nom ou par numéro d'entreprise",
  },
  "search.submit": { en: "Search", fr: "Rechercher" },
  "search.title": { en: "Search Organizations and Buyers", fr: "Rechercher des organisations et des acheteurs" },
  "search.title_q": { en: "Search: {q}", fr: "Recherche : {q}" },
  "search.description": {
    en: "Find an organization by any name on its federal records or by its business number, and a federal buyer by its name or acronym.",
    fr: "Trouver une organisation par tout nom qui figure à ses dossiers fédéraux ou par son numéro d'entreprise, et un acheteur fédéral par son nom ou son sigle.",
  },
  "search.empty_lead": {
    en: "Type an organization's name, any spelling found on its records or its business number, or a federal buyer's name or acronym, in English or French.",
    fr: "Entrez le nom d'une organisation, toute graphie qui figure à ses dossiers ou son numéro d'entreprise, ou le nom ou le sigle d'un acheteur fédéral, en français ou en anglais.",
  },
  "search.no_terms": { en: "A search needs at least one letter or digit.", fr: "Une recherche doit contenir au moins une lettre ou un chiffre." },
  "search.what": {
    en: "Searched: organization names and every other spelling on their records, business numbers, and buyer names in English and French with their acronyms. The records themselves (titles, descriptions) are not searched. The last word also matches the start of a longer word. The names that hold the words come first, those with the most records first; matches through another spelling or a business number follow.",
    fr: "Recherche dans : les noms des organisations et toutes les autres graphies de leurs dossiers, les numéros d'entreprise, et les noms des acheteurs en français et en anglais avec leurs sigles. Les dossiers eux-mêmes (titres, descriptions) ne sont pas cherchés. Le dernier mot trouve aussi le début d'un mot plus long. Les noms qui contiennent les mots viennent d'abord, ceux qui comptent le plus de dossiers en tête; suivent les correspondances par une autre graphie ou un numéro d'entreprise.",
  },
  "search.lead": { en: "{orgs} and {buyers} match.", fr: "{orgs} et {buyers} correspondent." },
  "search.orgs_one": { en: "{n} organization", fr: "{n} organisation" },
  "search.orgs_many": { en: "{n} organizations", fr: "{n} organisations" },
  "search.buyers_one": { en: "{n} buyer", fr: "{n} acheteur" },
  "search.buyers_many": { en: "{n} buyers", fr: "{n} acheteurs" },
  "search.none": { en: "No organization or buyer name matches “{q}”.", fr: "Aucun nom d'organisation ou d'acheteur ne correspond à « {q} »." },
  "search.none_hint": {
    en: "Check the spelling or try fewer words, or browse the {directory} and the {buyers}.",
    fr: "Vérifiez l'orthographe ou essayez moins de mots, ou parcourez le {directory} et la {buyers}.",
  },
  "search.buyers_link": { en: "list of federal buyers", fr: "liste des acheteurs fédéraux" },
  "search.unavailable": { en: "Search Is Unavailable", fr: "Recherche indisponible" },
  "search.unavailable_text": {
    en: "The search database did not answer. Try again in a few minutes, or find an organization in the {directory} and a buyer in the {buyers}.",
    fr: "La base de données de recherche n'a pas répondu. Réessayez dans quelques minutes, ou trouvez une organisation dans le {directory} et un acheteur dans la {buyers}.",
  },
  "search.range": { en: "{from} to {to} of {total}", fr: "{from} à {to} sur {total}" },
  "search.col_lobbying": { en: "Lobbying", fr: "Lobbyisme" },
  "search.open_notices": {
    en: "Open notices with these words in the title: {n}",
    fr: "Avis ouverts dont le titre contient ces mots : {n}",
  },
  "search.no_orgs": { en: "No organization name matches.", fr: "Aucun nom d'organisation ne correspond." },
  "search.buyers_shown": { en: "The {n} closest of {total}", fr: "Les {n} plus proches sur {total}" },
  "search.buyers_narrow": { en: "Add a word to narrow the list of buyers.", fr: "Ajoutez un mot pour réduire la liste des acheteurs." },
  "search.buyers_first_page": { en: "Matching buyers are listed on the first page.", fr: "Les acheteurs qui correspondent figurent sur la première page." },
  "search.page_cap": {
    en: "The first {n} organizations are listed; add a word to narrow the list.",
    fr: "Les {n} premières organisations sont listées; ajoutez un mot pour réduire la liste.",
  },

  // -- feeds ------------------------------------------------------------------------------------
  "feeds.title": { en: "Atom Feeds", fr: "Fils Atom" },
  "feeds.lead": {
    en: "Feeds of new tender notices and new award notices, each holding the {n} newest entries. When a night adds more, the rest of that night follows on linked pages (RFC 5005).",
    fr: "Fils des nouveaux avis d'appel d'offres et d'attribution, chacun contenant les {n} entrées les plus récentes. Lorsqu'une nuit en ajoute davantage, le reste de cette nuit suit sur des pages liées (RFC 5005).",
  },
  "feeds.lead_expiring": {
    en: "Feeds of new tender notices, new award notices and contracts ending within 3 months, each holding the {n} newest entries. When a night adds more, the rest of that night follows on linked pages (RFC 5005).",
    fr: "Fils des nouveaux avis d'appel d'offres et d'attribution et des contrats prenant fin d'ici 3 mois, chacun contenant les {n} entrées les plus récentes. Lorsqu'une nuit en ajoute davantage, le reste de cette nuit suit sur des pages liées (RFC 5005).",
  },
  "feeds.privacy": {
    en: "A feed reader polls the file. The site counts polls and keeps no address.",
    fr: "Un lecteur de fils interroge le fichier. Le site compte les interrogations et ne conserve aucune adresse.",
  },
  "feeds.toc_kinds": { en: "What the Feeds Carry", fr: "Contenu des fils" },
  "feeds.toc_canada": { en: "All of Canada", fr: "Tout le Canada" },
  "feeds.toc_segment": { en: "By Segment", fr: "Par segment" },
  "feeds.toc_prov": { en: "By Province", fr: "Par province" },
  "feeds.toc_buyer": { en: "By Buyer", fr: "Par acheteur" },
  "feeds.toc_subscribe": { en: "How to Subscribe", fr: "Comment s'abonner" },
  "feeds.ev.tenders": { en: "New tender notices", fr: "Nouveaux avis d'appel d'offres" },
  "feeds.ev.awards": { en: "New award notices", fr: "Nouveaux avis d'attribution" },
  "feeds.ev.expiring": { en: "Contracts ending within 3 months", fr: "Contrats prenant fin d'ici 3 mois" },
  "feeds.about.tenders": {
    en: "notices first seen in the nightly refresh, with the buyer, the closing date and a link to the notice.",
    fr: "avis vus pour la première fois à la mise à jour de nuit, avec l'acheteur, la date de clôture et un lien vers l'avis.",
  },
  "feeds.about.awards": {
    en: "award notices first seen in the nightly refresh, with the supplier, the buyer, the value and a link to the notice.",
    fr: "avis d'attribution vus pour la première fois à la mise à jour de nuit, avec le fournisseur, l'acheteur, la valeur et un lien vers l'avis.",
  },
  "feeds.about.expiring": {
    en: "contracts whose end date came within 3 months of the data date since the previous run, so each appears once, about 90 days before it ends.",
    fr: "contrats dont la date de fin est entrée dans les 3 mois suivant la date des données depuis l'exécution précédente; chacun paraît donc une seule fois, environ 90 jours avant sa fin.",
  },
  "feeds.link_title": { en: "{event} (Atom feed)", fr: "{event} (fil Atom)" },
  "feeds.button_tenders": { en: "Atom feed of new notices", fr: "Fil Atom des nouveaux avis" },
  "feeds.button_awards": { en: "Atom feed of new award notices", fr: "Fil Atom des nouveaux avis d'attribution" },
  "feeds.button_all": { en: "Atom feeds", fr: "Fils Atom" },
  "feeds.col_feed": { en: "Feed", fr: "Fil" },
  "feeds.col_address": { en: "Address", fr: "Adresse" },
  "feeds.pattern": { en: "Each address follows the pattern {pattern}.", fr: "Chaque adresse suit le modèle {pattern}." },
  "feeds.none_yet": { en: "The feed list is not published yet.", fr: "La liste des fils n'est pas encore publiée." },
  "feeds.none_scope": { en: "No feed of this kind yet.", fr: "Aucun fil de ce type pour l'instant." },
  "feeds.segments_show": { en: "Show all {n} segments", fr: "Afficher les {n} segments" },
  "feeds.cell_aria": { en: "{scope}: {event}", fr: "{scope} : {event}" },
  "feeds.sub_reader": {
    en: "Paste an address into a feed reader such as Feedly or Thunderbird. It checks the feed and lists each new item.",
    fr: "Collez une adresse dans un lecteur de fils comme Feedly ou Thunderbird. Il consulte le fil et affiche chaque nouvel élément.",
  },
  "feeds.sub_browser": {
    en: "A browser shows a feed address as code. A feed reader shows the same address as a list of entries.",
    fr: "Un navigateur affiche l'adresse d'un fil sous forme de code. Un lecteur de fils affiche la même adresse sous forme de liste.",
  },
  "feeds.paste_note": {
    en: "Paste an address into a feed reader; a browser shows it as code.",
    fr: "Collez une adresse dans un lecteur de fils; un navigateur l'affiche sous forme de code.",
  },
  "feeds.sub_slack": { en: "In Slack, type {command} followed by the address.", fr: "Dans Slack, tapez {command} suivi de l'adresse." },
  "feeds.sub_email": {
    en: "Feed-to-email services send each new entry as a message.",
    fr: "Les services de fil vers courriel envoient chaque nouvelle entrée par message.",
  },
  "feeds.watch_note": { en: "To follow particular organizations, use the {watchlist}.", fr: "Pour suivre des organisations précises, utilisez la {watchlist}." },
  "feeds.watch_link": { en: "watchlist", fr: "liste de suivi" },

  // -- data, downloads and licence ----------------------------------------------------------
  "data.title": { en: "Data, Downloads and Licence", fr: "Données, téléchargements et licence" },
  "data.lead": {
    en: "The open-data files the site reads, when each was last read, the files you can download, the read-only API and the terms of reuse.",
    fr: "Les fichiers de données ouvertes que lit le site, leur dernière lecture, les fichiers à télécharger, l'API en lecture seule et les conditions de réutilisation.",
  },
  "data.toc_sources": { en: "Sources Read", fr: "Sources lues" },
  "data.toc_downloads": { en: "Downloads", fr: "Téléchargements" },
  "data.toc_api": { en: "Read-only API", fr: "API en lecture seule" },
  "data.toc_licence": { en: "Licence and Attribution", fr: "Licence et attribution" },
  "data.toc_runs": { en: "Last Runs", fr: "Dernières exécutions" },
  "data.toc_changes": { en: "Changes to Methods", fr: "Changements de méthode" },
  "data.toc_views": { en: "Counting Visits", fr: "Comptage des visites" },
  "data.views_note": {
    en: "The site counts the pages it serves in aggregate, on its own server. For each response it keeps the kind of page, the language, the country reported by Cloudflare's network, the name of the referring website and the response status. It also keeps whether the request came from a crawler or from a person's browser, and the type of device (computer, phone or tablet) the browser reports. When a feed reader fetches a feed and states how many people it fetches it for, that number is kept as well. To count how many people visit each day without keeping their addresses, a request from a browser also gets a visitor code. The IP address and the browser's identification are hashed (SHA-256) with a key that changes every day (UTC). The key is derived from a secret only the site's server holds, and the result is cut to 16 characters. The address and the browser's identification are then dropped. The same browser gets a different code the next day, and without the site's secret no one can work out a code from an address. The codes are deleted after 3 months with the rest of the raw counts. The daily record keeps only how many there were. The site sets no cookie for this, runs no tracking script in the browser, and keeps no IP address.",
    fr: "Le site compte de façon agrégée les pages qu'il sert, sur son propre serveur. Pour chaque réponse, il conserve le type de page, la langue, le pays indiqué par le réseau de Cloudflare, le nom du site d'où vient le visiteur et le statut de la réponse. Il conserve aussi si la requête vient d'un robot d'indexation ou du navigateur d'une personne, et le type d'appareil (ordinateur, téléphone ou tablette) qu'indique le navigateur. Lorsqu'un lecteur de fils télécharge un fil et indique pour combien de personnes il le fait, ce nombre est aussi conservé. Pour compter combien de personnes viennent chaque jour sans conserver leur adresse, une requête venant d'un navigateur reçoit aussi un code de visiteur. L'adresse IP et l'identification du navigateur sont hachées (SHA-256) avec une clé qui change chaque jour (UTC). La clé est dérivée d'un secret que seul le serveur du site détient, et le résultat est réduit à 16 caractères. L'adresse et l'identification du navigateur sont ensuite écartées. Le même navigateur reçoit un code différent le lendemain, et sans le secret du site personne ne peut retrouver un code à partir d'une adresse. Les codes sont supprimés après 3 mois avec les autres comptes bruts. Le relevé quotidien ne garde que leur nombre. Le site ne dépose aucun témoin à cette fin, n'exécute aucun script de suivi dans le navigateur et ne conserve aucune adresse IP.",
  },
  "data.sources_text": {
    en: "Every source is a bulk file on a government open-data host, downloaded nightly, or less often when the publisher updates it less often. No page is scraped.",
    fr: "Chaque source est un fichier en vrac hébergé sur un portail de données ouvertes du gouvernement, téléchargé chaque nuit, ou moins souvent si l'éditeur le met à jour moins souvent. Aucune page n'est moissonnée.",
  },
  "data.col_source": { en: "Dataset", fr: "Jeu de données" },
  "data.col_publisher": { en: "Publisher", fr: "Éditeur" },
  "data.col_files": { en: "Files", fr: "Fichiers" },
  "data.col_size": { en: "Size", fr: "Taille" },
  "data.col_rows": { en: "Rows", fr: "Lignes" },
  "data.col_publisher_date": { en: "Publisher's date", fr: "Date de l'éditeur" },
  "data.size_b": { en: "{n} B", fr: "{n} o" },
  "data.size_kb": { en: "{n} KB", fr: "{n} Ko" },
  "data.size_mb": { en: "{n} MB", fr: "{n} Mo" },
  "data.size_gb": { en: "{n} GB", fr: "{n} Go" },
  "data.size_rows": { en: "{size}, {n} rows", fr: "{size}, {n} lignes" },
  "data.sizes_note": {
    en: "Sizes and rows as of the last export. Rows are the records under the header row; for SHA256SUMS, the files it lists.",
    fr: "Tailles et lignes à la dernière exportation. Les lignes sont les dossiers sous la ligne d'en-tête; pour SHA256SUMS, les fichiers qu'il énumère.",
  },
  "data.files_read": { en: "Files Read", fr: "Fichiers lus" },
  "data.sources_runs": {
    en: "Last read is the newest read of any of the source's files, with the publisher's newest date. Each file's own read is under {runs}.",
    fr: "La dernière lecture est la plus récente lecture d'un fichier de la source, avec la date la plus récente de l'éditeur. La lecture de chaque fichier figure sous {runs}.",
  },
  "data.col_last_read": { en: "Last read", fr: "Dernière lecture" },
  "data.not_read": { en: "Not read yet", fr: "Pas encore lu" },
  "data.modified": { en: "(publisher's date {date})", fr: "(date de l'éditeur : {date})" },
  "data.ogl": { en: "Open Government Licence, Canada", fr: "Licence du gouvernement ouvert, Canada" },
  "data.pub.pspc": { en: "Public Services and Procurement Canada", fr: "Services publics et Approvisionnement Canada" },
  "data.pub.tbs": { en: "Treasury Board of Canada Secretariat", fr: "Secrétariat du Conseil du Trésor du Canada" },
  "data.pub.ocl": { en: "Office of the Commissioner of Lobbying", fr: "Commissariat au lobbying" },
  "data.pub.ised": { en: "Innovation, Science and Economic Development Canada", fr: "Innovation, Sciences et Développement économique Canada" },
  "data.src.buyers": { en: "Federal organizations on open.canada.ca", fr: "Organisations fédérales sur ouvert.canada.ca" },
  "data.src.tenders": { en: "CanadaBuys tender notices", fr: "Avis d'appel d'offres d'AchatsCanada" },
  "data.src.awards": { en: "CanadaBuys award notices", fr: "Avis d'attribution d'AchatsCanada" },
  "data.src.history": { en: "PSPC contract history (CanadaBuys)", fr: "Historique des contrats de SPAC (AchatsCanada)" },
  "data.src.contracts": { en: "Proactive publication of contracts over $10,000", fr: "Divulgation proactive des contrats de plus de 10 000 $" },
  "data.src.grants": { en: "Proactive publication of grants and contributions", fr: "Divulgation proactive des subventions et contributions" },
  "data.src.lobbying": { en: "Registry of Lobbyists, communication reports", fr: "Registre des lobbyistes, rapports de communication" },
  "data.src.registry": {
    en: "Federal corporations (Canada Business Corporations Act)",
    fr: "Sociétés fédérales (Loi canadienne sur les sociétés par actions)",
  },
  "data.downloads_text": {
    en: "CSV files rebuilt nightly from the site's database, in UTF-8 with a header row.",
    fr: "Fichiers CSV reconstruits chaque nuit à partir de la base de données du site, en UTF-8 avec une ligne d'en-tête.",
  },
  "data.col_file": { en: "File", fr: "Fichier" },
  "data.col_contents": { en: "Contents", fr: "Contenu" },
  "data.file.open_tenders": { en: "Every open tender notice, list fields", fr: "Tous les avis d'appel d'offres ouverts, champs de liste" },
  "data.file.organizations": {
    en: "Every organization with its counts and totals per source",
    fr: "Toutes les organisations avec leurs nombres et totaux par source",
  },
  "data.file.buyers": { en: "Every buyer with its counts and totals per source", fr: "Tous les acheteurs avec leurs nombres et totaux par source" },
  "data.file.expiring_3m": {
    en: "Every contract ending within 3 months of the data date, in the 12-month file's columns",
    fr: "Tous les contrats prenant fin dans les 3 mois suivant la date des données, avec les colonnes du fichier de 12 mois",
  },
  "data.file.expiring": {
    en: "Every contract ending within 12 months of the data date, one row each, listed once across sources",
    fr: "Tous les contrats prenant fin dans les 12 mois suivant la date des données, une ligne chacun, une seule fois toutes sources confondues",
  },
  // Beside the 12-month file on the Data page: it is part of Pro from the
  // accounts switch (index.tsx). No price is named.
  "data.file.pro": { en: "Part of Pro.", fr: "Fait partie de Pro." },
  "data.file.sums": { en: "SHA-256 checksums of the files above", fr: "Sommes de contrôle SHA-256 des fichiers ci-dessus" },
  "data.yearly_awards": { en: "Award Notices by Year of Award", fr: "Avis d'attribution par année d'attribution" },
  "data.yearly_history": { en: "PSPC Contract History by Year of Award", fr: "Historique des contrats de SPAC par année d'attribution" },
  "data.yearly_outside": { en: "Dates Outside the Years Above", fr: "Dates hors des années ci-dessus" },
  "data.downloads_note": {
    en: "A year with no file yet answers \"not available\". Dates before a source's first year and after the data date's year share one file each: on award notices and the contract history they are typing errors in the source, and on published contracts and grants they are records reported later. A file ending in {undated} holds the rows whose date gives no year, and a year past 250 MB goes on in numbered parts ({parts}). The files hold one row per version as published, so adding them up counts a contract once per amendment; the site's totals follow the counting rules on the Methodology page.",
    fr: "Une année sans fichier répond « non disponible ». Les dates antérieures à la première année d'une source et postérieures à l'année de la date des données partagent un fichier chacune : sur les avis d'attribution et l'historique des contrats, ce sont des erreurs de saisie de la source, et sur les contrats publiés et les subventions, des dossiers déclarés plus tard. Un fichier se terminant par {undated} contient les lignes dont la date ne donne aucune année, et une année de plus de 250 Mo se poursuit en parties numérotées ({parts}). Les fichiers comptent une ligne par version telle que publiée : en les additionnant, un contrat compte une fois par modification; les totaux du site suivent les règles de calcul de la page Méthodologie.",
  },
  "data.api_text": {
    en: "Read-only JSON: the same files the pages read. No key is needed. The data changes nightly, so responses may be cached for 5 minutes.",
    fr: "Du JSON en lecture seule : les mêmes fichiers que lisent les pages. Aucune clé n'est requise. Les données changent chaque nuit. Les réponses peuvent donc être mises en cache 5 minutes.",
  },
  "data.col_endpoint": { en: "Endpoint", fr: "Point d'accès" },
  "data.api.stats": {
    en: "Counts, the newest notices and awards, and the last runs",
    fr: "Nombres, avis et attributions les plus récents, et dernières exécutions",
  },
  "data.api.organization": { en: "One organization's profile", fr: "Le profil d'une organisation" },
  "data.api.tender": { en: "One tender notice with its amendments", fr: "Un avis d'appel d'offres avec ses modifications" },
  "data.api.buyer": { en: "One buyer's yearly figures and top organizations", fr: "Les chiffres annuels et les principales organisations d'un acheteur" },
  "data.api.category": { en: "One UNSPSC segment", fr: "Un segment UNSPSC" },
  "data.api.open": { en: "Every open notice, list fields (a static file)", fr: "Tous les avis ouverts, champs de liste (fichier statique)" },
  "data.api_limits": {
    en: "Each address may make 60 API requests a minute. Bulk use should start from the CSV files.",
    fr: "Chaque adresse peut faire 60 requêtes à l'API par minute. Un usage en vrac devrait partir des fichiers CSV.",
  },
  // While the accounts switch is on: the 12-month file's note and the line on keys, each with the Pro chip.
  "data.file.pro_on": { en: "Part of Pro. The 3-month file is free.", fr: "Fait partie de Pro. Le fichier de 3 mois est gratuit." },
  "data.api_keys": {
    en: "{keys} come with Pro and open the keyed API below.",
    fr: "Les {keys} sont offertes avec le forfait Pro et ouvrent l'API avec clé ci-dessous.",
  },
  "data.api_keys_link": { en: "API keys", fr: "clés d'API" },
  "data.licence_text": {
    en: "Every source but the Registry of Lobbyists is published under the {ogl}, and so are the site's files. Reuse them freely with the attribution below. The registry's reports come under the Commissioner of Lobbying's own {odla}, which the site follows.",
    fr: "Chaque source, sauf le Registre des lobbyistes, est publiée sous la {ogl}, tout comme les fichiers du site. Réutilisez-les librement avec la mention ci-dessous. Les rapports du registre relèvent de l'{odla} du commissaire au lobbying, que le site suit.",
  },
  "data.odla": {
    en: "Open Data Licence Agreement",
    fr: "Accord de licence de données ouvertes",
  },
  "data.col_material": { en: "Material", fr: "Contenu" },
  "data.col_terms": { en: "Terms", fr: "Conditions" },
  "data.lic.canadabuys": {
    en: "CanadaBuys tender notices, award notices and contract history",
    fr: "Avis d'appel d'offres, avis d'attribution et historique des contrats d'AchatsCanada",
  },
  "data.lic.proactive": {
    en: "Proactive publication of contracts and of grants and contributions",
    fr: "Divulgation proactive des contrats et des subventions et contributions",
  },
  "data.lic.lobbying": { en: "Registry of Lobbyists communication reports", fr: "Rapports de communication du Registre des lobbyistes" },
  "data.lic.organizations": {
    en: "Federal organization names and acronyms (open.canada.ca)",
    fr: "Noms et sigles des organisations fédérales (ouvert.canada.ca)",
  },
  "data.lic.corporations": { en: "Corporations Canada federal corporations extract", fr: "Extrait des sociétés fédérales de Corporations Canada" },
  "data.lic.computed": {
    en: "The site's merged organizations, buyer mapping, totals and rankings",
    fr: "Les organisations fusionnées, l'association des acheteurs, les totaux et les classements du site",
  },
  "data.lic.ogl_terms": { en: "Open Government Licence, Canada", fr: "Licence du gouvernement ouvert, Canada" },
  "data.lic.odla_terms": {
    en: "Open Data Licence Agreement, Office of the Commissioner of Lobbying",
    fr: "Accord de licence de données ouvertes, Commissariat au lobbying",
  },
  "data.lic.computed_terms": {
    en: "Open Government Licence, Canada, as information derived from the sources",
    fr: "Licence du gouvernement ouvert, Canada, à titre d'information dérivée des sources",
  },
  "data.credit": {
    en: "Contains information licensed under the Open Government Licence, Canada.",
    fr: "Contient des informations visées par la Licence du gouvernement ouvert, Canada.",
  },
  "data.col_run": { en: "Run", fr: "Exécution" },
  "data.col_stage": { en: "Stage", fr: "Étape" },
  "data.col_new_rows": { en: "New records", fr: "Nouveaux dossiers" },
  "data.run_ok": { en: "Completed", fr: "Terminée" },
  "data.run_failed": { en: "Did not complete", fr: "Non terminée" },
  "data.runs_none": { en: "No run recorded yet.", fr: "Aucune exécution consignée pour l'instant." },
  "data.run_time": { en: "{date} {hh}:{mm} UTC", fr: "{date} {hh} h {mm} UTC" },
  "data.changes_text": {
    en: "Any change to how a figure is computed is listed here with its date and what was recomputed.",
    fr: "Tout changement à la façon de calculer un chiffre est inscrit ici, avec sa date et ce qui a été recalculé.",
  },
  "data.changes_none": { en: "No change since launch.", fr: "Aucun changement depuis le lancement." },
  "data.col_change": { en: "Change", fr: "Changement" },
  "data.col_recomputed": { en: "Recomputed", fr: "Recalculé" },

  // -- methodology: the identity and counting rules in the words of the project guide ----
  "methodology.title": { en: "Methodology", fr: "Méthodologie" },
  "methodology.lead": {
    en: "How the site reads each source, which records it merges, how it adds money up, and what it does not claim.",
    fr: "Comment le site lit chaque source, quels dossiers il fusionne, comment il additionne les montants, et ce qu'il n'affirme pas.",
  },
  "methodology.toc_sources": { en: "The Sources", fr: "Les sources" },
  "methodology.toc_organizations": { en: "Organizations", fr: "Organisations" },
  "methodology.toc_buyers": { en: "Buyers", fr: "Acheteurs" },
  "methodology.toc_counting": { en: "Counting Money", fr: "Calcul des montants" },
  "methodology.toc_competitive": { en: "Competitive or Not", fr: "Concurrentiel ou non" },
  "methodology.toc_statuses": { en: "Statuses and Regions", fr: "Statuts et régions" },
  "methodology.toc_expiring": { en: "Contracts Ending Soon", fr: "Contrats prenant fin bientôt" },
  "methodology.toc_analytics": { en: "Analytics", fr: "Analyses" },
  "methodology.toc_people": { en: "People", fr: "Personnes" },
  "methodology.toc_claims": { en: "What the Site Does Not Claim", fr: "Ce que le site n'affirme pas" },
  "methodology.toc_corrections": { en: "Corrections and Responses", fr: "Corrections et réponses" },
  "methodology.sources_text": { en: "Each source is read from the bulk file its publisher posts:", fr: "Chaque source est lue dans le fichier en vrac que publie son éditeur :" },
  "methodology.src_tenders": {
    en: "CanadaBuys tender notices: every open notice nightly, and every notice since 2022-08-08 once a week.",
    fr: "Avis d'appel d'offres d'AchatsCanada : chaque avis ouvert chaque nuit, et chaque avis depuis le 2022-08-08 une fois par semaine.",
  },
  "methodology.src_awards": {
    en: "CanadaBuys award notices: the current fiscal year nightly, the complete file weekly, and the 2012 to 2022 historical file once.",
    fr: "Avis d'attribution d'AchatsCanada : l'exercice en cours chaque nuit, le fichier complet chaque semaine, et le fichier historique de 2012 à 2022 une fois.",
  },
  "methodology.src_history": {
    en: "PSPC contract history (CanadaBuys): contracts awarded by Public Services and Procurement Canada for client departments since 2009, read when the monthly file changes.",
    fr: "Historique des contrats de SPAC (AchatsCanada) : contrats attribués par Services publics et Approvisionnement Canada pour des ministères clients depuis 2009, lus quand le fichier mensuel change.",
  },
  "methodology.src_contracts": {
    en: "Proactive publication of contracts over $10,000: every record every department reports, read weekly.",
    fr: "Divulgation proactive des contrats de plus de 10 000 $ : chaque dossier déclaré par chaque ministère, lu chaque semaine.",
  },
  "methodology.src_grants": {
    en: "Proactive publication of grants and contributions: every agreement with an organization, read weekly.",
    fr: "Divulgation proactive des subventions et contributions : chaque accord conclu avec une organisation, lu chaque semaine.",
  },
  "methodology.src_lobbying": {
    en: "Registry of Lobbyists: the monthly communication reports, read weekly from the registry's export or, while its host refuses the pipeline, from a copy of that export (the operator's download, refreshed monthly, or the Internet Archive's newest capture), under the registry's open data licence.",
    fr: "Registre des lobbyistes : les rapports mensuels de communication, lus chaque semaine à partir de l'exportation du registre ou, lorsque son hôte refuse le pipeline, d'une copie de cette exportation (le téléchargement de l'exploitant, renouvelé chaque mois, ou la plus récente capture d'Internet Archive), sous la licence de données ouvertes du registre.",
  },
  "methodology.src_registry": {
    en: "Corporations Canada: the federal corporations extract, read weekly and matched to organizations by name.",
    fr: "Corporations Canada : l'extrait des sociétés fédérales, lu chaque semaine et apparié aux organisations par le nom.",
  },
  "methodology.sources_more": { en: "The {data} page lists each file and when it was last read.", fr: "La page {data} présente chaque fichier et sa dernière lecture." },
  "methodology.org_text": {
    en: "Every supplier, grant recipient and lobbying client becomes one organization per normalized legal name, across every source:",
    fr: "Chaque fournisseur, bénéficiaire de subvention et client de lobbying devient une organisation par nom légal normalisé, toutes sources confondues :",
  },
  "methodology.org_rule_name": {
    en: "The name is normalized. A trade name after \"o/a\" or \"doing business as\" is split off, accents are folded, and punctuation and connectors (and, et, &) are dropped. Numbered-company jurisdictions are written one way, and legal suffixes (Inc., Ltd., Ltée) are removed.",
    fr: "Le nom est normalisé. Une dénomination commerciale après « s/n » ou « faisant affaire sous » est séparée, les accents sont retirés, et la ponctuation et les connecteurs (and, et, &) sont supprimés. Les juridictions des sociétés à numéro sont écrites d'une seule façon, et les suffixes juridiques (Inc., Ltd., Ltée) sont enlevés.",
  },
  "methodology.org_rule_id": {
    en: "The organization's ID is org- followed by the first ten hexadecimal digits of the SHA-1 of the normalized name, so it stays the same from one night to the next.",
    fr: "L'identifiant de l'organisation est org- suivi des dix premiers chiffres hexadécimaux du SHA-1 du nom normalisé; il reste donc le même d'une nuit à l'autre.",
  },
  "methodology.org_rule_place": {
    en: "The province is not part of the identity: a federal supplier appears at many addresses, and one profile gathers them. The province shown is the Canadian one seen most often.",
    fr: "La province ne fait pas partie de l'identité : un fournisseur fédéral figure à de nombreuses adresses, et un seul profil les regroupe. La province affichée est la province canadienne la plus fréquente.",
  },
  "methodology.org_rule_display": {
    en: "The name shown is the spelling seen most often. The other spellings are listed on the profile.",
    fr: "Le nom affiché est la graphie la plus fréquente. Les autres graphies figurent au profil.",
  },
  "methodology.org_shared": {
    en: "Two different businesses with the same normalized name share a page. The profile lists the addresses its records carry, and says so when there is more than one.",
    fr: "Deux entreprises différentes au même nom normalisé partagent une page. Le profil présente les adresses de ses dossiers et le signale lorsqu'il y en a plus d'une.",
  },
  "methodology.org_registry": {
    en: "A match in the federal corporate registry is a match on the normalized name, graded exact, probable or possible. It points to a registry record and does not establish identity.",
    fr: "Une correspondance dans le registre fédéral des sociétés est une correspondance sur le nom normalisé, qualifiée d'exacte, de probable ou de possible. Elle renvoie à un dossier du registre et n'établit pas l'identité.",
  },
  "methodology.buyers_text": {
    en: "Each federal institution is one buyer. Its ID is its open.canada.ca organization name where it has one (dnd-mdn, pwgsc-tpsgc). CanadaBuys names a buyer with its acronym in parentheses. The acronym joins it to the open.canada.ca list, and a reviewed list maps the names that do not line up. Every spelling a source uses is kept, so the mapping can be checked.",
    fr: "Chaque institution fédérale est un acheteur. Son identifiant est son nom d'organisation sur ouvert.canada.ca lorsqu'elle en a un (dnd-mdn, pwgsc-tpsgc). AchatsCanada nomme l'acheteur avec son sigle entre parenthèses. Le sigle le relie à la liste d'ouvert.canada.ca, et une liste révisée associe les noms qui ne concordent pas. Chaque graphie utilisée par une source est conservée, ce qui permet de vérifier l'association.",
  },
  "methodology.buyers_history": {
    en: "In PSPC contract history the contracting entity is always PSPC. The site files each record under the client department it was awarded for.",
    fr: "Dans l'historique des contrats de SPAC, l'entité contractante est toujours SPAC. Le site classe chaque dossier sous le ministère client pour lequel il a été attribué.",
  },
  "methodology.counting_intro": { en: "Totals follow these rules, source by source:", fr: "Les totaux suivent ces règles, source par source :" },
  "methodology.count_awards": {
    en: "Award notices and PSPC contract history: one contract per reference number. Its value is the total value on the newest amendment when that is positive, else the amount on the newest amendment. Totals add those values. A cancelled notice counts zero.",
    fr: "Avis d'attribution et historique des contrats de SPAC : un contrat par numéro de référence. Sa valeur est la valeur totale à la plus récente modification lorsqu'elle est positive, sinon le montant de la plus récente modification. Les totaux additionnent ces valeurs. Un avis annulé compte pour zéro.",
  },
  "methodology.count_contracts": {
    en: "Published contracts (proactive publication): a record's own value is the amendment value when the record is an amendment (instrument type A, or an amendment value set and not zero), else the original value when set, else the contract value. Totals add the records' own values. Where a procurement ID groups records, the profile also shows the value as last reported, the largest contract value in the group, but totals never use it.",
    fr: "Contrats publiés (divulgation proactive) : la valeur propre d'un dossier est la valeur de la modification lorsque le dossier est une modification (type d'instrument A, ou valeur de modification indiquée et non nulle), sinon la valeur initiale lorsqu'elle est indiquée, sinon la valeur du contrat. Les totaux additionnent les valeurs propres des dossiers. Lorsqu'un numéro d'approvisionnement regroupe des dossiers, le profil montre aussi la valeur à la dernière déclaration, soit la plus grande valeur de contrat du groupe, mais les totaux ne l'utilisent jamais.",
  },
  "methodology.count_grants": {
    en: "Grants and contributions: one agreement per department and reference number. Its value is the value on the highest amendment number. Totals add those.",
    fr: "Subventions et contributions : un accord par ministère et numéro de référence. Sa valeur est la valeur à la modification portant le numéro le plus élevé. Les totaux additionnent ces valeurs.",
  },
  "methodology.count_years": {
    en: "Years are calendar years of the award date (award notices, contract history), the contract date (published contracts) and the agreement start (grants). Fiscal years appear only in source file names.",
    fr: "Les années sont les années civiles de la date d'attribution (avis d'attribution, historique des contrats), de la date du contrat (contrats publiés) et du début de l'accord (subventions). Les exercices financiers n'apparaissent que dans le nom des fichiers sources.",
  },
  "methodology.count_currency": {
    en: "A record whose currency is neither the Canadian dollar nor blank is shown with its currency and left out of totals. The profile says how many were left out.",
    fr: "Un dossier dont la devise n'est ni le dollar canadien ni vide est affiché avec sa devise et exclu des totaux. Le profil indique combien de dossiers ont été exclus.",
  },
  "methodology.never_add": {
    en: "Sources are never added together. A contract can appear in an award notice, in PSPC contract history and in a department's published contracts at once, so each source is totalled separately and shown in its own column.",
    fr: "Les sources ne sont jamais additionnées. Un même contrat peut figurer à la fois dans un avis d'attribution, dans l'historique des contrats de SPAC et dans les contrats publiés d'un ministère. Chaque source est donc totalisée séparément et présentée dans sa propre colonne.",
  },
  "methodology.competitive_intro": {
    en: "Whether a record was competitive is read from the source's own fields:",
    fr: "Le caractère concurrentiel d'un dossier est tiré des champs de la source :",
  },
  "methodology.competitive_awards": {
    en: "Award notices and contract history, by the procurement method: \"Non-competitive\" and \"Advance contract award notice\" count as non-competitive, every \"Competitive\" method as competitive, and a blank as not stated.",
    fr: "Avis d'attribution et historique des contrats, selon la méthode d'approvisionnement : « Non concurrentielle » et « Préavis d'adjudication de contrat » comptent comme non concurrentiels, toute méthode « Concurrentielle » comme concurrentielle, et un champ vide comme non précisé.",
  },
  "methodology.competitive_contracts": {
    en: "Published contracts, by the solicitation procedure code: TN and AC are non-competitive. OB, TC and ST are competitive. A blank is not stated.",
    fr: "Contrats publiés, selon le code de procédure d'invitation : TN et AC sont non concurrentiels. OB, TC et ST sont concurrentiels. Un champ vide est non précisé.",
  },
  "methodology.competitive_share": {
    en: "The non-competitive share is given by count and by value, always with the figure it is a share of. By value it is taken over positive values: an amendment that lowered a contract's value is a record below zero, and a share of a net total could fall below zero or pass 100 percent.",
    fr: "La part non concurrentielle est donnée en nombre et en valeur, toujours avec le chiffre dont elle est la part. En valeur, elle est calculée sur les valeurs positives : une modification qui a réduit la valeur d'un contrat est un dossier inférieur à zéro, et une part d'un total net pourrait passer sous zéro ou dépasser 100 %.",
  },
  "methodology.competitive_meaning": {
    en: "Federal rules allow a contract without a competition in set cases, such as a low value, a single capable supplier or an emergency. The flag repeats what the source states. The reason, where the source gives one, is on the record's page.",
    fr: "Les règles fédérales permettent un contrat sans mise en concurrence dans des cas précis, comme une faible valeur, un seul fournisseur capable ou une urgence. L'indicateur reprend ce que dit la source. Le motif, lorsque la source le donne, figure sur la page du dossier.",
  },
  "methodology.status_open": {
    en: "A tender's status comes from CanadaBuys when tonight's file carries the notice: open, cancelled, awarded or expired.",
    fr: "Le statut d'un appel d'offres vient d'AchatsCanada lorsque le fichier de la nuit contient l'avis : ouvert, annulé, attribué ou expiré.",
  },
  "methodology.status_expired": {
    en: "A notice missing from tonight's open file whose closing date has passed becomes expired, unless the complete file says it was cancelled or awarded.",
    fr: "Un avis absent du fichier des avis ouverts de la nuit dont la date de clôture est passée devient expiré, sauf si le fichier complet indique qu'il a été annulé ou attribué.",
  },
  "methodology.status_weekly": {
    en: "The weekly read of the complete file corrects any status the nightly files could not settle.",
    fr: "La lecture hebdomadaire du fichier complet corrige tout statut que les fichiers de la nuit n'ont pas pu régler.",
  },
  "methodology.status_closing": {
    en: "An open notice that closes within {days} days is marked closing soon. Closing times are read as Eastern time (ET), the zone CanadaBuys publishes them in, and each page works out the state when it is shown.",
    fr: "Un avis ouvert dont la clôture tombe dans les {days} jours porte la mention « Clôture prochaine ». Les heures de clôture sont lues en heure de l'Est (HE), le fuseau dans lequel AchatsCanada les publie, et chaque page établit l'état au moment où elle s'affiche.",
  },
  "methodology.status_past": {
    en: "An open notice whose closing time has passed is marked \"Closing date passed\" and listed after the notices still open. A notice with a closing date and no time passes when the date does. The feeds and the CSV files show the states as of the data date.",
    fr: "Un avis ouvert dont l'heure de clôture est passée porte la mention « Date de clôture passée » et figure après les avis encore ouverts. Un avis dont la clôture n'a qu'une date sans heure passe avec la date. Les fils et les fichiers CSV montrent les états à la date des données.",
  },
  "methodology.status_awards": {
    en: "Award and contract history statuses (active, expired, cancelled) are the source's own.",
    fr: "Les statuts des attributions et de l'historique des contrats (actif, expiré, annulé) sont ceux de la source.",
  },
  "methodology.status_regions": {
    en: "Regions of delivery map to provinces: a province named in either language to itself, and the National Capital Region to Ontario and Quebec. \"Canada\", a blank or a city name maps to no province.",
    fr: "Les régions de livraison sont associées aux provinces : une province nommée dans l'une ou l'autre langue à elle-même, et la région de la capitale nationale à l'Ontario et au Québec. « Canada », un champ vide ou un nom de ville ne correspond à aucune province.",
  },
  "methodology.expiring_intro": {
    en: "The list of contracts ending soon is built from the end dates and suppliers the sources already give, by these rules:",
    fr: "La liste des contrats prenant fin bientôt est tirée des dates de fin et des fournisseurs que donnent déjà les sources, selon ces règles :",
  },
  "methodology.expiring_candidates": {
    en: "A contract is listed when it is an award notice, a PSPC contract history record or a published contract whose status is not cancelled. Its newest version must have an end date on or after the data date and within 12 months of it. The end date is the newest version's, since amendments move it.",
    fr: "Un contrat figure dans la liste lorsqu'il s'agit d'un avis d'attribution, d'un dossier de l'historique des contrats de SPAC ou d'un contrat publié dont le statut n'est pas annulé. Sa plus récente version doit porter une date de fin égale ou postérieure à la date des données et d'au plus 12 mois après celle-ci. La date de fin est celle de la plus récente version, puisque les modifications la déplacent.",
  },
  "methodology.expiring_once": {
    en: "The same contract can appear in all three sources, and the list shows it once. It prefers the CanadaBuys award notice, which links the solicitation, then PSPC contract history, then the published contract. A record from a later source is dropped when its contract number equals a kept record's, or when its organization, buyer, end date (within 3 days) and value (within 1%) all match a kept record.",
    fr: "Un même contrat peut figurer dans les trois sources, et la liste ne le présente qu'une fois. Elle privilégie l'avis d'attribution d'AchatsCanada, qui renvoie à l'invitation, puis l'historique des contrats de SPAC, puis le contrat publié. Un dossier d'une source moins privilégiée est écarté lorsque son numéro de contrat est celui d'un dossier retenu, ou lorsque son organisation, son acheteur, sa date de fin (à 3 jours près) et sa valeur (à 1 % près) correspondent tous à ceux d'un dossier retenu.",
  },
  "methodology.expiring_windows": {
    en: "The windows are cumulative: within 3, 6 and 12 months of the data date. A contract ending within 3 months is also in the 6-month and 12-month lists.",
    fr: "Les périodes sont cumulatives : d'ici 3, 6 et 12 mois après la date des données. Un contrat qui prend fin d'ici 3 mois figure aussi dans les listes de 6 et de 12 mois.",
  },
  "methodology.expiring_pro": {
    en: "The full 6-month and 12-month lists and the 12-month CSV file are part of Pro, the site's paid plan; every reader still sees their counts, their totals and their first {n} contracts.",
    fr: "Les listes complètes de 6 et de 12 mois et le fichier CSV de 12 mois font partie de Pro, le forfait payant du site; chaque lecteur en voit toujours le nombre, le total et les {n} premiers contrats.",
  },
  "methodology.expiring_growth": {
    en: "Amendments counts the versions beyond the original. Value growth is the newest total value over the original amount, minus one, shown as a percentage. It is left blank when either figure is unknown.",
    fr: "Le nombre de modifications compte les versions qui suivent la version initiale. La variation de valeur est la plus récente valeur totale divisée par le montant initial, moins un, exprimée en pourcentage. Elle reste vide lorsque l'un ou l'autre chiffre est inconnu.",
  },
  "methodology.expiring_value": {
    en: "The value shown is the value counted for the record's own source under the rules above. A window's total adds the values of the contracts it lists, each counted once, in Canadian dollars.",
    fr: "La valeur affichée est celle que retiennent les règles ci-dessus pour la source du dossier. Le total d'une période additionne les valeurs des contrats qu'elle présente, chacun compté une seule fois, en dollars canadiens.",
  },
  "methodology.expiring_feeds": {
    en: "The feeds carry the contracts that entered the 3-month window since the previous run, so a reader sees each contract once, about 90 days before it ends.",
    fr: "Les fils contiennent les contrats entrés dans la période de 3 mois depuis l'exécution précédente; un lecteur voit donc chaque contrat une seule fois, environ 90 jours avant sa fin.",
  },
  "methodology.expiring_claim": {
    en: "An end date is the date the record states. A contract can be extended, renewed or replaced, and the list says nothing about what follows its end.",
    fr: "Une date de fin est celle qu'indique le dossier. Un contrat peut être prolongé, renouvelé ou remplacé, et la liste n'indique rien de ce qui suit sa fin.",
  },
  "methodology.analytics_intro": {
    en: "The analytics views chart one buyer, organization or segment from the records, one source at a time, by these rules:",
    fr: "Les vues d'analyse présentent en graphiques un acheteur, une organisation ou un segment à partir des dossiers, une source à la fois, selon ces règles :",
  },
  "methodology.analytics_fiscal": {
    en: "Fiscal years run from April 1 to March 31 and are named by both calendar years (2025-26). A record falls in the fiscal year and quarter of its award date (award notices and contract history), its contract date (published contracts) or its agreement start (grants). The current fiscal year is counted up to the data date.",
    fr: "Les exercices vont du 1er avril au 31 mars et portent le nom de leurs deux années civiles (2025-2026). Un dossier relève de l'exercice et du trimestre de sa date d'attribution (avis d'attribution et historique des contrats), de sa date de contrat (contrats publiés) ou du début de l'accord (subventions). L'exercice en cours est compté jusqu'à la date des données.",
  },
  "methodology.analytics_counting": {
    en: "Each record counts by the rules in Counting Money: one contract per reference for award notices and contract history, each row for published contracts, one agreement for grants. Values are in Canadian dollars; a value in another currency, one not published and one flagged for checking are left out of the sums and counted beside them.",
    fr: "Chaque dossier compte selon les règles de la section Calcul des montants : un contrat par référence pour les avis d'attribution et l'historique des contrats, chaque ligne pour les contrats publiés, un accord pour les subventions. Les valeurs sont en dollars canadiens; une valeur dans une autre devise, une valeur non publiée et une valeur signalée pour vérification sont exclues des sommes et comptées à côté.",
  },
  "methodology.analytics_sources": {
    en: "A view shows one source at a time and never adds two. The buyer of a PSPC contract history record is its client department, as on the buyer pages.",
    fr: "Une vue présente une source à la fois et n'en additionne jamais deux. L'acheteur d'un dossier de l'historique des contrats de SPAC est son ministère client, comme sur les pages des acheteurs.",
  },
  "methodology.analytics_segments": {
    en: "Segments come from the UNSPSC codes of award notices and contract history; published contracts and grants carry none. A notice whose codes fall in several segments counts in each segment's figures, as on the segment pages; every other figure counts it once.",
    fr: "Les segments viennent des codes UNSPSC des avis d'attribution et de l'historique des contrats; les contrats publiés et les subventions n'en portent pas. Un avis dont les codes relèvent de plusieurs segments compte dans les chiffres de chacun, comme sur les pages des segments; tout autre chiffre ne le compte qu'une fois.",
  },
  "methodology.analytics_shares": {
    en: "A share of value is over the whole value of the period and source, records that name no organization included. The non-competitive share by value is taken over positive values, as on the profiles.",
    fr: "Une part de valeur porte sur toute la valeur de la période et de la source, y compris les dossiers qui ne nomment aucune organisation. La part non concurrentielle en valeur est calculée sur les valeurs positives, comme sur les profils.",
  },
  "methodology.analytics_entrants": {
    en: "An organization is new to a segment in a fiscal year when it has a record there that year and none in the {n} fiscal years before.",
    fr: "Une organisation est nouvelle dans un segment pendant un exercice lorsqu'elle y a un dossier cet exercice et aucun pendant les {n} exercices précédents.",
  },
  "methodology.analytics_people": {
    en: "Grants whose recipient reads as a person are not in the analytics at all. A contract whose supplier reads as a person counts in its buyer's figures with no organization named.",
    fr: "Les subventions dont le bénéficiaire se lit comme une personne ne figurent pas du tout dans les analyses. Un contrat dont le fournisseur se lit comme une personne compte dans les chiffres de son acheteur sans qu'aucune organisation soit nommée.",
  },
  "methodology.analytics_pro": {
    en: "The views are part of Pro, the site's paid plan. Every reader sees each view's first chart for the latest {n} fiscal years.",
    fr: "Les vues font partie de Pro, le forfait payant du site. Chaque lecteur voit le premier graphique de chaque vue pour les {n} derniers exercices.",
  },
  "methodology.analytics_date": {
    en: "The views read a database of the records refreshed each night after the data; each view gives the date its records describe.",
    fr: "Les vues lisent une base des dossiers actualisée chaque nuit après les données; chaque vue indique la date que décrivent ses dossiers.",
  },
  "methodology.people_individuals": {
    en: "Private individuals are never stored: grants to individuals and any supplier, recipient or client whose name reads as a person's are dropped before anything is written, and only their number is logged.",
    fr: "Les particuliers ne sont jamais conservés : les subventions versées à des particuliers et tout fournisseur, bénéficiaire ou client dont le nom se lit comme celui d'une personne sont écartés avant toute écriture, et seul leur nombre est consigné.",
  },
  "methodology.people_contacts": {
    en: "Tender and award notices carry a government contact's name, email and phone. The site never shows them. Each notice page links to CanadaBuys for them.",
    fr: "Les avis d'appel d'offres et d'attribution indiquent le nom, le courriel et le téléphone d'une personne-ressource du gouvernement. Le site ne les affiche jamais. Chaque page d'avis renvoie à AchatsCanada pour les obtenir.",
  },
  "methodology.people_officials": {
    en: "Designated public office holders in lobbying reports are named in their public role, as the registry publishes them.",
    fr: "Les titulaires d'une charge publique désignée dans les rapports de lobbying sont nommés dans leur rôle public, tels que le registre les publie.",
  },
  "methodology.claim_records": {
    en: "A figure says what the government's files add up to under the rules above. It draws no conclusion about any organization or official.",
    fr: "Un chiffre dit à quoi s'additionnent les fichiers du gouvernement selon les règles ci-dessus. Il ne tire aucune conclusion sur une organisation ou un titulaire de charge.",
  },
  "methodology.claim_identity": {
    en: "A profile gathers records under one normalized name. It does not establish that they belong to one legal entity.",
    fr: "Un profil regroupe des dossiers sous un nom normalisé. Il n'établit pas qu'ils appartiennent à une même entité juridique.",
  },
  "methodology.claim_complete": {
    en: "The site holds what the publishers release. Contracts under $10,000, late reports and records a department has not published are not here.",
    fr: "Le site contient ce que publient les éditeurs. Les contrats de moins de 10 000 $, les déclarations tardives et les dossiers qu'un ministère n'a pas publiés n'y figurent pas.",
  },
  "methodology.claim_totals": {
    en: "Totals are sums of published contract and agreement values. The sources do not report amounts paid, and neither does the site.",
    fr: "Les totaux sont des sommes de valeurs de contrats et d'accords publiées. Les sources ne déclarent pas les montants versés, le site non plus.",
  },
  "methodology.corrections_text": {
    en: "A wrong match, a buyer filed under the wrong institution or a record shown wrongly can be reported on the {form} page. An organization can publish a response on its profile. Both are reviewed before they appear.",
    fr: "Un mauvais appariement, un acheteur classé sous la mauvaise institution ou un dossier mal affiché peut être signalé à la page {form}. Une organisation peut publier une réponse à son profil. Les deux sont examinés avant leur publication.",
  },

  // -- forms -----------------------------------------------------------------------------------
  "form.respond_title": { en: "Respond as This Organization", fr: "Répondre au nom de cette organisation" },
  "form.respond_intro": {
    en: "A statement from {organization}, published on its profile with the date it was received.",
    fr: "Une déclaration de {organization}, publiée sur son profil avec sa date de réception.",
  },
  "form.respond_review": {
    en: "The statement is published as written once the site has confirmed it comes from the organization. The site confirms it through the email address below, which is never shown.",
    fr: "La déclaration est publiée telle quelle une fois que le site a confirmé qu'elle vient de l'organisation. Le site la confirme au moyen de l'adresse courriel ci-dessous, qui n'est jamais affichée.",
  },
  "form.respond_description": {
    en: "Send a statement to publish on the profile of {name}, dated on receipt.",
    fr: "Envoyer une déclaration à publier sur le profil de {name}, datée à sa réception.",
  },
  "form.statement": { en: "Statement", fr: "Déclaration" },
  "form.contact": { en: "Email address (optional, never shown)", fr: "Adresse courriel (facultative, jamais affichée)" },
  "form.contact_required": {
    en: "Email address (needed to confirm the statement, never shown)",
    fr: "Adresse courriel (nécessaire pour confirmer la déclaration, jamais affichée)",
  },
  "form.contact_note": { en: "Used only to confirm or follow up on this message.", fr: "Sert uniquement à confirmer ce message ou à y donner suite." },
  "form.honeypot": { en: "Leave this field empty", fr: "Laissez ce champ vide" },
  "form.submit_statement": { en: "Send the statement", fr: "Envoyer la déclaration" },
  "form.browser_only": {
    en: "This form opens in a web browser. The profile is at {url}.",
    fr: "Ce formulaire s'ouvre dans un navigateur Web. Le profil se trouve à {url}.",
  },
  "form.rejected": { en: "The form could not be read.", fr: "Le formulaire n'a pas pu être lu." },
  "form.err_statement": { en: "The statement needs at least 20 characters.", fr: "La déclaration doit compter au moins 20 caractères." },
  "form.err_contact": { en: "The email address does not look complete.", fr: "L'adresse courriel semble incomplète." },
  "form.err_contact_missing": {
    en: "Give an email address so the site can confirm the statement.",
    fr: "Indiquez une adresse courriel pour que le site puisse confirmer la déclaration.",
  },
  "form.err_unavailable": {
    en: "The message could not be saved just now. Try again in a moment.",
    fr: "Le message n'a pas pu être enregistré pour l'instant. Réessayez dans un moment.",
  },
  "form.correct_title": { en: "Report a Correction", fr: "Signaler une correction" },
  "form.correct_intro": {
    en: "Name the page or record that is wrong and what it should say. Corrections are reviewed and logged on the profile they concern.",
    fr: "Indiquez la page ou le dossier erroné et ce qu'il devrait indiquer. Les corrections sont examinées et consignées au profil visé.",
  },
  "form.correct_panel": { en: "Correction Request", fr: "Demande de correction" },
  "form.page": { en: "Page address or record reference", fr: "Adresse de la page ou référence du dossier" },
  "form.page_placeholder": { en: "awardwatch.ca/organizations/org-… or cb-…", fr: "awardwatch.ca/organizations/org-… ou cb-…" },
  "form.what_wrong": { en: "What is wrong, and what should it say?", fr: "Qu'est-ce qui est erroné, et que devrait-on lire?" },
  "form.err_page": { en: "Name the page or record.", fr: "Indiquez la page ou le dossier." },
  "form.err_request": { en: "Describe the correction in at least 10 characters.", fr: "Décrivez la correction en au moins 10 caractères." },
  "form.send_correction": { en: "Send the correction", fr: "Envoyer la correction" },
  "form.thanks": { en: "Thank You", fr: "Merci" },
  "form.thanks_statement": {
    en: "The statement was received. It appears on the profile once confirmed.",
    fr: "La déclaration a été reçue. Elle paraîtra au profil une fois confirmée.",
  },
  "form.thanks_correction": { en: "The correction was received and will be reviewed.", fr: "La correction a été reçue et sera examinée." },

  // -- interest in email alerts (pages/interest.tsx) and the alerts page --------------------------
  // The sign-up is public and stores requests; email delivery is part of Pro once accounts open,
  // and a request waits in the account made with its address (operator, 2026-11-03). No price
  // appears here, and no string promises delivery without the plan.
  "interest.title": { en: "Email Lists", fr: "Listes de diffusion" },
  "interest.about": { en: "How email lists work", fr: "Comment fonctionnent les listes" },
  "interest.email": { en: "Email address", fr: "Adresse courriel" },
  "interest.submit": { en: "Notify me", fr: "M'avertir" },
  "interest.note": {
    en: "Email lists are part of Pro. Sign in with this address and the list is waiting in your account as a saved search; the {privacy} page says what the form keeps.",
    fr: "Les listes de diffusion font partie de Pro. Connectez-vous avec cette adresse et la liste vous attend dans votre compte comme recherche enregistrée; la page {privacy} indique ce que conserve le formulaire.",
  },
  "interest.done": { en: "Noted: {email}, for {label}.", fr: "C'est noté : {email}, pour {label}." },
  "interest.watch_note": {
    en: "For a list in this browser without email, use Add to watchlist.",
    fr: "Pour une liste conservée dans ce navigateur, sans courriel, utilisez Ajouter à la liste de suivi.",
  },
  "interest.err_email": { en: "Enter a complete email address.", fr: "Entrez une adresse courriel complète." },
  "interest.err_rejected": { en: "The form could not be sent. Try again.", fr: "Le formulaire n'a pas pu être envoyé. Réessayez." },
  "interest.back": { en: "Back to the page", fr: "Retour à la page" },
  // The label of a saved filter. A filter is named as its chip names it, "Name: value", the pairs joined by "; ".
  "interest.pair": { en: "{name}: {value}", fr: "{name} : {value}" },
  "interest.label_tenders_all": { en: "Every new tender notice", fr: "Chaque nouvel avis d'appel d'offres" },
  "interest.label_tenders": { en: "New tender notices matching {filters}", fr: "Nouveaux avis d'appel d'offres correspondant à {filters}" },
  "interest.label_tenders_words": {
    en: "New tender notices with the searched words in the title",
    fr: "Nouveaux avis d'appel d'offres dont le titre contient les mots recherchés",
  },
  "interest.label_tenders_words_filters": {
    en: "New tender notices with the searched words in the title, matching {filters}",
    fr: "Nouveaux avis d'appel d'offres dont le titre contient les mots recherchés, correspondant à {filters}",
  },
  "interest.follow_some": { en: "New tender notices matching the filters above", fr: "Nouveaux avis d'appel d'offres correspondant aux filtres ci-dessus" },
  "interest.label_expiring": { en: "Contracts entering the {n}-month window {scope}", fr: "Contrats qui entrent dans la période de {n} mois {scope}" },
  // Beside the provinces when the "Include Canada-wide or not stated" box is unticked.
  "interest.national_out": { en: "Canada-wide or not stated: left out", fr: "Tout le Canada ou non indiqué : exclus" },
  "interest.scope_all": { en: "for every buyer and segment", fr: "pour tous les acheteurs et segments" },
  "interest.scope_buyer": { en: "for {buyer}", fr: "pour {buyer}" },
  "interest.scope_segment": { en: "in segment {segment}", fr: "dans le segment {segment}" },
  "interest.scope_both": { en: "for {buyer} in segment {segment}", fr: "pour {buyer} dans le segment {segment}" },
  "interest.label_organization": {
    en: "When {organization} is named on a new award, contract or grant",
    fr: "Quand {organization} figure dans une nouvelle attribution, un nouveau contrat ou une nouvelle subvention",
  },
  "interest.label_buyer": { en: "New award notices and contracts from {buyer}", fr: "Nouveaux avis d'attribution et contrats de {buyer}" },
  "interest.label_segment": {
    en: "New tender notices and award notices in segment {segment}",
    fr: "Nouveaux avis d'appel d'offres et d'attribution dans le segment {segment}",
  },
  "alerts.title": { en: "Email Lists", fr: "Listes de diffusion" },
  "alerts.lead": {
    en: "Email lists are part of Pro, the site's paid plan. Accounts are open: sign in with your address and each list becomes a saved search, sent daily or weekly on Pro. The form below keeps a list for an address that has no account yet.",
    fr: "Les listes de diffusion font partie de Pro, le forfait payant du site. Les comptes sont ouverts : connectez-vous avec votre adresse et chaque liste devient une recherche enregistrée, envoyée chaque jour ou chaque semaine avec Pro. Le formulaire ci-dessous conserve une liste pour une adresse qui n'a pas encore de compte.",
  },
  "alerts.toc_cover": { en: "What Pro Delivers", fr: "Ce que Pro envoie" },
  "alerts.cover_intro": {
    en: "On the Pro plan, each list is a saved search on your account, sent by email each day or each week with what is new in it.",
    fr: "Avec le forfait Pro, chaque liste est une recherche enregistrée de votre compte, envoyée par courriel chaque jour ou chaque semaine avec ce qui y est nouveau.",
  },
  "alerts.cover_tenders": {
    en: "New tender notices: every one, or those matching the filters of the open notices list (words in the title, category, segment, province, buyer, notice type, procurement method).",
    fr: "Les nouveaux avis d'appel d'offres : tous, ou ceux qui correspondent aux filtres de la liste des avis ouverts (mots du titre, catégorie, segment, province, acheteur, type d'avis, méthode d'approvisionnement).",
  },
  "alerts.cover_expiring": {
    en: "Contracts entering the 3-, 6- or 12-month window of contracts ending soon, for one buyer, one segment or every contract.",
    fr: "Les contrats qui entrent dans la période de 3, 6 ou 12 mois des contrats prenant fin bientôt, pour un acheteur, un segment ou tous les contrats.",
  },
  "alerts.cover_organizations": {
    en: "New records naming an organization you watch: an award notice, a contract or a grant.",
    fr: "Les nouveaux dossiers qui nomment une organisation que vous suivez : un avis d'attribution, un contrat ou une subvention.",
  },
  "alerts.cover_buyers": {
    en: "New award notices and contracts from one buyer, and new tender and award notices in one UNSPSC segment.",
    fr: "Les nouveaux avis d'attribution et contrats d'un acheteur, et les nouveaux avis d'appel d'offres et d'attribution d'un segment UNSPSC.",
  },
  "alerts.toc_now": { en: "Without an Account", fr: "Sans compte" },
  "alerts.now": {
    en: "The form keeps the address and each list chosen, and sends nothing itself. Sign in with the same address, now or later, and the lists are there, ready to add to the account's saved searches; delivery by email comes with Pro. The address is never shown or shared, and a link in any message removes it.",
    fr: "Le formulaire conserve l'adresse et chaque liste choisie et n'envoie rien lui-même. Connectez-vous avec la même adresse, maintenant ou plus tard, et les listes y sont, prêtes à être ajoutées aux recherches enregistrées du compte; l'envoi par courriel vient avec Pro. L'adresse n'est jamais affichée ni communiquée, et un lien dans tout message la retire.",
  },
  "alerts.privacy": {
    en: "The {privacy} page says what the form keeps and how to have the address removed.",
    fr: "La page {privacy} indique ce que conserve le formulaire et comment faire retirer l'adresse.",
  },
  "alerts.register_intro": {
    en: "Tick each list to join. The filtered list takes any mix of the categories, segments and provinces under it. A list for one buyer, organization or segment, or another view of contracts ending soon, is saved from the page that shows it.",
    fr: "Cochez chaque liste qui vous intéresse. La liste filtrée accepte toute combinaison des catégories, segments et provinces proposés en dessous. Une liste pour un acheteur, une organisation ou un segment, ou une autre vue des contrats prenant fin bientôt, s'enregistre depuis la page qui l'affiche.",
  },
  "alerts.toc_where": { en: "Where the Form Appears", fr: "Où trouver le formulaire" },
  "alerts.where_tenders": {
    en: "{link}: new notices matching the filters the list shows.",
    fr: "{link} : les nouveaux avis qui correspondent aux filtres de la liste.",
  },
  "alerts.where_expiring": {
    en: "{link} and its windows: contracts entering the window shown, for the buyer or segment chosen or for every contract.",
    fr: "{link} et ses périodes : les contrats qui entrent dans la période affichée, pour l'acheteur ou le segment choisi ou pour tous les contrats.",
  },
  "alerts.where_profiles": { en: "Every {link}: new records naming the organization.", fr: "Chaque {link} : les nouveaux dossiers qui nomment l'organisation." },
  "alerts.where_more": {
    en: "Every {buyers} and {segments}: new award notices and contracts from the buyer, new notices in the segment.",
    fr: "Chaque {buyers} et chaque {segments} : les nouveaux avis d'attribution et contrats de l'acheteur, les nouveaux avis du segment.",
  },
  "alerts.link_expiring": { en: "Contracts ending soon", fr: "Contrats prenant fin bientôt" },
  "alerts.link_profiles": { en: "organization profile", fr: "profil d'organisation" },
  "alerts.link_buyers": { en: "buyer page", fr: "page d'acheteur" },
  "alerts.link_segments": { en: "segment page", fr: "page de segment" },
  // The chooser on the Email lists page (pages/alerts.tsx): a box per list, the
  // filters of the matching list under its box, one address and one button.
  "lists.title": { en: "Choose Your Lists", fr: "Choisissez vos listes" },
  "lists.legend": { en: "Lists", fr: "Listes" },
  "lists.matching": { en: "New tender notices matching filters", fr: "Nouveaux avis d'appel d'offres correspondant à des filtres" },
  "lists.hint_none": {
    en: "With no filter chosen, this list is every new tender notice.",
    fr: "Sans filtre choisi, cette liste comprend chaque nouvel avis d'appel d'offres.",
  },
  "lists.hint_keys": {
    en: "Hold Ctrl (Cmd on a Mac) to choose several segments or provinces.",
    fr: "Maintenez la touche Ctrl (Cmd sur un Mac) pour choisir plusieurs segments ou provinces.",
  },
  "lists.submit": { en: "Sign me up", fr: "Inscrivez-moi" },
  // Above the list of the lists saved, so a mistyped address shows.
  "lists.done": { en: "Saved for {email}:", fr: "C'est noté pour {email} :" },
  // Under the lists saved, while the accounts switch is on.
  "lists.done_pro": {
    en: "Delivery is part of Pro. {link} with this address to start it.",
    fr: "L'envoi fait partie de Pro. {link} avec cette adresse pour le lancer.",
  },
  "lists.done_sign_in": { en: "Sign in", fr: "Connectez-vous" },
  "lists.err_none": { en: "Choose at least one list.", fr: "Choisissez au moins une liste." },
  // Under the chooser: interest.note for several lists.
  "lists.note": {
    en: "Email lists are part of Pro. Sign in with this address and the lists are waiting in your account as saved searches; the {privacy} page says what the form keeps.",
    fr: "Les listes de diffusion font partie de Pro. Connectez-vous avec cette adresse et les listes vous attendent dans votre compte comme recherches enregistrées; la page {privacy} indique ce que conserve le formulaire.",
  },

  // -- citing -------------------------------------------------------------------------------------
  "cite.title": { en: "How to Cite", fr: "Comment citer" },
  "cite.text": {
    en: "The site's open files are deposited on Zenodo with a DOI, one version per deposit. Cite the version you used:",
    fr: "Les fichiers ouverts du site sont déposés sur Zenodo avec un DOI, une version par dépôt. Citez la version utilisée :",
  },
  "cite.reference": {
    en: "{author} ({year}). {title} (Version {version}) [Data set]. Zenodo. {doi}",
    fr: "{author} ({year}). {title} (version {version}) [Jeu de données]. Zenodo. {doi}",
  },
  "cite.concept": {
    en: "To cite every version at once, or to point at whichever version is newest, use the concept DOI {doi}.",
    fr: "Pour citer toutes les versions à la fois, ou pour renvoyer à la plus récente, utilisez le DOI de concept {doi}.",
  },
  // The /cite page. The fmt.* templates hold each style's connective words;
  // cite.tsx fills them with the title, the dates and the address.
  "citepage.lead": {
    en: "Award Watch is a secondary source. It compiles public records and links each one to the government record it came from. Those records change nightly, so a citation should name the data date shown in the header ({date} in the citations below).",
    fr: "Award Watch est une source secondaire. Le site compile des dossiers publics et lie chacun au dossier gouvernemental d'où il vient. Ces dossiers changent chaque nuit : une citation doit donc indiquer la date des données affichée dans l'en-tête ({date} dans les citations ci-dessous).",
  },
  "citepage.page_note": {
    en: "To cite one page, such as an organization profile or a tender notice, give that page's own address with the same data date.",
    fr: "Pour citer une seule page, comme le profil d'une organisation ou un avis d'appel d'offres, donnez l'adresse de cette page avec la même date des données.",
  },
  "citepage.website": { en: "The Website", fr: "Le site Web" },
  "citepage.data": { en: "The Data", fr: "Les données" },
  "citepage.style.apa": { en: "APA (7th edition)", fr: "APA (7e édition)" },
  "citepage.style.mla": { en: "MLA (9th edition)", fr: "MLA (9e édition)" },
  "citepage.style.chicago": { en: "Chicago (17th edition, author-date)", fr: "Chicago (17e édition, auteur-date)" },
  "citepage.style.harvard": { en: "Harvard (Cite Them Right)", fr: "Harvard (selon Cite Them Right)" },
  "citepage.style.bibtex": { en: "BibTeX", fr: "BibTeX" },
  "citepage.style.ris": { en: "RIS", fr: "RIS" },
  "citepage.fmt.apa": {
    en: "{author}. ({year}). {title} ({data}). Retrieved {accessed}, from {url}",
    fr: "{author}. ({year}). {title} ({data}). Consulté le {accessed} à {url}",
  },
  "citepage.fmt.mla": { en: "{title}. {data}, {url}. Accessed {accessed}.", fr: "{title}. {data}, {url}. Consulté le {accessed}." },
  "citepage.fmt.chicago": {
    en: "{author}. {year}. {title}. {data}. Accessed {accessed}. {url}.",
    fr: "{author}. {year}. {title}. {data}. Consulté le {accessed}. {url}.",
  },
  "citepage.fmt.harvard": {
    en: "{author} ({year}) {title}. {data}. Available at: {url} (Accessed: {accessed}).",
    fr: "{author} ({year}) {title}. {data}. Disponible à l'adresse : {url} (consulté le {accessed}).",
  },
  "citepage.data_as_of": { en: "Data as of {date}", fr: "Données au {date}" },
  // The site's title as each style writes it: as given (Harvard, BibTeX,
  // RIS), APA's sentence case, and the headline case of MLA and Chicago.
  // French keeps sentence case in every style.
  "citepage.site_title": {
    en: "Award Watch: federal tenders, awards, contracts and grants by organization",
    fr: "Award Watch : appels d'offres, attributions, contrats et subventions du fédéral par organisation",
  },
  "citepage.site_title_sentence": {
    en: "Award Watch: Federal tenders, awards, contracts and grants by organization",
    fr: "Award Watch : appels d'offres, attributions, contrats et subventions du fédéral par organisation",
  },
  "citepage.site_title_headline": {
    en: "Award Watch: Federal Tenders, Awards, Contracts and Grants by Organization",
    fr: "Award Watch : appels d'offres, attributions, contrats et subventions du fédéral par organisation",
  },
  "citepage.copy": { en: "Copy", fr: "Copier" },
  "citepage.copied": { en: "Copied", fr: "Copié" },

  "docs.publisher": {
    en: "Published by Allwater Software Inc., a British Columbia corporation.",
    fr: "Publié par Allwater Software Inc., une société de la Colombie-Britannique.",
  },
  "about.title": { en: "About Award Watch", fr: "À propos d'Award Watch" },
  "about.lead": {
    en: "What the site holds, who publishes it and how to reach it.",
    fr: "Ce que contient le site, qui le publie et comment le joindre.",
  },
  "about.toc_what": { en: "What the Site Is", fr: "Ce qu'est le site" },
  "about.what": {
    en: "Award Watch gathers federal tender notices, award notices, PSPC contract history, published contracts, grants and contributions, and lobbying communications under the organizations they name. Every record comes from the Government of Canada's open data, and the site is refreshed nightly.",
    fr: "Award Watch regroupe les avis d'appel d'offres et d'attribution du fédéral, l'historique des contrats de SPAC, les contrats publiés, les subventions et contributions et les communications de lobbying sous les organisations qu'ils nomment. Chaque dossier vient des données ouvertes du gouvernement du Canada, et le site est mis à jour chaque nuit.",
  },
  "about.toc_who": { en: "Who Publishes It", fr: "Qui le publie" },
  "about.who": {
    en: "Award Watch is published by Allwater Software Inc., a British Columbia corporation. It is not affiliated with any government body, supplier or buyer.",
    fr: "Award Watch est publié par Allwater Software Inc., une société de la Colombie-Britannique. Il n'est affilié à aucun organisme gouvernemental, fournisseur ou acheteur.",
  },
  "about.toc_data": { en: "Data and Methods", fr: "Données et méthodes" },
  "about.data": {
    en: "The {data} page lists every file the site reads and when each was last read.",
    fr: "La page {data} présente chaque fichier que lit le site et sa dernière lecture.",
  },
  "about.methods": {
    en: "The {methodology} page sets out how records are matched to organizations and how each figure is computed.",
    fr: "La page {methodology} expose comment les dossiers sont associés aux organisations et comment chaque chiffre est calculé.",
  },
  "about.claims": {
    en: "A figure describes the government's records and draws no conclusion about anyone. The section {claims} lists what the site does not claim.",
    fr: "Un chiffre décrit les dossiers du gouvernement et ne tire aucune conclusion sur qui que ce soit. La section {claims} présente ce que le site n'affirme pas.",
  },
  "about.toc_contact": { en: "Contact and Corrections", fr: "Contact et corrections" },
  "about.contact": { en: "Write to {email}.", fr: "Écrivez à {email}." },
  "about.corrections": {
    en: "To report a record shown wrongly, use the {form}. An organization can also publish a response on its profile.",
    fr: "Pour signaler un dossier mal affiché, utilisez le {form}. Une organisation peut aussi publier une réponse sur son profil.",
  },
  "about.form_link": { en: "corrections form", fr: "formulaire de correction" },
  "about.turnaround": {
    en: "A correction is reviewed within seven days. The record is corrected or the response is published on the next refresh.",
    fr: "Une correction est examinée dans les sept jours. Le dossier est corrigé ou la réponse est publiée à la mise à jour suivante.",
  },
  "about.toc_cite": { en: "Citing the Site", fr: "Citer le site" },
  "about.cite": {
    en: "The {cite} page gives citations for the site and its data in the common styles.",
    fr: "La page {cite} donne les citations du site et de ses données dans les styles courants.",
  },
  "about.toc_licence": { en: "Licences and Code", fr: "Licences et code" },
  "about.licence_code": {
    en: "The site's code is source-available: anyone may read it, run its tests to check the methodology and quote short excerpts with attribution, and any other use needs written permission.",
    fr: "Le code du site est publié en source disponible : chacun peut le lire, en exécuter les tests pour vérifier la méthodologie et en citer de courts extraits avec mention de la source, et tout autre usage exige une autorisation écrite.",
  },
  "about.licence_data": {
    en: "The files the site derives from the government's records are published under the {ogl}.",
    fr: "Les fichiers que le site tire des dossiers du gouvernement sont publiés sous la {ogl}.",
  },
  "terms.title": { en: "Terms of Use", fr: "Conditions d'utilisation" },
  "terms.lead": {
    en: "The terms for reading the site, reusing its files and subscribing to Pro.",
    fr: "Les conditions de lecture du site, de réutilisation de ses fichiers et d'abonnement à Pro.",
  },
  "terms.toc_use": { en: "Using the Site", fr: "Utilisation du site" },
  "terms.use": { en: "The site is free to read. No account is needed.", fr: "La lecture du site est gratuite. Aucun compte n'est requis." },
  "terms.toc_files": { en: "Reusing the Files", fr: "Réutilisation des fichiers" },
  "terms.files": {
    en: "The downloads and the figures the site derives are published under the {ogl}, as the {data} page states. Reuse them with this attribution:",
    fr: "Les téléchargements et les chiffres que calcule le site sont publiés sous la {ogl}, comme l'indique la page {data}. Réutilisez-les avec cette mention :",
  },
  "terms.toc_authority": { en: "The Government's Records", fr: "Les dossiers du gouvernement" },
  "terms.authority": {
    en: "The government's records remain the authority. Every record on the site links to the notice or file it came from.",
    fr: "Les dossiers du gouvernement font foi. Chaque dossier du site renvoie à l'avis ou au fichier d'où il vient.",
  },
  "terms.toc_warranty": { en: "No Warranty", fr: "Aucune garantie" },
  "terms.warranty": {
    en: "The figures are drawn from the sources as published and may carry the sources' errors. The site and its files are provided as is, with no warranty of accuracy, completeness or fitness for a purpose.",
    fr: "Les chiffres sont tirés des sources telles que publiées et peuvent en reprendre les erreurs. Le site et ses fichiers sont fournis tels quels, sans garantie d'exactitude, d'exhaustivité ou d'adéquation à un usage.",
  },
  "terms.liability": {
    en: "Award Watch is not liable for any loss arising from the use of the site, its pages or its files.",
    fr: "Award Watch n'est responsable d'aucune perte découlant de l'utilisation du site, de ses pages ou de ses fichiers.",
  },
  "terms.toc_changes": { en: "Changes", fr: "Modifications" },
  "terms.changes": {
    en: "The site may change or withdraw a page, a file or a feed at any time. A change to how a figure is computed is listed on the {data} page.",
    fr: "Le site peut modifier ou retirer une page, un fichier ou un fil en tout temps. Un changement à la façon de calculer un chiffre est inscrit à la page {data}.",
  },
  "terms.toc_automated": { en: "Automated Access", fr: "Accès automatisé" },
  "terms.automated": {
    en: "Automated access follows {robots}. Each address may make {pages} page requests, {api} API requests and {downloads} downloads a minute. For bulk use, start from the downloads.",
    fr: "L'accès automatisé suit le fichier {robots}. Chaque adresse peut faire {pages} requêtes de pages, {api} requêtes à l'API et {downloads} téléchargements par minute. Pour un usage en vrac, partez des téléchargements.",
  },
  "terms.toc_code": { en: "The Code", fr: "Le code" },
  "terms.code": {
    en: "The site's code is under its own source-available licence, described on the {about} page.",
    fr: "Le code du site relève de sa propre licence de source disponible, décrite à la page {about}.",
  },
  // The paid plan, from docs/terms-paid-draft.md as reviewed. No price is
  // written here: the billing page shows them, from wrangler.jsonc.
  "terms.toc_pro": { en: "Paid Plan (Pro)", fr: "Forfait payant (Pro)" },
  "terms.pro_intro": {
    en: "These terms apply to the Pro plan, in addition to the terms above. The {warranty} terms above, liability included, apply to Pro as they do to the rest of the site.",
    fr: "Ces conditions s'appliquent au forfait Pro, en plus des conditions ci-dessus. Les conditions de la section {warranty} ci-dessus, responsabilité comprise, s'appliquent à Pro comme au reste du site.",
  },
  "terms.pro_seller_title": { en: "Who Sells It", fr: "Qui le vend" },
  "terms.pro_seller": {
    en: "Award Watch is published by Allwater Software Inc., a British Columbia corporation. Pro subscriptions are sold through Link, the merchant of record operated by Stripe, on Allwater's behalf: the charge on the card statement reads LINK.COM followed by Allwater's name, Link sends the receipts, and refunds and disputes are handled through Link's support, with Allwater able to refund as well. The site never receives card details. Questions about a charge go to {email} or to Link's support.",
    fr: "Award Watch est publié par Allwater Software Inc., une société de la Colombie-Britannique. Les abonnements Pro sont vendus par l'intermédiaire de Link, le marchand officiel exploité par Stripe, pour le compte d'Allwater : le débit sur le relevé de carte indique LINK.COM suivi du nom d'Allwater, Link envoie les reçus, et les remboursements et les litiges passent par le soutien de Link, Allwater pouvant aussi rembourser. Le site ne reçoit jamais les données de carte. Les questions sur un débit s'adressent à {email} ou au soutien de Link.",
  },
  "terms.pro_includes_title": { en: "What Pro Includes", fr: "Ce que comprend Pro" },
  "terms.pro_includes": {
    en: "Pro is a plan on an Award Watch account. It includes more saved searches than the Free plan, email delivery of saved searches, and same-day tender notices on the tender lists, as described on the account's billing page. Every public page of the site stays free to read without an account. Allwater may add to Pro at any time; a change that takes something away from Pro applies from the first renewal after notice.",
    fr: "Pro est un forfait d'un compte Award Watch. Il comprend plus de recherches enregistrées que le forfait Gratuit, l'envoi des recherches enregistrées par courriel et les avis d'appel d'offres du jour dans les listes d'appels d'offres, comme le décrit la page de facturation du compte. Toutes les pages publiques du site restent gratuites, sans compte. Allwater peut ajouter à Pro en tout temps; un changement qui retire quelque chose à Pro s'applique à compter du premier renouvellement suivant un avis.",
  },
  "terms.pro_prices_title": { en: "Prices and Taxes", fr: "Prix et taxes" },
  "terms.pro_prices": {
    en: "The prices are shown on the site, on the account's billing page, in Canadian dollars. Taxes are added at checkout according to the buyer's location. Allwater may change the prices; a new price applies from the first renewal at least 30 days after notice by email to the account's address, and a subscription can be cancelled before then.",
    fr: "Les prix sont affichés sur le site, à la page de facturation du compte, en dollars canadiens. Les taxes sont ajoutées au paiement selon le lieu de l'acheteur. Allwater peut modifier les prix; un nouveau prix s'applique à compter du premier renouvellement survenant au moins 30 jours après un avis envoyé par courriel à l'adresse du compte, et l'abonnement peut être annulé avant cette date.",
  },
  "terms.pro_renewal_title": { en: "Term and Renewal", fr: "Durée et renouvellement" },
  "terms.pro_renewal": {
    en: "A subscription is monthly or yearly and starts when the first payment is made. It renews automatically at the end of each period, at the price then in effect, until it is cancelled. The payment method on file is charged at each renewal.",
    fr: "Un abonnement est mensuel ou annuel et commence au premier paiement. Il se renouvelle automatiquement à la fin de chaque période, au prix alors en vigueur, jusqu'à son annulation. Le moyen de paiement enregistré est débité à chaque renouvellement.",
  },
  "terms.pro_cancel_title": { en: "Cancellation", fr: "Annulation" },
  "terms.pro_cancel": {
    en: "A subscription can be cancelled at any time from the account's billing page. The cancellation takes effect at the end of the period already paid, and Pro continues until then. The current period is not refunded, in whole or in part, except where the law requires a refund. Deleting the account cancels the subscription at once, without refund.",
    fr: "Un abonnement peut être annulé en tout temps depuis la page de facturation du compte. L'annulation prend effet à la fin de la période déjà payée, et Pro continue jusque-là. La période en cours n'est pas remboursée, en tout ou en partie, sauf si la loi exige un remboursement. La suppression du compte annule l'abonnement immédiatement, sans remboursement.",
  },
  "terms.pro_failed_title": { en: "Failed Payments", fr: "Paiements refusés" },
  "terms.pro_failed": {
    en: "If a renewal payment fails, the payment is retried and Pro continues for a short grace period. If it does not go through, the account returns to the Free plan: email delivery and same-day notices stop, and saved searches are kept.",
    fr: "Si un paiement de renouvellement échoue, il est tenté de nouveau et Pro continue pendant une courte période de grâce. S'il ne passe pas, le compte revient au forfait Gratuit : l'envoi par courriel et les avis du jour cessent, et les recherches enregistrées sont conservées.",
  },
  "terms.pro_abuse_title": { en: "Ending Service for Abuse", fr: "Fin du service en cas d'abus" },
  "terms.pro_abuse": {
    en: "Allwater may suspend or end an account and its subscription for abuse, including breaking these Terms, automated access beyond the published limits, sharing or reselling an account, getting around a limit or a payment, or use that harms the site or other people. When service ends for abuse, the current period is not refunded. If Allwater ends Pro for any other reason, it refunds the unused part of the current period.",
    fr: "Allwater peut suspendre ou fermer un compte et son abonnement en cas d'abus, notamment le non-respect des présentes conditions, un accès automatisé au-delà des limites publiées, le partage ou la revente d'un compte, le contournement d'une limite ou d'un paiement, ou un usage qui nuit au site ou à autrui. Lorsque le service prend fin pour abus, la période en cours n'est pas remboursée. Si Allwater met fin à Pro pour toute autre raison, elle rembourse la partie inutilisée de la période en cours.",
  },
  "terms.pro_law_title": { en: "Governing Law", fr: "Droit applicable" },
  "terms.pro_law": {
    en: "These Terms are governed by the laws of British Columbia and the federal laws of Canada that apply there, and disputes go to the courts of British Columbia. Nothing in these Terms limits a right that consumer protection law gives a buyer where they live.",
    fr: "Les présentes conditions sont régies par les lois de la Colombie-Britannique et les lois fédérales du Canada qui s'y appliquent, et les litiges relèvent des tribunaux de la Colombie-Britannique. Rien dans les présentes conditions ne limite un droit que la loi sur la protection du consommateur accorde à l'acheteur là où il réside.",
  },
  "terms.pro_changes_title": { en: "Changes to These Terms", fr: "Modifications des présentes conditions" },
  "terms.pro_changes": {
    en: "A change to these paid-plan terms applies to a subscription from its first renewal at least 30 days after notice by email to the account's address.",
    fr: "Une modification des conditions du forfait payant s'applique à un abonnement à compter de son premier renouvellement survenant au moins 30 jours après un avis envoyé par courriel à l'adresse du compte.",
  },
  "privacy.title": { en: "Privacy", fr: "Confidentialité" },
  "privacy.lead": {
    en: "What the site keeps about a visit, and what it never keeps.",
    fr: "Ce que le site conserve d'une visite, et ce qu'il ne conserve jamais.",
  },
  "privacy.toc_accounts": { en: "No Accounts", fr: "Aucun compte" },
  "privacy.accounts": { en: "The site has no accounts and no sign-in.", fr: "Le site n'a ni comptes ni connexion." },
  "privacy.toc_browser": { en: "Cookies and Browser Storage", fr: "Témoins et stockage du navigateur" },
  "privacy.cookie": {
    en: "The site sets one cookie, lang, which keeps the language you chose for a year. The theme you choose and your watchlist are kept in this browser's storage and are never sent to the site.",
    fr: "Le site dépose un seul témoin, lang, qui conserve pendant un an la langue choisie. Le thème choisi et votre liste de suivi sont conservés dans le stockage de ce navigateur et ne sont jamais transmis au site.",
  },
  "privacy.toc_counting": { en: "Counting Visits", fr: "Comptage des visites" },
  "privacy.counting": {
    en: "For each response it serves, the site records the route, the kind of request, the language, the country reported by the hosting network and the referring website's host name. It also records the method, the status, whether a crawler or a person's browser asked, and the device class (computer, phone or tablet). The route is the pattern of the address, the same for every profile page, never the address itself.",
    fr: "Pour chaque réponse qu'il sert, le site consigne la route, le type de requête, la langue, le pays indiqué par le réseau d'hébergement et le nom d'hôte du site d'où vient le visiteur. Il consigne aussi la méthode, le statut, si la requête vient d'un robot d'indexation ou du navigateur d'une personne, et la catégorie d'appareil (ordinateur, téléphone ou tablette). La route est le modèle de l'adresse, le même pour toutes les pages de profil, jamais l'adresse elle-même.",
  },
  "privacy.visitor": {
    en: "A request from a browser also gets a visitor code: a hash of the IP address and the browser's identification under a secret key that changes every day. The code only counts people per day. The site keeps no IP address, browser identification or cookie with the counts.",
    fr: "Une requête venant d'un navigateur reçoit aussi un code de visiteur : un hachage de l'adresse IP et de l'identification du navigateur sous une clé secrète qui change chaque jour. Le code sert seulement à compter les personnes par jour. Le site ne conserve aucune adresse IP, identification de navigateur ni témoin avec les comptes.",
  },
  "privacy.retention": {
    en: "The record of each response is deleted after 3 months. A daily summary of the counts is kept. The {data} page describes the counting in full.",
    fr: "Le relevé de chaque réponse est supprimé après 3 mois. Un résumé quotidien des comptes est conservé. La page {data} décrit le comptage en détail.",
  },
  "privacy.toc_feeds": { en: "Feeds", fr: "Fils Atom" },
  "privacy.feeds": {
    en: "When a feed reader fetches a feed, the site records the feed's file name and the number of subscribers the reader states, with the counts above. It keeps no address.",
    fr: "Lorsqu'un lecteur de fils télécharge un fil, le site consigne le nom du fichier du fil et le nombre d'abonnés qu'indique le lecteur, avec les comptes ci-dessus. Il ne conserve aucune adresse.",
  },
  "privacy.toc_forms": { en: "Forms", fr: "Formulaires" },
  "privacy.form_response": {
    en: "The response form stores the statement, the organization it concerns, the email address and the time it was received. The email address is used only to confirm that the statement comes from the organization, and it is never shown.",
    fr: "Le formulaire de réponse conserve la déclaration, l'organisation visée, l'adresse courriel et l'heure de réception. L'adresse courriel sert uniquement à confirmer que la déclaration vient de l'organisation, et elle n'est jamais affichée.",
  },
  "privacy.form_correction": {
    en: "The corrections form stores the page or record named, the correction, the organization when the page names one, the time it was received and the email address when one is given. The email address is used only to follow up on the correction, and it is never shown.",
    fr: "Le formulaire de correction conserve la page ou le dossier indiqué, la correction, l'organisation lorsque la page en nomme une, l'heure de réception et l'adresse courriel lorsqu'elle est donnée. L'adresse courriel sert uniquement à donner suite à la correction, et elle n'est jamais affichée.",
  },
  "privacy.form_review": { en: "Both are reviewed before anything is published.", fr: "Les deux sont examinés avant toute publication." },
  "privacy.toc_interest": { en: "Alert Interest", fr: "Intérêt pour les alertes" },
  "privacy.interest_kept": {
    en: "The alerts form stores the email address, the saved filter and the site's wording of it, the language of the page, the time it was received and a random token for the links in later messages. Once the message saying accounts are open has gone to the address, it stores when. It stores no IP address, browser identification or visitor code.",
    fr: "Le formulaire d'alertes conserve l'adresse courriel, le filtre enregistré et la formulation qu'en donne le site, la langue de la page, l'heure de réception et un jeton aléatoire pour les liens des messages à venir. Une fois le message annonçant l'ouverture des comptes envoyé à l'adresse, il en conserve le moment. Il ne conserve aucune adresse IP, identification de navigateur ni code de visiteur.",
  },
  "privacy.interest_use": {
    en: "The address is used for one message saying accounts are open, with a link to unsubscribe, and nothing else is sent to it. If an account is later made with the same address, the lists are offered to it as saved searches.",
    fr: "L'adresse sert à un seul message annonçant l'ouverture des comptes, avec un lien de désabonnement, et rien d'autre n'y est envoyé. Si un compte est ensuite créé avec la même adresse, les listes lui sont proposées comme recherches enregistrées.",
  },
  "privacy.interest_shown": { en: "The address is never shown or shared.", fr: "L'adresse n'est jamais affichée ni communiquée." },
  "privacy.interest_removal": {
    en: "To have it removed, use the unsubscribe link in that message or write to {email}. Removal is free of charge.",
    fr: "Pour la faire retirer, utilisez le lien de désabonnement de ce message ou écrivez à {email}. Le retrait est gratuit.",
  },
  "privacy.toc_third": { en: "Third Parties and Hosting", fr: "Tiers et hébergement" },
  "privacy.third": {
    en: "The pages load no third-party script, font, tracker or advertising.",
    fr: "Les pages ne chargent aucun script, police, traceur ni publicité de tiers.",
  },
  "privacy.hosting": {
    en: "The site is hosted on Cloudflare, which processes each request to serve the site. To keep the site available, Cloudflare counts requests per address over one minute. The site keeps no record of those counts.",
    fr: "Le site est hébergé par Cloudflare, qui traite chaque requête pour servir le site. Pour garder le site disponible, Cloudflare compte les requêtes par adresse sur une minute. Le site ne conserve aucun relevé de ces comptes.",
  },
  "privacy.toc_removal": { en: "Removal Requests", fr: "Demandes de retrait" },
  "privacy.removal": {
    en: "To ask for something to be removed, use the {form} or write to {email}. A removal request is never charged for.",
    fr: "Pour demander un retrait, utilisez le {form} ou écrivez à {email}. Une demande de retrait n'est jamais facturée.",
  },

  // -- the same-day mark (src/pro.tsx: SameDayMark, SameDayLegend) ---------------------
  // The words assistive technology reads in place of the bolt on a same-day row.
  "sameday.mark": { en: "Same-day notice", fr: "Avis du jour" },
  // Under the band, and on /tenders/same-day for every reader.
  "sameday.legend": {
    en: "A bolt marks a notice from today's same-day refresh, part of Pro.",
    fr: "Un éclair marque un avis de l'actualisation du jour, offerte avec Pro.",
  },
  // The Methodology page's list of sources, after the tender notices.
  "methodology.src_same_day": {
    en: "Same-day tender notices, part of Pro: CanadaBuys' file of the day's new notices, read every two hours through the Ottawa business day. They show above the tender lists, each marked with a bolt, until the next morning's refresh adds them there.",
    fr: "Avis d'appel d'offres du jour, offerts avec Pro : le fichier des nouveaux avis du jour d'AchatsCanada, lu toutes les deux heures pendant la journée de travail à Ottawa. Ils paraissent au-dessus des listes d'appels d'offres, chacun marqué d'un éclair, jusqu'à ce que la mise à jour du lendemain matin les y ajoute.",
  },

  // -- analytics, phase 2 (src/pages/analytics.tsx, docs/analytics.md) ----------------------
  "analytics.period_form": { en: "Choose the fiscal years", fr: "Choisir les exercices" },
  "analytics.period_from": { en: "From", fr: "De" },
  "analytics.period_to": { en: "To", fr: "À" },
  "analytics.period_show": { en: "Show these years", fr: "Afficher ces exercices" },
  "analytics.period_capped": {
    en: "At most {n} fiscal years are shown at once, so this view shows the latest {n} of the period chosen.",
    fr: "Au plus {n} exercices sont présentés à la fois; cette vue présente donc les {n} derniers de la période choisie.",
  },
  "analytics.free_more_buyer": {
    en: "It also gives the average and median value by fiscal year, the ten largest records, the change in value through amendments and the contracts ending in each of the next eight fiscal quarters, for any period of up to ten fiscal years.",
    fr: "Elle donne aussi la valeur moyenne et médiane par exercice, les dix dossiers de plus grande valeur, la variation de valeur par modifications et les contrats prenant fin pendant chacun des huit prochains trimestres, pour toute période d'au plus dix exercices.",
  },
  "analytics.free_more_organization": {
    en: "It also gives the ten largest records and the change in value through amendments, for any period of up to ten fiscal years.",
    fr: "Elle donne aussi les dix dossiers de plus grande valeur et la variation de valeur par modifications, pour toute période d'au plus dix exercices.",
  },
  "analytics.free_more_segment": {
    en: "It also gives the average and median value by fiscal year, the ten largest records and the contracts ending in each of the next eight fiscal quarters, for any period of up to ten fiscal years.",
    fr: "Elle donne aussi la valeur moyenne et médiane par exercice, les dix dossiers de plus grande valeur et les contrats prenant fin pendant chacun des huit prochains trimestres, pour toute période d'au plus dix exercices.",
  },
  "analytics.panel_values": { en: "Average and Median Value by Fiscal Year", fr: "Valeur moyenne et médiane par exercice" },
  "analytics.panel_records": { en: "Ten Largest Records", fr: "Dix dossiers de plus grande valeur" },
  "analytics.panel_growth": { en: "Change in Value Through Amendments", fr: "Variation de la valeur par modifications" },
  "analytics.panel_due": { en: "Contracts Ending in the Next Eight Quarters", fr: "Contrats prenant fin au cours des huit prochains trimestres" },
  "analytics.tease_values": {
    en: "The average and the median value of a record by fiscal year, with the count of records they rest on.",
    fr: "La valeur moyenne et la valeur médiane d'un dossier par exercice, avec le nombre de dossiers sur lequel elles reposent.",
  },
  "analytics.tease_records": {
    en: "The ten records with the largest values in the period, each linked to its notice or its government record.",
    fr: "Les dix dossiers aux valeurs les plus élevées de la période, chacun lié à son avis ou à son dossier gouvernemental.",
  },
  "analytics.tease_growth": {
    en: "By fiscal year of award, how many records were amended and how their values changed from the first version to the newest.",
    fr: "Par exercice d'attribution, le nombre de dossiers modifiés et la variation de leur valeur entre la première version et la plus récente.",
  },
  "analytics.tease_due": {
    en: "The contracts ending in each of the next eight fiscal quarters, count and value, each linked to the list of contracts ending soon.",
    fr: "Les contrats prenant fin pendant chacun des huit prochains trimestres, en nombre et en valeur, chacun lié à la liste des contrats prenant fin bientôt.",
  },
  "analytics.chart_median": { en: "Median value", fr: "Valeur médiane" },
  "analytics.chart_average": { en: "Average value", fr: "Valeur moyenne" },
  "analytics.chart_growth_first": { en: "Amended records: value of the first version", fr: "Dossiers modifiés : valeur de la première version" },
  "analytics.chart_growth_last": { en: "Amended records: value of the newest version", fr: "Dossiers modifiés : valeur de la version la plus récente" },
  "analytics.chart_due_value": { en: "Value of the contracts ending", fr: "Valeur des contrats prenant fin" },
  "analytics.chart_due_count": { en: "Contracts ending", fr: "Contrats prenant fin" },
  "analytics.due_aria": { en: "Chart by fiscal quarter", fr: "Graphique par trimestre d'exercice" },
  "analytics.col_valued": { en: "With a value", fr: "Avec valeur" },
  "analytics.col_median": { en: "Median", fr: "Médiane" },
  "analytics.col_average": { en: "Average", fr: "Moyenne" },
  "analytics.col_amended": { en: "Amended", fr: "Modifiés" },
  "analytics.col_compared": { en: "Compared", fr: "Comparés" },
  "analytics.col_first_value": { en: "First version", fr: "Première version" },
  "analytics.col_last_value": { en: "Newest version", fr: "Version la plus récente" },
  "analytics.col_change": { en: "Change", fr: "Variation" },
  "analytics.col_quarter": { en: "Fiscal quarter", fr: "Trimestre" },
  "analytics.col_quarter_ends": { en: "Quarter ends", fr: "Fin du trimestre" },
  "analytics.col_contracts": { en: "Contracts", fr: "Contrats" },
  "analytics.col_radar": { en: "Contracts ending soon", fr: "Contrats prenant fin bientôt" },
  "analytics.foot_values": {
    en: "Over the records with a counted value above zero. The average is their sum over their count; the median is the middle value, or for an even count the mean of the two middle values. Each panel has its own scale.",
    fr: "Sur les dossiers dont la valeur comptée est supérieure à zéro. La moyenne est leur somme divisée par leur nombre; la médiane est la valeur du milieu ou, pour un nombre pair, la moyenne des deux valeurs du milieu. Chaque graphique a sa propre échelle.",
  },
  "analytics.foot_records": {
    en: "Ranked by counted value; a value in another currency, one not published and one flagged for checking are not ranked. Titles are the English ones, or the French where none was published in English, cut at 120 characters.",
    fr: "Classés selon la valeur comptée; une valeur dans une autre devise, une valeur non publiée et une valeur signalée pour vérification ne sont pas classées. Les titres sont ceux publiés en anglais, ou en français à défaut, coupés à 120 caractères.",
  },
  "analytics.foot_growth": {
    en: "A record is amended when its source published a version after the first. An amended record is compared when its first version has a value above zero and its newest a counted value, each by the counting rules; a cancelled contract is not compared.",
    fr: "Un dossier est modifié lorsque sa source a publié une version après la première. Un dossier modifié est comparé lorsque sa première version a une valeur supérieure à zéro et la plus récente une valeur comptée, chacune selon les règles de calcul; un contrat annulé n'est pas comparé.",
  },
  "analytics.no_growth": {
    en: "Amendments are read from award notices and PSPC contract history, which number each version. Choose one of them.",
    fr: "Les modifications sont lues dans les avis d'attribution et l'historique des contrats de SPAC, qui numérotent chaque version. Choisissez l'une de ces sources.",
  },
  "analytics.growth_none": {
    en: "No amended record has both values to compare in these fiscal years.",
    fr: "Aucun dossier modifié n'a les deux valeurs à comparer pour ces exercices.",
  },
  "analytics.due_lead_buyer": {
    en: "The buyer's contracts ending in each fiscal quarter from the data date's, as the list of contracts ending soon counts them.",
    fr: "Les contrats de l'acheteur prenant fin pendant chaque trimestre à partir de celui de la date des données, comptés comme dans la liste des contrats prenant fin bientôt.",
  },
  "analytics.due_lead_segment": {
    en: "The segment's contracts ending in each fiscal quarter from the data date's, as the list of contracts ending soon counts them.",
    fr: "Les contrats du segment prenant fin pendant chaque trimestre à partir de celui de la date des données, comptés comme dans la liste des contrats prenant fin bientôt.",
  },
  "analytics.foot_due": {
    en: "Award notices, PSPC contract history and published contracts ending from {date}, each contract once by the list's duplicate rule, so these figures follow neither the source nor the period chosen above. Values in Canadian dollars; a value not published or flagged for checking is not added. The list's windows count days from its data date; each quarter links the narrowest window that holds all of it.",
    fr: "Avis d'attribution, historique des contrats de SPAC et contrats publiés prenant fin à partir du {date}, chaque contrat une seule fois selon la règle des doublons de la liste; ces chiffres ne suivent donc ni la source ni la période choisies plus haut. Valeurs en dollars canadiens; une valeur non publiée ou signalée pour vérification n'est pas additionnée. Les fenêtres de la liste comptent les jours depuis sa date des données; chaque trimestre renvoie à la plus étroite qui le contient en entier.",
  },
  "analytics.due_none": { en: "No contract ends in these quarters.", fr: "Aucun contrat ne prend fin pendant ces trimestres." },
  "methodology.analytics_period": {
    en: "A view covers the latest 3, 5 or 10 fiscal years, or the fiscal years chosen by their first and last, up to the data date's and at most ten at once; the period is part of the view's address.",
    fr: "Une vue couvre les 3, 5 ou 10 derniers exercices, ou les exercices choisis par le premier et le dernier, jusqu'à celui de la date des données et au plus dix à la fois; la période fait partie de l'adresse de la vue.",
  },
  "methodology.analytics_values": {
    en: "The average and the median value of a fiscal year are taken over the records with a counted value above zero, and the count beside them says how many. The median of an even count is the mean of the two middle values. A segment's figures count each notice in each of its segments, as its other figures do.",
    fr: "La valeur moyenne et la valeur médiane d'un exercice portent sur les dossiers dont la valeur comptée est supérieure à zéro, et le nombre indiqué à côté précise combien. La médiane d'un nombre pair est la moyenne des deux valeurs du milieu. Les chiffres d'un segment comptent chaque avis dans chacun de ses segments, comme ses autres chiffres.",
  },
  "methodology.analytics_growth": {
    en: "The change in value through amendments reads award notices and PSPC contract history by the fiscal year of the award. A record is amended when its source published a version after the first. Its first version's value (the total value when positive, else the amount) is set against its newest version's counted value; only records with a first value above zero and a counted newest value are compared, and a cancelled contract never is.",
    fr: "La variation de la valeur par modifications porte sur les avis d'attribution et l'historique des contrats de SPAC, par exercice d'attribution. Un dossier est modifié lorsque sa source a publié une version après la première. La valeur de sa première version (la valeur totale si elle est positive, sinon le montant) est comparée à la valeur comptée de sa version la plus récente; seuls les dossiers dont la première valeur est supérieure à zéro et la plus récente est comptée sont comparés, jamais un contrat annulé.",
  },
  "methodology.analytics_records": {
    en: "The ten largest records are ranked by counted value in the period and source. Each shows its title as published in English, or in French where no English title was published, with contact details removed and cut at 120 characters.",
    fr: "Les dix dossiers de plus grande valeur sont classés selon la valeur comptée pour la période et la source. Chacun affiche son titre publié en anglais, ou en français à défaut, sans coordonnées et coupé à 120 caractères.",
  },
  "methodology.analytics_due": {
    en: "The contracts ending by fiscal quarter follow the rules of Contracts Ending Soon, carried to the end of the eighth fiscal quarter from the data date's: the newest version's end date, no cancelled contract, each contract once across award notices, PSPC contract history and published contracts. A buyer's are the ones the list shows under that buyer; a segment's are counted in each of a notice's segments.",
    fr: "Les contrats prenant fin par trimestre suivent les règles de la section Contrats prenant fin bientôt, prolongées jusqu'à la fin du huitième trimestre à partir de celui de la date des données : la date de fin de la version la plus récente, aucun contrat annulé, chaque contrat une seule fois parmi les avis d'attribution, l'historique des contrats de SPAC et les contrats publiés. Ceux d'un acheteur sont ceux que la liste présente sous cet acheteur; ceux d'un segment sont comptés dans chacun des segments d'un avis.",
  },

  // -- site leftovers: UNSPSC levels, the code filter's names, yearly downloads -------
  // A segment page's families and classes (src/pages/segments.tsx, tenders/open-levels.json).
  "segment.levels": { en: "Families and Classes", fr: "Familles et classes" },
  "segment.col_level": { en: "Family or class", fr: "Famille ou classe" },
  "segment.levels_note": {
    en: "The UNSPSC families (4 digits) and classes (6 digits) the open notices' codes fall in, most notices first. A notice with codes in several counts in each. A count opens the tender list at that family or class.",
    fr: "Les familles (4 chiffres) et classes (6 chiffres) UNSPSC dont relèvent les codes des avis ouverts, du plus grand nombre d'avis au plus petit. Un avis dont les codes relèvent de plusieurs compte dans chacune. Un nombre ouvre la liste des appels d'offres à cette famille ou classe.",
  },
  "segment.levels_first": { en: "The {n} families with the most notices are listed.", fr: "Les {n} familles comptant le plus d'avis sont énumérées." },
  "segment.levels_names": {
    en: "Names are as the notices give them. A family or class that no notice names by its own code has none here.",
    fr: "Les noms sont ceux que donnent les avis. Une famille ou une classe qu'aucun avis ne nomme par son propre code n'en a pas ici.",
  },
  "segment.levels_unnamed": { en: "No name in the notices", fr: "Aucun nom dans les avis" },
  "segment.levels_more_one": { en: "{n} more class in the tender list", fr: "{n} autre classe dans la liste des appels d'offres" },
  "segment.levels_more_many": { en: "{n} more classes in the tender list", fr: "{n} autres classes dans la liste des appels d'offres" },
  // The tender list's code filter as a chip: the level its digits name, then the code and its name.
  "tenders.filter_family": { en: "UNSPSC family", fr: "Famille UNSPSC" },
  "tenders.filter_class": { en: "UNSPSC class", fr: "Classe UNSPSC" },
  // The Data page's yearly files of the two proactive-publication sources.
  "data.yearly_contracts": { en: "Published Contracts by Year of Contract Date", fr: "Contrats publiés par année de la date du contrat" },
  "data.yearly_grants": { en: "Grants and Contributions by Year of Agreement Start", fr: "Subventions et contributions par année de début de l'accord" },
  "data.downloads_closing": {
    en: "The open tender notices file is written once a night, so the closing states in it are as of the data date. Its closing times are Eastern time (ET), as CanadaBuys publishes them, with no zone written.",
    fr: "Le fichier des avis d'appel d'offres ouverts est écrit une fois par nuit : les états de clôture qu'il donne sont ceux de la date des données. Ses heures de clôture sont en heure de l'Est (HE), comme AchatsCanada les publie, sans fuseau indiqué.",
  },

  // -- the keyed API (src/api_keyed.ts; the Data page's section, pages/keyed_api.tsx) ----------
  "keyed.title": { en: "Keyed API", fr: "API avec clé" },
  "keyed.intro": {
    en: "With a key, the endpoints under {base} answer JSON from the same files and databases as the pages, with filters, paging and the records of the last ten fiscal years. Send the key in an {auth} header as a Bearer token, or in an {xkey} header. Every answer is for the key's holder alone and is never cached.",
    fr: "Avec une clé, les points d'accès sous {base} répondent en JSON à partir des mêmes fichiers et bases de données que les pages, avec filtres, pagination et les dossiers des dix derniers exercices. Envoyez la clé dans un en-tête {auth} comme jeton Bearer, ou dans un en-tête {xkey}. Chaque réponse est destinée au seul détenteur de la clé et n'est jamais mise en cache.",
  },
  "keyed.col_params": { en: "Parameters", fr: "Paramètres" },
  "keyed.no_params": { en: "None", fr: "Aucun" },
  "keyed.ep_open": {
    en: "The open notices, filtered and sorted as on the tender list, 100 a page",
    fr: "Les avis ouverts, filtrés et triés comme dans la liste des appels d'offres, 100 par page",
  },
  "keyed.ep_new": {
    en: "The notices first seen on one of the last 30 days, the newest day by default",
    fr: "Les avis vus pour la première fois l'un des 30 derniers jours, le plus récent par défaut",
  },
  "keyed.ep_expiring": {
    en: "Contracts ending within 3, 6 or 12 months of the data date, soonest first, 100 a page",
    fr: "Les contrats prenant fin dans les 3, 6 ou 12 mois suivant la date des données, les plus proches d'abord, 100 par page",
  },
  "keyed.ep_search": {
    en: "Organizations and buyers by name or business number, as on the search page, 50 organizations a page",
    fr: "Organisations et acheteurs par nom ou numéro d'entreprise, comme sur la page de recherche, 50 organisations par page",
  },
  "keyed.ep_org_records": {
    en: "One organization's records from one source, newest fiscal year first, 100 a page",
    fr: "Les dossiers d'une organisation pour une source, l'exercice le plus récent d'abord, 100 par page",
  },
  "keyed.ep_buyer_records": {
    en: "One buyer's records from one source, newest fiscal year first, 100 a page",
    fr: "Les dossiers d'un acheteur pour une source, l'exercice le plus récent d'abord, 100 par page",
  },
  "keyed.ep_me": {
    en: "The key's plan, its count for the day and its limits",
    fr: "Le forfait de la clé, son compte de la journée et ses limites",
  },
  "keyed.col_param": { en: "Parameter", fr: "Paramètre" },
  "keyed.col_values": { en: "Values", fr: "Valeurs" },
  "keyed.p_category": {
    en: "GD, SRV, CNST or SRVTGD, the tender list's categories; repeat it for several",
    fr: "GD, SRV, CNST ou SRVTGD, les catégories de la liste des appels d'offres; répétez-le pour en donner plusieurs",
  },
  "keyed.p_segment": {
    en: "A two-digit UNSPSC segment, such as 43; repeat it for several",
    fr: "Un segment UNSPSC à deux chiffres, comme 43; répétez-le pour en donner plusieurs",
  },
  "keyed.p_province": {
    en: "A province or territory code, such as ON; repeat it for several",
    fr: "Un code de province ou de territoire, comme ON; répétez-le pour en donner plusieurs",
  },
  "keyed.p_national": {
    en: "With a province given, 1 (the default) keeps the notices that name no province and 0 leaves them out",
    fr: "Avec une province donnée, 1 (par défaut) garde les avis qui ne nomment aucune province et 0 les écarte",
  },
  "keyed.p_code": {
    en: "2 to 8 digits that start a UNSPSC code (a family has 4, a class 6)",
    fr: "De 2 à 8 chiffres qui commencent un code UNSPSC (une famille en compte 4, une classe 6)",
  },
  "keyed.p_buyer": {
    en: "A buyer id, as in the address of a buyer's page",
    fr: "Un identifiant d'acheteur, comme dans l'adresse de la page d'un acheteur",
  },
  "keyed.p_type": {
    en: "A notice type as published in English, such as Request for Proposal",
    fr: "Un type d'avis tel que publié en anglais, comme Request for Proposal",
  },
  "keyed.p_method": {
    en: "A procurement method as published in English, such as Competitive - Open bidding",
    fr: "Une méthode d'approvisionnement telle que publiée en anglais, comme Competitive - Open bidding",
  },
  "keyed.p_closing": {
    en: "7 or 30, for the notices closing within that many days",
    fr: "7 ou 30, pour les avis dont la clôture tombe dans ce nombre de jours",
  },
  "keyed.p_q": {
    en: "Words to look for. On tenders/open, in titles, descriptions and references, at most {open} characters. On search, required: a name or a business number, of which the first eight words count.",
    fr: "Les mots à chercher. Sur tenders/open, dans les titres, les descriptions et les références, au plus {open} caractères. Sur search, obligatoire : un nom ou un numéro d'entreprise, dont les huit premiers mots comptent.",
  },
  "keyed.p_sort": {
    en: "closing (the default, soonest first) or published (newest first)",
    fr: "closing (par défaut, la clôture la plus proche d'abord) ou published (les plus récents d'abord)",
  },
  "keyed.p_day": {
    en: "A date as YYYY-MM-DD, one of the 30 days to the data date",
    fr: "Une date sous la forme AAAA-MM-JJ, l'un des 30 jours jusqu'à la date des données",
  },
  "keyed.p_source": {
    en: "Required: awards (award notices), history (PSPC contract history), contracts (published contracts) or grants (grants and contributions)",
    fr: "Obligatoire : awards (avis d'attribution), history (historique des contrats de SPAC), contracts (contrats publiés) ou grants (subventions et contributions)",
  },
  "keyed.p_year": {
    en: "One fiscal year by the year it starts in (2025 for 2025-26), within the last ten; all ten by default",
    fr: "Un exercice désigné par l'année où il commence (2025 pour 2025-2026), parmi les dix derniers; les dix par défaut",
  },
  "keyed.p_page": {
    en: "The page, from 1. A records list stops at page {records}; for more, start from the downloads.",
    fr: "La page, à partir de 1. Une liste de dossiers s'arrête à la page {records}; pour aller plus loin, partez des téléchargements.",
  },
  "keyed.answers": {
    en: "A list answers total, page, pages, per_page and rows, with data_as_of, the data date. A records list gives next_page in place of a total.",
    fr: "Une liste répond par total, page, pages, per_page et rows, avec data_as_of, la date des données. Une liste de dossiers donne next_page au lieu d'un total.",
  },
  "keyed.limits": {
    en: "Each key may make {minute} requests a minute and {day} a day, counted by UTC day. The limit of {address} API requests a minute from one address applies as well.",
    fr: "Chaque clé peut faire {minute} requêtes par minute et {day} par jour, comptées par jour UTC. La limite de {address} requêtes à l'API par minute depuis une même adresse s'applique aussi.",
  },
  "keyed.errors": {
    en: "An error answers JSON with an error field: 400 for a parameter the endpoint does not take or cannot use, 401 for a missing, unknown or revoked key, 403 for a key whose account is not on Pro, 404 for an address, id or page that does not exist, 429 past a limit (Retry-After says when to try again) and 503 while the data or the account service cannot be read.",
    fr: "Une erreur répond en JSON avec un champ error : 400 pour un paramètre que le point d'accès ne prend pas ou ne peut pas utiliser, 401 pour une clé absente, inconnue ou révoquée, 403 pour une clé dont le compte n'est pas au forfait Pro, 404 pour une adresse, un identifiant ou une page qui n'existe pas, 429 au-delà d'une limite (Retry-After indique quand réessayer) et 503 tant que les données ou le service des comptes ne peuvent pas être lus.",
  },
  "keyed.example": {
    en: "For example, the open notices for Ontario that close within 7 days:",
    fr: "Par exemple, les avis ouverts pour l'Ontario dont la clôture tombe dans les 7 jours :",
  },

  // -- a published contract (src/pages/published.tsx) ----------------------------------
  "published.title": { en: "Published Contract", fr: "Contrat publié" },
  "published.not_found": { en: "Published Contract Not Found", fr: "Contrat publié introuvable" },
  "published.not_found_text": {
    en: "The site holds no published contract {reference} for this department as of its last read of the file. The {search} may list it.",
    fr: "Le site ne détient aucun contrat publié {reference} pour ce ministère à sa dernière lecture du fichier. La {search} pourrait le présenter.",
  },
  "published.unavailable": {
    en: "This page is not available right now. The government's contracts search holds the record.",
    fr: "Cette page n'est pas disponible pour le moment. La recherche de contrats du gouvernement présente le dossier.",
  },
  "published.loading": {
    en: "The records database is being loaded again. This page returns when the load is finished; the government's contracts search holds the record.",
    fr: "La base des dossiers est en cours de rechargement. Cette page reviendra une fois le chargement terminé; la recherche de contrats du gouvernement présente le dossier.",
  },
  "published.search": { en: "Contracts search on open.canada.ca", fr: "Recherche de contrats sur ouvert.canada.ca" },
  "published.description": {
    en: "Published contract {reference}: {supplier}, contracted by {buyer} on {date}. Values, procedure, amendments and comments as published.",
    fr: "Contrat publié {reference} : {supplier}, conclu par {buyer} le {date}. Valeurs, mode d'invitation, modifications et commentaires tels que publiés.",
  },
  "published.value": { en: "Contract value", fr: "Valeur du contrat" },
  "published.original": { en: "Original value", fr: "Valeur initiale" },
  "published.amendment": { en: "Amendment value", fr: "Valeur de la modification" },
  "published.counted_flagged": {
    en: "Flagged for checking, left out of totals",
    fr: "Signalée pour vérification, exclue des totaux",
  },
  "published.group_total": { en: "Value counted, all versions", fr: "Valeur retenue, toutes les versions" },
  "published.value_note": {
    en: "The value counted is the row's own value by the {rules}: the amendment value on an amendment, else the original value, else the contract value. The versions' own values add up to the contract's.",
    fr: "La valeur retenue est la valeur propre de la ligne selon les {rules} : la valeur de la modification pour une modification, sinon la valeur initiale, sinon la valeur du contrat. Les valeurs propres des versions s'additionnent pour donner celle du contrat.",
  },
  "published.contract_date": { en: "Contract date", fr: "Date du contrat" },
  "published.period": { en: "Reporting period", fr: "Période de déclaration" },
  "published.window_newest": {
    en: "The radar reads a contract's end from its newest version, listed below.",
    fr: "Le radar lit la fin d'un contrat dans sa version la plus récente, présentée ci-dessous.",
  },
  "published.procedure": { en: "Solicitation procedure", fr: "Mode d'invitation" },
  "published.commodity": { en: "Commodity type", fr: "Type de marchandise" },
  "published.agreement": { en: "Agreement type", fr: "Type d'accord" },
  "published.limited_reason": { en: "Limited tendering reason", fr: "Raison de l'appel d'offres limité" },
  "published.bids": { en: "Number of bids", fr: "Nombre de soumissions" },
  "published.standing_offer": { en: "Standing offer number", fr: "Numéro de l'offre à commandes" },
  "published.codes_note": {
    en: "Codes as the department published them, from the Treasury Board's reporting guide.",
    fr: "Codes tels que le ministère les a publiés, selon le guide de déclaration du Conseil du Trésor.",
  },
  "published.inst_C": { en: "Contract", fr: "Contrat" },
  "published.inst_A": { en: "Amendment", fr: "Modification" },
  "published.inst_SO": { en: "Standing offer", fr: "Offre à commandes" },
  "published.inst_SA": { en: "Supply arrangement", fr: "Arrangement en matière d'approvisionnement" },
  "published.comments": { en: "Comments as Published", fr: "Commentaires publiés" },
  "published.versions": { en: "Versions of This Contract", fr: "Versions de ce contrat" },
  "published.versions_more": { en: "{n} or more", fr: "{n} ou plus" },
  "published.versions_cut": {
    en: "The first {n} other rows with this procurement number, oldest first.",
    fr: "Les {n} premières autres lignes portant ce numéro d'approvisionnement, de la plus ancienne à la plus récente.",
  },
  "published.newest": { en: "Newest", fr: "Plus récente" },
  "published.provenance": {
    en: "Read from {file} in the {dataset}, last read {read}; this page as of the records of {as_of} (see {data}).",
    fr: "Lu dans {file} du jeu {dataset}, lu pour la dernière fois le {read}; cette page selon les dossiers du {as_of} (voir {data}).",
  },

  // -- the radar over its whole window (src/pages/expiring.tsx, src/records_tables.ts) ----
  "expiring.sort_end": { en: "End date, soonest first", fr: "Date de fin, la plus proche d'abord" },
  "expiring.sort_value": { en: "Value, largest first", fr: "Valeur, la plus élevée d'abord" },
  "expiring.whole_match_one": { en: "{n} contract matches", fr: "{n} contrat correspond" },
  "expiring.whole_match_many": { en: "{n} contracts match", fr: "{n} contrats correspondent" },
  "expiring.whole_note": {
    en: "The filters and the order apply to the whole window: {n} of its {rows} contracts, worth {total}.",
    fr: "Les filtres et l'ordre s'appliquent à toute la période : {n} de ses {rows} contrats, d'une valeur de {total}.",
  },
  "expiring.whole_no_value": {
    en: "{n} of them published no value, which the total leaves out.",
    fr: "{n} d'entre eux n'ont publié aucune valeur, ce que le total exclut.",
  },
  "expiring.whole_none": { en: "No contract in the window matches these filters.", fr: "Aucun contrat de la période ne correspond à ces filtres." },
  "expiring.csv_filtered": { en: "Download these contracts (CSV)", fr: "Télécharger ces contrats (CSV)" },
  "expiring.csv_cut": { en: "The file holds the first {n}.", fr: "Le fichier contient les {n} premiers." },
  "methodology.expiring_filters": {
    en: "The filters (buyer, client department, organization, segment, method, value band, source, the March 31 and standing offer marks) and the order by value apply to the whole window. The matches as a CSV file are part of Pro.",
    fr: "Les filtres (acheteur, ministère client, organisation, segment, méthode, tranche de valeur, source, les marques du 31 mars et des offres à commandes) et l'ordre par valeur s'appliquent à toute la période. Les contrats retenus en fichier CSV font partie de Pro.",
  },
  "expiring.csv_filtered_pro": {
    en: "These contracts as a CSV file, in the order shown, are part of Pro.",
    fr: "Ces contrats en fichier CSV, dans l'ordre affiché, sont offerts avec Pro.",
  },

  // -- the record tables (src/pages/records.tsx) ----------------------------------------
  "records.title": { en: "Records", fr: "Dossiers" },
  "records.title_of": { en: "Records of {name}", fr: "Dossiers de {name}" },
  "records.crumb": { en: "Records", fr: "Dossiers" },
  "records.eyebrow": { en: "Record table", fr: "Tableau des dossiers" },
  "records.link": { en: "Record table", fr: "Tableau des dossiers" },
  "records.description_organization": {
    en: "Every award notice, contract history record, published contract and grant naming {name}, newest first, with filters.",
    fr: "Chaque avis d'attribution, dossier de l'historique des contrats, contrat publié et subvention nommant {name}, du plus récent au plus ancien, avec des filtres.",
  },
  "records.description_buyer": {
    en: "Every award notice, contract history record, published contract and grant of {name}, newest first, with filters.",
    fr: "Chaque avis d'attribution, dossier de l'historique des contrats, contrat publié et subvention de {name}, du plus récent au plus ancien, avec des filtres.",
  },
  "records.lead_organization": {
    en: "Award notices, contract history records, published contracts and grants naming this organization, fiscal years {first} to {last}.",
    fr: "Avis d'attribution, dossiers de l'historique des contrats, contrats publiés et subventions nommant cette organisation, exercices {first} à {last}.",
  },
  "records.lead_buyer": {
    en: "Award notices, contract history records, published contracts and grants of this buyer, fiscal years {first} to {last}.",
    fr: "Avis d'attribution, dossiers de l'historique des contrats, contrats publiés et subventions de cet acheteur, exercices {first} à {last}.",
  },
  "records.unavailable_title": { en: "The Record Table Is Not Available Right Now", fr: "Tableau des dossiers non disponible pour le moment" },
  "records.unavailable_loading": {
    en: "The records database is being loaded again. The record table returns when the load is finished.",
    fr: "La base des dossiers est en cours de rechargement. Le tableau des dossiers reviendra une fois le chargement terminé.",
  },
  "records.back_organization": { en: "Back to the profile", fr: "Retour au profil" },
  "records.back_buyer": { en: "Back to the buyer page", fr: "Retour à la page de l'acheteur" },
  "records.year": { en: "Fiscal year", fr: "Exercice" },
  "records.year_all": { en: "All {n} years", fr: "Les {n} exercices" },
  "records.sort_newest": { en: "Newest first", fr: "Les plus récents d'abord" },
  "records.heading": { en: "Records", fr: "Dossiers" },
  "records.count_one": { en: "{n} record", fr: "{n} dossier" },
  "records.count_many": { en: "{n} records", fr: "{n} dossiers" },
  "records.free_asked": { en: "The filters and later pages are set aside here.", fr: "Les filtres et les pages suivantes sont mis de côté ici." },
  "records.free_note": {
    en: "These are the newest {n} records. The filters by year, party, source and method, the order by value, every later page and the CSV file are part of Pro.",
    fr: "Voici les {n} dossiers les plus récents. Les filtres par exercice, partie, source et méthode, l'ordre par valeur, les pages suivantes et le fichier CSV font partie de Pro.",
  },
  "records.total": { en: "Value counted: {total}.", fr: "Valeur retenue : {total}." },
  "records.csv": { en: "Download these records (CSV)", fr: "Télécharger ces dossiers (CSV)" },
  "records.csv_pro": { en: "These records as a CSV file are part of Pro.", fr: "Ces dossiers en fichier CSV font partie de Pro." },
  "records.none": { en: "No record matches.", fr: "Aucun dossier ne correspond." },
  "records.note": {
    en: "Records as of {as_of}, each counted once by the rules on the Methodology page. A value in another currency, not published or flagged for checking reads as not stated and stays out of the total.",
    fr: "Dossiers au {as_of}, chacun compté une fois selon les règles de la page Méthodologie. Une valeur en une autre devise, non publiée ou signalée pour vérification se lit comme non indiquée et reste hors du total.",
  },

  // -- the records backbone on the tender, buyer, segment and profile pages (src/pages/backbone.tsx)
  "earlier.heading": { en: "Earlier Awards Like This One", fr: "Attributions antérieures semblables" },
  "earlier.unavailable": { en: "Earlier awards are not available right now.", fr: "Les attributions antérieures ne sont pas disponibles pour le moment." },
  "earlier.note": {
    en: "Up to {n} records of this buyer from the last {years} fiscal years that share a UNSPSC class with this notice, the closest titles first.",
    fr: "Jusqu'à {n} dossiers de cet acheteur des {years} derniers exercices qui partagent une classe UNSPSC avec cet avis, les titres les plus proches d'abord.",
  },
  "earlier.none": {
    en: "No record of this buyer in the last {years} fiscal years shares a UNSPSC class with this notice.",
    fr: "Aucun dossier de cet acheteur des {years} derniers exercices ne partage de classe UNSPSC avec cet avis.",
  },
  "incumbents.heading": { en: "Who Holds the Contracts Ending Within 12 Months", fr: "Qui détient les contrats qui prennent fin d'ici 12 mois" },
  "incumbents.unavailable": { en: "This list is not available right now.", fr: "Cette liste n'est pas disponible pour le moment." },
  "incumbents.none": { en: "No contract naming an organization ends within 12 months.", fr: "Aucun contrat nommant une organisation ne prend fin d'ici 12 mois." },
  "incumbents.note_one": {
    en: "{n} organization holds the contracts ending within 12 months, from the radar; the largest values first, up to {max}.",
    fr: "{n} organisation détient les contrats qui prennent fin d'ici 12 mois, selon le radar; les valeurs les plus élevées d'abord, jusqu'à {max}.",
  },
  "incumbents.note_many": {
    en: "{n} organizations hold the contracts ending within 12 months, from the radar; the largest values first, up to {max}.",
    fr: "{n} organisations détiennent les contrats qui prennent fin d'ici 12 mois, selon le radar; les valeurs les plus élevées d'abord, jusqu'à {max}.",
  },
  "incumbents.soonest": { en: "Soonest end", fr: "Fin la plus proche" },
  "incumbents.pro": {
    en: "The first {n} are shown. The whole list is part of Pro.",
    fr: "Les {n} premières sont affichées. La liste complète fait partie de Pro.",
  },
  "orgfeed.title": { en: "Records", fr: "Dossiers" },
  "orgfeed.subtitle": {
    en: "The newest 50 award notices, contract history records, published contracts and grants naming the organization.",
    fr: "Les 50 avis d'attribution, dossiers de l'historique des contrats, contrats publiés et subventions les plus récents nommant l'organisation.",
  },
  "orgfeed.button": { en: "Records feed", fr: "Fil des dossiers" },
  // -- search framing (docs/seo.md): the Pro page (src/pages/pro.tsx), the
  // footer's link to it, the tease panel's second button, and the home page's
  // "What You Can Do Here" lines. {monthly} and {yearly} are the operator's
  // figures from wrangler.jsonc, never written here.
  "footer.pro": { en: "Pro plan", fr: "Forfait Pro" },
  "pro.about_button": { en: "About Pro", fr: "À propos de Pro" },
  "propage.title": { en: "Pro: What the Paid Plan Adds", fr: "Pro : ce qu'ajoute le forfait payant" },
  "propage.lead": {
    en: "Pro is the paid plan of Award Watch, for people who bid on federal work or follow who wins it. It adds same-day tender notices, the full lists of contracts ending within 6 and 12 months, saved searches sent by email, analytics of each buyer, organization and segment, and a keyed API. Every page you can read today stays free.",
    fr: "Pro est le forfait payant d'Award Watch, pour qui soumissionne aux marchés fédéraux ou suit qui les remporte. Il ajoute les avis d'appel d'offres du jour même, les listes complètes des contrats prenant fin d'ici 6 et 12 mois, l'envoi des recherches enregistrées par courriel, les analyses de chaque acheteur, organisation et segment, et une API à clé. Toutes les pages que vous lisez aujourd'hui restent gratuites.",
  },
  "propage.records": {
    en: "Every record of an organization or a buyer in one table, with its filters, its pages and a CSV file; the Free plan sees the newest {n}.",
    fr: "Tous les dossiers d'une organisation ou d'un acheteur dans un tableau, avec ses filtres, ses pages et un fichier CSV; le forfait Gratuit voit les {n} plus récents.",
  },
  "propage.incumbents": {
    en: "The whole list of who holds a buyer's or a segment's contracts ending within 12 months; the Free plan sees the first {n}.",
    fr: "La liste complète de qui détient les contrats d'un acheteur ou d'un segment prenant fin d'ici 12 mois; le forfait Gratuit voit les {n} premiers.",
  },
  "propage.api": {
    en: "A keyed API for scripts: the open tenders, each day's new notices, the contracts ending in each window, search, and each organization's and buyer's records, up to {day} requests a day and {minute} a minute.",
    fr: "Une API à clé pour les scripts : les appels d'offres ouverts, les nouveaux avis de chaque jour, les contrats prenant fin dans chaque période, la recherche et les dossiers de chaque organisation et acheteur, jusqu'à {day} requêtes par jour et {minute} par minute.",
  },
  "propage.feeds": {
    en: "A calendar feed of each saved tender search for Google Calendar, Outlook or Apple Calendar: each open notice's closing as an event, moved when an amendment moves it. Any notice or contract page also offers its date as a file, free.",
    fr: "Un flux de calendrier pour chaque recherche d'appels d'offres enregistrée, pour Google Agenda, Outlook ou Calendrier d'Apple : la clôture de chaque avis ouvert comme événement, déplacée quand une modification la déplace. Chaque page d'avis ou de contrat offre aussi sa date en fichier, gratuitement.",
  },
  "propage.who_title": { en: "Who It Is For", fr: "À qui il s'adresse" },
  "propage.who_bid": {
    en: "Bid writers and small suppliers who want a notice the day CanadaBuys posts it, not the next morning.",
    fr: "Les rédacteurs de soumissions et les petits fournisseurs qui veulent un avis le jour où AchatsCanada le publie, et non le lendemain.",
  },
  "propage.who_capture": {
    en: "Capture and business development staff who track which contracts in their field end within the year, who holds them and how they were awarded.",
    fr: "Les équipes de développement des affaires qui suivent les contrats de leur domaine qui prennent fin dans l'année, qui les détient et comment ils ont été attribués.",
  },
  "propage.who_research": {
    en: "Consultants, researchers and journalists who follow a department, a supplier or a segment over several fiscal years and want the tables as CSV.",
    fr: "Les consultants, chercheurs et journalistes qui suivent un ministère, un fournisseur ou un segment sur plusieurs exercices et veulent les tableaux en CSV.",
  },
  "propage.free_title": { en: "What Stays Free", fr: "Ce qui reste gratuit" },
  "propage.free_text": {
    en: "Every page of the site, without an account: the open tenders and each day's new notices from the nightly refresh, every award notice, organization profile and buyer page, the contracts ending within 3 months, the CSV downloads, the open JSON API and the Atom feeds.",
    fr: "Toutes les pages du site, sans compte : les appels d'offres ouverts et les nouveaux avis de chaque jour selon la mise à jour de nuit, chaque avis d'attribution, profil d'organisation et page d'acheteur, les contrats prenant fin d'ici 3 mois, les téléchargements CSV, l'API JSON ouverte et les fils Atom.",
  },
  "propage.sign_in_note": {
    en: "An account needs only an email address: the site sends a code to sign in, and there is no password.",
    fr: "Un compte ne demande qu'une adresse courriel : le site envoie un code pour se connecter, sans mot de passe.",
  },
  "propage.billing": { en: "Plan and billing", fr: "Forfait et facturation" },
  "propage.faq_title": { en: "Common Questions", fr: "Questions fréquentes" },
  "propage.q_price": { en: "What does Pro cost?", fr: "Combien coûte Pro?" },
  "propage.a_price": {
    en: "CA${monthly} a month or CA${yearly} a year, in Canadian dollars. Taxes are added at checkout according to the buyer's location.",
    fr: "{monthly} $ CA par mois ou {yearly} $ CA par année, en dollars canadiens. Les taxes sont ajoutées au paiement selon le lieu de l'acheteur.",
  },
  "propage.q_free": { en: "Do I need Pro to read the site?", fr: "Faut-il Pro pour consulter le site?" },
  "propage.a_free": {
    en: "No. Every page stays free to read without an account, along with the CSV downloads, the open JSON API and the Atom feeds.",
    fr: "Non. Toutes les pages restent gratuites, sans compte, tout comme les téléchargements CSV, l'API JSON ouverte et les fils Atom.",
  },
  "propage.q_alerts": { en: "How do the email alerts work?", fr: "Comment fonctionnent les alertes par courriel?" },
  "propage.a_alerts": {
    en: "Save a filtered tender list or radar window, or an organization, a buyer or a segment, and choose daily or weekly email. Each message lists what is new since the last one. Pro keeps up to {n} saved searches.",
    fr: "Enregistrez une liste d'appels d'offres ou une période du radar filtrée, ou une organisation, un acheteur ou un segment, puis choisissez un courriel quotidien ou hebdomadaire. Chaque message énumère ce qui est nouveau depuis le précédent. Pro conserve jusqu'à {n} recherches.",
  },
  "propage.q_source": { en: "Where does the data come from?", fr: "D'où viennent les données?" },
  "propage.a_source": {
    en: "From the Government of Canada's open data: CanadaBuys tender and award notices, PSPC contract history, the contracts over $10,000 and the grants departments publish, and the Registry of Lobbyists. The site reads them every night; the same-day notices are read from CanadaBuys every two hours through the business day.",
    fr: "Des données ouvertes du gouvernement du Canada : les avis d'appel d'offres et d'attribution d'AchatsCanada, l'historique des contrats de SPAC, les contrats de plus de 10 000 $ et les subventions que publient les ministères, et le Registre des lobbyistes. Le site les lit chaque nuit; les avis du jour même sont lus sur AchatsCanada toutes les deux heures pendant la journée de travail.",
  },
  "propage.q_cancel": { en: "Can I cancel?", fr: "Puis-je annuler?" },
  "propage.q_seller": { en: "Who sells Pro?", fr: "Qui vend Pro?" },
  "propage.a_seller": {
    en: "Pro is sold through Link, the merchant of record run by Stripe, on behalf of Allwater Software Inc., the British Columbia corporation that publishes Award Watch. Card details go to Stripe and never reach this site; Link sends the receipts.",
    fr: "Pro est vendu par l'intermédiaire de Link, le marchand officiel exploité par Stripe, pour le compte d'Allwater Software Inc., la société de la Colombie-Britannique qui publie Award Watch. Les données de carte vont à Stripe et n'atteignent jamais ce site; Link envoie les reçus.",
  },
  "home.lead_n": {
    en: "The tender notices open on CanadaBuys, who won the contracts awarded after them, and the contracts ending within a year, with a page for each department and for each of the {n} organizations the records name. From the Government of Canada's open data, refreshed nightly.",
    fr: "Les avis d'appel d'offres ouverts sur AchatsCanada, qui a remporté les contrats attribués ensuite et les contrats qui prennent fin d'ici un an, avec une page pour chaque ministère et pour chacune des {n} organisations que nomment les dossiers. D'après les données ouvertes du gouvernement du Canada, mises à jour chaque nuit.",
  },
  "home.do_heading": { en: "What You Can Do Here", fr: "Ce que vous pouvez faire ici" },
  "home.do_tenders_link": { en: "Watch tenders", fr: "Suivre les appels d'offres" },
  "home.do_tenders": {
    en: "{link}: the open notices by segment, region, buyer and closing date, and the new ones each day.",
    fr: "{link} : les avis ouverts par segment, région, acheteur et date de clôture, et les nouveaux de chaque jour.",
  },
  "home.do_awards_link": { en: "Find who wins", fr: "Voir qui gagne" },
  "home.do_awards": {
    en: "{link}: each award notice with its supplier and value, and each supplier's and department's records over the years.",
    fr: "{link} : chaque avis d'attribution avec son fournisseur et sa valeur, et les dossiers de chaque fournisseur et ministère au fil des ans.",
  },
  "home.do_expiring_link": { en: "See what ends soon", fr: "Voir ce qui prend fin" },
  "home.do_expiring": {
    en: "{link}: contracts ending within 3, 6 and 12 months, with the incumbent, the method and the amendments.",
    fr: "{link} : les contrats prenant fin d'ici 3, 6 et 12 mois, avec le fournisseur en place, la méthode et les modifications.",
  },
  "home.do_pro_link": { en: "Get it by email with Pro", fr: "Tout recevoir par courriel avec Pro" },
  "home.do_pro": {
    en: "{link}: saved searches sent daily or weekly, and the notices CanadaBuys posts during the day.",
    fr: "{link} : les recherches enregistrées envoyées chaque jour ou chaque semaine, et les avis qu'AchatsCanada publie pendant la journée.",
  },

  // -- buyer merges: one buyer per institution, its other names, the institutions listed apart (2026-11-06) --
  "buyers.panel_departments": {
    en: "Departments, Agencies and Crown Corporations",
    fr: "Ministères, organismes et sociétés d'État",
  },
  "buyers.panel_institutions": { en: "Other Institutions", fr: "Autres institutions" },
  "buyers.institutions_note": {
    en: "Institutions the lobbying registry names that publish no tenders or contracts in these sources: offices of Parliament, Members of the House of Commons and the like.",
    fr: "Institutions que nomme le registre des lobbyistes et qui ne publient ni appel d'offres ni contrat dans ces sources : bureaux du Parlement, députés de la Chambre des communes et autres.",
  },
  "buyers.col_institution": { en: "Institution name", fr: "Nom de l'institution" },
  "buyers.col_lobbying": { en: "Lobbying reports", fr: "Rapports de lobbying" },
  "buyer.kind_institution": { en: "Institution named in lobbying reports", fr: "Institution nommée dans des rapports de lobbying" },
  "buyer.also": { en: "Also appears as:", fr: "Apparaît aussi sous :" },
  "buyer.former_name": { en: "former name", fr: "ancien nom" },
  "buyer.lobbying": {
    en: "Lobbying communication reports naming this institution: {n}.",
    fr: "Rapports de communication de lobbying nommant cette institution : {n}.",
  },
  "methodology.buyers_merges": {
    en: "One institution is one buyer, whatever name it appears under. A reviewed list of aliases ties former names to the department that carries their work today (Revenue Canada to the Canada Revenue Agency, HRSDC to Employment and Social Development Canada) and the other ways the sources write a name (Department of National Defense, Parks Canada Agency). When two buyer IDs turn out to be one institution, their records are joined under one ID, the old ID's pages redirect to it, and its page lists the other names under Also appears as. Institutions the lobbying registry names that publish no tenders or contracts, such as offices of Parliament, are listed apart from the departments.",
    fr: "Une institution est un seul acheteur, quel que soit le nom sous lequel elle paraît. Une liste révisée d'alias relie les anciens noms au ministère qui fait leur travail aujourd'hui (Revenu Canada à l'Agence du revenu du Canada, RHDCC à Emploi et Développement social Canada) et les autres façons dont les sources écrivent un nom (Department of National Defense, Agence Parcs Canada). Lorsque deux identifiants d'acheteur désignent une même institution, leurs dossiers sont réunis sous un seul identifiant, les pages de l'ancien redirigent vers lui, et sa page donne les autres noms sous Apparaît aussi sous. Les institutions que nomme le registre des lobbyistes et qui ne publient ni appel d'offres ni contrat, comme les bureaux du Parlement, sont présentées à part des ministères.",
  },
  // -- standing offers and supply arrangements (src/pages/instruments.tsx, docs/sosa.md) --------
  "instruments.title": { en: "Standing Offers and Supply Arrangements", fr: "Offres à commandes et arrangements en matière d'approvisionnement" },
  "instruments.seo_title": { en: "Standing Offers and Supply Arrangements | Award Watch", fr: "Offres à commandes et arrangements | Award Watch" },
  "instruments.description": {
    en: "Every active federal standing offer and supply arrangement, with its holders, regions and expiry, from PSPC's weekly open data file.",
    fr: "Chaque offre à commandes et arrangement en matière d'approvisionnement fédéral actif, avec ses titulaires, ses régions et son expiration.",
  },
  "instruments.lead_one": {
    en: "{n} standing offer or supply arrangement active in the file Public Services and Procurement Canada publishes each week under the Open Government Licence, in its edition of {date}.",
    fr: "{n} offre à commandes ou arrangement en matière d'approvisionnement actif dans le fichier que Services publics et Approvisionnement Canada publie chaque semaine sous la Licence du gouvernement ouvert, dans son édition du {date}.",
  },
  "instruments.lead_many": {
    en: "{n} standing offers and supply arrangements active in the file Public Services and Procurement Canada publishes each week under the Open Government Licence, in its edition of {date}.",
    fr: "{n} offres à commandes et arrangements en matière d'approvisionnement actifs dans le fichier que Services publics et Approvisionnement Canada publie chaque semaine sous la Licence du gouvernement ouvert, dans son édition du {date}.",
  },
  "instruments.lead_none": {
    en: "The weekly file of standing offers and supply arrangements that Public Services and Procurement Canada publishes has not been read yet.",
    fr: "Le fichier hebdomadaire des offres à commandes et des arrangements en matière d'approvisionnement que publie Services publics et Approvisionnement Canada n'a pas encore été lu.",
  },
  "instruments.status_failed": {
    en: "The last weekly read of the file failed; the rows shown are those of the edition of {date}.",
    fr: "La dernière lecture hebdomadaire du fichier a échoué; les lignes affichées sont celles de l'édition du {date}.",
  },
  "instruments.status_held": {
    en: "The newest edition holds far fewer rows than the one before and is held for review; the rows shown are those of the edition of {date}.",
    fr: "La plus récente édition compte beaucoup moins de lignes que la précédente et est retenue pour vérification; les lignes affichées sont celles de l'édition du {date}.",
  },
  "instruments.search_link": { en: "CanadaBuys standing offer search", fr: "Recherche d'offres à commandes d'AchatsCanada" },
  "instruments.dataset_link": { en: "The open data file", fr: "Le fichier de données ouvertes" },
  "instruments.page_not_found": { en: "Page Not Found", fr: "Page introuvable" },
  "instruments.type_SA": { en: "Supply arrangement", fr: "Arrangement en matière d'approvisionnement" },
  "instruments.type_NMSO": { en: "National master standing offer", fr: "Offre à commandes principale et nationale" },
  "instruments.type_DISO": { en: "Departmental individual standing offer", fr: "Offre à commandes individuelle ministérielle" },
  "instruments.type_RISO": { en: "Regional individual standing offer", fr: "Offre à commandes individuelle régionale" },
  "instruments.type_RMSO": { en: "Regional master standing offer", fr: "Offre à commandes principale régionale" },
  "instruments.type_OTHER": { en: "Other type", fr: "Autre type" },
  "instruments.region_FD": { en: "Foreign delivery", fr: "Livraison à l'étranger" },
  "instruments.region_NA": { en: "National (all regions)", fr: "National (toutes les régions)" },
  "instruments.region_NC": { en: "National Capital Region", fr: "Région de la capitale nationale" },
  "instruments.col_instrument": { en: "Description and number", fr: "Description et numéro" },
  "instruments.col_type": { en: "Instrument type", fr: "Type d'instrument" },
  "instruments.col_commodity": { en: "Commodity (GSIN)", fr: "Produit (NIBS)" },
  "instruments.col_user": { en: "End user", fr: "Utilisateur final" },
  "instruments.col_regions": { en: "Regions", fr: "Régions" },
  "instruments.col_expiry": { en: "Expires", fr: "Expiration" },
  "instruments.col_holders": { en: "Holders", fr: "Titulaires" },
  "instruments.col_active": { en: "Active instruments", fr: "Instruments actifs" },
  "instruments.holders_withheld": { en: "{n}, {w} withheld", fr: "{n}, dont {w} retirés" },
  "instruments.filter_region": { en: "Region", fr: "Région" },
  "instruments.filter_within": { en: "Expires within", fr: "Expire d'ici" },
  "instruments.within_any": { en: "Any date", fr: "Toute date" },
  "instruments.within_3": { en: "3 months", fr: "3 mois" },
  "instruments.within_6": { en: "6 months", fr: "6 mois" },
  "instruments.within_12": { en: "12 months", fr: "12 mois" },
  "instruments.no_segment": { en: "No segment", fr: "Aucun segment" },
  "instruments.sort_expiry": { en: "Soonest expiry", fr: "Expiration la plus proche" },
  "instruments.sort_holders": { en: "Most holders", fr: "Le plus de titulaires" },
  "instruments.match_one": { en: "{n} instrument matches", fr: "{n} instrument correspond" },
  "instruments.match_many": { en: "{n} instruments match", fr: "{n} instruments correspondent" },
  "instruments.days_left_one": { en: "{date} ({n} day left)", fr: "{date} ({n} jour restant)" },
  "instruments.days_left_many": { en: "{date} ({n} days left)", fr: "{date} ({n} jours restants)" },
  "instruments.expired_on": { en: "{date} (expired)", fr: "{date} (expiré)" },
  "instruments.none": { en: "No instrument matches these filters.", fr: "Aucun instrument ne correspond à ces filtres." },
  "instruments.none_published": { en: "No instrument is listed yet.", fr: "Aucun instrument n'est encore répertorié." },
  "instruments.note": {
    en: "Standing offers and supply arrangements carry no value and are not contracts, so the radar of contracts ending leaves them out. A segment is inherited from the award and tender notices that share an instrument's solicitation number; an instrument no notice shares it with has none.",
    fr: "Les offres à commandes et les arrangements en matière d'approvisionnement n'ont pas de valeur et ne sont pas des contrats; le radar des contrats qui prennent fin les laisse donc de côté. Un segment vient des avis d'attribution et d'appel d'offres qui partagent le numéro de demande de soumissions d'un instrument; un instrument qu'aucun avis ne partage n'en a pas.",
  },
  "instruments.csv": { en: "CSV of this view", fr: "CSV de cette vue" },
  "instruments.csv_cut": { en: "The file holds the first {n}.", fr: "Le fichier contient les {n} premiers." },
  "instruments.csv_pro": { en: "The CSV of this view is part of Pro.", fr: "Le CSV de cette vue fait partie de Pro." },
  "instruments.segment_heading": { en: "Holders in This Segment", fr: "Titulaires dans ce segment" },
  "instruments.buyer_heading": {
    en: "Holders of Standing Offers and Supply Arrangements for This Buyer",
    fr: "Titulaires d'offres à commandes et d'arrangements pour cet acheteur",
  },
  "instruments.holders_note_one": {
    en: "{n} organization holds active standing offers or supply arrangements here; the most instruments first, up to {max}.",
    fr: "{n} organisation détient ici des offres à commandes ou des arrangements actifs; le plus d'instruments d'abord, jusqu'à {max}.",
  },
  "instruments.holders_note_many": {
    en: "{n} organizations hold active standing offers or supply arrangements here; the most instruments first, up to {max}.",
    fr: "{n} organisations détiennent ici des offres à commandes ou des arrangements actifs; le plus d'instruments d'abord, jusqu'à {max}.",
  },
  "instruments.soonest": { en: "Soonest expiry", fr: "Expiration la plus proche" },
  "instruments.list_link": { en: "The instruments in the full list", fr: "Les instruments dans la liste complète" },
  "instruments.tender_heading": {
    en: "Standing Offers and Supply Arrangements From This Solicitation",
    fr: "Offres à commandes et arrangements issus de cette demande",
  },
  "instruments.tender_line": { en: "Current holders of {agreement}: {n}", fr: "Titulaires actuels de {agreement} : {n}" },
  "instruments.tender_withheld": { en: "({n} withheld as private individuals)", fr: "(dont {n} retirés comme particuliers)" },
  "instruments.tender_expiry": { en: "expires {date}", fr: "expire le {date}" },
  "instruments.pro_include": {
    en: "The CSV files of the standing offers and supply arrangements: any filtered list, and each instrument's holders",
    fr: "Les fichiers CSV des offres à commandes et des arrangements : toute liste filtrée, et les titulaires de chaque instrument",
  },
  "propage.instruments": {
    en: "CSV files of the standing offers and supply arrangements, filtered, and of each one's holders (the pages stay free)",
    fr: "Les fichiers CSV des offres à commandes et des arrangements, filtrés, et des titulaires de chacun (les pages restent gratuites)",
  },
  "instrument.eyebrow": { en: "Standing offer or supply arrangement", fr: "Offre à commandes ou arrangement en matière d'approvisionnement" },
  "instrument.back": { en: "All standing offers and supply arrangements", fr: "Toutes les offres à commandes et tous les arrangements" },
  "instrument.not_found": { en: "Instrument Not Found", fr: "Instrument introuvable" },
  "instrument.not_found_text": {
    en: "No standing offer or supply arrangement numbered {agreement} is in the files read so far.",
    fr: "Aucune offre à commandes ni aucun arrangement portant le numéro {agreement} ne figure dans les fichiers lus jusqu'ici.",
  },
  "instrument.unavailable": {
    en: "This page is not available right now. The CanadaBuys search has the instrument.",
    fr: "Cette page n'est pas disponible pour le moment. La recherche d'AchatsCanada contient l'instrument.",
  },
  "instrument.loading": {
    en: "The records database is being reloaded; this page returns when it is done.",
    fr: "La base de données des dossiers est en cours de rechargement; cette page reviendra une fois le chargement terminé.",
  },
  "instrument.description": {
    en: "{type} {agreement}: {n} holders, expires {date}. From the weekly open data file of Public Services and Procurement Canada.",
    fr: "{type} {agreement} : {n} titulaires, expire le {date}. D'après le fichier hebdomadaire de données ouvertes de SPAC.",
  },
  "instrument.lead_expiry": { en: "expires {expiry}", fr: "expire le {expiry}" },
  "instrument.lead_holders_one": { en: "{n} holder", fr: "{n} titulaire" },
  "instrument.lead_holders_many": { en: "{n} holders", fr: "{n} titulaires" },
  "instrument.lapsed": {
    en: "No holder of this instrument is in the newest edition of the file; the last edition that held it is of {date}.",
    fr: "Aucun titulaire de cet instrument ne figure dans la plus récente édition du fichier; la dernière édition qui le contenait est celle du {date}.",
  },
  "instrument.details": { en: "Details", fr: "Détails" },
  "instrument.description_en": { en: "Description in English", fr: "Description en anglais" },
  "instrument.description_fr": { en: "Description in French", fr: "Description en français" },
  "instrument.commodity": { en: "Commodity and GSIN", fr: "Produit et NIBS" },
  "instrument.start": { en: "Start", fr: "Début" },
  "instrument.notice": {
    en: "Request for standing offers or supply arrangements",
    fr: "Demande d'offres à commandes ou d'arrangements",
  },
  "instrument.segments": { en: "Segments, from the notices", fr: "Segments, d'après les avis" },
  "instrument.no_segment": {
    en: "None: no award or tender notice shares its solicitation number (GSIN {gsin})",
    fr: "Aucun : aucun avis d'attribution ou d'appel d'offres ne partage son numéro de demande de soumissions (NIBS {gsin})",
  },
  "instrument.first_seen": { en: "First in the file", fr: "Premier dans le fichier" },
  "instrument.holders": { en: "Holders", fr: "Titulaires" },
  "instrument.col_holder": { en: "Holder", fr: "Titulaire" },
  "instrument.col_first_seen": { en: "First seen", fr: "Vu en premier" },
  "instrument.col_calls": { en: "Call-ups", fr: "Commandes subséquentes" },
  "instrument.col_calls_value": { en: "Call-up value", fr: "Valeur des commandes" },
  "instrument.calls_note": {
    en: "Call-ups recorded in the published contracts naming this instrument, over ten fiscal years, matched to a holder through its profile. Departments fill the standing offer number inconsistently, so these are the call-ups the contracts record, not every call-up made.",
    fr: "Commandes subséquentes inscrites dans les contrats publiés qui nomment cet instrument, sur dix exercices, rattachées à un titulaire par son profil. Les ministères remplissent le numéro d'offre à commandes de façon inégale; ce sont donc les commandes que les contrats inscrivent, et non toutes les commandes passées.",
  },
  "instrument.calls_other": {
    en: "Call-ups by vendors that are not holders with a profile here: {n}, {value}.",
    fr: "Commandes subséquentes de fournisseurs qui ne sont pas des titulaires ayant un profil ici : {n}, {value}.",
  },
  "instrument.no_profile": { en: "no profile", fr: "aucun profil" },
  "instrument.no_holders": { en: "No holder is listed.", fr: "Aucun titulaire n'est inscrit." },
  "instrument.operating": { en: "operating as {name}", fr: "exploité sous le nom {name}" },
  "instrument.all_withheld": { en: "All holders withheld ({n}).", fr: "Tous les titulaires sont retirés ({n})." },
  "instrument.withheld_one": {
    en: "{n} holder reads as a private individual and is withheld.",
    fr: "{n} titulaire semble être un particulier et son nom est retiré.",
  },
  "instrument.withheld_many": {
    en: "{n} holders read as private individuals and are withheld.",
    fr: "{n} titulaires semblent être des particuliers et leurs noms sont retirés.",
  },
  "instrument.csv": { en: "CSV of the holders", fr: "CSV des titulaires" },
  "instrument.csv_pro": { en: "The CSV of the holders is part of Pro.", fr: "Le CSV des titulaires fait partie de Pro." },
  "instrument.holders_cut": { en: "The first {n} holders are shown.", fr: "Les {n} premiers titulaires sont affichés." },
  "instrument.source": {
    en: "Source: Public Services and Procurement Canada, Standing Offers and Supply Arrangements, edition of {date}, Open Government Licence ({dataset}; {search}).",
    fr: "Source : Services publics et Approvisionnement Canada, Offres à commandes et arrangements en matière d'approvisionnement, édition du {date}, Licence du gouvernement ouvert ({dataset}; {search}).",
  },
  "org.instruments_one": {
    en: "Holds {n} active standing offer or supply arrangement",
    fr: "Détient {n} offre à commandes ou arrangement en matière d'approvisionnement actif",
  },
  "org.instruments_many": {
    en: "Holds {n} active standing offers or supply arrangements",
    fr: "Détient {n} offres à commandes ou arrangements en matière d'approvisionnement actifs",
  },
  "org.instruments": { en: "Standing Offers and Supply Arrangements", fr: "Offres à commandes et arrangements en matière d'approvisionnement" },
  "org.instruments_none": { en: "No active instrument.", fr: "Aucun instrument actif." },
  "org.instruments_lapsed": { en: "No Longer Held", fr: "Plus détenus" },
  "org.instruments_lost_on": { en: "No longer held since", fr: "Plus détenu depuis" },
} as const satisfies Record<string, Entry>;

export type Key = keyof typeof STRINGS;
type Vars = Record<string, string | number>;

// Keys whose French is the English word on purpose: names, codes and words
// spelled the same in both languages. The completeness test holds every other
// key to a French string that differs from the English.
export const SAME_IN_BOTH: ReadonlySet<Key> = new Set<Key>([
  "account.plan_tag_pro", // the plan subscript after the wordmark reads the same in both
  "pro.tag", // the plan's name on the Pro chip
  "site.name",
  "nav.segments",
  "common.page_n",
  "common.source",
  "col.code",
  "col.description",
  "col.segment",
  "col.date",
  "col.source",
  "col.province",
  "cat.SRV",
  "cat.CNST",
  "prov.AB",
  "prov.MB",
  "prov.NU",
  "prov.ON",
  "prov.SK",
  "prov.YT",
  "registry.corporations_canada",
  "grant.type_C",
  "citepage.style.bibtex",
  "citepage.style.ris",
  "col.type",
]);

export function allKeys(): Key[] {
  return Object.keys(STRINGS) as Key[];
}

export function rawEntry(key: Key): Entry {
  return STRINGS[key];
}

export function frTypography(s: string): string {
  return s
    .replace(/'/g, "’")
    .replace(/ ([:%$»])/g, "\u00a0$1")
    .replace(/« /g, "«\u00a0")
    .replace(/\$ US/g, () => "$\u00a0US");
}

const frCache = new Map<Key, string>();

function template(lang: Lang, key: Key): string {
  const entry: Entry = STRINGS[key];
  if (lang !== "fr") return entry.en;
  let s = frCache.get(key);
  if (s === undefined) {
    s = frTypography(entry.fr);
    frCache.set(key, s);
  }
  return s;
}

function fill(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function t(lang: Lang, key: Key, vars?: Vars): string {
  return fill(template(lang, key), vars);
}

// Like t(), but a slot can hold markup (a link inside a sentence). Returns the
// pieces in order for JSX to render as children.
export function tj(lang: Lang, key: Key, slots: Record<string, unknown>): unknown[] {
  const s = template(lang, key);
  const out: unknown[] = [];
  let last = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    out.push(m[1] in slots ? slots[m[1]] : m[0]);
    last = at + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// English takes the singular for 1 only; French for 0 and 1.
export function tn(lang: Lang, one: Key, many: Key, n: number, vars?: Vars): string {
  const singular = lang === "fr" ? Math.abs(n) < 2 : n === 1;
  return t(lang, singular ? one : many, vars);
}

export function langFrom(query: string | undefined, cookie: string | undefined): Lang {
  if (query === "fr" || query === "en") return query;
  return cookie === "fr" ? "fr" : "en";
}

export function numberLocale(lang: Lang): string {
  return lang === "fr" ? "fr-CA" : "en-CA";
}

// A decimal written the way the language writes it ("2.9" or "2,9").
export function decimal(lang: Lang, text: string): string {
  return lang === "fr" ? text.replace(".", ",") : text;
}

// The strings a client script needs, for the page's JSON block.
export function clientStrings(lang: Lang, keys: readonly Key[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = template(lang, k);
  return out;
}

// -- bilingual data ----------------------------------------------------------------

// A field the source publishes in both languages: the page's language, the
// other one when the page's is blank, null when both are.
export function pick(lang: Lang, en: string | null | undefined, fr: string | null | undefined): string | null {
  const mine = lang === "fr" ? fr : en;
  const other = lang === "fr" ? en : fr;
  return mine && mine.trim() ? mine : other && other.trim() ? other : null;
}

// -- names keyed by code -------------------------------------------------------------

const PROVINCE_KEY: Record<string, Key> = {
  AB: "prov.AB", BC: "prov.BC", MB: "prov.MB", NB: "prov.NB", NL: "prov.NL", NS: "prov.NS", NT: "prov.NT",
  NU: "prov.NU", ON: "prov.ON", PE: "prov.PE", QC: "prov.QC", SK: "prov.SK", YT: "prov.YT", XX: "prov.XX", UN: "prov.UN",
};

export function provinceName(lang: Lang, code: string): string {
  const key = PROVINCE_KEY[code.toUpperCase()];
  return key ? t(lang, key) : code;
}

// A segment's short name for the chips ("Education"); a code that is not a
// segment comes back as given.
export function segmentShort(lang: Lang, code: string): string {
  const seg = SEGMENT_SHORT[code];
  if (!seg) return code;
  return lang === "fr" ? frTypography(seg.fr) : seg.en;
}

// The UNSPSC segment's title in the reader's language; a code that is not a
// segment comes back as given.
export function segmentLabel(lang: Lang, code: string): string {
  const seg = SEGMENTS[code];
  if (!seg) return code;
  return lang === "fr" ? frTypography(seg.fr) : seg.en;
}

const CATEGORY_KEY: Record<string, Key> = { SRV: "cat.SRV", GD: "cat.GD", CNST: "cat.CNST", SRVTGD: "cat.SRVTGD" };

export function categoryLabel(lang: Lang, code: string): string {
  const key = CATEGORY_KEY[code];
  return key ? t(lang, key) : code;
}

// 1 or true competitive, 0 or false non-competitive, anything else unstated.
export function competitiveLabel(lang: Lang, v: boolean | 0 | 1 | null | undefined): string {
  if (v === true || v === 1) return t(lang, "competitive.yes");
  if (v === false || v === 0) return t(lang, "competitive.no");
  return t(lang, "competitive.unstated");
}

const STATUS_KEY: Record<string, Key> = {
  open: "status.open", closing: "status.closing", closed: "status.closed", expired: "status.expired", cancelled: "status.cancelled",
  awarded: "status.awarded", active: "status.active", unknown: "status.unknown",
};

// Tender statuses, the derived closing-soon and closing-date-passed states,
// and award statuses.
export function statusLabel(lang: Lang, status: string): string {
  return t(lang, STATUS_KEY[status] ?? "status.unknown");
}

const SOURCE_KEY: Record<string, Key> = {
  tenders: "source.tenders", awards: "source.awards", history: "source.history", contracts: "source.contracts",
  grants: "source.grants", lobbying: "source.lobbying",
};

export function sourceLabel(lang: Lang, source: string): string {
  const key = SOURCE_KEY[source];
  return key ? t(lang, key) : source;
}

// -- numbers and money -----------------------------------------------------------------

// One formatter per language and kind, made on first use: toLocaleString
// builds a new one on every call, which on a long page (hundreds of numbers)
// is a measurable share of the request's CPU time.
const INT_FORMAT: Partial<Record<Lang, Intl.NumberFormat>> = {};
const MONEY_FORMAT = new Map<string, Intl.NumberFormat>();

export function fmtInt(n: number | string | null | undefined, lang: Lang = "en"): string {
  if (n === null || n === undefined || n === "") return "0";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return String(n);
  const format = (INT_FORMAT[lang] ??= new Intl.NumberFormat(numberLocale(lang)));
  return format.format(v);
}

function moneyFormat(lang: Lang, currency: string, cents: boolean): Intl.NumberFormat {
  const key = `${lang}|${currency}|${cents ? 2 : 0}`;
  let f = MONEY_FORMAT.get(key);
  if (!f) {
    f = new Intl.NumberFormat(numberLocale(lang), {
      style: "currency",
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
    MONEY_FORMAT.set(key, f);
  }
  return f;
}

// An amount in Canadian dollars (or the currency given), in the reader's
// language: whole dollars from 1,000 up, cents below. "$1,234,567" and
// "1 234 567 $". A currency code Intl does not know is written after the
// amount as given.
export function fmtMoney(value: number, lang: Lang = "en", currency?: string | null): string {
  const code = (currency ?? "").trim().toUpperCase() || "CAD";
  const cents = Math.abs(value) < 1000 && !Number.isInteger(value);
  try {
    return moneyFormat(lang, /^[A-Z]{3}$/.test(code) ? code : "CAD", cents).format(value);
  } catch {
    return `${fmtInt(Math.round(value), lang)} ${code}`;
  }
}

// The short form for tiles only: $4.5M, $1.2B (4,5 M$ and 1,2 G$ in
// French); below a million, the whole amount.
export function fmtMoneyShort(value: number, lang: Lang = "en"): string {
  const abs = Math.abs(value);
  const short = (n: number) => decimal(lang, (Math.round(n * 10) / 10).toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, ""));
  if (abs >= 1e9) return t(lang, "money.short_b", { amount: short(value / 1e9) });
  if (abs >= 1e6) return t(lang, "money.short_m", { amount: short(value / 1e6) });
  return fmtMoney(Math.round(value), lang);
}

// A whole-number percentage of whole ("25%", "25 %"); "" when whole is not
// positive, where a share means nothing. Shares under one percent read "<1%".
export function fmtPct(part: number, whole: number, lang: Lang = "en"): string {
  if (!(whole > 0)) return "";
  const pct = (part / whole) * 100;
  // A no-break space keeps "<" with its figure in French ("< 1 %" never breaks after "<").
  if (pct > 0 && pct < 1) return t(lang, "pct", { n: lang === "fr" ? "<\u00a01" : "<1" });
  return t(lang, "pct", { n: Math.round(pct) });
}
