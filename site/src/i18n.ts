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

import { SEGMENTS } from "./constants";

export type Lang = "en" | "fr";

type Entry = { en: string; fr: string };

const STRINGS = {
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
  "nav.categories": { en: "Categories", fr: "Catégories" },
  "nav.rankings": { en: "Rankings", fr: "Classements" },
  "nav.data": { en: "Data", fr: "Données" },
  "nav.methodology": { en: "Methodology", fr: "Méthodologie" },
  "nav.data_as_of": { en: "Data as of", fr: "Données au" },
  "nav.dark": { en: "Dark", fr: "Sombre" },
  "nav.light": { en: "Light", fr: "Clair" },
  "nav.lang": { en: "Français", fr: "English" },
  "nav.main_label": { en: "Main", fr: "Principale" },
  "footer.sources": {
    en: "Records from CanadaBuys, open.canada.ca and the Registry of Lobbyists.",
    fr: "Dossiers d'AchatsCanada, d'ouvert.canada.ca et du Registre des lobbyistes.",
  },
  "footer.sources_link": { en: "Sources and licence", fr: "Sources et licence" },
  "footer.methodology": { en: "Methodology", fr: "Méthodologie" },
  "footer.download": { en: "Download the data", fr: "Télécharger les données" },
  "footer.feeds": { en: "Feeds", fr: "Fils" },
  "footer.watchlist": { en: "Watchlist", fr: "Liste de suivi" },
  "footer.corrections": { en: "Report a correction", fr: "Signaler une correction" },
  "footer.cite": { en: "Cite", fr: "Citer" },
  "footer.support": { en: "Support the site", fr: "Soutenir le site" },
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
  "col.region": { en: "Region of delivery", fr: "Région de livraison" },
  "col.awarded": { en: "Awarded", fr: "Attribué le" },
  "col.contract": { en: "Contract", fr: "Contrat" },
  "col.organization": { en: "Organization", fr: "Organisation" },
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

  // Tender statuses (normalize.tender_status), the closing-soon state the
  // site derives, and the award and contract history statuses.
  "status.open": { en: "Open", fr: "Ouvert" },
  "status.closing": { en: "Closing soon", fr: "Clôture prochaine" },
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
  "source.dataset.history": { en: "CanadaBuys contract history (open.canada.ca)", fr: "Historique des contrats d'AchatsCanada (ouvert.canada.ca)" },
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
    en: "Too many requests. The API allows 60 requests a minute per address; bulk users should use the downloads.",
    fr: "Trop de requêtes. L'API permet 60 requêtes par minute et par adresse; pour un usage en masse, utilisez les téléchargements.",
  },

  // -- home ----------------------------------------------------------------------------
  "home.title": { en: "Federal Tenders, Contracts and Grants, by Organization", fr: "Appels d'offres, contrats et subventions du fédéral, par organisation" },
  "home.lead": {
    en: "The tender notices open on CanadaBuys, the contracts awarded after them, and the contracts, grants and lobbying the government publishes, gathered under the organizations they name. From the government's open data, refreshed every night.",
    fr: "Les avis d'appel d'offres ouverts sur AchatsCanada, les contrats attribués ensuite, ainsi que les contrats, subventions et communications de lobbying que publie le gouvernement, regroupés sous les organisations qu'ils nomment. D'après les données ouvertes du gouvernement, mises à jour chaque nuit.",
  },
  "home.quick_open": { en: "Open tenders", fr: "Appels d'offres ouverts" },
  "home.quick_closing": { en: "Closing this week", fr: "Clôture cette semaine" },
  "home.quick_new": { en: "New today", fr: "Nouveaux aujourd'hui" },
  "home.quick_awards": { en: "Latest awards", fr: "Dernières attributions" },
  "home.quick_directory": { en: "Organizations A to Z", fr: "Organisations de A à Z" },
  "home.tiles_label": { en: "Counts", fr: "Chiffres" },
  "home.tile_open": { en: "Open tender notices", fr: "Avis d'appel d'offres ouverts" },
  "home.tile_open_note": { en: "Open on CanadaBuys at the data date", fr: "Ouverts sur AchatsCanada à la date des données" },
  "home.tile_new": { en: "New tender notices", fr: "Nouveaux avis d'appel d'offres" },
  "home.tile_new_note": { en: "First seen in the last refresh", fr: "Vus pour la première fois à la dernière mise à jour" },
  "home.tile_awards": { en: "Award notices", fr: "Avis d'attribution" },
  "home.tile_awards_note": { en: "On CanadaBuys since 2012", fr: "Sur AchatsCanada depuis 2012" },
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
  "home.new_none": { en: "No new notices in the last refresh.", fr: "Aucun nouvel avis à la dernière mise à jour." },
  "home.closing_heading": { en: "Closing Within 7 Days", fr: "Clôture d'ici 7 jours" },
  "home.closing_all": { en: "All closing soon", fr: "Toutes les clôtures prochaines" },
  "home.closing_none": { en: "No open notice closes in the next 7 days.", fr: "Aucun avis ouvert ne prend fin dans les 7 prochains jours." },
  "home.awards_heading": { en: "Recent Contract Awards", fr: "Attributions de contrats récentes" },
  "home.awards_all": { en: "All award notices", fr: "Tous les avis d'attribution" },
  "home.awards_none": { en: "No award notices published yet.", fr: "Aucun avis d'attribution publié pour l'instant." },
  "home.top_heading": { en: "Largest Award Values in {year}", fr: "Valeurs attribuées les plus élevées en {year}" },
  "home.top_all": { en: "Full ranking", fr: "Classement complet" },
  "home.top_note": {
    en: "Award notices only, by the value on each notice's newest amendment; the other sources are ranked separately.",
    fr: "Avis d'attribution seulement, selon la valeur de la plus récente modification de chaque avis; les autres sources sont classées séparément.",
  },
  "home.top_none": { en: "No award notices dated this year yet.", fr: "Aucun avis d'attribution daté de cette année pour l'instant." },
  "home.read_heading": { en: "How to Read This Site", fr: "Comment lire ce site" },
  "home.read_records": {
    en: "Every row is a government record, linked to the notice or file it came from. Figures describe those records and draw no conclusion about anyone.",
    fr: "Chaque ligne est un dossier du gouvernement, lié à l'avis ou au fichier d'où elle vient. Les chiffres décrivent ces dossiers et ne tirent aucune conclusion sur qui que ce soit.",
  },
  "home.read_sources": {
    en: "One contract can appear in an award notice, in PSPC's contract history and in a department's published contracts. Each source is shown and totalled on its own, never added to another.",
    fr: "Un même contrat peut figurer dans un avis d'attribution, dans l'historique des contrats de SPAC et dans les contrats publiés d'un ministère. Chaque source est présentée et totalisée séparément, jamais additionnée à une autre.",
  },
  "home.read_competitive": {
    en: "\"Non-competitive\" is the sources' own term for a contract awarded without a competition, which the procurement rules allow in set cases.",
    fr: "« Non concurrentiel » est le terme des sources pour un contrat attribué sans mise en concurrence, ce que les règles d'approvisionnement permettent dans des cas précis.",
  },
  "home.read_more": { en: "The {methodology} page sets out each rule.", fr: "La page {methodology} expose chaque règle." },

  // -- tender lists ----------------------------------------------------------------------
  "tenders.title": { en: "Open Tender Notices", fr: "Avis d'appel d'offres ouverts" },
  "tenders.lead": {
    en: "{n} notices open on CanadaBuys at the data date, filtered here in your browser.",
    fr: "{n} avis ouverts sur AchatsCanada à la date des données, filtrés ici dans votre navigateur.",
  },
  "tenders.contact_note": {
    en: "Contacts, documents and bid submission are on each notice's CanadaBuys page.",
    fr: "Les personnes-ressources, les documents et le dépôt des soumissions se trouvent sur la page AchatsCanada de chaque avis.",
  },
  "tenders.filter_text": { en: "Words in the title", fr: "Mots du titre" },
  "tenders.filter_category": { en: "Category", fr: "Catégorie" },
  "tenders.filter_segment": { en: "UNSPSC segment", fr: "Segment UNSPSC" },
  "tenders.filter_province": { en: "Region of delivery", fr: "Région de livraison" },
  "tenders.filter_buyer": { en: "Buyer", fr: "Acheteur" },
  "tenders.filter_type": { en: "Notice type", fr: "Type d'avis" },
  "tenders.filter_method": { en: "Procurement method", fr: "Méthode d'approvisionnement" },
  "tenders.filter_closing": { en: "Closing", fr: "Clôture" },
  "tenders.closing_any": { en: "Any date", fr: "Toute date" },
  "tenders.closing_days": { en: "Within {n} days", fr: "D'ici {n} jours" },
  "tenders.any": { en: "All", fr: "Tous" },
  "tenders.sort": { en: "Sort", fr: "Trier" },
  "tenders.sort_closing": { en: "Closing soonest", fr: "Clôture la plus proche" },
  "tenders.sort_published": { en: "Newest published", fr: "Publication la plus récente" },
  "tenders.apply": { en: "Apply", fr: "Appliquer" },
  "tenders.reset": { en: "Clear filters", fr: "Effacer les filtres" },
  "tenders.count_one": { en: "{n} notice", fr: "{n} avis" },
  "tenders.count_many": { en: "{n} notices", fr: "{n} avis" },
  "tenders.none_match": { en: "No open notice matches these filters.", fr: "Aucun avis ouvert ne correspond à ces filtres." },
  "tenders.page_of": { en: "Page {page} of {pages}", fr: "Page {page} sur {pages}" },
  "tenders.prev": { en: "Previous", fr: "Précédente" },
  "tenders.next": { en: "Next", fr: "Suivante" },
  "tenders.loading": { en: "Loading every open notice…", fr: "Chargement de tous les avis ouverts…" },
  "tenders.load_failed": {
    en: "The full list could not be loaded; the rows shown are the server's.",
    fr: "La liste complète n'a pas pu être chargée; les lignes affichées sont celles du serveur.",
  },
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
  "tenders.new_none": { en: "No new notices were seen on this day.", fr: "Aucun nouvel avis n'a été vu ce jour-là." },

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
  "tender.amended": { en: "Amended", fr: "Modifié le" },
  "tender.start_expected": { en: "Expected start", fr: "Début prévu" },
  "tender.end_expected": { en: "Expected end", fr: "Fin prévue" },
  "tender.closing_zone": {
    en: "The closing time is the buyer's, as published; the notice names its time zone.",
    fr: "L'heure de clôture est celle de l'acheteur, telle que publiée; l'avis précise le fuseau horaire.",
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
  "tender.regions_delivery": { en: "Regions of delivery", fr: "Régions de livraison" },
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
    en: "Read from {file}; first seen {first}, last seen {last}.",
    fr: "Lu dans {file}; vu pour la première fois le {first}, pour la dernière fois le {last}.",
  },
  "tender.versions_one": { en: "{n} version on record.", fr: "{n} version au dossier." },
  "tender.versions_many": { en: "{n} versions on record.", fr: "{n} versions au dossier." },
  "tender.description": {
    en: "Tender notice {reference} from {buyer} on CanadaBuys, closing {closing}: dates, codes, amendments and related awards.",
    fr: "Avis d'appel d'offres {reference} de {buyer} sur AchatsCanada, clôture le {closing} : dates, codes, modifications et attributions liées.",
  },

  // -- award notices -------------------------------------------------------------------
  "awards.title": { en: "Contract Award Notices", fr: "Avis d'attribution de contrats" },
  "awards.lead": {
    en: "The {n} newest award notices on CanadaBuys, newest award date first.",
    fr: "Les {n} avis d'attribution les plus récents sur AchatsCanada, du plus récent au plus ancien.",
  },
  "awards.value_note": {
    en: "Value is the total contract value on the notice's newest amendment, or its amount when no total is given. A cancelled notice counts zero in every total.",
    fr: "La valeur est la valeur totale du contrat à la plus récente modification de l'avis, ou son montant en l'absence de total. Un avis annulé compte pour zéro dans tous les totaux.",
  },
  "awards.years": { en: "Years", fr: "Années" },
  "awards.recent": { en: "Newest", fr: "Plus récents" },
  "awards.none": { en: "No award notices to show.", fr: "Aucun avis d'attribution à afficher." },
  "awards.year_title": { en: "Award Notices in {year}", fr: "Avis d'attribution en {year}" },
  "awards.year_description": {
    en: "{n} CanadaBuys award notices with an award date in {year}, newest first, each linked to its notice.",
    fr: "{n} avis d'attribution d'AchatsCanada dont la date d'attribution tombe en {year}, du plus récent au plus ancien, chacun lié à son avis.",
  },
  "awards.year_not_found": { en: "No Award Notices for This Year", fr: "Aucun avis d'attribution pour cette année" },
  "awards.back": { en: "Back to the award notices", fr: "Retour aux avis d'attribution" },
  "awards.year_count_one": { en: "{n} award notice dated {year}.", fr: "{n} avis d'attribution daté de {year}." },
  "awards.year_count_many": { en: "{n} award notices dated {year}.", fr: "{n} avis d'attribution datés de {year}." },
  "awards.cancelled_one": { en: "{n} of them is cancelled.", fr: "{n} d'entre eux est annulé." },
  "awards.cancelled_many": { en: "{n} of them are cancelled.", fr: "{n} d'entre eux sont annulés." },
  "awards.download": { en: "Download every award notice dated {year} (CSV)", fr: "Télécharger tous les avis d'attribution datés de {year} (CSV)" },

  // -- one award notice or contract history record ------------------------------------
  "contract.title_award": { en: "Award Notice", fr: "Avis d'attribution" },
  "contract.title_history": { en: "PSPC Contract History Record", fr: "Dossier de l'historique des contrats de SPAC" },
  "contract.award_not_found": { en: "Award Notice Not Found", fr: "Avis d'attribution introuvable" },
  "contract.history_not_found": { en: "Contract History Record Not Found", fr: "Dossier de l'historique des contrats introuvable" },
  "contract.on_canadabuys": { en: "Open the award notice on CanadaBuys", fr: "Ouvrir l'avis d'attribution sur AchatsCanada" },
  "contract.history_dataset": { en: "The contract history dataset", fr: "Le jeu de données de l'historique des contrats" },
  "contract.tender_link": { en: "The tender notice", fr: "L'avis d'appel d'offres" },
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
    fr: "L'avis est annulé; il compte donc pour zéro dans tous les totaux du site.",
  },
  "contract.non_cad": {
    en: "The amounts are in {currency} as published and are left out of the site's totals, which are in Canadian dollars.",
    fr: "Les montants sont en {currency}, tels que publiés, et sont exclus des totaux du site, établis en dollars canadiens.",
  },
  "contract.details": { en: "Details", fr: "Détails" },
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
  "org.tile_lobbying": { en: "Communication reports filed for it", fr: "Rapports de communication déposés en son nom" },
  "org.never_added": {
    en: "Each source is totalled on its own by the rules on the Methodology page. The same contract can appear in more than one source, so the figures are never added together.",
    fr: "Chaque source est totalisée séparément selon les règles de la page Méthodologie. Un même contrat peut figurer dans plus d'une source; les chiffres ne sont donc jamais additionnés.",
  },
  "org.places": { en: "Addresses on the Records", fr: "Adresses aux dossiers" },
  "org.rows_one": { en: "{n} row", fr: "{n} ligne" },
  "org.rows_many": { en: "{n} rows", fr: "{n} lignes" },
  "org.places_note": {
    en: "Records under this name at {n} addresses. Two organizations with the same legal name share this page; the addresses may belong to different ones.",
    fr: "Dossiers sous ce nom à {n} adresses. Deux organisations au même nom légal partagent cette page; les adresses peuvent appartenir à des organisations différentes.",
  },
  "org.registry": { en: "Corporate Registry", fr: "Registre des sociétés" },
  "org.years": { en: "Figures by Year and Source", fr: "Chiffres par année et par source" },
  "org.years_note": {
    en: "Calendar years of the award, contract or agreement start date, each source on its own, by the {methodology}.",
    fr: "Années civiles de la date d'attribution, de contrat ou de début d'accord, chaque source séparément, selon les {methodology}.",
  },
  "org.years_rules": { en: "counting rules", fr: "règles de calcul" },
  "org.years_none": { en: "No dated records with an amount.", fr: "Aucun dossier daté avec un montant." },
  "org.chart_aria": {
    en: "Value per calendar year; the table below gives every figure.",
    fr: "Valeur par année civile; le tableau ci-dessous donne chaque chiffre.",
  },
  "org.col_nc_count": { en: "Non-competitive, by count", fr: "Non concurrentiels, en nombre" },
  "org.col_nc_value": { en: "Non-competitive, by value", fr: "Non concurrentiels, en valeur" },
  "org.share": { en: "{part} of {whole}{pct}", fr: "{part} sur {whole}{pct}" },
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
    en: "Showing the newest {shown} of {total} rows; the other one is in {where}.",
    fr: "Les {shown} lignes les plus récentes sur {total} sont affichées; l'autre se trouve dans {where}.",
  },
  "org.more_rows_many": {
    en: "Showing the newest {shown} of {total} rows; the other {more} are in {where}.",
    fr: "Les {shown} lignes les plus récentes sur {total} sont affichées; les {more} autres se trouvent dans {where}.",
  },
  "org.more_downloads": { en: "the yearly CSV downloads", fr: "les fichiers CSV annuels" },
  "org.more_source": { en: "the publisher's file", fr: "le fichier de l'éditeur" },
  "org.non_cad_one": {
    en: "{n} row in another currency is shown with its currency and left out of the totals.",
    fr: "{n} ligne dans une autre devise est affichée avec sa devise et exclue des totaux.",
  },
  "org.non_cad_many": {
    en: "{n} rows in another currency are shown with their currency and left out of the totals.",
    fr: "{n} lignes dans une autre devise sont affichées avec leur devise et exclues des totaux.",
  },
  "org.history_note": {
    en: "Contracts PSPC awarded on behalf of client departments; the buyer column names the client.",
    fr: "Contrats attribués par SPAC au nom de ministères clients; la colonne de l'acheteur nomme le client.",
  },
  "org.contracts_note": {
    en: "Contracts over $10,000 as departments report them each quarter. Each row's value is its own: an amendment row carries the amendment's value.",
    fr: "Contrats de plus de 10 000 $ tels que les ministères les déclarent chaque trimestre. La valeur de chaque ligne lui est propre : une ligne de modification porte la valeur de la modification.",
  },
  "org.reporting_period": { en: "Reported for {period}", fr: "Déclaré pour {period}" },
  "org.last_reported": { en: "Value as last reported: {value}", fr: "Valeur à la dernière déclaration : {value}" },
  "org.last_reported_def": {
    en: "The largest contract value among the rows that share this procurement ID; shown for reference and never added to a total.",
    fr: "La plus grande valeur de contrat parmi les lignes qui partagent ce numéro d'approvisionnement; affichée à titre indicatif et jamais additionnée à un total.",
  },
  "org.lobbying_note": {
    en: "Monthly communication reports in which the organization is the client. Public office holders are named in their public role, as the registry publishes them.",
    fr: "Rapports mensuels de communication dans lesquels l'organisation est la cliente. Les titulaires d'une charge publique sont nommés dans leur rôle public, tels que le registre les publie.",
  },
  "org.buyers": { en: "Main Buyers by Source", fr: "Principaux acheteurs par source" },
  "org.buyers_none": { en: "No buyer on record.", fr: "Aucun acheteur au dossier." },
  "org.responses": { en: "Responses from the Organization", fr: "Réponses de l'organisation" },
  "org.no_responses": { en: "The organization has not published a response.", fr: "L'organisation n'a publié aucune réponse." },
  "org.received": { en: "Received {date}", fr: "Reçu le {date}" },
  "org.corrections": { en: "Corrections Log", fr: "Journal des corrections" },
  "org.no_corrections": { en: "No corrections to this profile so far.", fr: "Aucune correction à ce profil jusqu'à présent." },
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
  "watch.on": { en: "Watching", fr: "Suivie" },
  "watch.off": { en: "Watch", fr: "Suivre" },
  "watch.full": { en: "Watchlist full ({max})", fr: "Liste de suivi pleine ({max})" },
  "watch.title": { en: "Watchlist", fr: "Liste de suivi" },
  "watch.lead": {
    en: "The organizations you follow, with what is new in their records since your last visit.",
    fr: "Les organisations que vous suivez, avec ce qui est nouveau dans leurs dossiers depuis votre dernière visite.",
  },
  "watch.privacy": {
    en: "The list is kept in this browser only. Nothing about it is sent to the site.",
    fr: "La liste est conservée dans ce navigateur seulement. Rien à son sujet n'est transmis au site.",
  },
  "watch.records_note": {
    en: "The counts are the rows of each source on the profile.",
    fr: "Les nombres sont les lignes de chaque source au profil.",
  },
  "watch.limit_note": { en: "Up to {max} organizations.", fr: "Jusqu'à {max} organisations." },
  "watch.empty": {
    en: "No organizations yet. Use the Watch button on a profile; the {directory} lists every organization.",
    fr: "Aucune organisation pour l'instant. Utilisez le bouton Suivre d'un profil; le {directory} présente toutes les organisations.",
  },
  "watch.directory_link": { en: "directory", fr: "répertoire" },
  "watch.noscript": { en: "The watchlist needs JavaScript.", fr: "La liste de suivi nécessite JavaScript." },
  "watch.col_latest": { en: "Latest record", fr: "Dernier dossier" },
  "watch.col_new": { en: "New since last visit", fr: "Nouveau depuis la dernière visite" },
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
  "watch.load_failed": { en: "This profile could not be loaded; try again later.", fr: "Ce profil n'a pas pu être chargé; réessayez plus tard." },
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
    en: "The list holds at most {max}; the rest were left out.",
    fr: "La liste en contient au plus {max}; les autres ont été laissées de côté.",
  },

  // -- buyers ---------------------------------------------------------------------------
  "buyers.title": { en: "Federal Buyers", fr: "Acheteurs fédéraux" },
  "buyers.lead": {
    en: "{n} departments, agencies and Crown corporations, with their records in each source.",
    fr: "{n} ministères, organismes et sociétés d'État, avec leurs dossiers dans chaque source.",
  },
  "buyers.note": {
    en: "Counts and totals per source, by the counting rules; sources are never added together. For PSPC contract history the buyer is the client department.",
    fr: "Nombres et totaux par source, selon les règles de calcul; les sources ne sont jamais additionnées. Pour l'historique des contrats de SPAC, l'acheteur est le ministère client.",
  },
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
  "buyer.top": { en: "Largest Values: {source}", fr: "Valeurs les plus élevées : {source}" },
  "buyer.recent_awards": { en: "Newest Award Notices", fr: "Avis d'attribution les plus récents" },
  "buyer.description": {
    en: "{name}: open tender notices, contract awards, published contracts and grants by year, and the organizations with the largest values in each source.",
    fr: "{name} : avis d'appel d'offres ouverts, attributions de contrats, contrats publiés et subventions par année, et les organisations aux valeurs les plus élevées dans chaque source.",
  },

  // -- categories ---------------------------------------------------------------------------
  "categories.title": { en: "Procurement by Category", fr: "Approvisionnement par catégorie" },
  "categories.lead": {
    en: "The 57 UNSPSC segments, the top level of the commodity codes on every notice.",
    fr: "Les 57 segments de l'UNSPSC, le premier niveau des codes de marchandises de chaque avis.",
  },
  "categories.overlap": {
    en: "A notice or award counts under every segment its codes fall in, so the rows overlap and are not added up.",
    fr: "Un avis ou une attribution compte dans chaque segment où tombent ses codes; les lignes se chevauchent donc et ne sont pas additionnées.",
  },
  "categories.col_open": { en: "Open notices", fr: "Avis ouverts" },
  "categories.col_year": { en: "Awards in {year}", fr: "Attributions en {year}" },
  "categories.col_all": { en: "All awards", fr: "Toutes les attributions" },
  "category.segment": { en: "UNSPSC segment {code}", fr: "Segment UNSPSC {code}" },
  "category.all_open": { en: "Filter the open notices ({n})", fr: "Filtrer les avis ouverts ({n})" },
  "category.feed": { en: "Atom feed of new notices", fr: "Fil Atom des nouveaux avis" },
  "category.open": { en: "Open Notices", fr: "Avis ouverts" },
  "category.open_none": { en: "No open notice carries a code in this segment.", fr: "Aucun avis ouvert ne porte de code dans ce segment." },
  "category.top": { en: "Organizations by Award Value", fr: "Organisations par valeur attribuée" },
  "category.top_note": {
    en: "Award notices with a code in this segment, by the value on each notice's newest amendment.",
    fr: "Avis d'attribution portant un code de ce segment, selon la valeur de la plus récente modification de chaque avis.",
  },
  "category.years": { en: "Award Notices by Year", fr: "Avis d'attribution par année" },
  "category.not_found": { en: "Category Not Found", fr: "Catégorie introuvable" },
  "category.back": { en: "Back to the categories", fr: "Retour aux catégories" },
  "category.description": {
    en: "UNSPSC segment {code}, {name}: {n} open tender notices, the organizations with the largest award values, and awards by year.",
    fr: "Segment UNSPSC {code}, {name} : {n} avis d'appel d'offres ouverts, les organisations aux valeurs attribuées les plus élevées et les attributions par année.",
  },

  // -- rankings -------------------------------------------------------------------------------
  "rankings.title": { en: "Rankings", fr: "Classements" },
  "rankings.title_year": { en: "Rankings for {year}", fr: "Classements de {year}" },
  "rankings.lead": {
    en: "The organizations with the largest values and the most records in each source, one source at a time.",
    fr: "Les organisations aux valeurs les plus élevées et aux dossiers les plus nombreux dans chaque source, une source à la fois.",
  },
  "rankings.note": {
    en: "Each source is ranked by its own counting rules. A ranking orders records by size and makes no claim about them.",
    fr: "Chaque source est classée selon ses propres règles de calcul. Un classement ordonne des dossiers selon leur taille et n'affirme rien à leur sujet.",
  },
  "rankings.years": { en: "Years", fr: "Années" },
  "rankings.all_years": { en: "All years", fr: "Toutes les années" },
  "rankings.sources": { en: "Rank by source", fr: "Classer par source" },
  "rankings.measure": { en: "Measure", fr: "Mesure" },
  "rankings.by_value": { en: "By value", fr: "En valeur" },
  "rankings.by_count": { en: "By number of records", fr: "En nombre de dossiers" },
  "rankings.heading_value": { en: "{source}: Largest Values", fr: "{source} : valeurs les plus élevées" },
  "rankings.heading_count": { en: "{source}: Most Records", fr: "{source} : dossiers les plus nombreux" },
  "rankings.none": { en: "No ranking published for this source.", fr: "Aucun classement publié pour cette source." },
  "rankings.buyers": { en: "Buyers by Value", fr: "Acheteurs par valeur" },
  "rankings.year_not_found": { en: "No Rankings for This Year", fr: "Aucun classement pour cette année" },
  "rankings.back": { en: "Back to the rankings", fr: "Retour aux classements" },
  "rankings.description_year": {
    en: "The organizations with the largest values and the most records in each federal source in {year}, and the buyers with the largest totals.",
    fr: "Les organisations aux valeurs les plus élevées et aux dossiers les plus nombreux dans chaque source fédérale en {year}, et les acheteurs aux totaux les plus élevés.",
  },

  // -- directory ------------------------------------------------------------------------------
  "directory.index_title": { en: "Organizations", fr: "Organisations" },
  "directory.index_lead": {
    en: "{n} organizations: every supplier, grant recipient and lobbying client on record, A to Z by province.",
    fr: "{n} organisations : tous les fournisseurs, bénéficiaires de subventions et clients de lobbying au dossier, de A à Z par province.",
  },
  "directory.index_note": {
    en: "An organization is listed under the province it is recorded in most often.",
    fr: "Une organisation est classée sous la province où elle figure le plus souvent.",
  },
  "directory.col_place": { en: "Province or territory", fr: "Province ou territoire" },
  "directory.col_organizations": { en: "Organizations", fr: "Organisations" },
  "directory.col_last_seen": { en: "Latest record", fr: "Dernier dossier" },
  "directory.to_rankings": { en: "Organizations ranked by source", fr: "Organisations classées par source" },
  "directory.to_buyers": { en: "Federal buyers", fr: "Acheteurs fédéraux" },
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
    en: "The records column counts the organization's rows in every source.",
    fr: "La colonne des dossiers compte les lignes de l'organisation dans toutes les sources.",
  },
  "directory.letters": { en: "Initials", fr: "Initiales" },
  "directory.range": { en: "This page: {first} to {last}", fr: "Cette page : de {first} à {last}" },
  "directory.pages": { en: "All Pages", fr: "Toutes les pages" },

  // -- feeds ------------------------------------------------------------------------------------
  "feeds.title": { en: "Atom Feeds", fr: "Fils Atom" },
  "feeds.lead": {
    en: "Feeds of new tender notices and new award notices, each holding the {n} newest entries.",
    fr: "Fils des nouveaux avis d'appel d'offres et d'attribution, chacun contenant les {n} entrées les plus récentes.",
  },
  "feeds.privacy": {
    en: "A feed reader polls the file; the site counts polls and keeps no address.",
    fr: "Un lecteur de fils interroge le fichier; le site compte les interrogations et ne conserve aucune adresse.",
  },
  "feeds.toc_kinds": { en: "What the Feeds Carry", fr: "Contenu des fils" },
  "feeds.toc_canada": { en: "All of Canada", fr: "Tout le Canada" },
  "feeds.toc_segment": { en: "By Category", fr: "Par catégorie" },
  "feeds.toc_prov": { en: "By Province", fr: "Par province" },
  "feeds.toc_buyer": { en: "By Buyer", fr: "Par acheteur" },
  "feeds.toc_subscribe": { en: "How to Subscribe", fr: "Comment s'abonner" },
  "feeds.ev.tenders": { en: "New tender notices", fr: "Nouveaux avis d'appel d'offres" },
  "feeds.ev.awards": { en: "New award notices", fr: "Nouveaux avis d'attribution" },
  "feeds.about.tenders": {
    en: "notices first seen in the nightly refresh, with the buyer, the closing date and a link to the notice.",
    fr: "avis vus pour la première fois à la mise à jour de nuit, avec l'acheteur, la date de clôture et un lien vers l'avis.",
  },
  "feeds.about.awards": {
    en: "award notices first seen in the nightly refresh, with the supplier, the buyer, the value and a link to the notice.",
    fr: "avis d'attribution vus pour la première fois à la mise à jour de nuit, avec le fournisseur, l'acheteur, la valeur et un lien vers l'avis.",
  },
  "feeds.link_title": { en: "{event} (Atom feed)", fr: "{event} (fil Atom)" },
  "feeds.col_feed": { en: "Feed", fr: "Fil" },
  "feeds.col_address": { en: "Address", fr: "Adresse" },
  "feeds.pattern": { en: "Each address follows the pattern {pattern}.", fr: "Chaque adresse suit le modèle {pattern}." },
  "feeds.none_yet": { en: "The feed list is not published yet.", fr: "La liste des fils n'est pas encore publiée." },
  "feeds.none_scope": { en: "No feed of this kind yet.", fr: "Aucun fil de ce type pour l'instant." },
  "feeds.cell_aria": { en: "{scope}: {event}", fr: "{scope} : {event}" },
  "feeds.sub_reader": { en: "Paste an address into a feed reader.", fr: "Collez une adresse dans un lecteur de fils." },
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
    en: "The site counts the pages it serves in aggregate, on its own server: for each response it keeps the kind of page, the language, the country reported by Cloudflare's network, the name of the referring website, the response status, whether the request came from a crawler or from a person's browser, and the type of device (computer, phone or tablet) the browser reports. When a feed reader fetches a feed and states how many people it fetches it for, that number is kept as well. To count how many people visit each day without keeping their addresses, a request from a browser also gets a visitor code: the IP address and the browser's identification are hashed (SHA-256) with a key that changes every day (UTC) and is derived from a secret only the site's server holds, and the result is cut to 16 characters. The address and the browser's identification are then dropped. The same browser gets a different code the next day, and without the site's secret no one can work out a code from an address. The codes are deleted after three months with the rest of the raw counts; the daily record keeps only how many there were. The site sets no cookie for this, runs no tracking script in the browser, and keeps no IP address.",
    fr: "Le site compte de façon agrégée les pages qu'il sert, sur son propre serveur : pour chaque réponse, il conserve le type de page, la langue, le pays indiqué par le réseau de Cloudflare, le nom du site d'où vient le visiteur, le statut de la réponse, si la requête vient d'un robot d'indexation ou du navigateur d'une personne, et le type d'appareil (ordinateur, téléphone ou tablette) qu'indique le navigateur. Lorsqu'un lecteur de fils télécharge un fil et indique pour combien de personnes il le fait, ce nombre est aussi conservé. Pour compter combien de personnes viennent chaque jour sans conserver leur adresse, une requête venant d'un navigateur reçoit aussi un code de visiteur : l'adresse IP et l'identification du navigateur sont hachées (SHA-256) avec une clé qui change chaque jour (UTC) et qui est dérivée d'un secret que seul le serveur du site détient, puis le résultat est réduit à 16 caractères. L'adresse et l'identification du navigateur sont ensuite écartées. Le même navigateur reçoit un code différent le lendemain, et sans le secret du site personne ne peut retrouver un code à partir d'une adresse. Les codes sont supprimés après trois mois avec les autres comptes bruts; le relevé quotidien ne garde que leur nombre. Le site ne dépose aucun témoin à cette fin, n'exécute aucun script de suivi dans le navigateur et ne conserve aucune adresse IP.",
  },
  "data.sources_text": {
    en: "Every source is a bulk file on a government open-data host, downloaded once a night, or less often when the publisher updates it less often. No page is scraped.",
    fr: "Chaque source est un fichier en vrac hébergé sur un portail de données ouvertes du gouvernement, téléchargé une fois par nuit, ou moins souvent si l'éditeur le met à jour moins souvent. Aucune page n'est moissonnée.",
  },
  "data.col_source": { en: "Dataset", fr: "Jeu de données" },
  "data.col_publisher": { en: "Publisher", fr: "Éditeur" },
  "data.col_files": { en: "Files", fr: "Fichiers" },
  "data.col_licence": { en: "Terms", fr: "Conditions" },
  "data.col_last_read": { en: "Last read", fr: "Dernière lecture" },
  "data.not_read": { en: "Not read yet", fr: "Pas encore lu" },
  "data.modified": { en: "(publisher's date {date})", fr: "(date de l'éditeur : {date})" },
  "data.ogl_short": { en: "Open Government Licence", fr: "Licence du gouvernement ouvert" },
  "data.ogl": { en: "Open Government Licence, Canada", fr: "Licence du gouvernement ouvert, Canada" },
  "data.pub.pspc": { en: "Public Services and Procurement Canada", fr: "Services publics et Approvisionnement Canada" },
  "data.pub.tbs": { en: "Treasury Board of Canada Secretariat", fr: "Secrétariat du Conseil du Trésor du Canada" },
  "data.pub.ocl": { en: "Office of the Commissioner of Lobbying", fr: "Commissariat au lobbying" },
  "data.pub.ised": { en: "Innovation, Science and Economic Development Canada", fr: "Innovation, Sciences et Développement économique Canada" },
  "data.src.buyers": { en: "Federal organizations on open.canada.ca", fr: "Organisations fédérales sur ouvert.canada.ca" },
  "data.src.tenders": { en: "CanadaBuys tender notices", fr: "Avis d'appel d'offres d'AchatsCanada" },
  "data.src.awards": { en: "CanadaBuys award notices", fr: "Avis d'attribution d'AchatsCanada" },
  "data.src.history": { en: "CanadaBuys contract history", fr: "Historique des contrats d'AchatsCanada" },
  "data.src.contracts": { en: "Proactive publication of contracts over $10,000", fr: "Divulgation proactive des contrats de plus de 10 000 $" },
  "data.src.grants": { en: "Proactive publication of grants and contributions", fr: "Divulgation proactive des subventions et contributions" },
  "data.src.lobbying": { en: "Registry of Lobbyists, communication reports", fr: "Registre des lobbyistes, rapports de communication" },
  "data.src.registry": {
    en: "Federal corporations (Canada Business Corporations Act)",
    fr: "Sociétés fédérales (Loi canadienne sur les sociétés par actions)",
  },
  "data.downloads_text": {
    en: "CSV files rebuilt each night from the site's database, in UTF-8 with a header row.",
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
  "data.file.sums": { en: "SHA-256 checksums of the files above", fr: "Sommes de contrôle SHA-256 des fichiers ci-dessus" },
  "data.yearly_awards": { en: "Award Notices by Year of Award", fr: "Avis d'attribution par année d'attribution" },
  "data.yearly_history": { en: "PSPC Contract History by Year of Award", fr: "Historique des contrats de SPAC par année d'attribution" },
  "data.downloads_note": {
    en: "A year with no file yet answers \"not available\".",
    fr: "Une année sans fichier répond « non disponible ».",
  },
  "data.api_text": {
    en: "Read-only JSON: the same files the pages read. No key is needed. The data changes once a night, so responses may be cached for five minutes.",
    fr: "Du JSON en lecture seule : les mêmes fichiers que lisent les pages. Aucune clé n'est requise. Les données changent une fois par nuit; les réponses peuvent donc être mises en cache cinq minutes.",
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
    en: "Each address may make 60 API requests a minute; bulk use should start from the CSV files.",
    fr: "Chaque adresse peut faire 60 requêtes à l'API par minute; un usage en vrac devrait partir des fichiers CSV.",
  },
  "data.licence_text": {
    en: "Every source is published under the {ogl}, and so are the site's files. Reuse them freely with the attribution below.",
    fr: "Chaque source est publiée sous la {ogl}, tout comme les fichiers du site. Réutilisez-les librement avec la mention ci-dessous.",
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
  "data.col_new_rows": { en: "New rows", fr: "Nouvelles lignes" },
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
  "methodology.toc_people": { en: "People", fr: "Personnes" },
  "methodology.toc_claims": { en: "What the Site Does Not Claim", fr: "Ce que le site n'affirme pas" },
  "methodology.toc_corrections": { en: "Corrections and Responses", fr: "Corrections et réponses" },
  "methodology.sources_text": { en: "Each source is read from the bulk file its publisher posts:", fr: "Chaque source est lue dans le fichier en vrac que publie son éditeur :" },
  "methodology.src_tenders": {
    en: "CanadaBuys tender notices: every open notice each night, and every notice since 2022-08-08 once a week.",
    fr: "Avis d'appel d'offres d'AchatsCanada : chaque avis ouvert chaque nuit, et chaque avis depuis le 2022-08-08 une fois par semaine.",
  },
  "methodology.src_awards": {
    en: "CanadaBuys award notices: the current fiscal year each night, the complete file weekly, and the 2012 to 2022 historical file once.",
    fr: "Avis d'attribution d'AchatsCanada : l'exercice en cours chaque nuit, le fichier complet chaque semaine, et le fichier historique de 2012 à 2022 une fois.",
  },
  "methodology.src_history": {
    en: "CanadaBuys contract history: contracts awarded by Public Services and Procurement Canada for client departments since 2009, read when the monthly file changes.",
    fr: "Historique des contrats d'AchatsCanada : contrats attribués par Services publics et Approvisionnement Canada pour des ministères clients depuis 2009, lus quand le fichier mensuel change.",
  },
  "methodology.src_contracts": {
    en: "Proactive publication of contracts over $10,000: every row every department reports, read weekly.",
    fr: "Divulgation proactive des contrats de plus de 10 000 $ : chaque ligne déclarée par chaque ministère, lue chaque semaine.",
  },
  "methodology.src_grants": {
    en: "Proactive publication of grants and contributions: every agreement with an organization, read weekly.",
    fr: "Divulgation proactive des subventions et contributions : chaque accord conclu avec une organisation, lu chaque semaine.",
  },
  "methodology.src_lobbying": {
    en: "Registry of Lobbyists: the monthly communication reports, read weekly when the registry's host answers.",
    fr: "Registre des lobbyistes : les rapports mensuels de communication, lus chaque semaine lorsque l'hôte du registre répond.",
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
    en: "The name is normalized: a trade name after \"o/a\" or \"doing business as\" is split off, accents are folded, punctuation and connectors (and, et, &) are dropped, numbered-company jurisdictions are written one way, and legal suffixes (Inc., Ltd., Ltée) are removed.",
    fr: "Le nom est normalisé : une dénomination commerciale après « s/n » ou « faisant affaire sous » est séparée, les accents sont retirés, la ponctuation et les connecteurs (and, et, &) sont supprimés, les juridictions des sociétés à numéro sont écrites d'une seule façon, et les suffixes juridiques (Inc., Ltd., Ltée) sont enlevés.",
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
    en: "The name shown is the spelling seen most often; the other spellings are listed on the profile.",
    fr: "Le nom affiché est la graphie la plus fréquente; les autres graphies figurent au profil.",
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
    en: "Each federal institution is one buyer. Its ID is its open.canada.ca organization name where it has one (dnd-mdn, pwgsc-tpsgc). CanadaBuys names a buyer with its acronym in parentheses; the acronym joins it to the open.canada.ca list, and a reviewed list maps the names that do not line up. Every spelling a source uses is kept, so the mapping can be checked.",
    fr: "Chaque institution fédérale est un acheteur. Son identifiant est son nom d'organisation sur ouvert.canada.ca lorsqu'elle en a un (dnd-mdn, pwgsc-tpsgc). AchatsCanada nomme l'acheteur avec son sigle entre parenthèses; le sigle le relie à la liste d'ouvert.canada.ca, et une liste révisée associe les noms qui ne concordent pas. Chaque graphie utilisée par une source est conservée, ce qui permet de vérifier l'association.",
  },
  "methodology.buyers_history": {
    en: "In PSPC's contract history the contracting entity is always PSPC; the site files each record under the client department it was awarded for.",
    fr: "Dans l'historique des contrats de SPAC, l'entité contractante est toujours SPAC; le site classe chaque dossier sous le ministère client pour lequel il a été attribué.",
  },
  "methodology.counting_intro": { en: "Totals follow these rules, source by source:", fr: "Les totaux suivent ces règles, source par source :" },
  "methodology.count_awards": {
    en: "Award notices and PSPC contract history: one contract per reference number; its value is the total value on the newest amendment when that is positive, else the amount on the newest amendment. Totals add those values. A cancelled notice counts zero.",
    fr: "Avis d'attribution et historique des contrats de SPAC : un contrat par numéro de référence; sa valeur est la valeur totale à la plus récente modification lorsqu'elle est positive, sinon le montant de la plus récente modification. Les totaux additionnent ces valeurs. Un avis annulé compte pour zéro.",
  },
  "methodology.count_contracts": {
    en: "Published contracts (proactive publication): a row's own value is the amendment value when the row is an amendment (instrument type A, or an amendment value set and not zero), else the original value when set, else the contract value. Totals add the rows' own values. Where a procurement ID groups rows, the profile also shows the value as last reported, the largest contract value in the group, but totals never use it.",
    fr: "Contrats publiés (divulgation proactive) : la valeur propre d'une ligne est la valeur de la modification lorsque la ligne est une modification (type d'instrument A, ou valeur de modification indiquée et non nulle), sinon la valeur initiale lorsqu'elle est indiquée, sinon la valeur du contrat. Les totaux additionnent les valeurs propres des lignes. Lorsqu'un numéro d'approvisionnement regroupe des lignes, le profil montre aussi la valeur à la dernière déclaration, soit la plus grande valeur de contrat du groupe, mais les totaux ne l'utilisent jamais.",
  },
  "methodology.count_grants": {
    en: "Grants and contributions: one agreement per department and reference number; its value is the value on the highest amendment number. Totals add those.",
    fr: "Subventions et contributions : un accord par ministère et numéro de référence; sa valeur est la valeur à la modification portant le numéro le plus élevé. Les totaux additionnent ces valeurs.",
  },
  "methodology.count_years": {
    en: "Years are calendar years of the award date (award notices, contract history), the contract date (published contracts) and the agreement start (grants). Fiscal years appear only in source file names.",
    fr: "Les années sont les années civiles de la date d'attribution (avis d'attribution, historique des contrats), de la date du contrat (contrats publiés) et du début de l'accord (subventions). Les exercices financiers n'apparaissent que dans le nom des fichiers sources.",
  },
  "methodology.count_currency": {
    en: "A row whose currency is neither the Canadian dollar nor blank is shown with its currency and left out of totals; the profile says how many were left out.",
    fr: "Une ligne dont la devise n'est ni le dollar canadien ni vide est affichée avec sa devise et exclue des totaux; le profil indique combien de lignes ont été exclues.",
  },
  "methodology.never_add": {
    en: "Never across sources: a contract can appear in an award notice, in PSPC's contract history and in a department's published contracts at once, so each source is shown in its own column and no figure ever adds two sources together.",
    fr: "Jamais d'une source à l'autre : un même contrat peut figurer à la fois dans un avis d'attribution, dans l'historique des contrats de SPAC et dans les contrats publiés d'un ministère; chaque source est donc présentée dans sa propre colonne et aucun chiffre n'additionne deux sources.",
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
    en: "Published contracts, by the solicitation procedure code: TN and AC are non-competitive; OB, TC and ST are competitive; a blank is not stated.",
    fr: "Contrats publiés, selon le code de procédure d'invitation : TN et AC sont non concurrentiels; OB, TC et ST sont concurrentiels; un champ vide est non précisé.",
  },
  "methodology.competitive_share": {
    en: "The non-competitive share is given by value and by count, always with the figure it is a share of.",
    fr: "La part non concurrentielle est donnée en valeur et en nombre, toujours avec le chiffre dont elle est la part.",
  },
  "methodology.competitive_meaning": {
    en: "Federal rules allow a contract without a competition in set cases, such as a low value, a single capable supplier or an emergency. The flag repeats what the source states; the reason, where the source gives one, is on the record's page.",
    fr: "Les règles fédérales permettent un contrat sans mise en concurrence dans des cas précis, comme une faible valeur, un seul fournisseur capable ou une urgence. L'indicateur reprend ce que dit la source; le motif, lorsque la source le donne, figure sur la page du dossier.",
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
    en: "An open notice that closes within {days} days of the data date is marked closing soon.",
    fr: "Un avis ouvert dont la clôture tombe dans les {days} jours suivant la date des données porte la mention « Clôture prochaine ».",
  },
  "methodology.status_awards": {
    en: "Award and contract history statuses (active, expired, cancelled) are the source's own.",
    fr: "Les statuts des attributions et de l'historique des contrats (actif, expiré, annulé) sont ceux de la source.",
  },
  "methodology.status_regions": {
    en: "Regions of delivery map to provinces: a province named in either language to itself, the National Capital Region to Ontario and Quebec; \"Canada\", a blank or a city name maps to no province.",
    fr: "Les régions de livraison sont associées aux provinces : une province nommée dans l'une ou l'autre langue à elle-même, la région de la capitale nationale à l'Ontario et au Québec; « Canada », un champ vide ou un nom de ville ne correspond à aucune province.",
  },
  "methodology.people_individuals": {
    en: "Private individuals are never stored: grants to individuals and any supplier, recipient or client whose name reads as a person's are dropped before anything is written, and only their number is logged.",
    fr: "Les particuliers ne sont jamais conservés : les subventions versées à des particuliers et tout fournisseur, bénéficiaire ou client dont le nom se lit comme celui d'une personne sont écartés avant toute écriture, et seul leur nombre est consigné.",
  },
  "methodology.people_contacts": {
    en: "Tender and award notices carry a government contact's name, email and phone. The site never shows them; each notice page links to CanadaBuys for them.",
    fr: "Les avis d'appel d'offres et d'attribution indiquent le nom, le courriel et le téléphone d'une personne-ressource du gouvernement. Le site ne les affiche jamais; chaque page d'avis renvoie à AchatsCanada pour les obtenir.",
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
  "form.respond_title": { en: "Respond as the Organization", fr: "Répondre au nom de l'organisation" },
  "form.respond_intro": {
    en: "A statement from {organization}, published on its profile with the date it was received.",
    fr: "Une déclaration de {organization}, publiée sur son profil avec sa date de réception.",
  },
  "form.respond_review": {
    en: "The statement is published as written once the site has confirmed it comes from the organization. Leave an address so the site can confirm; it is never shown.",
    fr: "La déclaration est publiée telle quelle une fois que le site a confirmé qu'elle vient de l'organisation. Laissez une adresse pour permettre la confirmation; elle n'est jamais affichée.",
  },
  "form.respond_description": {
    en: "Send a statement to publish on the profile of {name}, dated on receipt.",
    fr: "Envoyer une déclaration à publier sur le profil de {name}, datée à sa réception.",
  },
  "form.statement": { en: "Statement", fr: "Déclaration" },
  "form.contact": { en: "Email address (optional, never shown)", fr: "Adresse courriel (facultative, jamais affichée)" },
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
  "form.err_unavailable": {
    en: "The message could not be saved just now. Try again in a moment.",
    fr: "Le message n'a pas pu être enregistré pour l'instant. Réessayez dans un moment.",
  },
  "form.correct_title": { en: "Report a Correction", fr: "Signaler une correction" },
  "form.correct_intro": {
    en: "Tell us which page or record is wrong and what it should say. Corrections are reviewed and logged on the profile they concern.",
    fr: "Indiquez la page ou le dossier erroné et ce qu'il devrait indiquer. Les corrections sont examinées et consignées au profil visé.",
  },
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
    en: "Award Watch is a secondary source. It compiles public records, and every row links to the government record it came from. Those records change nightly, so a citation should name the data date shown in the header ({date} in the citations below).",
    fr: "Award Watch est une source secondaire. Le site compile des dossiers publics, et chaque ligne renvoie au dossier gouvernemental d'où elle vient. Ces dossiers changent chaque nuit : une citation doit donc indiquer la date des données affichée dans l'en-tête ({date} dans les citations ci-dessous).",
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

  // -- support page (figures in src/support.ts) ------------------------------------------------
  "support.title": { en: "Support the Site", fr: "Soutenir le site" },
  "support.toc_holds": { en: "What the Site Holds Today", fr: "Ce que le site contient aujourd'hui" },
  "support.toc_costs": { en: "What It Costs Today", fr: "Ce qu'il coûte aujourd'hui" },
  "support.toc_tiers": { en: "Upgrade Paths", fr: "Paliers de mise à niveau" },
  "support.toc_beyond": { en: "Beyond the Costs", fr: "Au-delà des coûts" },
  "support.toc_donation": { en: "Where a Donation Goes", fr: "Où va un don" },
  "support.toc_give": { en: "How to Give", fr: "Comment donner" },
  "support.toc_transparency": { en: "Transparency", fr: "Transparence" },
  "support.toc_law": { en: "The Records and the Law", fr: "Les dossiers et la loi" },
  "support.lead": {
    en: "The site is free to use, carries no advertising and sells nothing. Support is voluntary and brings no perks, early access or say in what is published. The site is not a registered charity and cannot issue tax receipts.",
    fr: "Le site est gratuit, ne contient aucune publicité et ne vend rien. Le soutien est volontaire et ne donne droit à aucun avantage, accès anticipé ou droit de regard sur ce qui est publié. Le site n'est pas un organisme de bienfaisance enregistré et ne peut pas délivrer de reçus fiscaux.",
  },
  "support.holds_tenders": { en: "{n} open tender notices, refreshed nightly.", fr: "{n} avis d'appel d'offres ouverts, mis à jour chaque nuit." },
  "support.holds_awards": { en: "{n} award notices since 2012.", fr: "{n} avis d'attribution depuis 2012." },
  "support.holds_contracts": { en: "{n} published contracts over $10,000.", fr: "{n} contrats publiés de plus de 10 000 $." },
  "support.holds_grants": { en: "{n} grant and contribution agreements.", fr: "{n} accords de subvention et de contribution." },
  "support.holds_organizations": { en: "{n} organization profiles.", fr: "{n} profils d'organisations." },
  "support.holds_refresh": { en: "One refresh a day, at {time}.", fr: "Une mise à jour par jour, à {time}." },
  "support.refresh_midnight": { en: "midnight UTC", fr: "minuit UTC" },
  "support.refresh_hour": { en: "{hh}:00 UTC", fr: "{hh} h 00 UTC" },
  "support.limits": { en: "Current Limits", fr: "Limites actuelles" },
  "support.limit_paid": {
    en: "Since {date} the site runs on Cloudflare's Workers Paid plan: about {n} page views a month are included, with no daily ceiling. The operator pays for the plan; support received does not cover it yet.",
    fr: "Depuis le {date}, le site fonctionne avec le forfait Workers Paid de Cloudflare : environ {n} pages vues par mois sont incluses, sans plafond quotidien. L'exploitant paie le forfait; le soutien reçu ne le couvre pas encore.",
  },
  "support.limit_storage": { en: "{n} GB of file storage at no charge.", fr: "{n} Go de stockage de fichiers sans frais." },
  "support.costs_note": {
    en: "Amounts are monthly and in Canadian dollars unless stated. They are planning estimates until the site's first invoices.",
    fr: "Les montants sont mensuels et en dollars canadiens, sauf indication contraire. Ce sont des estimations jusqu'aux premières factures du site.",
  },
  "support.bar_domain": { en: "Domain registration", fr: "Enregistrement du domaine" },
  "support.bar_workers": { en: "Workers Paid plan (paid by the operator for now)", fr: "Forfait Workers Paid (payé par l'exploitant pour l'instant)" },
  "support.bar_hosting": { en: "Storage and database", fr: "Stockage et base de données" },
  "support.bar_github": { en: "GitHub task fees", fr: "Frais de tâches GitHub" },
  "support.bar_total": { en: "Total", fr: "Total" },
  "support.costs_detail": {
    en: "Domain registration is {domain} a year. Since {since} the site runs on the Workers Paid plan, {workersUsd} a month plus an allowance for tax and usage, about {workers}; the operator pays for it until support covers it. File storage and the database fit inside the plan's included allowances. The nightly refresh runs as a scheduled task on GitHub, about {github} a month.",
    fr: "L'enregistrement du domaine coûte {domain} par année. Depuis le {since}, le site fonctionne avec le forfait Workers Paid, {workersUsd} par mois plus une provision pour la taxe et l'utilisation, soit environ {workers}; l'exploitant le paie jusqu'à ce que le soutien le couvre. Le stockage de fichiers et la base de données tiennent dans les quantités incluses dans le forfait. La mise à jour de nuit s'exécute comme tâche planifiée sur GitHub, soit environ {github} par mois.",
  },
  "support.tiers_summary": {
    en: "Monthly cost of every tier: {target}. Monthly support received: {support}. Reserve held: {months} of {goal}.",
    fr: "Coût mensuel de tous les paliers : {target}. Soutien mensuel reçu : {support}. Réserve détenue : {months} sur {goal}.",
  },
  "support.tiers_note": {
    en: "Each tier assumes the ones above it; support is measured against the cumulative cost. Support received is the last 30 days of payments.",
    fr: "Chaque palier suppose ceux qui le précèdent; le soutien est mesuré par rapport au coût cumulatif. Le soutien reçu correspond aux paiements des 30 derniers jours.",
  },
  "support.col_tier": { en: "Tier", fr: "Palier" },
  "support.col_monthly_cost": { en: "Monthly cost", fr: "Coût mensuel" },
  "support.col_pays_for": { en: "What it pays for", fr: "Ce qu'il finance" },
  "support.col_against": { en: "Monthly support against cost", fr: "Soutien mensuel par rapport au coût" },
  "support.of": { en: "{part} of {whole}", fr: "{part} sur {whole}" },
  "support.status.funded": { en: "Funded", fr: "Financé" },
  "support.status.partly": { en: "Partly funded", fr: "Partiellement financé" },
  "support.status.not_yet": { en: "Not yet funded", fr: "Pas encore financé" },
  "support.status.in_place": { en: "In place, paid by the operator", fr: "En place, payé par l'exploitant" },
  "support.tier.baseline.name": { en: "Baseline", fr: "Base" },
  "support.tier.baseline.unlocks": {
    en: "Keeps the site online at its own address, with the nightly refresh on GitHub.",
    fr: "Garde le site en ligne à sa propre adresse, avec la mise à jour de nuit sur GitHub.",
  },
  "support.tier.workers_paid.name": { en: "Workers Paid plan", fr: "Forfait Workers Paid" },
  "support.tier.workers_paid.unlocks": {
    en: "Lifts the daily page-view ceiling and the per-request compute limit, and is the prerequisite for hosted search.",
    fr: "Lève le plafond quotidien de pages vues et la limite de calcul par requête, et constitue le préalable à la recherche hébergée.",
  },
  "support.tier.hosted_search.name": { en: "Hosted search", fr: "Recherche hébergée" },
  "support.tier.hosted_search.unlocks": {
    en: "Search across tenders, awards and organizations on the site with no download. Expected to run inside the Workers Paid plan's included database allowances.",
    fr: "Recherche dans les appels d'offres, les attributions et les organisations sur le site, sans téléchargement. Elle devrait fonctionner dans les quantités de base de données incluses dans le forfait Workers Paid.",
  },
  "support.tier.storage.name": { en: "Storage reserve", fr: "Réserve de stockage" },
  "support.tier.storage.unlocks": {
    en: "Pays for file storage past the free {free} GB, about {gb} GB more.",
    fr: "Paie le stockage de fichiers au-delà des {free} Go gratuits, soit environ {gb} Go de plus.",
  },
  "support.months_one": { en: "{n} month", fr: "{n} mois" },
  "support.months_many": { en: "{n} months", fr: "{n} mois" },
  "support.cents_one": { en: "{n} cent", fr: "{n} cent" },
  "support.cents_many": { en: "{n} cents", fr: "{n} cents" },
  "support.reserve_goal": {
    en: "The reserve goal is {goal} of the full monthly cost, about {about}.",
    fr: "L'objectif de réserve est de {goal} du coût mensuel complet, soit environ {about}.",
  },
  "support.estimates": {
    en: "Monthly costs are estimates. The Workers Paid plan lists at {usd} a month, about {cad}; its row adds an allowance for sales tax and usage above the included amounts. Extra storage costs about {cents} per GB a month.",
    fr: "Les coûts mensuels sont des estimations. Le forfait Workers Paid est affiché à {usd} par mois, soit environ {cad}; sa ligne ajoute une provision pour la taxe de vente et l'utilisation au-delà des quantités incluses. Le stockage supplémentaire coûte environ {cents} par Go par mois.",
  },
  "support.met": {
    en: "Monthly support now covers every tier and the reserve holds {goal}, so the site needs nothing further.",
    fr: "Le soutien mensuel couvre maintenant tous les paliers et la réserve contient {goal} : le site n'a besoin de rien de plus.",
  },
  "support.beyond_text": {
    en: "The figures above are the whole hosting budget. Once monthly support covers the monthly cost of every tier and {goal} are held in reserve, the site needs nothing further. Anything given beyond that point is personal support for the person who runs the site, and it is not spent on hosting or database upgrades.",
    fr: "Les chiffres ci-dessus constituent tout le budget d'hébergement. Une fois que le soutien mensuel couvre le coût mensuel de tous les paliers et que {goal} sont détenus en réserve, le site n'a besoin de rien de plus. Tout don au-delà de ce point est un soutien personnel à la personne qui gère le site, et il n'est pas dépensé pour l'hébergement ni pour des mises à niveau de la base de données.",
  },
  "support.gift_split": { en: "A {gift} gift, split:", fr: "Répartition d'un don de {gift} :" },
  "support.split_aria": {
    en: "Card processing fee {fee}, toward the monthly cost {net}",
    fr: "Frais de traitement par carte {fee}, contribution au coût mensuel {net}",
  },
  "support.fee_line": { en: "Card processing fee: {fee} ({rate})", fr: "Frais de traitement par carte : {fee} ({rate})" },
  "support.net_line": { en: "Toward the monthly cost: {net}", fr: "Contribution au coût mensuel : {net}" },
  "support.fee_rate": { en: "{pct} percent plus {cents} cents", fr: "{pct} % plus {cents} cents" },
  "support.donate_default": { en: "Give through the payment page", fr: "Donner par la page de paiement" },
  "support.card_note": {
    en: "Card details are entered on an outside payment page and never reach this site.",
    fr: "Les données de carte sont saisies sur une page de paiement externe et ne parviennent jamais à ce site.",
  },
  "support.closed": { en: "Donations are not open yet.", fr: "Les dons ne sont pas encore ouverts." },
  "support.col_quarter": { en: "Quarter", fr: "Trimestre" },
  "support.col_received": { en: "Received", fr: "Reçu" },
  "support.col_spent": { en: "Spent", fr: "Dépensé" },
  "support.col_reserve": { en: "Reserve", fr: "Réserve" },
  "support.no_donations": { en: "No donations yet", fr: "Aucun don pour l'instant" },
  "support.transparency_text": {
    en: "The table updates itself from the payment page's notices, which the site keeps as amount, time and kind only; names and messages are not stored. Spent is the monthly cost for each month started. A shortfall is paid by the person who runs the site.",
    fr: "Le tableau se met à jour à partir des avis de la page de paiement, que le site conserve sous forme de montant, d'heure et de type seulement; les noms et les messages ne sont pas conservés. « Dépensé » correspond au coût mensuel de chaque mois commencé. Un déficit est comblé par la personne qui gère le site.",
  },
  "support.law_text": {
    en: "Every record on the site comes from the Government of Canada's open data under the Open Government Licence, Canada, which permits reuse. A donation does not buy access to any record or any say over one.",
    fr: "Chaque dossier du site provient des données ouvertes du gouvernement du Canada, sous la Licence du gouvernement ouvert, Canada, qui en permet la réutilisation. Un don ne donne accès à aucun dossier ni droit de regard sur l'un d'eux.",
  },
} as const satisfies Record<string, Entry>;

export type Key = keyof typeof STRINGS;
type Vars = Record<string, string | number>;

// Keys whose French is the English word on purpose: names, codes and words
// spelled the same in both languages. The completeness test holds every other
// key to a French string that differs from the English.
export const SAME_IN_BOTH: ReadonlySet<Key> = new Set<Key>([
  "site.name",
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
  "support.bar_total",
  "support.cents_one",
  "support.cents_many",
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
  open: "status.open", closing: "status.closing", expired: "status.expired", cancelled: "status.cancelled",
  awarded: "status.awarded", active: "status.active", unknown: "status.unknown",
};

// Tender statuses, the derived closing-soon state, and award statuses.
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
  if (pct > 0 && pct < 1) return t(lang, "pct", { n: lang === "fr" ? "< 1" : "<1" });
  return t(lang, "pct", { n: Math.round(pct) });
}
