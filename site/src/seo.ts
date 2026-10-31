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
import { assetResponse } from "./data";

// Canonical URLs name the apex domain whichever host served the request, so
// www and apex never compete in an index. robots.txt, llms.txt and the
// pipeline's sitemaps name the same origin; change them together.
export const SITE_ORIGIN = "https://awardwatch.ca";
export const SITE_NAME = "Award Watch";
// A result list cuts a description near 160 characters; stay under it.
export const DESCRIPTION_MAX = 159;

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
  | "home" | "tenders" | "tenders_new" | "awards" | "expiring" | "organizations" | "buyers" | "categories" | "rankings" | "feeds"
  | "watchlist" | "methodology" | "data" | "support" | "cite" | "corrections";

// `name` is the result-list name, either written here or, where the page's own
// heading already reads well in a result list, its dictionary key.
const PAGES: Record<PageKey, { path: string; name: Both | Key; title?: Both; description: Both }> = {
  home: {
    path: "/",
    name: "site.name",
    title: {
      en: "Award Watch: Federal Tenders, Contracts and Grants by Organization",
      fr: "Award Watch : appels d'offres, contrats et subventions fédéraux par organisation",
    },
    description: {
      en: "Open federal tenders, contracts awarded and grants paid, organized by the organizations that receive them. From the government's open data, updated nightly.",
      fr: "Appels d'offres fédéraux ouverts, contrats attribués et subventions versées, par organisation. Données ouvertes du gouvernement, mises à jour chaque nuit.",
    },
  },
  tenders: {
    path: "/tenders",
    name: { en: "Open Federal Tender Notices", fr: "Avis d'appel d'offres fédéraux ouverts" },
    description: {
      en: "Every open tender notice on CanadaBuys, filtered by category, region, buyer and closing date, each linked to its notice.",
      fr: "Tous les avis d'appel d'offres ouverts sur AchatsCanada, filtrés par catégorie, région, acheteur et date de clôture, chacun lié à son avis.",
    },
  },
  tenders_new: {
    path: "/tenders/new",
    name: { en: "New Federal Tender Notices by Day", fr: "Nouveaux avis d'appel d'offres fédéraux par jour" },
    description: {
      en: "The tender notices CanadaBuys published each day over the last 30 days, newest first.",
      fr: "Les avis d'appel d'offres publiés chaque jour sur AchatsCanada au cours des 30 derniers jours, du plus récent au plus ancien.",
    },
  },
  awards: {
    path: "/awards",
    name: { en: "Federal Contract Award Notices", fr: "Avis d'attribution de contrats fédéraux" },
    description: {
      en: "The newest contract award notices on CanadaBuys: supplier, buyer, value and procurement method, each linked to the notice.",
      fr: "Les plus récents avis d'attribution de contrats sur AchatsCanada : fournisseur, acheteur, valeur et méthode d'approvisionnement, chacun lié à l'avis.",
    },
  },
  expiring: {
    path: "/expiring",
    name: { en: "Federal Contracts Ending Soon", fr: "Contrats fédéraux arrivant à échéance" },
    description: {
      en: "Federal contracts ending within 3, 6 or 12 months: organization, buyer, value, competition and amendments, each listed once and linked to its record.",
      fr: "Contrats fédéraux qui prennent fin d'ici 3, 6 ou 12 mois : organisation, acheteur, valeur, concurrence et modifications, chacun lié à son dossier.",
    },
  },
  organizations: {
    path: "/organizations",
    name: { en: "Organizations Receiving Federal Money", fr: "Organisations qui reçoivent des fonds fédéraux" },
    description: {
      en: "Every supplier, grant recipient and lobbying client on record, A to Z by province, each with a profile of its public records.",
      fr: "Tous les fournisseurs, bénéficiaires de subventions et clients de lobbying au dossier, de A à Z par province, chacun avec le profil de ses dossiers publics.",
    },
  },
  buyers: {
    path: "/buyers",
    name: { en: "Federal Buyers: Departments, Agencies and Crown Corporations", fr: "Acheteurs fédéraux : ministères, organismes et sociétés d'État" },
    description: {
      en: "Each federal institution's open tenders, contract awards, published contracts and grants, source by source.",
      fr: "Les appels d'offres ouverts, les attributions de contrats, les contrats publiés et les subventions de chaque institution fédérale, source par source.",
    },
  },
  categories: {
    path: "/categories",
    name: { en: "Federal Procurement by Category", fr: "Approvisionnement fédéral par catégorie" },
    description: {
      en: "The 57 UNSPSC segments: open tenders, contract awards this year and the organizations that received them.",
      fr: "Les 57 segments de l'UNSPSC : appels d'offres ouverts, attributions de contrats de l'année et organisations qui les ont reçues.",
    },
  },
  rankings: {
    path: "/rankings",
    name: { en: "Rankings: Organizations by Federal Contracts and Grants", fr: "Classements : organisations par contrats et subventions fédéraux" },
    description: {
      en: "The organizations with the most contract awards, published contracts and grants, by value and by count, each source ranked on its own.",
      fr: "Les organisations qui comptent le plus d'attributions, de contrats publiés et de subventions, en valeur et en nombre, chaque source classée séparément.",
    },
  },
  feeds: {
    path: "/feeds",
    name: "feeds.title",
    description: {
      en: "Atom feeds of new tender notices and contract awards: all of Canada, by category, by province and by buyer.",
      fr: "Fils Atom des nouveaux avis d'appel d'offres et d'attribution : tout le Canada, par catégorie, par province et par acheteur.",
    },
  },
  watchlist: {
    path: "/watchlist",
    name: "watch.title",
    description: {
      en: "Follow organizations from this browser and see which have new records since your last visit. Nothing is sent to the site.",
      fr: "Suivez des organisations à partir de ce navigateur et voyez lesquelles ont de nouveaux dossiers depuis votre dernière visite. Rien n'est transmis au site.",
    },
  },
  methodology: {
    path: "/methodology",
    name: { en: "Methodology: Sources, Identity and Counting", fr: "Méthodologie : sources, identité et calculs" },
    description: {
      en: "How the site reads each federal source, merges organizations and buyers, totals money source by source, and what it does not claim.",
      fr: "Comment le site lit chaque source fédérale, fusionne organisations et acheteurs, totalise les montants source par source, et ce qu'il n'affirme pas.",
    },
  },
  data: {
    path: "/data",
    name: { en: "Data: Sources, Downloads, API and Licence", fr: "Données : sources, téléchargements, API et licence" },
    description: {
      en: "The open-data files the site reads, when each was last read, the CSV downloads, the read-only JSON API and the licence.",
      fr: "Les fichiers de données ouvertes que lit le site, leur dernière lecture, les téléchargements CSV, l'API JSON en lecture seule et la licence.",
    },
  },
  support: {
    path: "/support",
    name: "support.title",
    description: {
      en: "What the site costs to run each month and how it is funded. The site is free, carries no advertising and sells nothing.",
      fr: "Ce que coûte le site chaque mois et comment il est financé. Le site est gratuit, sans publicité, et ne vend rien.",
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
      en: "Report a wrong organization match, a buyer mapped to the wrong institution or a record shown wrongly. Changes are logged on the page after review.",
      fr: "Signalez un mauvais appariement d'organisation, un acheteur mal associé ou un dossier mal affiché. Les changements sont consignés sur la page après examen.",
    },
  },
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
export function canonicalUrl(path: string, lang: Lang): string {
  return `${SITE_ORIGIN}${path}${lang === "fr" ? "?lang=fr" : ""}`;
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

// The publisher is the project, never a person.
const PUBLISHER = {
  "@type": "Organization",
  name: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
};

export function homeJsonLd(lang: Lang): object {
  const org = `${SITE_ORIGIN}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...PUBLISHER, "@id": org },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: SITE_NAME,
        url: `${SITE_ORIGIN}/`,
        description: local(lang, PAGES.home.description),
        inLanguage: ["en-CA", "fr-CA"],
        publisher: { "@id": org },
      },
    ],
  };
}

export const OGL_URL: Both = {
  en: "https://open.canada.ca/en/open-government-licence-canada",
  fr: "https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada",
};

const SOURCE_DATASETS = [
  "https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2",
  "https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb",
  "https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4",
  "https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b",
  "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
  "https://open.canada.ca/data/en/dataset/a34eb330-7136-4f5e-9f5f-3ba41df58b06",
];
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

export function datasetJsonLd(downloads: { file: string; contents: string }[], dataAsOf: string | null, lang: Lang): object {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${SITE_ORIGIN}/data#dataset`,
    name: local(lang, DATASET_NAME),
    description: local(lang, DATASET_DESCRIPTION),
    url: absoluteUrl("/data"),
    keywords: DATASET_KEYWORDS[lang].map((k) => (lang === "fr" ? frTypography(k) : k)),
    license: OGL_URL[lang],
    isAccessibleForFree: true,
    creditText: t(lang, "data.credit"),
    creator: PUBLISHER,
    publisher: PUBLISHER,
    inLanguage: lang,
    spatialCoverage: { "@type": "Place", name: "Canada" },
    temporalCoverage: "2009/..",
    ...(dataAsOf ? { dateModified: dataAsOf } : {}),
    isBasedOn: SOURCE_DATASETS,
    distribution: downloads.map((d) => ({
      "@type": "DataDownload",
      name: d.file,
      description: d.contents,
      encodingFormat: "text/csv",
      contentUrl: absoluteUrl(`/downloads/${d.file}`),
      license: OGL_URL[lang],
    })),
  };
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
// of the window's first page and stays out of the index.
export function expiringWindowSeo(
  path: string, title: string, lang: Lang, crumbs: { name: string; path?: string }[],
  o: { n: number; months: string; date: string; noindex: boolean },
): Seo {
  const description = t(lang, "expiring.window_description", { n: fmtInt(o.n, lang), months: o.months, date: o.date });
  return sectionSeo(path, title, description, crumbs, o.noindex);
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
  const title = pick(lang, d.title_en, d.title_fr) ?? d.reference;
  const buyer = pick(lang, d.buyer_en, d.buyer_fr);
  const description = t(lang, "tender.description", {
    reference: d.reference,
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
  const title = pick(lang, d.title_en, d.title_fr) ?? d.reference;
  const description = t(lang, d.kind === "award" ? "contract.description_award" : "contract.description_history", {
    reference: d.reference,
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

export function categorySeo(cat: Category, lang: Lang, crumbs: { name: string; path?: string }[]): Seo {
  const name = segmentLabel(lang, cat.code);
  return {
    path: `/categories/${cat.code}`,
    title: pageTitle(name),
    socialTitle: name,
    description: clip(t(lang, "category.description", { name, code: cat.code, n: fmtInt(cat.open_tenders.length, lang) })),
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };
}

// --- Crawler files ---------------------------------------------------------

const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" };

// The pipeline writes the sitemap index and its parts under data/sitemaps/.
// They are served from the site root (/sitemap.xml, /sitemap-<n>.xml) because a
// sitemap may only list URLs at or below its own directory. The Worker streams
// the file without parsing it.
export async function sitemapFile(c: Context<AppEnv>): Promise<Response> {
  const m = /^sitemap(?:-([0-9]{1,4}))?\.xml$/.exec(c.req.param("file") ?? "");
  const res = m ? await assetResponse(c.env, `sitemaps/${m[1] ? `sitemap-${m[1]}` : "index"}.xml`) : null;
  if (!res) return c.notFound();
  return new Response(res.body, { headers: XML_HEADERS });
}

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
