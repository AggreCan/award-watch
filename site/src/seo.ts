// Search-engine metadata: the title and description a result list shows, the
// canonical URL and language alternates, the social tags, structured data
// (JSON-LD), and the crawler files. layout.tsx renders a page's Seo object
// into its head; the page files build it with the helpers below. Words the
// pages already show come from the dictionary in i18n.ts; the result-list
// titles and descriptions of the fixed pages live here.

import type { Context } from "hono";
import type { Buyer, Category, ContractDetail, Profile, TenderDetail } from "./data";
import type { AppEnv } from "./env";
import { fmtInt, frTypography, pick, provinceName, segmentLabel, t, type Key, type Lang } from "./i18n";
import { publishedReference } from "./data";

// Canonical URLs name the apex domain whichever host served the request, so
// www and apex never compete in an index. robots.txt, llms.txt and the
// pipeline's sitemaps name the same origin; change them together.
export const SITE_ORIGIN = "https://awardwatch.ca";
export const SITE_NAME = "Award Watch";
// A result list cuts a description near 160 characters; stay at 155 or under.
export const DESCRIPTION_MAX = 155;

// French sets a narrow no-break space before a colon, as the dictionary does.
const FR_COLON = `${String.fromCharCode(0x202f)}: `;

export interface Seo {
  // The page's path with no query string. Filters, paging and the language
  // query all collapse onto it (French views add ?lang=fr, see canonicalUrl).
  path: string;
  description: string;
  // The whole <title>; without it the layout writes "<page title> | Award Watch".
  title?: string;
  // og:title and twitter:title; defaults to the page title.
  socialTitle?: string;
  jsonLd?: object[];
  noindex?: boolean;
}

type Both = Record<Lang, string>;

export type PageKey =
  | "home" | "tenders" | "tenders_new" | "same_day" | "awards" | "awards_erroneous" | "expiring" | "organizations" | "buyers"
  | "segments" | "rankings"
  | "feeds" | "watchlist" | "methodology" | "data" | "cite" | "corrections" | "about" | "terms" | "privacy" | "alerts" | "pro";

// A result list shows about 60 characters of a title; the whole <title>,
// " | Award Watch" included, stays within it (test/seo-intent.test.ts).
export const TITLE_MAX = 60;

// `name` is the result-list name, either written here or, where the page's own
// heading already reads well in a result list, its dictionary key. The
// section pages name what a reader searches for (docs/seo.md, the intent
// table): open federal tenders, who won, contracts ending, the suppliers and
// the departments, the data, the paid plan.
const PAGES: Record<PageKey, { path: string; name: Both | Key; title?: Both; description: Both }> = {
  home: {
    path: "/",
    name: "site.name",
    title: {
      en: "Award Watch: Federal Tenders, Awards and Contracts Ending",
      fr: "Award Watch : appels d'offres et contrats fédéraux du Canada",
    },
    description: {
      en: "Canadian federal tenders from CanadaBuys, who won each contract, and the contracts ending within a year, by supplier and department. Updated nightly.",
      fr: "Appels d'offres d'AchatsCanada, contrats attribués et contrats qui prennent fin d'ici un an, par fournisseur et par ministère. Mis à jour chaque nuit.",
    },
  },
  tenders: {
    path: "/tenders",
    name: { en: "Open Federal Tenders from CanadaBuys", fr: "Appels d'offres ouverts d'AchatsCanada" },
    description: {
      en: "Every open federal tender notice on CanadaBuys, filtered by UNSPSC segment, region, buyer and closing date, each linked to its notice.",
      fr: "Tous les avis d'appel d'offres fédéraux ouverts sur AchatsCanada, filtrés par segment, région, acheteur et date de clôture, chacun lié à son avis.",
    },
  },
  tenders_new: {
    path: "/tenders/new",
    name: { en: "New Federal Tenders by Day", fr: "Nouveaux appels d'offres fédéraux par jour" },
    description: {
      en: "The federal tender notices CanadaBuys published each day over the last 30 days, newest first, with the buyer and the closing date.",
      fr: "Les avis d'appel d'offres fédéraux publiés chaque jour sur AchatsCanada depuis 30 jours, du plus récent au plus ancien, avec acheteur et clôture.",
    },
  },
  same_day: {
    path: "/tenders/same-day",
    name: { en: "Same-Day CanadaBuys Tender Notices", fr: "Avis d'AchatsCanada publiés le jour même" },
    description: {
      en: "Federal tender notices CanadaBuys posts during the day, read every two hours through the business day. Part of Pro, the paid plan.",
      fr: "Les avis d'appel d'offres publiés sur AchatsCanada pendant la journée, lus toutes les deux heures. Offerts avec Pro, le forfait payant.",
    },
  },
  awards: {
    path: "/awards",
    name: { en: "Federal Contract Awards: Who Won", fr: "Contrats fédéraux attribués : qui a gagné" },
    description: {
      en: "Who won federal contracts: the newest CanadaBuys award notices with supplier, buyer, value and procurement method, each linked to the notice.",
      fr: "Qui a remporté les contrats fédéraux : les plus récents avis d'attribution d'AchatsCanada, avec fournisseur, acheteur, valeur et méthode.",
    },
  },
  // Award notices whose award date falls after the data date, listed apart (pages/awards.tsx).
  awards_erroneous: {
    path: "/awards/erroneous",
    name: { en: "Erroneous Award Notice Submissions", fr: "Avis d'attribution : soumissions erronées" },
    description: {
      en: "CanadaBuys award notices whose award date falls after the data date, shown as published beside the contract's start and end dates.",
      fr: "Avis d'attribution d'AchatsCanada dont la date d'attribution tombe après la date des données, tels que publiés, avec les dates du contrat.",
    },
  },
  expiring: {
    path: "/expiring",
    name: { en: "Federal Contracts Ending Soon, with Incumbents", fr: "Contrats fédéraux qui prennent fin bientôt" },
    description: {
      en: "Federal contracts ending within 3, 6 or 12 months: incumbent supplier, buyer, value, competition and amendments, each linked to its record.",
      fr: "Contrats fédéraux qui prennent fin d'ici 3, 6 ou 12 mois : fournisseur en place, acheteur, valeur, concurrence et modifications.",
    },
  },
  organizations: {
    path: "/organizations",
    name: { en: "Federal Suppliers and Grant Recipients", fr: "Fournisseurs et bénéficiaires fédéraux" },
    description: {
      en: "Every federal supplier, grant recipient and lobbying client on record, A to Z by province, each with a profile of its contracts and grants.",
      fr: "Chaque fournisseur, bénéficiaire de subventions et client de lobbying fédéral au dossier, de A à Z par province, avec le profil de ses dossiers.",
    },
  },
  buyers: {
    path: "/buyers",
    name: { en: "Federal Buyers: Departments and Agencies", fr: "Acheteurs fédéraux : ministères et organismes" },
    description: {
      en: "Each federal department, agency and Crown corporation: its open tenders, contract awards, published contracts, grants and largest suppliers.",
      fr: "Chaque ministère, organisme et société d'État fédéral : appels d'offres ouverts, attributions, contrats publiés, subventions et fournisseurs.",
    },
  },
  segments: {
    path: "/segments",
    name: { en: "Federal Tenders and Awards by UNSPSC Segment", fr: "Appels d'offres fédéraux par segment UNSPSC" },
    description: {
      en: "The 57 UNSPSC segments of federal procurement: open tenders, this year's contract awards and the suppliers that won them, segment by segment.",
      fr: "Les 57 segments UNSPSC de l'approvisionnement fédéral : appels d'offres ouverts, attributions de l'année et fournisseurs retenus.",
    },
  },
  rankings: {
    path: "/rankings",
    name: { en: "Top Federal Suppliers and Grant Recipients", fr: "Classements des fournisseurs fédéraux" },
    description: {
      en: "The organizations with the most contract awards, published contracts and grants, by value and by count, each source ranked on its own.",
      fr: "Les organisations qui comptent le plus d'attributions, de contrats publiés et de subventions, en valeur et en nombre, chaque source à part.",
    },
  },
  feeds: {
    path: "/feeds",
    name: { en: "Atom Feeds of New Federal Tenders", fr: "Fils Atom des appels d'offres fédéraux" },
    description: {
      en: "Atom feeds of new tender notices and award notices: all of Canada, by segment, by province and by buyer.",
      fr: "Fils Atom des nouveaux avis d'appel d'offres et d'attribution : tout le Canada, par segment, par province et par acheteur.",
    },
  },
  watchlist: {
    path: "/watchlist",
    name: "watch.title",
    description: {
      en: "Follow organizations from this browser and see which have new records since your last visit. Nothing is sent to the site.",
      fr: "Suivez des organisations à partir de ce navigateur et voyez lesquelles ont de nouveaux dossiers depuis votre dernière visite.",
    },
  },
  about: {
    path: "/about",
    name: "about.title",
    description: {
      en: "Who publishes Award Watch, what it holds, how it counts, and how to reach it.",
      fr: "Qui publie Award Watch, ce qu'il contient, comment il calcule et comment le joindre.",
    },
  },
  terms: {
    path: "/terms",
    name: { en: "Terms of Use", fr: "Conditions d'utilisation" },
    description: {
      en: "The terms for reading Award Watch, reusing its files under the Open Government Licence, Canada, and subscribing to Pro.",
      fr: "Les conditions de lecture d'Award Watch, de réutilisation de ses fichiers sous la Licence du gouvernement ouvert, Canada, et de Pro.",
    },
  },
  privacy: {
    path: "/privacy",
    name: { en: "Privacy", fr: "Confidentialité" },
    description: {
      en: "What Award Watch keeps about a visit: aggregate counts with no address, one language cookie, and what the forms store.",
      fr: "Ce qu'Award Watch conserve d'une visite : des comptes agrégés sans adresse, un témoin de langue et ce que conservent les formulaires.",
    },
  },
  alerts: {
    path: "/alerts",
    name: { en: "Email Alerts for New Federal Tenders", fr: "Alertes courriel des appels d'offres fédéraux" },
    description: {
      en: "Email lists of new federal tender notices by category, segment and province, and of contracts entering the 3-month window. Delivery is part of Pro.",
      fr: "Listes par courriel des nouveaux appels d'offres fédéraux par catégorie, segment et province, et des contrats à 3 mois. L'envoi fait partie de Pro.",
    },
  },
  methodology: {
    path: "/methodology",
    name: { en: "Methodology: Sources, Identity and Counting", fr: "Méthodologie : sources, identité et calculs" },
    description: {
      en: "How the site reads each federal source, merges organizations and buyers, totals money source by source, and what it does not claim.",
      fr: "Comment le site lit chaque source fédérale, fusionne organisations et acheteurs, totalise les montants par source, et ce qu'il n'affirme pas.",
    },
  },
  data: {
    path: "/data",
    name: { en: "Federal Procurement Data: CSV, API, Licence", fr: "Données des marchés fédéraux : CSV et API" },
    description: {
      en: "CSV downloads of federal tenders, awards, contracts, grants, organizations and buyers, the open JSON API, the source files and the licence.",
      fr: "Téléchargements CSV des appels d'offres, attributions, contrats, subventions, organisations et acheteurs fédéraux, l'API JSON et la licence.",
    },
  },
  cite: {
    path: "/cite",
    name: "cite.title",
    description: {
      en: "How to cite the site and its data in APA, MLA, Chicago, Harvard, BibTeX or RIS, with the data date each citation should name.",
      fr: "Comment citer le site et ses données selon APA, MLA, Chicago, Harvard, BibTeX ou RIS, avec la date des données à indiquer.",
    },
  },
  corrections: {
    path: "/corrections",
    name: "form.correct_title",
    description: {
      en: "Report a wrong organization match, a buyer mapped to the wrong institution or a record shown wrongly. Changes are logged after review.",
      fr: "Signalez un mauvais appariement d'organisation, un acheteur mal associé ou un dossier mal affiché. Les changements sont consignés.",
    },
  },
  pro: {
    path: "/pro",
    name: { en: "Pro: Tender Alerts and Contracts Ending", fr: "Pro : alertes et contrats prenant fin" },
    description: {
      en: "Pro adds same-day tender notices, the 6- and 12-month lists of contracts ending (the recompetes ahead), watchlists, email alerts, analytics and an API.",
      fr: "Pro ajoute les avis du jour même, les listes de 6 et 12 mois des contrats prenant fin (les remises en concurrence), les suivis, les alertes et une API.",
    },
  },
};

// The result-list titles of the radar's three windows, where the page's
// heading ("Contracts Ending Within 3 Months") leaves out "federal".
const WINDOW_TITLES: Record<string, Both> = {
  "3m": { en: "Federal Contracts Ending Within 3 Months", fr: "Contrats fédéraux prenant fin d'ici 3 mois" },
  "6m": { en: "Federal Contracts Ending Within 6 Months", fr: "Contrats fédéraux prenant fin d'ici 6 mois" },
  "12m": { en: "Federal Contracts Ending Within 12 Months", fr: "Contrats fédéraux prenant fin d'ici 12 mois" },
};

// French strings written here get the dictionary's typography (apostrophe,
// the narrow space before a colon); English is left as written.
function local(lang: Lang, both: Both): string {
  return lang === "fr" ? frTypography(both.fr) : both.en;
}

// Pages with no Seo of their own (errors, the thank-you page) still carry a
// description: the home page's.
export function defaultDescription(lang: Lang): string {
  return local(lang, PAGES.home.description);
}

export function pageTitle(name: string): string {
  return `${name} | ${SITE_NAME}`;
}

export function pageSeo(key: PageKey, lang: Lang, extra: Partial<Seo> = {}): Seo {
  const p = PAGES[key];
  const name = typeof p.name === "string" ? t(lang, p.name) : local(lang, p.name);
  const title = p.title ? local(lang, p.title) : pageTitle(name);
  return {
    path: p.path,
    title,
    socialTitle: p.title ? title : name,
    description: local(lang, p.description),
    ...extra,
  };
}

// Google pairs language versions only between canonical URLs, and a crawler
// carries no cookie, so the plain URL is the English page and ?lang=fr the
// French one. Each version names itself as canonical; a French page that named
// the plain URL would be folded into the English one and drop out of results.
// A path that already carries a query (a year page's ?page=2) takes the language after an ampersand.
export function canonicalUrl(path: string, lang: Lang): string {
  return `${SITE_ORIGIN}${path}${lang === "fr" ? `${path.includes("?") ? "&" : "?"}lang=fr` : ""}`;
}

export function alternates(path: string): { hreflang: string; href: string }[] {
  return [
    { hreflang: "en", href: canonicalUrl(path, "en") },
    { hreflang: "fr", href: canonicalUrl(path, "fr") },
    { hreflang: "x-default", href: canonicalUrl(path, "en") },
  ];
}

export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}

/// The publisher: Allwater Software Inc., the British Columbia corporation the
// About and Terms pages name, never a person. The logo is the site's mark
// (public/brand/mark-512.png), which Google takes for an organization's logo
// at 112 px square or more.
export const PUBLISHER_NAME = "Allwater Software Inc.";
export const LOGO_PATH = "/brand/mark-512.png";
export const LOGO_SIZE = 512;
const ORG_ID = `${SITE_ORIGIN}/#organization`;

function publisher(lang: Lang): Record<string, unknown> {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: PUBLISHER_NAME,
    url: canonicalUrl("/about", lang),
    logo: { "@type": "ImageObject", url: absoluteUrl(LOGO_PATH), width: LOGO_SIZE, height: LOGO_SIZE },
    address: { "@type": "PostalAddress", addressRegion: "BC", addressCountry: "CA" },
  };
}

// The site search (pages/search.tsx), organizations and buyers by name. Google
// retired the sitelinks search box in 2024; other readers of the markup still
// take the action.
export function searchUrlTemplate(lang: Lang): string {
  return `${SITE_ORIGIN}/search?q={search_term_string}${lang === "fr" ? "&lang=fr" : ""}`;
}

export function homeJsonLd(lang: Lang): object {
  return {
    "@context": "https://schema.org",
    "@graph": [
      publisher(lang),
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: SITE_NAME,
        url: canonicalUrl("/", lang),
        description: local(lang, PAGES.home.description),
        inLanguage: ["en-CA", "fr-CA"],
        publisher: { "@id": ORG_ID },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: searchUrlTemplate(lang) },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

// The licence the Registry of Lobbyists publishes its data under, as its
// open.canada.ca record links it (an English page; the registry's site
// switches language itself).
export const ODLA_URL = "https://lobbycanada.gc.ca/en/open-data/open-data-licence-agreement/";

export const OGL_URL: Both = {
  en: "https://open.canada.ca/en/open-government-licence-canada",
  fr: "https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada",
};

const DATASET_NAME: Both = {
  en: "Award Watch: Federal Tenders, Contracts, Grants and Lobbying by Organization",
  fr: "Award Watch : appels d'offres, contrats, subventions et lobbying fédéraux par organisation",
};
const DATASET_DESCRIPTION: Both = {
  en:
    "Open and past CanadaBuys tender notices, award notices and PSPC contract history, the proactive publication of " +
    "contracts over $10,000 and of grants and contributions, and lobbying communication reports, merged by organization " +
    "under a stable ID. Each row keeps the publisher's reference number and the file it was read from. Regenerated nightly.",
  fr:
    "Les avis d'appel d'offres et d'attribution d'AchatsCanada et l'historique des contrats de SPAC, la divulgation " +
    "proactive des contrats de plus de 10 000 $ et des subventions et contributions, et les rapports de communication " +
    "de lobbying, fusionnés par organisation sous un identifiant stable. Chaque ligne garde le numéro de référence de " +
    "l'éditeur et le fichier d'où elle vient. Régénéré chaque nuit.",
};
const DATASET_KEYWORDS: Record<Lang, string[]> = {
  en: ["federal procurement", "tenders", "contracts", "grants and contributions", "lobbying", "CanadaBuys", "proactive disclosure", "Canada"],
  fr: ["approvisionnement fédéral", "appels d'offres", "contrats", "subventions et contributions", "lobbying", "AchatsCanada", "divulgation proactive", "Canada"],
};

// The downloadable sets of the Data page, each a Dataset of its own inside
// the site's (hasPart), with its files, its licence and the government
// dataset it is read from. The 12-month radar file is Pro's and is left out;
// the 3-month file stands for the radar.
export const DATA_SETS = ["open-tenders", "awards", "history", "contracts", "grants", "organizations", "organization-aliases",
  "buyers", "expiring-3m"] as const;
export type DataSetId = (typeof DATA_SETS)[number];
export type DataSet = { id: DataSetId; files: readonly string[]; basedOn: readonly string[]; from?: number };

const SET_TEXT: Record<DataSetId, { name: Both; description: Both }> = {
  "open-tenders": {
    name: { en: "Open Federal Tender Notices", fr: "Avis d'appel d'offres fédéraux ouverts" },
    description: {
      en: "Every tender notice open on CanadaBuys on the data date, one row per notice with its list fields: reference, title, buyer, closing date, UNSPSC segments and regions.",
      fr: "Tous les avis d'appel d'offres ouverts sur AchatsCanada à la date des données, une ligne par avis avec ses champs de liste : référence, titre, acheteur, clôture, segments UNSPSC et régions.",
    },
  },
  awards: {
    name: { en: "Federal Contract Award Notices by Year", fr: "Avis d'attribution de contrats fédéraux par année" },
    description: {
      en: "The award notices published on CanadaBuys, one file per calendar year of award: supplier, buyer, value, procurement method and the organization ID each supplier is merged under.",
      fr: "Les avis d'attribution publiés sur AchatsCanada, un fichier par année d'attribution : fournisseur, acheteur, valeur, méthode d'approvisionnement et l'identifiant de l'organisation.",
    },
  },
  history: {
    name: { en: "PSPC Contract History by Year", fr: "Historique des contrats de SPAC par année" },
    description: {
      en: "The contracts Public Services and Procurement Canada awarded for federal departments, one file per calendar year of award, with supplier, client department and value.",
      fr: "Les contrats que Services publics et Approvisionnement Canada a attribués pour les ministères, un fichier par année d'attribution, avec fournisseur, ministère client et valeur.",
    },
  },
  contracts: {
    name: { en: "Published Federal Contracts over $10,000 by Year", fr: "Contrats fédéraux publiés de plus de 10 000 $ par année" },
    description: {
      en: "The contracts over $10,000 federal departments publish under proactive disclosure, one file per calendar year of contract date, one row per row published, amendments included.",
      fr: "Les contrats de plus de 10 000 $ que publient les ministères fédéraux en divulgation proactive, un fichier par année de la date du contrat, une ligne par ligne publiée.",
    },
  },
  grants: {
    name: { en: "Federal Grants and Contributions by Year", fr: "Subventions et contributions fédérales par année" },
    description: {
      en: "The grant and contribution agreements federal departments publish, one file per calendar year of agreement start, one row per amendment, with recipient, program and value.",
      fr: "Les accords de subvention et de contribution que publient les ministères fédéraux, un fichier par année de début, une ligne par modification, avec bénéficiaire, programme et valeur.",
    },
  },
  organizations: {
    name: { en: "Organizations Receiving Federal Money", fr: "Organisations qui reçoivent des fonds fédéraux" },
    description: {
      en: "One row per organization named in the federal records the site reads: its stable ID, name, place, and its counts and totals in each source, each source counted on its own.",
      fr: "Une ligne par organisation nommée dans les dossiers fédéraux que lit le site : identifiant stable, nom, lieu, et ses nombres et totaux dans chaque source, comptés séparément.",
    },
  },
  "organization-aliases": {
    name: { en: "Organization ID Aliases", fr: "Alias des identifiants d'organisation" },
    description: {
      en: "One row per organization ID the site has retired, with the ID that holds its records now, the reason (a merge or a change to the name rules), a note and the date since. IDs only, no record data.",
      fr: "Une ligne par identifiant d'organisation que le site a retiré, avec l'identifiant qui détient ses dossiers, le motif (une fusion ou un changement des règles de nom), une note et la date de début. Identifiants seulement.",
    },
  },
  buyers: {
    name: { en: "Federal Buyers", fr: "Acheteurs fédéraux" },
    description: {
      en: "One row per federal department, agency and Crown corporation that buys or funds, with its counts and totals in each source: tenders, awards, contracts and grants.",
      fr: "Une ligne par ministère, organisme et société d'État fédéral qui achète ou finance, avec ses nombres et totaux dans chaque source : appels d'offres, attributions, contrats, subventions.",
    },
  },
  "expiring-3m": {
    name: { en: "Federal Contracts Ending Within 3 Months", fr: "Contrats fédéraux prenant fin d'ici 3 mois" },
    description: {
      en: "Every federal contract ending within 3 months of the data date, each listed once across award notices, PSPC contract history and published contracts, with the incumbent supplier.",
      fr: "Chaque contrat fédéral qui prend fin dans les 3 mois suivant la date des données, inscrit une seule fois entre les sources, avec le fournisseur en place.",
    },
  },
};

const fr = (lang: Lang, s: string) => (lang === "fr" ? frTypography(s) : s);

function setJsonLd(set: DataSet, dataAsOf: string | null, lang: Lang, org: Record<string, unknown>): object {
  const text = SET_TEXT[set.id];
  return {
    "@type": "Dataset",
    "@id": `${SITE_ORIGIN}/data#${set.id}`,
    name: local(lang, text.name),
    description: local(lang, text.description),
    url: canonicalUrl("/data", lang) + "#downloads",
    license: OGL_URL[lang],
    isAccessibleForFree: true,
    creator: org,
    publisher: org,
    inLanguage: lang,
    spatialCoverage: { "@type": "Place", name: "Canada" },
    ...(set.from ? { temporalCoverage: `${set.from}/..` } : {}),
    ...(dataAsOf ? { dateModified: dataAsOf } : {}),
    isBasedOn: [...set.basedOn],
    distribution: set.files.map((file) => ({
      "@type": "DataDownload",
      name: file,
      encodingFormat: "text/csv",
      contentUrl: absoluteUrl(`/downloads/${file}`),
      license: OGL_URL[lang],
    })),
  };
}

export function datasetJsonLd(sets: readonly DataSet[], dataAsOf: string | null, lang: Lang): object {
  const org = publisher(lang);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${SITE_ORIGIN}/data#dataset`,
    name: local(lang, DATASET_NAME),
    description: local(lang, DATASET_DESCRIPTION),
    url: canonicalUrl("/data", lang),
    keywords: DATASET_KEYWORDS[lang].map((k) => fr(lang, k)),
    license: OGL_URL[lang],
    isAccessibleForFree: true,
    creditText: t(lang, "data.credit"),
    creator: org,
    publisher: org,
    inLanguage: lang,
    spatialCoverage: { "@type": "Place", name: "Canada" },
    temporalCoverage: "2004/..",
    ...(dataAsOf ? { dateModified: dataAsOf } : {}),
    isBasedOn: [...new Set(sets.flatMap((s) => s.basedOn))],
    hasPart: sets.map((s) => setJsonLd(s, dataAsOf, lang, org)),
  };
}

// The Pro page (pages/pro.tsx): the plan as a Product with one Offer per
// billing period, at the figures the billing page prints (the operator's
// PRICE_MONTHLY_CAD and PRICE_YEARLY_CAD), taxes not included; and the
// page's questions as a FAQPage, word for word as the page shows them. No
// Product without a price: the page leaves it out while the checkout is
// not configured.
export type Faq = { q: string; a: string };

export function proJsonLd(
  lang: Lang, o: { price: { monthly: string; yearly: string } | null; description: string; faq: readonly Faq[] },
): object[] {
  const url = canonicalUrl("/pro", lang);
  const org = publisher(lang);
  const offer = (figure: string, unit: "MON" | "ANN", name: Both) => ({
    "@type": "Offer",
    name: local(lang, name),
    price: figure,
    priceCurrency: "CAD",
    availability: "https://schema.org/InStock",
    url,
    seller: org,
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: figure,
      priceCurrency: "CAD",
      valueAddedTaxIncluded: false,
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: unit },
    },
  });
  const out: object[] = [];
  if (o.price) {
    out.push({
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${SITE_ORIGIN}/pro#product`,
      name: "Award Watch Pro",
      description: o.description,
      url,
      image: absoluteUrl(LOGO_PATH),
      brand: { "@type": "Brand", name: SITE_NAME },
      category: lang === "fr" ? "Abonnement à un service de données" : "Data service subscription",
      offers: [
        offer(o.price.monthly, "MON", { en: "Pro, monthly", fr: "Pro, mensuel" }),
        offer(o.price.yearly, "ANN", { en: "Pro, yearly", fr: "Pro, annuel" }),
      ],
    });
  }
  out.push({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_ORIGIN}/pro#faq`,
    inLanguage: lang,
    mainEntity: o.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  });
  return out;
}

// The visible trail of a page, as structured data. Every crumb but the last
// needs a URL, so a crumb without one (shown as plain text) is left out.
export function breadcrumbJsonLd(crumbs: { name: string; path?: string }[]): object {
  const items = crumbs.filter((c, i) => c.path || i === crumbs.length - 1);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.path && i < items.length - 1 ? { item: absoluteUrl(c.path) } : {}),
    })),
  };
}

// Cuts at a word boundary and marks the cut with an ellipsis.
export function clip(text: string, max = DESCRIPTION_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

export function sectionSeo(path: string, title: string, description: string, crumbs: { name: string; path?: string }[], noindex = false): Seo {
  return {
    path,
    title: pageTitle(title),
    socialTitle: title,
    description: clip(description),
    jsonLd: [breadcrumbJsonLd(crumbs)],
    noindex,
  };
}

// One window of the contracts ending soon. A filtered or later page is a view
// of the window's first page and stays out of the index. The result list
// names the window as a federal one (WINDOW_TITLES); the heading stays.
export function expiringWindowSeo(
  path: string, title: string, lang: Lang, crumbs: { name: string; path?: string }[],
  o: { n: number; months: string; date: string; noindex: boolean },
): Seo {
  const description = t(lang, "expiring.window_description", { n: fmtInt(o.n, lang), months: o.months, date: o.date });
  const named = WINDOW_TITLES[path.slice(path.lastIndexOf("/") + 1)];
  const listed = named ? local(lang, named) : title;
  return { ...sectionSeo(path, listed, description, crumbs, o.noindex), socialTitle: listed };
}

function plural(n: number, one: string, many: string, lang: Lang): string {
  // English takes the singular for 1 only; French for 0 and 1, as tn() does.
  const singular = lang === "fr" ? Math.abs(n) < 2 : n === 1;
  return `${fmtInt(n, lang)} ${singular ? one : many}`;
}

function joinList(parts: string[], lang: Lang): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${lang === "fr" ? "et" : "and"} ${parts[parts.length - 1]}`;
}

const FACT_WORDS: Record<"awards" | "history" | "contracts" | "grants" | "lobbying", Record<Lang, [string, string]>> = {
  awards: { en: ["award notice", "award notices"], fr: ["avis d'attribution", "avis d'attribution"] },
  history: { en: ["PSPC contract", "PSPC contracts"], fr: ["contrat de SPAC", "contrats de SPAC"] },
  contracts: { en: ["published contract", "published contracts"], fr: ["contrat publié", "contrats publiés"] },
  grants: { en: ["grant or contribution", "grants and contributions"], fr: ["subvention ou contribution", "subventions et contributions"] },
  lobbying: { en: ["lobbying communication", "lobbying communications"], fr: ["communication de lobbying", "communications de lobbying"] },
};

// "Example Systems Inc., Ottawa, ON: 12 award notices and 3 published
// contracts. Records from CanadaBuys and open.canada.ca, each linked to its
// source." When space runs short the closing sentence goes first, then the
// place, and only then is the name clipped. The name is used exactly as
// recorded, never retouched by the French typography.
export function organizationDescription(profile: Profile, lang: Lang): string {
  const o = profile.organization;
  const counts = { awards: o.n_awards, history: o.n_history, contracts: o.n_contracts, grants: o.n_grants, lobbying: o.n_lobbying };
  const facts = (Object.keys(FACT_WORDS) as (keyof typeof FACT_WORDS)[])
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const [one, many] = FACT_WORDS[k][lang];
      return plural(counts[k], lang === "fr" ? frTypography(one) : one, lang === "fr" ? frTypography(many) : many, lang);
    });
  const sep = lang === "fr" ? FR_COLON : ": ";
  const body = facts.length ? `${sep}${joinList(facts, lang)}.` : `${sep}${t(lang, "org.no_records_short")}.`;
  const tail = ` ${t(lang, "org.description_tail")}`;
  const where = [o.city, o.province ? provinceName(lang, o.province) : null].filter(Boolean).join(", ");
  const head = where ? `${o.display_name}, ${where}` : o.display_name;
  const fit = [head + body + tail, head + body, o.display_name + body].find((s) => s.length <= DESCRIPTION_MAX);
  if (fit) return fit;
  const room = DESCRIPTION_MAX - body.length;
  return room >= 20 ? clip(o.display_name, room) + body : clip(o.display_name + body, DESCRIPTION_MAX);
}

export function organizationSeo(profile: Profile, lang: Lang, crumbs: { name: string; path?: string }[]): Seo {
  const o = profile.organization;
  return {
    path: `/organizations/${o.id}`,
    description: organizationDescription(profile, lang),
    socialTitle: o.display_name,
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };
}

// The response form exists once per organization and repeats the same copy,
// so it stays out of the index; the profile it belongs to is the page to find.
export function respondFormSeo(profile: Profile, lang: Lang): Seo {
  return {
    path: `/organizations/${profile.organization.id}/respond`,
    description: clip(t(lang, "form.respond_description", { name: profile.organization.display_name })),
    noindex: true,
  };
}

export function tenderSeo(d: TenderDetail, lang: Lang, crumbs: { name: string; path?: string }[]): Seo {
  const title = pick(lang, d.title_en, d.title_fr) ?? publishedReference(d);
  const buyer = pick(lang, d.buyer_en, d.buyer_fr);
  const description = t(lang, "tender.description", {
    reference: publishedReference(d),
    buyer: buyer ?? t(lang, "common.na"),
    closing: d.closing ? d.closing.slice(0, 10) : t(lang, "common.na"),
  });
  return {
    path: `/tenders/${d.reference.toLowerCase()}`,
    title: pageTitle(clip(title, 90)),
    socialTitle: title,
    description: clip(description),
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };
}

export function contractSeo(d: ContractDetail, lang: Lang, crumbs: { name: string; path?: string }[]): Seo {
  const title = pick(lang, d.title_en, d.title_fr) ?? publishedReference(d);
  const description = t(lang, d.kind === "award" ? "contract.description_award" : "contract.description_history", {
    reference: publishedReference(d),
    supplier: d.supplier ?? t(lang, "common.na"),
    buyer: pick(lang, d.buyer_en, d.buyer_fr) ?? t(lang, "common.na"),
    date: d.awarded ?? t(lang, "common.na"),
  });
  return {
    path: `/${d.kind === "award" ? "awards" : "history"}/${d.reference.toLowerCase()}`,
    title: pageTitle(clip(title, 90)),
    socialTitle: title,
    description: clip(description),
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };
}

export function buyerSeo(b: Buyer, lang: Lang, crumbs: { name: string; path?: string }[]): Seo {
  const name = pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? b.buyer.id;
  return {
    path: `/buyers/${b.buyer.id}`,
    title: pageTitle(name),
    socialTitle: name,
    description: clip(t(lang, "buyer.description", { name })),
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };
}

export function segmentSeo(seg: Category, lang: Lang, crumbs: { name: string; path?: string }[]): Seo {
  const name = segmentLabel(lang, seg.code);
  return {
    path: `/segments/${seg.code}`,
    title: pageTitle(name),
    socialTitle: name,
    description: clip(t(lang, "segment.description", { name, code: seg.code, n: fmtInt(seg.open_tenders.length, lang) })),
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };
}

// --- Crawler files ---------------------------------------------------------

// The sitemaps are src/sitemaps.ts's.

async function textFile(c: Context<AppEnv>, name: string): Promise<Response> {
  const res = c.env.ASSETS ? await c.env.ASSETS.fetch(new Request(`https://assets.invalid/${name}`)) : null;
  if (!res || !res.ok) return c.notFound();
  return new Response(res.body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

// public/robots.txt and public/llms.txt are served by the assets layer before
// the Worker runs. These routes answer when a request reaches the Worker
// anyway (a run-worker-first configuration, the test runtime), from the same
// files. llms.txt tells AI crawlers and agents where the bulk files are, so
// they need not walk the profiles.
export const llmsTxt = (c: Context<AppEnv>) => textFile(c, "llms.txt");
export const robotsTxt = (c: Context<AppEnv>) => textFile(c, "robots.txt");
