// The guides (/guides and /guides/<slug>, src/pages/guides.tsx; docs/guides.md
// says how to add one). A guide is typed content: sections of blocks, each
// block carrying its English and French side by side, so a test can hold the
// two languages to the same sections, links and figures. A link inside a
// sentence is a {slot} both languages use, with one address for both, so the
// links cannot drift apart. Every rule a guide states was read from the
// official page its Sources list names, on the date in `checked`; where the
// site's own Methodology states how a field is read, the guide says the same.
// French is written with plain spaces and straight apostrophes, as in
// i18n.ts; the page applies the same typography when it renders.

import type { ColumnKind, Rest } from "./columns";
import type { InterestKind } from "./pages/interest";

export type Both = { en: string; fr: string };
// An address on the site (a path, with a query or a fragment) and its words in each language.
export type Link = { href: string; text: Both };
// Running text with {slot} links, the same slots in both languages.
export type Text = Both & { links?: Record<string, Link> };
// A table cell: words in both languages, or an amount the page formats in the reader's language.
export type Cell = Both | { money: number };
export type Column = { kind: ColumnKind; label: Both; rest?: Rest };
// A numbered mark on a figure: target is a CSS selector read inside the figure's region on the captured page, and
// text is the legend's line for it, which says only what the guide's own sections say about that field.
export type Callout = { target: string; text: Text };
// A figure (docs/guides.md, Figures): one of the site's own pages, rendered from the sample records in
// site/figures/ and never from a real record, captured by `npm run figures` (scripts/make-guide-figures.mjs) and
// cropped to the element region names. page is the site path captured. The tool writes the images under
// public/figures/guides/<slug>/ and each mark's place to src/guide_figures.gen.ts.
export type Figure = { kind: "figure"; id: string; shot: { page: string; region: string }; alt: Both; caption: Both; callouts: Callout[] };
// What the tool measured for one figure (src/guide_figures.gen.ts): per language, the wide image (the desktop
// layout, its region at most the guide column's 846 px) and the phone one (a 390 px viewport). width and height
// are CSS pixels, the files being twice that; viewport is the width the page was laid out at; each box is a
// mark's left, top, width and height in percent of the image, in the order of the callouts.
export type FigureBox = readonly [left: number, top: number, width: number, height: number];
export type FigureShot = { readonly width: number; readonly height: number; readonly viewport: number; readonly boxes: readonly FigureBox[] };
export type FigureEntry = {
  readonly slug: string; readonly page: string; readonly region: string; readonly targets: readonly string[];
  readonly en: { readonly wide: FigureShot; readonly phone: FigureShot };
  readonly fr: { readonly wide: FigureShot; readonly phone: FigureShot };
};
export type Block =
  | { kind: "p"; text: Text }
  | { kind: "list"; items: Text[] }
  | { kind: "terms"; items: { term: Both; text: Text }[] }
  | { kind: "table"; cols: Column[]; rows: Cell[][] }
  | Figure;
export type Section = { id: string; title: Both; blocks: Block[] };
// An official page a guide's rules were read from: its title as the page gives it, its publisher and its
// address. fr is the French page, given only where that page itself was read (or the file is bilingual);
// a French reader is otherwise sent to the English page, and told so.
export type Source = { title: string; publisher: Both; url: string; fr?: { title: string; url: string } };
// What a reader can do once the guide is read: the email list it is about, as a list page's own form saves
// it (kind, and the page with its filter, src/pages/interest.tsx interestFilter), under one sentence in each
// language. The page draws it after the last section and before the sources, while the accounts switch is on.
export type GuideAction = { list: { kind: InterestKind; path: string }; text: Both };
export type Guide = {
  slug: string;
  title: Both;
  // The result list's title, where the heading would not fit its 60 characters with the site's name.
  seoTitle?: Both;
  // One sentence: the page's lead and its meta description.
  summary: Both;
  // The day the guide was last checked against its sources (ISO date).
  checked: string;
  sections: Section[];
  sources: Source[];
  action?: GuideAction;
};

const a = (href: string, en: string, fr: string): Link => ({ href, text: { en, fr } });
// A guide's email list: the plain list of new tender notices, one of a notice type, or the contracts
// within 3 months of their end, each with its sentence.
const tenderList = (en: string, fr: string, type?: string): GuideAction => ({
  list: { kind: "tenders", path: type ? `/tenders?type=${encodeURIComponent(type)}` : "/tenders" }, text: { en, fr },
});
const endingList = (en: string, fr: string): GuideAction => ({ list: { kind: "expiring", path: "/expiring" }, text: { en, fr } });
const tx = (en: string, fr: string, links?: Record<string, Link>): Text => (links ? { en, fr, links } : { en, fr });
const p = (en: string, fr: string, links?: Record<string, Link>): Block => ({ kind: "p", text: tx(en, fr, links) });
const both = (en: string, fr: string): Both => ({ en, fr });
// A figure and its marks, each mark's sentence in both languages.
const figure = (id: string, page: string, region: string, alt: Both, caption: Both, callouts: Callout[]): Figure =>
  ({ kind: "figure", id, shot: { page, region }, alt, caption, callouts });
const mark = (target: string, en: string, fr: string): Callout => ({ target, text: { en, fr } });
// The nth field of a definition list on a captured page, its label and its value as one target.
const field = (dl: string, n: number): string => `${dl} > dt:nth-of-type(${n}), ${dl} > dt:nth-of-type(${n}) + dd`;

// -- the publishers and pages the guides cite ------------------------------------------

const PSPC = both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada");
const TBS = both("Treasury Board of Canada Secretariat", "Secrétariat du Conseil du Trésor du Canada");
const JUSTICE = both("Justice Laws Website, Department of Justice Canada", "Site Web de la législation, ministère de la Justice Canada");
const ISC = both("Indigenous Services Canada", "Services aux Autochtones Canada");
const OPO = both("Office of the Procurement Ombud", "Bureau de l'ombud de l'approvisionnement");
const CITT = both("Canadian International Trade Tribunal", "Tribunal canadien du commerce extérieur");
const CYBER_CENTRE = both("Canadian Centre for Cyber Security", "Centre canadien pour la cybersécurité");
// PSPC's Buyer's Guide, in each language.
const GUIDE_EN = "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide";
const GUIDE_FR = "https://achatscanada.canada.ca/fr/portail-de-l-acheteur/guide-de-l-acheteur";
// The Contract Security Program's section of PSPC's pages, in each language.
const CSP_EN = "https://www.canada.ca/en/public-services-procurement/services/industrial-security/security-requirements-contracting";
const CSP_FR = "https://www.canada.ca/fr/services-publics-approvisionnement/services/securite-industrielle/exigences-securite-contrats";
// The Office of Supplier Integrity and Compliance's section of PSPC's pages, in each language.
const OSIC_EN = "https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance";
const OSIC_FR = "https://www.canada.ca/fr/services-publics-approvisionnement/services/normes-surveillance/integrite-conformite-fournisseurs";
const DND = both("National Defence", "Défense nationale");

const SRC = {
  dictionary: {
    title: "CanadaBuys data dictionary",
    publisher: PSPC,
    url: "https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml",
    // One bilingual file.
    fr: { title: "Dictionnaire de données d'AchatsCanada", url: "https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml" },
  },
  support: {
    title: "Supporting Documentation: Understanding the new CanadaBuys tender and award notices datasets",
    publisher: PSPC,
    url: "https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html",
  },
  tenderData: {
    title: "CanadaBuys tender notices (Open Government Portal)",
    publisher: PSPC,
    url: "https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2",
  },
  awardData: {
    title: "CanadaBuys award notices (Open Government Portal)",
    publisher: PSPC,
    url: "https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb",
  },
  historyData: {
    title: "CanadaBuys contract history (Open Government Portal)",
    publisher: PSPC,
    url: "https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4",
  },
  howToBid: {
    title: "How to bid on tender opportunities",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/how-bid-tender-opportunities",
    fr: {
      title: "Comment soumissionner sur les occasions de marché",
      url: "https://achatscanada.canada.ca/fr/pour-commencer/se-preparer-pour-vendre/comment-soumissionner-sur-les-occasions-de-marche",
    },
  },
  seminar: {
    title: "Seminar notes: Bidding on opportunities",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/services/acquisitions/support-for-businesses/bid-on-opportunities/bidding.html",
    fr: {
      title: "Notes de séminaire : Soumissionner sur des marchés",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/services/achats/soutien-aux-entreprises/soumissionner-marches/soumissionner.html",
    },
  },
  acan: {
    title: "Advanced Contract Award Notice (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/create-solicitation/tender-notices/advanced-contract-award-notice`,
    fr: {
      title: "Préavis d'adjudication de contrat (Guide de l'acheteur)",
      url: `${GUIDE_FR}/creer-une-demande-d-offres/avis-d-appel-d-offres/preavis-d-adjudication-de-contrat`,
    },
  },
  rfi: {
    title: "Request for information (Buyer's Guide)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/create-solicitation/choose-solicitation-method/request-information",
  },
  itq: {
    title: "Invitation to Qualify (ITQ), tender notice PW-20-00916837",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/pw-20-00916837",
  },
  npp: {
    title: "Notice of proposed procurement (Buyer's Guide)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/create-solicitation/tender-notices/notice-proposed-procurement",
  },
  tradeApplicability: {
    title: "Trade agreement applicability (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/determine-procurement-strategy/trade-agreement-applicability`,
    fr: {
      title: "Applicabilité des accords commerciaux (Guide de l'acheteur)",
      url: `${GUIDE_FR}/planifier/determiner-la-strategie-d-approvisionnement/applicabilite-des-accords-commerciaux`,
    },
  },
  tradeNotices: {
    title: "Tender notices and trade agreements (Buyer's Guide)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/create-solicitation/tender-notices/tender-notices-and-trade-agreements",
    fr: {
      title: "Avis d'appel d'offres et accords commerciaux (Guide de l'acheteur)",
      url: `${GUIDE_FR}/creer-une-demande-d-offres/avis-d-appel-d-offres/avis-d-appel-d-offres-et-accords-commerciaux`,
    },
  },
  thresholds: {
    title: "Contracting Policy Notice 2025-8, Trade Agreements: Thresholds Update",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2025-8.html",
    fr: {
      title: "Avis sur la Politique des marchés 2025-8, Accords commerciaux : mise à jour des seuils",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/2025-8.html",
    },
  },
  gets: {
    title: "Procurement Assistance Canada (CanadaBuys)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/procurement-essentials/useful-resources/procurement-assistance-canada",
  },
  codes: {
    title: "Commodity codes",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/commodity-codes",
  },
  sosaPage: {
    title: "Standing offers and supply arrangements",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/standing-offers-and-supply-arrangements",
    fr: {
      title: "Offres à commandes et arrangements en matière d'approvisionnement",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/offres-commandes-et-arrangements-en-matiere-d-approvisionnement",
    },
  },
  methodOfSupply: {
    title: "Choose the method of supply (Buyer's Guide)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/plan/determine-procurement-strategy/choose-method-supply",
  },
  manageSosa: {
    title: "Standing offers and supply arrangements (Buyer's Guide)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/manage/manage-contract/standing-offers-and-supply-arrangements",
  },
  sosaData: {
    title: "Standing Offers and Supply Arrangements (Open Government Portal)",
    publisher: PSPC,
    url: "https://open.canada.ca/data/en/dataset/f5c8a5a0-354d-455a-99ab-8276aa38032e",
  },
  ccpi: {
    title: "Collaborative procurement opportunities for governments and other eligible organizations: Overview and benefits",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/services/acquisitions/collaborative-procurement-opportunities-governments-other-eligible-organizations/overview-benefits.html",
  },
  ccpiEligibility: {
    title: "Collaborative procurement opportunities for governments and other eligible organizations: Eligibility and conditions of use",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/services/acquisitions/collaborative-procurement-opportunities-governments-other-eligible-organizations/eligibility-conditions-use.html",
  },
  contractsData: {
    title: "Proactive Publication: Contracts (Open Government Portal)",
    publisher: TBS,
    url: "https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b",
  },
  contractsSchema: {
    title: "Proactive Publication: Contracts, data schema",
    publisher: TBS,
    url: "https://open.canada.ca/data/recombinant-published-schema/contracts.json",
    // One file with each field's English and French text.
    fr: { title: "Publication proactive : contrats, schéma des données", url: "https://open.canada.ca/data/recombinant-published-schema/contracts.json" },
  },
  atia: {
    title: "Access to Information Act, section 86",
    publisher: JUSTICE,
    url: "https://laws-lois.justice.gc.ca/eng/acts/a-1/page-10.html",
    fr: { title: "Loi sur l'accès à l'information, article 86", url: "https://laws-lois.justice.gc.ca/fra/lois/a-1/page-10.html" },
  },
  gcr: {
    title: "Government Contracts Regulations (SOR/87-402)",
    publisher: JUSTICE,
    url: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-87-402/FullText.html",
    fr: { title: "Règlement sur les marchés de l'État (DORS/87-402)", url: "https://laws-lois.justice.gc.ca/fra/reglements/DORS-87-402/TexteComplet.html" },
  },
  psibNotices: {
    title: "Tender notices and Procurement Strategy for Indigenous Business set-asides (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/create-solicitation/tender-notices/tender-notices-and-procurement-strategy-indigenous-business-set-asides`,
    fr: {
      title: "Avis d'appel d'offres et marchés réservés dans le cadre de la Stratégie d'approvisionnement auprès des entreprises autochtones (Guide de l'acheteur)",
      url: `${GUIDE_FR}/creer-une-demande-d-offres/avis-d-appel-d-offres/avis-d-appel-d-offres-et-marches-reserves-dans-le-cadre-de-la-strategie-d-approvisionnement-aupres-des-entreprises-autochtones`,
    },
  },
  indigenousConsiderations: {
    title: "Indigenous considerations (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/socioeconomic-considerations/indigenous-considerations`,
    fr: {
      title: "Considérations relatives aux Autochtones (Guide de l'acheteur)",
      url: `${GUIDE_FR}/planifier/considerations-socioeconomiques/considerations-relatives-aux-autochtones`,
    },
  },
  iscProcurement: {
    title: "Learn how federal Indigenous procurement works",
    publisher: ISC,
    url: "https://www.sac-isc.gc.ca/eng/1696513417823/1696513480139",
    fr: {
      title: "Comprendre le fonctionnement de l'approvisionnement fédéral auprès des entreprises autochtones",
      url: "https://www.sac-isc.gc.ca/fra/1696513417823/1696513480139",
    },
  },
  iscFacts: {
    title: "Facts about federal Indigenous procurement policies and practices",
    publisher: ISC,
    url: "https://www.sac-isc.gc.ca/eng/1746637262900/1746637283564",
  },
  iscDirectory: {
    title: "How to Register for the Indigenous Business Directory",
    publisher: ISC,
    url: "https://www.sac-isc.gc.ca/eng/1756215160157/1756215188889",
    fr: { title: "Comment s'inscrire au Répertoire des entreprises autochtones", url: "https://www.sac-isc.gc.ca/fra/1756215160157/1756215188889" },
  },
  iscTarget: {
    title: "Indigenous Services Canada Report on the Mandatory Minimum 5% Target fiscal year 2022 to 2023",
    publisher: ISC,
    url: "https://www.sac-isc.gc.ca/eng/1717528519135/1717528539649",
    fr: {
      title: "Rapport de Services aux Autochtones Canada sur la cible minimale obligatoire de 5 % pour l'exercice de 2022 à 2023",
      url: "https://www.sac-isc.gc.ca/fra/1717528519135/1717528539649",
    },
  },
  // The notice's own title joins its parts with a dash, which the guides never print; a comma stands in.
  indigenousNotice: {
    title: "Contracting Policy Notice 2022-01: New Appendix E, Mandatory Procedures for Contracts Awarded to Indigenous Businesses, to the Directive on the Management of Procurement",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/contracting-policy-notice-2022-1.html",
    fr: {
      title: "Avis sur la Politique sur les marchés 2022-01 : Nouvelle annexe E, Procédures obligatoires pour les marchés attribués aux entreprises autochtones, de la Directive sur la gestion de l'approvisionnement",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/avis-politique-marches-2022-1.html",
    },
  },
  opoReview: {
    title: "Procurement Practice Review of Contracts Awarded to Indigenous Businesses",
    publisher: OPO,
    url: "https://opo-boa.gc.ca/praapp-prorev/2026/epa-ppr-03-2026-eng.html",
    fr: {
      title: "Examen des pratiques d'approvisionnement relatives aux contrats attribués aux entreprises autochtones",
      url: "https://opo-boa.gc.ca/praapp-prorev/2026/epa-ppr-03-2026-fra.html",
    },
  },
  exerciseOptions: {
    title: "Exercise options (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/manage/modify-contract/exercise-options`,
    fr: { title: "Exercice des options (Guide de l'acheteur)", url: `${GUIDE_FR}/gerer/modifier-un-contrat/exercice-des-options` },
  },
  amendConsiderations: {
    title: "Considerations when making amendments (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/manage/modify-contract/considerations-when-making-amendments`,
    fr: {
      title: "Éléments à prendre en compte lors des modifications (Guide de l'acheteur)",
      url: `${GUIDE_FR}/gerer/modifier-un-contrat/elements-prendre-en-compte-lors-des-modifications`,
    },
  },
  amendProcedure: {
    title: "Procedural elements for amending contracts (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/manage/modify-contract/procedural-elements-amending-contracts`,
  },
  amendApproval: {
    title: "Contract amendment (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/approve/prepare-approval-documents/contract-amendment`,
    fr: { title: "Modification du contrat (Guide de l'acheteur)", url: `${GUIDE_FR}/approuver/preparer-les-documents-d-approbation/modification-du-contrat` },
  },
  vendorPerformance: {
    title: "Vendor performance (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/manage/manage-contract/vendor-performance`,
    fr: { title: "Rendement du fournisseur (Guide de l'acheteur)", url: `${GUIDE_FR}/gerer/gerer-un-contrat/rendement-du-fournisseur` },
  },
  contractingLimits: {
    title: "Contracting limits including exceptional authorities (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/approve/approvals-and-authorities/contracting-limits-including-exceptional-authorities`,
    fr: {
      title: "Limites des contrats, y compris les pouvoirs exceptionnels (Guide de l'acheteur)",
      url: `${GUIDE_FR}/approuver/approbations-et-pouvoirs/limites-contractuelles-y-compris-les-pouvoirs-exceptionnels`,
    },
  },
  limitsNotice: {
    title: "Contracting Policy Notice 2026-1: Amendments to the Directive on the Management of Procurement to Increase Contracting Limits for Inflation",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2026-1.html",
    fr: {
      title: "Avis sur la Politique des marchés 2026-1 : modifications apportées à la Directive sur la gestion de l'approvisionnement pour augmenter les limites contractuelles afin de tenir compte de l'inflation",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/2026-1.html",
    },
  },
  // The Minister responsible for PSPC's exclusive authority over procurement (read on 2026-11-14).
  authorityNotice: {
    title:
      "Contracting Policy Notice 2026-2: Amendments to the Department of Public Works and Government Services Act to provide Ministerial Procurement Authority for Services and Construction Services and consequential amendments to the Directive on the Management of Procurement",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2026-2.html",
    fr: {
      title:
        "Avis sur la Politique des marchés 2026-2 : Modifications à la Loi sur le ministère des Travaux publics et des Services gouvernementaux afin de conférer au ministre le pouvoir en matière d'approvisionnement pour les services et la construction, ainsi que les modifications corrélatives à la Directive sur la gestion de l'approvisionnement",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/2026-2.html",
    },
  },
  // The example award notice of the guide on contracts without competition, on CanadaBuys (read there on 2026-11-14).
  // Its French title joins its parts with a dash, which the guides never print; a comma stands in, in both.
  exampleDirected: {
    title: "51019-270050, JetBrains Maintenance and Support Software Renewal (award notice CW2454835)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cw2454835",
    fr: {
      title: "51019-270050, Renouvellement du logiciel de maintenance et de soutien de JetBrains (avis d'attribution CW2454835)",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cw2454835",
    },
  },
  policyNotices: {
    title: "Contracting policy notices",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice.html",
    fr: { title: "Avis relatifs à la Politique sur les marchés", url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique.html" },
  },
  eProcurement: {
    title: "Electronic procurement",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/services/acquisitions/support-for-businesses/electronic-procurement-transition.html",
    fr: {
      title: "Achats électroniques",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/services/achats/soutien-aux-entreprises/transition-achats-electroniques.html",
    },
  },
  register: {
    title: "How to register your business",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/getting-started/preparing-sell-government/how-register-your-business",
    fr: {
      title: "Comment inscrire votre entreprise",
      url: "https://achatscanada.canada.ca/fr/pour-commencer/se-preparer-pour-vendre/inscrire-votre-entreprise-2",
    },
  },
  registerChecklist: {
    title: "Use this checklist to prepare to register on SAP Business Network",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/support/use-checklist-prepare-register-sap-business-network",
    fr: {
      title: "Utilisez cette liste pour vous préparer à vous inscrire sur SAP Business Network",
      url: "https://achatscanada.canada.ca/fr/soutien/liste-pour-preparer-inscrire-sap-ariba",
    },
  },
  followUp: {
    title: "Following up on a bid",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/getting-started/preparing-sell-government/how-bid-tender-opportunities/following-bid",
    fr: { title: "Suivi des soumissions", url: "https://achatscanada.canada.ca/fr/pour-commencer/se-preparer-pour-vendre/suivi-des-soumissions" },
  },
  atAward: {
    title: "Elements to consider at award (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/award/award-contract/elements-consider-award-0`,
    fr: {
      title: "Éléments à prendre en considération lors de l'attribution (Guide de l'acheteur)",
      url: `${GUIDE_FR}/attribuer/attribuer-un-contrat/elements-prendre-en-consideration-lors-de-l-attribution`,
    },
  },
  sourcing: {
    title: "Determine the sourcing strategy (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/determine-procurement-strategy/determine-sourcing-strategy`,
    fr: {
      title: "Déterminer la stratégie de sélection des fournisseurs (Guide de l'acheteur)",
      url: `${GUIDE_FR}/planifier/determiner-la-strategie-d-approvisionnement/determiner-la-strategie-de-selection-des-fournisseurs`,
    },
  },
  securitySolicitations: {
    title: "Security in solicitations of offers (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/contract-security-and-privacy-requirements/security-solicitations-offers`,
    fr: {
      title: "Sécurité dans les demandes d'offres (Guide de l'acheteur)",
      url: `${GUIDE_FR}/planifier/exigences-en-matiere-de-securite-et-de-protection-des-renseignements-personnels-des-contrats/securite-dans-les-demandes-doffres`,
    },
  },
  // The Contract Security Program's pages, in PSPC's industrial security section.
  cspScreening: {
    title: "Security screening for government contracts",
    publisher: PSPC,
    url: `${CSP_EN}/security-screening-government-contracts.html`,
    fr: { title: "Enquête de sécurité pour les contrats du gouvernement", url: `${CSP_FR}/enquete-securite-contrats-gouvernement.html` },
  },
  cspOrganization: {
    title: "Obtain a security screening for your organization",
    publisher: PSPC,
    url: `${CSP_EN}/organization-security-screening/obtain-security-screening-organization.html`,
    fr: {
      title: "Obtention d'une attestation de sécurité pour votre organisation",
      url: `${CSP_FR}/enquete-securite-organisation/obtention-attestation-securite-organisation.html`,
    },
  },
  cspProvisional: {
    title: "Provisional security clearance",
    publisher: PSPC,
    url: `${CSP_EN}/organization-security-screening/clearances/provisional.html`,
    fr: { title: "Attestations de sécurité provisoires", url: `${CSP_FR}/enquete-securite-organisation/attestations-securite-organisation/provisoire.html` },
  },
  cspSponsorship: {
    title: "Sponsorship process",
    publisher: PSPC,
    url: `${CSP_EN}/organization-security-screening/sponsorship-process.html`,
    fr: { title: "Processus de parrainage", url: `${CSP_FR}/enquete-securite-organisation/processus-parrainage.html` },
  },
  cspLevels: {
    title: "Levels of security",
    publisher: PSPC,
    url: `${CSP_EN}/safeguarding-equipment-sites-assets-information/levels-security.html`,
    fr: { title: "Niveaux de sécurité", url: `${CSP_FR}/protection-equipement-lieux-biens-renseignements/niveaux-securite.html` },
  },
  cspPersonnel: {
    title: "Personnel security screening overview",
    publisher: PSPC,
    url: `${CSP_EN}/personnel-security-screening/overview.html`,
    fr: { title: "Aperçu d'une enquête de sécurité sur le personnel", url: `${CSP_FR}/enquete-securite-personnel/apercu.html` },
  },
  cspTimes: {
    title: "Costs and processing times for personnel security screenings",
    publisher: PSPC,
    url: `${CSP_EN}/personnel-security-screening/costs-processing-times.html`,
    fr: {
      title: "Coûts et délais de traitement pour les enquêtes de sécurité sur le personnel",
      url: `${CSP_FR}/enquete-securite-personnel/couts-delais-traitement.html`,
    },
  },
  // The two example notices, on CanadaBuys (read there on 2026-11-14). Their titles join parts with a dash,
  // which the guides never print; a comma stands in.
  exampleNotice: {
    title: "Physical Security Compliance Project, NCR (tender notice cb-800-75831340)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-800-75831340",
    fr: {
      title: "Projet de conformité de la sécurité matérielle, RCN (avis d'appel d'offres cb-800-75831340)",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/cb-800-75831340",
    },
  },
  exampleAcan: {
    title: "ACAN F3757-260564 pH measure and control system (tender notice WS5918268553-Doc5979457667)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ws5918268553-doc5979457667",
    fr: {
      title: "PAC F3757-260564 Système de mesure et de contrôle du pH (avis d'appel d'offres WS5918268553-Doc5979457667)",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/ws5918268553-doc5979457667",
    },
  },
  // The Buy Canadian Policy: the Treasury Board's notice, CanadaBuys' pages on the Framework and its policies, PSPC's
  // pages, and a notice that states one of the policies (each read on 2026-11-14).
  buyCanadianNotice: {
    title:
      "Contracting Policy Notice 2025-7: Buy Canadian Policies and associated amendments to the Canadian International Trade Tribunal Inquiry Regulations and Directive on the Management of Procurement",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2025-7.html",
    fr: {
      title:
        "Avis sur la politique des marchés 2025-7 : Politiques « Achetez canadien » et modifications associées au Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics et à la Directive sur la gestion de l'approvisionnement",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/2025-7.html",
    },
  },
  buyCanadianPage: {
    title: "Buy Canadian Policy",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy",
    fr: { title: "Politique « Achetez canadien »", url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien" },
  },
  bcFramework: {
    title: "Buy Canadian Procurement Policy Framework",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy/buy-canadian-procurement-policy-framework",
    fr: {
      title: "Cadre stratégique de la politique d'approvisionnement « Achetez canadien »",
      url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien/cadre-strategique-de-la-politique-dapprovisionnement-achetez-canadien",
    },
  },
  bcMaterials: {
    title: "Policy on Prioritizing Canadian Materials in Federal Procurements",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy/policy-prioritizing-canadian-materials-federal-procurements",
    fr: {
      title: "Politique sur la priorisation des matériaux canadiens dans l'approvisionnement fédéral",
      url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien/politique-sur-la-priorisation-des-materiaux-canadiens-dans-l-approvisionnement-federal",
    },
  },
  bcSuppliers: {
    title: "Policy on Prioritizing Canadian Suppliers and Canadian Content in Strategic Federal Procurements",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy/policy-prioritizing-canadian-suppliers-and-canadian-content-strategic-federal-procurements",
    fr: {
      title: "Politique sur la priorisation des fournisseurs canadiens et du contenu canadien dans les approvisionnements stratégiques fédéraux",
      url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien/politique-sur-la-priorisation-des-fournisseurs-canadiens-et-du-contenu-canadien-dans-les-approvisionnements-strategiques-federaux",
    },
  },
  bcCompliance: {
    title: "Compliance Framework: Prioritizing Canadian Suppliers and Canadian Content in Strategic Federal Procurements",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy/compliance-framework-prioritizing-canadian-suppliers-and-canadian-content-strategic-federal-procurements",
    fr: {
      title: "Cadre de conformité : Priorisation des fournisseurs canadiens et du contenu canadien dans les approvisionnements stratégiques fédéraux",
      url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien/cadre-conformite-priorisation-fournisseurs-canadiens-contenu-canadien-approvisionnements-strategiques-federaux",
    },
  },
  bcReciprocal: {
    title: "Interim Policy on Reciprocal Procurement",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy/interim-policy-reciprocal-procurement",
    fr: {
      title: "Politique provisoire sur l'approvisionnement réciproque",
      url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien/politique-provisoire-sur-l-approvisionnement-reciproque",
    },
  },
  bcReciprocalSteps: {
    title: "Interim Policy on Reciprocal Procurement (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/determine-procurement-strategy/interim-policy-reciprocal-procurement`,
    fr: {
      title: "Politique provisoire sur l'approvisionnement réciproque (Guide de l'acheteur)",
      url: "https://achatscanada.canada.ca/fr/buyer-s-portal/buyer-s-guide/planifier/determiner-strategie-approvisionnement/politique-provisoire-approvisionnement-reciproque",
    },
  },
  bcQuestions: {
    title: "Questions and answers for suppliers",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/buy-canadian-policy/questions-and-answers-suppliers",
    fr: { title: "Questions et réponses pour fournisseurs", url: "https://achatscanada.canada.ca/fr/politique-achetez-canadien/questions-et-reponses-pour-fournisseurs" },
  },
  pspcBuyCanadian: {
    title: "Buy Canadian",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/services/acquisitions/selling-federal-government/buy-canadian.html",
    fr: {
      title: "Achetez canadien",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/services/achats/vendre-gouvernement-federal/achetez-canadien.html",
    },
  },
  smallBusinessNotice: {
    title: "Contracting Policy Notice 2026-4: Small Business Procurement Program and Improving Opportunities for Small Businesses",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2026-4.html",
    fr: {
      title: "Avis sur la Politique des marchés 2026-4 : Programme d'approvisionnement auprès des petites entreprises et amélioration des occasions pour les petites entreprises",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/2026-4.html",
    },
  },
  // The Small Business Procurement Program: PSPC's news release and backgrounder of its launch (each read on 2026-11-14).
  sbppNews: {
    title: "Public Services and Procurement Canada launches new Small Business Procurement Program measures to modernize federal contracting and boost access for Canadian businesses",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2026/07/public-services-and-procurement-canada-launches-new-small-business-procurement-program-measures-to-modernize-federal-contracting-and-boost-access-f.html",
    fr: {
      title: "Services publics et Approvisionnement Canada lance de nouvelles mesures dans le cadre du Programme d'approvisionnement auprès des petites entreprises, afin de moderniser les contrats fédéraux et de les rendre plus accessibles aux entreprises canadiennes",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2026/07/services-publics-et-approvisionnement-canada-lance-de-nouvelles-mesures-dans-le-cadre-du-programme-dapprovisionnement-aupres-des-petites-entreprise.html",
    },
  },
  sbppBackgrounder: {
    title: "Simplifying federal procurement for Canadian small businesses",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2026/07/simplifying-federal-procurement-for-canadian-small-businesses.html",
    fr: {
      title: "Simplifier l'approvisionnement fédéral pour les petites entreprises canadiennes",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2026/07/simplifier-lapprovisionnement-federal-pour-les-petites-entreprises-canadiennes.html",
    },
  },
  // The guide on the program's example award notice, on CanadaBuys (read there on 2026-11-14).
  exampleSbpp: {
    title: "23375-250365-001-HL Humidity Control System Contract (award notice CW2460403)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cw2460403",
    fr: {
      title: "23375-250365-001-HL contrat de Système de contrôle de l'humidité (avis d'attribution CW2460403)",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cw2460403",
    },
  },
  reciprocityNotice: {
    title: "Contracting Policy Notice 2025-5: Reciprocity in Federal Procurement and Amendments to the Canadian International Trade Tribunal Procurement Inquiry Regulations",
    publisher: TBS,
    url: "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2025-5.html",
    fr: {
      title: "Avis sur la Politique des marchés 2025-5 : Réciprocité dans les marchés fédéraux et modifications apportées au Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics",
      url: "https://www.canada.ca/fr/secretariat-conseil-tresor/services/avis-politique/2025-5.html",
    },
  },
  exampleBuyCanadian: {
    title: "Emergency Escape Breathing Devices (EEBD) (tender notice cb-342-43639893)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-342-43639893",
    fr: {
      title: "Appareil respiratoire générateur d'oxygène (EEBD) (avis d'appel d'offres cb-342-43639893)",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/cb-342-43639893",
    },
  },
  // How bids are evaluated and selected: CanadaBuys' page for suppliers, the Buyer's Guide's pages on the method of
  // selection and on evaluating offers, the archived basis of selection clauses and the Treasury Board's directive
  // (each read on 2026-11-14).
  bidEvaluation: {
    title: "How bids are evaluated and selected",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/getting-started/preparing-sell-government/how-bids-evaluated-and-selected",
    fr: {
      title: "Comment les soumissions sont évaluées et sélectionnées",
      url: "https://achatscanada.canada.ca/fr/pour-commencer/se-preparer-pour-vendre/comment-les-soumissions-sont-evaluees-et-selectionnees",
    },
  },
  methodSelection: {
    title: "Method of selection (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/method-selection`,
    fr: { title: "Méthode de sélection (Guide de l'acheteur)", url: `${GUIDE_FR}/planifier/methode-de-selection` },
  },
  evaluationCriteria: {
    title: "Specifying evaluation criteria (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/method-selection/specifying-evaluation-criteria`,
    fr: { title: "Préciser les critères d'évaluation (Guide de l'acheteur)", url: `${GUIDE_FR}/planifier/methode-de-selection/preciser-les-criteres-d-evaluation` },
  },
  basisSelection: {
    title: "Including basis of selection (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/method-selection/including-basis-selection`,
    fr: { title: "Inclure la méthode de sélection (Guide de l'acheteur)", url: `${GUIDE_FR}/planifier/methode-de-selection/inclure-la-methode-de-selection` },
  },
  communicatingSelection: {
    title: "Communicating the method of selection (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/plan/method-selection/communicating-method-selection`,
    fr: {
      title: "Communiquer la méthode de sélection (Guide de l'acheteur)",
      url: `${GUIDE_FR}/planifier/methode-de-selection/communiquer-la-methode-de-selection`,
    },
  },
  evaluationProcess: {
    title: "Evaluation process (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/receive-and-evaluate/offer-evaluation/evaluation-process`,
    fr: { title: "Processus d'évaluation (Guide de l'acheteur)", url: `${GUIDE_FR}/recevoir-et-evaluer/evaluation-des-offres/processus-d-evaluation` },
  },
  technicalEvaluation: {
    title: "Conduct a technical evaluation (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/receive-and-evaluate/offer-evaluation/conduct-technical-evaluation`,
    fr: {
      title: "Procéder à une évaluation technique (Guide de l'acheteur)",
      url: `${GUIDE_FR}/recevoir-et-evaluer/evaluation-des-offres/proceder-une-evaluation-technique`,
    },
  },
  financialEvaluation: {
    title: "Conduct a financial evaluation (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/receive-and-evaluate/offer-evaluation/conduct-financial-evaluation`,
    fr: {
      title: "Procéder à une évaluation financière (Guide de l'acheteur)",
      url: `${GUIDE_FR}/recevoir-et-evaluer/evaluation-des-offres/proceder-une-evaluation-financiere`,
    },
  },
  // The archived manual's subsection 5.A, which holds the basis of selection clauses (A0027T, A0031T, A0034T, A0035T,
  // A0036T, A0069T). Its title joins parts with dashes; commas stand in.
  saccSelection: {
    title: "Archived, Standard Acquisition Clauses and Conditions Manual, A, Instructions to Bidders / Contractors",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/standard-acquisition-clauses-and-conditions-manual-5a",
    fr: {
      title: "Archivée, Guide des clauses et conditions uniformisées d'achat, A, Instructions aux soumissionnaires / entrepreneurs",
      url: "https://achatscanada.canada.ca/fr/guide-des-clauses-et-cond-5a",
    },
  },
  procurementDirective: {
    title: "Directive on the Management of Procurement",
    publisher: TBS,
    url: "https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32692",
    fr: { title: "Directive sur la gestion de l'approvisionnement", url: "https://www.tbs-sct.canada.ca/pol/doc-fra.aspx?id=32692" },
  },
  // The French notice's title joins its parts with a dash; a comma stands in.
  exampleEvaluation: {
    title: "WS5933829424 Canada Strong Technical and Trades Training Program (tender notice WS5933829424-Doc5973518768)",
    publisher: PSPC,
    url: "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ws5933829424-doc5973518768",
    fr: {
      title: "WS5933829424 Programme de formation technique et métier, Une Équipe Canada forte (avis d'appel d'offres WS5933829424-Doc5973518768)",
      url: "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/ws5933829424-doc5973518768",
    },
  },
  // After the award: the Buyer's Guide's page on debriefings, the Procurement Ombud's questions on complaints and its
  // regulations, and the Trade Tribunal's pages and its regulations (each read on 2026-11-14).
  debriefing: {
    title: "Debriefing and feedback sessions (Buyer's Guide)",
    publisher: PSPC,
    url: `${GUIDE_EN}/award/manage-evaluation-results/debriefing-and-feedback-sessions`,
    fr: {
      title: "Comptes rendus et rencontres de rétroaction (Guide de l'acheteur)",
      url: `${GUIDE_FR}/attribuer/gestion-des-resultats-d-evaluation/comptes-rendus-et-rencontres-de-retroaction`,
    },
  },
  opoComplaints: {
    title: "Frequently asked questions on how to make a complaint",
    publisher: OPO,
    url: "https://opo-boa.gc.ca/plainte-complaint-eng.html",
    fr: { title: "Foire aux questions sur la façon de déposer une plainte", url: "https://opo-boa.gc.ca/plainte-complaint-fra.html" },
  },
  ombudsmanRegulations: {
    title: "Procurement Ombudsman Regulations (SOR/2008-143)",
    publisher: JUSTICE,
    url: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2008-143/FullText.html",
    fr: { title: "Règlement concernant l'ombudsman de l'approvisionnement (DORS/2008-143)", url: "https://laws-lois.justice.gc.ca/fra/reglements/DORS-2008-143/TexteComplet.html" },
  },
  cittComplaint: {
    title: "File a complaint",
    publisher: CITT,
    url: "https://www.citt-tcce.gc.ca/en/procurement-inquiries/file-complaint",
    fr: { title: "Déposer une plainte", url: "https://www.citt-tcce.gc.ca/fr/enquetes-sur-marches-publics/deposer-plainte" },
  },
  cittOmbud: {
    title: "Working with the Office of the Procurement Ombud",
    publisher: CITT,
    url: "https://www.citt-tcce.gc.ca/en/procurement-inquiries/working-office-procurement-ombud",
    fr: {
      title: "Collaboration avec le Bureau de l'ombud de l'approvisionnement",
      url: "https://www.citt-tcce.gc.ca/fr/enquetes-sur-marches-publics/collaboration-avec-bureau-ombud-approvisionnement",
    },
  },
  cittGuide: {
    title: "Procurement inquiries guide",
    publisher: CITT,
    url: "https://www.citt-tcce.gc.ca/en/procurement-inquiries/procurement-inquiries-guide",
    fr: { title: "Guide des enquêtes sur les marchés publics", url: "https://www.citt-tcce.gc.ca/fr/enquetes-sur-marches-publics/guide-enquetes-sur-marches-publics" },
  },
  cittRegulations: {
    title: "Canadian International Trade Tribunal Procurement Inquiry Regulations (SOR/93-602)",
    publisher: JUSTICE,
    url: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-93-602/FullText.html",
    fr: {
      title: "Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics (DORS/93-602)",
      url: "https://laws-lois.justice.gc.ca/fra/reglements/DORS-93-602/TexteComplet.html",
    },
  },
  // The cyber security certification of defence suppliers: PSPC's pages on the program, its news releases and
  // backgrounder, the Canadian Centre for Cyber Security's standard and PSPC's page on security requirements for
  // contracting, which lists the program (each read on 2026-11-15).
  cpcscOverview: {
    title: "Program Overview (Canadian Program for Cyber Security Certification)",
    publisher: PSPC,
    url: `${CSP_EN}/cyber-security-certification-defence-suppliers-canada/program-overview.html`,
    fr: {
      title: "Aperçu du programme (Programme canadien de certification en cybersécurité)",
      url: `${CSP_FR}/certification-fournisseurs-secteur-defense-canada-concernant-cybersecurite/apercu-programme.html`,
    },
  },
  cpcscLevel1: {
    title: "How to meet Level 1 cyber security certification requirements",
    publisher: PSPC,
    url: `${CSP_EN}/cyber-security-certification-defence-suppliers-canada/meet-level1-certification-requirements.html`,
    fr: {
      title: "Comment satisfaire aux exigences de certification en cybersécurité de niveau 1",
      url: `${CSP_FR}/certification-fournisseurs-secteur-defense-canada-concernant-cybersecurite/exigences-certification-niveau1.html`,
    },
  },
  cpcscMore: {
    title: "Additional information and support for suppliers about cyber security",
    publisher: PSPC,
    url: `${CSP_EN}/cyber-security-certification-defence-suppliers-canada/additional-information-support.html`,
    fr: {
      title: "Renseignements et soutien supplémentaires en matière de cybersécurité à l'intention des fournisseurs",
      url: `${CSP_FR}/certification-fournisseurs-secteur-defense-canada-concernant-cybersecurite/renseignments-soutien-supplementaires.html`,
    },
  },
  cpcscNews: {
    title: "Government of Canada introduces Level 1 of Canadian Program for Cyber Security Certification",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2026/04/government-of-canada-introduces-level-1-of-canadian-program-for-cyber-security-certification.html",
    fr: {
      title: "Le gouvernement du Canada lance le niveau 1 du Programme canadien de certification en cybersécurité",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2026/04/le-gouvernement-du-canada-lance-le-niveau-1-du-programme-canadien-de-certification-en-cybersecurite.html",
    },
  },
  // The French title joins its parts with a dash, which the guides never print; a comma stands in.
  cpcscBackgrounder: {
    title: "Canadian Program for Cyber Security Certification: Level 1",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2026/04/canadian-program-for-cyber-security-certification-level-1.html",
    fr: {
      title: "Programme canadien de certification en cybersécurité, niveau 1",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2026/04/programme-canadien-de-certification-en-cybersecurite--niveau-1.html",
    },
  },
  cpcsc2025: {
    title: "Government of Canada announces first phase of Canadian Program for Cyber Security Certification",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2025/03/government-of-canada-announces-first-phase-of-canadian-program-for-cyber-security-certification.html",
    fr: {
      title: "Le gouvernement du Canada annonce la première phase du Programme canadien de certification en cybersécurité",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2025/03/le-gouvernement-du-canada-annonce-la-premiere-phase-du-programme-canadien-de-certification-en-cybersecurite.html",
    },
  },
  cpcsc2023: {
    title: "Government of Canada helping defence industry protect itself from cyber security threats",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2023/05/government-of-canada-helping-defence-industry-protect-itself-from-cyber-security-threats.html",
    fr: {
      title: "Le gouvernement du Canada aide l'industrie de la défense à se protéger contre les menaces à la cybersécurité",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2023/05/le-gouvernement-du-canada-aide-lindustrie-de-la-defense-a-se-proteger-contre-les-menaces-a-la-cybersecurite.html",
    },
  },
  itsp10171: {
    title: "Protecting specified information in non-Government of Canada systems and organizations (ITSP.10.171)",
    publisher: CYBER_CENTRE,
    url: "https://www.cyber.gc.ca/en/guidance/protecting-specified-information-non-government-canada-systems-and-organizations-itsp10171",
    fr: {
      title: "Protection de l'information désignée dans les organisations et les systèmes ne relevant pas du gouvernement du Canada (ITSP.10.171)",
      url: "https://www.cyber.gc.ca/fr/orientation/protection-linformation-designee-organisations-systemes-ne-relevant-pas-gouvernement-canada-itsp10171",
    },
  },
  cspIndex: {
    title: "Security requirements for contracting with the Government of Canada",
    publisher: PSPC,
    url: `${CSP_EN}.html`,
    fr: { title: "Exigences de sécurité des contrats du gouvernement du Canada", url: `${CSP_FR}.html` },
  },
  // Supplier integrity: the Ineligibility and Suspension Policy and the pages of PSPC's Office of Supplier Integrity and
  // Compliance (each read on 2026-11-15, in English and in French). The list of ineligible and suspended suppliers is cited
  // for what it is and what its columns hold; the guide names no supplier on it.
  isPolicy: {
    title: "Ineligibility and Suspension Policy",
    publisher: PSPC,
    url: `${OSIC_EN}/policy-directives/ineligibility-suspension-policy.html`,
    fr: { title: "Politique d'inadmissibilité et de suspension", url: `${OSIC_FR}/politique-directives/politique-inadmissibilite-suspension.html` },
  },
  osic: {
    title: "Office of Supplier Integrity and Compliance (OSIC)",
    publisher: PSPC,
    url: `${OSIC_EN}.html`,
    fr: { title: "Bureau de l'intégrité et de la conformité des fournisseurs (BICF)", url: `${OSIC_FR}.html` },
  },
  osicAbout: {
    title: "Overview of supplier integrity and compliance",
    publisher: PSPC,
    url: `${OSIC_EN}/about.html`,
    fr: { title: "Aperçu de l'intégrité et de la conformité des fournisseurs", url: `${OSIC_FR}/au-sujet.html` },
  },
  osicPolicies: {
    title: "Ineligibility and Suspension Policy and directives",
    publisher: PSPC,
    url: `${OSIC_EN}/policy-directives.html`,
    fr: { title: "Politique d'inadmissibilité et de suspension et directives", url: `${OSIC_FR}/politique-directives.html` },
  },
  osicNews: {
    title: "Coming into force of the Office of Supplier Integrity and Compliance",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/news/2024/05/coming-into-force-of-the-office-of-supplier-integrity-and-compliance.html",
    fr: {
      title: "Entrée en vigueur du Bureau de l'intégrité et de la conformité des fournisseurs",
      url: "https://www.canada.ca/fr/services-publics-approvisionnement/nouvelles/2024/05/entree-en-vigueur-du-bureau-de-lintegrite-et-de-la-conformite-des-fournisseurs.html",
    },
  },
  osicDepartments: {
    title: "Departments and agencies that apply the Ineligibility and Suspension Policy",
    publisher: PSPC,
    url: `${OSIC_EN}/departments-agencies-apply-ineligibility-suspension-policy.html`,
    fr: {
      title: "Ministères et organismes qui appliquent la Politique d'inadmissibilité et de suspension",
      url: `${OSIC_FR}/ministeres-organismes-appliquent-politique-inadmissibilite-suspension.html`,
    },
  },
  osicClauses: {
    title: "Clauses for procurement contracts: Ineligibility and Suspension Policy",
    publisher: PSPC,
    url: `${OSIC_EN}/ineligibility-suspension-clauses/procurement-contracts.html`,
    fr: {
      title: "Clauses pour les contrats d'approvisionnement : Politique d'inadmissibilité et de suspension",
      url: `${OSIC_FR}/clauses-inadmissibilite-suspension/contrats-approvisionnement.html`,
    },
  },
  osicSubcontractors: {
    title: "Application of the Ineligibility and Suspension Policy to subcontractors",
    publisher: PSPC,
    url: `${OSIC_EN}/supplier-guidance/application-subcontractor.html`,
    fr: {
      title: "Application de la Politique d'inadmissibilité et de suspension aux sous-traitants",
      url: `${OSIC_FR}/conseils-fournisseurs/application-sous-traitant.html`,
    },
  },
  osicActions: {
    title: "Administrative actions taken",
    publisher: PSPC,
    url: `${OSIC_EN}/administrative-actions.html`,
    fr: { title: "Mesures administratives prises", url: `${OSIC_FR}/mesures-administratives.html` },
  },
  osicList: {
    title: "Ineligible and suspended suppliers under the Ineligibility and Suspension Policy",
    publisher: PSPC,
    url: `${OSIC_EN}/ineligible-suspended-suppliers.html`,
    fr: {
      title: "Fournisseurs inadmissibles et suspendus en vertu de la Politique d'inadmissibilité et de suspension",
      url: `${OSIC_FR}/fournisseurs-inadmissibles-suspendus.html`,
    },
  },
  // The integrity guide's example notice's request for proposal, in each language, on CanadaBuys (read there on 2026-11-15).
  exampleIntegrity: {
    title: "Provision of high-visibility fire protective coveralls to the Department of National Defence, request for proposal W3010-27M007/A",
    publisher: DND,
    url: "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/113275/w3010-27m007a---rfp-e.pdf",
    fr: {
      title: "Fournir des Combinaisons de protection de feu à haute visibilité à Ministère de la Défense nationale, demande de propositions W3010-27M007/A",
      url: "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/113275/w3010-27m007a---rfp-f.pdf",
    },
  },
} satisfies Record<string, Source>;

// The site's own pages the guides link to.
const METHODOLOGY = "/methodology";
// One organization with records in all three contract sources and four standing offers or supply arrangements,
// so its profile shows each section the guides point to (read on awardwatch.ca on 2026-11-11).
export const EXAMPLE_PROFILE = "/organizations/org-77ed664e0c";
// A published contract whose department reported a mandatory set-aside under the Procurement Strategy for
// Indigenous Business, with a business as the supplier (read from the site's 2026 contracts file on 2026-11-11),
// so its page shows the field the guide on set-asides describes.
export const EXAMPLE_SET_ASIDE = "/contracts/dnd-mdn/C-2026-2027-Q1-00052";
// A request for proposal whose description states security requirements and whose trade agreements line names
// thirteen agreements, NAFTA among them; an advance contract award notice whose limited tendering reason reads
// Exclusive Rights; and an award notice that links the tender notice it followed. Each was read on CanadaBuys or
// in its open data and on awardwatch.ca on 2026-11-14; a notice's page stays on the site after it closes.
export const EXAMPLE_NOTICE = "/tenders/cb-800-75831340";
export const EXAMPLE_ACAN = "/tenders/ws5918268553-doc5979457667";
export const EXAMPLE_AWARD = "/awards/cb-391-38769273";
// A request for standing offer from National Defence whose description says it is subject to the Policy on
// Prioritizing Canadian Suppliers and Canadian Content, open only to Canadian suppliers and suppliers of an
// applicable trading partner, and asks for the Canadian Content Attestation Form (read on CanadaBuys, in its open
// data and on awardwatch.ca on 2026-11-14; it closes 2026-12-03).
export const EXAMPLE_BUY_CANADIAN = "/tenders/cb-342-43639893";
// A request for proposal from PSPC for National Defence whose selection criteria read Highest Combined Rating of
// Technical Merit and Price, and whose description sends bidders to SAP Ariba for the solicitation and its annexes
// (read on CanadaBuys, in the site's data and on awardwatch.ca on 2026-11-14; it closes 2026-12-31).
export const EXAMPLE_EVALUATION = "/tenders/ws5933829424-doc5973518768";
// An award notice from Agriculture and Agri-Food Canada for goods whose page shows an award date (2026-10-21) and a
// publication date (2026-11-10) apart, a total contract value and a trade agreements line of eleven agreements, the
// CFTA among them (read in the site's newest award notices and on awardwatch.ca on 2026-11-14).
export const EXAMPLE_DEBRIEF = "/awards/cb-879-18498282";
// A PSPC award notice for the Department of Natural Resources whose page shows Goods as its category, a value and a
// trade agreements line of twelve agreements, CETA and the Canada-UK Trade Continuity Agreement among them (awarded
// 2026-11-13; read in the site's newest award notices, on awardwatch.ca and on CanadaBuys on 2026-11-14).
export const EXAMPLE_SBPP = "/awards/cw2460403";
// A PSPC award notice for the Department of Veterans Affairs whose page shows Directed Contract as its notice type,
// Non-competitive as its procurement method and Exclusive Rights as its limited tendering reason (awarded 2026-11-10,
// published 2026-11-13; read in the site's newest award notices, on awardwatch.ca and on CanadaBuys on 2026-11-14).
export const EXAMPLE_LIMITS = "/awards/cw2454835";
// A request for proposal from National Defence for a radar signal stimulator whose page shows nine documents (the
// request for proposal in English and in French among them) and the link to the notice on CanadaBuys, and whose
// description does not mention the cyber security certification (read in the site's open notices and on
// awardwatch.ca on 2026-11-15; it closes 2027-01-04). CanadaBuys' own page for it refused an automated reading.
export const EXAMPLE_CYBER = "/tenders/cb-768-40670607";
// A request for proposal from National Defence for high-visibility fire protective coveralls whose page shows two
// documents, its request for proposal in English and in French, on CanadaBuys; the English one holds the Ineligibility and
// Suspension Policy's clause for offers (section 3.4) and its resulting contract clause (16.9). Chosen as an ordinary open
// notice from the site's open notices (read with its documents and on awardwatch.ca on 2026-11-15; it closes 2027-01-07).
export const EXAMPLE_INTEGRITY = "/tenders/cb-854-90375469";
// The pages the figures are captured from, drawn from the sample records in site/figures/, made for the figures
// and never real, their reference numbers in ranges the real series are nowhere near: five tender notices (the
// second with security requirements in its description, a limited tendering reason of None and a trade
// agreements line that names NAFTA; the third with a Buy Canadian statement in its description; the fourth, from
// National Defence, with three documents; the fifth, from Fisheries and Oceans Canada, with two), an advance
// contract award notice, one day's new notices, one contract's award notice (linking the tender notice it
// followed) and PSPC contract history record, a second contract history record that gives its supplier's
// employees, published contracts (the same contract's amendment, one after an ACAN, one under a set-aside, one awarded
// without soliciting bids), a standing offer and the 3-month list of contracts ending.
const SAMPLE_NOTICE = "/tenders/cb-900-90000101";
const SAMPLE_NOTICE_SECURITY = "/tenders/cb-900-90000303";
const SAMPLE_NOTICE_BUY_CANADIAN = "/tenders/cb-900-90000606";
const SAMPLE_NOTICE_DOCUMENTS = "/tenders/cb-900-90000707";
const SAMPLE_NOTICE_INTEGRITY = "/tenders/cb-900-90000808";
const SAMPLE_NEW = "/tenders/new";
const SAMPLE_ACAN = "/tenders/cb-900-90000202";
const SAMPLE_AWARD = "/awards/cw9391528";
const SAMPLE_HISTORY = "/history/cw9391528";
const SAMPLE_HISTORY_EMPLOYEES = "/history/cw9391744";
const SAMPLE_PUBLISHED = "/contracts/dfo-mpo/C-2026-2027-Q2-90088";
const SAMPLE_PUBLISHED_ACAN = "/contracts/nrcan-rncan/C-2026-2027-Q2-90231";
const SAMPLE_PUBLISHED_PSIB = "/contracts/isc-sac/C-2026-2027-Q2-90117";
const SAMPLE_PUBLISHED_TN = "/contracts/nrcan-rncan/C-2026-2027-Q2-90345";
const SAMPLE_INSTRUMENT = `/instruments/${encodeURIComponent("EN578-991533/001/ZT")}`;
const SAMPLE_ENDING = "/expiring/3m";
// The addresses of the guides that link one another.
const ACAN_PATH = "/guides/advance-contract-award-notices-acan";
const PSIB_PATH = "/guides/indigenous-business-set-asides-psib";
const THREE_PATH = "/guides/three-records-of-one-federal-contract";
const READING_PATH = "/guides/reading-a-canadabuys-tender-notice";
const SOSA_PATH = "/guides/standing-offers-and-supply-arrangements";
const ENDING_PATH = "/guides/when-a-federal-contract-ends";
const BID_PATH = "/guides/how-to-bid-on-government-of-canada-contracts";
const SECURITY_PATH = "/guides/security-requirements-on-federal-contracts";
const TRADE_PATH = "/guides/trade-agreements-and-thresholds-on-federal-tenders";
const BUY_CANADIAN_PATH = "/guides/buy-canadian-policy-on-federal-tenders";
const EVALUATION_PATH = "/guides/how-federal-bids-are-evaluated-and-selected";
const DEBRIEF_PATH = "/guides/debriefings-and-bid-challenges-on-federal-contracts";
const SBPP_PATH = "/guides/small-business-procurement-program-sbpp";
const LIMITS_PATH = "/guides/federal-contracts-without-competition-and-contracting-limits";
const CYBER_PATH = "/guides/cyber-security-certification-for-defence-suppliers-cpcsc";
const INTEGRITY_PATH = "/guides/supplier-integrity-ineligibility-and-suspension-policy";

// -- the guides ---------------------------------------------------------------------

const TENDER_NOTICE: Guide = {
  slug: "reading-a-canadabuys-tender-notice",
  title: both("How to Read a Federal Tender Notice on CanadaBuys", "Lire un avis d'appel d'offres fédéral sur AchatsCanada"),
  seoTitle: both("How to Read a CanadaBuys Tender Notice", "Lire un avis d'appel d'offres d'AchatsCanada"),
  summary: both(
    "What each part of a federal tender notice on CanadaBuys means: notice type, method, closing time, amendments, trade agreements, codes and regions.",
    "Ce que veut dire chaque partie d'un avis d'appel d'offres fédéral sur AchatsCanada : type, méthode, clôture, modifications, accords, codes, régions.",
  ),
  checked: "2026-11-11",
  action: tenderList(
    "To keep track of new federal tender notices, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "notice",
      title: both("What a Notice Is", "Ce qu'est un avis"),
      blocks: [
        p(
          "A tender notice is the public posting of a federal buying opportunity. Federal departments, agencies and Crown corporations post them on CanadaBuys, which hosts the Government Electronic Tendering Service and is their authoritative source.",
          "Un avis d'appel d'offres est l'annonce publique d'une occasion d'achat fédérale. Les ministères, organismes et sociétés d'État fédéraux les publient sur AchatsCanada, qui héberge le Service électronique d'appels d'offres du gouvernement et en est la source faisant autorité.",
        ),
        p(
          "Award Watch reads the open notices from CanadaBuys' open data file every night and lists them under {open}, each linked to its page on CanadaBuys. The notice on CanadaBuys is the record.",
          "Award Watch lit chaque nuit les avis ouverts du fichier de données ouvertes d'AchatsCanada et les présente sous {open}, chacun lié à sa page sur AchatsCanada. L'avis publié sur AchatsCanada fait foi.",
          { open: a("/tenders", "open tender notices", "avis d'appel d'offres ouverts") },
        ),
        p(
          "CanadaBuys gives each notice a reference number, and the buying department gives it a solicitation number. To follow a requirement from its tender notice to its award notice, CanadaBuys recommends the solicitation number.",
          "AchatsCanada donne à chaque avis un numéro de référence, et le ministère acheteur lui donne un numéro d'invitation. Pour suivre un besoin de son avis d'appel d'offres à son avis d'attribution, AchatsCanada recommande le numéro d'invitation.",
        ),
        figure(
          "notice-head", SAMPLE_NOTICE, "header.page-head .page-head-row",
          both(
            "The head of a tender notice's page on Award Watch: its title, its status, its closing time, its buyer, its reference number and a button to the notice on CanadaBuys.",
            "L'en-tête de la page d'un avis d'appel d'offres sur Award Watch : son titre, son statut, son heure de clôture, son acheteur, son numéro de référence et un bouton vers l'avis sur AchatsCanada.",
          ),
          both("The head of a tender notice's page on Award Watch.", "L'en-tête de la page d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(".lead", "Award Watch works out on each page view whether the notice is open, closing within 7 days or past its closing time.",
              "Award Watch établit à chaque affichage si l'avis est ouvert, s'il ferme d'ici 7 jours ou si son heure de clôture est passée."),
            mark(".page-actions a", "The notice on CanadaBuys is the record, and each notice page links to it.",
              "L'avis publié sur AchatsCanada fait foi, et chaque page d'avis y renvoie."),
            mark("p.page-note:has(.mono)", "The reference number CanadaBuys gives the notice, and the amendment count from CanadaBuys' data.",
              "Le numéro de référence qu'AchatsCanada donne à l'avis, et le nombre de modifications tiré des données d'AchatsCanada."),
            mark(".page-note + .page-note", "Award Watch never shows contact details; the notice on CanadaBuys has them.",
              "Award Watch n'affiche jamais les coordonnées; l'avis sur AchatsCanada les donne."),
          ],
        ),
      ],
    },
    {
      id: "types",
      title: both("Notice Types", "Types d'avis"),
      blocks: [
        p(
          "The notice type says what the buyer is asking for. CanadaBuys' data dictionary allows nine values, among them:",
          "Le type d'avis indique ce que demande l'acheteur. Le dictionnaire de données d'AchatsCanada admet neuf valeurs, dont celles-ci :",
        ),
        {
          kind: "terms",
          items: [
            {
              term: both("Request for Proposal", "Demande de propositions"),
              text: tx("A call for bids to supply goods or services.", "Un appel de soumissions pour fournir des biens ou des services."),
            },
            {
              term: both("Request for Standing Offer", "Demande d'offre à commandes"),
              text: tx(
                "Seeks {sosa} for goods or services bought on a repetitive basis.",
                "Sollicite des {sosa} pour des biens ou des services achetés de façon répétitive.",
                { sosa: a("/guides/standing-offers-and-supply-arrangements", "standing offers", "offres à commandes") },
              ),
            },
            {
              term: both("Request for Supply Arrangement", "Demande pour un arrangement en matière d'approvisionnement"),
              text: tx(
                "Sets up a supply arrangement, a pool of pre-qualified suppliers who later compete for specific requirements.",
                "Établit un arrangement en matière d'approvisionnement, un bassin de fournisseurs préqualifiés qui se disputent ensuite des besoins précis.",
              ),
            },
            {
              term: both("RFP against Supply Arrangement", "Demande de proposition découlant d'un arrangement en matière d'approvisionnement"),
              text: tx(
                "A solicitation under an existing supply arrangement, open only to suppliers pre-qualified under it when it is issued.",
                "Une demande de soumissions dans le cadre d'un arrangement existant, ouverte aux seuls fournisseurs préqualifiés au moment où elle est lancée.",
              ),
            },
            {
              term: both("Advance Contract Award Notice", "Préavis d'attribution du contrat"),
              text: tx(
                "Says the buyer intends to award a contract to a business it believes is the only one able to do the work. It stays posted at least 15 calendar days. A supplier that can meet the requirements may submit a statement of capabilities, and if one meets them, the buyer moves to a competitive process.",
                "Annonce que l'acheteur compte attribuer un contrat à une entreprise qu'il croit la seule capable de faire le travail. Il reste affiché au moins 15 jours civils. Un fournisseur capable de satisfaire aux exigences peut présenter un énoncé des capacités, et si un énoncé y satisfait, l'acheteur passe à un processus concurrentiel.",
              ),
            },
            {
              term: both("Request for Information", "Demande de renseignements"),
              text: tx(
                "Asks suppliers for information. It is not a solicitation and commits the government to no purchase.",
                "Demande de l'information aux fournisseurs. Ce n'est pas une demande de soumissions, et elle n'engage le gouvernement à aucun achat.",
              ),
            },
            {
              term: both("Invitation to Qualify", "Invitation à se qualifier"),
              text: tx(
                "Pre-qualifies suppliers for a later solicitation. One on CanadaBuys states that only the respondents it qualifies may respond to that solicitation.",
                "Préqualifie des fournisseurs pour une demande ultérieure. Une invitation publiée sur AchatsCanada précise que seuls les répondants qu'elle qualifie pourront répondre à cette demande.",
              ),
            },
          ],
        },
        p(
          "The tender list filters by type, as in this list of {acan}.",
          "La liste des appels d'offres se filtre par type, comme cette liste des {acan}.",
          { acan: a("/tenders?type=Advance%20Contract%20Award%20Notice", "open advance contract award notices", "préavis ouverts") },
        ),
      ],
    },
    {
      id: "method",
      title: both("Procurement Method and Selection", "Méthode d'approvisionnement et sélection"),
      blocks: [
        p(
          "The procurement method says how bids are sought. The Treasury Board's schema for published contracts defines them:",
          "La méthode d'approvisionnement indique comment les soumissions sont demandées. Le schéma du Conseil du Trésor pour les contrats publiés les définit :",
        ),
        {
          kind: "list",
          items: [
            tx(
              "Competitive, open bidding: bids solicited through the Government Electronic Tendering Service.",
              "Concurrentielle, invitation ouverte à soumissionner : soumissions demandées par le Service électronique d'appels d'offres du gouvernement.",
            ),
            tx(
              "Competitive, selective tendering: qualified suppliers selected from a source list, as the trade agreements permit.",
              "Concurrentielle, appel d'offres sélectif : fournisseurs qualifiés choisis dans une liste de fournisseurs, comme le permettent les accords commerciaux.",
            ),
            tx("Competitive, traditional: bids solicited through another medium.", "Concurrentielle, traditionnelle : soumissions demandées par un autre moyen."),
            tx("Non-competitive: a contract awarded without soliciting bids.", "Non concurrentielle : contrat attribué sans demande de soumissions."),
            tx(
              "Advance contract award notice: a contract awarded to the supplier an ACAN identified.",
              "Préavis d'attribution du contrat : contrat attribué au fournisseur désigné par un préavis.",
            ),
          ],
        },
        p(
          "CanadaBuys' dictionary lists four more methods, limited tendering among them. Award Watch counts every competitive method as competitive and the last two above as non-competitive ({competitive}).",
          "Le dictionnaire d'AchatsCanada énumère quatre autres méthodes, dont l'appel d'offres limité. Award Watch compte chaque méthode concurrentielle comme concurrentielle et les deux dernières ci-dessus comme non concurrentielles ({competitive}).",
          { competitive: a(`${METHODOLOGY}#competitive`, "Methodology", "Méthodologie") },
        ),
        p(
          "A limited tendering reason, such as exclusive rights or extreme urgency, explains why a contract is not awarded through competitive solicitation. {evaluation} explains the selection criteria.",
          "Un motif d'appel d'offres limité, comme des droits exclusifs ou une urgence extrême, explique pourquoi un contrat n'est pas attribué par une demande de soumissions concurrentielle. {evaluation} explique les critères de sélection.",
          { evaluation: a(EVALUATION_PATH, "How a Federal Bid Is Evaluated and the Basis of Selection", "L'évaluation d'une soumission fédérale et la méthode de sélection") },
        ),
      ],
    },
    {
      id: "closing",
      title: both("Closing Date and Time", "Date et heure de clôture"),
      blocks: [
        p(
          "CanadaBuys defines the closing date as the date after which no new submissions will be accepted. The notice page shows the closing date and time with a time zone.",
          "AchatsCanada définit la date de clôture comme la date après laquelle aucune nouvelle soumission n'est acceptée. La page de l'avis affiche la date et l'heure de clôture avec un fuseau horaire.",
        ),
        p(
          "The data file gives no zone. Award Watch reads closing times as Eastern time (ET), the zone CanadaBuys publishes them in, and works out on each page view whether a notice is open, {soon} or past its closing time ({statuses}).",
          "Le fichier de données ne donne aucun fuseau. Award Watch lit les heures de clôture en heure de l'Est (HE), le fuseau dans lequel AchatsCanada les publie, et établit à chaque affichage si un avis est ouvert, {soon} ou si son heure de clôture est passée ({statuses}).",
          {
            statuses: a(`${METHODOLOGY}#statuses`, "Methodology", "Méthodologie"),
            soon: a("/tenders?closing=7", "closing within 7 days", "s'il ferme d'ici 7 jours"),
          },
        ),
        p(
          "A notice's status reads Open while it accepts bids, then Expired or Cancelled. Questions, errors and requests to extend a closing date go to the contracting officer.",
          "Le statut d'un avis est Ouvert tant qu'il accepte des soumissions, puis Expiré ou Annulé. Les questions, les erreurs et les demandes de prolongation de la date de clôture s'adressent à l'agent de négociation des contrats.",
        ),
        figure(
          "notice-dates", SAMPLE_NOTICE, ".panel-grid",
          both(
            "The Key Dates and Buyer panels of a tender notice's page on Award Watch: the publication, closing and amendment dates, the buyer, the end user and the solicitation number.",
            "Les panneaux Dates clés et Acheteur de la page d'un avis d'appel d'offres sur Award Watch : les dates de publication, de clôture et de modification, l'acheteur, l'utilisateur final et le numéro d'invitation.",
          ),
          both("The dates and the buyer of a tender notice on Award Watch.", "Les dates et l'acheteur d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(field(":scope > .panel:first-child dl", 2), "Award Watch reads the closing time as Eastern time (ET), the zone CanadaBuys publishes it in.",
              "Award Watch lit l'heure de clôture en heure de l'Est (HE), le fuseau dans lequel AchatsCanada la publie."),
            mark(field(":scope > .panel:first-child dl", 3), "Award Watch shows the amendment date and the amendment count from CanadaBuys' data.",
              "Award Watch affiche la date de modification et le nombre de modifications tiré des données d'AchatsCanada."),
            mark(field(":scope > .panel:last-child dl", 3),
              "The solicitation number the buying department gives the notice, which CanadaBuys recommends for following a requirement to its award notice.",
              "Le numéro d'invitation que le ministère acheteur donne à l'avis, qu'AchatsCanada recommande pour suivre un besoin jusqu'à son avis d'attribution."),
          ],
        ),
      ],
    },
    {
      id: "amendments",
      title: both("Amendments", "Modifications"),
      blocks: [
        p(
          "A buyer changes a posted notice by amendment. Answers to suppliers' questions are posted as amendments, and an amendment can add or replace documents.",
          "L'acheteur change un avis publié par une modification. Les réponses aux questions des fournisseurs sont publiées comme modifications, et une modification peut ajouter ou remplacer des documents.",
        ),
        p(
          "The notice page shows the date of the last amendment, and each document the amendment it came with. Award Watch shows the amendment count from CanadaBuys' data and the amendment date, and links to the notice.",
          "La page de l'avis affiche la date de la dernière modification, et chaque document la modification qui l'a apporté. Award Watch affiche le nombre de modifications tiré des données d'AchatsCanada et la date de modification, et renvoie à l'avis.",
        ),
      ],
    },
    {
      id: "trade",
      title: both("Trade Agreements", "Accords commerciaux"),
      blocks: [
        p(
          "The trade agreements line lists the agreements that apply. Coverage depends on the purchase's value, the buying entity, the type of requirement and any exclusion or exception. A covered competitive procurement must be advertised on the Government Electronic Tendering Service, save for set exceptions. A notice of proposed procurement must name the agreements that apply and any set-aside under the Procurement Strategy for Indigenous Business.",
          "La ligne des accords commerciaux énumère les accords qui s'appliquent. L'application dépend de la valeur de l'achat, de l'entité acheteuse, du type de besoin et de toute exclusion ou exception. Un achat concurrentiel visé doit être annoncé sur le Service électronique d'appels d'offres du gouvernement, sauf exceptions précises. Un avis de projet de marché doit nommer les accords qui s'appliquent et toute réserve en vertu de la Stratégie d'approvisionnement auprès des entreprises autochtones.",
        ),
        p(
          "Each agreement applies from a threshold, which the Treasury Board updates every two years. For federal departments and agencies, these apply from January 1, 2026, to December 31, 2027:",
          "Chaque accord s'applique à partir d'un seuil, que le Conseil du Trésor met à jour tous les deux ans. Pour les ministères et organismes fédéraux, voici ceux en vigueur du 1er janvier 2026 au 31 décembre 2027 :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "main", label: both("Agreement or partner", "Accord ou partenaire") },
            { kind: "value", label: both("Goods", "Biens") },
            { kind: "value", label: both("Services", "Services") },
            { kind: "value", label: both("Construction", "Construction") },
          ],
          rows: [
            [both("Canadian Free Trade Agreement (internal)", "Accord de libre-échange canadien (interne)"), { money: 34_700 }, { money: 139_000 }, { money: 139_000 }],
            [
              both(
                "European Union (CETA), Trans-Pacific (CPTPP), WTO (GPA), United Kingdom, Ukraine",
                "Union européenne (AECG), Transpacifique (PTPGP), OMC (AMP), Royaume-Uni, Ukraine",
              ),
              { money: 239_200 }, { money: 239_200 }, { money: 9_200_000 },
            ],
            [both("Peru", "Pérou"), { money: 174_800 }, { money: 174_800 }, { money: 9_200_000 }],
            [both("Chile, Colombia, Honduras, Panama", "Chili, Colombie, Honduras, Panama"),
              { money: 145_900 }, { money: 145_900 }, { money: 9_200_000 }],
            [both("Korea", "Corée"), { money: 100_000 }, { money: 100_000 }, { money: 9_200_000 }],
          ],
        },
        p(
          "In CanadaBuys' data the line can also read None, or refer to the tender description or documents.",
          "Dans les données d'AchatsCanada, la ligne peut aussi indiquer Aucun, ou renvoyer à la description ou aux documents de l'appel d'offres.",
        ),
        figure(
          "notice-procurement", SAMPLE_NOTICE, "section.panel:has(> dl.wide)",
          both(
            "The Procurement panel of a tender notice's page on Award Watch: category, notice type, procurement method, selection criteria, trade agreements, regions and provinces.",
            "Le panneau Approvisionnement de la page d'un avis d'appel d'offres sur Award Watch : catégorie, type d'avis, méthode d'approvisionnement, critères de sélection, accords commerciaux, régions et provinces.",
          ),
          both("A tender notice's procurement details on Award Watch.", "Les détails d'approvisionnement d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(field("dl.wide", 2), "The notice type says what the buyer is asking for.", "Le type d'avis indique ce que demande l'acheteur."),
            mark(field("dl.wide", 3), "The procurement method says how bids are sought.", "La méthode d'approvisionnement indique comment les soumissions sont demandées."),
            mark(field("dl.wide", 5), "The trade agreements line lists the agreements that apply.", "La ligne des accords commerciaux énumère les accords qui s'appliquent."),
            mark(field("dl.wide", 7), "The regions of delivery are where the contract will be delivered.",
              "Les régions de livraison sont les endroits où le contrat sera exécuté."),
            mark(field("dl.wide", 8), "Award Watch maps the National Capital Region to Ontario and Quebec.",
              "Award Watch associe la région de la capitale nationale à l'Ontario et au Québec."),
          ],
        ),
      ],
    },
    {
      id: "codes",
      title: both("UNSPSC Codes and Category", "Codes UNSPSC et catégorie"),
      blocks: [
        p(
          "The UNSPSC codes name what is being bought, in eight digits over four levels: segment, family, class and commodity. CanadaBuys' example is 56101720, an office or work chair, in segment 56, furniture and furnishings. The codes replaced the Goods and Services Identification Number (GSIN), still used in some cases.",
          "Les codes UNSPSC désignent ce qui est acheté, en huit chiffres sur quatre niveaux : segment, famille, classe et marchandise. L'exemple d'AchatsCanada est 56101720, une chaise de bureau ou de travail, dans le segment 56, mobilier et ameublement. Ces codes ont remplacé le Numéro d'identification des biens et services (NIBS), qui sert encore dans certains cas.",
        ),
        p(
          "Award Watch groups notices by their codes' first two digits on its {segments} pages. The procurement category is broader: construction (CNST), goods (GD), services (SRV) or services related to goods (SRVTGD).",
          "Award Watch regroupe les avis par les deux premiers chiffres de leurs codes dans ses pages des {segments}. La catégorie d'approvisionnement est plus large : construction (CNST), biens (GD), services (SRV) ou services liés aux biens (SRVTGD).",
          { segments: a("/segments", "segments", "segments") },
        ),
      ],
    },
    {
      id: "regions",
      title: both("Regions of Delivery and Opportunity", "Régions de livraison et de l'appel d'offres"),
      blocks: [
        p(
          "The regions of delivery are where the contract will be delivered. The regions of opportunity are the areas the opportunity relates to.",
          "Les régions de livraison sont les endroits où le contrat sera exécuté. Les régions de l'appel d'offres sont les zones que vise l'occasion.",
        ),
        p(
          "Award Watch maps the regions of delivery to provinces, the National Capital Region to Ontario and Quebec, and \"Canada\" or a blank to none. For a notice that names no province, the site derives provinces from other fields, such as a city or the regions of opportunity, and marks them as derived ({places}).",
          "Award Watch associe les régions de livraison à des provinces, la région de la capitale nationale à l'Ontario et au Québec, et « Canada » ou un champ vide à aucune. Pour un avis qui ne nomme aucune province, le site déduit des provinces d'autres champs, comme une ville ou les régions de l'appel d'offres, et les marque « par déduction » ({places}).",
          { places: a(`${METHODOLOGY}#places`, "Methodology", "Méthodologie") },
        ),
      ],
    },
    {
      id: "documents",
      title: both("Documents and Contact", "Documents et personne-ressource"),
      blocks: [
        p(
          "The solicitation documents and bidding instructions are on the notice's Bidding details tab on CanadaBuys, or on SAP Ariba for a tender processed through electronic procurement. Award Watch links to the documents CanadaBuys' file names and copies none.",
          "Les documents d'invitation et les instructions pour soumissionner se trouvent dans l'onglet des détails de la soumission de l'avis sur AchatsCanada, ou sur SAP Ariba pour un appel d'offres traité par approvisionnement électronique. Award Watch renvoie aux documents que nomme le fichier d'AchatsCanada et n'en copie aucun.",
        ),
        p(
          "The contact information names the contracting authority, with a phone number and an email address. PSPC's seminar notes for suppliers call the contracting authority named in the solicitation document the only point of contact. Award Watch never shows contact details; each notice page links to CanadaBuys for them.",
          "Les coordonnées nomment l'autorité contractante, avec un numéro de téléphone et une adresse courriel. Les notes de séminaire de SPAC pour les fournisseurs désignent l'autorité contractante nommée dans le document d'invitation comme la seule personne-ressource. Award Watch n'affiche jamais les coordonnées; chaque page d'avis renvoie à AchatsCanada pour les obtenir.",
        ),
      ],
    },
  ],
  sources: [
    SRC.tenderData, SRC.dictionary, SRC.support, SRC.gets, SRC.seminar, SRC.howToBid, SRC.acan, SRC.rfi, SRC.itq, SRC.contractsSchema,
    SRC.npp, SRC.tradeApplicability, SRC.tradeNotices, SRC.thresholds, SRC.codes,
  ],
};

const STANDING_OFFERS: Guide = {
  slug: "standing-offers-and-supply-arrangements",
  title: both("Standing Offers and Supply Arrangements", "Offres à commandes et arrangements en matière d'approvisionnement"),
  seoTitle: both("Standing Offers and Supply Arrangements", "Offres à commandes et arrangements (AMA)"),
  summary: both(
    "What federal standing offers and supply arrangements are, how call-ups and solicitations under them work, who can use them, and how to see who holds them.",
    "Ce que sont les offres à commandes et les arrangements en matière d'approvisionnement, comment on s'en sert, qui peut s'en servir et qui les détient.",
  ),
  checked: "2026-11-11",
  // The instruments page offers no email list; the tender notices of the type that seeks standing offers.
  action: tenderList(
    "To keep track of new requests for standing offers, save this list with your email address.",
    "Pour suivre les nouvelles demandes d'offre à commandes, enregistrez cette liste avec votre adresse courriel.",
    "Request for Standing Offer",
  ),
  sections: [
    {
      id: "overview",
      title: both("Two Instruments for Repeat Buying", "Deux instruments pour les achats répétés"),
      blocks: [
        p(
          "Public Services and Procurement Canada (PSPC) uses standing offers and supply arrangements for goods and services that departments buy on a repetitive basis. Neither is a contract. Each call-up under a standing offer, and each contract awarded under a supply arrangement, is a separate contract.",
          "Services publics et Approvisionnement Canada (SPAC) se sert des offres à commandes et des arrangements en matière d'approvisionnement pour les biens et services que les ministères achètent de façon répétitive. Ni l'un ni l'autre n'est un contrat. Chaque commande subséquente à une offre à commandes, et chaque contrat attribué en vertu d'un arrangement, est un contrat distinct.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Point", "Aspect") },
            { kind: "main", label: both("Standing offer", "Offre à commandes") },
            { kind: "main", label: both("Supply arrangement", "Arrangement en matière d'approvisionnement") },
          ],
          rows: [
            [
              both("What it is", "Ce que c'est"),
              both("A supplier's offer to provide goods or services at pre-arranged prices and terms", "L'offre d'un fournisseur de fournir des biens ou des services à des prix et conditions établis d'avance"),
              both("A pool of pre-qualified suppliers who compete for requirements under a predefined framework", "Un bassin de fournisseurs préqualifiés qui se disputent des besoins dans un cadre prédéfini"),
            ],
            [
              both("Set up through", "Établi par"),
              both("A Request for Standing Offer", "Une demande d'offre à commandes"),
              both("A Request for Supply Arrangement, generally", "Une demande d'arrangement en matière d'approvisionnement, en général"),
            ],
            [
              both("How the government buys", "Comment le gouvernement achète"),
              both("A call-up, which becomes a contract", "Une commande subséquente, qui devient un contrat"),
              both("A bid solicitation to the suppliers pre-qualified at the time; each contract awarded is separate", "Une demande de soumissions aux fournisseurs préqualifiés à ce moment; chaque contrat attribué est distinct"),
            ],
            [
              both("Prices", "Prix"),
              both("Predetermined and fixed", "Établis d'avance et fixes"),
              both("Often ceiling prices, which the department can negotiate downward", "Souvent des prix plafonds, que le ministère peut négocier à la baisse"),
            ],
            [
              both("In the published contracts", "Dans les contrats publiés"),
              both("The agreement at $0, each call-up as a contract", "L'accord à 0 $, chaque commande subséquente comme un contrat"),
              both("The agreement at $0, each contract under it as a contract", "L'accord à 0 $, chaque contrat qui en découle comme un contrat"),
            ],
          ],
        },
      ],
    },
    {
      id: "standing-offers",
      title: both("Standing Offers and Call-Ups", "Offres à commandes et commandes subséquentes"),
      blocks: [
        p(
          "A standing offer is an offer from a supplier to provide goods or services at pre-arranged prices. Neither side has a contractual obligation until the government makes a call-up. The call-up is the order, and a contract is established with each one.",
          "Une offre à commandes est l'offre d'un fournisseur de fournir des biens ou des services à des prix établis d'avance. Aucune des parties n'a d'obligation contractuelle tant que le gouvernement ne passe pas de commande subséquente. La commande subséquente est la commande, et un contrat est établi avec chacune.",
        ),
        p(
          "PSPC issues five types, which differ by who uses them and where:",
          "SPAC émet cinq types d'offres à commandes, qui diffèrent selon qui s'en sert et où :",
        ),
        {
          kind: "terms",
          items: [
            {
              term: both("National master standing offer (NMSO)", "Offre à commandes principale et nationale (OCPN)"),
              text: tx("Used by many departments or agencies throughout Canada.", "Utilisée par de nombreux ministères ou organismes partout au Canada."),
            },
            {
              term: both("Regional master standing offer (RMSO)", "Offre à commandes principale et régionale (OCPR)"),
              text: tx("Used by many departments or agencies within a specific geographic area.", "Utilisée par de nombreux ministères ou organismes dans une zone géographique précise."),
            },
            {
              term: both("National individual standing offer (NISO)", "Offre à commandes individuelle et nationale (OCIN)"),
              text: tx("Used by one specific department or agency throughout Canada.", "Utilisée par un ministère ou un organisme précis partout au Canada."),
            },
            {
              term: both("Regional individual standing offer (RISO)", "Offre à commandes individuelle et régionale (OCIR)"),
              text: tx("Used by one specific department or agency within a specific geographic area.", "Utilisée par un ministère ou un organisme précis dans une zone géographique précise."),
            },
            {
              term: both("Departmental individual standing offer (DISO)", "Offre à commandes individuelle et ministérielle (OCIM)"),
              text: tx("Used only by PSPC on behalf of specific departments and agencies.", "Utilisée seulement par SPAC au nom de ministères et d'organismes précis."),
            },
          ],
        },
        p(
          "Departments and agencies may also set up standing offers of their own. A call-up can be competitive or non-competitive, according to the procurement strategy, and the clients PSPC authorizes to make call-ups are defined in the standing offer.",
          "Les ministères et organismes peuvent aussi établir leurs propres offres à commandes. Une commande subséquente peut être concurrentielle ou non, selon la stratégie d'approvisionnement, et les clients que SPAC autorise à passer des commandes subséquentes sont définis dans l'offre à commandes.",
        ),
      ],
    },
    {
      id: "supply-arrangements",
      title: both("Supply Arrangements and Solicitations Under Them", "Arrangements et demandes de soumissions qui en découlent"),
      blocks: [
        p(
          "A supply arrangement sets up a pool of pre-qualified suppliers. When a department has a specific requirement within its scope, it solicits bids from the pool, and only suppliers that are pre-qualified when that solicitation is issued may bid. The ones posted on CanadaBuys carry the notice type {rfpsa}. A solicitation under an arrangement that a trade agreement covers must still meet that agreement's rules on public notice.",
          "Un arrangement en matière d'approvisionnement établit un bassin de fournisseurs préqualifiés. Lorsqu'un ministère a un besoin précis qui entre dans sa portée, il demande des soumissions au bassin, et seuls les fournisseurs préqualifiés au moment où la demande est lancée peuvent soumissionner. Celles qui sont publiées sur AchatsCanada portent le type d'avis {rfpsa}. Une demande découlant d'un arrangement que vise un accord commercial doit tout de même respecter les règles de cet accord sur l'avis public.",
          { rfpsa: a("/tenders?type=RFP%20against%20Supply%20Arrangement", "RFP against Supply Arrangement", "demande de proposition découlant d'un arrangement") },
        ),
        p(
          "Many supply arrangements set ceiling prices, which the department can negotiate downward. Each contract awarded under an arrangement is a separate binding contract. In CanadaBuys' award notices its instrument type reads Contract against SA.",
          "De nombreux arrangements fixent des prix plafonds, que le ministère peut négocier à la baisse. Chaque contrat attribué en vertu d'un arrangement est un contrat distinct et exécutoire. Dans les avis d'attribution d'AchatsCanada, son type d'instrument indique un contrat découlant d'un arrangement en matière d'approvisionnement.",
        ),
      ],
    },
    {
      id: "users",
      title: both("Who Can Use Them", "Qui peut s'en servir"),
      blocks: [
        p(
          "Each instrument sets its own users. A standing offer defines the clients authorized to make call-ups, and a supply arrangement sets out its geographic range and intended users.",
          "Chaque instrument fixe ses propres utilisateurs. Une offre à commandes définit les clients autorisés à passer des commandes subséquentes, et un arrangement précise sa portée géographique et ses utilisateurs prévus.",
        ),
        p(
          "PSPC also shares federal procurement tools with provincial and territorial governments, and with municipalities, academic institutions, schools and hospitals, through the Canadian Collaborative Procurement Initiative. Those buyers first sign an agreement with their province or territory or with PSPC, and they cannot negotiate the prices, terms or conditions.",
          "SPAC met aussi des outils d'approvisionnement fédéraux à la disposition des gouvernements provinciaux et territoriaux, ainsi que des municipalités, des établissements d'enseignement, des écoles et des hôpitaux, par l'Initiative canadienne d'approvisionnement collaboratif. Ces acheteurs signent d'abord une entente avec leur province ou territoire ou avec SPAC, et ne peuvent pas négocier les prix, les modalités ni les conditions.",
        ),
      ],
    },
    {
      id: "holders",
      title: both("Holders", "Titulaires"),
      blocks: [
        p(
          "A holder is a supplier that has been issued a standing offer or a supply arrangement. PSPC's weekly open data file identifies the businesses holding its active standing offers and supply arrangements. Award Watch reads one row of that file as one supplier on one instrument at one delivery point.",
          "Un titulaire est un fournisseur à qui une offre à commandes ou un arrangement a été délivré. Le fichier hebdomadaire de données ouvertes de SPAC désigne les entreprises titulaires de ses offres à commandes et arrangements actifs. Award Watch lit une ligne de ce fichier comme un fournisseur sur un instrument à un point de livraison.",
        ),
        p(
          "The government has no contractual obligation under a standing offer until it makes a call-up, or under a supply arrangement until it awards a contract. The holders of a supply arrangement compete for each requirement.",
          "Le gouvernement n'a aucune obligation contractuelle au titre d'une offre à commandes avant de passer une commande subséquente, ni au titre d'un arrangement avant d'attribuer un contrat. Les titulaires d'un arrangement se disputent chaque besoin.",
        ),
      ],
    },
    {
      id: "on-award-watch",
      title: both("Finding Them on Award Watch", "Les trouver sur Award Watch"),
      blocks: [
        p(
          "The {instruments} list shows every active instrument in PSPC's file, with its type, regions, UNSPSC codes, end user and expiry. The site reads each new weekly file, and the list filters by type, as in the lists of {sa} and of {nmso}.",
          "La liste des {instruments} présente chaque instrument actif du fichier de SPAC, avec son type, ses régions, ses codes UNSPSC, son utilisateur final et sa date d'expiration. Le site lit chaque nouveau fichier hebdomadaire, et la liste se filtre par type, comme les listes des {sa} et des {nmso}.",
          {
            instruments: a("/instruments", "standing offers and supply arrangements", "offres à commandes et arrangements"),
            sa: a("/instruments?type=SA", "supply arrangements", "arrangements en matière d'approvisionnement"),
            nmso: a("/instruments?type=NMSO", "national master standing offers", "offres à commandes principales et nationales"),
          },
        ),
        figure(
          "instrument-details", SAMPLE_INSTRUMENT, "section.panel:has(> dl.wide)",
          both(
            "The Details panel of a standing offer's page on Award Watch: its type, its description in English and in French, its commodity code, its end user, its start and expiry dates, its segment and the day it first appeared in PSPC's file.",
            "Le panneau Détails de la page d'une offre à commandes sur Award Watch : son type, sa description en anglais et en français, son code de marchandise, son utilisateur final, ses dates de début et d'expiration, son segment et le jour où elle a paru pour la première fois dans le fichier de SPAC.",
          ),
          both("The details of a standing offer on Award Watch.", "Les détails d'une offre à commandes sur Award Watch."),
          [
            mark(field("dl.wide", 1), "A national master standing offer is used by many departments or agencies throughout Canada.",
              "Une offre à commandes principale et nationale est utilisée par de nombreux ministères ou organismes partout au Canada."),
            mark(field("dl.wide", 4), "Its UNSPSC codes, from PSPC's weekly file.", "Ses codes UNSPSC, tirés du fichier hebdomadaire de SPAC."),
            mark(field("dl.wide", 5), "Each instrument sets its own users.", "Chaque instrument fixe ses propres utilisateurs."),
            mark(field("dl.wide", 7), "The day the instrument expires.", "La date d'expiration de l'instrument."),
          ],
        ),
        p(
          "An instrument's page lists its holders with their regions and links each to its profile where it has one. A profile lists the instruments its organization holds, as in {profile}. The notices that set new ones up are on the tender list by type: {rfso} and {rfsa}.",
          "La page d'un instrument présente ses titulaires avec leurs régions et lie chacun à son profil, s'il en a un. Un profil présente les instruments que détient son organisation, comme dans {profile}. Les avis qui en établissent de nouveaux se trouvent dans la liste des appels d'offres par type : {rfso} et {rfsa}.",
          {
            profile: a(`${EXAMPLE_PROFILE}#instruments`, "the profile of Calian Ltd", "le profil de Calian Ltd"),
            rfso: a("/tenders?type=Request%20for%20Standing%20Offer", "requests for standing offers", "demandes d'offres à commandes"),
            rfsa: a("/tenders?type=Request%20for%20Supply%20Arrangement", "requests for supply arrangements", "demandes d'arrangements"),
          },
        ),
        p(
          "Call-ups and contracts under these instruments are reported among the published contracts, where the Treasury Board's schema recommends that departments give the standing offer or supply arrangement number. An instrument's page counts as call-ups the published contracts that give its number in that field, so one reported without it is not counted there. {three} explains how those records differ from award notices.",
          "Les commandes subséquentes et les contrats découlant de ces instruments figurent parmi les contrats publiés, où le schéma du Conseil du Trésor recommande aux ministères d'indiquer le numéro de l'offre à commandes ou de l'arrangement. La page d'un instrument compte comme commandes subséquentes les contrats publiés qui donnent son numéro dans ce champ; un contrat déclaré sans ce numéro n'y est donc pas compté. {three} explique en quoi ces dossiers diffèrent des avis d'attribution.",
          { three: a("/guides/three-records-of-one-federal-contract", "Three Federal Records of One Contract", "Trois dossiers fédéraux d'un même contrat") },
        ),
        figure(
          "instrument-holders", SAMPLE_INSTRUMENT, "section.panel:has(#holders)",
          both(
            "The Holders panel of a standing offer's page on Award Watch: each holder with its regions, the call-ups counted against the offer and their value.",
            "Le panneau des titulaires de la page d'une offre à commandes sur Award Watch : chaque titulaire avec ses régions, les commandes subséquentes comptées pour l'offre et leur valeur.",
          ),
          both("The holders of a standing offer on Award Watch.", "Les titulaires d'une offre à commandes sur Award Watch."),
          [
            mark("tbody tr:first-child td:first-child a", "An instrument's page links each holder to its profile where it has one.",
              "La page d'un instrument lie chaque titulaire à son profil, s'il en a un."),
            mark("tbody tr:first-child td:nth-child(2)", "Each holder is listed with its regions.", "Chaque titulaire est présenté avec ses régions."),
            mark("tbody tr:nth-child(3) td:nth-child(4)",
              "An instrument's page counts as call-ups the published contracts that give its number, so one reported without it is not counted there.",
              "La page d'un instrument compte comme commandes subséquentes les contrats publiés qui donnent son numéro; un contrat déclaré sans ce numéro n'y est donc pas compté."),
          ],
        ),
      ],
    },
  ],
  sources: [
    SRC.sosaPage, SRC.methodOfSupply, SRC.manageSosa, SRC.seminar, SRC.tradeNotices, SRC.dictionary, SRC.ccpi, SRC.ccpiEligibility, SRC.sosaData,
    SRC.contractsSchema,
  ],
};

const THREE_RECORDS: Guide = {
  slug: "three-records-of-one-federal-contract",
  title: both("Three Federal Records of One Contract", "Trois dossiers fédéraux d'un même contrat"),
  summary: both(
    "The award notice, PSPC contract history and the published contract over $10,000: who publishes each, when, and why their values differ.",
    "L'avis d'attribution, l'historique des contrats de SPAC et le contrat publié de plus de 10 000 $ : qui les publie, quand, pourquoi leurs valeurs diffèrent.",
  ),
  checked: "2026-11-11",
  action: endingList(
    "To keep track of federal contracts as they come within 3 months of their end, save this list with your email address.",
    "Pour suivre les contrats fédéraux à mesure qu'ils arrivent à moins de 3 mois de leur fin, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "records",
      title: both("One Contract, Three Records", "Un contrat, trois dossiers"),
      blocks: [
        p(
          "A federal contract can be recorded three times in the government's open data: as an award notice on CanadaBuys, in PSPC's contract history when Public Services and Procurement Canada awarded it, and among the contracts over $10,000 that departments publish. Award Watch keeps the three apart. On a profile they are separate sections, as in the {awards}, {history} and {contracts} sections of the profile of Calian Ltd.",
          "Un contrat fédéral peut figurer trois fois dans les données ouvertes du gouvernement : comme avis d'attribution sur AchatsCanada, dans l'historique des contrats de SPAC quand Services publics et Approvisionnement Canada l'a attribué, et parmi les contrats de plus de 10 000 $ que publient les ministères. Award Watch garde les trois à part. Dans un profil, ce sont des sections distinctes, comme les sections {awards}, {history} et {contracts} du profil de Calian Ltd.",
          {
            awards: a(`${EXAMPLE_PROFILE}#awards`, "Award Notices", "Avis d'attribution"),
            history: a(`${EXAMPLE_PROFILE}#history`, "PSPC Contract History", "Historique des contrats de SPAC"),
            contracts: a(`${EXAMPLE_PROFILE}#contracts`, "Published Contracts", "Contrats publiés"),
          },
        ),
        {
          kind: "table",
          cols: [
            { kind: "source", label: both("Record", "Dossier") },
            { kind: "text", label: both("Published by", "Publié par") },
            { kind: "label", label: both("Updated", "Mise à jour") },
            { kind: "main", label: both("Value it carries", "Valeur indiquée") },
          ],
          rows: [
            [
              both("Award notice", "Avis d'attribution"),
              both("PSPC, in the CanadaBuys open data", "SPAC, dans les données ouvertes d'AchatsCanada"),
              both("Daily", "Chaque jour"),
              both("The contract amount, including taxes, and the total of the original and all amendments", "Le montant du contrat, taxes comprises, et le total de la version initiale et de toutes les modifications"),
            ],
            [
              both("PSPC contract history", "Historique des contrats de SPAC"),
              both("PSPC, for the contracts it awards on behalf of departments and agencies", "SPAC, pour les contrats qu'il attribue au nom des ministères et organismes"),
              both("Monthly", "Chaque mois"),
              both("The same two fields as the award notices", "Les deux mêmes champs que les avis d'attribution"),
            ],
            [
              both("Published contract", "Contrat publié"),
              both("Each department, under the Access to Information Act; consolidated by the Treasury Board Secretariat", "Chaque ministère, en vertu de la Loi sur l'accès à l'information; regroupé par le Secrétariat du Conseil du Trésor"),
              both("Quarterly", "Chaque trimestre"),
              both("One row per contract or amendment: its original value, amendment value and total contract value", "Une ligne par contrat ou modification : sa valeur initiale, la valeur de la modification et la valeur totale du contrat"),
            ],
          ],
        },
      ],
    },
    {
      id: "award-notice",
      title: both("The Award Notice", "L'avis d'attribution"),
      blocks: [
        p(
          "An award notice announces a contract award on CanadaBuys. PSPC publishes the federal ones in an open data file updated daily, covering departments, agencies and Crown corporations, and the file of notices since August 8, 2022 carries each notice's amendments. A notice names the supplier, the buyer, the procurement method and the dates. Its solicitation number connects it to the tender notice that came before.",
          "Un avis d'attribution annonce l'attribution d'un contrat sur AchatsCanada. SPAC publie les avis fédéraux dans un fichier de données ouvertes mis à jour chaque jour, qui couvre les ministères, les organismes et les sociétés d'État, et le fichier des avis depuis le 8 août 2022 contient les modifications de chaque avis. Un avis nomme le fournisseur, l'acheteur, la méthode d'approvisionnement et les dates. Son numéro d'invitation le relie à l'avis d'appel d'offres qui l'a précédé.",
        ),
        p(
          "It carries two values. CanadaBuys defines the contract amount as the value of the awarded contract including taxes, and the total contract value as the cumulative total of the original and all amendments. Notices from PSPC's Automated Buyer Environment are transferred to CanadaBuys once a month, so one may reach the data files up to a month after the award.",
          "Il porte deux valeurs. AchatsCanada définit le montant du contrat comme la valeur du contrat attribué, taxes comprises, et la valeur totale du contrat comme le total cumulé de la version initiale et de toutes les modifications. Les avis de l'Environnement automatisé de l'acheteur de SPAC sont transférés à AchatsCanada une fois par mois; un avis peut donc arriver dans les fichiers jusqu'à un mois après l'attribution.",
        ),
        figure(
          "award-value", SAMPLE_AWARD, ".panel-stack > section.panel:nth-of-type(2)",
          both(
            "The Contract Value panel of an award notice's page on Award Watch: the value counted, the total contract value and the contract amount.",
            "Le panneau Valeur du contrat de la page d'un avis d'attribution sur Award Watch : la valeur retenue, la valeur totale du contrat et le montant du contrat.",
          ),
          both("The values of an award notice on Award Watch.", "Les valeurs d'un avis d'attribution sur Award Watch."),
          [
            mark(field("dl", 1),
              "Award Watch counts a notice at the total value on its newest amendment when that is positive, else at the amount on its newest amendment.",
              "Award Watch compte un avis à la valeur totale de sa plus récente modification lorsqu'elle est positive, sinon au montant de sa plus récente modification."),
            mark(field("dl", 2), "The total contract value is the cumulative total of the original and all amendments.",
              "La valeur totale du contrat est le total cumulé de la version initiale et de toutes les modifications."),
            mark(field("dl", 3),
              "The contract amount, which CanadaBuys defines as the value of the awarded contract including taxes; on this sample it is the newest amendment's amount.",
              "Le montant du contrat, qu'AchatsCanada définit comme la valeur du contrat attribué, taxes comprises; dans cet exemple, c'est le montant de la plus récente modification."),
          ],
        ),
      ],
    },
    {
      id: "contract-history",
      title: both("PSPC Contract History", "Historique des contrats de SPAC"),
      blocks: [
        p(
          "PSPC's contract history lists the contracts PSPC awarded on behalf of federal departments and agencies. It has been published since January 2009, CanadaBuys has been its authoritative source since June 2023, and it is updated monthly. It is compiled from several procurement systems, so some fields are blank where a system does not provide them.",
          "L'historique des contrats de SPAC présente les contrats que SPAC a attribués au nom des ministères et organismes fédéraux. Il est publié depuis janvier 2009, AchatsCanada en est la source faisant autorité depuis juin 2023, et il est mis à jour chaque mois. Il est compilé à partir de plusieurs systèmes d'approvisionnement; certains champs restent donc vides lorsqu'un système ne les fournit pas.",
        ),
        p(
          "Its records carry the same two value fields as award notices, and name as end user the department the contract was put in place for. The contracting entity is always PSPC, so Award Watch files each record under that client department ({buyers}).",
          "Ses dossiers portent les deux mêmes champs de valeur que les avis d'attribution, et nomment comme utilisateur final le ministère pour lequel le contrat a été conclu. L'entité contractante est toujours SPAC; Award Watch classe donc chaque dossier sous ce ministère client ({buyers}).",
          { buyers: a(`${METHODOLOGY}#buyers`, "Methodology", "Méthodologie") },
        ),
        figure(
          "history-parties", SAMPLE_HISTORY, ".panel-stack",
          both(
            "The Supplier and Buyer, Contract Value and Key Dates panels of a PSPC contract history record's page on Award Watch: the supplier, PSPC as the contracting entity, the client department, the values and the dates.",
            "Les panneaux Fournisseur et acheteur, Valeur du contrat et Dates clés de la page d'un dossier de l'historique des contrats de SPAC sur Award Watch : le fournisseur, SPAC comme entité contractante, le ministère client, les valeurs et les dates.",
          ),
          both("A PSPC contract history record on Award Watch.", "Un dossier de l'historique des contrats de SPAC sur Award Watch."),
          [
            mark(field(":scope > section:nth-of-type(1) dl", 3), "The contracting entity is always PSPC.", "L'entité contractante est toujours SPAC."),
            mark(field(":scope > section:nth-of-type(1) dl", 4),
              "The department the contract was put in place for, which Award Watch files the record under.",
              "Le ministère pour lequel le contrat a été conclu, sous lequel Award Watch classe le dossier."),
            mark(`${field(":scope > section:nth-of-type(2) dl", 2)}, ${field(":scope > section:nth-of-type(2) dl", 3)}`,
              "The same two value fields as the award notices.", "Les deux mêmes champs de valeur que les avis d'attribution."),
          ],
        ),
      ],
    },
    {
      id: "published",
      title: both("The Published Contract Over $10,000", "Le contrat publié de plus de 10 000 $"),
      blocks: [
        p(
          "Section 86 of the Access to Information Act requires the head of each government entity to publish every contract over $10,000 the entity enters into in a quarter: the subject, the parties, the contract period, the value, the reference number, if any, and anything else Treasury Board policy requires. The deadline is 30 days after each of the first three quarters and 60 days after the fourth. A contract amended to more than $10,000, or whose value rises or falls by more than $10,000, is published again with its value as amended.",
          "L'article 86 de la Loi sur l'accès à l'information oblige le responsable de chaque entité gouvernementale à publier tout contrat de plus de 10 000 $ que l'entité conclut au cours d'un trimestre : l'objet, les parties, la période du contrat, la valeur, le numéro de référence, s'il y en a un, et tout autre renseignement que les politiques du Conseil du Trésor exigent. Le délai est de 30 jours après chacun des trois premiers trimestres et de 60 jours après le quatrième. Un contrat modifié pour dépasser 10 000 $, ou dont la valeur augmente ou diminue de plus de 10 000 $, est publié de nouveau avec sa valeur modifiée.",
        ),
        p(
          "The Treasury Board Secretariat consolidates the reports on open.canada.ca as unaudited data. Each row is a contract, an amendment or a standing offer or supply arrangement agreement, and an agreement is reported at $0. An amendment is its own row, even when the contract was entered into in the same quarter.",
          "Le Secrétariat du Conseil du Trésor regroupe les déclarations sur ouvert.canada.ca, sous forme de données non vérifiées. Chaque ligne est un contrat, une modification ou un accord d'offre à commandes ou d'arrangement, et un accord est déclaré à 0 $. Une modification forme sa propre ligne, même si le contrat a été conclu au cours du même trimestre.",
        ),
        p(
          "Its schema recommends values that include all applicable taxes. A row gives the original value at award, the amendment value for an amendment, and the total value of the contract and all its amendments. An option is left out of the original value and reported as an amendment once it is exercised. The schema recommends the contract number as the procurement identification number, and allows a commitment or requisition number instead.",
          "Son schéma recommande des valeurs qui comprennent toutes les taxes applicables. Une ligne donne la valeur initiale à l'attribution, la valeur de la modification pour une modification, et la valeur totale du contrat et de toutes ses modifications. Une option est exclue de la valeur initiale et déclarée comme modification lorsqu'elle est levée. Le schéma recommande le numéro du contrat comme numéro d'identification de l'approvisionnement, et permet à la place un numéro d'engagement ou de demande.",
        ),
        figure(
          "published-value", SAMPLE_PUBLISHED, ".panel-stack > section.panel:nth-of-type(2)",
          both(
            "The Contract Value panel of a published contract's page on Award Watch, for an amendment row: the contract value, the original value, the amendment value and the values counted.",
            "Le panneau Valeur du contrat de la page d'un contrat publié sur Award Watch, pour une ligne de modification : la valeur du contrat, la valeur initiale, la valeur de la modification et les valeurs retenues.",
          ),
          both("The values of a published contract's amendment row on Award Watch.", "Les valeurs de la ligne de modification d'un contrat publié sur Award Watch."),
          [
            mark(field("dl", 1), "The total value of the contract and all its amendments.", "La valeur totale du contrat et de toutes ses modifications."),
            mark(field("dl", 2), "The original value at award.", "La valeur initiale à l'attribution."),
            mark(field("dl", 3), "The amendment value, for an amendment.", "La valeur de la modification, pour une modification."),
            mark(field("dl", 4),
              "A published contract row counts at its own value: the amendment value for an amendment, else the original value, else the contract value.",
              "Une ligne de contrat publié compte à sa valeur propre : la valeur de la modification pour une modification, sinon la valeur initiale, sinon la valeur du contrat."),
          ],
        ),
      ],
    },
    {
      id: "values",
      title: both("Why the Values Differ", "Pourquoi les valeurs diffèrent"),
      blocks: [
        p(
          "The definitions above give the reasons two records of one contract can show different figures:",
          "Les définitions ci-dessus expliquent pourquoi deux dossiers d'un même contrat peuvent afficher des chiffres différents :",
        ),
        {
          kind: "list",
          items: [
            tx(
              "Each record is updated on its own schedule, daily, monthly or quarterly, so one may already carry an amendment the others do not show yet.",
              "Chaque dossier est mis à jour selon son propre calendrier, chaque jour, chaque mois ou chaque trimestre; l'un peut donc déjà porter une modification que les autres n'affichent pas encore.",
            ),
            tx(
              "Award notices and contract history carry a running total, while the published contracts report each amendment as a row of its own.",
              "Les avis d'attribution et l'historique portent un total cumulé, alors que les contrats publiés déclarent chaque modification comme une ligne distincte.",
            ),
            tx(
              "The published contracts leave an option out until it is exercised.",
              "Les contrats publiés excluent une option tant qu'elle n'est pas levée.",
            ),
            tx(
              "A published total is recommended to be the commitment recorded in the department's financial system, and CanadaBuys records the value of the awarded contract.",
              "Il est recommandé qu'un total publié soit l'engagement inscrit dans le système financier du ministère, alors qu'AchatsCanada inscrit la valeur du contrat attribué.",
            ),
            tx(
              "A standing offer or supply arrangement is reported at $0 among the published contracts, and its call-ups and contracts carry the value.",
              "Une offre à commandes ou un arrangement est déclaré à 0 $ parmi les contrats publiés, et ses commandes subséquentes et contrats en portent la valeur.",
            ),
            tx(
              "A CanadaBuys record states its currency, and a blank means Canadian dollars. Award Watch leaves any other currency out of its totals.",
              "Un dossier d'AchatsCanada précise sa devise, et un champ vide signifie des dollars canadiens. Award Watch exclut de ses totaux toute autre devise.",
            ),
          ],
        },
      ],
    },
    {
      id: "counting",
      title: both("Why They Are Never Added Together", "Pourquoi elles ne s'additionnent jamais"),
      blocks: [
        p(
          "The three records can describe the same contract, so a sum across them counts it two or three times. Award Watch never adds one source to another. Each source is totalled by its own rule and shown in its own column ({counting}).",
          "Les trois dossiers peuvent décrire le même contrat; une somme de l'un à l'autre le compterait donc deux ou trois fois. Award Watch n'additionne jamais une source à une autre. Chaque source est totalisée selon sa propre règle et présentée dans sa propre colonne ({counting}).",
          { counting: a(`${METHODOLOGY}#counting`, "Methodology", "Méthodologie") },
        ),
        p(
          "An award notice or a contract history record counts once per reference number, at the total value on its newest amendment when that is positive, else the amount on its newest amendment; a cancelled notice counts zero. A published contract row counts at its own value: the amendment value for an amendment, else the original value, else the contract value. These totals add up contract values. Of the sources the site reads, only the Public Accounts of Canada report amounts paid; the site shows them apart, by fiscal year, and never adds them to these totals.",
          "Un avis d'attribution ou un dossier de l'historique compte une fois par numéro de référence, à la valeur totale de sa plus récente modification lorsqu'elle est positive, sinon au montant de sa plus récente modification; un avis annulé compte pour zéro. Une ligne de contrat publié compte à sa valeur propre : la valeur de la modification pour une modification, sinon la valeur initiale, sinon la valeur du contrat. Ces totaux additionnent des valeurs de contrats. Parmi les sources que lit le site, seuls les Comptes publics du Canada déclarent des montants versés; le site les présente à part, par exercice, et ne les ajoute jamais à ces totaux.",
        ),
        p(
          "The list of {expiring} shows each contract once across the three. It keeps the award notice first, then contract history, then the published contract, and drops a later record that matches a kept one ({rules}). The {data} page lists each source file and when the site last read it.",
          "La liste des {expiring} présente chaque contrat une seule fois entre les trois. Elle retient d'abord l'avis d'attribution, puis l'historique, puis le contrat publié, et écarte un dossier subséquent qui correspond à un dossier retenu ({rules}). La page {data} présente chaque fichier source et sa dernière lecture.",
          {
            expiring: a("/expiring", "contracts ending soon", "contrats prenant fin bientôt"),
            rules: a(`${METHODOLOGY}#expiring`, "Methodology", "Méthodologie"),
            data: a("/data#sources", "Data", "Données"),
          },
        ),
      ],
    },
  ],
  sources: [SRC.awardData, SRC.historyData, SRC.dictionary, SRC.support, SRC.atia, SRC.contractsData, SRC.contractsSchema],
};

const ACAN: Guide = {
  slug: ACAN_PATH.slice("/guides/".length),
  title: both(
    "Advance Contract Award Notices (ACANs) and Statements of Capabilities",
    "Préavis d'adjudication de contrat (PAC) et énoncés de capacités",
  ),
  seoTitle: both("Advance Contract Award Notice (ACAN)", "Préavis d'adjudication de contrat (PAC)"),
  summary: both(
    "What a federal advance contract award notice is, when one may be posted, how long it runs, who may submit a statement of capabilities and what follows.",
    "Ce qu'est un préavis d'adjudication de contrat fédéral, quand il peut être publié, sa durée, qui peut présenter un énoncé de capacités et ce qui suit.",
  ),
  checked: "2026-11-11",
  action: tenderList(
    "To keep track of new advance contract award notices, save this list with your email address.",
    "Pour suivre les nouveaux préavis d'adjudication de contrat, enregistrez cette liste avec votre adresse courriel.",
    "Advance Contract Award Notice",
  ),
  sections: [
    {
      id: "acan",
      title: both("What an ACAN Is", "Ce qu'est un PAC"),
      blocks: [
        p(
          "An advance contract award notice (ACAN) is a public notice that a department intends to award a contract for goods, services or construction to a business it has already identified. The department believes that business is the only one able to do the work. The notice lets other businesses show, in a statement of capabilities, that they can meet the requirements. If no valid statement is submitted, the contract may be awarded to the business the notice names.",
          "Un préavis d'adjudication de contrat (PAC) est un avis public qui annonce l'intention d'un ministère d'attribuer un contrat de biens, de services ou de travaux de construction à une entreprise déjà désignée. Le ministère juge que cette entreprise est la seule capable d'exécuter les travaux. L'avis permet à d'autres entreprises de démontrer, dans un énoncé de capacités, qu'elles peuvent satisfaire aux exigences. Si aucun énoncé valable n'est présenté, le contrat peut être attribué à l'entreprise que nomme l'avis.",
        ),
        p(
          "An ACAN must be published on the Government Electronic Tendering Service (GETS). Award Watch lists the {open} among the tender notices it reads from CanadaBuys, each linked to its page there.",
          "Un PAC doit être publié dans le Service électronique d'appels d'offres du gouvernement (SEAOG). Award Watch présente les {open} parmi les avis d'appel d'offres qu'il tire d'AchatsCanada, chacun lié à sa page sur AchatsCanada.",
          { open: a("/tenders?type=Advance%20Contract%20Award%20Notice", "open advance contract award notices", "préavis d'adjudication de contrat ouverts") },
        ),
      ],
    },
    {
      id: "when",
      title: both("When a Department May Use One", "Quand un ministère peut y recourir"),
      blocks: [
        p(
          "The Government Contracts Regulations require a contracting authority to solicit bids before it enters into a contract (section 5). Section 6 allows a contract without soliciting bids in four cases, which the {limits} gives in the Regulations' words:",
          "Le Règlement sur les marchés de l'État oblige l'autorité contractante à lancer un appel d'offres avant de conclure un marché (article 5). L'article 6 permet de conclure un marché sans appel d'offres dans quatre cas, que le {limits} donne dans les termes du Règlement :",
          { limits: a(LIMITS_PATH, "guide on contracts awarded without competition", "guide sur les marchés conclus sans appel d'offres") },
        ),
        {
          kind: "list",
          items: [
            tx(
              "a pressing emergency in which delay would be injurious to the public interest",
              "une extrême urgence où un retard serait préjudiciable à l'intérêt public",
            ),
            tx(
              "an estimated expenditure of no more than $25,000 for a goods contract, $100,000 for certain architectural, engineering and other services, or $40,000 for any other contract",
              "une dépense estimative d'au plus 25 000 $ pour un marché de fournitures, 100 000 $ pour certains services d'ingénieurs, d'architectes ou d'autres services, ou 40 000 $ pour tout autre marché",
            ),
            tx(
              "a contract whose nature means soliciting bids would not be in the public interest",
              "un marché dont la nature est telle qu'un appel d'offres ne servirait pas l'intérêt public",
            ),
            tx("only one person capable of performing the contract", "un marché qui ne peut être exécuté que par une seule personne"),
          ],
        },
        p(
          "PSPC's Buyer's Portal, which holds its Buyer's Guide, has been the official source of information for its Acquisitions Program since January 30, 2026. The guide allows an ACAN only where a section 6 exception justifies not soliciting offers and, where a trade agreement applies, one of its limited tendering reasons does too. The requirement must be defined well enough for industry to understand it. The department must be able to accept a statement of capabilities from another business, and an ACAN must not be used to bypass bidding when more than one capable supplier clearly exists.",
          "Le Portail de l'acheteur de SPAC, qui contient son Guide de l'acheteur, est la source d'information officielle de son Programme des approvisionnements depuis le 30 janvier 2026. Le guide ne permet un PAC que lorsqu'une exception de l'article 6 justifie de ne pas solliciter d'offres et, si un accord commercial s'applique, que l'une des raisons justifiant le recours à l'appel d'offres limité qu'il prévoit le justifie aussi. Le besoin doit être assez défini pour que l'industrie le comprenne. Le ministère doit pouvoir accepter un énoncé de capacités d'une autre entreprise, et un PAC ne doit pas servir à se soustraire aux appels d'offres lorsqu'il est clair que plus d'une entreprise peut exécuter les travaux.",
        ),
        p(
          "Where no other business could submit a statement, or the department cannot accept one for program or policy reasons, the guide says the contract should be awarded on a non-competitive basis and made public through a contract award notice. Its examples of cases without an ACAN include confirming orders, works of art and extreme urgency caused by events the entity did not foresee.",
          "Lorsqu'aucune autre entreprise ne pourrait présenter d'énoncé, ou que le ministère ne peut pas en accepter pour des motifs liés aux programmes ou aux politiques, le guide prévoit que le contrat soit attribué de manière non concurrentielle et rendu public par un avis d'adjudication de contrat. Parmi ses exemples de cas sans PAC figurent les commandes de confirmation, les œuvres d'art et l'extrême urgence due à des événements que l'entité ne pouvait pas prévoir.",
        ),
      ],
    },
    {
      id: "posting",
      title: both("How Long It Is Posted", "Durée d'affichage"),
      blocks: [
        p(
          "An ACAN is first posted on GETS for at least 15 calendar days, and the buyer may extend the period for a complex procurement. New information or a significant clarification goes to every interested party, which can mean an amended ACAN with a later closing date, or a new ACAN.",
          "Un PAC est d'abord affiché dans le SEAOG pendant au moins 15 jours civils, et l'acheteur peut prolonger cette période pour un approvisionnement complexe. Tout nouveau renseignement ou toute précision importante est communiqué à toutes les parties intéressées, ce qui peut donner lieu à un PAC modifié dont la date de clôture est reportée, ou à un nouveau PAC.",
        ),
        p(
          "The buyer may negotiate with the named business during the posting period. That business should not start work or incur costs before the contract is awarded.",
          "L'acheteur peut négocier avec l'entreprise désignée pendant la période d'affichage. Cette entreprise ne devrait ni commencer les travaux ni engager de coûts avant l'attribution du contrat.",
        ),
        figure(
          "acan-dates", SAMPLE_ACAN, ".panel-grid",
          both(
            "The Key Dates and Buyer panels of an advance contract award notice's page on Award Watch: the publication, closing and amendment dates, the expected contract dates, the buyer and the solicitation number.",
            "Les panneaux Dates clés et Acheteur de la page d'un préavis d'adjudication de contrat sur Award Watch : les dates de publication, de clôture et de modification, les dates prévues du contrat, l'acheteur et le numéro d'invitation.",
          ),
          both("The dates of an advance contract award notice on Award Watch.", "Les dates d'un préavis d'adjudication de contrat sur Award Watch."),
          [
            mark(field(":scope > .panel:first-child dl", 1), "An ACAN is first posted for at least 15 calendar days.",
              "Un PAC est d'abord affiché pendant au moins 15 jours civils."),
            mark(field(":scope > .panel:first-child dl", 2), "The buyer may extend the posting period for a complex procurement.",
              "L'acheteur peut prolonger la période d'affichage pour un approvisionnement complexe."),
            mark(field(":scope > .panel:first-child dl", 3),
              "New information or a significant clarification can mean an amended ACAN with a later closing date.",
              "Un nouveau renseignement ou une précision importante peut donner lieu à un PAC modifié dont la date de clôture est reportée."),
          ],
        ),
      ],
    },
    {
      id: "capabilities",
      title: both("Statements of Capabilities", "Énoncés de capacités"),
      blocks: [
        p(
          "A statement of capabilities sets out how a business meets the requirements and evaluation criteria in an ACAN. It must be complete, in writing and submitted within the time the ACAN states. A statement received late, before the contract is awarded, may occasionally be considered after consultation with management and legal services.",
          "Un énoncé de capacités expose comment une entreprise satisfait aux exigences et aux critères d'évaluation d'un PAC. Il doit être complet, présenté par écrit et dans le délai que fixe le PAC. Un énoncé reçu en retard, avant l'attribution du contrat, peut à l'occasion être pris en compte après consultation de la direction et des services juridiques.",
        ),
        p(
          "Businesses other than the one named may submit one. When the procurement is set aside under the {psib}, only Indigenous businesses as the strategy defines them may challenge the proposed strategy to award the contract to the named Indigenous business, and only their statements are evaluated.",
          "Les entreprises autres que celle désignée peuvent en présenter un. Lorsque le marché est réservé dans le cadre de la {psib}, seules les entreprises autochtones au sens de la stratégie peuvent contester la stratégie d'achat proposée pour attribuer le contrat à l'entreprise autochtone désignée, et seuls leurs énoncés sont évalués.",
          { psib: a(PSIB_PATH, "Procurement Strategy for Indigenous Business", "Stratégie d'approvisionnement auprès des entreprises autochtones") },
        ),
      ],
    },
    {
      id: "after",
      title: both("After a Statement Is Submitted", "Après la présentation d'un énoncé"),
      blocks: [
        p(
          "The buyer reviews every statement received on time against the criteria in the ACAN, applying the same standards to the named business, and may ask a business for more information to confirm its capability. Then:",
          "L'acheteur examine chaque énoncé reçu dans les délais selon les critères du PAC, en appliquant les mêmes normes à l'entreprise désignée, et peut demander à une entreprise des renseignements supplémentaires pour confirmer sa capacité. Ensuite :",
        ),
        {
          kind: "list",
          items: [
            tx(
              "If a statement sufficiently meets the requirements, the buyer informs that business that a competitive process will follow.",
              "Si un énoncé satisfait suffisamment aux exigences, l'acheteur informe l'entreprise qu'un processus concurrentiel suivra.",
            ),
            tx(
              "A rejected statement is reviewed by an authority at least one level above the approval authority, and the business is told in writing why it was rejected.",
              "Un énoncé rejeté est examiné par une autorité d'au moins un échelon au-dessus du pouvoir d'approbation, et l'entreprise est informée par écrit des motifs du rejet.",
            ),
            tx(
              "If the requirement is cancelled, the buyer promptly informs every business that submitted a statement.",
              "Si le besoin est annulé, l'acheteur en informe rapidement chaque entreprise qui a présenté un énoncé.",
            ),
          ],
        },
      ],
    },
    {
      id: "compare",
      title: both("ACAN, Non-Competitive Contract and Competitive Solicitation", "PAC, contrat non concurrentiel et appel d'offres concurrentiel"),
      blocks: [
        p(
          "The three routes differ before the award and in the records:",
          "Les trois façons de procéder diffèrent avant l'attribution et dans les dossiers :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Route", "Façon de procéder") },
            { kind: "main", label: both("Before the award", "Avant l'attribution") },
            { kind: "label", label: both("Method on the award notice", "Méthode dans l'avis d'attribution") },
            { kind: "label", label: both("Code on the published contract", "Code du contrat publié") },
          ],
          rows: [
            [
              both("Competitive solicitation", "Appel d'offres concurrentiel"),
              both(
                "Bids are solicited through GETS, from a source list, or by another medium such as email",
                "Des soumissions sont demandées par le SEAOG, à partir d'une liste de fournisseurs ou par un autre moyen, comme le courriel",
              ),
              both("Competitive: open bidding, selective, traditional or limited tendering", "Concurrentielle : invitation ouverte, sélective, traditionnelle ou appel d'offres limité"),
              both("OB, ST or TC", "OB, ST ou TC"),
            ],
            [
              both("Advance contract award notice", "Préavis d'adjudication de contrat"),
              both(
                "An ACAN names the intended supplier and is posted for at least 15 calendar days",
                "Un PAC nomme le fournisseur prévu et est affiché pendant au moins 15 jours civils",
              ),
              both("Advance contract award notice", "Préavis d'attribution du contrat"),
              both("AC", "AC"),
            ],
            [
              both("Non-competitive contract", "Contrat non concurrentiel"),
              both("No bids are solicited", "Aucune soumission n'est demandée"),
              both("Non-competitive", "Non concurrentielle"),
              both("TN", "TN"),
            ],
          ],
        },
        p(
          "PSPC's Buyer's Guide states that an ACAN, even one run according to policy, is not a competitive process for the trade agreements or for a challenge before the Canadian International Trade Tribunal. For contract approval authorities only, a contract awarded after an ACAN that drew no valid statement within the notice period is deemed competitive.",
          "Le Guide de l'acheteur de SPAC précise qu'un PAC, même mené conformément à la politique, ne constitue pas un processus concurrentiel en vertu des accords commerciaux ni aux fins d'une contestation devant le Tribunal canadien du commerce extérieur. Pour les seuls pouvoirs d'approbation des contrats, un contrat attribué à la suite d'un PAC qui n'a reçu aucun énoncé valable pendant la période d'avis est considéré comme concurrentiel.",
        ),
        p(
          "Award Watch reads the source's own field and counts an ACAN among the non-competitive records ({competitive}).",
          "Award Watch lit le champ de la source et compte un PAC parmi les dossiers non concurrentiels ({competitive}).",
          { competitive: a(`${METHODOLOGY}#competitive`, "Methodology", "Méthodologie") },
        ),
      ],
    },
    {
      id: "records",
      title: both("How Each Is Recorded", "Comment chacun est consigné"),
      blocks: [
        p(
          "On CanadaBuys, an ACAN is a tender notice of the type Advance Contract Award Notice, one of the nine notice types in the data dictionary. The dictionary also lists Advance contract award notice among the procurement methods an award notice can give, beside the competitive methods and Non-competitive.",
          "Sur AchatsCanada, un PAC est un avis d'appel d'offres du type Préavis d'attribution du contrat, l'un des neuf types d'avis du dictionnaire de données. Le dictionnaire range aussi Préavis d'attribution du contrat parmi les méthodes d'approvisionnement qu'un avis d'attribution peut indiquer, à côté des méthodes concurrentielles et de la méthode Non concurrentielle.",
        ),
        p(
          "Among the published contracts over $10,000, the Treasury Board's schema gives the solicitation procedure AC to a contract awarded to a supplier identified under an ACAN process, where no other statement of capabilities could meet the government's requirements. For such a contract it recommends reporting one bid and the section 6 exception relied on. A contract awarded without soliciting bids is TN, and the competitive procedures are OB, TC and ST.",
          "Parmi les contrats publiés de plus de 10 000 $, le schéma du Conseil du Trésor attribue la méthode d'invitation à soumissionner AC à un contrat attribué à un fournisseur désigné dans le cadre d'un processus de PAC, lorsqu'aucun autre énoncé de capacités ne répondait aux exigences du gouvernement. Pour un tel contrat, il recommande de déclarer une soumission et l'exception de l'article 6 invoquée. Un contrat attribué sans appel d'offres porte le code TN, et les méthodes concurrentielles sont OB, TC et ST.",
        ),
        figure(
          "acan-published", SAMPLE_PUBLISHED_ACAN, ".panel-grid > section.panel",
          both(
            "The Procurement panel of a published contract's page on Award Watch, for a contract awarded after an ACAN: the solicitation procedure AC, the competition, the instrument type, the commodity type, the number of bids and the procurement number.",
            "Le panneau Approvisionnement de la page d'un contrat publié sur Award Watch, pour un contrat attribué à la suite d'un PAC : le mode d'invitation AC, la mise en concurrence, le type d'instrument, le type de marchandise, le nombre de soumissions et le numéro d'approvisionnement.",
          ),
          both("A published contract awarded after an ACAN, on Award Watch.", "Un contrat publié attribué à la suite d'un PAC, sur Award Watch."),
          [
            mark(field(":scope > dl", 1), "The schema gives the solicitation procedure AC to a contract awarded to a supplier identified under an ACAN process.",
              "Le schéma attribue la méthode d'invitation à soumissionner AC à un contrat attribué à un fournisseur désigné dans le cadre d'un processus de PAC."),
            mark(field(":scope > dl", 2), "Award Watch counts an ACAN among the non-competitive records.", "Award Watch compte un PAC parmi les dossiers non concurrentiels."),
            mark(field(":scope > dl", 5), "For such a contract, the schema recommends reporting one bid.",
              "Pour un tel contrat, le schéma recommande de déclarer une soumission."),
          ],
        ),
        p(
          "{three} explains how award notices and published contracts differ.",
          "{three} explique en quoi les avis d'attribution et les contrats publiés diffèrent.",
          { three: a(THREE_PATH, "Three Federal Records of One Contract", "Trois dossiers fédéraux d'un même contrat") },
        ),
      ],
    },
  ],
  sources: [SRC.gcr, SRC.acan, SRC.psibNotices, SRC.dictionary, SRC.contractsSchema],
};

const LIMITS: Guide = {
  slug: LIMITS_PATH.slice("/guides/".length),
  title: both(
    "Federal Contracts Awarded Without Competition, and the Contracting Limits",
    "Marchés fédéraux conclus sans appel d'offres et limites contractuelles",
  ),
  seoTitle: both("Non-Competitive Federal Contracts and Limits", "Marchés sans appel d'offres et limites"),
  summary: both(
    "The four exceptions to soliciting bids in section 6 of the Government Contracts Regulations, how the records show them, and the contracting limits.",
    "Les quatre exceptions à l'appel d'offres de l'article 6 du Règlement sur les marchés de l'État, leur trace dans les dossiers et les limites contractuelles.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To follow new advance contract award notices as they are posted, save this list with your email address.",
    "Pour suivre les nouveaux préavis d'adjudication de contrat à mesure qu'ils sont publiés, enregistrez cette liste avec votre adresse courriel.",
    "Advance Contract Award Notice",
  ),
  sections: [
    {
      id: "exceptions",
      title: both("The Four Exceptions to Soliciting Bids", "Les quatre exceptions à l'appel d'offres"),
      blocks: [
        p(
          "Under section 5 of the Government Contracts Regulations, before any contract is entered into, the contracting authority shall solicit bids, by giving public notice of a call for bids, in a manner consistent with generally accepted trade practices, or by inviting bids from suppliers on the suppliers' list (section 7). Notwithstanding section 5, section 6 lets a contracting authority enter into a contract without soliciting bids in four cases. The Regulations are current to October 19, 2026, and were last amended on December 16, 2024.",
          "Selon l'article 5 du Règlement sur les marchés de l'État, avant la conclusion d'un marché, l'autorité contractante doit lancer un appel d'offres, soit en donnant un avis public à cet effet conformément aux pratiques commerciales généralement reconnues, soit en s'adressant aux fournisseurs dont le nom figure sur la liste de fournisseurs (article 7). Malgré l'article 5, l'article 6 permet à l'autorité contractante de conclure un marché sans lancer d'appel d'offres dans quatre cas. Le Règlement est à jour au 19 octobre 2026, et sa dernière modification date du 16 décembre 2024.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Paragraph", "Alinéa") },
            { kind: "main", label: both("The Regulations' words", "Les termes du Règlement") },
            { kind: "main", label: both("Code in the published contracts' section 6 field", "Code du champ de l'article 6 des contrats publiés") },
          ],
          rows: [
            [
              both("(a)", "a)"),
              both(
                "the need is one of pressing emergency in which delay would be injurious to the public interest",
                "les cas d'extrême urgence où un retard serait préjudiciable à l'intérêt public",
              ),
              both(
                "1: Pressing emergency in which delay would be injurious to the public interest",
                "1 : Extrême urgence où un retard serait préjudiciable à l'intérêt public",
              ),
            ],
            [
              both("(b)", "b)"),
              both(
                "the estimated expenditure does not exceed (i) in the case of a goods contract, $25,000, (ii) in the case of a contract to be entered into by the Minister for International Development for the acquisition of architectural, engineering or other services required in respect of the planning, design, preparation or supervision of an international development assistance program or project, $100,000, (iii) in the case of a contract for the acquisition of architectural, engineering or other services required in respect of the planning, design, preparation or supervision of the construction, repair, renovation or restoration of a work, $100,000, and (iv) in the case of any other contract to which these Regulations apply, $40,000",
                "les cas où le montant estimatif de la dépense ne dépasse pas selon le cas : (i) 25 000 $, s'il s'agit d'un marché de fournitures, (ii) 100 000 $, s'il s'agit d'un marché que doit conclure le ministre du Développement international et qui porte sur la prestation de services d'ingénieurs ou d'architectes ou d'autres services nécessaires à la planification, à la conception, à la préparation ou à la surveillance d'un programme ou projet d'aide au développement international, (iii) 100 000 $, s'il s'agit d'un marché portant sur la prestation de services d'ingénieurs ou d'architectes ou d'autres services nécessaires à la planification, à la conception, à la préparation ou à la surveillance de la construction, de la réparation, de la rénovation ou de la restauration d'un ouvrage, (iv) 40 000 $, s'il s'agit de tout autre marché visé par le présent règlement",
              ),
              both(
                "2: Does not exceed s.6 (b) Government Contracts Regulations prescribed dollar limits",
                "2 : N'excède pas la limite financière prescrite à l'alinéa 6 b) du Règlement sur les marchés de l'État",
              ),
            ],
            [
              both("(c)", "c)"),
              both(
                "the nature of the work to be contracted for is such that it would not be in the public interest to solicit bids",
                "les cas où la nature du marché est telle qu'un appel d'offres ne servirait pas l'intérêt public",
              ),
              both("3: Not in the public interest to solicit bids", "3 : Situation dans laquelle un appel d'offres ne servirait pas l'intérêt public"),
            ],
            [
              both("(d)", "d)"),
              both("only one person is capable of performing the contract", "les cas où le marché ne peut être exécuté que par une seule personne"),
              both("4: Only one person is capable of performing the contract", "4 : Une seule personne est en mesure d'exécuter le marché"),
            ],
          ],
        },
        p(
          "Limited tendering is one of the tendering approaches under the trade agreements. For procurements subject to them, PSPC's Buyer's Guide allows a contract without soliciting offers only if it aligns with one of the limited tendering reasons outlined in the applicable agreement; the {trade} explains them.",
          "L'appel d'offres limité est l'une des approches d'appel d'offres dans le cadre des accords commerciaux. Pour les approvisionnements qui y sont assujettis, le Guide de l'acheteur de SPAC ne permet d'attribuer un contrat sans solliciter d'offres que s'il correspond à l'une des justifications d'un appel d'offres limité décrites dans l'accord applicable; le {trade} les explique.",
          { trade: a(TRADE_PATH, "guide on trade agreements", "guide sur les accords commerciaux") },
        ),
      ],
    },
    {
      id: "justification",
      title: both("Justifying a Contract Without Bids", "Justifier un marché sans appel d'offres"),
      blocks: [
        p(
          "PSPC's Buyer's Guide says that when offers are not solicited, the buyer must ensure that the client thoroughly justifies the use of any exception to the competitive solicitation, citing the relevant exception under the Regulations. For procurements above $25,000 for goods and $40,000 for services and construction, greater diligence is required when invoking the exception where only one entity is capable of performing the work; the buyer must then answer the Treasury Board questions for sole source, with support from the client.",
          "Selon le Guide de l'acheteur de SPAC, lorsque les offres ne sont pas sollicitées, l'acheteur doit s'assurer que le client justifie pleinement l'utilisation de toute exception à une demande d'offres concurrentielle, en citant l'exception pertinente en vertu du Règlement. Pour les approvisionnements d'une valeur supérieure à 25 000 $ pour les biens et 40 000 $ pour les services et la construction, une plus grande diligence est requise lors de l'invocation de l'exception lorsqu'une seule entité est capable d'exécuter le travail; l'acheteur doit alors répondre aux questions du Conseil du Trésor relatives à un fournisseur unique, avec l'appui du client.",
        ),
        p(
          "The Treasury Board of Canada Secretariat's Contracting Policy Notice 2026-1, dated January 16, 2026, reminds departments of their obligations to ensure that decisions related to procurement, including decisions to use a non-competitive process, are fully justified and documented.",
          "L'Avis sur la Politique des marchés 2026-1 du Secrétariat du Conseil du Trésor du Canada, daté du 16 janvier 2026, rappelle aux ministères qu'ils doivent toujours s'assurer que leurs décisions relatives à l'approvisionnement, y compris les décisions d'avoir recours à un processus non concurrentiel, sont parfaitement justifiées et documentées.",
        ),
      ],
    },
    {
      id: "limits",
      title: both("Contracting Limits Without Treasury Board Approval", "Limites contractuelles sans approbation du Conseil du Trésor"),
      blocks: [
        p(
          "The Treasury Board's Directive on the Management of Procurement sets contracting limits in its Appendix A: Contracting Approvals. A contract or contractual arrangement may be entered into without the approval of the Treasury Board if the amount payable, including all applicable taxes, fees and amendments, does not exceed the stated limit in Canadian dollars for the contracting authority identified in the basic limits schedules. Contracting authorities are responsible for seeking Treasury Board approval prior to entering into or amending a contract when its estimated value, including taxes, expected amendments, and follow-on contract or contractual arrangement, exceeds the limits.",
          "La Directive sur la gestion de l'approvisionnement du Conseil du Trésor fixe des limites contractuelles à son annexe A, Approbations contractuelles. Il est possible de conclure un contrat ou une entente contractuelle sans l'approbation du Conseil du Trésor si le montant payable, qui inclut l'ensemble des taxes, des droits et des modifications applicables, ne dépasse pas la limite en dollars canadiens énoncée pour l'autorité contractante dans les annexes sur les limites de base. Les autorités contractantes ont la responsabilité de demander l'approbation du Conseil du Trésor avant de conclure ou de modifier un contrat lorsque sa valeur estimée, y compris les taxes, les modifications prévues et le contrat ou l'entente contractuelle subséquent, excède les limites.",
        ),
        p(
          "For the appendix, the term competitive includes the publishing of an advance contract award notice ({acan}). The schedules below are as read on the directive's page on November 14, 2026 (modified September 4, 2026). Notice 2026-1 says the directive was amended, effective December 15, 2025, to increase most contracting limits in Appendix A to reflect inflation; the {ending} explains contract amendments.",
          "Aux termes de l'annexe A, le terme « concurrentiel » comprend la publication d'un préavis d'adjudication de contrat ({acan}). Les annexes ci-dessous sont telles que lues sur la page de la directive le 14 novembre 2026 (modifiée le 4 septembre 2026). L'avis 2026-1 indique que, le 15 décembre 2025, la directive a été modifiée pour augmenter la plupart des limites contractuelles figurant à l'annexe A afin de tenir compte de l'inflation; le {ending} explique les modifications de contrats.",
          {
            acan: a(ACAN_PATH, "guide on ACANs", "guide sur les PAC"),
            ending: a(ENDING_PATH, "guide on contracts ending", "guide sur la fin des contrats"),
          },
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Schedule", "Annexe") },
            { kind: "main", label: both("Department", "Ministère ou organisme") },
            { kind: "value", label: both("Competitive", "Concurrentiel") },
            { kind: "value", label: both("Non-competitive", "Non concurrentiel") },
          ],
          rows: [
            [both("Schedule 1: Construction", "Annexe 1. Construction"), both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"), { money: 100_000_000 }, { money: 1_750_000 }],
            [both("Schedule 1: Construction", "Annexe 1. Construction"), both("All other departments", "Tous les autres ministères et organismes"), { money: 1_000_000 }, { money: 140_000 }],
            [both("Schedule 2: Goods", "Annexe 2. Biens"), both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"), { money: 90_000_000 }, { money: 4_500_000 }],
            [both("Schedule 2: Goods", "Annexe 2. Biens"), both("Shared Services Canada", "Services partagés Canada"), { money: 90_000_000 }, { money: 4_500_000 }],
            [both("Schedule 2: Goods", "Annexe 2. Biens"), both("National Defence", "Défense nationale"), { money: 9_000_000 }, { money: 450_000 }],
            [both("Schedule 2: Goods", "Annexe 2. Biens"), both("All other departments", "Tous les autres ministères et organismes"), { money: 900_000 }, { money: 120_000 }],
            [both("Schedule 3: Services", "Annexe 3. Services"), both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"), { money: 45_000_000 }, { money: 7_000_000 }],
            [both("Schedule 3: Services", "Annexe 3. Services"), both("Shared Services Canada", "Services partagés Canada"), { money: 45_000_000 }, { money: 7_000_000 }],
            [both("Schedule 3: Services", "Annexe 3. Services"), both("National Defence", "Défense nationale"), { money: 9_000_000 }, { money: 450_000 }],
            [both("Schedule 3: Services", "Annexe 3. Services"), both("Transport Canada", "Transports Canada"), { money: 9_000_000 }, { money: 300_000 }],
            [both("Schedule 3: Services", "Annexe 3. Services"), both("Fisheries and Oceans Canada", "Pêches et Océans Canada"), { money: 9_000_000 }, { money: 250_000 }],
            [both("Schedule 3: Services", "Annexe 3. Services"), both("All other departments", "Tous les autres ministères et organismes"), { money: 4_500_000 }, { money: 250_000 }],
            [
              both("Schedule 3A: Specialized services, architectural and engineering services", "Annexe 3A. Services spécialisés, services d'architectes et d'ingénieurs"),
              both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"), { money: 9_500_000 }, { money: 500_000 },
            ],
            [
              both("Schedule 3A: Specialized services, architectural and engineering services", "Annexe 3A. Services spécialisés, services d'architectes et d'ingénieurs"),
              both("All other departments", "Tous les autres ministères et organismes"), { money: 120_000 }, { money: 120_000 },
            ],
          ],
        },
        p(
          "Schedule 4 sets limits for contractual arrangements, all commodities: $27,500,000 for PSPC and $550,000 for all other departments. All references to PSPC in the appendix include the Defence Investment Agency, and thresholds for contracting in the Regulations and in trade agreements must be adhered to, where applicable.",
          "L'annexe 4 fixe des limites pour les ententes contractuelles, tous les produits : 27 500 000 $ pour SPAC et 550 000 $ pour tous les autres ministères et organismes. Toutes les références à SPAC dans l'annexe A comprennent l'Agence de l'investissement pour la défense, et les seuils d'octroi de contrats du Règlement et des accords commerciaux doivent être respectés, s'il y a lieu.",
        ),
      ],
    },
    {
      id: "authority",
      title: both("What a Department May Contract for Itself", "Ce qu'un ministère peut conclure lui-même"),
      blocks: [
        p(
          "The appendix says its contracting limits do not confer a legal authority to contract, and that contracting authority is subject to ministerial delegation and, except for delegations provided by common service providers, may not be delegated between ministers. Contracting Policy Notice 2026-2, dated February 20, 2026, says the Department of Public Works and Government Services Act was amended to provide the Minister responsible for PSPC with exclusive authority over services and construction procurements for the Government of Canada, effective June 9, 2025, in addition to the Minister's pre-existing exclusive authority for procurement of goods. The notice says the directive and the contracting limits outlined in it continue to apply.",
          "L'annexe précise que ses limites contractuelles ne confèrent pas de pouvoir légal de conclure ou de modifier un contrat ou une entente contractuelle, et que l'autorité contractante est assujettie à la délégation ministérielle et, à l'exception des délégations par les fournisseurs de services communs, ne peut pas être déléguée entre ministres. Selon l'Avis sur la Politique des marchés 2026-2, daté du 20 février 2026, la Loi sur le ministère des Travaux publics et des Services gouvernementaux a été modifiée afin de conférer au ministre responsable de SPAC le pouvoir exclusif concernant les approvisionnements en services et en construction pour le gouvernement du Canada, en vigueur depuis le 9 juin 2025, ce pouvoir s'ajoutant à son pouvoir exclusif préexistant en matière d'approvisionnement de biens. L'avis indique que la directive et les limites contractuelles qui y sont énoncées continuent de s'appliquer.",
        ),
      ],
    },
    {
      id: "exceptional",
      title: both("Exceptional and Emergency Limits", "Limites exceptionnelles et limites en cas d'urgence"),
      blocks: [
        p(
          "Under section A.2 of the appendix, Treasury Board approval is required when the Minister (or their delegated authority) enters into a contract (or contractual arrangement when stated) above the exceptional limit specified for a listed department, including all applicable taxes, fees and amendments, unless otherwise indicated. When an exceptional limit is different from the basic contracting limit for its corresponding schedule, the exceptional limit applies. Among those limits:",
          "Selon la section A.2 de l'annexe, l'approbation du Conseil du Trésor est requise lorsque le ministre (ou son pouvoir délégué) conclut un contrat (ou une entente contractuelle, lorsque mentionnée) supérieur à la limite exceptionnelle précisée pour un ministère énuméré, y compris toutes les taxes applicables, les frais et les modifications, à moins qu'il ne soit indiqué autrement. Lorsqu'une limite exceptionnelle est différente de la limite contractuelle de base pour son annexe correspondante, la limite exceptionnelle s'applique. Parmi ces limites :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Department", "Ministère ou organisme") },
            { kind: "main", label: both("Exceptional limit (section A.2)", "Limite exceptionnelle (section A.2)") },
          ],
          rows: [
            [
              both("Correctional Service Canada", "Service correctionnel Canada"),
              both(
                "Non-competitive contract for provision of educational and health care services for inmates, and for the provision of residential and non-residential after-care services to conditionally released offenders up to $1,000,000",
                "Contrat non concurrentiel pour la prestation de services éducatifs et de soins de santé pour les détenus, et pour la prestation de services après soins résidentiels et non résidentiels à des délinquants libérés sous conditions, jusqu'à concurrence de 1 000 000 $",
              ),
            ],
            [
              both("Indigenous Services Canada", "Services aux Autochtones Canada"),
              both(
                "Non-competitive contract for the delivery of health care services to Indigenous Peoples in Canada up to $4,000,000",
                "Contrat non concurrentiel de services pour la prestation de services de soins de santé aux peuples autochtones du Canada jusqu'à concurrence de 4 000 000 $",
              ),
            ],
            [
              both("Library and Archives Canada", "Bibliothèque et Archives Canada"),
              both(
                "Non-competitive goods contract for historical material, books and other publications up to $300,000",
                "Contrat non concurrentiel de biens pour des documents historiques, des livres et d'autres publications jusqu'à concurrence de 300 000 $",
              ),
            ],
            [
              both("National Defence", "Défense nationale"),
              both(
                "Non-competitive services contract for flying and glider training for air cadets up to $4,000,000",
                "Contrat non concurrentiel de services visant la formation au pilotage d'avion et de planeur pour les cadets de l'air jusqu'à concurrence de 4 000 000 $",
              ),
            ],
            [
              both("Public Services and Procurement Canada (including the Defence Investment Agency)", "Services publics et Approvisionnement Canada (incluant l'Agence de l'investissement pour la défense)"),
              both(
                "Services contract for repair and overhaul of military equipment up to $100,000,000",
                "Contrat de services pour les réparations et les réfections de matériel militaire jusqu'à concurrence de 100 000 000 $",
              ),
            ],
            [
              both("Public Services and Procurement Canada (including the Defence Investment Agency)", "Services publics et Approvisionnement Canada (incluant l'Agence de l'investissement pour la défense)"),
              both(
                "Goods or services contract for ammunition under the Munitions Supply Program up to $200,000,000",
                "Contrat de biens ou de services pour des munitions en vertu du Programme d'approvisionnement en munitions jusqu'à concurrence de 200 000 000 $",
              ),
            ],
            [
              both("Public Services and Procurement Canada (including the Defence Investment Agency)", "Services publics et Approvisionnement Canada (incluant l'Agence de l'investissement pour la défense)"),
              both(
                "Contract with the three selected shipyards for goods and services associated with large ships projects under the National Shipbuilding Strategy up to $155,000,000",
                "Contrat avec les trois chantiers navals portant sur les biens et les services liés à des projets de grands navires dans le cadre de la Stratégie nationale de construction navale jusqu'à concurrence de 155 000 000 $",
              ),
            ],
          ],
        },
        p(
          "Emergency contracting limits are supplementary to basic and exceptional limits. Section A.3 makes contracting authorities responsible for entering into or amending a contract or contractual arrangement in response to a pressing emergency where a delay in approval would be injurious to the public interest and when the expected value is up to $3,000,000, including applicable taxes and fees, provided that its five conditions are met. Treasury Board approval is sought above the limits it specifies for listed departments, among them $25,000,000 for a non-competitive contract by PSPC on behalf of any department, including PSPC.",
          "Les limites contractuelles d'urgence sont complémentaires aux limites de base et exceptionnelles. La section A.3 charge les autorités contractantes de conclure ou de modifier un contrat ou une entente contractuelle en réponse à une situation d'extrême urgence où un retard dans l'approbation serait préjudiciable à l'intérêt public et lorsque la valeur prévue est inférieure ou égale à 3 000 000 $, taxes et droits applicables compris, sous réserve de ses cinq conditions. L'approbation du Conseil du Trésor est demandée au-delà des limites qu'elle précise pour les ministères énumérés, dont 25 000 000 $ pour un contrat non concurrentiel conclu par SPAC au nom d'un ministère, dont SPAC.",
        ),
      ],
    },
    {
      id: "records",
      title: both("What the Records Show", "Ce que montrent les dossiers"),
      blocks: [
        p(
          "CanadaBuys' data dictionary, in its file last modified on March 24, 2026, lists nine procurement methods, Non-competitive among them, and defines the limited tendering reason as the reason for a given contract not being awarded through competitive solicitation, blank or None for records it doesn't apply to. Award Watch shows both on an award notice's page and counts Non-competitive and Advance contract award notice as non-competitive ({competitive}).",
          "Le dictionnaire de données d'AchatsCanada, dans son fichier modifié pour la dernière fois le 24 mars 2026, énumère neuf méthodes d'approvisionnement, dont Non concurrentielle, et définit le motif de l'appel d'offres limité comme la raison pour laquelle un contrat donné n'a pas été attribué par voie concurrentielle, vide ou Aucune pour les enregistrements auxquels il ne s'applique pas. Award Watch affiche l'un et l'autre sur la page d'un avis d'attribution et compte Non concurrentielle et Préavis d'adjudication de contrat comme non concurrentiels ({competitive}).",
          { competitive: a(`${METHODOLOGY}#competitive`, "Methodology", "Méthodologie") },
        ),
        p(
          "In the published contracts over $10,000, the Treasury Board's schema gives the solicitation procedure TN to a contract awarded to a supplier without soliciting bids, and recommends reporting one bid for a non-competitive contract; the field must read 1 for TN or AC. For a contract after January 1, 2022, with TC, TN or AC as its procedure and a trade agreement other than XX (None), a limited tendering reason other than 00 (none) must be entered. For its section 6 field, coded as in the table above, it is recommended that one of the exceptions be given if bids have not been solicited for the contract. A published contract's page on Award Watch shows the solicitation procedure, the limited tendering reason's code, the number of bids and, where the department reported one, the section 6 exception with the schema's name for it.",
          "Dans les contrats publiés de plus de 10 000 $, le schéma du Conseil du Trésor attribue la méthode d'invitation à soumissionner TN à un marché attribué à un fournisseur sans appel d'offres, et recommande de déclarer une soumission pour un marché non concurrentiel; le champ doit contenir 1 pour TN ou AC. Pour un marché conclu après le 1er janvier 2022 dont la méthode est TC, TN ou AC et dont l'accord commercial a une valeur autre que XX (Aucune), une raison justifiant le recours à l'appel d'offres limité autre que 00 (aucune) doit être inscrite. Pour son champ de l'article 6, codé comme dans le tableau ci-dessus, il est recommandé d'inscrire l'une des exceptions si aucun appel d'offres n'a été lancé à l'égard du marché. La page d'un contrat publié sur Award Watch affiche la méthode d'invitation, le code de la raison de l'appel d'offres limité, le nombre de soumissions et, lorsque le ministère en a déclaré une, l'exception de l'article 6 avec le nom que lui donne le schéma.",
        ),
        figure(
          "noncompetitive-published", SAMPLE_PUBLISHED_TN, ".panel-grid > section.panel",
          both(
            "The Procurement panel of a published contract's page on Award Watch, for a contract awarded without soliciting bids: the solicitation procedure TN, the competition, the instrument type, the commodity type, the trade agreements, the limited tendering reason, the number of bids and the procurement number.",
            "Le panneau Approvisionnement de la page d'un contrat publié sur Award Watch, pour un contrat attribué sans appel d'offres : le mode d'invitation TN, la mise en concurrence, le type d'instrument, le type de marchandise, les accords commerciaux, la raison de l'appel d'offres limité, le nombre de soumissions et le numéro d'approvisionnement.",
          ),
          both("A published contract awarded without soliciting bids, on Award Watch.", "Un contrat publié attribué sans appel d'offres, sur Award Watch."),
          [
            mark(field(":scope > dl", 1), "The schema gives the solicitation procedure TN to a contract awarded to a supplier without soliciting bids.",
              "Le schéma attribue la méthode d'invitation à soumissionner TN à un marché attribué à un fournisseur sans appel d'offres."),
            mark(field(":scope > dl", 5),
              "For a contract after January 1, 2022, with TN as its procedure and a trade agreement other than XX (None), a limited tendering reason other than 00 (none) must be entered.",
              "Pour un marché conclu après le 1er janvier 2022 dont la méthode est TN et dont l'accord commercial a une valeur autre que XX (Aucune), une raison autre que 00 (aucune) doit être inscrite."),
            mark(field(":scope > dl", 6), "Award Watch shows the limited tendering reason's code.",
              "Award Watch affiche le code de la raison de l'appel d'offres limité."),
            mark(field(":scope > dl", 7), "For a non-competitive contract, the schema recommends reporting one bid, and the field must read 1 for TN.",
              "Pour un marché non concurrentiel, le schéma recommande de déclarer une soumission, et le champ doit contenir 1 pour TN."),
          ],
        ),
        p(
          "This {example} from PSPC, awarded November 10, 2026, shows Directed Contract as its notice type, Non-competitive as its procurement method, Exclusive Rights as its limited tendering reason, a value of $103,467 and the Canadian Free Trade Agreement and the Canada-Korea Free Trade Agreement in its trade agreements line.",
          "Cet {example} de SPAC, attribué le 10 novembre 2026, indique Contrat prescrit comme type d'avis, Non concurrentielle comme méthode d'approvisionnement, Droits exclusifs comme motif de l'appel d'offres limité, une valeur de 103 467 $ et, dans sa ligne des accords commerciaux, l'Accord de libre-échange canadien et l'Accord de libre-échange Canada-Corée.",
          { example: a(EXAMPLE_LIMITS, "award notice", "avis d'attribution") },
        ),
      ],
    },
  ],
  sources: [
    SRC.gcr, SRC.sourcing, SRC.limitsNotice, SRC.policyNotices, SRC.procurementDirective, SRC.authorityNotice, SRC.dictionary,
    SRC.contractsSchema, SRC.exampleDirected,
  ],
};

const PSIB: Guide = {
  slug: PSIB_PATH.slice("/guides/".length),
  title: both(
    "Indigenous Business Set-Asides in Federal Procurement (PSIB)",
    "Marchés réservés aux entreprises autochtones dans les achats fédéraux (SAEA)",
  ),
  seoTitle: both("PSIB Set-Asides for Indigenous Business", "Marchés réservés aux entreprises autochtones"),
  summary: both(
    "The Procurement Strategy for Indigenous Business: its set-asides, who is eligible, the 5% target and how published contracts record set-asides.",
    "La Stratégie d'approvisionnement auprès des entreprises autochtones : marchés réservés, admissibilité, cible de 5 % et champs des contrats publiés.",
  ),
  checked: "2026-11-11",
  action: tenderList(
    "To keep track of new federal tender notices, set-asides among them, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux, marchés réservés compris, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "psib",
      title: both("What the PSIB Is", "Ce qu'est la SAEA"),
      blocks: [
        p(
          "The Procurement Strategy for Indigenous Business (PSIB) limits competition for some federal contracts to Indigenous businesses. Indigenous Services Canada (ISC) says the strategy has been in place since 1996 and has been updated many times. Bidding is limited under it through the Set-Aside Program for Indigenous Business.",
          "La Stratégie d'approvisionnement auprès des entreprises autochtones (SAEA) limite la concurrence pour certains marchés fédéraux aux entreprises autochtones. Selon Services aux Autochtones Canada (SAC), la stratégie existe depuis 1996 et a fait l'objet de nombreuses modifications. Les appels d'offres limités aux termes de la SAEA passent par le Programme des marchés réservés aux entreprises autochtones.",
        ),
        p(
          "Public Services and Procurement Canada's Buyer's Guide encourages all federal departments to set aside procurements for competition by Indigenous businesses, provided operational needs are fully met. The decision to set aside a procurement rests with the client department.",
          "Le Guide de l'acheteur de Services publics et Approvisionnement Canada encourage tous les ministères fédéraux à réserver des marchés à la concurrence entre entreprises autochtones, pourvu que les besoins opérationnels soient entièrement satisfaits. La décision de réserver un marché appartient au ministère client.",
        ),
      ],
    },
    {
      id: "set-asides",
      title: both("Mandatory, Voluntary and Conditional Set-Asides", "Marchés réservés obligatoires, facultatifs et conditionnels"),
      blocks: [
        p(
          "The Buyer's Guide describes two types of set-aside, mandatory and voluntary. A review the Office of the Procurement Ombud published in March 2026 describes a third, the conditional set-aside.",
          "Le Guide de l'acheteur décrit deux types de marchés réservés, obligatoires et facultatifs. Un examen publié en mars 2026 par le Bureau de l'ombud de l'approvisionnement en décrit un troisième, le marché réservé conditionnel.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Set-aside", "Marché réservé") },
            { kind: "main", label: both("When it is used", "Quand il s'applique") },
            { kind: "main", label: both("Who may bid", "Qui peut soumissionner") },
          ],
          rows: [
            [
              both("Mandatory", "Obligatoire"),
              both(
                "The primary recipients or end users are an Indigenous population and the value exceeds $5,000, provided operational needs, prudence, probity, best value and sound contract management can be assured",
                "Les principaux destinataires ou utilisateurs finaux sont une population autochtone et la valeur dépasse 5 000 $, à condition de répondre aux besoins opérationnels et d'assurer la prudence, la probité, le meilleur rapport qualité-prix et la saine gestion des contrats",
              ),
              both("Indigenous businesses only", "Les entreprises autochtones seulement"),
            ],
            [
              both("Voluntary", "Facultatif"),
              both(
                "The client department chooses to restrict the procurement to qualified Indigenous businesses",
                "Le ministère client choisit de restreindre l'approvisionnement aux entreprises autochtones qualifiées",
              ),
              both("Qualified Indigenous businesses only", "Les entreprises autochtones qualifiées seulement"),
            ],
            [
              both("Conditional", "Conditionnel"),
              both("Indigenous business capability cannot be determined", "Il n'est pas possible de déterminer la capacité des entreprises autochtones"),
              both(
                "Any business; if two or more Indigenous businesses submit compliant bids, the procurement is set aside and non-Indigenous suppliers become ineligible",
                "Toute entreprise; si deux entreprises autochtones ou plus présentent des soumissions conformes, le marché est réservé et les fournisseurs non autochtones deviennent inadmissibles",
              ),
            ],
          ],
        },
        p(
          "Under a voluntary set-aside, if no Indigenous business submits a responsive offer, or no contract is awarded, the solicitation must be reissued, either as a set-aside or open to all, depending on the trade agreements and thresholds that apply. Under a conditional set-aside, if fewer than two compliant bids from Indigenous businesses remain after evaluation, the bids from non-Indigenous businesses are considered.",
          "Dans un marché réservé facultatif, si aucune entreprise autochtone ne soumet d'offre recevable, ou si aucun contrat n'est attribué, la demande d'offres doit être lancée de nouveau, à titre de marché réservé ou ouvert à tous, selon les accords commerciaux et les seuils applicables. Dans un marché réservé conditionnel, s'il reste moins de deux soumissions conformes d'entreprises autochtones après l'évaluation, les soumissions des entreprises non autochtones sont prises en compte.",
        ),
        p(
          "A notice of proposed procurement or an ACAN for a set-aside must state that the procurement has been set aside under the PSIB. On an ACAN, only Indigenous businesses as the PSIB defines them may challenge the proposed strategy to award the contract to the named Indigenous business ({acan}).",
          "Un avis de projet de marché ou un PAC visant un marché réservé doit indiquer que le marché est réservé dans le cadre de la SAEA. Dans le cas d'un PAC, seules les entreprises autochtones au sens de la SAEA peuvent contester la stratégie d'achat proposée pour attribuer le contrat à l'entreprise autochtone désignée ({acan}).",
          { acan: a(ACAN_PATH, "advance contract award notices", "préavis d'adjudication de contrat") },
        ),
      ],
    },
    {
      id: "eligibility",
      title: both("Who Is Eligible", "Qui est admissible"),
      blocks: [
        p(
          "To be listed on the Indigenous Business Directory (IBD), a business must be at least 51% owned and controlled by Indigenous people. It can be a band as defined by the Indian Act, a sole proprietorship, a limited company, a co-operative, a partnership, a not-for-profit organization or a joint venture. The owners must be First Nations, Inuit or Métis and ordinarily resident in Canada, and must prove it with documents; self-identification is not accepted.",
          "Pour figurer au Répertoire des entreprises autochtones (REA), une entreprise doit être détenue et contrôlée à au moins 51 % par des Autochtones. Il peut s'agir d'une bande au sens de la Loi sur les Indiens, d'une entreprise à propriétaire unique, d'une société à responsabilité limitée, d'une coopérative, d'un partenariat, d'un organisme sans but lucratif ou d'une coentreprise. Les propriétaires doivent être des membres des Premières Nations, des Inuits ou des Métis et résider habituellement au Canada, et le prouver par des documents; l'autodéclaration n'est pas acceptée.",
        ),
        p(
          "To be considered for a contract set aside under the PSIB, a business must be listed on the IBD or on a modern treaty business list. Its offer certifies that it meets the PSIB's requirements and will keep meeting them for the life of the contract, and Canada may audit that certification before and after award. Where the offer involves subcontracting or a joint venture, the offeror also certifies that at least 33% of the value of the work will be performed by an Indigenous business.",
          "Pour être prise en considération pour un marché réservé dans le cadre de la SAEA, une entreprise doit être inscrite au REA ou sur une liste d'entreprises bénéficiaires d'un traité moderne. Son offre atteste qu'elle satisfait aux exigences de la SAEA et continuera d'y satisfaire pendant toute la durée du contrat, et le Canada peut soumettre cette attestation à un audit avant et après l'attribution. Lorsque l'offre prévoit de la sous-traitance ou une coentreprise, l'offrant atteste aussi qu'au moins 33 % de la valeur des travaux sera exécutée par une entreprise autochtone.",
        ),
      ],
    },
    {
      id: "directory",
      title: both("Where Eligible Businesses Are Listed", "Où figurent les entreprises admissibles"),
      blocks: [
        p(
          "The IBD is a public directory that all levels of government and the private sector can search. ISC uses it as its primary source to find Indigenous businesses available to fulfil federal contracts. A listing confirms that a business is eligible to be considered for contracts limited under the PSIB, and it guarantees no contract.",
          "Le REA est un répertoire public que tous les ordres de gouvernement et le secteur privé peuvent consulter. SAC s'en sert comme source principale pour trouver les entreprises autochtones en mesure d'exécuter des marchés fédéraux. Une inscription confirme qu'une entreprise est admissible à être prise en considération pour les marchés limités dans le cadre de la SAEA, et ne garantit aucun contrat.",
        ),
        p(
          "ISC checks listed businesses through compliance reviews about every two years and through audits, and removes those that no longer meet the criteria. Modern treaty holders keep their own business lists. The Government of Canada also recognizes the Manitoba Métis Federation's Red River Métis Business Directory for federal procurement opportunities, such as those under the PSIB.",
          "SAC vérifie les entreprises inscrites par des examens de conformité environ tous les deux ans et par des audits, et retire celles qui ne satisfont plus aux critères. Les signataires de traités modernes tiennent leurs propres listes d'entreprises. Le gouvernement du Canada reconnaît aussi le Registre des entreprises métisses de la rivière Rouge de la Fédération Métisse du Manitoba pour les occasions de marché fédérales, notamment celles de la SAEA.",
        ),
      ],
    },
    {
      id: "target",
      title: both("The 5% Minimum Target", "La cible minimale de 5 %"),
      blocks: [
        p(
          "Federal departments and agencies must award at least 5% of the total value of their contracts to Indigenous businesses each year. The procedures are in Appendix E of the Treasury Board's Directive on the Management of Procurement, in effect since April 1, 2022. The requirement covers the departments and agencies listed in Schedules I, I.1 and II of the Financial Administration Act, unless another act, regulation or order in council excludes them. ISC's report on fiscal year 2022 to 2023 describes a phase-in over three years, with full implementation expected by the end of fiscal year 2024 to 2025.",
          "Les ministères et organismes fédéraux doivent attribuer chaque année à des entreprises autochtones au moins 5 % de la valeur totale de leurs marchés. Les procédures figurent à l'annexe E de la Directive sur la gestion de l'approvisionnement du Conseil du Trésor, en vigueur depuis le 1er avril 2022. L'exigence vise les ministères et organismes énumérés aux annexes I, I.1 et II de la Loi sur la gestion des finances publiques, à moins qu'une loi, un règlement ou un décret ne les en exclue. Le rapport de SAC sur l'exercice 2022-2023 décrit une mise en œuvre progressive sur trois ans, la mise en œuvre complète étant prévue d'ici la fin de l'exercice 2024-2025.",
        ),
        p(
          "For the target, an Indigenous business is one owned and operated by Elders, band and tribal councils, or one registered in the IBD or on a modern treaty beneficiary business list. Contracts with such businesses count, PSIB set-asides and contracts that meet modern treaty obligations among them. Subcontracts and acquisition card purchases of $10,000 or less may count too.",
          "Aux fins de la cible, une entreprise autochtone est une entreprise détenue et exploitée par des Aînés, des conseils de bande et des conseils tribaux, ou inscrite au REA ou sur une liste d'entreprises bénéficiaires d'un traité moderne. Les contrats attribués à ces entreprises comptent, dont les marchés réservés de la SAEA et les contrats qui respectent les obligations des traités modernes. Les sous-contrats et les achats par carte d'achat de 10 000 $ ou moins peuvent aussi compter.",
        ),
        p(
          "Departments submit their annual performance reports to ISC within 6 months after the fiscal year ends, and ISC publishes the information within 12 months after it ends. Departments also submit annual procurement plans for meeting the target.",
          "Les ministères soumettent leurs rapports annuels sur le rendement à SAC dans les 6 mois suivant la fin de l'exercice, et SAC publie l'information dans les 12 mois suivant la fin de l'exercice. Les ministères soumettent aussi des plans d'approvisionnement annuels pour atteindre la cible.",
        ),
      ],
    },
    {
      id: "records",
      title: both("How the Published Contracts Mark Them", "Comment les contrats publiés les indiquent"),
      blocks: [
        p(
          "Each published contract over $10,000 carries two fields on this, which the Treasury Board's schema defines:",
          "Chaque contrat publié de plus de 10 000 $ porte deux champs à ce sujet, que définit le schéma du Conseil du Trésor :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Field", "Champ") },
            { kind: "label", label: both("Values", "Valeurs") },
            { kind: "main", label: both("What it records", "Ce qu'il indique") },
          ],
          rows: [
            [
              both("Procurement Strategy for Indigenous Business", "Stratégie d'approvisionnement auprès des entreprises autochtones"),
              both("MS, VS or NA", "MS, VS ou NA"),
              both(
                "Whether a PSIB mandatory set-aside (MS) or voluntary set-aside (VS) applies to the procurement; NA means none. Required for contracts after January 1, 2022.",
                "Si un marché réservé obligatoire (MS) ou facultatif (VS) dans le cadre de la SAEA s'applique à l'approvisionnement; NA signifie aucun. Obligatoire pour les marchés conclus après le 1er janvier 2022.",
              ),
            ],
            [
              both("Indigenous Business excluding PSIB", "Entreprises autochtones excluant le marché réservé en vertu de la SAEA"),
              both("Y or N", "Y ou N"),
              both(
                "Whether the contract was awarded to an Indigenous business. A contract under a PSIB mandatory or voluntary set-aside should read No here, since the first field already reports it. Required for contracts after January 1, 2019.",
                "Si le marché a été attribué à une entreprise autochtone. Un marché visé par un marché réservé obligatoire ou facultatif de la SAEA devrait porter Non dans ce champ, puisque le premier champ le déclare déjà. Obligatoire pour les marchés conclus après le 1er janvier 2019.",
              ),
            ],
          ],
        },
        p(
          "The Treasury Board's policy notice of April 2022 says the PSIB field captures whether competition was restricted to Indigenous businesses on a mandatory or voluntary basis. Together, the two fields represent the total value of contracts awarded to Indigenous businesses and count toward the 5% target.",
          "Selon l'avis sur la Politique sur les marchés d'avril 2022 du Conseil du Trésor, le champ de la SAEA indique si la concurrence a été restreinte aux entreprises autochtones de façon obligatoire ou facultative. Ensemble, les deux champs représentent la valeur totale des marchés attribués à des entreprises autochtones et comptent pour la cible de 5 %.",
        ),
      ],
    },
    {
      id: "on-award-watch",
      title: both("Seeing Them on Award Watch", "Les voir sur Award Watch"),
      blocks: [
        p(
          "A published contract's page shows both fields in its Procurement panel, in the schema's terms, as on this {example}. The first appears only for a mandatory or voluntary set-aside, with its code, and the second only when it reads Yes. Neither is shown for a contract with an individual whose name the site withholds.",
          "La page d'un contrat publié affiche les deux champs dans son panneau Approvisionnement, dans les termes du schéma, comme sur ce {example}. Le premier ne paraît que pour un marché réservé obligatoire ou facultatif, avec son code, et le second seulement s'il indique Oui. Aucun des deux n'est affiché pour un contrat conclu avec un particulier dont le site masque le nom.",
          { example: a(EXAMPLE_SET_ASIDE, "published contract with a mandatory set-aside", "contrat publié visé par un marché réservé obligatoire") },
        ),
        figure(
          "psib-published", SAMPLE_PUBLISHED_PSIB, ".panel-grid > section.panel",
          both(
            "The Procurement panel of a published contract's page on Award Watch, for a contract under a mandatory set-aside: the Procurement Strategy for Indigenous Business field with its code MS, and the notes under it.",
            "Le panneau Approvisionnement de la page d'un contrat publié sur Award Watch, pour un contrat visé par un marché réservé obligatoire : le champ de la Stratégie d'approvisionnement auprès des entreprises autochtones avec son code MS, et les notes qui le suivent.",
          ),
          both("A published contract under a mandatory set-aside, on Award Watch.", "Un contrat publié visé par un marché réservé obligatoire, sur Award Watch."),
          [
            mark(field(":scope > dl", 7),
              "The Procurement Strategy for Indigenous Business field appears only for a mandatory or voluntary set-aside, with its code.",
              "Le champ de la Stratégie d'approvisionnement auprès des entreprises autochtones ne paraît que pour un marché réservé obligatoire ou facultatif, avec son code."),
            mark(":scope > dl + p", "The set-aside as the department reported it in its published contracts.",
              "Le marché réservé tel que le ministère l'a déclaré dans ses contrats publiés."),
            mark(":scope > p:last-of-type", "The page shows the fields in the terms of the Treasury Board's schema.",
              "La page présente les champs dans les termes du schéma du Conseil du Trésor."),
          ],
        ),
        p(
          "The {expiring} tag a row PSIB: Mandatory Set-Aside, PSIB: Voluntary Set-Aside or Indigenous business, outside PSIB, as the department reported it in its published contracts. A row kept from an award notice or PSPC contract history takes the mark of the published contract matched to it ({rules}).",
          "Les {expiring} marquent une ligne SAEA : Contrat réservé obligatoire, SAEA : Contrat réservé facultatif ou Entreprise autochtone, hors SAEA, tel que le ministère l'a déclaré dans ses contrats publiés. Une ligne retenue d'un avis d'attribution ou de l'historique des contrats de SPAC prend la marque du contrat publié qui lui a été apparié ({rules}).",
          {
            expiring: a("/expiring", "lists of contracts ending soon", "listes des contrats prenant fin bientôt"),
            rules: a(`${METHODOLOGY}#expiring`, "Methodology", "Méthodologie"),
          },
        ),
      ],
    },
  ],
  sources: [
    SRC.iscProcurement, SRC.iscFacts, SRC.iscDirectory, SRC.indigenousConsiderations, SRC.psibNotices, SRC.opoReview, SRC.indigenousNotice,
    SRC.iscTarget, SRC.contractsSchema,
  ],
};

const CONTRACT_END: Guide = {
  slug: "when-a-federal-contract-ends",
  title: both(
    "When a Federal Contract Ends: Options, Extensions and What Comes Next",
    "Quand un contrat fédéral prend fin : options, prolongations et suite",
  ),
  seoTitle: both("Federal Contract Options and Extensions", "Options et prolongations des contrats fédéraux"),
  summary: both(
    "How options on a federal contract are exercised, how a contract is extended by amendment and within what limits, and where to see contracts ending soon.",
    "Comment s'exercent les options d'un contrat fédéral, sa prolongation par modification et ses limites, et où voir les contrats qui prennent bientôt fin.",
  ),
  checked: "2026-11-11",
  action: endingList(
    "To keep track of the contracts that reach 3 months from their end, save this list with your email address.",
    "Pour suivre les contrats qui arrivent à 3 mois de leur fin, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "end-date",
      title: both("The End Date", "La date de fin"),
      blocks: [
        p(
          "CanadaBuys defines a contract's end date as the last date on which an awarded contract is considered valid; the contract expires after it. In the published contracts over $10,000, the end is the contract period end date or delivery date. For services it is the end of the period over which they are provided, and for goods the date they are to be delivered.",
          "AchatsCanada définit la date de fin d'un contrat comme la dernière date à laquelle un contrat attribué est considéré comme valide; le contrat expire après cette date. Dans les contrats publiés de plus de 10 000 $, la fin est la date de clôture du contrat ou date de livraison. Pour des services, c'est la fin de la période au cours de laquelle ils sont fournis, et pour des biens, la date à laquelle ils doivent être livrés.",
        ),
        p(
          "Amendments move the end date, so Award Watch reads each contract's end from its newest version ({rules}).",
          "Les modifications déplacent la date de fin; Award Watch lit donc la fin de chaque contrat dans sa plus récente version ({rules}).",
          { rules: a(`${METHODOLOGY}#expiring`, "Methodology", "Méthodologie") },
        ),
      ],
    },
    {
      id: "options",
      title: both("Options", "Options"),
      blocks: [
        p(
          "An option adds quantities or time to a contract. Public Services and Procurement Canada's Buyer's Guide describes options for additional quantities or years that were included in the original solicitation and approved with the original contract; PSPC's Buyer's Portal, which holds the guide, has been the official source of information for its Acquisitions Program since January 30, 2026. A procurement's value, estimated to see whether the trade agreements apply, includes its options and applicable taxes.",
          "Une option ajoute des quantités ou du temps à un contrat. Le Guide de l'acheteur de Services publics et Approvisionnement Canada décrit des options pour des quantités ou des années supplémentaires prévues dans la demande d'offres initiale et approuvées avec le contrat initial; le Portail de l'acheteur de SPAC, qui contient le guide, est la source d'information officielle de son Programme des approvisionnements depuis le 30 janvier 2026. La valeur d'un approvisionnement, estimée pour savoir si les accords commerciaux s'appliquent, comprend ses options et les taxes applicables.",
        ),
        p(
          "An option is exercised by amending the contract. The buyer first checks that the option was approved in advance, and obtains approval if it was not. The buyer should also make sure the option's price is still fair and reasonable, and may negotiate a lower price if market prices have dropped significantly since the award.",
          "Une option s'exerce par une modification du contrat. L'acheteur vérifie d'abord que l'option a été approuvée au préalable, et obtient l'approbation si ce n'est pas le cas. Il devrait aussi s'assurer que le prix de l'option est toujours juste et raisonnable, et peut négocier un prix inférieur si la valeur marchande a fortement diminué depuis l'attribution.",
        ),
        p(
          "Once approval is in hand, the amendment needs only the signature of an official with delegated authority for the same categories. The option's funds serve only the purpose approved. In the guide's example, a one-year services contract of $200,000 with an option year of $200,000 cannot use the option year's funds to pay for more services in the first year.",
          "Une fois l'approbation obtenue, la modification ne requiert que la signature d'un titulaire qui détient une délégation de pouvoir pour les mêmes catégories. Les fonds de l'option ne servent qu'à la fin approuvée. Dans l'exemple du guide, un contrat de services d'un an de 200 000 $ assorti d'une année d'option de 200 000 $ ne peut pas utiliser les fonds de l'année d'option pour payer plus de services pendant la première année.",
        ),
      ],
    },
    {
      id: "extensions",
      title: both("Extensions and Other Amendments", "Prolongations et autres modifications"),
      blocks: [
        p(
          "An amendment formally deletes, modifies or adds conditions to a contract, and requires the agreement of both parties. The buyer weighs an amendment against a new contract, and tries to avoid amendments made necessary by inadequate initial funding or planning. PSPC sorts amendments into four types:",
          "Une modification supprime, modifie ou ajoute officiellement des conditions à un contrat, et nécessite l'accord des deux parties. L'acheteur compare la modification à un nouveau contrat, et cherche à éviter les modifications rendues nécessaires par un financement initial ou une planification insuffisants. SPAC classe les modifications en quatre types :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Type", "Type") },
            { kind: "main", label: both("What it covers", "Ce qu'elle vise") },
            { kind: "main", label: both("Approval", "Approbation") },
          ],
          rows: [
            [
              both("Administrative", "Administrative"),
              both(
                "Changes that add no risk or liability for Canada and do not raise the value, such as new contact details or fewer goods at the same unit price",
                "Des changements qui n'ajoutent ni risque ni responsabilité pour le Canada et n'augmentent pas la valeur, comme de nouvelles coordonnées ou moins de biens au même prix unitaire",
              ),
              both(
                "Any official with delegated contract entry authority for the categories",
                "Tout titulaire qui détient une délégation de pouvoir de conclusion de contrats pour les catégories visées",
              ),
            ],
            [
              both("Nil or reduced value with added risk", "Valeur nulle ou réduite avec risque supplémentaire"),
              both(
                "Changes to the basis or method of payment, or to the conditions, that move risk or liability to Canada",
                "Des changements à la base ou au mode de paiement, ou aux conditions, qui transfèrent un risque ou une responsabilité au Canada",
              ),
              both("The level set by a risk assessment for amendments", "Le niveau fixé par une évaluation des risques liés aux modifications"),
            ],
            [
              both("Pre-approved", "Préapprouvée"),
              both(
                "Exercising an option, or using an amount set aside in the original approval",
                "L'exercice d'une option, ou l'utilisation d'un montant réservé dans l'approbation initiale",
              ),
              both("None beyond the original approval", "Aucune au-delà de l'approbation initiale"),
            ],
            [
              both("Unforeseen, not pre-approved", "Imprévue, non préapprouvée"),
              both(
                "More quantities or requirements, a longer period after unexpected delays beyond the contractor's control, or a value beyond the original approval",
                "Des quantités ou des besoins supplémentaires, une période prolongée à la suite de retards imprévus indépendants de l'entrepreneur, ou une valeur supérieure à l'approbation initiale",
              ),
              both(
                "The level set by a risk assessment at complexity levels 1 to 3; an assistant deputy minister at levels 4 and 5",
                "Le niveau fixé par une évaluation des risques aux niveaux de complexité 1 à 3; un sous-ministre adjoint aux niveaux 4 et 5",
              ),
            ],
          ],
        },
        p(
          "Adding time to a contract with a specific end date cannot be treated as administrative, since it adds liability for Canada even when no money is added. Money left at the end of a contract cannot pay for an extension without approval. If a delay comes from factors beyond the contractor's control, the buyer should extend the contract by a period equal to the delay.",
          "L'ajout de temps à un contrat dont la date de fin est précise ne peut pas être considéré comme administratif, puisqu'il ajoute une responsabilité pour le Canada même sans fonds supplémentaires. Les fonds qui restent à la fin d'un contrat ne peuvent pas payer une prolongation sans approbation. Si un retard découle de facteurs indépendants de la volonté de l'entrepreneur, l'acheteur devrait prolonger le contrat d'une période équivalente au retard.",
        ),
      ],
    },
    {
      id: "limits",
      title: both("Limits on Amending", "Limites des modifications"),
      blocks: [
        p(
          "A department must have the legal authority to amend a contract, and must follow the Treasury Board's requirements for approval. Most of the contracting limits in Appendix A of the Directive on the Management of Procurement were raised for inflation effective December 15, 2025; the {limits} explains them. PSPC's limits cover both contract entry and amendments, and a submission beyond them needs Treasury Board approval.",
          "Un ministère doit détenir le pouvoir légal de modifier un contrat et respecter les exigences du Conseil du Trésor en matière d'approbation. La plupart des limites contractuelles de l'annexe A de la Directive sur la gestion de l'approvisionnement ont été augmentées pour tenir compte de l'inflation, avec effet le 15 décembre 2025; le {limits} les explique. Les limites de SPAC visent à la fois la conclusion et la modification des contrats, et une présentation qui les dépasse nécessite l'approbation du Conseil du Trésor.",
          { limits: a(LIMITS_PATH, "guide on contracts awarded without competition", "guide sur les marchés conclus sans appel d'offres") },
        ),
        p(
          "The Buyer's Guide, citing Treasury Board Contracting Policy Notice 2000-3, allows the end date of a contract the Treasury Board approved to be extended without returning to the Board only when all of these hold:",
          "Le Guide de l'acheteur, citant l'Avis sur la Politique sur les marchés 2000-3 du Conseil du Trésor, permet de prolonger la durée d'un contrat approuvé par le Conseil du Trésor sans retourner devant le Conseil uniquement lorsque toutes ces conditions sont remplies :",
        ),
        {
          kind: "list",
          items: [
            tx(
              "the extension lasts no longer than two years or 50% of the contract's duration, pre-approved amendments included, whichever is less",
              "la prolongation ne dépasse pas deux ans ou 50 % de la durée du contrat, modifications préapprouvées comprises, selon la durée la plus courte",
            ),
            tx(
              "it has no financial implication, or one within the directive's contracting limits",
              "elle n'a pas d'incidence financière, ou son incidence respecte les limites contractuelles de la directive",
            ),
            tx(
              "the end date was not a critical part of the Treasury Board's approval",
              "la date de fin n'était pas un élément essentiel de l'approbation du Conseil du Trésor",
            ),
            tx(
              "the original submission described the period as approximate or non-specific",
              "la présentation initiale décrivait la période comme approximative ou non précise",
            ),
          ],
        },
        p(
          "Where a supplier is subject to the Vendor Performance Corrective Measure Policy, its contract cannot be lengthened by amendment or by option unless there is too little time to compete the requirement again or other exceptional circumstances exist. Either case needs an assistant deputy minister's approval.",
          "Lorsqu'un fournisseur est assujetti à la Politique sur les mesures correctives du rendement des fournisseurs, son contrat ne peut être prolongé ni par une modification ni par l'exercice d'une option, à moins que le temps ne permette pas un nouveau processus concurrentiel ou qu'il existe d'autres circonstances exceptionnelles. Dans les deux cas, l'approbation d'un sous-ministre adjoint est nécessaire.",
        ),
      ],
    },
    {
      id: "records",
      title: both("What the Records Show", "Ce que montrent les dossiers"),
      blocks: [
        p(
          "An amendment or an exercised option changes a contract's records. {three} explains how the award notice, PSPC contract history and the published contract each carry them. The contracts-ending lists also count each contract's versions beyond the original and show its value growth from the original amount to the newest total ({rules}).",
          "Une modification ou une option exercée change les dossiers d'un contrat. {three} explique comment l'avis d'attribution, l'historique des contrats de SPAC et le contrat publié en tiennent compte. Les listes des contrats prenant fin comptent aussi les versions de chaque contrat qui suivent la version initiale et montrent la variation de sa valeur, du montant initial à la plus récente valeur totale ({rules}).",
          {
            three: a(THREE_PATH, "Three Federal Records of One Contract", "Trois dossiers fédéraux d'un même contrat"),
            rules: a(`${METHODOLOGY}#expiring`, "Methodology", "Méthodologie"),
          },
        ),
      ],
    },
    {
      id: "ending",
      title: both("Contracts Near Their End", "Contrats près de leur fin"),
      blocks: [
        p(
          "A new contract for the same need is a new procurement. Under the Government Contracts Regulations, bids must be solicited for it, by public notice or by inviting suppliers on the suppliers' list, unless a section 6 exception applies. Award Watch lists the {tenders} posted on CanadaBuys.",
          "Un nouveau contrat pour le même besoin est un nouvel approvisionnement. Selon le Règlement sur les marchés de l'État, il faut lancer un appel d'offres, par un avis public ou en invitant les fournisseurs de la liste de fournisseurs, sauf si une exception de l'article 6 s'applique. Award Watch présente les {tenders} publiés sur AchatsCanada.",
          { tenders: a("/tenders", "open tender notices", "avis d'appel d'offres ouverts") },
        ),
        p(
          "Award Watch lists the contracts whose newest version ends within 3, 6 or 12 months of the data date, each once across the three sources. The windows are cumulative. The {m3} is free in full. The {m6} and the {m12}, in full, are part of Pro, the site's paid plan, and every reader still sees their counts, their totals and their first 10 contracts. The {overview} shows each window's count and total.",
          "Award Watch présente les contrats dont la plus récente version prend fin d'ici 3, 6 ou 12 mois après la date des données, chacun une seule fois entre les trois sources. Les périodes sont cumulatives. La {m3} est entièrement gratuite. La {m6} et la {m12}, en entier, font partie de Pro, le forfait payant du site, et chaque lecteur en voit toujours le nombre, le total et les 10 premiers contrats. L'{overview} présente le nombre et le total de chaque période.",
          {
            m3: a("/expiring/3m", "3-month list", "liste de 3 mois"),
            m6: a("/expiring/6m", "6-month list", "liste de 6 mois"),
            m12: a("/expiring/12m", "12-month list", "liste de 12 mois"),
            overview: a("/expiring", "overview of contracts ending soon", "aperçu des contrats prenant fin bientôt"),
          },
        ),
        figure(
          "ending-list", SAMPLE_ENDING, "section.panel:has(table)",
          both(
            "The 3-month list of contracts ending on Award Watch: each contract's end date and days left, its title, reference and source, its supplier, its value and its method.",
            "La liste de 3 mois des contrats prenant fin sur Award Watch : la date de fin et les jours restants de chaque contrat, son titre, sa référence et sa source, son fournisseur, sa valeur et sa méthode.",
          ),
          both("The 3-month list of contracts ending, on Award Watch.", "La liste de 3 mois des contrats prenant fin, sur Award Watch."),
          [
            mark(".panel-head .panel-count", "The contracts whose newest version ends within 3 months of the data date.",
              "Les contrats dont la plus récente version prend fin d'ici 3 mois après la date des données."),
            mark("tbody tr:first-child td:first-child", "The end date is the date the record states, read from the contract's newest version.",
              "La date de fin est celle qu'indique le dossier, lue dans la plus récente version du contrat."),
            mark("tbody tr:nth-child(2) td.lead-cell > span.small",
              "Each contract is listed once across the three sources: the award notice, PSPC contract history and the published contract.",
              "Chaque contrat est présenté une seule fois entre les trois sources : l'avis d'attribution, l'historique des contrats de SPAC et le contrat publié."),
          ],
        ),
        p(
          "An end date is the date the record states. A contract can be extended, renewed or replaced, and the lists say nothing about what follows its end ({rules}).",
          "Une date de fin est celle qu'indique le dossier. Un contrat peut être prolongé, renouvelé ou remplacé, et les listes n'indiquent rien de ce qui suit sa fin ({rules}).",
          { rules: a(`${METHODOLOGY}#expiring`, "Methodology", "Méthodologie") },
        ),
      ],
    },
  ],
  sources: [
    SRC.dictionary, SRC.contractsSchema, SRC.exerciseOptions, SRC.tradeApplicability, SRC.amendConsiderations, SRC.amendProcedure, SRC.amendApproval,
    SRC.vendorPerformance, SRC.contractingLimits, SRC.limitsNotice, SRC.gcr,
  ],
};

const HOW_TO_BID: Guide = {
  slug: BID_PATH.slice("/guides/".length),
  title: both("How to Bid on Government of Canada Contracts, Start to Finish", "Soumissionner sur les marchés du gouvernement du Canada, du début à la fin"),
  seoTitle: both("How to Bid on Government of Canada Contracts", "Soumissionner sur les marchés du gouvernement du Canada"),
  summary: both(
    "The steps to bid on a federal contract, in order: accounts and numbers, notices, documents, submission, award, debriefing and the published records.",
    "Les étapes pour soumissionner sur un marché fédéral : comptes et numéros, avis, documents, soumission, attribution, compte rendu et dossiers publiés.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To keep track of new federal tender notices as they are posted, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux à mesure qu'ils sont publiés, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "steps",
      title: both("The Steps in Order", "Les étapes dans l'ordre"),
      blocks: [
        p(
          "Public Services and Procurement Canada (PSPC) calls CanadaBuys the official source for Government of Canada tender and award notices, and CanadaBuys states that the notices, solicitation documents and attachments are free of charge. Each notice's description says how to prepare the bid, when it is due and how it will be evaluated. In order:",
          "Services publics et Approvisionnement Canada (SPAC) présente AchatsCanada comme la source officielle des avis d'appel d'offres et d'adjudication du gouvernement du Canada, et AchatsCanada indique que les avis, les documents de sollicitation et les autres documents sont disponibles sans frais. La description de chaque avis précise comment préparer la soumission, sa date limite et la méthode d'évaluation. Dans l'ordre :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Step", "Étape") },
            { kind: "main", label: both("What happens", "Ce qui se passe") },
          ],
          rows: [
            [
              both("Register", "S'inscrire"),
              both(
                "An SAP Business Network account for the notices PSPC posts in SAP Ariba, and a Canada Revenue Agency business number",
                "Un compte SAP Business Network pour les avis que SPAC publie dans SAP Ariba, et un numéro d'entreprise de l'Agence du revenu du Canada",
              ),
            ],
            [
              both("Find a notice", "Trouver un avis"),
              both(
                "On CanadaBuys' Tender opportunities page, where the Government Electronic Tendering Service publishes them",
                "Sur la page Occasions de marché d'AchatsCanada, où le Service électronique d'appels d'offres du gouvernement les publie",
              ),
            ],
            [
              both("Read", "Lire"),
              both(
                "The requirement, any security requirements, the evaluation criteria and the delivery method for bids",
                "Le besoin, les exigences de sécurité s'il y en a, les critères d'évaluation et la méthode de dépôt des soumissions",
              ),
            ],
            [
              both("Submit", "Soumissionner"),
              both("By the method the notice states, before it closes", "Par la méthode qu'indique l'avis, avant sa clôture"),
            ],
            [
              both("Award", "Attribution"),
              both(
                "Bids evaluated against the criteria the notice specifies, and an award notice on CanadaBuys where one is required",
                "Soumissions évaluées selon les critères que précise l'avis, et un avis d'attribution sur AchatsCanada lorsqu'il est exigé",
              ),
            ],
            [
              both("Debriefing", "Compte rendu"),
              both("On request to the contracting officer, after a competitive process", "Sur demande à l'agent de négociation des contrats, après un processus concurrentiel"),
            ],
            [
              both("Publication", "Publication"),
              both("A contract over $10,000, published by the department after each quarter", "Un contrat de plus de 10 000 $, publié par le ministère après chaque trimestre"),
            ],
          ],
        },
      ],
    },
    {
      id: "accounts",
      title: both("Accounts and Numbers", "Comptes et numéros"),
      blocks: [
        p(
          "PSPC posts in SAP Ariba the tender notices it issues on behalf of federal departments, agencies and Crown corporations. To view and bid on them, a business creates an SAP Business Network account, as CanadaBuys' registration page (modified July 6, 2026) names it, and fills out the Government of Canada's required questionnaire before it can bid. PSPC's electronic procurement page (modified May 29, 2026) calls this registering in SAP Ariba. CanadaBuys' checklist allows one account per Canada Revenue Agency (CRA) business number.",
          "SPAC publie dans SAP Ariba les avis d'appel d'offres qu'il lance au nom de ministères et d'organismes fédéraux et de sociétés d'État. Pour les consulter et soumissionner, une entreprise crée un compte SAP Business Network, comme le nomme la page d'inscription d'AchatsCanada (modifiée le 6 juillet 2026), et remplit le questionnaire requis du gouvernement du Canada avant de pouvoir soumettre une offre. La page de SPAC sur les achats électroniques (modifiée le 29 mai 2026) parle d'inscription dans SAP Ariba. La liste de vérification d'AchatsCanada permet un seul compte par numéro d'entreprise de l'Agence du revenu du Canada (ARC).",
        ),
        p(
          "CanadaBuys says any business selling goods or services to the Government of Canada needs a CRA business number, and will need it if it wins a contract; a business outside Canada registers for a non-resident one. PSPC's page names a second number, the procurement business number, obtained by registering in the Supplier Registration Information (SRI) system and currently required for bids not processed through SAP Ariba.",
          "AchatsCanada indique que toute entreprise qui vend des biens ou des services au gouvernement du Canada a besoin d'un numéro d'entreprise de l'ARC, et en aura besoin si elle remporte un contrat; une entreprise à l'extérieur du Canada s'inscrit pour obtenir un numéro pour non-résident. La page de SPAC nomme un second numéro, le numéro d'entreprise-approvisionnement, obtenu en s'inscrivant au système de Données d'inscription des fournisseurs (DIF) et requis à l'heure actuelle pour les soumissions qui ne sont pas traitées par SAP Ariba.",
        ),
        p(
          "Departments and agencies posting without PSPC post directly to CanadaBuys, where the notice's Bidding details tab holds the documents and bidding instructions.",
          "Les ministères et organismes qui publient sans passer par SPAC le font directement dans AchatsCanada, où l'onglet Détails de l'offre de l'avis contient les documents et les instructions sur la façon de soumissionner.",
        ),
      ],
    },
    {
      id: "notices",
      title: both("Where Notices Are Published", "Où les avis sont publiés"),
      blocks: [
        p(
          "Under Treasury Board Contracting Policy Notice 2025-8, tender notices must be published for procurements subject to the free trade agreements, through the Government Electronic Tendering Service (GETS) via the Tender opportunities page on CanadaBuys. CanadaBuys also shows notices from the broader Canadian public sector and the NATO Support and Procurement Agency. {trade} covers which agreements apply and from what value.",
          "Selon l'Avis sur la Politique des marchés 2025-8 du Conseil du Trésor, des avis d'appel d'offres doivent être publiés pour les approvisionnements assujettis aux accords de libre-échange, par le Service électronique d'appels d'offres du gouvernement (SEAOG) sur la page Occasions de marché d'AchatsCanada. AchatsCanada affiche aussi des avis du secteur public canadien élargi et de l'Agence OTAN de soutien et d'acquisition. {trade} indique quels accords s'appliquent et à partir de quelle valeur.",
          { trade: a(TRADE_PATH, "Trade Agreements and Thresholds on a Federal Tender Notice", "Accords commerciaux et seuils dans un avis d'appel d'offres fédéral") },
        ),
        p(
          "Award Watch reads CanadaBuys' open data every day and lists the {open} and the {new} by the day first seen, each linked to its page on CanadaBuys.",
          "Award Watch lit chaque jour les données ouvertes d'AchatsCanada et présente les {open} et les {new} selon le jour où ils ont été vus pour la première fois, chacun lié à sa page sur AchatsCanada.",
          {
            open: a("/tenders", "open tender notices", "avis d'appel d'offres ouverts"),
            new: a("/tenders/new", "new notices", "nouveaux avis"),
          },
        ),
        figure(
          "new-notices", SAMPLE_NEW, "section.panel:has(table)",
          both(
            "One day's new notices on Award Watch: each notice's title and reference, its buyer, its closing time and status.",
            "Les nouveaux avis d'une journée sur Award Watch : le titre et la référence de chaque avis, son acheteur, son heure de clôture et son statut.",
          ),
          both("The new notices of one day, on Award Watch.", "Les nouveaux avis d'une journée, sur Award Watch."),
          [
            mark(".panel-head", "Award Watch lists the new notices by the day first seen.",
              "Award Watch présente les nouveaux avis selon le jour où ils ont été vus pour la première fois."),
            mark("tbody tr:first-child td.c-buyer", "PSPC issues tender notices on behalf of federal departments, agencies and Crown corporations.",
              "SPAC lance des avis d'appel d'offres au nom de ministères et d'organismes fédéraux et de sociétés d'État."),
            mark("tbody tr:first-child td.c-date", "A bid can be modified and resubmitted until the tender closes.",
              "Une soumission peut être modifiée et soumise de nouveau jusqu'à la clôture de l'appel d'offres."),
          ],
        ),
      ],
    },
    {
      id: "kinds",
      title: both("Kinds of Notice", "Types d'avis"),
      blocks: [
        p(
          "The notice type says what the buyer asks for. CanadaBuys' data dictionary lists nine types, and PSPC's seminar notes name three as the most commonly used:",
          "Le type d'avis indique ce que demande l'acheteur. Le dictionnaire de données d'AchatsCanada énumère neuf types, et les notes de séminaire de SPAC en nomment trois comme les plus couramment utilisés :",
        ),
        {
          kind: "terms",
          items: [
            {
              term: both("Request for Proposal", "Demande de propositions"),
              text: tx(
                "A call for bids with the specifications and the evaluation criteria for choosing the winning bid, which results in a contract.",
                "Un appel d'offres qui présente les caractéristiques du besoin et les critères d'évaluation servant à choisir la soumission retenue, laquelle donne lieu à un contrat.",
              ),
            },
            {
              term: both("Request for Standing Offer", "Demande d'offre à commandes"),
              text: tx(
                "For repetitive buying. A supplier that qualifies agrees to a fixed price over a time frame, and the buyer issues it call-ups.",
                "Pour des achats répétés. Le fournisseur qui se qualifie consent à un prix fixe pendant une période donnée, et l'acheteur lui adresse des commandes subséquentes.",
              ),
            },
            {
              term: both("Request for Supply Arrangement", "Demande d'arrangement en matière d'approvisionnement"),
              text: tx(
                "For repetitive needs with variables, such as statements of work or requirements, that cannot be defined in advance; bids for specific requirements are later solicited from the pre-qualified suppliers.",
                "Pour des besoins répétés comportant des variables, comme des énoncés des travaux ou des exigences, qui ne peuvent pas être définies d'avance; des soumissions pour des besoins précis sont ensuite demandées aux fournisseurs préqualifiés.",
              ),
            },
          ],
        },
        p(
          "{sosa} explains both instruments, and {reading} explains each field of a notice. An {acan} names the business a buyer intends to award the contract to.",
          "{sosa} explique ces deux instruments, et {reading} explique chaque champ d'un avis. Un {acan} nomme l'entreprise à laquelle l'acheteur compte attribuer le contrat.",
          {
            sosa: a(SOSA_PATH, "Standing Offers and Supply Arrangements", "Offres à commandes et arrangements en matière d'approvisionnement"),
            acan: a(ACAN_PATH, "advance contract award notice", "préavis d'adjudication de contrat"),
            reading: a(READING_PATH, "How to Read a Federal Tender Notice on CanadaBuys", "Lire un avis d'appel d'offres fédéral sur AchatsCanada"),
          },
        ),
      ],
    },
    {
      id: "documents",
      title: both("Reading the Solicitation", "Lire la demande de soumissions"),
      blocks: [
        p(
          "PSPC's seminar notes set out the parts of a solicitation, from general information, which describes the requirement and identifies security requirements, to the evaluation procedures and the clauses of the resulting contract. Since June 2024, PSPC's solicitations follow a modernized format; other departments may still post conventional documents.",
          "Les notes de séminaire de SPAC présentent les parties d'une demande de soumissions, des renseignements généraux, qui décrivent le besoin et indiquent les exigences en matière de sécurité, aux procédures d'évaluation et aux clauses du contrat subséquent. Depuis juin 2024, les demandes de soumissions de SPAC suivent une présentation modernisée; d'autres ministères peuvent encore publier des documents conventionnels.",
        ),
        p(
          "The notes direct questions, in writing and before their deadline, to the contracting authority named in the solicitation document, the only point of contact; the answers appear as amendments on the notice page.",
          "Les notes demandent d'adresser les questions par écrit, avant la date limite prévue, à l'autorité contractante nommée dans le document de demande de soumissions, le seul point de contact; les réponses paraissent comme modifications sur la page de l'avis.",
        ),
        p(
          "A security clearance is needed when a contract requires personnel to access classified or protected information, assets or sensitive sites, and the tender opportunity identifies the {security}. Other guides cover {psib} and {integrity}.",
          "Une attestation de sécurité est nécessaire lorsqu'un contrat exige que le personnel accède à des renseignements, à des biens ou à des lieux protégés ou classifiés, et l'appel d'offres indique les {security}. D'autres guides traitent des {psib} et de l'{integrity}.",
          {
            security: a(SECURITY_PATH, "security requirements", "exigences de sécurité"),
            psib: a(PSIB_PATH, "Indigenous set-asides", "marchés réservés aux entreprises autochtones"),
            integrity: a(INTEGRITY_PATH, "supplier integrity", "intégrité des fournisseurs"),
          },
        ),
      ],
    },
    {
      id: "submitting",
      title: both("Submitting and Evaluation", "Dépôt et évaluation"),
      blocks: [
        p(
          "Each tender notice states the delivery method for bids: SAP Ariba for notices posted to PSPC's electronic procurement solution, and for some opportunities another method, such as a bid receiving unit or Canada Post's Connect service. A bid can be modified and resubmitted until the tender closes.",
          "Chaque avis d'appel d'offres indique la méthode de dépôt des soumissions : SAP Ariba pour les appels d'offres publiés dans la solution d'achats électroniques de SPAC et, pour certaines occasions de marché, un autre moyen, comme une unité de réception des soumissions ou le service Connexion de Postes Canada. Une soumission peut être modifiée et soumise de nouveau jusqu'à la clôture de l'appel d'offres.",
        ),
        p(
          "Mandatory criteria are assessed pass or fail, and point-rated criteria score the value added over and above them. The seminar notes describe {ways}: the lowest priced responsive bid, the best overall value, and the highest rated technical bid within a stipulated budget. This {example} from Indigenous Services Canada states its selection criteria as the highest combined rating of technical merit and price.",
          "Les critères obligatoires sont évalués sur une base de réussite ou d'échec, et les critères cotés mesurent la valeur ajoutée en plus des exigences obligatoires. Les notes de séminaire décrivent {ways} : la soumission recevable la plus basse, le meilleur rapport qualité-prix et la soumission technique la mieux cotée dans les limites d'un budget. Cet {example} de Services aux Autochtones Canada indique comme critère de sélection la cote combinée la plus élevée pour le mérite technique et le prix.",
          {
            ways: a(EVALUATION_PATH, "three ways of selecting the winning bid", "trois façons de choisir la soumission retenue"),
            example: a(EXAMPLE_NOTICE, "request for proposal", "appel d'offres"),
          },
        ),
      ],
    },
    {
      id: "award",
      title: both("Award and Debriefing", "Attribution et compte rendu"),
      blocks: [
        p(
          "PSPC's Buyer's Guide requires an award notice within 72 days of the award for procurements subject to the international trade agreements and the Canadian Free Trade Agreement. For contracts issued through the government's procurement application, award notices are generated and posted on CanadaBuys automatically. Award Watch lists them under {awards}; this {award} links the tender notice it followed.",
          "Le Guide de l'acheteur de SPAC exige un avis d'attribution dans les 72 jours suivant l'attribution pour les approvisionnements assujettis aux accords commerciaux internationaux et à l'Accord de libre-échange canadien. Pour les contrats attribués par l'application d'approvisionnement du gouvernement, les avis d'attribution sont générés et affichés automatiquement sur AchatsCanada. Award Watch les présente sous {awards}; cet {award} renvoie à l'avis d'appel d'offres qui l'a précédé.",
          {
            awards: a("/awards", "award notices", "avis d'attribution"),
            award: a(EXAMPLE_AWARD, "award notice", "avis d'attribution"),
          },
        ),
        figure(
          "award-head", SAMPLE_AWARD, "header.page-head .page-head-row",
          both(
            "The head of an award notice's page on Award Watch: its title, status, supplier, value and end date, its reference, a button to the award notice on CanadaBuys and one to the tender notice it followed.",
            "L'en-tête de la page d'un avis d'attribution sur Award Watch : son titre, son statut, son fournisseur, sa valeur et sa date de fin, sa référence, un bouton vers l'avis d'attribution sur AchatsCanada et un autre vers l'avis d'appel d'offres qui l'a précédé.",
          ),
          both("The head of an award notice's page on Award Watch.", "L'en-tête de la page d'un avis d'attribution sur Award Watch."),
          [
            mark("p.eyebrow, h1", "Award Watch lists the award notices.", "Award Watch présente les avis d'attribution."),
            mark("p.page-note", "After a competitive process, a bidder may ask the contracting officer for a debriefing.",
              "Après un processus concurrentiel, un soumissionnaire peut demander un compte rendu à l'agent de négociation des contrats."),
            mark(".page-actions",
              "For contracts issued through the government's procurement application, award notices are posted on CanadaBuys automatically. This award notice links the tender notice it followed.",
              "Pour les contrats attribués par l'application d'approvisionnement du gouvernement, les avis d'attribution sont affichés automatiquement sur AchatsCanada. Cet avis d'attribution renvoie à l'avis d'appel d'offres qui l'a précédé."),
          ],
        ),
        p(
          "After a competitive process, a bidder may ask the contracting officer for a {debriefing} once told of the results or of an award to someone else, a right CanadaBuys traces to the Directive on the Management of Procurement and some trade agreements. A debriefing typically gives the successful supplier's name, the contract value and an outline of why the bid was not successful.",
          "Après un processus concurrentiel, un soumissionnaire peut demander un {debriefing} à l'agent de négociation des contrats une fois informé des résultats ou de l'attribution du contrat à quelqu'un d'autre, un droit qu'AchatsCanada rattache à la Directive sur la gestion de l'approvisionnement et à certains accords commerciaux. Un compte rendu comprend en général le nom du fournisseur retenu, la valeur du contrat et un résumé des raisons pour lesquelles la soumission n'a pas été retenue.",
          { debriefing: a(DEBRIEF_PATH, "debriefing", "compte rendu") },
        ),
        p(
          "CanadaBuys recommends taking an objection to the contracting authority first. The Office of the Procurement Ombud can review complaints about the award of certain contracts below $34,700 for goods and $139,000 for services; a supplier has, in most cases, 30 working days after the public notice of award to file. The Canadian International Trade Tribunal takes complaints on procurements covered by at least one trade agreement; the {rules} gives its 10-working-day deadline and the exceptions.",
          "AchatsCanada recommande de soumettre d'abord une objection à l'autorité contractante. Le Bureau de l'ombud de l'approvisionnement peut examiner les plaintes sur l'attribution de certains contrats d'une valeur inférieure à 34 700 $ pour les biens et à 139 000 $ pour les services; un fournisseur dispose, dans la plupart des cas, de 30 jours ouvrables après l'avis public d'attribution pour en déposer une. Le Tribunal canadien du commerce extérieur reçoit les plaintes sur les approvisionnements visés par au moins un accord commercial; le {rules} donne son délai de 10 jours ouvrables et les exceptions.",
          { rules: a(DEBRIEF_PATH, "debriefings guide", "guide sur les comptes rendus") },
        ),
      ],
    },
    {
      id: "records",
      title: both("Where the Contract Is Published", "Où le contrat est publié"),
      blocks: [
        p(
          "A contract can then appear in three federal records: the award notice; PSPC's contract history, the contracts PSPC awards on behalf of federal departments and agencies; and the department's publication of each contract over $10,000, due under section 86 of the Access to Information Act within 30 days after each of the first three quarters and 60 days after the fourth. {three} explains how they differ; {ending} covers options and extensions, and the {expiring} list contracts near their end.",
          "Un contrat peut ensuite figurer dans trois dossiers fédéraux : l'avis d'attribution; l'historique des contrats de SPAC, soit les contrats que SPAC attribue au nom des ministères et organismes fédéraux; et la publication, par le ministère, de chaque contrat de plus de 10 000 $, exigée par l'article 86 de la Loi sur l'accès à l'information dans les 30 jours suivant chacun des trois premiers trimestres et dans les 60 jours suivant le quatrième. {three} explique en quoi ils diffèrent; {ending} traite des options et des prolongations, et les {expiring} présentent les contrats qui approchent de leur fin.",
          {
            three: a(THREE_PATH, "Three Federal Records of One Contract", "Trois dossiers fédéraux d'un même contrat"),
            expiring: a("/expiring", "lists of contracts ending soon", "listes des contrats prenant fin bientôt"),
            ending: a(ENDING_PATH, "When a Federal Contract Ends", "Quand un contrat fédéral prend fin"),
          },
        ),
      ],
    },
  ],
  sources: [
    SRC.eProcurement, SRC.register, SRC.registerChecklist, SRC.howToBid, SRC.thresholds, SRC.dictionary, SRC.seminar, SRC.acan, SRC.sourcing,
    SRC.exampleNotice, SRC.atAward, SRC.followUp, SRC.atia,
  ],
};

const TRADE: Guide = {
  slug: TRADE_PATH.slice("/guides/".length),
  title: both("Trade Agreements and Thresholds on a Federal Tender Notice", "Accords commerciaux et seuils dans un avis d'appel d'offres fédéral"),
  seoTitle: both("Trade Agreements and Thresholds on Federal Tenders", "Accords commerciaux et seuils des appels d'offres fédéraux"),
  summary: both(
    "The trade agreements line on a federal tender notice, the thresholds in effect for 2026 and 2027, and the limited tendering reasons a notice can give.",
    "La ligne des accords commerciaux d'un avis fédéral, les seuils en vigueur en 2026 et 2027, et les motifs d'appel d'offres limité qu'un avis peut donner.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To keep track of new federal tender notices and the agreements they name, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux et les accords qu'ils nomment, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "line",
      title: both("The Trade Agreements Line", "La ligne des accords commerciaux"),
      blocks: [
        p(
          "A federal tender notice lists the trade agreements that apply to the procurement. CanadaBuys' data dictionary defines the field as a list of any international trade agreements that apply, if applicable, and the line also names the Canadian Free Trade Agreement (CFTA), which the Treasury Board counts among the internal agreements. In CanadaBuys' file of open notices it can also read None, or refer to the tender description or documents.",
          "Un avis d'appel d'offres fédéral énumère les accords commerciaux qui s'appliquent à l'approvisionnement. Le dictionnaire de données d'AchatsCanada définit ce champ comme une liste de tous les accords commerciaux internationaux qui s'appliquent, le cas échéant, et la ligne nomme aussi l'Accord de libre-échange canadien (ALEC), que le Conseil du Trésor range parmi les accords sur le commerce intérieur. Dans le fichier des avis ouverts d'AchatsCanada, elle peut aussi indiquer Aucun, ou renvoyer à la description ou aux documents de l'appel d'offres.",
        ),
        p(
          "A notice page on Award Watch shows the line under Trade agreements. This {example} lists thirteen agreements, among them the North American Free Trade Agreement (NAFTA), which has no row in the Treasury Board's threshold tables; this {acan} lists one, the CFTA.",
          "La page d'un avis sur Award Watch affiche la ligne sous Accords commerciaux. Cet {example} énumère treize accords, dont l'Accord de libre-échange nord-américain (ALENA), qui n'a aucune ligne dans les tableaux de seuils du Conseil du Trésor; ce {acan} n'en énumère qu'un, l'ALEC.",
          {
            example: a(EXAMPLE_NOTICE, "request for proposal", "appel d'offres"),
            acan: a(EXAMPLE_ACAN, "advance contract award notice", "préavis d'adjudication de contrat"),
          },
        ),
        figure(
          "trade-line", SAMPLE_NOTICE_SECURITY, "section.panel:has(> dl.wide)",
          both(
            "The Procurement panel of a tender notice's page on Award Watch: category, notice type, procurement method, selection criteria, the limited tendering reason, the trade agreements line, regions and provinces.",
            "Le panneau Approvisionnement de la page d'un avis d'appel d'offres sur Award Watch : catégorie, type d'avis, méthode d'approvisionnement, critères de sélection, motif de l'appel d'offres limité, ligne des accords commerciaux, régions et provinces.",
          ),
          both("A tender notice's trade agreements line on Award Watch.", "La ligne des accords commerciaux d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(field("dl.wide", 5),
              "A limited tendering reason gives the reason a contract is not awarded through competitive solicitation, and reads None where none applies.",
              "Le motif de l'appel d'offres limité donne la raison pour laquelle un contrat n'est pas attribué par voie concurrentielle, et indique Aucune lorsqu'aucun motif ne s'applique."),
            mark(field("dl.wide", 6), "A federal tender notice lists the trade agreements that apply to the procurement.",
              "Un avis d'appel d'offres fédéral énumère les accords commerciaux qui s'appliquent à l'approvisionnement."),
            mark("dl.wide > dt:nth-of-type(6) + dd li:nth-child(1)",
              "The line also names the Canadian Free Trade Agreement (CFTA), which the Treasury Board counts among the internal agreements.",
              "La ligne nomme aussi l'Accord de libre-échange canadien (ALEC), que le Conseil du Trésor range parmi les accords sur le commerce intérieur."),
            mark("dl.wide > dt:nth-of-type(6) + dd li:nth-child(5)",
              "The North American Free Trade Agreement (NAFTA) has no row in the Treasury Board's threshold tables.",
              "L'Accord de libre-échange nord-américain (ALENA) n'a aucune ligne dans les tableaux de seuils du Conseil du Trésor."),
          ],
        ),
      ],
    },
    {
      id: "coverage",
      title: both("When an Agreement Applies", "Quand un accord s'applique"),
      blocks: [
        p(
          "PSPC's Buyer's Guide has the buyer consider the procurement's value, the requesting entity, the type of requirement, any exclusion or exception, set-asides and measures for Indigenous Peoples. The value is estimated in Canadian dollars, options and applicable taxes included; at or above the thresholds in the Treasury Board's contracting policy notice, the procurement might be subject to the agreements. A procurement must not be divided, nor a valuation method chosen, to keep it outside them.",
          "Le Guide de l'acheteur de SPAC demande à l'acheteur de tenir compte de la valeur de l'approvisionnement, de l'entité requérante, du type d'exigence, des exclusions ou exceptions, des marchés réservés et des mesures pour les peuples autochtones. La valeur est estimée en dollars canadiens, options et taxes applicables comprises; si elle est égale ou supérieure aux seuils de l'avis sur la Politique sur les marchés du Conseil du Trésor, l'approvisionnement pourrait être assujetti aux accords. Un approvisionnement ne doit pas être divisé, ni une méthode d'évaluation choisie, pour le soustraire à leur application.",
        ),
        p(
          "All federal departments and agencies, and all Crown corporations, are subject to the CFTA save those the agreement lists as excepted; the international agreements name the entities they cover in Canada's market access schedules. All goods are covered by the CFTA unless specified otherwise, and for the Department of National Defence, the Royal Canadian Mounted Police and the Canadian Coast Guard the international agreements cover only certain goods.",
          "Tous les ministères et organismes fédéraux et toutes les sociétés d'État sont assujettis à l'ALEC, sauf les entités qu'il excepte; les accords internationaux nomment les entités qu'ils visent dans les listes d'engagements du Canada en matière d'accès aux marchés publics. Tous les biens sont visés par l'ALEC, sauf indication contraire, et pour le ministère de la Défense nationale, la Gendarmerie royale du Canada et la Garde côtière canadienne, les accords internationaux ne visent que certains biens.",
        ),
        p(
          "An exception, such as the national security exception, can exempt some or all of a procurement from certain obligations. Once it is invoked and applied to a requirement, every procurement document carries this statement: \"This procurement is subject to a national security exception and is, therefore, excluded from all of the obligations of the trade agreements.\"",
          "Une exception, comme l'exception au titre de la sécurité nationale, peut exempter une partie ou l'ensemble d'un approvisionnement de certaines obligations. Une fois qu'elle est invoquée et appliquée à un besoin, chaque document d'approvisionnement porte cet énoncé : « Le contrat est assujetti à l'exception au titre de la sécurité nationale et est, par conséquent, exempt de toute obligation liée aux accords commerciaux. »",
        ),
      ],
    },
    {
      id: "thresholds",
      title: both("The Thresholds in Force", "Les seuils en vigueur"),
      blocks: [
        p(
          "Treasury Board Contracting Policy Notice 2025-8, Trade Agreements: Thresholds Update, sets the thresholds in effect from January 1, 2026, to December 31, 2027, in Canadian dollars, and amends those of Contracting Policy Notice 2023-6; the thresholds are updated every two years. The notice's page gives no date of issue. The Treasury Board's index lists it under 2025, marked updated, and the page was last modified on February 4, 2026. For departments and agencies:",
          "L'Avis sur la Politique des marchés 2025-8 du Conseil du Trésor, Accords commerciaux : mise à jour des seuils, fixe les seuils en vigueur du 1er janvier 2026 au 31 décembre 2027, en dollars canadiens, et modifie ceux de l'Avis sur la Politique des marchés 2023-6; les seuils sont mis à jour tous les deux ans. La page de l'avis n'indique aucune date de publication. L'index du Conseil du Trésor le range sous 2025, avec la mention mise à jour, et la page a été modifiée pour la dernière fois le 4 février 2026. Pour les ministères et organismes :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "main", label: both("Agreement or partner", "Accord ou partenaire") },
            { kind: "value", label: both("Goods", "Biens") },
            { kind: "value", label: both("Services", "Services") },
            { kind: "value", label: both("Construction", "Construction") },
          ],
          rows: [
            [both("Canadian Free Trade Agreement (CFTA)", "Accord de libre-échange canadien (ALEC)"), { money: 34_700 }, { money: 139_000 }, { money: 139_000 }],
            [
              both(
                "European Union (CETA), Trans-Pacific (CPTPP), WTO (GPA), United Kingdom, Ukraine",
                "Union européenne (AECG), Transpacifique (PTPGP), OMC (AMP), Royaume-Uni, Ukraine",
              ),
              { money: 239_200 }, { money: 239_200 }, { money: 9_200_000 },
            ],
            [both("Peru", "Pérou"), { money: 174_800 }, { money: 174_800 }, { money: 9_200_000 }],
            [both("Chile, Colombia, Honduras, Panama", "Chili, Colombie, Honduras, Panama"), { money: 145_900 }, { money: 145_900 }, { money: 9_200_000 }],
            [both("Korea", "Corée"), { money: 100_000 }, { money: 100_000 }, { money: 9_200_000 }],
          ],
        },
        p("For Crown corporations and other government enterprises:", "Pour les sociétés d'État et autres entreprises du gouvernement :"),
        {
          kind: "table",
          cols: [
            { kind: "main", label: both("Agreement or partner", "Accord ou partenaire") },
            { kind: "value", label: both("Goods", "Biens") },
            { kind: "value", label: both("Services", "Services") },
            { kind: "value", label: both("Construction", "Construction") },
          ],
          rows: [
            [both("Canadian Free Trade Agreement (CFTA)", "Accord de libre-échange canadien (ALEC)"), { money: 694_700 }, { money: 694_700 }, { money: 6_943_900 }],
            [both("Chile, Colombia, Honduras, Panama, Peru", "Chili, Colombie, Honduras, Panama, Pérou"), { money: 729_700 }, { money: 729_700 }, { money: 23_300_000 }],
            [both("Trans-Pacific (CPTPP), WTO (GPA), Ukraine", "Transpacifique (PTPGP), OMC (AMP), Ukraine"), { money: 653_200 }, { money: 653_200 }, { money: 9_200_000 }],
            [both("European Union (CETA) and United Kingdom, Section A", "Union européenne (AECG) et Royaume-Uni, section A"), { money: 653_200 }, { money: 653_200 }, { money: 9_200_000 }],
            [both("European Union (CETA) and United Kingdom, Section B", "Union européenne (AECG) et Royaume-Uni, section B"), { money: 736_000 }, { money: 736_000 }, { money: 9_200_000 }],
          ],
        },
        p(
          "The notice shows no Crown corporation thresholds for the Korea agreement, and splits those of the European Union and United Kingdom agreements between Sections A and B. The Buyer's Guide notes that the Korea agreement currently has the lowest threshold for services, $100,000, and that meeting the WTO agreement's procedures for those services also meets the Korea agreement's.",
          "L'avis n'indique aucun seuil pour les sociétés d'État au titre de l'accord avec la Corée, et répartit ceux des accords avec l'Union européenne et le Royaume-Uni entre les sections A et B. Le Guide de l'acheteur précise que l'accord avec la Corée prévoit actuellement le seuil le plus bas pour les services, 100 000 $, et que le respect des obligations procédurales de l'AMP-OMC pour ces services satisfait aussi à celles de l'accord avec la Corée.",
        ),
      ],
    },
    {
      id: "notices",
      title: both("What Coverage Changes", "Ce que change la couverture"),
      blocks: [
        p(
          "Notice 2025-8 requires tender notices for procurements subject to the free trade agreements, published through the Government Electronic Tendering Service (GETS) on CanadaBuys. The Buyer's Guide requires covered competitive procurements, mini-tenders under a supply arrangement included, to be advertised on GETS unless specific exceptions apply; where the agreements differ, the buyer follows the provision with the highest standard of openness, such as the longer of two solicitation periods.",
          "L'avis 2025-8 exige des avis d'appel d'offres pour les approvisionnements assujettis aux accords de libre-échange, publiés par le Service électronique d'appels d'offres du gouvernement (SEAOG) sur AchatsCanada. Le Guide de l'acheteur exige que les marchés concurrentiels visés, y compris les mini-appels d'offres découlant d'un arrangement en matière d'approvisionnement, soient annoncés dans le SEAOG, à moins que des exceptions particulières ne s'appliquent; en cas d'incohérence entre les accords, l'acheteur suit la disposition qui offre la norme la plus élevée en matière de transparence, comme la plus longue de deux périodes de soumission.",
        ),
        p(
          "After the award, a procurement subject to the international agreements and the CFTA needs an award notice within 72 days. {complaint} requires a procurement covered by at least one trade agreement. {bid} sets out the steps from registration to the award, and the {bc} explains how its measures sit with these agreements.",
          "Après l'attribution, un approvisionnement assujetti aux accords internationaux et à l'ALEC exige un avis d'attribution dans les 72 jours. {complaint} exige un approvisionnement visé par au moins un accord commercial. {bid} présente les étapes, de l'inscription à l'attribution, et le {bc} explique comment ses mesures s'articulent avec ces accords.",
          {
            complaint: a(DEBRIEF_PATH, "A complaint to the Canadian International Trade Tribunal", "Une plainte au Tribunal canadien du commerce extérieur"),
            bid: a(BID_PATH, "How to Bid on Government of Canada Contracts", "Soumissionner sur les marchés du gouvernement du Canada"),
            bc: a(BUY_CANADIAN_PATH, "guide on the Buy Canadian Policy", "guide sur la Politique « Achetez canadien »"),
          },
        ),
      ],
    },
    {
      id: "limited",
      title: both("Limited Tendering", "Appel d'offres limité"),
      blocks: [
        p(
          "The Buyer's Guide names three tendering approaches under the agreements: open, selective and limited. Limited tendering lets a buyer depart from certain procedural obligations, such as notices, time periods and the treatment of tenders, in specific circumstances; the rules on technical specifications still apply. It is typically competitive, and can be non-competitive or a sole source when justified. The guide says it should not be used to avoid competition, to discriminate against any business or to protect domestic businesses.",
          "Le Guide de l'acheteur nomme trois approches d'appel d'offres dans le cadre des accords : ouverte, sélective et limitée. L'appel d'offres limité permet à l'acheteur de s'écarter de certaines obligations procédurales, comme les avis, les périodes et le traitement des offres, dans des circonstances particulières; les règles sur les spécifications techniques s'appliquent toujours. Il est en règle générale concurrentiel, et peut être non concurrentiel ou viser un fournisseur unique lorsque cela est justifié. Selon le guide, il ne devrait pas servir à éviter la concurrence, à discriminer une entreprise ou à protéger les entreprises nationales.",
        ),
        p(
          "A notice's limited tendering reason gives the reason a contract is not awarded through competitive solicitation, and is blank or None where none applies. CanadaBuys' data dictionary lists ten values. Beside each, the table gives the circumstance the Buyer's Guide summarizes for it and the agreements that allow it:",
          "Le motif de l'appel d'offres limité d'un avis donne la raison pour laquelle un contrat n'est pas attribué par voie concurrentielle, et reste vide ou indique Aucune lorsqu'aucun motif ne s'applique. Le dictionnaire de données d'AchatsCanada énumère dix valeurs. À côté de chacune, le tableau donne la circonstance que résume le Guide de l'acheteur et les accords qui la permettent :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Reason", "Motif") },
            { kind: "main", label: both("Circumstance (Buyer's Guide)", "Circonstance (Guide de l'acheteur)") },
            { kind: "label", label: both("Allowed by", "Permis par") },
          ],
          rows: [
            [
              both("Exclusive Rights", "Droits exclusifs"),
              both(
                "Only one business can supply the goods or services, with no reasonable alternative, because of patents, copyrights or other exclusive rights",
                "Une seule entreprise peut fournir les biens ou les services, sans solution de rechange raisonnable, en raison de brevets, de droits d'auteur ou d'autres droits exclusifs",
              ),
              both("All agreements", "Tous les accords"),
            ],
            [
              both("Additional Deliveries", "Livraisons supplémentaires"),
              both(
                "More deliveries by the original contractor, where a change of contractor cannot occur for economic or technical reasons and would cause significant inconvenience or substantial duplication of costs",
                "Des livraisons supplémentaires par l'entrepreneur initial, lorsqu'un changement de fournisseur ne peut se produire pour des raisons économiques ou techniques et causerait des inconvénients importants ou un dédoublement important des coûts",
              ),
              both("All agreements", "Tous les accords"),
            ],
            [
              both("No response to bid solicitation", "Aucune réponse à une invitation à soumissionner"),
              both(
                "An earlier notice or invitation drew no tenders, no conforming tenders, no business meeting the conditions for participation or only collusive tenders, and the requirements are not substantially modified",
                "Un avis ou une invitation antérieurs n'ont donné aucune soumission, aucune soumission conforme, aucune entreprise remplissant les conditions de participation ou seulement des soumissions collusoires, et les exigences ne sont pas modifiées substantiellement",
              ),
              both("All agreements", "Tous les accords"),
            ],
            [
              both("Extreme Urgency", "Extrême urgence"),
              both(
                "Only where strictly necessary, when unforeseeable events leave no time for open or selective tendering",
                "Seulement lorsque cela est strictement nécessaire, quand des événements imprévisibles ne laissent pas le temps de procéder par appel d'offres ouvert ou sélectif",
              ),
              both("All agreements", "Tous les accords"),
            ],
            [
              both("Goods Purchased on a Commodity Market", "Biens achetés sur un marché de produits de base"),
              both("Goods bought on a commodity market", "Des produits achetés sur un marché de produits de base"),
              both("All agreements", "Tous les accords"),
            ],
            [
              both("Consulting Services Regarding Matters of a Confidential Nature", "Services de consultation sur des questions de nature confidentielle"),
              both(
                "Consulting services on confidential matters whose disclosure could compromise government confidences, cause economic disruption or otherwise be contrary to the public interest",
                "Des services de consultation sur des questions confidentielles dont la divulgation pourrait compromettre des informations confidentielles du gouvernement, provoquer des perturbations économiques ou être contraire à l'intérêt public",
              ),
              both("CFTA; Chile, Colombia, Honduras, Panama, Peru", "ALEC; Chili, Colombie, Honduras, Panama, Pérou"),
            ],
            [
              both("Purchases Made Under Exceptionally Advantageous Conditions", "Achats effectués selon des conditions exceptionnellement avantageuses"),
              both(
                "Very short-term purchases in unusual disposals such as a liquidation, receivership or bankruptcy, and never routine purchases from regular suppliers",
                "Des achats à très court terme lors d'écoulements inhabituels comme une liquidation, une administration judiciaire ou une faillite, et jamais des achats courants auprès de fournisseurs habituels",
              ),
              both("All agreements", "Tous les accords"),
            ],
            [
              both("Subscriptions to newspapers, magazines, or other periodicals", "Abonnements à des journaux, à des magazines ou à d'autres périodiques"),
              both("Subscriptions to newspapers, magazines or other periodicals", "Des abonnements à des journaux, à des magazines ou à d'autres périodiques"),
              both("CFTA only", "ALEC seulement"),
            ],
            [
              both("Work on a property by a contractor according to a warranty or guarantee", "Travaux effectués sur un bien par un entrepreneur conformément à une garantie"),
              both(
                "Work on property by a contractor under a warranty or guarantee held on the property or the original work",
                "Des travaux exécutés sur un bien par un entrepreneur, conformément à une garantie visant le bien ou les travaux originaux",
              ),
              both("CFTA only", "ALEC seulement"),
            ],
            [
              both("Prototype Purchase", "Achat de prototype"),
              both(
                "A prototype or first good or service developed at Canada's request for a particular contract of research, experiment, study or original development",
                "Un prototype ou un premier bien ou service mis au point à la demande du Canada pour un contrat particulier de recherche, d'expérimentation, d'étude ou de développement original",
              ),
              both("All agreements", "Tous les accords"),
            ],
          ],
        },
        p(
          "The Buyer's Guide's lists hold circumstances with no value among these ten, such as a contract with the winner of a design contest. The two sources differ on confidential consulting. The dictionary, in its file last modified on March 24, 2026, marks the reason for contracts not covered by CETA, the CFTA, the WTO agreement, CPTPP, the Korea agreement or the Ukraine agreement. The Buyer's Guide, modified on August 7, 2026, allows it under the CFTA and the agreements with Chile, Colombia, Honduras, Panama and Peru.",
          "Les listes du Guide de l'acheteur comprennent des circonstances sans valeur correspondante parmi ces dix, comme un contrat avec le lauréat d'un concours de conception. Les deux sources diffèrent sur les services de consultation confidentiels. Le dictionnaire, dans son fichier modifié pour la dernière fois le 24 mars 2026, réserve ce motif aux marchés qui ne sont pas assujettis à l'AECG, à l'ALEC, à l'AMP-OMC, au PTPGP, à l'accord avec la Corée ou à l'accord avec l'Ukraine. Le Guide de l'acheteur, modifié le 7 août 2026, le permet dans le cadre de l'ALEC et des accords avec le Chili, la Colombie, le Honduras, le Panama et le Pérou.",
        ),
        p(
          "For a procurement subject to the agreements, a contract may be awarded without soliciting offers only where one of the applicable agreement's limited tendering reasons applies, and limited tendering does not always mean a non-competitive process. CanadaBuys' notice page heads the field Reason for limited tendering: on the {acan} it reads Exclusive Rights, and on the {example} it reads None. {guide} explains that notice type.",
          "Pour un approvisionnement assujetti aux accords, un contrat ne peut être attribué sans demande d'offres que si l'un des motifs d'appel d'offres limité de l'accord applicable s'applique, et l'appel d'offres limité ne signifie pas toujours un processus non concurrentiel. La page d'un avis sur AchatsCanada intitule ce champ Raison pour l'appel d'offres limité : sur le {acan}, il indique Droits exclusifs, et sur l'{example}, Aucune. {guide} explique ce type d'avis.",
          {
            acan: a(EXAMPLE_ACAN, "advance contract award notice above", "préavis d'adjudication de contrat ci-dessus"),
            example: a(EXAMPLE_NOTICE, "request for proposal above", "appel d'offres ci-dessus"),
            guide: a(ACAN_PATH, "Advance Contract Award Notices (ACANs) and Statements of Capabilities", "Préavis d'adjudication de contrat (PAC) et énoncés de capacités"),
          },
        ),
      ],
    },
  ],
  sources: [
    SRC.thresholds, SRC.policyNotices, SRC.tradeApplicability, SRC.tradeNotices, SRC.sourcing, SRC.dictionary, SRC.tenderData, SRC.atAward,
    SRC.followUp, SRC.exampleNotice, SRC.exampleAcan,
  ],
};

const SECURITY: Guide = {
  slug: SECURITY_PATH.slice("/guides/".length),
  title: both("Security Requirements on Federal Contracts: What a Notice Asks For", "Exigences de sécurité des contrats fédéraux : ce que demande un avis"),
  seoTitle: both("Security Requirements on Federal Contracts", "Exigences de sécurité des contrats fédéraux"),
  summary: both(
    "How a federal tender notice states its security requirements, the screening levels, who sponsors a clearance and when, and PSPC's stated processing times.",
    "Comment un avis fédéral indique ses exigences de sécurité, les niveaux d'enquête, qui parraine une attestation et quand, et les délais publiés par SPAC.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To keep track of new federal tender notices, those with security requirements among them, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux, y compris ceux qui comportent des exigences de sécurité, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "program",
      title: both("The Contract Security Program", "Le Programme de sécurité des contrats"),
      blocks: [
        p(
          "Public Services and Procurement Canada's Contract Security Program (CSP) security-screens organizations and their personnel for solicitations and contracts with security requirements. Those requirements specify the levels of security needed to safeguard sensitive information, assets and work sites, and federal contracts include clauses that contain them.",
          "Le Programme de sécurité des contrats (PSC) de Services publics et Approvisionnement Canada (SPAC) mène des enquêtes de sécurité sur les organisations et leur personnel pour les appels d'offres et les contrats comportant des exigences de sécurité. Ces exigences précisent les niveaux de sécurité requis pour protéger des renseignements, des biens ou des lieux de travail de nature délicate, et des clauses qui les énoncent sont incluses dans les contrats du gouvernement fédéral.",
        ),
        p(
          "An organization needs a security screening to take part in a solicitation or contract with security requirements, typically before it is awarded the resulting contract. Organization screening determines whether it meets those requirements; personnel screening determines whether an employee can be trusted with protected or classified information, assets or work sites.",
          "Une organisation a besoin d'une enquête de sécurité pour participer à un appel d'offres ou à un contrat comportant des exigences de sécurité, généralement avant l'attribution du contrat subséquent. L'enquête sur l'organisation détermine si elle satisfait à ces exigences; l'enquête sur le personnel détermine si un employé est digne de confiance avec des renseignements, des biens ou des lieux de travail protégés ou classifiés.",
        ),
        p(
          "PSPC's page on security requirements for contracting also lists {cyber}.",
          "La page de SPAC sur les exigences de sécurité des contrats présente aussi {cyber}.",
          { cyber: a(CYBER_PATH, "the cyber security certification of defence suppliers", "la certification en cybersécurité des fournisseurs de la défense") },
        ),
      ],
    },
    {
      id: "notice",
      title: both("How a Notice States It", "Comment un avis l'indique"),
      blocks: [
        p(
          "The CSP points to two places for a solicitation's security requirements: the bid solicitation documents included in the tender notice, and the Security Requirements Check List (form TBS/SCT 350-103) the contracting department completes. PSPC's Buyer's Guide requires the solicitation to set out the security needs and the timelines for meeting them, with the completed checklist as an annex; its signature page may be left out. PSPC's seminar notes place the requirements in Part 1, General information, of the solicitation document they outline.",
          "Le PSC indique deux endroits où trouver les exigences de sécurité d'un appel d'offres : les documents de demande de soumissions inclus dans l'avis d'appel d'offres, et la Liste de vérification des exigences relatives à la sécurité (formulaire SCT/TBS 350-103) que remplit le ministère responsable du contrat. Le Guide de l'acheteur de SPAC exige que la demande d'offres décrive les besoins en matière de sécurité et les échéanciers pour y satisfaire, la liste dûment remplie étant jointe en annexe; sa page de signature peut être omise. Les notes de séminaire de SPAC placent ces exigences dans la partie 1, Renseignements généraux, du document de demande de soumissions qu'elles décrivent.",
        ),
        p(
          "CanadaBuys' data dictionary has no field for security requirements. Where a notice's description states them, Award Watch shows it on the notice page, as on this {example}: its description says there are security requirements associated with the solicitation of offers, and refers the reader to the section on security clearances for more.",
          "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ pour les exigences de sécurité. Lorsque la description d'un avis les énonce, Award Watch l'affiche sur la page de l'avis, comme sur cet {example} : sa description indique que la demande d'offres comporte des exigences relatives à la sécurité, et renvoie à la section sur les attestations de sécurité pour plus de renseignements.",
          { example: a(EXAMPLE_NOTICE, "tender notice from Indigenous Services Canada", "avis d'appel d'offres de Services aux Autochtones Canada") },
        ),
        figure(
          "security-description", SAMPLE_NOTICE_SECURITY, "section.panel:has(.prose)",
          both(
            "The Description as Published panel of a tender notice's page on Award Watch, whose description states that the notice has security requirements and where they are set out.",
            "Le panneau de la description publiée de la page d'un avis d'appel d'offres sur Award Watch, dont la description indique que l'avis comporte des exigences de sécurité et où elles sont énoncées.",
          ),
          both("A tender notice's description on Award Watch.", "La description d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(".panel-head h2", "Where a notice's description states its security requirements, Award Watch shows it on the notice page.",
              "Lorsque la description d'un avis énonce ses exigences de sécurité, Award Watch l'affiche sur la page de l'avis."),
            mark(".prose p:nth-child(2)", "CanadaBuys' data dictionary has no field for security requirements; a notice's description can state them.",
              "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ pour les exigences de sécurité; la description d'un avis peut les énoncer."),
            mark(".prose p:nth-child(3)",
              "The CSP points to the bid solicitation documents included in the tender notice, and to the Security Requirements Check List the contracting department completes.",
              "Le PSC renvoie aux documents de demande de soumissions inclus dans l'avis d'appel d'offres et à la Liste de vérification des exigences relatives à la sécurité que remplit le ministère responsable du contrat."),
          ],
        ),
      ],
    },
    {
      id: "levels",
      title: both("Levels of Security", "Niveaux de sécurité"),
      blocks: [
        p(
          "Protected information and assets are those whose compromise could cause injury (Protected A), serious injury (Protected B) or extremely grave injury (Protected C) to an individual, organization or government. Classified ones could cause injury (Confidential), serious injury (Secret) or exceptionally grave injury (Top Secret) to the national interest. The CSP pairs each level with a work site zone and the screenings it requires:",
          "Les renseignements et biens protégés sont ceux qui, s'ils étaient compromis, pourraient porter préjudice (Protégé A), porter un préjudice grave (Protégé B) ou porter un préjudice extrêmement grave (Protégé C) à une personne, à une organisation ou à un gouvernement. Les renseignements et biens classifiés pourraient porter préjudice (Confidentiel), porter des préjudices graves (Secret) ou porter un préjudice extrêmement grave (Très secret) à l'intérêt national. Le PSC associe à chaque niveau une zone de travail et les enquêtes qu'il exige :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Information and assets", "Renseignements et biens") },
            { kind: "label", label: both("Work site", "Lieu de travail") },
            { kind: "text", label: both("Organization", "Organisation") },
            { kind: "main", label: both("Personnel", "Personnel") },
          ],
          rows: [
            [
              both("Top Secret", "Très secret"), both("High security zone", "Zone de haute sécurité"),
              both("Facility security clearance (Top Secret)", "Attestation de sécurité d'installation (Très secret)"), both("Top Secret clearance", "Autorisation de niveau Très secret"),
            ],
            [
              both("Secret", "Secret"), both("Security zone", "Zone de sécurité"),
              both("Facility security clearance (Confidential or Secret)", "Attestation de sécurité d'installation (Confidentiel ou Secret)"),
              both("Secret clearance", "Autorisation de niveau Secret"),
            ],
            [
              both("Confidential", "Confidentiel"), both("Operations zone", "Zone de travail"),
              both("Facility security clearance (Confidential or Secret)", "Attestation de sécurité d'installation (Confidentiel ou Secret)"),
              both("Secret clearance", "Autorisation de niveau Secret"),
            ],
            [
              both("Protected C", "Protégé C"), both("Security zone", "Zone de sécurité"),
              both("Designated organization screening", "Vérification d'organisation désignée"), both("Enhanced reliability status", "Cote de fiabilité approfondie"),
            ],
            [
              both("Protected A or B", "Protégé A ou B"), both("Operations zone", "Zone de travail"),
              both("Designated organization screening", "Vérification d'organisation désignée"), both("Reliability status", "Cote de fiabilité"),
            ],
          ],
        },
        p(
          "An employee with a security clearance may also access protected information. A provisional security clearance, at either level, covers the pre-solicitation and bid preparation stage.",
          "Un employé qui détient une autorisation de sécurité peut aussi accéder aux renseignements protégés. Une attestation de sécurité provisoire, à l'un ou l'autre niveau, vise l'étape de préqualification ou de préparation des soumissions.",
        ),
      ],
    },
    {
      id: "organization",
      title: both("Organization Screening", "Enquête sur l'organisation"),
      blocks: [
        {
          kind: "terms",
          items: [
            {
              term: both("Provisional security clearance", "Attestation de sécurité provisoire"),
              text: tx(
                "For an organization without the required level that needs access to protected or classified information or assets before or while preparing its bid. Valid for the bid solicitation process only; foreign organizations are not eligible.",
                "Pour une organisation qui n'a pas le niveau requis et doit accéder à des renseignements ou à des biens protégés ou classifiés avant ou pendant la préparation de sa soumission. Valide pour la durée du processus de demande de soumissions seulement; les organisations étrangères n'y sont pas admissibles.",
              ),
            },
            {
              term: both("Designated organization screening (DOS)", "Vérification d'organisation désignée (VOD)"),
              text: tx("Required to obtain contracts at the protected level. Valid for 2 years.", "Obligatoire pour obtenir des contrats de niveau protégé. Valide pendant 2 ans."),
            },
            {
              term: both("Facility security clearance (FSC)", "Attestation de sécurité d'installation (ASI)"),
              text: tx("Required to obtain contracts at the classified level. Valid for 1 year.", "Obligatoire pour obtenir des contrats de niveau classifié. Valide pendant 1 an."),
            },
          ],
        },
        p(
          "Once sponsored, the organization submits an Application for registration form signed and dated within the last 6 months, appoints a company security officer, has that officer and the other individuals the CSP requires complete personnel screening forms, and completes a security agreement that requires it to abide by the Contract Security Manual. At the end of the validity period, the CSP terminates the clearance of an organization that is in no other solicitation and performs no contract, subcontract or lease with security requirements.",
          "Une fois parrainée, l'organisation soumet un formulaire de Demande d'inscription signé et daté au cours des 6 derniers mois, nomme un agent de sécurité d'entreprise, fait remplir les formulaires d'enquête de sécurité sur le personnel par cet agent et par les autres personnes que le PSC exige, et conclut un accord de sécurité qui l'oblige à se conformer au Manuel de la sécurité des contrats. À la fin de la période de validité, le PSC met fin à l'attestation d'une organisation qui ne participe à aucun autre processus de demande de soumissions et n'exécute aucun contrat, contrat de sous-traitance ou bail comportant des exigences de sécurité.",
        ),
      ],
    },
    {
      id: "sponsorship",
      title: both("Who Sponsors a Clearance, and When", "Qui parraine une attestation, et à quel moment"),
      blocks: [
        p(
          "The CSP screens an organization only once a source the Government of Canada approves has sponsored it. For Canadian contracts these sources include federal procurement, security and project officers, and the security officer of a cleared contractor for a proposed subcontractor. Each clearance has its phase:",
          "Le PSC ne mène une enquête sur une organisation qu'une fois celle-ci parrainée par une source approuvée par le gouvernement du Canada. Pour les contrats canadiens, ces sources comprennent les agents d'approvisionnement, de sécurité et de projet fédéraux, et l'agent de sécurité d'une organisation autorisée pour un sous-traitant proposé. Chaque attestation a son étape :",
        ),
        {
          kind: "list",
          items: [
            tx(
              "Pre-solicitation and bid preparation: a federal procurement officer may sponsor a provisional clearance when protected or classified information must be accessed to respond to a request for information or an invitation to qualify, take part in industry engagement, attend a bidders' conference or bid on a request for proposals. The organization contacts the procurement officer named in the tender notice and provides a completed Application for registration form.",
              "Préqualification et préparation de la soumission : un agent d'approvisionnement fédéral peut parrainer une attestation provisoire lorsque l'accès à des renseignements protégés ou classifiés est nécessaire pour répondre à une demande de renseignements ou à une invitation à se qualifier, participer à une consultation de l'industrie, assister à une conférence des soumissionnaires ou répondre à une demande de propositions. L'organisation communique avec l'agent d'approvisionnement nommé dans l'avis d'appel d'offres et lui fournit un formulaire de Demande d'inscription complet.",
            ),
            tx(
              "Bid evaluation: the procurement officer may sponsor a DOS or an FSC when the resulting contract needs access to secure sites or to protected or classified information or assets, and the organization submitted a completed Application for registration form with its bid.",
              "Évaluation des offres : l'agent d'approvisionnement peut parrainer une VOD ou une ASI lorsque le contrat subséquent exige l'accès à des sites sécurisés ou à des renseignements ou à des biens protégés ou classifiés, et que l'organisation a présenté un formulaire de Demande d'inscription rempli avec sa soumission.",
            ),
            tx(
              "Sole source: a DOS or an FSC may be sponsored before award when an approved source shows that the organization needs that access to perform the contract.",
              "Fournisseur unique : une VOD ou une ASI peut être parrainée avant l'attribution lorsqu'une source approuvée démontre que l'organisation a besoin de cet accès pour exécuter le contrat.",
            ),
            tx(
              "Subcontracts: a prime contractor may request a clearance for a subcontractor only after the prime contract with security requirements is awarded and a copy given to the CSP, and only if that contract permits subcontracting. Organizations cannot request a pre-clearance, and must not require subcontractors to hold a clearance before a sub-solicitation.",
              "Sous-traitance : l'entrepreneur principal ne peut demander une attestation pour un sous-traitant qu'après l'attribution du contrat principal comportant des exigences de sécurité et la remise d'une copie au PSC, et seulement si ce contrat autorise la sous-traitance. Les organisations ne peuvent pas demander d'autorisation préalable ni exiger que leurs sous-traitants détiennent une attestation avant un processus de sous-sollicitation.",
            ),
          ],
        },
        p(
          "Where screening is mandatory, PSPC's Buyer's Guide has the solicitation include the Application for registration form, which offerors submit with their offer even if already cleared. The CSP confirms in writing to the buyer, before award, whether offerors meet the security requirements. If the recommended offeror cannot obtain the clearance and no risk mitigation is agreed, the buyer may need to select the next highest-ranked compliant offeror.",
          "Lorsque l'enquête est obligatoire, le Guide de l'acheteur de SPAC prévoit que la demande d'offres comprenne le formulaire de Demande d'inscription, que les offrants soumettent avec leur offre même s'ils détiennent déjà les autorisations requises. Le PSC confirme par écrit à l'acheteur, avant l'attribution, si les offrants satisfont aux exigences de sécurité. Si l'offrant recommandé ne peut pas obtenir l'autorisation et qu'aucune mesure d'atténuation des risques n'est convenue, l'acheteur peut devoir sélectionner le prochain offrant conforme le mieux classé.",
        ),
      ],
    },
    {
      id: "personnel",
      title: both("Personnel Screening", "Enquête sur le personnel"),
      blocks: [
        p(
          "An organization must itself be screened before it requests screening for its employees, and individuals cannot initiate their own: the company security officer or the alternate does so for them, and the screening belongs to the organization. An employee who needs access to protected or classified information, assets or work sites must be screened before work begins. The levels are reliability status for protected access, a security clearance for classified access, and enhanced security screening for personnel who support security and intelligence functions.",
          "Une organisation doit elle-même avoir fait l'objet d'une enquête avant de demander des enquêtes pour ses employés, et les personnes ne peuvent pas initier leur propre enquête : l'agent de sécurité d'entreprise ou son remplaçant le fait pour elles, et l'enquête appartient à l'organisation. Un employé qui doit accéder à des renseignements, à des biens ou à des lieux de travail protégés ou classifiés doit faire l'objet d'une enquête avant le début des travaux. Les niveaux sont la cote de fiabilité pour l'accès protégé, l'autorisation de sécurité pour l'accès classifié et l'enquête de sécurité approfondie pour les employés qui exercent des fonctions liées à la sécurité et au renseignement.",
        ),
      ],
    },
    {
      id: "time",
      title: both("How Long It Takes", "Délais"),
      blocks: [
        p(
          "Organization screening starts once the CSP confirms the organization's eligibility, and personnel screening once it receives a properly completed request.",
          "L'enquête sur l'organisation commence une fois que le PSC confirme l'admissibilité de l'organisation, et l'enquête sur le personnel une fois qu'il reçoit une demande dûment remplie.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Screening", "Enquête") },
            { kind: "main", label: both("Time stated by the CSP", "Délai indiqué par le PSC") },
          ],
          rows: [
            [both("Provisional security clearance", "Attestation de sécurité provisoire"), both("Varies with the level", "Variable selon le niveau")],
            [both("Designated organization screening", "Vérification d'organisation désignée"), both("Up to 4 months", "Jusqu'à 4 mois")],
            [both("Facility security clearance", "Attestation de sécurité d'installation"), both("6 months or more", "6 mois ou plus")],
            [both("Reliability status, simple request", "Cote de fiabilité, demande simple"), both("7 business days", "7 jours ouvrables")],
            [both("Reliability status, complex request", "Cote de fiabilité, demande complexe"), both("120 business days", "120 jours ouvrables")],
            [
              both("Secret clearance, simple request", "Cote de sécurité de niveau Secret, demande simple"),
              both("75 business days, in addition to the reliability screening", "75 jours ouvrables, en plus du délai de vérification de la fiabilité"),
            ],
            [
              both("Secret clearance, complex request", "Cote de sécurité de niveau Secret, demande complexe"),
              both("120 business days, in addition to the reliability screening", "120 jours ouvrables, en plus du délai de vérification de la fiabilité"),
            ],
          ],
        },
        p(
          "The organization times depend on the forms' completeness, the organization's response time, the level and the complexity of the organization and individuals screened; additional safeguards add to them. A personnel request is complex when the background needs more checks, such as an out-of-country verification for an applicant who lived in another country continuously for 6 months or longer during the period assessed. The CSP charges no fee for personnel screening; the applicant pays for fingerprints and police certificates. The organization times are from a CSP page modified in June 2026, and the personnel times from one last modified in 2025.",
          "Les délais de l'enquête sur l'organisation dépendent de l'exhaustivité des formulaires, de la rapidité de réponse de l'organisation, du niveau et de la complexité de l'organisation et des personnes visées; les mesures de sécurité supplémentaires les allongent. Une demande d'enquête sur le personnel est complexe lorsque les antécédents exigent des vérifications supplémentaires, comme une vérification hors du pays si le demandeur a vécu de manière continue 6 mois ou plus dans un autre pays pendant la période évaluée. Le PSC n'impose pas de frais pour l'enquête sur le personnel; le demandeur paie les empreintes digitales et les certificats de police. Les délais touchant les organisations viennent d'une page du PSC modifiée en juin 2026, et ceux touchant le personnel d'une page modifiée pour la dernière fois en 2025.",
        ),
      ],
    },
  ],
  sources: [
    SRC.cspScreening, SRC.cspOrganization, SRC.cspProvisional, SRC.cspSponsorship, SRC.cspLevels, SRC.cspPersonnel, SRC.cspTimes,
    SRC.securitySolicitations, SRC.seminar, SRC.dictionary, SRC.exampleNotice, SRC.cspIndex,
  ],
};

const CYBER: Guide = {
  slug: CYBER_PATH.slice("/guides/".length),
  title: both("Cyber Security Certification for Defence Suppliers (CPCSC)", "La certification en cybersécurité des fournisseurs de la défense (PCCC)"),
  seoTitle: both("Cyber Security Certification for Defence Suppliers", "Certification en cybersécurité des fournisseurs de défense"),
  summary: both(
    "The Canadian Program for Cyber Security Certification: its three levels, the standard, the phases and dates, and where a solicitation states it.",
    "Le Programme canadien de certification en cybersécurité : ses trois niveaux, la norme, les étapes et les dates, et où une demande de soumissions l'indique.",
  ),
  checked: "2026-11-15",
  action: tenderList(
    "To follow new federal tender notices as they are posted, National Defence's among them, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux à mesure qu'ils sont publiés, y compris ceux de la Défense nationale, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "program",
      title: both("What the Program Is", "Ce qu'est le programme"),
      blocks: [
        p(
          "Public Services and Procurement Canada (PSPC) describes the Canadian Program for Cyber Security Certification (CPCSC) as an official cyber security certification in Canada for defence suppliers. Managed by PSPC, it is made up of accredited bodies, certified assessors and government oversight. PSPC's backgrounder of April 14, 2026, says Budget 2023 allocated $25 million over three years to establish the program, led by PSPC and National Defence.",
          "Services publics et Approvisionnement Canada (SPAC) décrit le Programme canadien de certification en cybersécurité (PCCC) comme une certification officielle en matière de cybersécurité au Canada pour les fournisseurs du secteur de la défense. Géré par SPAC, il est composé d'organismes accrédités, d'évaluateurs certifiés et d'une surveillance gouvernementale. Le document d'information de SPAC du 14 avril 2026 indique que le budget de 2023 a affecté 25 millions de dollars sur trois ans à la mise sur pied du programme, dirigé par SPAC et la Défense nationale.",
        ),
        p("PSPC's program overview gives the bodies involved these roles:", "L'aperçu du programme de SPAC donne aux organismes participants les rôles suivants :"),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Body", "Organisme") },
            { kind: "main", label: both("Role under the program overview", "Rôle selon l'aperçu du programme") },
          ],
          rows: [
            [
              both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"),
              both(
                "The federal lead, responsible for program coordination across government, development of certification processes and overall implementation",
                "Le responsable fédéral, chargé de la coordination des programmes à l'échelle du gouvernement, de l'élaboration des processus de certification et de la mise en œuvre globale",
              ),
            ],
            [
              both("National Defence", "Défense nationale"),
              both(
                "Performs the highest level of cyber security assessments (Level 3) and collaborates with PSPC to ensure that cyber security requirements reflect the needs of the defence community",
                "Effectue le plus haut niveau d'évaluation de la cybersécurité (niveau 3) et collabore avec SPAC pour s'assurer que les exigences en matière de cybersécurité tiennent compte des besoins de la communauté de la défense",
              ),
            ],
            [
              both("Standards Council of Canada", "Conseil canadien des normes"),
              both(
                "Accredits the certification bodies that conduct external assessments (Level 2)",
                "Accrédite les organismes de certification qui effectuent des évaluations externes (niveau 2)",
              ),
            ],
            [
              both("Canadian Centre for Cyber Security, part of the Communications Security Establishment", "Centre canadien pour la cybersécurité, qui relève du Centre de la sécurité des télécommunications"),
              both(
                "Developed the Canadian cyber security standard (ITSP.10.171) that forms the foundation of the program's controls",
                "A élaboré la norme canadienne sur la cybersécurité (ITSP.10.171) qui constitue le fondement des contrôles du programme",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "information",
      title: both("The Information and Contracts It Covers", "Les renseignements et les contrats visés"),
      blocks: [
        p(
          "The program protects federal specified information on suppliers' networks, systems and applications. PSPC's Level 1 page defines specified information as sensitive, non-classified, government information that must be protected when handled, processed, or stored by non-Government of Canada organizations; a Government of Canada authority identifies and qualifies in a contract which information requires safeguarding. Specified information may include:",
          "Le programme protège l'information désignée du gouvernement fédéral sur les réseaux, les systèmes et les applications des fournisseurs. La page de SPAC sur le niveau 1 définit l'information désignée comme de l'information gouvernementale de nature délicate et non classifiée qui doit être protégée lorsqu'elle est manipulée, traitée ou consignée par des organisations ne relevant pas du gouvernement du Canada; un responsable du gouvernement du Canada détermine et qualifie dans un contrat les renseignements qui doivent être protégés. L'information désignée peut comprendre :",
        ),
        {
          kind: "list",
          items: [
            tx(
              "unclassified information with contract details not intended for public release, between the contractor and the Department of National Defence",
              "des renseignements non classifiés comportant des détails sur le contrat entre l'entrepreneur et le ministère de la Défense nationale, qui ne sont pas destinés au grand public",
            ),
            tx("controlled goods information", "des renseignements sur les marchandises contrôlées"),
            tx("protected information", "des renseignements protégés"),
          ],
        },
        p(
          "The same page says that not all defence contracts will require Level 1; for example, commercial off the shelf contracts may not be subject to cyber security certification requirements. Going forward, it says, defence contracts, and other sensitive contracts outside defence, will need to be certified under the CPCSC ITSP.10.171 standard, based on their risk level.",
          "La même page indique que ce ne sont pas tous les contrats de défense qui nécessiteront le niveau 1; par exemple, les contrats commerciaux disponibles sur le marché peuvent ne pas être soumis aux exigences de certification en matière de cybersécurité. À l'avenir, selon elle, les contrats de défense et d'autres contrats de nature délicate non liés à la défense devront être assortis d'une certification conformément à la norme ITSP.10.171 du PCCC, en fonction de leur niveau de risque.",
        ),
        p(
          "PSPC's page of additional information sets out the roles of contractors and subcontractors:",
          "La page de SPAC sur les renseignements supplémentaires énonce les rôles des entrepreneurs et des sous-traitants :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Party", "Partie") },
            { kind: "main", label: both("What the page says", "Ce que dit la page") },
          ],
          rows: [
            [
              both("Contractor", "Entrepreneur"),
              both(
                "Before permitting a subcontractor to access, process, transmit or store specified information, must determine whether the subcontract requires access to specified information and identify the applicable CPCSC requirements. Is responsible for flowing the applicable requirements into the subcontract and confirming that the subcontractor holds a current and appropriately scoped CPCSC declaration or certification before access to specified information is granted. Must document the basis for its subcontractor applicability decisions",
                "Avant de permettre à un sous-traitant d'accéder à de l'information désignée, de la traiter, de la transmettre ou de la stocker, doit déterminer si le contrat de sous-traitance exige l'accès à l'information désignée et déterminer les exigences applicables du PCCC. Il lui incombe d'intégrer les exigences applicables dans le contrat de sous-traitance et de confirmer que le sous-traitant détient une déclaration ou une certification du PCCC à jour et dont la portée est appropriée avant que l'accès à l'information désignée ne soit accordé. Doit documenter le fondement de ses décisions quant à l'applicabilité aux sous-traitants",
              ),
            ],
            [
              both("Subcontractor", "Sous-traitant"),
              both(
                "Is responsible for defining the systems, assets, personnel, facilities and activities within its assessment scope; implementing and maintaining the applicable CPCSC requirements; completing the required self-assessment or third-party assessment; retaining records and evidence supporting its CPCSC status; and renewing its declaration or certification before it expires",
                "Est responsable de définir les systèmes, les biens, le personnel, les installations et les activités compris dans la portée de son évaluation; de mettre en œuvre et de maintenir les exigences applicables du PCCC; d'effectuer l'autoévaluation requise ou l'évaluation par un tiers; de conserver les dossiers et les preuves à l'appui de son statut au PCCC; et de renouveler sa déclaration ou sa certification avant son expiration",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "levels",
      title: both("The Three Levels", "Les trois niveaux"),
      blocks: [
        p(
          "Under the program overview, the program's mandatory cyber security certification requirements are organized into 3 levels, with Level 1 launched in April 2026. Levels 2 and 3 are under development; their rows give what PSPC says they will require once they become available.",
          "Selon l'aperçu du programme, les exigences obligatoires du programme en matière de certification en cybersécurité sont organisées en 3 niveaux, le niveau 1 ayant été lancé en avril 2026. Les niveaux 2 et 3 sont en cours d'élaboration; leurs lignes donnent ce que SPAC indique qu'ils exigeront une fois disponibles.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Level", "Niveau") },
            { kind: "main", label: both("What it requires", "Ce qu'il exige") },
            { kind: "count", label: both("Controls", "Contrôles") },
          ],
          rows: [
            [
              both("Level 1", "Niveau 1"),
              both(
                "An annual cyber security self-assessment, which confirms the implementation status of 13 security requirements and controls found in the standard. Suppliers can attest that they meet the 13 controls without using the online self-assessment tool; its use is encouraged",
                "Une autoévaluation annuelle de la cybersécurité, qui confirme l'état d'avancement de la mise en œuvre de 13 exigences et contrôles de sécurité figurant dans la norme. Les fournisseurs peuvent attester qu'ils répondent aux 13 contrôles sans utiliser l'outil d'autoévaluation en ligne; son utilisation est conseillée",
              ),
              both("13", "13"),
            ],
            [
              both("Level 2", "Niveau 2"),
              both(
                "External cyber security assessments led by an accredited certification body, plus an annual affirmation. Third-party assessors will be accredited by the Standards Council of Canada, as the chosen accreditation body for the program",
                "Des évaluations externes de la cybersécurité dirigées par un organisme de certification accrédité, plus une confirmation annuelle. Les évaluateurs tiers seront accrédités par le Conseil canadien des normes, en tant qu'organisme d'accréditation désigné du programme",
              ),
              both("98", "98"),
            ],
            [
              both("Level 3", "Niveau 3"),
              both(
                "Cyber security assessments conducted by the Government of Canada, plus an annual affirmation",
                "Des évaluations de la cybersécurité menées par le gouvernement du Canada, plus une confirmation annuelle",
              ),
              both("130+", "Plus de 130"),
            ],
          ],
        },
        p(
          "For Level 3, the program overview, modified September 29, 2026, names National Defence as the assessor, and the page of additional information, modified October 14, 2026, the Government of Canada; the backgrounder of April 14, 2026, uses both. The backgrounder sets the Level 2 and Level 3 assessments at every three years.",
          "Pour le niveau 3, l'aperçu du programme, modifié le 29 septembre 2026, désigne la Défense nationale comme évaluateur, et la page des renseignements supplémentaires, modifiée le 14 octobre 2026, le gouvernement du Canada; le document d'information du 14 avril 2026 emploie l'un et l'autre. Le document d'information prévoit les évaluations des niveaux 2 et 3 tous les trois ans.",
        ),
      ],
    },
    {
      id: "standard",
      title: both("The Standard", "La norme"),
      blocks: [
        p(
          "The standard is the Canadian Centre for Cyber Security's ITSP.10.171, which PSPC calls the Canadian industrial security standard. The publication says:",
          "La norme est l'ITSP.10.171 du Centre canadien pour la cybersécurité, que SPAC appelle la norme canadienne sur la sécurité industrielle. La publication indique :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Item", "Élément") },
            { kind: "main", label: both("What the standard says", "Ce que dit la norme") },
          ],
          rows: [
            [
              both("Title", "Titre"),
              both(
                "Protecting specified information in non-Government of Canada systems and organizations",
                "Protection de l'information désignée dans les organisations et les systèmes ne relevant pas du gouvernement du Canada",
              ),
            ],
            [
              both("Effective date and releases", "Entrée en vigueur et versions"),
              both(
                "The publication takes effect on April 2, 2025. Its revision history gives a first release on April 2, 2025, and a second release on October 28, 2025",
                "Le document entre en vigueur le 2 avril 2025. Son historique des révisions indique une première version le 2 avril 2025 et une deuxième version le 28 octobre 2025",
              ),
            ],
            [
              both("Basis", "Fondement"),
              both(
                "A Canadian version of NIST SP 800-171, Protecting Controlled Unclassified Information in Nonfederal Systems and Organizations, with no substantial technical changes; it uses the term specified information in place of controlled unclassified information",
                "La version canadienne du document NIST SP 800-171, Protecting Controlled Unclassified Information in Nonfederal Systems and Organizations, sans changement technique important; elle emploie le terme « information désignée » à la place du terme anglais « controlled unclassified information »",
              ),
            ],
            [
              both("Specified information", "Information désignée"),
              both(
                "Includes any information, other than classified, that a Government of Canada authority identifies and qualifies in a contract as requiring safeguarding",
                "Comprend toute information autre que classifiée qu'une autorité du gouvernement du Canada désigne et mentionne dans un contrat comme devant faire l'objet d'une sauvegarde",
              ),
            ],
            [
              both("Scope", "Portée"),
              both(
                "The security requirements are only applicable to components of non-Government of Canada systems that handle, process, store, or transmit specified information or that provide protection for such components",
                "Les exigences de sécurité ne s'appliquent qu'aux composants des systèmes ne relevant pas du gouvernement du Canada qui gèrent, traitent, stockent ou transmettent de l'information désignée ou qui protègent de tels composants",
              ),
            ],
            [
              both("Use", "Utilisation"),
              both(
                "The requirements are intended to be used by Government of Canada departments and agencies in contractual vehicles or other agreements established with non-Government of Canada organizations",
                "Les exigences serviront aux ministères et aux organismes du gouvernement du Canada dans le cadre de contrats ou d'autres ententes établies avec des organisations ne relevant pas du gouvernement du Canada",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "phases",
      title: both("Phases and Dates", "Étapes et dates"),
      blocks: [
        p(
          "PSPC says the requirement will be implemented in phases, starting with the inclusion of Level 1 requirements in select National Defence contracts. The dates, with the page that gives each:",
          "SPAC indique que l'exigence sera mise en œuvre par étapes, en commençant par l'inclusion des exigences de niveau 1 dans certains contrats de la Défense nationale. Les dates, avec la page qui donne chacune :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("When", "Quand") },
            { kind: "main", label: both("What the page says", "Ce que dit la page") },
            { kind: "text", label: both("Page", "Page") },
          ],
          rows: [
            [
              both("March 12, 2025", "12 mars 2025"),
              both(
                "The program was officially introduced to the public, which launched a new Canadian industrial cyber security standard, the opening of the accreditation ecosystem and a pilot program focusing on select defence contracts through self-assessment",
                "Le programme a été présenté officiellement au public, ce qui a lancé une nouvelle norme canadienne sur la cybersécurité industrielle, le système d'accréditation et un programme pilote mettant à l'essai l'autoévaluation pour certains contrats de défense",
              ),
              both("Backgrounder, April 14, 2026", "Document d'information, 14 avril 2026"),
            ],
            [
              both("April 1, 2026", "1er avril 2026"),
              both("Level 1 available to suppliers", "Niveau 1 accessible aux fournisseurs"),
              both("Backgrounder, April 14, 2026", "Document d'information, 14 avril 2026"),
            ],
            [
              both("Beginning in summer 2026", "À compter de l'été 2026"),
              both("Level 1 will be required in select defence contracts", "Le niveau 1 sera exigé dans certains contrats de défense"),
              both("News release, April 14, 2026", "Communiqué, 14 avril 2026"),
            ],
            [
              both("Spring 2026 to spring 2027", "Du printemps 2026 au printemps 2027"),
              both(
                "The Government of Canada introduces a Level 1 self-assessment tool and support materials; National Defence contracts will be assessed using a new contract \"Cyber Security Risk Assessment\"; Level 1 to 3 certification requirements may be identified in select defence contracts as early as summer 2026, and compliance will be required at a later date; guidance for Levels 2 and 3 will be provided in advance",
                "Le gouvernement du Canada met en place un outil d'autoévaluation de niveau 1 et des documents d'appui; les contrats de la Défense nationale seront évalués au moyen d'une nouvelle « Évaluation des risques liés à la cybersécurité »; des exigences de certification de niveaux 1 à 3 pourraient être définies dans certains contrats de défense dès l'été 2026, et la conformité ne sera exigée qu'à une date ultérieure; des directives pour les niveaux 2 et 3 seront communiquées à l'avance",
              ),
              both("Additional information, modified October 14, 2026", "Renseignements supplémentaires, modifiée le 14 octobre 2026"),
            ],
            [
              both("Beginning in spring 2027", "À compter du printemps 2027"),
              both("Level 2 will be added to select defence contracts", "Le niveau 2 sera intégré à certains contrats de défense"),
              both("Backgrounder, April 14, 2026", "Document d'information, 14 avril 2026"),
            ],
            [
              both("Spring 2027 to spring 2028", "Du printemps 2027 au printemps 2028"),
              both(
                "The requirement to have Level 2 or 3 certification will be gradually incorporated into select defence contracts; Level 3 requirements and certification compliance activities will be conducted by Government of Canada authorities",
                "L'exigence d'avoir une certification de niveau 2 ou 3 sera graduellement intégrée à certains contrats de défense; les exigences de niveau 3 et les activités de conformité relatives aux certifications seront menées par les responsables du gouvernement du Canada",
              ),
              both("Additional information, modified October 14, 2026", "Renseignements supplémentaires, modifiée le 14 octobre 2026"),
            ],
          ],
        },
        p(
          "PSPC's Level 1 page, modified September 29, 2026, says that beginning in summer 2026, suppliers bidding on select defence contracts may need to obtain Level 1 certification. None of the pages read says which contracts have required it. PSPC's earlier news releases gave earlier dates:",
          "La page de SPAC sur le niveau 1, modifiée le 29 septembre 2026, indique qu'à compter de l'été 2026, les fournisseurs qui soumissionnent pour certains contrats de défense pourraient devoir obtenir une certification de niveau 1. Aucune des pages lues n'indique quels contrats l'ont exigée. Les communiqués antérieurs de SPAC donnaient des dates antérieures :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Release", "Communiqué") },
            { kind: "main", label: both("What it said", "Ce qu'il indiquait") },
          ],
          rows: [
            [
              both("May 31, 2023", "31 mai 2023"),
              both(
                "The Government of Canada will develop and implement a Canadian program for cyber security certification that will result in mandatory certification requirements in select federal defence contracts as early as winter 2024",
                "Le gouvernement du Canada élaborera et mettra en œuvre un programme canadien de certification en matière de cybersécurité qui se traduira par la mise en place d'exigences de certification obligatoires dans certains contrats de défense fédéraux, et ce, dès l'hiver 2024",
              ),
            ],
            [
              both("March 12, 2025", "12 mars 2025"),
              both(
                "Phase 2 (fall 2025): some defence contracts will require level 1 certification, achieved through a self-assessment, and level 2 certification will be tested in certain defence contracts. Phase 3 (spring 2026): some defence contracts will start requiring level 2 certification, and level 3 certification will officially begin following publication of the additional level 3 controls. Phase 4 (2027): for a small number of contracts, level 3 certification requirements will gradually be incorporated into select defence requests for proposals",
                "Phase 2 (automne 2025) : certains contrats de défense nécessiteront une certification de niveau 1 réalisée par autoévaluation, et la certification de niveau 2 sera mise à l'essai pour certains contrats de défense. Phase 3 (printemps 2026) : la certification de niveau 2 commencera à être exigée pour certains contrats de défense, et la certification de niveau 3 sera officiellement lancée à la suite de la publication des contrôles supplémentaires liés au niveau 3. Phase 4 (2027) : pour un petit nombre de contrats, les exigences liées à la certification de niveau 3 seront intégrées graduellement dans un certain nombre de demandes de propositions concernant la défense",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "solicitation",
      title: both("How a Solicitation States It", "Comment une demande de soumissions l'indique"),
      blocks: [
        p(
          "Once Levels 2 and 3 are established, PSPC says, a standardized cyber security risk assessment will evaluate each National Defence contract and determine which certification level is required. The required level will be set on a contract-by-contract basis and clearly communicated in requests for proposals and contract clauses. The risk assessment process will serve as an addendum to the Security Requirements Checklist to document CPCSC requirements in the contract, and mandatory sections or provisions in National Defence procurement documents, such as requests for proposals, will specify the required level. Suppliers seeking certification must always refer to the requirements outlined in their specific contracts or solicitation documents.",
          "Une fois les niveaux 2 et 3 établis, selon SPAC, une évaluation normalisée des risques en matière de cybersécurité permettra d'évaluer chaque contrat de la Défense nationale et de déterminer le niveau de certification requis. Le niveau requis sera établi contrat par contrat et clairement communiqué dans les demandes de propositions et les clauses contractuelles. Le processus d'évaluation des risques servira d'addenda à la Liste de vérification des exigences relatives à la sécurité pour documenter les exigences du PCCC dans le contrat, et des sections ou dispositions obligatoires des documents d'approvisionnement de la Défense nationale, comme les demandes de propositions, préciseront le niveau requis. Les fournisseurs qui souhaitent obtenir la certification doivent toujours se référer aux exigences décrites dans leurs contrats ou leurs documents d'appel d'offres.",
        ),
        p(
          "PSPC's Level 1 page says the Level 1 self-assessment will be required at contract award, and not during the bidding process. Once it is completed, suppliers must provide proof of self-attestation and its expiry date to their CanadaBuys profile, and when they submit a bid. Before awarding a contract that requires Level 1, PSPC will confirm that the supplier has recorded a current Level 1 self-assessment declaration in its CanadaBuys Supplier Profile. PSPC calls this an administrative confirmation of the supplier's CPCSC status that does not represent an independent technical assessment or certification of the supplier's systems, security controls or supporting evidence.",
          "La page de SPAC sur le niveau 1 indique que l'autoévaluation de niveau 1 sera requise à l'attribution du contrat, et non pendant le processus d'appel d'offres. Une fois l'autoévaluation terminée, les fournisseurs doivent fournir une preuve d'autoévaluation et sa date d'expiration dans leur profil sur AchatsCanada, et lorsqu'ils présentent une soumission. Avant d'attribuer un contrat qui exige le niveau 1, SPAC confirmera que le fournisseur a enregistré une déclaration d'autoévaluation de niveau 1 à jour dans son profil de fournisseur AchatsCanada. SPAC précise qu'il s'agit d'une confirmation administrative du statut du fournisseur au PCCC, qui ne constitue pas une évaluation technique indépendante ou une certification de ses systèmes, de ses contrôles de sécurité ou des preuves à l'appui.",
        ),
      ],
    },
    {
      id: "beside",
      title: both("Beside Security Screening and the U.S. Program", "À côté des enquêtes de sécurité et du programme américain"),
      blocks: [
        p(
          "PSPC's page on security requirements for contracting with the Government of Canada lists the certification under safeguards for sensitive information, on the same page as its links on security screening, which the {security} explains. Its page of additional information says suspected or confirmed cyber security incidents must be reported in accordance with the authorities, procedures and timelines established in the contract and applicable Contract Security Program guidance, and that a lapse in CPCSC status or a failure to maintain an applicable requirement is distinct from such an incident. None of the pages read says how a certification relates to an organization's security screening.",
          "La page de SPAC sur les exigences de sécurité des contrats du gouvernement du Canada range la certification sous la protection des renseignements de nature délicate, sur la même page que ses liens sur les enquêtes de sécurité, qu'explique le {security}. Sa page sur les renseignements supplémentaires indique que les incidents de cybersécurité soupçonnés ou confirmés doivent être signalés conformément aux autorisations, aux procédures et aux échéanciers établis dans le contrat et aux directives applicables du Programme de sécurité des contrats, et qu'une défaillance du statut au PCCC ou un défaut de maintenir une exigence applicable est distinct d'un tel incident. Aucune des pages lues n'indique comment une certification s'articule avec l'enquête de sécurité d'une organisation.",
          { security: a(SECURITY_PATH, "guide on security requirements", "guide sur les exigences de sécurité") },
        ),
        p(
          "PSPC's Level 1 page says the program aligns with the United States' Cybersecurity Maturity Model Certification (CMMC) requirements and does not duplicate the U.S. certification system, and that both countries use the same technical controls. The backgrounder says the Canadian industrial cyber security standards are technically identical to the 172 controls in NIST Special Publications 800-171 and 800-172, which form the backbone of the U.S. CMMC program.",
          "La page de SPAC sur le niveau 1 indique que le programme s'aligne sur les exigences de la Cybersecurity Maturity Model Certification (CMMC) des États-Unis et ne reproduit pas le système de certification américain, et que les deux pays utilisent les mêmes contrôles techniques. Le document d'information indique que les normes canadiennes sur la cybersécurité industrielle sont identiques sur le plan technique aux 172 contrôles des publications spéciales 800-171 et 800-172 du NIST, qui constituent la base du programme CMMC des États-Unis.",
        ),
        p(
          "Under the Level 1 page, the Government of Canada may accept a contractor's valid CMMC certification on a case-by-case basis, after confirming that the assessment covers the required scope, and Canada reserves the right to verify compliance with specific CMMC controls when necessary; any verification would be carried out by the contract technical authority. PSPC's news release of May 31, 2023, said the program would aim to reduce industry burden by pursuing mutual recognition between Canada and the U.S.; none of the later pages read uses that term.",
          "Selon la page sur le niveau 1, le gouvernement du Canada peut accepter au cas par cas une certification CMMC valide d'un entrepreneur, après avoir confirmé que l'évaluation englobe la portée requise, et le Canada se réserve le droit de vérifier, au besoin, la conformité à des contrôles précis de la CMMC; toute vérification serait effectuée par le responsable technique du contrat. Le communiqué de SPAC du 31 mai 2023 indiquait que le programme viserait à réduire la charge de l'industrie au moyen de la reconnaissance mutuelle entre le Canada et les États-Unis; aucune des pages plus récentes lues n'emploie ce terme.",
        ),
      ],
    },
    {
      id: "records",
      title: both("What the Records Show", "Ce que montrent les dossiers"),
      blocks: [
        p(
          "CanadaBuys' data dictionary, in its file last modified on March 24, 2026, has no field that marks a cyber security certification requirement. It says a tender notice's description does not duplicate the information or details found in the attachments, such as clauses or sample documents. Award Watch lists on a notice's page the documents the CanadaBuys data names for it, each linked where the government keeps it.",
          "Le dictionnaire de données d'AchatsCanada, dans son fichier modifié pour la dernière fois le 24 mars 2026, ne comporte aucun champ qui indique une exigence de certification en cybersécurité. Il précise que la description d'un avis d'appel d'offres ne reproduit pas les renseignements ou les détails se trouvant dans les pièces jointes, telles que des clauses ou des modèles de documents. Award Watch énumère sur la page d'un avis les documents que les données d'AchatsCanada lui associent, chacun lié à l'endroit où le gouvernement le conserve.",
        ),
        figure(
          "cyber-documents", SAMPLE_NOTICE_DOCUMENTS, "section.panel.tender-documents",
          both(
            "The Documents panel of a National Defence tender notice's page on Award Watch: the number of documents, the closing line, three document links and the line that they are on CanadaBuys.",
            "Le panneau Documents de la page d'un avis d'appel d'offres de la Défense nationale sur Award Watch : le nombre de documents, la ligne de clôture, trois liens vers des documents et la mention qu'ils se trouvent sur AchatsCanada.",
          ),
          both("A tender notice's documents on Award Watch.", "Les documents d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(".panel-head h2", "CanadaBuys' data dictionary has no field that marks a cyber security certification requirement.",
              "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ qui indique une exigence de certification en cybersécurité."),
            mark("ul.documents", "Once Levels 2 and 3 are established, PSPC says the required level will be clearly communicated in requests for proposals and contract clauses.",
              "Une fois les niveaux 2 et 3 établis, selon SPAC, le niveau requis sera clairement communiqué dans les demandes de propositions et les clauses contractuelles."),
            mark(".panel-foot", "Suppliers seeking certification must always refer to the requirements outlined in their specific contracts or solicitation documents.",
              "Les fournisseurs qui souhaitent obtenir la certification doivent toujours se référer aux exigences décrites dans leurs contrats ou leurs documents d'appel d'offres."),
          ],
        ),
        p(
          "This {example} from National Defence, a request for proposal for a radar signal stimulator closing January 4, 2027, links nine documents on CanadaBuys and the notice itself there. Its description does not mention the certification.",
          "Cet {example} de la Défense nationale, une demande de propositions pour un simulateur de signaux radar dont la clôture est fixée au 4 janvier 2027, renvoie à neuf documents sur AchatsCanada et à l'avis lui-même. Sa description ne mentionne pas la certification.",
          { example: a(EXAMPLE_CYBER, "tender notice", "avis d'appel d'offres") },
        ),
      ],
    },
  ],
  sources: [
    SRC.cpcscOverview, SRC.cpcscLevel1, SRC.cpcscMore, SRC.cpcscNews, SRC.cpcscBackgrounder, SRC.cpcsc2025, SRC.cpcsc2023, SRC.itsp10171,
    SRC.cspIndex, SRC.dictionary,
  ],
};

// The Ineligibility and Suspension Policy. The guide names no supplier: the public list is cited for what it is and what
// its columns hold, and the example notice is an ordinary one, chosen for the documents its page shows.
const INTEGRITY: Guide = {
  slug: INTEGRITY_PATH.slice("/guides/".length),
  title: both(
    "Supplier Integrity on Federal Contracts: The Ineligibility and Suspension Rules",
    "L'intégrité des fournisseurs dans les marchés fédéraux : les règles d'inadmissibilité et de suspension",
  ),
  seoTitle: both("Supplier Ineligibility and Suspension Rules", "Inadmissibilité et suspension des fournisseurs"),
  summary: both(
    "The Ineligibility and Suspension Policy: who decides, the grounds and periods, what a bid certifies, subcontracting and the public list.",
    "La Politique d'inadmissibilité et de suspension : qui décide, motifs et périodes, ce qu'une soumission atteste, la sous-traitance et la liste publique.",
  ),
  checked: "2026-11-15",
  action: tenderList(
    "To follow new federal tender notices and the solicitations they link as they are posted, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux et les demandes de soumissions qui y sont liées à mesure qu'ils sont publiés, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "policy",
      title: both("The Policy and Who Decides", "La politique et qui décide"),
      blocks: [
        p(
          "The Office of Supplier Integrity and Compliance (OSIC) of Public Services and Procurement Canada (PSPC) administers the Ineligibility and Suspension Policy, which sets out how and when a supplier may be suspended or declared ineligible from doing business with the Government of Canada. PSPC's overview says the office replaces the previous Integrity Regime.",
          "Le Bureau de l'intégrité et de la conformité des fournisseurs (BICF) de Services publics et Approvisionnement Canada (SPAC) administre la Politique d'inadmissibilité et de suspension, qui établit comment et quand un fournisseur peut être suspendu ou déclaré inadmissible à faire affaire avec le gouvernement du Canada. L'aperçu de SPAC indique que le Bureau remplace le Régime d'intégrité.",
        ),
        p(
          "The current policy is effective as of May 31, 2024, and supersedes previous versions of the policy and any associated directives; its page was last modified on May 16, 2025. PSPC's news release of May 31, 2024, says the revised policy was posted online on May 1, 2024. For contracts dated prior to May 31, 2024, OSIC says a previous version of the policy, effective July 3, 2015, or April 4, 2016, or former directives may still apply. Under section 17, the current policy does not apply to contracts, including solicitations that have not been awarded, that reference either earlier policy, save and except that any determination of ineligibility or suspension under such policy will also be one under the current policy, and that, upon the request of a supplier, any period of ineligibility determined under it will be reassessed under section 6.3, with no retroactive reduction and not exceeding the earlier period.",
          "La version actuelle de la politique est entrée en vigueur le 31 mai 2024 et remplace les versions antérieures de la politique et toute directive connexe; sa page a été modifiée pour la dernière fois le 16 mai 2025. Le communiqué de SPAC du 31 mai 2024 indique que la politique révisée a été publiée en ligne le 1er mai 2024. Pour les contrats conclus avant le 31 mai 2024, le BICF indique qu'une version antérieure de la politique, entrée en vigueur le 3 juillet 2015 ou le 4 avril 2016, ou des directives antérieures peuvent continuer de s'appliquer. Selon l'article 17, la politique actuelle ne s'applique pas aux contrats, y compris aux demandes de soumissions n'ayant pas été attribuées, qui font référence à l'une ou l'autre politique antérieure, sous réserve que toute détermination d'inadmissibilité ou de suspension au titre de cette politique vaut aussi au titre de la politique actuelle, et qu'à la demande d'un fournisseur, toute période d'inadmissibilité déterminée dans son cadre est réévaluée selon l'article 6.3, sans réduction rétroactive et sans dépasser la période antérieure.",
        ),
        p(
          "The policy names Public Works and Government Services Canada (PWGSC); its section 16.2 gives PWGSC's address as OSIC, care of PSPC's Departmental Oversight Branch. Its section 5 sets the roles:",
          "La politique nomme Travaux publics et Services gouvernementaux Canada (TPSGC); son article 16.2 donne comme coordonnées de TPSGC le BICF, aux soins de la Direction générale de la surveillance ministérielle de SPAC. Son article 5 fixe les rôles :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Who", "Qui") },
            { kind: "main", label: both("The policy's words", "Les termes de la politique") },
          ],
          rows: [
            [
              both("Registrar of Ineligibility and Suspension", "Registraire d'inadmissibilité et de suspension"),
              both(
                "An independent position responsible for making determinations of ineligibility, suspension, setting periods of ineligibility and suspension, and entering into administrative agreements (section 5.1); the Assistant Deputy Minister of Public Services and Procurement Canada responsible for this Policy (Appendix 1). The Registrar makes no determination of eligibility, only of ineligibility (section 3)",
                "Un poste indépendant, responsable de déterminer l'inadmissibilité, la suspension, de fixer les périodes d'inadmissibilité et de suspension, et de conclure des ententes administratives (article 5.1); le sous-ministre adjoint de Services publics et Approvisionnement Canada responsable de la présente politique (annexe 1). Le registraire ne se prononce pas sur l'admissibilité d'un fournisseur, mais uniquement sur son inadmissibilité (article 3)",
              ),
            ],
            [
              both("PWGSC", "TPSGC"),
              both(
                "Responsible for administering this policy on behalf of Canada, which includes making recommendations to the Registrar regarding ineligibility, suspension, periods of ineligibility and suspension, and terms and conditions of administrative agreements (section 5.2)",
                "Doit administrer la présente politique au nom du Canada, notamment formuler des recommandations au registraire sur l'inadmissibilité, la suspension, les périodes d'inadmissibilité et de suspension, et les modalités des ententes administratives (article 5.2)",
              ),
            ],
            [
              both("Departments, agencies and other federal entities", "Ministères, organismes et autres entités fédérales"),
              both(
                "Will rely on the Registrar's determinations when making a decision on whether to enter into a contract with a supplier (section 5.1); may make certain decisions as noted under the policy, the Public Interest Exception for instance, and may exercise the right to terminate a contract, if provided for under such contract (section 5.3)",
                "Se fieront aux déterminations du registraire lorsque viendra le temps de décider de conclure ou non un contrat avec un fournisseur (article 5.1); peuvent prendre certaines décisions prévues par la politique, par exemple l'exception destinée à protéger l'intérêt public, et peuvent exercer le droit de résilier un contrat, dans la mesure où ce droit est établi dans ledit contrat (article 5.3)",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "application",
      title: both("The Contracts It Applies To", "Les contrats visés"),
      blocks: [
        p(
          "Under section 2, the policy applies to all procurement processes, standing offers, supply arrangements, contracts and other instruments entered into or commenced by a department or agency identified in Schedules I, I.1 or II to the Financial Administration Act or another federal entity that voluntarily adopts it, other than the 23 exclusions the section lists. Appendix 1 defines:",
          "Selon l'article 2, la politique s'applique à tout processus d'approvisionnement, offre à commandes, arrangement en matière d'approvisionnement, contrat et autre instrument conclu ou établi par un ministère ou un organisme mentionné aux annexes I, I.1 ou II de la Loi sur la gestion des finances publiques ou par toute autre entité fédérale qui l'adopte sur une base volontaire, exception faite des 23 exclusions que l'article énumère. L'annexe 1 définit :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Term", "Terme") },
            { kind: "main", label: both("Definition in Appendix 1", "Définition à l'annexe 1") },
          ],
          rows: [
            [
              both("Contract", "Contrat"),
              both(
                "An agreement between a contracting authority and a person or firm to provide a good, perform a service, sell or dispose of a good, or construct a work, or a real property agreement between a contracting authority and a person or firm for appropriate consideration",
                "Une entente entre une autorité contractante et une personne ou une firme pour fournir un bien, fournir un service, vendre ou aliéner un bien, ou mener des travaux, ou un accord immobilier entre une autorité contractante et une personne ou une firme, pour une contrepartie appropriée",
              ),
            ],
            [
              both("Real property agreement", "Accord immobilier"),
              both(
                "Includes offer to purchase, offer for sale, agreement of purchase and sale, leases and licences",
                "S'entend des offres d'achat et de vente, des conventions d'achat et de vente, des locations à bail et des permis",
              ),
            ],
          ],
        },
        p("Among the exclusions of section 2:", "Parmi les exclusions de l'article 2 :"),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Section", "Article") },
            { kind: "main", label: both("Excluded, in the policy's words", "Exclusion, selon les termes de la politique") },
          ],
          rows: [
            [both("2.4", "2.4"), both("Inter-governmental and intra-governmental agreements and memoranda of understanding", "Les ententes et les protocoles d'entente intergouvernementaux et intragouvernementaux")],
            [both("2.5", "2.5"), both("Financial contracts", "Les contrats financiers")],
            [both("2.7", "2.7"), both("Contracts of employment", "Les contrats d'emploi")],
            [both("2.11", "2.11"), both("Transfer payments (that is, grants, contributions and other transfer payments)", "Les paiements de transfert (c'est-à-dire les subventions, les contributions et d'autres paiements de transfert)")],
            [
              both("2.20", "2.20"),
              both(
                "Goods, services and construction contracts, first-tier subcontracts and real property agreements with a transaction value below $10,000",
                "Les contrats de biens, de services et de construction, les premiers contrats de sous-traitance et les accords immobiliers dont la valeur transactionnelle est inférieure à 10 000 $",
              ),
            ],
            [
              both("2.23", "2.23"),
              both(
                "Such further and other exclusion contained in directives issued by Public Works and Government Services Canada (PWGSC) under this policy",
                "Toute autre exclusion figurant dans les directives établies par Travaux publics et Services gouvernementaux Canada (TPSGC) dans le cadre de la présente politique",
              ),
            ],
          ],
        },
        p(
          "OSIC's page of the departments and agencies that apply the policy, modified August 15, 2024, says the policy is governed by memoranda of understanding between PSPC and other federal institutions, and lists 89 institutions currently holding one.",
          "La page du BICF sur les ministères et organismes qui appliquent la politique, modifiée le 15 août 2024, indique que la politique est régie par des protocoles d'entente entre SPAC et d'autres institutions fédérales, et énumère 89 institutions qui en détiennent actuellement un.",
        ),
      ],
    },
    {
      id: "grounds",
      title: both("The Grounds in Appendix 2", "Les motifs de l'annexe 2"),
      blocks: [
        p(
          "Under section 6.2, the Registrar will determine that a supplier is ineligible if any of the Material Events listed in Appendix 2 are found to apply in respect of the supplier. Appendix 2 says its grounds include the events that will trigger the determination of ineligibility and, when relating to certain charges, may be considered when determining a suspension. Its paragraphs follow, in the policy's words or condensed from them; where a paragraph lists offences by section, the policy gives each:",
          "Selon l'article 6.2, le registraire déterminera qu'un fournisseur est inadmissible si tout évènement important figurant à l'annexe 2 survient à l'égard dudit fournisseur. L'annexe 2 indique que ses motifs comprennent les évènements qui déclencheront la détermination d'inadmissibilité et qui, dans le cas de certaines accusations, peuvent être pris en considération dans le cadre du processus de détermination de suspension. Ses alinéas suivent, selon les termes de la politique ou condensés à partir de ceux-ci; lorsqu'un alinéa énumère des infractions par article, la politique donne chacune :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Paragraph", "Alinéa") },
            { kind: "main", label: both("The policy's words", "Les termes de la politique") },
          ],
          rows: [
            [
              both("(1)(a)", "(1)(a)"),
              both(
                "The supplier has a loss of capacity to contract with His Majesty or to receive any benefit under a contract between His Majesty and any other person under subsection 750(3) of the Criminal Code, which, for greater clarity, relates to convictions of offences under paragraph 80(1)(d), subsection 80(2) or section 154.01 of the Financial Administration Act, or section 121, section 124, section 380 for fraud committed against His Majesty, or section 418 of the Criminal Code",
                "Le fournisseur a perdu sa capacité de conclure un contrat avec Sa Majesté ou de tirer profit de tout contrat conclu entre Sa Majesté et toute autre personne en vertu du paragraphe 750(3) du Code criminel, lequel, il est entendu, se rapporte aux condamnations relatives aux infractions visées par l'alinéa 80(1)d), le paragraphe 80(2) ou l'article 154.01 de la Loi sur la gestion des finances publiques, ou l'article 121, l'article 124, l'article 380, pour ce qui est d'une fraude commise à l'égard de Sa Majesté, ou l'article 418 du Code criminel",
              ),
            ],
            [
              both("(1)(b)", "(1)(b)"),
              both(
                "The supplier has, in the past 3 years, been convicted of or pleaded guilty to any of the offences the paragraph lists, by section, of the Criminal Code; of sections 463, 464 or 465 of the Criminal Code, each solely to the extent that it relates to an offence listed under paragraph (1)(b)(i); of the sections it lists of the Competition Act, the Income Tax Act, the Excise Tax Act, the Corruption of Foreign Public Officials Act, the Controlled Drugs and Substances Act, the Canada Elections Act, the Financial Administration Act and the Immigration and Refugee Protection Act; or any offence under the Canada Labour Code, Part II and Part III",
                "Le fournisseur a, au cours des 3 dernières années, été reconnu coupable ou a enregistré un plaidoyer de culpabilité relativement aux infractions que l'alinéa énumère, par article, du Code criminel; des articles 463, 464 ou 465 du Code criminel, dans chacun des cas, dans la mesure où cela s'applique à une infraction énoncée à l'alinéa (1)(b)(i); des articles qu'il énumère de la Loi sur la concurrence, de la Loi de l'impôt sur le revenu, de la Loi sur la taxe d'accise, de la Loi sur la corruption d'agents publics étrangers, de la Loi réglementant certaines drogues et autres substances, de la Loi électorale du Canada, de la Loi sur la gestion des finances publiques et de la Loi sur l'immigration et la protection des réfugiés; ou les infractions énumérées dans les partie II et partie III du Code canadien du travail",
              ),
            ],
            [
              both("(1)(c)", "(1)(c)"),
              both(
                "The supplier has, in the past 3 years, been convicted of or pleaded guilty to an offence pursuant to subsection 14(1), with respect to sections 5 or 7, of the Lobbying Act",
                "Le fournisseur a, au cours des 3 dernières années, été reconnu coupable ou plaidé coupable relativement à une infraction visée par le paragraphe 14(1), en ce qui concerne l'article 5 ou 7 de la Loi sur le lobbying",
              ),
            ],
            [
              both("(1)(d)", "(1)(d)"),
              both(
                "The supplier has, in the past 3 years, failed to terminate a first-tier subcontract within 1 business day of when the supplier knew or ought to have known that a first-tier subcontractor lacks the capacity to contract with Canada or receive any benefit under a contract with Canada and another party, pursuant to subsection 750(3) of the Criminal Code (the French text of the policy gives 5 business days); or entered into a contract with an ineligible or suspended first-tier subcontractor, unless one of the four exceptions the paragraph lists applies",
                "Au cours des 3 dernières années, le fournisseur n'a pas résilié de premier contrat de sous-traitance dans un délai de 5 jours ouvrables suivant le jour où il a appris ou aurait dû apprendre qu'un premier sous-traitant a perdu la capacité de conclure un contrat avec le Canada ou de tirer profit de tout contrat conclu avec le Canada et une autre partie, conformément au paragraphe 750(3) du Code criminel (le texte anglais de la politique indique 1 jour ouvrable); ou a conclu un contrat avec un premier sous-traitant inadmissible ou suspendu, sauf si l'une des quatre exceptions que l'alinéa énumère s'applique",
              ),
            ],
            [
              both("(1)(e)", "(1)(e)"),
              both(
                "The Registrar determines, in the Registrar's discretion that the supplier has, at any time, provided a certification or declaration to PWGSC in relation to this policy which is false or misleading, in a material respect",
                "Le registraire détermine, à sa discrétion, que le fournisseur a, à un moment ou à un autre, fourni à TPSGC une attestation ou une déclaration fausse ou trompeuse sur un point important concernant la présente politique",
              ),
            ],
            [
              both("(1)(f)", "(1)(f)"),
              both(
                "The supplier, or the supplier's affiliate, has, in the past 3 years, been convicted of a Foreign Offence, or pleaded guilty to a Foreign Offence, or is the subject of a foreign judicial determination whether civil or criminal that the Registrar determines, in the Registrar's discretion, to be a Similar Foreign Offence, or agreed to a statement of facts, in relation to having committed an act or omission outside of Canada, and the Registrar determines, in the Registrar's discretion, that if such act or omission had occurred in Canada, it would likely lead to a conviction of an offence listed in paragraph (1)(a), (1)(b)(i), (ii), (iii), (iv), (vi), (ix) and (x), or (1)(c) of Appendix 2. The Registrar will consider the actions or omissions of affiliates only if the Registrar determines, in the Registrar's discretion, that the supplier directed, influenced, authorized, assented to, acquiesced to, or participated in those actions or omissions",
                "Au cours des 3 dernières années, le fournisseur ou une affiliée du fournisseur a été reconnu coupable ou a plaidé coupable relativement à une infraction étrangère, ou fait l'objet d'une détermination judiciaire étrangère, civile ou criminelle, que le registraire détermine, à sa discrétion, comme étant une infraction étrangère de même nature, ou a approuvé un énoncé de faits, relativement à une action ou une omission à l'étranger, et le registraire détermine, à sa discrétion, que si cette action ou omission avait été commise au Canada, elle aurait probablement donné lieu à une condamnation relativement à une infraction énoncée aux alinéas et sous-alinéas (1)(a), (1)(b)(i), (ii), (iii), (iv), (vi), (ix) et (x), ou (1)(c) de l'annexe 2. Le registraire ne prendra en considération les actions ou les omissions des affiliées que si le registraire détermine, à sa discrétion, que le fournisseur a participé ou consenti à celles-ci ou qu'il les a acceptées, autorisées, encouragées ou dirigées",
              ),
            ],
            [
              both("(1)(g)", "(1)(g)"),
              both(
                "The supplier, or the supplier's affiliate, has, in the past 3 years, either been convicted of, pleaded guilty to, or agreed to a statement of facts, in relation to having committed an act or omission in Canada that is a Similar Provincial Offence, or that is a Provincial Offence and the Registrar determines, in the Registrar's discretion, that such act or omission is similar to an act which would likely lead to a conviction for an offence listed in paragraph (1)(a)(i), (1)(b)(iv), (v), and (ix), or (1)(c) of Appendix 2; or been convicted, or pleaded guilty, under provincial securities legislation relating to fraud, collusion or insider trading. The Registrar will consider the actions or omissions of affiliates only if the Registrar determines, in the Registrar's discretion, that the supplier directed, influenced, authorized, assented to, acquiesced to, or participated in those actions or omissions",
                "Au cours des 3 dernières années, le fournisseur ou une affiliée du fournisseur a été reconnu coupable, a plaidé coupable ou a approuvé un énoncé de faits relativement à une action ou une omission au Canada qui constitue une infraction provinciale de même nature, ou qui constitue une infraction provinciale et que le registraire détermine, à sa discrétion, comme semblable à un acte qui aurait probablement donné lieu à une condamnation relativement à une infraction énoncée aux alinéas et sous-alinéas (1)(a)(i), (1)(b)(iv), (v) et (ix), ou (1)(c) de l'annexe 2; ou a été reconnu coupable ou a plaidé coupable relativement à une infraction dans le cadre de la législation provinciale en matière de valeurs mobilières liée à la fraude, à la collusion ou aux délits d'initié. Le registraire ne prendra en considération les actions ou les omissions des affiliées que si le registraire détermine, à sa discrétion, que le fournisseur a participé ou consenti à celles-ci ou qu'il les a acceptées, autorisées, encouragées ou dirigées",
              ),
            ],
            [
              both("(1)(h)", "(1)(h)"),
              both(
                "The supplier's affiliate, in the past 3 years, was convicted of or pleaded guilty to an offence identified in paragraphs (1)(a), (1)(b) or (1)(c) of Appendix 2 and the Registrar determines, in the Registrar's discretion, that the supplier directed, influenced, authorized, assented to, acquiesced in or participated in any action or omission, which directly or indirectly enabled the underlying action(s) or omission(s) that relate to the offence, where the supplier knew or ought to have known that its affiliate was involved in the offence",
                "Une affiliée du fournisseur a, au cours des 3 dernières années, été reconnue coupable ou a plaidé coupable relativement à une infraction énoncée aux alinéas (1)(a), (1)(b) ou (1)(c) de l'annexe 2, et le registraire détermine, à sa discrétion, que le fournisseur a accepté, autorisé, encouragé ou dirigé une action ou une omission, ou y a participé ou consenti, laquelle a favorisé directement ou indirectement une action ou une omission sous-jacente à l'infraction alors que le fournisseur savait ou aurait dû savoir que son affiliée était impliquée dans l'infraction",
              ),
            ],
            [
              both("(1)(i)", "(1)(i)"),
              both(
                "The supplier is a person listed or designated under regulations made pursuant to the United Nations Act, Special Economic Measures Act, the Justice for Victims of Corrupt Foreign Officials Act or the Freezing Assets of Corrupt Foreign Officials Act, or is owned or controlled by such a person; or has engaged in any activity prohibited under regulations made pursuant to the United Nations Act, Special Economic Measures Act, the Justice for Victims of Corrupt Foreign Officials Act or the Freezing Assets of Corrupt Foreign Officials Act",
                "Le fournisseur est une personne inscrite ou désignée en vertu de règlements pris en application de la Loi sur les Nations Unies, de la Loi sur les mesures économiques spéciales, de la Loi sur la justice pour les victimes de dirigeants étrangers corrompus ou de la Loi sur le blocage des biens de dirigeants étrangers corrompus, appartient à une telle personne ou est contrôlé par celle-ci; ou s'est livré à toute activité interdite par les règlements pris en vertu de la Loi sur les Nations Unies, de la Loi sur les mesures économiques spéciales, de la Loi sur la justice pour les victimes de dirigeants étrangers corrompus ou de la Loi sur le blocage des biens de dirigeants étrangers corrompus",
              ),
            ],
            [
              both("(1)(j)", "(1)(j)"),
              both(
                "The Registrar determines, at any time and in the Registrar's discretion, that contracting with the supplier may bring the Federal procurement system into public disrepute or otherwise be contrary to Canadian public policy; or that the supplier lacks business integrity or business honesty in a manner that seriously and directly affects the present responsibility of the supplier; with the Registrar considering the foregoing in situations where the supplier, within the past 3 years, breached the Code of Conduct for Procurement, or is determined to be ineligible or debarred by any provincial or foreign jurisdiction, or international organization (such as, the World Bank)",
                "Le registraire détermine, à tout moment et à sa discrétion, que le fait de conclure un contrat avec le fournisseur pourrait porter préjudice à la réputation du système d'approvisionnement fédéral ou serait autrement contraire à la politique publique canadienne; ou que le fournisseur manque d'intégrité ou d'honnêteté en affaires d'une manière qui nuit gravement et directement à la responsabilité actuelle du fournisseur; le registraire en tenant compte dans les situations où le fournisseur a, au cours des 3 dernières années, enfreint le Code de conduite pour l'approvisionnement, ou est déterminé inadmissible ou exclu par une autorité provinciale ou étrangère ou par une organisation internationale (par exemple la Banque mondiale)",
              ),
            ],
            [
              both("(1)(k)", "(1)(k)"),
              both(
                "The supplier has, within the past 3 years been convicted of an offence that resulted in being listed on the Environmental Offenders Registry; and the Registrar determines, in the Registrar's discretion, that the foregoing is serious, repetitive or otherwise egregious",
                "Le fournisseur a, au cours des 3 dernières années, été reconnu coupable d'une infraction qui a entraîné son inscription au Registre des contrevenants environnementaux, et le registraire détermine, à sa discrétion, que ce qui précède est grave, répétitif ou inacceptable",
              ),
            ],
            [
              both("(1)(l)", "(1)(l)"),
              both(
                "The supplier has within the last 3 years received a poor performance evaluation pursuant to PWGSC's Vendor Performance Corrective Measure Policy or its successor, and the Registrar determines, in the Registrar's discretion, that the foregoing is serious, repetitive or otherwise egregious",
                "Le fournisseur a, au cours des 3 dernières années, reçu une évaluation de rendement médiocre dans le cadre de la Politique sur les mesures correctives du rendement des fournisseurs de TPSGC ou de la politique qui lui succède, et le registraire détermine, à sa discrétion, que ce qui précède est grave, répétitif ou inacceptable",
              ),
            ],
            [
              both("(1)(m)", "(1)(m)"),
              both(
                "An owner, trustee, director, manager or senior officer of the supplier has, in the past 3 years, been convicted of or pleaded guilty to an offence identified in paragraphs (1)(a), (1)(b) or (1)(c) of Appendix 2 or is otherwise suspended under this policy and the Registrar determines, in the Registrar's discretion, that such owner, trustee, director, manager or senior officer has an opportunity to direct or influence the supplier",
                "Un propriétaire, un fiduciaire, un directeur, un gestionnaire ou un cadre supérieur du fournisseur a, au cours des 3 dernières années, été reconnu coupable ou a plaidé coupable relativement à une infraction énoncée aux alinéas (1)(a), (1)(b) ou (1)(c) de l'annexe 2 ou est suspendu au titre de la présente politique, et le registraire détermine, à sa discrétion, que le propriétaire, fiduciaire, directeur, gestionnaire ou cadre supérieur est en mesure de diriger ou d'influencer le fournisseur",
              ),
            ],
          ],
        },
        p("The appendix's footnote sets the date the 3 year period is determined from:", "La note de l'annexe fixe la date à partir de laquelle la période de 3 ans est déterminée :"),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Assessment", "Évaluation") },
            { kind: "main", label: both("Date", "Date") },
          ],
          rows: [
            [
              both("In response to a particular procurement process", "À la suite d'un processus d'approvisionnement donné"),
              both(
                "The date on which the contracting authority receives an offer/bid from a supplier in response to such procurement process",
                "La date à laquelle l'autorité contractante reçoit l'offre ou la soumission d'un fournisseur en réponse à ce processus d'approvisionnement",
              ),
            ],
            [
              both("At a supplier's request", "À la demande d'un fournisseur"),
              both(
                "The date that the Registrar receives such a request from the supplier to determine whether it is ineligible for award of a contract",
                "La date à laquelle le registraire reçoit la demande du fournisseur visant à déterminer s'il est inadmissible à l'attribution d'un contrat",
              ),
            ],
            [
              both("All other determinations", "Toute autre détermination"),
              both(
                "The date that the Registrar issues the supplier a Notice of Intention to Declare Ineligible",
                "La date à laquelle le registraire délivre au fournisseur un avis d'intention de déclarer inadmissible",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "compared",
      title: both("Ineligibility and Suspension Compared", "Inadmissibilité et suspension comparées"),
      blocks: [
        p("The two side by side, condensed from the policy's words:", "Les deux côte à côte, condensés à partir des termes de la politique :"),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Rule", "Règle") },
            { kind: "main", label: both("Ineligibility", "Inadmissibilité") },
            { kind: "main", label: both("Suspension", "Suspension") },
          ],
          rows: [
            [
              both("Notice", "Avis"),
              both(
                "A Notice of Ineligibility is a notice by the Registrar to a supplier declaring the supplier ineligible to be awarded a contract or real property agreement for a specific period of time (Appendix 1)",
                "L'avis d'inadmissibilité désigne un avis délivré par le registraire à un fournisseur qui déclare le fournisseur inadmissible à l'attribution d'un contrat ou d'un accord immobilier durant une période précise (annexe 1)",
              ),
              both(
                "A Notice of Suspension is a notice by the Registrar to a supplier declaring the supplier suspended from being able to be awarded a contract or real property agreement for a specific period of time (Appendix 1)",
                "L'avis de suspension désigne un avis délivré par le registraire à un fournisseur qui déclare le fournisseur suspendu et prévoit que ce dernier ne peut pas conclure de contrat ou d'accord immobilier durant une période précise (annexe 1)",
              ),
            ],
            [
              both("Basis", "Fondement"),
              both(
                "The Registrar will determine that a supplier is ineligible if any of the Material Events listed in Appendix 2 are found to apply in respect of the supplier (section 6.2)",
                "Le registraire déterminera qu'un fournisseur est inadmissible si tout évènement important figurant à l'annexe 2 survient à l'égard dudit fournisseur (article 6.2)",
              ),
              both(
                "If the Registrar determines, in the Registrar's discretion, that there is a professional misconduct or acts or omissions of the supplier which adversely reflect on the commercial integrity of the supplier, the Registrar may, in the Registrar's discretion and upon giving a supplier a Notice of Suspension, suspend a supplier. The following charges or proceedings against the supplier may, in the Registrar's discretion, be considered as evidence of such misconduct, acts or omissions: any of the offences identified in paragraphs (1)(a), (b) or (c) of Appendix 2; a Provincial Offence which the Registrar determines, in the Registrar's discretion, is a Similar Provincial Offence as defined in Appendix 1 or pursuant to paragraph (1)(g) of Appendix 2; or a Foreign Offence which the Registrar determines, in the Registrar's discretion, is a Similar Foreign Offence to those offences; each to the extent that the foregoing poses a risk to Canada (section 7.1.1)",
                "Si le registraire détermine, à sa discrétion, qu'une faute professionnelle, des actes ou des omissions du fournisseur ont porté atteinte à l'intégrité commerciale de ce dernier, le registraire peut, à sa discrétion et après avoir délivré un avis de suspension au fournisseur, suspendre le fournisseur. Les accusations ou les procédures judiciaires suivantes à l'encontre du fournisseur peuvent, à la discrétion du registraire, être considérées comme indices d'une telle faute, de tels actes ou de telles omissions : toute infraction prévue aux alinéas (1)(a), (b) ou (c) de l'annexe 2; une infraction provinciale que le registraire juge, à sa discrétion, comme une infraction provinciale de même nature au sens de l'annexe 1 ou en vertu de l'alinéa (1)(g) de l'annexe 2; ou une infraction étrangère que le registraire juge, à sa discrétion, comme une infraction étrangère de même nature que ces infractions; dans chacun des cas, dans la mesure où cela pose un risque pour le Canada (article 7.1.1)",
              ),
            ],
            [
              both("Notice first", "Avis préalable"),
              both(
                "A Notice of Intention to Declare Ineligible will be delivered to the supplier before the Registrar makes a determination of ineligibility; the supplier has 10 business days following its delivery to file information and written submissions to the Registrar, or longer if it requests an extension in writing within those 10 business days and PWGSC agrees in writing (sections 6.2.5 and 6.2.6)",
                "Un avis d'intention de déclarer inadmissible sera délivré avant que le registraire détermine le fournisseur inadmissible; le fournisseur dispose de 10 jours ouvrables suivant la livraison de l'avis pour produire des informations et des soumissions écrites au registraire, ou d'un délai plus long s'il présente une demande de prolongation par écrit avant la fin de ces 10 jours ouvrables et que TPSGC y consent par écrit (articles 6.2.5 et 6.2.6)",
              ),
              both(
                "If the Registrar believes there are grounds to suspend a supplier, the Registrar will deliver a Notice of Intention to Suspend, which gives the supplier the same 10 business days, and the same extension (section 7.2.1)",
                "Si le registraire croit qu'il existe des motifs justifiant la suspension d'un fournisseur, il doit lui envoyer un avis d'intention de suspendre, qui accorde au fournisseur les mêmes 10 jours ouvrables et la même prolongation (article 7.2.1)",
              ),
            ],
            [
              both("Period", "Période"),
              both(
                "Begins on the date that the Notice of Ineligibility is delivered and ends: for a Material Event in paragraph (1)(a) of Appendix 2, on the date provided by an order of restoration made by the Governor in Council pursuant to subsection 750(5) of the Criminal Code, but only to the extent provided for in that or, if applicable, any subsequent such order; for paragraph (1)(i), on the date the sanction is no longer applicable (if ever); for all other Material Events, on the date the Registrar determines, considering, among other things, the guidelines in Appendix 3, no more than 10 years from the date the Notice of Ineligibility is delivered (section 6.3.1). Within 10 business days of delivery of the Notice of Ineligibility, the supplier may deliver written information and submissions, and the Registrar may, at the Registrar's discretion, reconsider, reduce or confirm the period of ineligibility (sections 6.3.4 and 6.3.5)",
                "Débute à la date de délivrance de l'avis d'inadmissibilité et se termine : dans le cas d'un évènement important décrit à l'alinéa (1)(a) de l'annexe 2, à la date indiquée par un ordre de rétablissement rendu par le gouverneur en conseil en vertu du paragraphe 750(5) du Code criminel, mais uniquement dans la mesure prévue dans cet ordre ou, s'il y a lieu, dans tout ordre ultérieur; dans le cas de l'alinéa (1)(i), à la date à laquelle la sanction cesse d'avoir effet (le cas échéant); dans le cas de tout autre évènement important, à la date déterminée par le registraire en tenant compte, entre autres, des lignes directrices de l'annexe 3, au plus 10 années suivant la date de délivrance de l'avis d'inadmissibilité (article 6.3.1). Dans les 10 jours ouvrables suivant la délivrance de l'avis d'inadmissibilité, le fournisseur peut présenter des informations et des soumissions écrites au registraire, qui pourra, à sa discrétion, réévaluer, réduire ou confirmer la période d'inadmissibilité (articles 6.3.4 et 6.3.5)",
              ),
              both(
                "Lasts from the day that the Registrar issues a Notice of Suspension until and including the earlier of 18 months following such notice, which can be longer if a legal process is underway, and, if applicable, the date that the Registrar determines that the professional misconduct or acts or omissions no longer apply or have been addressed to the satisfaction of the Registrar (section 7.3.2)",
                "Dure du jour où le registraire émet l'avis de suspension jusqu'à la première des occurrences suivantes : 18 mois après l'émission de l'avis, ou une période plus longue si un processus judiciaire est en cours; le cas échéant, la date à laquelle le registraire détermine que la faute professionnelle, les actes ou les omissions ne s'appliquent plus ou ont été abordés à sa satisfaction (article 7.3.2)",
              ),
            ],
            [
              both("Public list", "Liste publique"),
              both(
                "If the supplier is not an individual, PWGSC will publish the name of the supplier on its public Ineligibility and Suspension List, together with the supplier's address, and the start and end dates of the period of ineligibility (section 6.5.2)",
                "Si le fournisseur n'est pas un individu, TPSGC publiera son nom sur la Liste des fournisseurs inadmissibles et suspendus publique, ainsi que son adresse, et la date de début et la date de la fin de la période d'inadmissibilité (article 6.5.2)",
              ),
              both(
                "As under section 6.5.2, for a supplier that is not an individual, the name will be published on the list with reference to a suspended status rather than an ineligible status (sections 6.5.2 and 7.1.1)",
                "Comme à l'article 6.5.2, pour un fournisseur qui n'est pas un particulier, le nom sera publié sur la liste avec mention du statut « suspendu » au lieu du statut « inadmissible » (articles 6.5.2 et 7.1.1)",
              ),
            ],
            [
              both("Bids", "Soumissions"),
              both(
                "Subject to the Public Interest Exception being invoked in a particular transaction, a response to a competitive solicitation from an ineligible supplier will be declared non-responsive and will receive no further consideration, and an ineligible supplier is unable to enter into a contract awarded through a non-competitive process (section 6.5.3)",
                "Sauf si l'exception destinée à protéger l'intérêt public est invoquée dans le cadre d'une transaction donnée, une réponse à un processus concurrentiel de la part d'un fournisseur inadmissible sera déclarée non recevable et sera rejetée d'emblée, et un fournisseur inadmissible ne peut pas conclure un contrat attribué dans le cadre d'un processus non concurrentiel (article 6.5.3)",
              ),
              both(
                "The effect of a suspension will be the same as the effect of a determination of ineligibility under section 6.5, with the exception of the length of the suspension period (section 7.3.1)",
                "L'effet de la suspension sera équivalent à l'effet de la détermination d'inadmissibilité au titre de l'article 6.5, à l'exception de la longueur de la période de suspension (article 7.3.1)",
              ),
            ],
            [
              both("Existing contracts", "Contrats en cours"),
              both(
                "With at least 2 weeks advance notice to the supplier, a contracting authority may terminate any or all of the supplier's contracts that are subject to the policy. During the notice period, the supplier may give written representations as to why they should not be terminated, and the Registrar may request the supplier to enter into an administrative agreement as an alternative; if one is executed, or the contracting authority finds the reasons persuasive, it may revoke the advance notice and the termination. Any such termination will be deemed a termination for default of the supplier, with Canada paying no costs, expenses, damages, lost profits or other amounts related to it; Canada will remain liable to pay for any services or goods already received (section 6.5.4)",
                "Sur préavis d'au moins 2 semaines au fournisseur, l'autorité contractante peut résilier une partie ou la totalité des contrats du fournisseur qui sont assujettis à la politique. Pendant la période de préavis, le fournisseur peut soumettre des observations écrites justifiant pourquoi ils ne devraient pas être résiliés, et le registraire peut lui demander de conclure une entente administrative en remplacement; si une telle entente est conclue, ou si l'autorité contractante juge les raisons convaincantes, celle-ci peut annuler le préavis et la résiliation. Toute résiliation de cette nature sera réputée être une résiliation pour manquement du fournisseur, sans que le Canada paie de frais, de dépenses, de dommages, de manque à gagner ou d'autres montants qui y sont liés; le Canada demeure tenu de payer les services ou les biens déjà reçus (article 6.5.4)",
              ),
              both(
                "There will be no right to terminate contracts pursuant to section 6.5.4 (section 7.1.1)",
                "Il n'existera aucun droit de résilier des contrats conformément à l'article 6.5.4 (article 7.1.1)",
              ),
            ],
          ],
        },
        p("Two rules reach both:", "Deux règles touchent l'une et l'autre :"),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Rule", "Règle") },
            { kind: "main", label: both("The policy's words", "Les termes de la politique") },
          ],
          rows: [
            [
              both("Provisional suspension (section 7.1.2)", "Suspension provisoire (article 7.1.2)"),
              both(
                "If the Registrar, exercising their discretion, determines that the alleged misconduct, acts or omissions of the supplier, pose immediate and significant risk to the Government of Canada, the Registrar may impose a provisional suspension on the supplier that will take effect on the day it is issued and remain in place for up to 90 days. A provisional suspension may be renewed if required. A supplier will be informed of it as a part of a Notice of Intention to Declare Ineligible, a Notice of Intention to Suspend, or by way of a Notice of Provisional Suspension",
                "Si le registraire, lors de l'exercice de son pouvoir discrétionnaire, détermine que la faute, les omissions ou les actes présumés du fournisseur posent un risque immédiat et significatif au gouvernement du Canada, le registraire peut imposer une suspension provisoire au fournisseur qui entrera en vigueur le jour de son émission et demeurera en place jusqu'à 90 jours. Une suspension provisoire peut être renouvelée au besoin. Le fournisseur en sera informé au moyen d'un avis d'intention de déclarer inadmissible, d'un avis d'intention de suspendre ou d'un avis de suspension provisoire",
              ),
            ],
            [
              both("Public interest exception (section 9.1)", "Exception destinée à protéger l'intérêt public (article 9.1)"),
              both(
                "Unless the supplier has no capacity to contract with Canada, or receive any benefit under a contract with Canada and any other person pursuant to subsection 750(3) of the Criminal Code or is otherwise prohibited from contracting with Canada pursuant to a sanction listed in paragraph (1)(i) of Appendix 2, a contracting authority may enter into a contract with an ineligible or suspended supplier if the relevant Deputy Head or equivalent considers that doing so is in the public interest",
                "À moins que le fournisseur n'ait pas la capacité de conclure un contrat avec le Canada ou de tirer profit de tout contrat conclu entre le Canada et toute autre personne en vertu du paragraphe 750(3) du Code criminel ou qu'il lui soit interdit de conclure un contrat avec le Canada en application d'une sanction prévue par l'alinéa (1)(i) de l'annexe 2, une autorité contractante peut conclure un contrat avec un fournisseur inadmissible ou suspendu si l'administrateur général (ou une personne occupant un poste équivalent) concerné considère que ce contrat est dans l'intérêt public",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "bid",
      title: both("What a Bid Certifies and Discloses", "Ce qu'une soumission atteste et communique"),
      blocks: [
        p(
          "OSIC's page of clauses for procurement contracts, modified April 23, 2025, says departments and agencies that apply the policy incorporate it by reference to procurement contracts through the addition of its clauses. Clause 1.1, in its words; the {bid} gives the steps of a bid:",
          "La page du BICF sur les clauses pour les contrats d'approvisionnement, modifiée le 23 avril 2025, indique que les ministères et organismes qui appliquent la politique l'incorporent par renvoi aux contrats d'approvisionnement par l'ajout de ses clauses. La clause 1.1, selon ses termes; le {bid} donne les étapes d'une soumission :",
          { bid: a(BID_PATH, "guide on bidding", "guide sur les soumissions") },
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Subsection", "Paragraphe") },
            { kind: "main", label: both("The clause's words", "Les termes de la clause") },
          ],
          rows: [
            [
              both("(a) Mandatory Compliance", "a) Conformité obligatoire"),
              both(
                "The Ineligibility and Suspension Policy (the Policy) in effect on the date the solicitation of offers is issued, and all related Directives in effect on that date, are incorporated by reference into, and form a binding part of the solicitation of offers. The Offeror must comply with the Policy and Directives, which can be found at the Office of Supplier Integrity and Compliance website",
                "La Politique d'inadmissibilité et de suspension (la Politique) en vigueur à la date d'émission de la demande d'offres ainsi que toutes les directives connexes en vigueur à cette date sont incorporées par renvoi à la demande d'offres et en font partie intégrante. L'Offrant doit respecter la Politique et les directives, lesquelles se trouvent sur le site Web du Bureau de l'intégrité et de la conformité des fournisseurs",
              ),
            ],
            [
              both("(b) Policy Summary", "b) Résumé de la Politique"),
              both(
                "The Policy sets out the circumstances under which Canada may determine that the Supplier is ineligible to enter, or is suspended from entering into a Contract with Canada. The list of ineligible and suspended Suppliers is maintained on the Office of Supplier Integrity and Compliance website",
                "La Politique décrit les circonstances selon lesquelles le Canada pourrait déterminer qu'un fournisseur est inadmissible ou suspendu à conclure un contrat avec le Canada. La liste des fournisseurs inadmissibles et suspendus figure sur le site Web du Bureau de l'intégrité et de la conformité des fournisseurs",
              ),
            ],
            [
              both("(c) Offeror Responsibilities", "c) Responsabilités de l'Offrant"),
              both(
                "The Offeror must provide a List of names for integrity verification that includes all information required by the Policy (section 13, Disclosure); and, if the Offeror is unable to certify all of the statements in subsection d, a completed Integrity declaration form providing all requested information and details of any material event that may affect the status of itself, its affiliates or its proposed first-tier subcontractors under the Policy",
                "L'Offrant doit fournir une liste des noms pour la vérification de l'intégrité qui comprend tous les renseignements exigés dans la Politique (article 13, Communication des renseignements); et, s'il n'est pas en mesure d'attester tous les énoncés figurant au paragraphe d, un formulaire de déclaration d'intégrité comprenant tous les renseignements et les détails de tout événement important qui pourrait toucher son statut ou celui de ses affiliés ou des premiers sous-traitants qu'il propose en vertu de la Politique",
              ),
            ],
            [
              both("(d) Offeror Certifications", "d) Attestations de l'Offrant"),
              both(
                "Subject to subsection e, by submitting an offer in response to this solicitation of offers, the Offeror certifies that: it has read and understands the Ineligibility and Suspension Policy; it understands that certain circumstances, as described in the Policy, will or may result in a determination of ineligibility or suspension under the Policy; it is aware that Canada may request additional information, certifications, and validations from the Offeror or a third party for the purpose of making a determination of ineligibility or suspension; none of the circumstances described in Appendix 2 of the Policy that will or may result in a determination of ineligibility or suspension, apply to itself, its affiliates or its proposed first tier subcontractors; and it is not aware of a determination of ineligibility or suspension issued by Canada that applies to it",
                "Conformément au paragraphe e, en présentant une offre en réponse à la présente demande d'offres, l'Offrant atteste : qu'il a lu et qu'il comprend la Politique d'inadmissibilité et de suspension; qu'il comprend que certaines circonstances, décrites dans la Politique, entraîneront ou peuvent entraîner une décision d'inadmissibilité ou de suspension conformément à la Politique; qu'il est au courant que le Canada peut demander des renseignements, des attestations et des validations supplémentaires auprès de l'Offrant ou d'un tiers, afin de prendre une décision à l'égard de son inadmissibilité ou de sa suspension; qu'aucune des circonstances décrites dans l'annexe 2 de la Politique et susceptible d'entraîner une détermination d'inadmissibilité ou de suspension ne s'applique à lui, à ses affiliés ou aux premiers sous-traitants qu'il propose; et qu'il n'est au courant d'aucune décision d'inadmissibilité ou de suspension rendue par le Canada à son sujet",
              ),
            ],
            [
              both("(e) Integrity Declaration Form", "e) Formulaire de déclaration d'intégrité"),
              both(
                "Where an Offeror is unable to provide all of the certifications required by subsection d, at the time of its offer it must submit a completed Integrity declaration form",
                "Lorsqu'un Offrant est incapable de fournir toutes les attestations exigées au paragraphe d, au moment de présenter son offre, il doit soumettre un formulaire de déclaration d'intégrité dûment rempli",
              ),
            ],
            [
              both("(f) Compliance with Certifications", "f) Conformité avec les attestations"),
              both(
                "Canada will declare non-compliant any offer in respect of which the information requested is incomplete or inaccurate, or in respect of which the information contained in a certification or declaration is found by Canada to be false or misleading in any respect. If Canada establishes after award of the Contract that the Offeror provided a false or misleading certification or declaration, Canada may terminate the Contract for default. Pursuant to the Policy, Canada may also determine the Offeror to be ineligible for award of a Contract for providing a false or misleading certification or declaration",
                "Le Canada déclarera une offre non conforme s'il constate que les renseignements exigés sont incomplets ou inexacts, ou que les renseignements contenus dans une attestation ou une déclaration sont faux ou trompeurs, à quelque égard que ce soit. Si, après l'attribution du contrat, le Canada établit que l'Offrant a fourni une attestation ou une déclaration fausse ou trompeuse, il pourrait résilier le contrat pour manquement. Conformément à la Politique, le Canada pourrait également déterminer que l'Offrant est inadmissible à l'attribution d'un contrat parce qu'il a fourni une attestation ou une déclaration fausse ou trompeuse",
              ),
            ],
          ],
        },
        p(
          "Section 13 sets what all suppliers, regardless of their status under the policy, will submit:",
          "L'article 13 fixe ce que tous les fournisseurs, quel que soit leur statut dans le cadre de la politique, doivent fournir :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Supplier", "Fournisseur") },
            { kind: "main", label: both("Names, under section 13.1", "Noms, selon l'article 13.1") },
          ],
          rows: [
            [
              both("When", "Quand"),
              both(
                "To the contracting authority when responding to a procurement, applying for a standing offer or supply arrangement and, to the extent not included as part of such a process, before entering into a contract or other instrument to which the policy applies; all the parties to a joint venture are required to submit them",
                "À l'autorité contractante, lorsque le fournisseur participe à un processus d'approvisionnement, à une offre à commandes ou à un arrangement en matière d'approvisionnement et, dans la mesure où ils ne sont pas déjà fournis dans le cadre d'un tel processus, avant la conclusion d'un contrat ou d'un autre instrument auquel s'applique la politique; toutes les parties à une coentreprise doivent les communiquer",
              ),
            ],
            [both("Sole proprietor", "Propriétaire unique"), both("The name of the owner", "Le nom du propriétaire")],
            [
              both("Private corporation", "Société privée"),
              both(
                "The names of all directors and the names of all individuals and entities that hold 5% or more ownership",
                "Le nom de tous les administrateurs et de toutes les personnes et les entités qui détiennent 5 % des actions ou plus",
              ),
            ],
            [both("Non-profit corporation", "Société à but non lucratif"), both("The names of all directors", "Le nom de tous les administrateurs")],
            [both("Publicly traded corporation", "Société cotée en bourse"), both("The names of all directors", "Le nom de tous les administrateurs")],
            [both("General partnership", "Société en nom collectif"), both("The names of the partners", "Le nom de tous les partenaires")],
            [
              both("Partnership, limited and limited liability", "Société en commandite et société à responsabilité limitée"),
              both(
                "The name(s) of the general partner(s) and, if a corporation, the information required for the corporation",
                "Le nom de l'associé général et, dans le cas d'une société, les informations requises pour cette société",
              ),
            ],
            [
              both("Trust", "Fiducie"),
              both(
                "The name(s) of the trustee(s) and, if a corporation, the information required for the corporation",
                "Le nom des fiduciaires et, dans le cas d'une société, les informations requises pour cette société",
              ),
            ],
            [
              both("Not received", "Non reçus"),
              both(
                "If the information has not been received by the time the evaluation of bids or offers is completed, the contracting authority will inform the supplier of a time within which to provide it. Failure to provide it within such specified period will render a bid or offer non-responsive, or the supplier otherwise disqualified for award of a contract",
                "Si les renseignements n'ont pas été reçus avant la fin de l'évaluation des soumissions ou des offres, l'autorité contractante doit informer le fournisseur du délai pour leur communication. S'ils ne sont pas communiqués dans le délai prescrit, la soumission ou l'offre sera jugée non recevable ou le fournisseur sera exclu de l'attribution d'un contrat",
              ),
            ],
          ],
        },
        p(
          "Under section 13.2, the supplier will give PWGSC written notice of any change to that information, any new charge with respect to the supplier, and any new conviction or other circumstance with respect to itself, its affiliates and its first-tier subcontractors, each to the extent relevant to the policy:",
          "Selon l'article 13.2, le fournisseur doit fournir à TPSGC un avis écrit de toute modification à ces renseignements, de toute nouvelle accusation le concernant et de toute nouvelle condamnation ou autre circonstance le concernant, ou concernant ses affiliées et ses premiers sous-traitants, dans la mesure où cela s'applique dans le cadre de la politique :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "main", label: both("Instruments", "Instruments") },
            { kind: "text", label: both("Notice within", "Avis dans les") },
          ],
          rows: [
            [
              both("Procurements, standing offers, supply arrangements, contracts and other instruments not executed, entered into or otherwise awarded", "Processus d'approvisionnement, appels d'offres, offres à commandes, arrangements en matière d'approvisionnement, contrats ou autres instruments n'ayant pas été exécutés, établis ou attribués"),
              both("10 business days of any such change", "10 jours ouvrables suivant toute modification"),
            ],
            [
              both("Procurements, standing offers, supply arrangements, contracts and other instruments executed, entered into or otherwise awarded", "Appels d'offres, offres à commandes, arrangements en matière d'approvisionnement, contrats ou autres instruments exécutés, établis ou attribués"),
              both("22 business days of any such change", "22 jours ouvrables suivant toute modification"),
            ],
          ],
        },
      ],
    },
    {
      id: "subcontractors",
      title: both("First-Tier Subcontractors", "Premiers sous-traitants"),
      blocks: [
        p(
          "Section 12 sets the policy's obligations with respect to first-tier subcontractors. OSIC's page on subcontractors, modified December 12, 2025, says suppliers are required to verify the status of their prospective first-tier subcontractors prior to bid submission and before entering into a direct contractual relationship. In the policy's words:",
          "L'article 12 fixe les obligations de la politique à l'égard des premiers sous-traitants. La page du BICF sur les sous-traitants, modifiée le 12 décembre 2025, indique que les fournisseurs doivent vérifier la situation de leurs premiers sous-traitants éventuels avant la présentation d'une soumission et avant d'établir une relation contractuelle directe. Selon les termes de la politique :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Section", "Article") },
            { kind: "main", label: both("The policy's words", "Les termes de la politique") },
          ],
          rows: [
            [
              both("Appendix 1", "Annexe 1"),
              both(
                "A first-tier subcontract means a contract made between the supplier and a person (other than Canada) for carrying out or supplying goods for part or all of another contract between the supplier and Canada, and a sublease made between the supplier and a person (other than Canada) for part of or all of premises leased by Canada to the supplier; a first-tier subcontractor means a contractor to a first-tier subcontract",
                "Le premier contrat de sous-traitance s'entend d'un contrat conclu entre le fournisseur et une personne (autre que le Canada) pour l'exécution de travaux ou la fourniture de biens dans le cadre d'une partie ou de l'ensemble d'un autre contrat entre le fournisseur et le Canada, et d'un sous-bail conclu entre le fournisseur et une personne (autre que le Canada) pour une partie ou l'ensemble des lieux loués du fournisseur par le Canada; le premier sous-traitant s'entend d'un entrepreneur dans le cadre d'un premier contrat de sous-traitance",
              ),
            ],
            [
              both("12.1.1", "12.1.1"),
              both(
                "A supplier will not subcontract with a first-tier subcontractor, which is ineligible or suspended under this policy, to perform work under a contract that the supplier has with Canada, save and except if the supplier obtains advance written consent from the relevant Deputy Head or equivalent and provides a copy thereof to the Registrar (the Deputy Head or equivalent may not provide such consent when the first-tier subcontractor has no capacity to contract with Canada, or receive any benefit under a contract with Canada and any other person pursuant to subsection 750(3) of the Criminal Code or is otherwise prohibited to contract with Canada pursuant to a sanction listed in paragraph (1)(i) of Appendix 2), or if, during the period from when an offer/bid is received to and including the date when the offer/bid is awarded, accepted or called-up, unbeknownst to the supplier any or all of the supplier's first-tier subcontractors are determined to be ineligible, in which case section 12.3 is applicable",
                "Il est interdit à un fournisseur de conclure un premier contrat de sous-traitance avec un premier sous-traitant inadmissible ou suspendu au titre de la présente politique pour l'exécution de travaux dans le cadre d'un contrat entre le fournisseur et le Canada, sauf si le fournisseur obtient au préalable le consentement écrit de l'administrateur général (ou d'une personne occupant un poste équivalent) concerné et en fournit une copie au registraire (l'administrateur général ou la personne occupant un poste équivalent ne peut donner ce consentement lorsque le premier sous-traitant n'a pas la capacité de conclure un contrat avec le Canada, ou de recevoir un avantage en vertu d'un contrat entre le Canada et toute autre personne, aux termes du paragraphe 750(3) du Code criminel, ou qu'il lui est autrement interdit de conclure un contrat avec le Canada en raison d'une sanction énumérée à l'alinéa (1)(i) de l'annexe 2), ou si, entre la réception d'une offre ou d'une soumission et la date de son attribution, de son acceptation ou de la commande subséquente, un ou plusieurs premiers sous-traitants du fournisseur sont déclarés inadmissibles à son insu, auquel cas l'article 12.3 s'applique",
              ),
            ],
            [
              both("12.1.2", "12.1.2"),
              both(
                "Suppliers are required to verify whether a first-tier subcontractor has been declared to be ineligible or suspended: in the case of an individual, by a written request to the Registrar, along with a signed consent form from the prospective first-tier subcontractor; in the case of one that is not an individual, by consulting the public Ineligibility and Suspension List",
                "Les fournisseurs sont tenus de vérifier si un premier sous-traitant a été déclaré inadmissible ou suspendu : si c'est un particulier, par une demande écrite au registraire, accompagnée d'un formulaire de consentement signé par le premier sous-traitant potentiel; si ce n'est pas un particulier, en consultant la liste publique des fournisseurs inadmissibles et suspendus",
              ),
            ],
            [
              both("12.1.3", "12.1.3"),
              both(
                "A supplier that enters such a contract with a declared ineligible or suspended first-tier subcontractor, without written consent of the Deputy Head or equivalent, will, upon notice from the Registrar, be ineligible, with the period of ineligibility being determined in accordance with section 6.3",
                "Un fournisseur qui conclut un contrat de cette nature avec un premier sous-traitant inadmissible ou suspendu sans le consentement écrit de l'administrateur général (ou d'une personne occupant un poste équivalent) est, après avis du registraire, inadmissible durant la période d'inadmissibilité déterminée conformément à l'article 6.3",
              ),
            ],
            [
              both("12.2", "12.2"),
              both(
                "If, after a contract is entered into or the related bid/offer is awarded or accepted, any or all of a supplier's first-tier subcontractors become ineligible, the supplier will, as soon as the same becomes known by the supplier, terminate all such subcontracts with the first-tier subcontractors which have no capacity to contract with Canada, or receive any benefit under a contract with Canada and any other person pursuant to subsection 750(3) of the Criminal Code or which are otherwise prohibited to contract with Canada pursuant to a sanction listed in paragraph (1)(i) of Appendix 2, failing which, upon notice of the contracting authority, the contract will terminate; and may choose to maintain or terminate any or all other first-tier subcontracts",
                "Si, après la conclusion d'un contrat ou l'attribution ou l'acceptation de l'offre ou de la soumission, un ou plusieurs premiers sous-traitants du fournisseur deviennent inadmissibles, le fournisseur doit, aussitôt qu'il a connaissance de la situation, résilier tout contrat de sous-traitance avec le premier sous-traitant qui n'a pas la capacité de conclure un contrat avec le Canada, ou de tirer profit de tout contrat conclu entre le Canada et toute autre personne en vertu du paragraphe 750(3) du Code criminel ou à qui il est interdit de conclure un contrat avec le Canada en application d'une sanction énoncée à l'alinéa (1)(i) de l'annexe 2, faute de quoi, après avis de l'autorité contractante, le contrat sera résilié; et peut choisir de maintenir ou de résilier tout autre premier contrat de sous-traitance",
              ),
            ],
            [
              both("12.4", "12.4"),
              both(
                "The contracting authority may advise a supplier identified as the top-ranked bidder/offeror according to the evaluation criteria that it is required (or the supplier may decide) to verify the status of all proposed first-tier subcontractors before its bid/offer is awarded, accepted or called-up. If requested by the contracting authority, the supplier must advise the contracting authority in writing within 5 business days of the request, of the results of the integrity verification",
                "L'autorité contractante peut aviser le fournisseur classé au premier rang selon les critères d'évaluation qu'il est tenu (ou le fournisseur peut décider) de vérifier le statut de tous les premiers sous-traitants proposés avant que son offre ou sa soumission ne soit attribuée, acceptée ou ne fasse l'objet d'une commande subséquente. Si l'autorité contractante le demande, le fournisseur doit l'informer par écrit des résultats de la vérification de l'intégrité dans les 5 jours ouvrables suivant la demande",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "agreements",
      title: both("Administrative Agreements", "Ententes administratives"),
      blocks: [
        p(
          "Appendix 1 defines an administrative agreement as a negotiated agreement between a supplier and the Registrar. OSIC's page of administrative actions, modified May 14, 2026, links a list of the suppliers with administrative agreements under the policy. The policy holds more than this guide covers, among it pardons (section 6.6), a limited review where ineligibility results from the actions of affiliates (section 8), and contracts awarded with first-tier subcontractors that became ineligible or suspended between an offer and its award (section 12.3). Section 10, in the policy's words:",
          "L'annexe 1 définit l'entente administrative comme une entente négociée entre un fournisseur et le registraire. La page du BICF sur les mesures administratives, modifiée le 14 mai 2026, renvoie à une liste des fournisseurs ayant conclu une entente administrative en vertu de la politique. La politique contient plus que ce que ce guide présente, notamment les pardons (article 6.6), un examen restreint lorsque l'inadmissibilité découle des actes d'affiliés (article 8) et les contrats attribués alors que des premiers sous-traitants sont devenus inadmissibles ou suspendus entre une offre et son attribution (article 12.3). L'article 10, selon les termes de la politique :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Section", "Article") },
            { kind: "main", label: both("The policy's words", "Les termes de la politique") },
          ],
          rows: [
            [
              both("10.1.1", "10.1.1"),
              both(
                "At any time after sending a Notice of Intention to Declare Ineligible, or a Notice of Intention to Suspend, the Registrar may, in the Registrar's discretion, enter into an administrative agreement with a supplier: to suspend the period of a supplier's ineligibility; in lieu of or to stay a suspension in accordance with section 10.2; in lieu of terminating an existing contract due to a determination of ineligibility; or as a condition of entering into a contract under a Public Interest Exception as provided in section 9.2",
                "Après avoir envoyé un avis d'intention de déclarer inadmissible ou un avis d'intention de suspendre, le registraire peut, à sa discrétion, conclure une entente administrative avec un fournisseur : pour suspendre la période d'inadmissibilité du fournisseur; au lieu d'une suspension ou pour surseoir à une suspension, conformément à l'article 10.2; en remplacement de la résiliation d'un contrat existant en raison d'une détermination d'inadmissibilité; ou comme condition à la conclusion d'un contrat dans le cadre de l'exception destinée à protéger l'intérêt public prévue à l'article 9.2",
              ),
            ],
            [
              both("10.1.2", "10.1.2"),
              both(
                "An ineligible supplier can request an administrative agreement after 36 months from the delivery of the Notice of Ineligibility. In order for the request to be considered, the supplier is required to demonstrate that it cooperated with law enforcement authorities where applicable and/or has undertaken remedial action(s) to address the wrongdoing that led to the supplier's ineligibility",
                "Un fournisseur inadmissible peut demander à conclure une entente administrative après la fin des 36 mois suivant la délivrance de l'avis d'inadmissibilité. Pour que la demande soit examinée, le fournisseur doit prouver qu'il a coopéré avec les autorités chargées de l'application des lois, le cas échéant, et/ou a appliqué des mesures correctives à l'égard des actes répréhensibles à l'origine de son inadmissibilité",
              ),
            ],
            [
              both("10.2.2", "10.2.2"),
              both(
                "Such administrative agreements may be entered into before or after a Notice of Suspension and a supplier may request, at any time, to enter into an administrative agreement for the purposes of staying or avoiding a suspension",
                "Ces ententes administratives peuvent être conclues avant ou après un avis de suspension, et un fournisseur peut demander, en tout temps, à conclure une entente administrative afin de surseoir à une suspension ou de l'éviter",
              ),
            ],
            [
              both("10.3.4", "10.3.4"),
              both(
                "An administrative agreement will have no retroactive effect nor will it rectify or otherwise correct any actions of a supplier during any period of ineligibility or suspension before the entering into of an administrative agreement",
                "Une entente administrative n'a aucun effet rétroactif et ne rectifie ni ne corrige autrement les actes d'un fournisseur pendant toute période d'inadmissibilité ou de suspension antérieure à sa conclusion",
              ),
            ],
            [
              both("10.3.7", "10.3.7"),
              both(
                "The existence of an administrative agreement will be made public, while the content of the agreement will remain confidential to the extent permitted by law",
                "L'existence d'une entente administrative sera rendue publique, mais le contenu de l'entente demeurera confidentiel dans la mesure permise par la loi",
              ),
            ],
            [
              both("10.4", "10.4"),
              both(
                "If the supplier is ineligible or suspended and does not enter into such an administrative agreement or the Registrar is not prepared to enter into an administrative agreement with the supplier, the supplier will remain ineligible or suspended, as the case may be",
                "Si le fournisseur est inadmissible ou suspendu et ne conclut pas une telle entente administrative, ou si le registraire n'est pas prêt à conclure une entente administrative avec lui, le fournisseur demeure inadmissible ou suspendu, selon le cas",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "list",
      title: both("The Public List", "La liste publique"),
      blocks: [
        p(
          "OSIC's page of ineligible and suspended suppliers, modified September 3, 2026, holds the list; its columns are Supplier name, Address, Status, Start date of ineligibility or suspension, and End date of ineligibility or suspension. Appendix 1 defines:",
          "La page du BICF sur les fournisseurs inadmissibles et suspendus, modifiée le 3 septembre 2026, contient la liste; ses colonnes sont Nom du fournisseur, Adresse, Statut, Date de début de la période d'inadmissibilité ou de suspension, et Date de fin de la période d'inadmissibilité ou de suspension. L'annexe 1 définit :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Term", "Terme") },
            { kind: "main", label: both("Definition in Appendix 1", "Définition à l'annexe 1") },
          ],
          rows: [
            [
              both("Ineligibility and Suspension List", "Liste de fournisseurs inadmissibles et suspendus"),
              both(
                "The public list of companies that have been determined to be ineligible or suspended by the Registrar under this policy",
                "La liste publique d'entreprises qui ont été déterminées inadmissibles ou suspendues par le registraire dans le cadre de la présente politique",
              ),
            ],
            [
              both("Integrity Database", "Base de données sur l'intégrité"),
              both(
                "A list to be maintained by PWGSC that records all determinations of ineligibility and suspension, including companies and individuals, and the period of ineligibility that applies to that supplier",
                "La liste tenue à jour par TPSGC et dans laquelle sont consignées toutes les déterminations d'inadmissibilité et de suspension, que ce soit pour des entreprises ou des particuliers, ainsi que la période d'inadmissibilité qui touche le fournisseur",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "records",
      title: both("What the Records Show", "Ce que montrent les dossiers"),
      blocks: [
        p(
          "CanadaBuys' data dictionary, in its file last modified on March 24, 2026, has no field that marks integrity provisions, an ineligibility or a suspension; it says a tender notice's description does not duplicate the information or details found in the attachments, such as clauses or sample documents. The Treasury Board's schema of the published contracts over $10,000 has no such field either. Award Watch does not show whether a supplier is ineligible, suspended or party to an administrative agreement; PSPC's list is the source. On a notice's page, Award Watch lists the documents the CanadaBuys data names for it, each linked where the government keeps it, and does not show what they say.",
          "Le dictionnaire de données d'AchatsCanada, dans son fichier modifié pour la dernière fois le 24 mars 2026, ne comporte aucun champ qui indique des dispositions en matière d'intégrité, une inadmissibilité ou une suspension; il précise que la description d'un avis d'appel d'offres ne reproduit pas les renseignements ou les détails se trouvant dans les pièces jointes, telles que des clauses ou des modèles de documents. Le schéma du Conseil du Trésor des contrats publiés de plus de 10 000 $ n'en comporte pas non plus. Award Watch n'indique pas si un fournisseur est inadmissible, suspendu ou partie à une entente administrative; la liste de SPAC fait foi. Sur la page d'un avis, Award Watch énumère les documents que les données d'AchatsCanada lui associent, chacun lié à l'endroit où le gouvernement le conserve, sans afficher leur contenu.",
        ),
        figure(
          "integrity-documents", SAMPLE_NOTICE_INTEGRITY, "section.panel.tender-documents",
          both(
            "The Documents panel of a Fisheries and Oceans Canada tender notice's page on Award Watch: the number of documents, the closing line, the request for proposal in English and in French, and the line that they are on CanadaBuys.",
            "Le panneau Documents de la page d'un avis d'appel d'offres de Pêches et Océans Canada sur Award Watch : le nombre de documents, la ligne de clôture, la demande de propositions en anglais et en français, et la mention qu'ils se trouvent sur AchatsCanada.",
          ),
          both("The solicitation documents of a tender notice on Award Watch.", "Les documents de la demande de soumissions d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(".panel-head h2", "CanadaBuys' data dictionary has no field that marks integrity provisions, an ineligibility or a suspension.",
              "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ qui indique des dispositions en matière d'intégrité, une inadmissibilité ou une suspension."),
            mark(".documents-closing", "An offeror unable to provide all of the certifications must submit a completed Integrity declaration form at the time of its offer.",
              "L'offrant incapable de fournir toutes les attestations doit soumettre un formulaire de déclaration d'intégrité dûment rempli au moment de présenter son offre."),
            mark("ul.documents", "Under clause 1.1, the policy in effect on the date the solicitation of offers is issued is incorporated by reference into, and forms a binding part of, the solicitation.",
              "Selon la clause 1.1, la politique en vigueur à la date de publication de la demande d'offres est incorporée par renvoi à la demande d'offres et en fait partie intégrante."),
            mark(".panel-foot", "Award Watch lists the documents the CanadaBuys data names, each linked where the government keeps it, and does not show what they say.",
              "Award Watch énumère les documents que les données d'AchatsCanada nomment, chacun lié à l'endroit où le gouvernement le conserve, sans afficher leur contenu."),
          ],
        ),
        p(
          "This {example} from National Defence, a request for proposal for high-visibility fire protective coveralls closing January 7, 2027, links its request for proposal in English and in French on CanadaBuys. In the English document, dated November 12, 2026, section 3.4, Ineligibility and Suspension Policy, holds subsections a to f, from Mandatory Compliance to Compliance with Certifications, and clause 16.9 of the resulting contract incorporates the policy and all related directives incorporated by reference into the solicitation of offers on its closing date.",
          "Cet {example} de la Défense nationale, une demande de propositions pour des combinaisons de protection de feu à haute visibilité dont la clôture est fixée au 7 janvier 2027, renvoie à sa demande de propositions en anglais et en français sur AchatsCanada. Dans le document anglais, daté du 12 novembre 2026, la section 3.4, Politique d'inadmissibilité et de suspension, comporte les paragraphes a à f, de Conformité obligatoire à Conformité avec les attestations, et la clause 16.9 du contrat subséquent intègre la politique et toutes les directives connexes incorporées par renvoi à la demande d'offres à sa date de clôture.",
          { example: a(EXAMPLE_INTEGRITY, "tender notice", "avis d'appel d'offres") },
        ),
      ],
    },
  ],
  sources: [
    SRC.osic, SRC.osicAbout, SRC.isPolicy, SRC.osicPolicies, SRC.osicNews, SRC.osicDepartments, SRC.osicClauses, SRC.osicSubcontractors,
    SRC.osicActions, SRC.osicList, SRC.dictionary, SRC.contractsSchema, SRC.exampleIntegrity,
  ],
};

const BUY_CANADIAN: Guide = {
  slug: BUY_CANADIAN_PATH.slice("/guides/".length),
  title: both("The Buy Canadian Policy on Federal Tenders", "La Politique « Achetez canadien » dans les appels d'offres fédéraux"),
  seoTitle: both("Buy Canadian Policy on Federal Tenders", "Politique « Achetez canadien » et appels d'offres fédéraux"),
  summary: both(
    "The Buy Canadian Policy's instruments and dates, the procurements and values they cover, who counts as Canadian and what a tender notice asks for.",
    "Les instruments et les dates de la Politique « Achetez canadien », les marchés visés, ce qui compte comme canadien et ce que demande un avis.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To keep track of new federal tender notices, those that state Buy Canadian requirements among them, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux, y compris ceux qui énoncent des exigences « Achetez canadien », enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "instruments",
      title: both("The Framework and Its Policies", "Le Cadre et ses politiques"),
      blocks: [
        p(
          "CanadaBuys pages, its tender notices among them, carry a banner on the Buy Canadian Policy. Its foundation is the Buy Canadian Procurement Policy Framework, which took effect on December 16, 2025; the policies issued under it set the specific requirements. Treasury Board Contracting Policy Notice 2025-7, dated December 17, 2025, describes the change as moving from \"best efforts\" to a clear obligation to buy Canadian, and reports that the Directive on the Management of Procurement was amended: its Appendix D.7 requires contracting authorities to adhere to the Framework's requirements in procurements.",
          "Les pages d'AchatsCanada, dont ses avis d'appel d'offres, portent un bandeau sur la Politique « Achetez canadien ». Son fondement est le Cadre stratégique de la politique d'approvisionnement « Achetez canadien », entré en vigueur le 16 décembre 2025; les politiques publiées en vertu du Cadre en fixent les exigences précises. L'Avis sur la Politique des marchés 2025-7 du Conseil du Trésor, daté du 17 décembre 2025, décrit le passage du principe des « meilleurs efforts » à une obligation claire d'acheter canadien, et indique que la Directive sur la gestion de l'approvisionnement a été modifiée : son annexe D.7 exige que les autorités contractantes se conforment aux exigences du Cadre dans leurs approvisionnements.",
        ),
        p(
          "The Framework lists the instruments that are or will be issued under it:",
          "Le Cadre énumère les instruments qui sont ou seront publiés en vertu de celui-ci :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Instrument", "Instrument") },
            { kind: "label", label: both("In effect", "En vigueur") },
            { kind: "main", label: both("What it does", "Ce qu'il prévoit") },
          ],
          rows: [
            [
              both(
                "Policy on Prioritizing Canadian Materials in Federal Procurements (CM Policy)",
                "Politique sur la priorisation des matériaux canadiens dans l'approvisionnement fédéral (Politique sur les MC)",
              ),
              both("December 16, 2025", "16 décembre 2025"),
              both(
                "Mandates the use of Canadian-produced materials, such as steel, wood products and aluminum, in federal construction and defence procurements",
                "Rend obligatoire l'utilisation de matériaux produits au Canada, comme l'acier, les produits du bois et l'aluminium, dans les approvisionnements fédéraux en matière de construction et de défense",
              ),
            ],
            [
              both(
                "Policy on Prioritizing Canadian Suppliers and Canadian Content in Strategic Federal Procurements (CSCC Policy)",
                "Politique sur la priorisation des fournisseurs canadiens et du contenu canadien dans les approvisionnements stratégiques fédéraux (Politique sur la PFCCC)",
              ),
              both("December 16, 2025", "16 décembre 2025"),
              both(
                "Reduces the total value of Canadian suppliers' financial proposals for evaluation only, and evaluates bids on their Canadian goods, services or value-added",
                "Réduit la valeur totale de la proposition financière des fournisseurs canadiens aux fins d'évaluation seulement, et évalue les soumissions en fonction de leurs biens, services ou valeur ajoutée canadiens",
              ),
            ],
            [
              both("Interim Policy on Reciprocal Procurement", "Politique provisoire sur l'approvisionnement réciproque"),
              both("July 14, 2025", "14 juillet 2025"),
              both("Limits access to procurement opportunities based on the location of suppliers", "Limite l'accès aux occasions d'approvisionnement selon l'emplacement des fournisseurs"),
            ],
            [
              both("Small Business Procurement Program", "Programme d'approvisionnement auprès des petites entreprises"),
              both("Launched July 6, 2026", "Lancé le 6 juillet 2026"),
              both(
                "Launched to increase the participation of small businesses in federal procurement; the Framework describes it as reserving opportunities for Canadian small businesses, with mandatory set-asides applied where feasible",
                "Lancé pour accroître la participation des petites entreprises aux marchés publics fédéraux; le Cadre le décrit comme réservant des occasions aux petites entreprises canadiennes, avec des marchés réservés obligatoires dans la mesure du possible",
              ),
            ],
          ],
        },
        p(
          "The CM and CSCC policies do not apply to solicitations published or contracts awarded before December 16, 2025, and under the reciprocal procurement policy published solicitations and existing contracts need not be amended. Each policy applies to an existing supply arrangement or standing offer at its next renewal; under the reciprocal policy, the next renewal of an existing supply arrangement must be completed by July 14, 2026.",
          "Les politiques sur les MC et sur la PFCCC ne s'appliquent pas aux demandes d'offres publiées ni aux contrats attribués avant le 16 décembre 2025, et selon la politique d'approvisionnement réciproque, les demandes de soumissions publiées et les contrats existants n'ont pas besoin d'être modifiés. Chaque politique s'applique à un arrangement en matière d'approvisionnement ou à une offre à commandes existants à leur prochain renouvellement; selon la politique d'approvisionnement réciproque, le prochain renouvellement d'un arrangement existant doit être effectué d'ici le 14 juillet 2026.",
        ),
        p(
          "The {sbpp} explains the program.",
          "Le {sbpp} explique le programme.",
          {
            sbpp: a(SBPP_PATH, "guide on the Small Business Procurement Program", "guide sur le Programme d'approvisionnement auprès des petites entreprises"),
          },
        ),
      ],
    },
    {
      id: "scope",
      title: both("Which Buyers and Procurements", "Quels acheteurs et quels approvisionnements"),
      blocks: [
        p(
          "The Framework applies to all departments and agencies listed in Schedules I, I.1 and II of the Financial Administration Act. Notice 2025-7 encourages Crown corporations and their subsidiaries to align with it in a manner consistent with their mandates. The policies issued under it apply unless the procurement supports sensitive operations or missions abroad, is a contract with another government or government entity (Foreign Military Sales included), or has all its deliverables delivered solely outside Canada with significant efficiency gains or savings. Each policy sets its own scope:",
          "Le Cadre s'applique à tous les ministères et organismes énumérés aux annexes I, I.1 et II de la Loi sur la gestion des finances publiques. L'avis 2025-7 encourage les sociétés d'État et leurs filiales à se conformer au Cadre conformément à leurs mandats. Les politiques publiées en vertu du Cadre s'appliquent, sauf si l'approvisionnement appuie des opérations de nature délicate ou des missions à l'étranger, s'il s'agit d'un contrat conclu avec un autre gouvernement ou une autre entité gouvernementale (ventes militaires à l'étranger comprises), ou si tous les produits livrables sont livrés uniquement à l'extérieur du Canada et entraînent des économies ou des gains d'efficacité importants. Chaque politique fixe sa propre portée :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Policy", "Politique") },
            { kind: "main", label: both("Procurements covered", "Marchés visés") },
            { kind: "text", label: both("Value", "Valeur") },
          ],
          rows: [
            [
              both("CM Policy", "Politique sur les MC"),
              both(
                "Competitive and non-competitive defence goods and construction procurements by or on behalf of departments and agencies; defence goods are those its Appendix B lists, when bought by or for National Defence, the RCMP or the Canadian Coast Guard. The requirements apply to each material the contract is expected to require in an amount of $250,000 or more, and its use is then mandatory in performing the contract.",
                "Approvisionnements concurrentiels et non concurrentiels de biens de défense et de travaux de construction menés par un ministère ou un organisme ou en son nom; les biens de défense sont ceux que son annexe B énumère, acquis par ou pour la Défense nationale, la GRC ou la Garde côtière canadienne. Les exigences s'appliquent à chaque matériau que l'exécution du contrat devrait nécessiter pour un montant de 250 000 $ ou plus, et son utilisation est alors obligatoire pour l'exécution des travaux.",
              ),
              both("$25 million or more, taxes included", "25 millions de dollars ou plus, taxes comprises"),
            ],
            [
              both("CSCC Policy", "Politique sur la PFCCC"),
              both(
                "Competitive procurements in five sectors (defence and security; health and pharmaceutical; infrastructure, construction and transportation; information and communications technology; consumer and industrial goods and materials) and the professional services directly supporting them",
                "Approvisionnements concurrentiels dans cinq secteurs (défense et sécurité; santé et produits pharmaceutiques; infrastructure, construction et transport; technologies de l'information et des communications; biens et matériaux de consommation et industriels) et les services professionnels qui les appuient directement",
              ),
              both(
                "$25 million and up, published after December 16, 2025; $5 million and up, published after June 15, 2026; taxes included",
                "25 millions de dollars et plus, publiés après le 16 décembre 2025; 5 millions de dollars et plus, publiés après le 15 juin 2026; taxes comprises",
              ),
            ],
            [
              both("Reciprocal procurement", "Approvisionnement réciproque"),
              both(
                "New procurements by or on behalf of departments and agencies, except those at least 51% for defence goods or services, certain non-competitive contracts and the other cases the policy lists",
                "Nouveaux marchés entrepris pour ou par des ministères ou organismes, sauf ceux dont au moins 51 % de la valeur concerne des biens ou des services de défense, certains contrats non concurrentiels et les autres cas qu'énumère la politique",
              ),
              both("Excluded below an estimated value of $10,000", "Exclus lorsque la valeur estimée est inférieure à 10 000 $"),
            ],
          ],
        },
        p(
          "Under the CM and CSCC policies, a department or agency may exclude a procurement case by case, where strictly necessary, for best value (an expected cost increase of 25% or more), public interest, no capacity or availability, undue delay to the procurement of critical defence or national security equipment, or commercial or military off-the-shelf products. Its minister must approve the exception; where a common service provider such as Public Services and Procurement Canada (PSPC) runs the procurement, that provider's minister must also approve it before solicitation.",
          "Selon les politiques sur les MC et sur la PFCCC, un ministère ou un organisme peut exclure un approvisionnement au cas par cas, lorsque cela est strictement nécessaire, pour le meilleur rapport qualité-prix (une augmentation prévue des coûts de 25 % ou plus), l'intérêt public, l'absence de capacité ou de disponibilité, un retard injustifié dans l'acquisition d'équipement essentiel de défense ou de sécurité nationale, ou des produits commerciaux ou militaires standard. Son ou sa ministre doit approuver l'exception; lorsqu'un fournisseur de services communs comme Services publics et Approvisionnement Canada (SPAC) mène l'approvisionnement, le ou la ministre responsable de ce fournisseur doit aussi l'approuver avant la demande d'offres.",
        ),
      ],
    },
    {
      id: "canadian",
      title: both("What Counts as Canadian", "Ce qui compte comme canadien"),
      blocks: [
        p(
          "The reciprocal policy defines a Canadian supplier by the place of business alone.",
          "La politique d'approvisionnement réciproque définit le fournisseur canadien par l'établissement seulement.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Term", "Terme") },
            { kind: "main", label: both("Definition", "Définition") },
            { kind: "label", label: both("Defined in", "Défini dans") },
          ],
          rows: [
            [
              both("Canadian supplier", "Fournisseur canadien"),
              both(
                "A place of business in Canada, clearly identified by name and accessible during normal business hours, where it conducts activities on a permanent basis (for a joint venture, each member has one); registered and filing taxes in Canada; a registered address in Canada, with personnel employed or day-to-day business activities conducted in Canada; and no subcontracting of work to non-Canadian suppliers or individuals outside Canada in a manner that results in minimal value-added activities within Canada",
                "Un établissement au Canada clairement désigné par un nom et accessible pendant les heures normales de travail, à partir duquel il exerce ses activités de façon permanente (pour une coentreprise, chaque membre en a un); enregistré aux fins de déclaration d'impôts au Canada et produisant de telles déclarations; une adresse enregistrée au Canada, où il emploie du personnel ou conduit des affaires régulières; et aucune sous-traitance des travaux à un fournisseur non canadien ou à des personnes situées à l'extérieur du Canada de façon à réduire au minimum les activités à valeur ajoutée exécutées au Canada",
              ),
              both("CSCC Policy", "Politique sur la PFCCC"),
            ],
            [
              both("Supplier of an applicable trading partner", "Fournisseur d'un partenaire commercial concerné"),
              both(
                "Such a place of business in a country or customs territory listed in the schedule to the Canadian International Trade Tribunal Procurement Inquiry Regulations as a party to one or more of the trade agreements that apply to the procurement (for a joint venture, at least one member has one, and each other member does too or is a Canadian supplier)",
                "Un tel établissement dans un pays ou un territoire douanier qui figure à l'annexe du Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics en tant que partie d'au moins un accord commercial applicable au processus d'approvisionnement (pour une coentreprise, au moins un membre en a un, et chaque autre membre en a un aussi ou est un fournisseur canadien)",
              ),
              both("CSCC and reciprocal policies", "Politiques sur la PFCCC et d'approvisionnement réciproque"),
            ],
            [
              both("Canadian good and Canadian service", "Bien canadien et service canadien"),
              both(
                "A good wholly manufactured or originating in Canada, or a product with imported components that has undergone sufficient change in Canada to satisfy the rules of origin of the Canada-United States-Mexico Agreement, read with Canada in place of the territory of the Parties; a service wholly provided by individuals based in Canada, construction services included",
                "Un bien entièrement fabriqué au Canada ou d'origine canadienne, ou un produit contenant des composants importés qui a subi au Canada des modifications suffisantes pour répondre aux règles d'origine de l'Accord Canada-États-Unis-Mexique, en remplaçant le territoire des Parties par le Canada; un service entièrement fourni par des personnes établies au Canada, services de construction compris",
              ),
              both("CSCC Policy", "Politique sur la PFCCC"),
            ],
            [
              both("Canadian content (Canadian value-added)", "Contenu canadien (valeur ajoutée canadienne)"),
              both(
                "For services, a Canadian service or the proportion of the service contract performed by individuals based in Canada; for goods, a Canadian good, the value of the part produced in Canada, or the difference between the dutiable value of imported goods and the selling price, including costs incurred in Canada such as research and development, installation and after-sales service",
                "Pour les services, un service canadien ou la proportion du contrat de service exécutée par des personnes établies au Canada; pour les biens, un bien canadien, la valeur de la partie produite au Canada, ou la différence entre la valeur imposable des marchandises importées et le prix de vente, y compris les coûts engagés au Canada, comme la recherche et le développement, l'installation et le service après-vente",
              ),
              both("CSCC Policy", "Politique sur la PFCCC"),
            ],
            [
              both("Canadian materials", "Matériaux canadiens"),
              both(
                "Steel melted and poured in Canada, solid wood products produced in Canada and aluminum smelted and cast in Canada (for aluminum other than sheets and plates, the largest volume of the primary aluminum it contains was produced in Canada), with the finished products made from them, listed by Harmonized System code in Appendix C",
                "L'acier fondu et coulé au Canada, les produits en bois massif fabriqués au Canada et l'aluminium fondu et coulé au Canada (pour l'aluminium autre que les tôles et les plaques, le plus grand volume de l'aluminium primaire qu'il contient a été produit au Canada), ainsi que les produits finis faits de ces matériaux, énumérés par code du Système harmonisé à l'annexe C",
              ),
              both("CM Policy", "Politique sur les MC"),
            ],
          ],
        },
      ],
    },
    {
      id: "evaluation",
      title: both("How Bids Are Evaluated", "Évaluation des soumissions"),
      blocks: [
        p(
          "When the CSCC Policy applies and no exception does, competition is open to Canadian suppliers and, if any international trade agreement applies to the solicitation, to suppliers of an applicable trading partner. An eligible Canadian supplier's offer receives a 10 percent reduction to the total value of its financial proposal, for evaluation only: the policy's example evaluates a $100,000 offer at $90,000, while the actual offer price remains $100,000.",
          "Lorsque la Politique sur la PFCCC s'applique et qu'aucune exception ne s'applique, la concurrence est ouverte aux fournisseurs canadiens et, si des accords commerciaux internationaux s'appliquent à la demande d'offres, aux fournisseurs d'un partenaire commercial concerné. L'offre d'un fournisseur canadien admissible reçoit une réduction de 10 pour cent de la valeur totale de sa proposition financière, aux fins d'évaluation seulement : l'exemple de la politique évalue une offre de 100 000 $ à 90 000 $, alors que le prix réel de l'offre reste 100 000 $.",
        ),
        p(
          "For Canadian content, the contracting authority chooses one of two methods: 25 percent of the total evaluation score for Canadian value-added, or, where point-rated criteria may not be suitable, a 25 percent price-based evaluation credit on the financial proposal, for evaluation only. Mandatory Canadian materials are excluded from either calculation. A minimum mandatory Canadian value-added, set only where the procurement's objectives justify it, and any change to these methods need approval at the Assistant Deputy Minister level.",
          "Pour le contenu canadien, l'autorité contractante choisit l'une de deux méthodes : 25 pour cent de la note totale de l'évaluation pour la valeur ajoutée canadienne ou, lorsque la méthode des critères cotés peut ne pas convenir, un crédit d'évaluation fondé sur le prix de 25 pour cent appliqué à la proposition financière, aux fins d'évaluation seulement. Les matériaux canadiens obligatoires sont exclus de l'un et l'autre calcul. Une exigence minimale obligatoire de valeur ajoutée canadienne, établie seulement si les objectifs de l'approvisionnement la justifient, et toute modification de ces méthodes doivent être approuvées au niveau du sous-ministre adjoint.",
        ),
        p(
          "CanadaBuys' answers for suppliers say solicitations applying the CM Policy are open to all suppliers.",
          "Les réponses d'AchatsCanada aux fournisseurs indiquent que les appels d'offres auxquels s'applique la Politique sur les MC sont ouverts à tous les fournisseurs.",
        ),
      ],
    },
    {
      id: "notice",
      title: both("What a Notice Shows and Asks For", "Ce que l'avis indique et demande"),
      blocks: [
        p(
          "CanadaBuys' data dictionary has no field for these policies; a notice may state them in its description, which Award Watch shows under Description as Published. For a request for proposal, PSPC's Buyer's Guide has buyers put a reciprocal procurement statement in the notice's description field; where the policy applies, it reads: \"Policy on Reciprocal Procurement: This solicitation of offers is open only to Canadian Suppliers (if subject to any international trade agreement(s): and to Suppliers of an Applicable Trading Partner).\"",
          "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ pour ces politiques; un avis peut les énoncer dans sa description, qu'Award Watch affiche sous Description publiée. Pour une demande de propositions, le Guide de l'acheteur de SPAC demande aux acheteurs d'inscrire un énoncé sur l'approvisionnement réciproque dans le champ de description de l'avis; lorsque la politique s'applique, il se lit : « Politique sur l'approvisionnement réciproque : Le présent appel d'offres est ouvert uniquement aux fournisseurs canadiens (s'il est assujetti à un ou plusieurs accords commerciaux internationaux, ajouter « et aux fournisseurs d'un partenaire commercial applicable »). »",
        ),
        p(
          "This {example} from National Defence says it is subject to the CSCC Policy and only open to Canadian Suppliers and Suppliers of an Applicable Trading Partner, and asks for a Canadian Content Attestation Form. Each policy has the offeror submit its own attestation or declaration:",
          "Cette {example} de la Défense nationale indique qu'elle est assujettie à la Politique sur la PFCCC et seulement ouverte aux fournisseurs canadiens et aux fournisseurs d'un partenaire commercial concerné, et demande un formulaire d'attestation relative au contenu canadien. Chaque politique fait soumettre à l'offrant sa propre attestation ou déclaration :",
          { example: a(EXAMPLE_BUY_CANADIAN, "request for standing offer", "demande d'offre à commandes") },
        ),
        figure(
          "buy-canadian-description", SAMPLE_NOTICE_BUY_CANADIAN, "section.panel:has(.prose)",
          both(
            "The Description as Published panel of a tender notice's page on Award Watch, whose description states that the notice is subject to the CSCC Policy, who may bid and the attestation forms offerors submit.",
            "Le panneau de la description publiée de la page d'un avis d'appel d'offres sur Award Watch, dont la description indique que l'avis est assujetti à la Politique sur la PFCCC, qui peut soumissionner et les formulaires d'attestation que soumettent les offrants.",
          ),
          both("A tender notice's description on Award Watch.", "La description d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(".panel-head h2",
              "CanadaBuys' data dictionary has no field for these policies; a notice may state them in its description, which Award Watch shows under Description as Published.",
              "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ pour ces politiques; un avis peut les énoncer dans sa description, qu'Award Watch affiche sous Description publiée."),
            mark(".prose p:nth-child(2)",
              "When the CSCC Policy applies, competition is open to Canadian suppliers and, if any international trade agreement applies to the solicitation, to suppliers of an applicable trading partner.",
              "Lorsque la Politique sur la PFCCC s'applique, la concurrence est ouverte aux fournisseurs canadiens et, si des accords commerciaux internationaux s'appliquent à la demande d'offres, aux fournisseurs d'un partenaire commercial concerné."),
            mark(".prose p:nth-child(3)",
              "Under the CSCC Policy, the offeror submits a Supplier Eligibility Attestation Form and, when applicable, a Canadian Content Attestation Form.",
              "Selon la Politique sur la PFCCC, l'offrant soumet un formulaire d'attestation relative à l'admissibilité du fournisseur et, s'il y a lieu, un formulaire d'attestation relative au contenu canadien."),
          ],
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Policy", "Politique") },
            { kind: "main", label: both("What the offeror submits", "Ce que l'offrant soumet") },
            { kind: "main", label: both("When, as the policy states it", "Quand, selon la politique") },
          ],
          rows: [
            [
              both("CSCC Policy", "Politique sur la PFCCC"),
              both(
                "A Supplier Eligibility Attestation Form; when applicable, a Canadian Content Attestation Form giving the Canadian value-added of each line item",
                "Un formulaire d'attestation relative à l'admissibilité du fournisseur; s'il y a lieu, un formulaire d'attestation relative au contenu canadien qui donne la valeur ajoutée canadienne de chaque article",
              ),
              both(
                "At offer closing; an offeror without the content form by then waives its right to the additional scores",
                "À la clôture; l'offrant qui n'a pas remis le formulaire sur le contenu à ce moment renonce à son droit aux points supplémentaires",
              ),
            ],
            [
              both("CM Policy", "Politique sur les MC"),
              both(
                "A mandatory certification, completed by all offerors, committing to use the Canadian materials in performing the contract",
                "Une attestation obligatoire, remplie par tous les offrants, dans laquelle ils s'engagent à utiliser les matériaux canadiens dans l'exécution du contrat",
              ),
              both(
                "With the offer; the contracting authority requests it if it is not included, and disqualifies as non-compliant an offer that does not include or submit it",
                "Avec l'offre; l'autorité contractante la demande si l'offre ne l'inclut pas, et déclare non conforme toute offre qui ne l'a pas incluse ou fournie",
              ),
            ],
            [
              both("Reciprocal procurement", "Approvisionnement réciproque"),
              both(
                "A declaration that the supplier is a Canadian supplier or, where an international trade agreement applies, a supplier of an applicable trading partner, assessed pass or fail",
                "Une déclaration selon laquelle le fournisseur est un fournisseur canadien ou, lorsqu'un accord commercial international s'applique, un fournisseur d'un partenaire commercial concerné, évaluée selon le principe de réussite ou d'échec",
              ),
              both(
                "Before contract award; a buyer may request it at offer closing but cannot make it mandatory then, and if it is not submitted at offer closing, must notify the supplier to submit it within two business days of the notification",
                "Avant l'attribution du contrat; l'acheteur peut la demander à la clôture des offres sans pouvoir en faire alors une exigence obligatoire et, si elle n'est pas soumise à la clôture, doit indiquer au fournisseur de le faire dans les deux jours ouvrables suivant l'avis",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "trade",
      title: both("With the Trade Agreements", "Avec les accords commerciaux"),
      blocks: [
        p(
          "Under the reciprocal policy, and subject to certain exceptions, a foreign supplier's eligibility depends on whether the procurement is subject to a trade agreement between Canada and the supplier's jurisdiction, and Canadian suppliers remain eligible in all cases, subject to any conditions from other federal policies or programs. The Buyer's Guide has buyers determine which agreements apply in all cases, and continue to comply with all obligations under any applicable trade agreement whether or not the policy applies. Where both apply, the CSCC Policy supersedes the reciprocal policy, as it does the Canadian Content Policy. {trade} covers the agreements and their thresholds.",
          "Selon la politique d'approvisionnement réciproque, et sous réserve de certaines exceptions, l'admissibilité d'un fournisseur étranger dépend de l'assujettissement du marché à un accord commercial conclu entre le Canada et le pays du fournisseur, et les fournisseurs canadiens demeurent admissibles dans tous les cas, sous réserve des conditions d'autres politiques ou programmes fédéraux. Le Guide de l'acheteur demande aux acheteurs de déterminer dans tous les cas quels accords s'appliquent, et de continuer à respecter toutes les obligations découlant de tout accord commercial applicable, que la politique s'applique ou non. Lorsque les deux s'appliquent, la Politique sur la PFCCC prévaut sur la politique d'approvisionnement réciproque, comme sur la Politique sur le contenu canadien. {trade} traite des accords et de leurs seuils.",
          { trade: a(TRADE_PATH, "Trade Agreements and Thresholds on a Federal Tender Notice", "Accords commerciaux et seuils dans un avis d'appel d'offres fédéral") },
        ),
        p(
          "Under amendments to the Canadian International Trade Tribunal Procurement Inquiry Regulations, for complaints filed on or after December 15, 2025, the Tribunal shall not address or examine matters relating to measures in a procurement process that restrict participation to, or favour, Canadian suppliers; require or favour the use of Canadian goods, services, materials or subcontractors; or require bids to provide benefits to Canada or a minimum Canadian value added, or favour bids on those grounds.",
          "Selon les modifications au Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics, pour les plaintes déposées le 15 décembre 2025 ou après cette date, le Tribunal ne peut aborder ou traiter aucune question relative aux mesures d'un processus d'approvisionnement qui limitent la participation à des fournisseurs canadiens ou leur donnent la priorité; qui exigent ou favorisent l'utilisation de biens, services, matériaux ou sous-traitants canadiens; ou qui exigent que les soumissions fournissent des avantages au Canada ou une valeur ajoutée minimale pour le Canada, ou qui donnent la priorité aux soumissions pour ces motifs.",
        ),
      ],
    },
    {
      id: "differences",
      title: both("Where the Official Pages Differ", "Où les pages officielles divergent"),
      blocks: [
        {
          kind: "list",
          items: [
            tx(
              "Attestation timing: the CSCC Policy has the Supplier Eligibility Attestation Form submitted at offer closing. PSPC's compliance framework for that policy, in effect from June 1, 2026 where PSPC is the contracting authority, has the offeror provide it prior to contract award.",
              "Moment de l'attestation : la Politique sur la PFCCC prévoit la remise du formulaire d'attestation relative à l'admissibilité du fournisseur à la clôture. Le cadre de conformité de SPAC pour cette politique, en vigueur depuis le 1er juin 2026 lorsque SPAC est l'autorité contractante, prévoit que l'offrant le fournit avant l'attribution du contrat.",
            ),
            tx(
              "Basis of reciprocity: the interim policy limits access based on the location of suppliers, while PSPC's Buy Canadian page, modified July 6, 2026, says non-defence goods and services must be produced in Canada or in trading partner countries that give reciprocal access through trade agreements. The Framework lists a Policy on Reciprocal Procurement (Based on Commodity Origin) among the instruments that are or will be issued.",
              "Fondement de la réciprocité : la politique provisoire limite l'accès selon l'emplacement des fournisseurs, tandis que la page « Achetez canadien » de SPAC, modifiée le 6 juillet 2026, indique que les biens et les services achetés pour des besoins autres que ceux de la défense doivent provenir du Canada ou de pays partenaires commerciaux qui accordent un accès réciproque par des accords commerciaux. Le Cadre énumère une Politique d'approvisionnement réciproque (en fonction de l'origine des marchandises) parmi les instruments qui sont ou seront publiés.",
            ),
            tx(
              "Produced in Canada: the CM Policy's English page says primary manufacturing and fabrication in Canada; its French page says \"une première transformation ou qui est fabriqué\", joining the two with or.",
              "Produit au Canada : la page française de la Politique sur les MC vise un matériau « qui a fait l'objet d'une première transformation ou qui est fabriqué au Canada », les deux étant joints par ou; la page anglaise porte « primary manufacturing and fabrication », joints par and.",
            ),
          ],
        },
        p(
          "None of the pages read prescribes wording for the tender notice itself under the CM or CSCC policies.",
          "Aucune des pages lues ne prescrit de libellé pour l'avis d'appel d'offres lui-même selon les politiques sur les MC ou sur la PFCCC.",
        ),
      ],
    },
  ],
  sources: [
    SRC.buyCanadianNotice, SRC.buyCanadianPage, SRC.bcFramework, SRC.bcMaterials, SRC.bcSuppliers, SRC.bcCompliance, SRC.bcReciprocal,
    SRC.bcReciprocalSteps, SRC.bcQuestions, SRC.pspcBuyCanadian, SRC.smallBusinessNotice, SRC.reciprocityNotice, SRC.dictionary,
    SRC.exampleBuyCanadian,
  ],
};

const SBPP: Guide = {
  slug: SBPP_PATH.slice("/guides/".length),
  title: both(
    "The Small Business Procurement Program on Federal Contracts",
    "Le Programme d'approvisionnement auprès des petites entreprises dans les marchés fédéraux",
  ),
  seoTitle: both("Small Business Procurement Program on Federal Contracts", "Programme d'approvisionnement auprès des petites entreprises"),
  summary: both(
    "The Small Business Procurement Program: its launch and phases, what Notice 2026-4 reminds departments of, the definition, set-asides and the records.",
    "Le Programme d'approvisionnement auprès des petites entreprises : lancement, étapes, rappels de l'avis 2026-4, définition, marchés réservés, dossiers.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To follow new federal tender notices as they are posted, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux à mesure qu'ils sont publiés, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "program",
      title: both("What the Program Is", "Ce qu'est le programme"),
      blocks: [
        p(
          "The Treasury Board of Canada Secretariat's Contracting Policy Notice 2026-4, dated July 31, 2026, says that on July 6, 2026, Public Services and Procurement Canada (PSPC), as the exclusive authority for procurement for the Government of Canada, launched the Small Business Procurement Program (SBPP) to increase the participation of small businesses in federal procurement and to make it easier for them to do business with the Government of Canada. The notice reinforces existing requirements under the Directive on the Management of Procurement that support improved access to federal procurement for small businesses.",
          "L'Avis sur la Politique des marchés 2026-4 du Secrétariat du Conseil du Trésor du Canada, daté du 31 juillet 2026, indique que le 6 juillet 2026, Services publics et Approvisionnement Canada (SPAC), à titre de ministère ayant la compétence exclusive pour l'approvisionnement du gouvernement du Canada, a lancé le Programme d'approvisionnement auprès des petites entreprises (PAPE) afin d'accroître la participation des petites entreprises aux marchés publics fédéraux et de faciliter leurs relations d'affaires avec le gouvernement du Canada. L'avis réitère les exigences existantes de la Directive sur la gestion de l'approvisionnement qui visent à améliorer l'accès des petites entreprises aux marchés publics fédéraux.",
        ),
        p(
          "Under the notice, the program includes a phased set of measures to improve the supplier experience and reduce barriers to participation, among them requiring that procurements be designed with small businesses in mind and expanding the use of standardized solicitation and contract templates across departments. When procuring under a delegated authority from the minister responsible for PSPC, departments are responsible for incorporating PSPC's prescribed direction, systems, policies, tools, templates, procedures and guidance. Organizations that are not contracting pursuant to PSPC delegated authorities are encouraged to apply the same measures.",
          "Selon l'avis, le programme comprend une série de mesures en plusieurs étapes visant à offrir une meilleure expérience aux fournisseurs et à réduire les obstacles à leur participation, notamment en exigeant que les projets de marchés soient conçus en tenant compte des petites entreprises et en élargissant l'utilisation de gabarits uniformisés pour les demandes de soumissions et les contrats à l'ensemble des ministères. Lors de l'approvisionnement en vertu d'une délégation de pouvoir du ministre responsable de SPAC, les ministères sont tenus d'intégrer les directives, systèmes, politiques, outils, modèles, procédures et lignes directrices prescrits par SPAC. Les organisations qui ne passent pas de marchés en vertu d'une délégation de pouvoir de SPAC sont encouragées à appliquer les mêmes mesures.",
        ),
        p(
          "PSPC's Buy Canadian page says the program is built on four key pillars: improving the ability of small businesses to compete for federal contracts; modernizing digital tools to make it easier to find and access opportunities; reducing administrative barriers through simpler processes and requirements for small businesses; and recognizing suppliers.",
          "La page « Achetez canadien » de SPAC indique que le programme repose sur quatre axes principaux : améliorer la capacité des petites entreprises à faire concurrence pour obtenir des contrats fédéraux; moderniser les outils numériques afin de faciliter la recherche et l'accès aux opportunités; réduire les obstacles administratifs en simplifiant les processus et les exigences pour les petites entreprises; et reconnaître les fournisseurs.",
        ),
      ],
    },
    {
      id: "phases",
      title: both("The Two Phases of Measures", "Les deux étapes de mesures"),
      blocks: [
        p(
          "PSPC's backgrounder of July 6, 2026, sets out the program's measures in two phases:",
          "Le document d'information de SPAC du 6 juillet 2026 présente les mesures du programme en deux étapes :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Phase", "Étape") },
            { kind: "label", label: both("When", "Quand") },
            { kind: "main", label: both("Measures", "Mesures") },
          ],
          rows: [
            [
              both("Phase 1", "Étape 1"),
              both("Beginning in summer 2026", "À compter de l'été 2026"),
              both(
                "Federal buyers will be required to design procurements with small businesses in mind, which the backgrounder says will ensure requirements are proportionate to the opportunity; improvements to the Procura chatbot; expanding the use of standardized solicitation and contract templates across departments",
                "Les acheteurs fédéraux devront planifier leurs projets de marchés en tenant compte des petites entreprises, ce qui, selon le document, fera en sorte que les exigences soient adaptées à la portée du marché; des améliorations au robot conversationnel Procura; l'utilisation élargie de gabarits uniformisés pour les demandes de soumissions et les contrats à l'ensemble des ministères",
              ),
            ],
            [
              both("Phase 2", "Étape 2"),
              both("By the end of 2026", "D'ici la fin de 2026"),
              both(
                "Plain language tender summaries; a \"Tell Us Once\" approach, under which suppliers will be able to submit common attestations and documents once and reuse them across bids; structured response formats; pre-submission completeness checks; a supplier recognition program, which will recognize trusted Canadian small businesses",
                "Des résumés des appels d'offres en langage clair; l'application du principe « Une fois suffit », qui permettra aux fournisseurs de soumettre une seule fois les attestations et les documents couramment exigés, puis de les réutiliser pour d'autres appels d'offres; des gabarits de soumission structurés; des vérifications préalables de l'exhaustivité des soumissions; un programme de reconnaissance des fournisseurs, qui permettra de reconnaître les petites entreprises canadiennes de confiance",
              ),
            ],
          ],
        },
        p(
          "The backgrounder gives these as measures that will be introduced. PSPC's news release of the same day reports that day's launch of the enhanced Procura chatbot; none of the pages read reports that any other measure has been introduced.",
          "Le document présente ces mesures comme devant être mises en place. Le communiqué de SPAC du même jour annonce le lancement, ce jour-là, de la version améliorée du robot conversationnel Procura; aucune des pages lues n'indique qu'une autre mesure a été mise en place.",
        ),
      ],
    },
    {
      id: "departments",
      title: both("What the Notice Reminds Departments Of", "Ce que l'avis rappelle aux ministères"),
      blocks: [
        p(
          "Notice 2026-4 reminds departments of existing requirements of the directive that support improved procurement opportunities for small businesses, and says contracting authorities should work with business owners to reflect these considerations throughout the procurement process:",
          "L'avis 2026-4 rappelle aux ministères les exigences existantes de la directive qui visent à améliorer les occasions de marchés pour les petites entreprises, et indique que les autorités contractantes devraient collaborer avec les propriétaires fonctionnels pour prendre ces considérations en compte tout au long du processus d'approvisionnement :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "text", label: both("Consideration", "Considération") },
            { kind: "main", label: both("What the notice says", "Ce que dit l'avis") },
          ],
          rows: [
            [
              both("Clear, proportionate and simplified requirements", "Exigences claires, proportionnelles et simplifiées"),
              both(
                "Business owners must clearly define the operational requirements and end-user needs of a procurement. Requirements, specifications, mandatory criteria, bid instructions and administrative conditions should not be more complex, restrictive or burdensome than is necessary to meet the operational need or manage risk. Requirements should also be framed to support the government's strategic direction, which includes defining them in a way that does not unnecessarily exclude capable Canadian small businesses. Whenever possible, solicitation documents should be simplified. These considerations should be informed by market analysis conducted to understand industry capacity and availability.",
                "Les propriétaires fonctionnels doivent définir clairement les exigences opérationnelles et les besoins des utilisateurs finaux associés à un marché. Les exigences, les spécifications, les critères obligatoires, les instructions pour la soumission et les conditions administratives ne devraient pas être plus complexes, ni restrictifs, ni contraignants que nécessaire pour répondre au besoin opérationnel ou gérer le risque. Les exigences devraient aussi être formulées de manière à appuyer l'orientation stratégique du gouvernement, ce qui comprend de les définir d'une manière qui n'exclut pas inutilement les petites entreprises canadiennes compétentes. Dans la mesure du possible, les documents d'appels d'offres devraient être simplifiés. Ces considérations devraient s'appuyer sur des analyses du marché effectuées dans le but de mieux comprendre la capacité et la disponibilité de l'industrie.",
              ),
            ],
            [
              both("Legitimate unbundling of requirements", "Dégroupement légitime des exigences"),
              both(
                "Departments must consider whether a requirement can be legitimately divided into smaller requirements when doing so would better align the procurement strategy to the operational need and allow more suppliers to participate; for example, this could include allowing bids on lots or regional components where bundling would unnecessarily restrict competition or put smaller firms at a disadvantage. Contracting authorities must document their decisions and ensure that any division of requirements is not used to bypass financial approval thresholds or other obligations.",
                "Les ministères doivent déterminer si des exigences peuvent être légitimement divisées en exigences plus petites lorsqu'une telle approche permet de mieux harmoniser la stratégie d'approvisionnement avec le besoin opérationnel et de favoriser la participation d'un plus grand nombre de fournisseurs; par exemple, il peut s'agir d'autoriser la présentation de soumissions pour des lots ou des composantes régionales lorsque le regroupement limiterait inutilement la concurrence ou désavantagerait les petites entreprises. Les autorités contractantes doivent consigner leurs décisions et veiller à ce qu'aucune division des exigences ne soit utilisée pour contourner les seuils d'approbation financière ou d'autres obligations.",
              ),
            ],
            [
              both("Pricing strategies", "Stratégies de prix"),
              both(
                "Contracting authorities must use pricing strategies, including the basis of payment, incentives and performance adjustments, that meet operational requirements and intended results. Departments should assess whether pricing and payment structures create avoidable barriers for small businesses, for example access to capital, cost of borrowing and cash flow, and, where operationally and risk appropriate, should adjust these structures so that smaller firms are not unnecessarily disadvantaged by payment terms or risk allocation, such as by using milestone payments or progress-based payments.",
                "Les autorités contractantes doivent utiliser des stratégies de prix, y compris la base de paiement, les incitatifs et les ajustements en fonction du rendement, qui permettent de respecter les exigences opérationnelles et d'atteindre les résultats escomptés. Les ministères devraient évaluer si les structures de prix et de paiement créent des obstacles évitables pour les petites entreprises, par exemple l'accès au capital, le coût d'emprunt et les flux de trésorerie, et, lorsque cela est approprié sur les plans opérationnel et de la gestion des risques, devraient modifier ces structures afin que les petites entreprises ne soient pas inutilement désavantagées par les modalités de paiement ou la répartition du risque, notamment en recourant à des paiements de jalons ou à des paiements fondés sur l'avancement des travaux.",
              ),
            ],
            [
              both("Supplier collaboration", "Collaboration avec les fournisseurs"),
              both(
                "Departments must make sure that there are opportunities for suppliers to collaborate and develop solutions, including pilots and prototypes, where appropriate.",
                "Les ministères doivent veiller à ce que les fournisseurs aient l'occasion de collaborer et d'élaborer des solutions, y compris des projets pilotes et des prototypes, le cas échéant.",
              ),
            ],
            [
              both("Credible and fair procurement processes", "Processus d'approvisionnement crédibles et équitables"),
              both(
                "Departments must uphold the Values and Ethics Code for the Public Sector, the Directive on Conflict of Interest, and requirements for timely debriefings and fair, prompt dispute resolution throughout the procurement process.",
                "Les ministères doivent se conformer au Code de valeurs et d'éthique du secteur public, à la Directive sur les conflits d'intérêts et aux exigences relatives à l'envoi rapide de comptes rendus et au règlement équitable et rapide des différends tout au long du processus d'approvisionnement.",
              ),
            ],
          ],
        },
        p(
          "Notice 2025-7, dated December 17, 2025, reminds departments that they are required to justify and document all decisions taken with respect to a procurement, including decisions that affect prioritization of Canadian suppliers, goods, services, materials, or small businesses. The {debrief} explains debriefings and complaints.",
          "L'avis 2025-7, daté du 17 décembre 2025, rappelle aux ministères qu'ils doivent justifier et documenter de manière rigoureuse toutes les décisions prises en matière d'approvisionnement, y compris les décisions ayant une incidence sur la priorisation des fournisseurs, biens, services, matériaux et petites entreprises du Canada. Le {debrief} explique les comptes rendus et les plaintes.",
          { debrief: a(DEBRIEF_PATH, "guide on debriefings and bid challenges", "guide sur les comptes rendus et les contestations des offres") },
        ),
      ],
    },
    {
      id: "small-business",
      title: both("Who Counts as a Small Business", "Ce qu'est une petite entreprise"),
      blocks: [
        p(
          "CanadaBuys' questions and answers for suppliers on the Buy Canadian Policy give the government's definition: a small business is a company with 499 employees or fewer, including those of its affiliates, or a joint venture whose total number of employees does not exceed 499. PSPC's backgrounder gives the same definition, for reference. None of the pages read sets out how a business shows that it meets it.",
          "Les questions et réponses d'AchatsCanada pour les fournisseurs sur la Politique « Achetez canadien » donnent la définition du gouvernement : une petite entreprise est une entreprise comptant 499 employés ou moins, incluant ceux de ses affiliés, ou une coentreprise dont le total des employés ne dépasse pas 499. Le document d'information de SPAC donne la même définition, à titre indicatif. Aucune des pages lues n'indique comment une entreprise démontre qu'elle y satisfait.",
        ),
        p(
          "Under the Canadian International Trade Tribunal Procurement Inquiry Regulations, current to October 19, 2026, and despite any provision in respect of procurement of any trade agreement, the Tribunal shall not address or examine matters relating to the way in which the expressions the Regulations list, \"small business\" among them, are defined for the purposes of the procurement process.",
          "Selon le Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics, à jour au 19 octobre 2026, et malgré toute disposition relative aux marchés publics de tout accord commercial, le Tribunal ne peut aborder ou traiter aucune question relative à la manière dont sont définies, pour les besoins de la procédure des marchés publics, les expressions que le Règlement énumère, dont « petites entreprises ».",
        ),
      ],
    },
    {
      id: "set-asides",
      title: both("Set-Asides, Trade Agreements and Other Programs", "Marchés réservés, accords commerciaux et autres programmes"),
      blocks: [
        p(
          "The Buy Canadian Procurement Policy Framework, which applies to the departments and agencies listed in Schedules I, I.1 and II of the Financial Administration Act, lists the program with the policy instruments that are or will be issued under it. It describes the program as reserving federal procurement opportunities for Canadian small businesses, with mandatory set-asides applied where feasible, and as streamlining access through simplified registration, onboarding and contracting processes tailored to small business capacity; its French page puts both in the future tense. Notice 2026-4 and PSPC's news release and backgrounder of July 6, 2026, describe no set-aside, and none of the pages read gives the program a dollar threshold or a numeric target. The {bc} explains the Framework's policies.",
          "Le Cadre stratégique de la politique d'approvisionnement « Achetez canadien », qui s'applique aux ministères et organismes énumérés aux annexes I, I.1 et II de la Loi sur la gestion des finances publiques, range le programme avec les instruments de politique qui sont ou seront publiés en vertu de celui-ci. Il décrit le programme comme réservant des occasions d'approvisionnement fédéral aux petites entreprises canadiennes, avec des marchés réservés obligatoires appliqués dans la mesure du possible, et comme rationalisant l'accès par des processus d'inscription, d'intégration et de passation de marchés simplifiés et adaptés aux capacités des petites entreprises; sa page française met l'un et l'autre au futur. L'avis 2026-4 ainsi que le communiqué et le document d'information de SPAC du 6 juillet 2026 ne décrivent aucun marché réservé, et aucune des pages lues ne fixe au programme de seuil monétaire ni de cible chiffrée. Le {bc} explique les politiques du Cadre.",
          { bc: a(BUY_CANADIAN_PATH, "guide on the Buy Canadian Policy", "guide sur la Politique « Achetez canadien »") },
        ),
        p(
          "Set-asides are among the factors PSPC's Buyer's Guide says a buyer must consider in determining whether a procurement falls under a trade agreement ({trade}). The buyer should decide if any set-asides, such as the set-aside for minority businesses, will be applied to the procurement, and may apply them to all of it or only part, which means that all or some aspects may not be subject to certain trade agreement obligations; buyers may refer to Canada's market access schedule for Canada's set-asides.",
          "Les marchés réservés figurent parmi les éléments dont l'acheteur doit tenir compte, selon le Guide de l'acheteur de SPAC, pour déterminer si un approvisionnement relève d'un accord commercial ({trade}). L'acheteur devrait décider si des marchés réservés, comme les marchés réservés aux entreprises minoritaires, seront appliqués à l'approvisionnement, et peut les appliquer à l'ensemble de l'approvisionnement ou seulement à une partie, ce qui signifie que tous les aspects ou certains d'entre eux peuvent ne pas être assujettis à certaines obligations découlant des accords commerciaux; l'acheteur peut consulter la liste d'engagements en matière d'accès aux marchés publics du Canada pour les marchés réservés du Canada.",
          { trade: a(TRADE_PATH, "guide on trade agreements", "guide sur les accords commerciaux") },
        ),
        p(
          "Despite any provision in respect of procurement of CETA or the Canada-UK Trade Continuity Agreement, the Tribunal's Regulations say it shall not address or examine matters relating to any measure in the procurement process that restricts participation to small businesses.",
          "Malgré toute disposition relative aux marchés publics de l'AECG ou de l'Accord de continuité commerciale Canada-Royaume-Uni, le Règlement du Tribunal prévoit que celui-ci ne peut aborder ou traiter aucune question relative à toute mesure dans la procédure des marchés publics qui restreint la participation à cette procédure aux petites entreprises.",
        ),
        p(
          "None of the pages read says how the program's measures sit beside set-asides under the Procurement Strategy for Indigenous Business, which the {psib} explains.",
          "Aucune des pages lues n'indique comment les mesures du programme s'articulent avec les marchés réservés de la Stratégie d'approvisionnement auprès des entreprises autochtones, qu'explique le {psib}.",
          { psib: a(PSIB_PATH, "guide on Indigenous business set-asides", "guide sur les marchés réservés aux entreprises autochtones") },
        ),
      ],
    },
    {
      id: "records",
      title: both("What the Records Show", "Ce que montrent les dossiers"),
      blocks: [
        p(
          "CanadaBuys' data dictionary, in its file last modified on March 24, 2026, has no field that marks a procurement under the program, a set-aside or a small business. It defines the trade agreements field as a list of any international trade agreements that apply to the procurement action, if applicable. An award notice also gives the contract's value and its category, and Notice 2025-8 gives the agreements' thresholds separately for goods, services and construction.",
          "Le dictionnaire de données d'AchatsCanada, dans son fichier modifié pour la dernière fois le 24 mars 2026, ne comporte aucun champ qui indique un approvisionnement relevant du programme, un marché réservé ou une petite entreprise. Il définit le champ des accords commerciaux comme une liste de tous les accords commerciaux internationaux qui s'appliquent à l'action d'approvisionnement, le cas échéant. Un avis d'attribution donne aussi la valeur du contrat et sa catégorie, et l'avis 2025-8 fixe les seuils des accords séparément pour les biens, les services et la construction.",
        ),
        p(
          "This {example} from PSPC for the Department of Natural Resources, awarded November 13, 2026, shows Goods as its category, a value of $790,605 and twelve agreements in its trade agreements line, CETA and the Canada-UK Trade Continuity Agreement among them.",
          "Cet {example} de SPAC pour le ministère des Ressources naturelles, attribué le 13 novembre 2026, indique la catégorie Biens, une valeur de 790 605 $ et douze accords dans sa ligne des accords commerciaux, dont l'AECG et l'Accord de continuité commerciale Canada-Royaume-Uni.",
          { example: a(EXAMPLE_SBPP, "award notice", "avis d'attribution") },
        ),
        p(
          "Of CanadaBuys' tender notice, award notice and contract history files, the dictionary lists the supplier's employees for the contract history alone: it describes the field as a description of the number of individuals employed by the supplier, blank or one of the descriptions it lists. Award Watch shows it on a contract history record's page under Supplier's employees, as PSPC gives it: a count, or a size band in older records.",
          "Des fichiers des avis d'appel d'offres, des avis d'attribution et des contrats octroyés d'AchatsCanada, le dictionnaire n'inscrit les employés du fournisseur que pour l'historique des contrats : il décrit ce champ comme une description du nombre de personnes employées par le fournisseur, vide ou l'une des descriptions qu'il énumère. Award Watch l'affiche sur la page d'un dossier de l'historique des contrats sous Employés du fournisseur, tel que SPAC le donne : un nombre, ou une tranche dans les dossiers plus anciens.",
        ),
        figure(
          "sbpp-employees", SAMPLE_HISTORY_EMPLOYEES, ".panel-stack > section.panel:first-child",
          both(
            "The Supplier and Buyer panel of a PSPC contract history record's page on Award Watch: the supplier, its location, the supplier's employees, PSPC as the contracting entity, the client department and the note on the employees field.",
            "Le panneau Fournisseur et acheteur de la page d'un dossier de l'historique des contrats de SPAC sur Award Watch : le fournisseur, son lieu, les employés du fournisseur, SPAC comme entité contractante, le ministère client et la note sur le champ des employés.",
          ),
          both("A PSPC contract history record's supplier panel on Award Watch.", "Le panneau du fournisseur d'un dossier de l'historique des contrats de SPAC sur Award Watch."),
          [
            mark(field(":scope > dl", 1),
              "CanadaBuys' data dictionary has no field that marks a procurement under the program, a set-aside or a small business.",
              "Le dictionnaire de données d'AchatsCanada ne comporte aucun champ qui indique un approvisionnement relevant du programme, un marché réservé ou une petite entreprise."),
            mark(field(":scope > dl", 3),
              "Only the contract history carries the supplier's employees, shown as its file gives them: a count, or a size band in older records.",
              "Seul l'historique des contrats porte les employés du fournisseur, affichés tels que son fichier les donne : un nombre, ou une tranche dans les dossiers plus anciens."),
            mark(":scope > dl + p",
              "The dictionary calls the field a description of the number of individuals employed by the supplier.",
              "Le dictionnaire présente ce champ comme une description du nombre de personnes employées par le fournisseur."),
          ],
        ),
      ],
    },
  ],
  sources: [
    SRC.smallBusinessNotice, SRC.sbppNews, SRC.sbppBackgrounder, SRC.pspcBuyCanadian, SRC.bcQuestions, SRC.bcFramework, SRC.procurementDirective,
    SRC.buyCanadianNotice, SRC.tradeApplicability, SRC.cittRegulations, SRC.thresholds, SRC.dictionary, SRC.exampleSbpp,
  ],
};

const EVALUATION: Guide = {
  slug: EVALUATION_PATH.slice("/guides/".length),
  title: both("How a Federal Bid Is Evaluated and the Basis of Selection", "L'évaluation d'une soumission fédérale et la méthode de sélection"),
  seoTitle: both("How Federal Bids Are Evaluated and Selected", "Évaluation des soumissions fédérales et méthode de sélection"),
  summary: both(
    "How a federal bid is evaluated: mandatory and point-rated criteria, the financial evaluation, the bases of selection and the field a tender notice shows.",
    "Comment une soumission fédérale est évaluée : critères obligatoires et cotés, évaluation financière, méthodes de sélection et champ de l'avis.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To keep track of new federal tender notices, requests for proposal among them, save this list with your email address.",
    "Pour suivre les nouveaux avis d'appel d'offres fédéraux, dont les demandes de propositions, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "solicitation",
      title: both("What the Solicitation States", "Ce qu'énonce la demande de soumissions"),
      blocks: [
        p(
          "CanadaBuys says bids are normally evaluated on relevant technical merit and overall best value, in line with the selection method specified in a tender notice, with financial information assessed separately from the technical information. The technical evaluation may use mandatory technical criteria only, point-rated technical criteria only, or a combination of both.",
          "AchatsCanada indique que les soumissions sont normalement évaluées en fonction de leur mérite technique pertinent et du meilleur rapport qualité-prix global, conformément à la méthode de sélection spécifiée dans un avis d'appel d'offres, les informations financières étant évaluées séparément des informations techniques. L'évaluation technique peut reposer sur des critères techniques obligatoires uniquement, sur des critères techniques cotés seulement ou sur une combinaison des deux.",
        ),
        p(
          "The Buyer's Guide of Public Services and Procurement Canada (PSPC) requires the evaluation process and the method of selection to be clearly described in the solicitation documents, and all evaluation criteria to be specified there with their relative weighting and importance. It cites a Canadian International Trade Tribunal (CITT) ruling on the importance of communicating the method of selection, and requires it to be stated even where awarding to the lowest responsive offeror is a recognized practice. Evaluations should not be influenced by criteria or factors not specified in the solicitation.",
          "Le Guide de l'acheteur de Services publics et Approvisionnement Canada (SPAC) exige que le processus d'évaluation et la méthode de sélection soient clairement décrits dans les documents de la demande, et que tous les critères d'évaluation y soient précisés avec leur pondération et leur importance relatives. Il cite une décision du Tribunal canadien du commerce extérieur (TCCE) sur l'importance de communiquer la méthode de sélection, et exige qu'elle soit indiquée même si l'attribution du contrat à l'offrant recevable le plus bas est une pratique reconnue. Les évaluateurs ne devraient pas appliquer de critères ou de facteurs ne figurant pas dans la demande d'offres.",
        ),
        p(
          "PSPC's seminar notes describe a request for proposal as a call for bids that describes the evaluation criteria that will be used to choose the winning bid; {bid} sets out the steps from registration to the award.",
          "Les notes de séminaire de SPAC décrivent une demande de propositions comme un appel d'offres qui décrit les critères d'évaluation qui s'appliquent au choix de la soumission retenue; {bid} présente les étapes, de l'inscription à l'attribution.",
          { bid: a(BID_PATH, "How to Bid on Government of Canada Contracts", "Soumissionner sur les marchés du gouvernement du Canada") },
        ),
      ],
    },
    {
      id: "mandatory",
      title: both("Mandatory Criteria", "Critères obligatoires"),
      blocks: [
        p(
          "Mandatory evaluation criteria identify the minimum requirements that are essential to the successful completion of the work, and may include licensing requirements, minimum performance characteristics of equipment, delivery dates or conditions, essential minimum qualifications or experience of proposed personnel, and budget limitations. None can be waived once the solicitation has closed. The Treasury Board's Directive on the Management of Procurement has contracting authorities limit the number of mandatory technical criteria to those determined to be essential requirements, so that no bid is unnecessarily disqualified.",
          "Les critères d'évaluation obligatoires précisent les exigences minimales essentielles à l'exécution efficace des travaux, et peuvent comprendre les permis et licences nécessaires, les caractéristiques de rendement minimal de l'équipement, les dates et les conditions de livraison, l'expérience ou les compétences essentielles minimales du personnel proposé et les limites budgétaires. Aucun ne peut être supprimé une fois la demande de soumissions terminée. La Directive sur la gestion de l'approvisionnement du Conseil du Trésor charge les autorités contractantes de limiter le nombre de critères techniques obligatoires à ceux jugés être des exigences essentielles, pour qu'aucune soumission ne soit rejetée inutilement.",
        ),
        p(
          "Under the Buyer's Guide, the client is responsible for the technical evaluation, and the buyer for the financial one. Mandatory criteria are assessed on a simple pass or fail basis; an offer that fails any mandatory requirement or mandatory evaluation criterion, whether technical, financial or other, is declared non-responsive.",
          "Selon le Guide de l'acheteur, le client est responsable de l'évaluation technique, et l'acheteur de l'évaluation financière. Les critères obligatoires sont évalués selon une méthode simple, réussite ou échec; une offre qui ne respecte pas une exigence obligatoire ou un critère d'évaluation obligatoire, qu'il soit technique, financier ou autre, est déclarée irrecevable.",
        ),
      ],
    },
    {
      id: "rated",
      title: both("Point-Rated Criteria", "Critères cotés"),
      blocks: [
        p(
          "Only offers meeting all mandatory criteria are subject to point rating. Rated criteria assess elements of the technical offer so that the relative merits of each offer can distinguish one offer from another. The solicitation must give each rated criterion's maximum points and any minimum thresholds, and offers must often meet a minimum overall point threshold and receive minimum points for specific criteria to be considered responsive. In weighting, a high aggregate of points for minor criteria should not overcompensate for a low aggregate for major ones.",
          "Seules les offres qui satisfont à tous les critères obligatoires sont cotées par points. Les critères cotés servent à évaluer divers éléments de l'offre technique pour faire ressortir le mérite relatif de chaque offre par rapport aux autres. La demande doit préciser le nombre maximal de points de chaque critère coté et les seuils minimaux éventuels, et les offres doivent souvent atteindre un seuil minimum global de points et recevoir un minimum de points pour des critères précis pour être considérées comme recevables. En pondérant les critères, un nombre global élevé de points pour des critères mineurs ne devrait pas masquer un faible total pour des critères majeurs.",
        ),
        p(
          "The Buyer's Guide notes that the CITT can re-weigh points if an offer is denied and there is clear evidence the evaluation was not conducted in a fair manner, and will intervene if it feels the evaluators improperly applied the evaluation criteria and methodology set out in the solicitation. A complaint to the CITT requires a procurement covered by at least one trade agreement; the {trade} explains a notice's trade agreements line.",
          "Le Guide de l'acheteur précise que le TCCE peut procéder à une réévaluation des points si l'offre est rejetée et que des éléments de preuve démontrent clairement que l'évaluation n'a pas été effectuée de manière équitable, et qu'il interviendra s'il estime que les évaluateurs ont mal appliqué les critères et la méthodologie d'évaluation établis dans la demande. Une plainte au TCCE exige un approvisionnement visé par au moins un accord commercial; le {trade} explique la ligne des accords commerciaux d'un avis.",
          { trade: a(TRADE_PATH, "guide on trade agreements", "guide sur les accords commerciaux") },
        ),
      ],
    },
    {
      id: "financial",
      title: both("The Financial Evaluation", "L'évaluation financière"),
      blocks: [
        p(
          "The buyer conducts the financial evaluation after the technical one, and pricing information must not be provided to the client until the technical evaluation is complete. This stage tries to identify the offer that presents the best value, considering the price and the technical merits evaluated in the previous step. The buyer must evaluate offers exclusive of the GST or HST, as applicable.",
          "L'acheteur procède à l'évaluation financière après l'évaluation technique, et les informations relatives aux prix ne doivent être communiquées au client qu'une fois l'évaluation technique terminée. Cette étape vise à déterminer l'offre qui présente le meilleur rapport qualité-prix, selon le prix et les mérites techniques évalués à l'étape précédente. L'acheteur doit évaluer les offres sans tenir compte de la TPS ou de la TVH, selon le cas.",
        ),
        p(
          "If identical low offers are received, the contract should be awarded on the basis of best value, using factors such as performance record and after-sales service; if none applies, a tie-breaking method mutually acceptable to Canada and the offerors can be used, such as a coin toss.",
          "Si des offres basses identiques sont reçues, le contrat devrait être attribué selon le meilleur rapport qualité-prix, d'après des critères comme les performances antérieures et le service après-vente; si aucun ne s'applique, une méthode de bris d'égalité convenue entre le Canada et les offrants peut être appliquée, comme tirer à pile ou face.",
        ),
      ],
    },
    {
      id: "basis",
      title: both("The Basis of Selection", "La méthode de sélection"),
      blocks: [
        p(
          "The buyer must include the appropriate basis of selection clauses in the solicitation documents; the Buyer's Guide's common examples include the highest combined rating of technical merit and price, the lowest evaluated price with mandatory technical criteria, and the highest rated within budget. PSPC's Standard Acquisition Clauses and Conditions (SACC) Manual, no longer maintained as of June 2023 and available on CanadaBuys for reference, has a clause for each basis below; contracts issued with its clauses remain valid.",
          "L'acheteur doit inclure les clauses appropriées de la méthode de sélection dans les documents de la demande; les exemples courants du Guide de l'acheteur comprennent la méthode du meilleur ratio combiné mérite technique-prix, le prix évalué le plus bas comportant les critères techniques obligatoires et la proposition la mieux cotée en fonction du budget. Le Guide des clauses et conditions uniformisées d'achat (CCUA) de SPAC, qui n'est plus maintenu depuis juin 2023 et reste accessible dans AchatsCanada à titre de référence, contient une clause pour chaque méthode ci-dessous; les contrats comportant ses clauses demeurent valides.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Clause", "Clause") },
            { kind: "text", label: both("Title", "Titre") },
            { kind: "main", label: both("What the clause provides", "Ce que prévoit la clause") },
          ],
          rows: [
            [
              both("A0069T", "A0069T"),
              both("Basis of Selection", "Méthode de sélection"),
              both(
                "For a bid solicitation with no technical evaluation criteria, a bid that complies with all its requirements is responsive, and the responsive bid with the lowest evaluated price is recommended for award",
                "Pour une demande de soumissions sans critère d'évaluation technique, une soumission qui en respecte toutes les exigences est recevable, et la soumission recevable avec le prix évalué le plus bas est recommandée pour l'attribution du contrat",
              ),
            ],
            [
              both("A0031T", "A0031T"),
              both("Basis of Selection, Mandatory Technical Criteria", "Méthode de sélection, critères techniques obligatoires"),
              both(
                "A bid must also meet all mandatory technical evaluation criteria to be responsive; the responsive bid with the lowest evaluated price is recommended for award",
                "Une soumission doit aussi satisfaire à tous les critères d'évaluation techniques obligatoires pour être recevable; la soumission recevable avec le prix évalué le plus bas est recommandée pour l'attribution du contrat",
              ),
            ],
            [
              both("A0034T", "A0034T"),
              both("Basis of Selection, Minimum Point Rating", "Méthode de sélection, cotation numérique minimale"),
              both(
                "With mandatory and point-rated technical criteria, a responsive bid also obtains the required minimum points; the responsive bid with the lowest evaluated price is recommended for award",
                "Avec des critères techniques obligatoires et cotés, une soumission recevable obtient aussi la cotation minimale exigée; la soumission recevable ayant le prix évalué le plus bas est recommandée pour l'attribution du contrat",
              ),
            ],
            [
              both("A0035T", "A0035T"),
              both("Basis of Selection, Lowest Price Per Point", "Méthode de sélection, le prix le plus bas par point"),
              both(
                "With the same criteria and minimum points, the responsive bid with the lowest evaluated price per point is recommended for award; neither the responsive bid with the most points nor the one with the lowest price will necessarily be accepted",
                "Avec les mêmes critères et la cotation minimale, la soumission recevable ayant le prix évalué le plus bas par point est recommandée pour l'attribution du contrat; ni la soumission recevable ayant obtenu le plus de points ni celle ayant le prix le plus bas ne sera nécessairement acceptée",
              ),
            ],
            [
              both("A0036T", "A0036T"),
              both("Basis of Selection, Highest Rated Within Budget", "Méthode de sélection, cotation numérique la plus élevée dans les limites du budget"),
              both(
                "With the same criteria and minimum points, the responsive bid with the highest number of points is recommended, provided its total evaluated price does not exceed the budget available; the clause is used with one that indicates to bidders the maximum funding available",
                "Avec les mêmes critères et la cotation minimale, la soumission recevable ayant obtenu le plus grand nombre de points est recommandée, pourvu que le prix total évalué n'excède pas le budget disponible; la clause s'emploie avec une autre qui indique aux soumissionnaires le budget maximal disponible",
              ),
            ],
            [
              both("A0027T", "A0027T"),
              both(
                "Basis of Selection, Highest Combined Rating of Technical Merit and Price",
                "Méthode de sélection, note combinée la plus haute sur le plan du mérite technique et du prix",
              ),
              both(
                "With mandatory and point-rated technical criteria and minimum points, the contracting officer inserts the percentages for technical merit and for price, and the responsive bid with the highest combined rating is recommended for award",
                "Avec des critères techniques obligatoires et cotés et une cotation minimale, l'agent de négociation des contrats inscrit les pourcentages accordés au mérite technique et au prix, et la soumission recevable ayant la note combinée la plus élevée est recommandée pour l'attribution du contrat",
              ),
            ],
          ],
        },
        p(
          "CanadaBuys describes best overall value as often based on the lowest evaluated price per point, determined by dividing the bid price by the total points achieved in the technical evaluation; other approaches may be set out in the tender notice.",
          "AchatsCanada décrit le meilleur rapport qualité-prix comme souvent fondé sur le prix évalué par point le plus bas, établi en divisant le prix de la soumission par le total des points obtenus lors de l'évaluation technique; d'autres approches peuvent être précisées dans l'avis d'appel d'offres.",
        ),
      ],
    },
    {
      id: "example",
      title: both("A Combined Rating, Worked Through", "Une note combinée, pas à pas"),
      blocks: [
        p(
          "Clause A0027T and PSPC's seminar notes give the same example, with three responsive bids, a 60/40 ratio of technical merit and price, 135 points available and a lowest evaluated price of $45,000. In the example, the technical merit score is the points obtained over the points available, multiplied by 60, and the pricing score is the lowest evaluated price over the bid's evaluated price, multiplied by 40; the two are added.",
          "La clause A0027T et les notes de séminaire de SPAC donnent le même exemple, avec trois soumissions recevables, un ratio de 60/40 entre le mérite technique et le prix, 135 points possibles et un prix évalué le plus bas de 45 000 $. Dans l'exemple, la note pour le mérite technique est le nombre de points obtenus divisé par le nombre de points possibles, multiplié par 60, et la note pour le prix est le prix évalué le plus bas divisé par le prix évalué de la soumission, multiplié par 40; les deux notes s'additionnent.",
        ),
        {
          kind: "table",
          cols: [
            { kind: "main", label: both("Item", "Élément") },
            { kind: "label", label: both("Bidder 1", "Soumissionnaire 1") },
            { kind: "label", label: both("Bidder 2", "Soumissionnaire 2") },
            { kind: "label", label: both("Bidder 3", "Soumissionnaire 3") },
          ],
          rows: [
            [both("Overall technical score", "Note technique globale"), both("115/135", "115/135"), both("89/135", "89/135"), both("92/135", "92/135")],
            [both("Bid evaluated price", "Prix évalué de la soumission"), { money: 55_000 }, { money: 50_000 }, { money: 45_000 }],
            [
              both("Technical merit score", "Note pour le mérite technique"),
              both("115/135 x 60 = 51.11", "115/135 x 60 = 51,11"), both("89/135 x 60 = 39.56", "89/135 x 60 = 39,56"), both("92/135 x 60 = 40.89", "92/135 x 60 = 40,89"),
            ],
            [
              both("Pricing score", "Note pour le prix"),
              both("45/55 x 40 = 32.73", "45/55 x 40 = 32,73"), both("45/50 x 40 = 36.00", "45/50 x 40 = 36,00"), both("45/45 x 40 = 40.00", "45/45 x 40 = 40,00"),
            ],
            [both("Combined rating", "Note combinée"), both("83.84", "83,84"), both("75.56", "75,56"), both("80.89", "80,89")],
            [both("Overall rating", "Évaluation globale"), both("1st", "1er"), both("3rd", "3e"), both("2nd", "2e")],
          ],
        },
        p(
          "Bidder 3 has the lowest evaluated price; Bidder 1 has the highest combined rating and is the one the clause recommends for award.",
          "Le soumissionnaire 3 a le prix évalué le plus bas; le soumissionnaire 1 a la note combinée la plus élevée et c'est celui que la clause recommande pour l'attribution du contrat.",
        ),
      ],
    },
    {
      id: "records",
      title: both("What the Notice and the Award Notice Show", "Ce que montrent l'avis et l'avis d'attribution"),
      blocks: [
        p(
          "CanadaBuys' data dictionary has a selection criteria field, the method used to assess the bids and award a winner, in its tender notice, award notice and contract history files, and lists its possible values:",
          "Le dictionnaire de données d'AchatsCanada comporte un champ des critères de sélection, la méthode utilisée pour évaluer les offres et attribuer un gagnant, dans ses fichiers des avis d'appel d'offres, des avis d'attribution et des contrats octroyés, et en énumère les valeurs possibles :",
        ),
        {
          kind: "table",
          cols: [{ kind: "main", label: both("Value of the field", "Valeur du champ") }],
          rows: [
            [both("Lowest Price", "Prix le plus bas")],
            [both("Lowest Cost-per-Point", "Coût par point le plus bas")],
            [both("Highest Combined Rating of Technical Merit and Price", "Cote combinée la plus élevée pour le mérite technique et le prix")],
            [both("Highest Technical Merit within a Stipulated Maximum Budget", "Mérite technique le plus élevé dans les limites du budget maximal stipulé")],
            [both("Government Objectives Representing Best Interests/Value to Govt", "Objectifs gouvern. représentant les meilleurs intérets/valeur pour l'État")],
            [both("Rotational Sourcing", "Rotation des fournisseurs")],
            [both("Subsequent/Follow-on Contracts", "Marchés subséquents")],
            [both("Variations or combinations of the above methods", "Variations ou combinaisons des méthodes susmentionnées")],
            [both("Not applicable", "Sans objet")],
          ],
        },
        p(
          "Award Watch shows the field under Selection criteria on tender notice and award notice pages. The buyer must specify the criteria themselves in the solicitation document. PSPC uses SAP Ariba to post tender notices on behalf of other departments; departments posting on their own post directly to CanadaBuys, where the notice's Bidding details tab holds the downloadable solicitation documents.",
          "Award Watch l'affiche sous Critères de sélection sur les pages des avis d'appel d'offres et des avis d'attribution. L'acheteur doit préciser les critères eux-mêmes dans les documents de la demande. SPAC utilise SAP Ariba pour publier des avis d'appel d'offres au nom d'autres ministères; les ministères qui publient sans passer par SPAC le font directement dans AchatsCanada, où l'onglet Détails de l'offre de l'avis contient les documents d'appel d'offres téléchargeables.",
        ),
        figure(
          "evaluation-selection", SAMPLE_NOTICE, "section.panel:has(> dl.wide)",
          both(
            "The Procurement panel of a tender notice's page on Award Watch: category, notice type, procurement method, selection criteria, trade agreements, regions and provinces.",
            "Le panneau Approvisionnement de la page d'un avis d'appel d'offres sur Award Watch : catégorie, type d'avis, méthode d'approvisionnement, critères de sélection, accords commerciaux, régions et provinces.",
          ),
          both("A tender notice's selection criteria on Award Watch.", "Les critères de sélection d'un avis d'appel d'offres sur Award Watch."),
          [
            mark(field("dl.wide", 2),
              "PSPC's seminar notes describe a request for proposal as a call for bids that describes the evaluation criteria that will be used to choose the winning bid.",
              "Les notes de séminaire de SPAC décrivent une demande de propositions comme un appel d'offres qui décrit les critères d'évaluation qui s'appliquent au choix de la soumission retenue."),
            mark(field("dl.wide", 4), "The selection criteria field holds the method used to assess the bids and award a winner.",
              "Le champ des critères de sélection donne la méthode utilisée pour évaluer les offres et attribuer un gagnant."),
            mark(field("dl.wide", 5), "A complaint to the CITT requires a procurement covered by at least one trade agreement.",
              "Une plainte au TCCE exige un approvisionnement visé par au moins un accord commercial."),
          ],
        ),
        p(
          "This {example} from PSPC for National Defence states its selection criteria as Highest Combined Rating of Technical Merit and Price; its description says the full Submission of Offers and annexes can only be accessed and downloaded in SAP Ariba.",
          "Cette {example} de SPAC pour la Défense nationale indique comme critères de sélection Cote combinée la plus élevée pour le mérite technique et le prix; sa description précise que la demande d'offres et les annexes ne peuvent être consultées et téléchargées que dans SAP Ariba.",
          { example: a(EXAMPLE_EVALUATION, "request for proposal", "demande de propositions") },
        ),
        p(
          "After the award, the dictionary's award notice fields include the supplier's legal name, the contract award date and the contract's value including taxes, with the same selection criteria field. {debriefing} typically includes the overall evaluation result of the successful supplier and an outline of the reasons the debriefed supplier was not successful, referring back to the evaluation criteria and selection method.",
          "Après l'attribution, les champs des avis d'attribution du dictionnaire comprennent la dénomination sociale du fournisseur, la date d'attribution du contrat et la valeur du contrat, taxes comprises, ainsi que le même champ des critères de sélection. {debriefing} devrait comprendre le résultat global de l'évaluation du fournisseur retenu et un résumé des raisons pour lesquelles le fournisseur n'a pas été retenu, en renvoyant aux critères d'évaluation et à la méthode de sélection.",
          { debriefing: a(DEBRIEF_PATH, "A debriefing", "Un compte rendu") },
        ),
      ],
    },
  ],
  sources: [
    SRC.bidEvaluation, SRC.methodSelection, SRC.evaluationCriteria, SRC.communicatingSelection, SRC.evaluationProcess, SRC.technicalEvaluation,
    SRC.financialEvaluation, SRC.basisSelection, SRC.saccSelection, SRC.seminar, SRC.procurementDirective, SRC.followUp, SRC.howToBid, SRC.dictionary,
    SRC.exampleEvaluation,
  ],
};

const DEBRIEF: Guide = {
  slug: DEBRIEF_PATH.slice("/guides/".length),
  title: both("After the Award: Debriefings and Bid Challenges on Federal Contracts", "Après l'attribution : comptes rendus et contestations des offres sur les marchés fédéraux"),
  seoTitle: both("Debriefings and Bid Challenges on Federal Contracts", "Compte rendu et contestation d'une offre fédérale"),
  summary: both(
    "After a federal contract award: the debriefing, and the Procurement Ombud's and Trade Tribunal's thresholds, deadlines and recommendations.",
    "Après une attribution fédérale : le compte rendu, et les seuils, délais et recommandations de l'ombud et du Tribunal canadien du commerce extérieur.",
  ),
  checked: "2026-11-14",
  action: tenderList(
    "To see the next federal tender notices as they are posted, save this list with your email address.",
    "Pour voir les prochains avis d'appel d'offres fédéraux à mesure qu'ils sont publiés, enregistrez cette liste avec votre adresse courriel.",
  ),
  sections: [
    {
      id: "debriefing",
      title: both("The Debriefing", "Le compte rendu"),
      blocks: [
        p(
          "CanadaBuys says suppliers can ask the contracting officer responsible for the opportunity for a debriefing once a contract is awarded following a competition; {bid} gives when it may be asked and what a typical one includes. The Treasury Board's Directive on the Management of Procurement makes contracting authorities responsible for ensuring that bidders who request a debriefing receive one in a timely manner after a contract has been awarded.",
          "AchatsCanada indique que les fournisseurs peuvent demander un compte rendu à l'agent de négociation des contrats responsable de l'occasion de marché une fois qu'un contrat est attribué à la suite d'un concours; {bid} précise quand le demander et ce que comprend en général un compte rendu. La Directive sur la gestion de l'approvisionnement du Conseil du Trésor charge les autorités contractantes de veiller à ce que les soumissionnaires qui demandent un compte rendu en reçoivent un rapidement après l'attribution du contrat.",
          { bid: a(BID_PATH, "How to Bid on Government of Canada Contracts", "Soumissionner sur les marchés du gouvernement du Canada") },
        ),
        p(
          "Under the Buyer's Guide of Public Services and Procurement Canada (PSPC), solicitations must clearly state that offerors are entitled to request a debriefing, which they may do upon the award of a contract or the issuance of a standing offer or supply arrangement. Offerors should request it within 15 working days of receiving the results of the solicitation process or its cancellation, and it should be conducted within 10 working days from the date the request is received. It can be provided in writing, by telephone or in person, depending on the most effective method for the specific procurement context.",
          "Selon le Guide de l'acheteur de Services publics et Approvisionnement Canada (SPAC), les documents de demande d'offres doivent préciser clairement que les offrants ont le droit de demander un compte rendu, ce qu'ils peuvent faire après l'attribution d'un contrat ou l'émission d'une offre à commandes ou d'un arrangement en matière d'approvisionnement. Les offrants devraient le demander dans les 15 jours ouvrables suivant la réception des résultats du processus de demande d'offres ou de son annulation, et il devrait avoir lieu dans les 10 jours ouvrables suivant la date de réception de la demande. Il peut être fourni par écrit, par téléphone ou en personne, selon la méthode la plus efficace dans le contexte précis de l'approvisionnement.",
        ),
        p(
          "Within the limits of information disclosure policies, the guide's list of what a debriefing will include, as applicable, runs from the names of the successful offerors to the scores the offeror achieved on all rated criteria, with sufficient details to understand why those scores were assigned; {evaluation} explains those criteria.",
          "Dans les limites des politiques de divulgation de renseignements, la liste du guide de ce que comprendra un compte rendu, selon le cas, va des noms des offrants retenus aux résultats obtenus par l'offrant sur tous les critères cotés, avec suffisamment de détails pour comprendre pourquoi ces notes ont été attribuées; {evaluation} explique ces critères.",
          { evaluation: a(EVALUATION_PATH, "How a Federal Bid Is Evaluated and the Basis of Selection", "L'évaluation d'une soumission fédérale et la méthode de sélection") },
        ),
      ],
    },
    {
      id: "bodies",
      title: both("Two Bodies, Split by Value", "Deux organismes, selon la valeur"),
      blocks: [
        p(
          "For an objection or complaint about a rejected bid, CanadaBuys recommends first contacting the contracting authority, which does not prevent recourse elsewhere. It notes that the options do not apply to every procurement and supplier, and describes two bodies a supplier may complain to, the Office of the Procurement Ombud (OPO) and the Canadian International Trade Tribunal.",
          "Pour une objection ou une plainte concernant une soumission rejetée, AchatsCanada recommande de communiquer d'abord avec l'autorité contractante, ce qui n'empêche pas d'exercer d'autres recours. Il précise que les options ne s'appliquent pas à tous les achats et fournisseurs, et décrit deux organismes auprès desquels un fournisseur peut porter plainte, le Bureau de l'ombud de l'approvisionnement (BOA) et le Tribunal canadien du commerce extérieur.",
        ),
        p(
          "The Tribunal's page on working with OPO explains that Parliament created OPO to deal with matters under the lowest dollar-value threshold amounts of the Canadian Free Trade Agreement (CFTA). Treasury Board Contracting Policy Notice 2025-8, which notes that the thresholds in the free trade agreements are updated every two years, sets the CFTA's thresholds for departments and agencies at $34,700 for goods and $139,000 for services and construction for the period from January 1, 2026, to December 31, 2027.",
          "La page du Tribunal sur la collaboration avec le BOA explique que le Parlement a créé le BOA pour traiter des questions qui relèvent du seuil monétaire le plus bas de l'Accord de libre-échange canadien (ALEC). L'Avis sur la Politique des marchés 2025-8 du Conseil du Trésor, qui rappelle que les seuils des accords de libre-échange sont mis à jour tous les deux ans, fixe les seuils de l'ALEC pour les ministères et organismes à 34 700 $ pour les biens et à 139 000 $ pour les services et la construction pour la période du 1er janvier 2026 au 31 décembre 2027.",
        ),
        p(
          "The rules side by side, from OPO's questions on complaints, the Tribunal's page on filing a complaint and its procurement inquiries guide, the Procurement Ombudsman Regulations and the Canadian International Trade Tribunal Procurement Inquiry Regulations, both current to October 19, 2026:",
          "Les règles côte à côte, d'après la foire aux questions du BOA sur les plaintes, la page du Tribunal sur le dépôt d'une plainte et son guide des enquêtes sur les marchés publics, le Règlement concernant l'ombudsman de l'approvisionnement et le Règlement sur les enquêtes du Tribunal canadien du commerce extérieur sur les marchés publics, tous deux à jour au 19 octobre 2026 :",
        ),
        {
          kind: "table",
          cols: [
            { kind: "label", label: both("Rule", "Règle") },
            { kind: "main", label: both("Office of the Procurement Ombud", "Bureau de l'ombud de l'approvisionnement") },
            { kind: "main", label: both("Canadian International Trade Tribunal", "Tribunal canadien du commerce extérieur") },
          ],
          rows: [
            [
              both("Who may file", "Qui peut porter plainte"),
              both("A supplier that has a place of business in Canada", "Un fournisseur qui a un établissement au Canada"),
              both("Canadian and foreign suppliers", "Les fournisseurs canadiens et étrangers"),
            ],
            [
              both("Value", "Valeur"),
              both(
                "For a complaint about an award, less than $34,700 for goods or less than $139,000 for services; for one about the administration of a contract, no dollar threshold",
                "Pour une plainte concernant l'attribution, moins de 34 700 $ pour les biens ou moins de 139 000 $ pour les services; pour une plainte concernant l'administration d'un contrat, aucun seuil monétaire",
              ),
              both(
                "For a Canadian supplier, $34,700 and above for goods and $139,000 and above for services and construction; $100,000 and above for services relating to the Canada-Korea Free Trade Agreement",
                "Pour un fournisseur canadien, 34 700 $ et plus pour les marchandises et 139 000 $ et plus pour les services et la construction; 100 000 $ et plus pour les services liés à l'Accord de libre-échange Canada-Corée",
              ),
            ],
            [
              both("Deadline to file", "Délai de dépôt"),
              both(
                "For a complaint about an award, 30 working days after public notice of the award; with no public notice, 30 working days after the day the award became known or reasonably should have become known to the complainant",
                "Pour une plainte concernant l'attribution, 30 jours ouvrables suivant l'avis public de l'attribution; à défaut d'avis, 30 jours ouvrables suivant la date à laquelle le plaignant a eu connaissance de l'attribution ou aurait raisonnablement dû en avoir connaissance",
              ),
              both(
                "Not later than 10 working days after the day the basis of the complaint became known or reasonably should have become known to the potential supplier",
                "Dans les 10 jours ouvrables suivant la date où le fournisseur potentiel a découvert ou aurait dû vraisemblablement découvrir les faits à l'origine de la plainte",
              ),
            ],
            [
              both("After an objection to the buyer", "Après une opposition auprès de l'acheteur"),
              both(
                "30 working days after the day the contracting department denied the objection, if it was made within the period above",
                "30 jours ouvrables suivant le refus du ministère contractant de donner suite à l'opposition, si elle a été présentée dans le délai ci-dessus",
              ),
              both(
                "10 working days after the day of actual or constructive knowledge of the denial of relief, if the objection was made within 10 working days after the day its basis became known or reasonably should have become known",
                "10 jours ouvrables suivant la date où le fournisseur a pris connaissance, directement ou par déduction, du refus de réparation, si l'opposition a été présentée dans les 10 jours ouvrables suivant la date où il a découvert ou aurait dû vraisemblablement découvrir les faits à son origine",
              ),
            ],
            [
              both("Later filing", "Dépôt tardif"),
              both(
                "Where, for reasons beyond its control, the complainant is not able to file within those periods, the Ombud may, at its request, extend them to a maximum of 90 working days",
                "Si, pour des raisons hors de son contrôle, le plaignant n'a pas pu déposer sa plainte dans ces délais, l'ombud peut, sur demande du plaignant, les prolonger jusqu'à un maximum de 90 jours ouvrables",
              ),
              both(
                "Not later than 30 days after the day the basis became known or reasonably should have become known, if the Tribunal determines, considering all the circumstances and the potential supplier's good faith, that the failure to file was attributable to a cause beyond its control at the time the complaint should have been filed, or that the complaint concerns an aspect of the procurement process of a systemic nature, relating to the contract, and compliance with the procurement provisions of one or more applicable trade agreements",
                "Dans les 30 jours suivant la date où le fournisseur potentiel a découvert ou aurait dû vraisemblablement découvrir les faits à l'origine de la plainte, si le Tribunal conclut, compte tenu de toutes les circonstances et de la bonne foi du fournisseur potentiel, que la plainte n'a pas été déposée en raison de circonstances indépendantes de sa volonté au moment où elle aurait dû l'être, ou qu'elle porte sur l'un des aspects de nature systémique du processus des marchés publics ayant trait au contrat et sur la conformité aux dispositions relatives aux marchés publics de tout accord commercial applicable",
              ),
            ],
            [
              both("First determination", "Première décision"),
              both("Whether to review the complaint, within 10 working days after the filing", "S'il examinera la plainte, dans les 10 jours ouvrables suivant le dépôt"),
              both(
                "Whether the information discloses a reasonable indication that the conditions for an inquiry are met, within five working days after the filing",
                "Si les renseignements indiquent de façon raisonnable que les conditions d'une enquête sont remplies, dans les cinq jours ouvrables suivant le dépôt",
              ),
            ],
            [
              both("Findings and recommendations", "Conclusions et recommandations"),
              both("Within 120 working days after the day the complaint is filed", "Dans les 120 jours ouvrables suivant le dépôt de la plainte"),
              both(
                "Within 90 days after the filing; 45 days after granting a request for an express option; 135 days after the filing where it authorizes an extension of time",
                "Dans les 90 jours suivant le dépôt; dans les 45 jours après avoir agréé une demande de procédure expéditive; dans les 135 jours suivant le dépôt s'il autorise une procédure prolongée",
              ),
            ],
            [
              both("Recommendations", "Recommandations"),
              both(
                "It can recommend that a department compensate a supplier, for a complaint about an award, and does not have the authority to cancel or change the terms and conditions of contracts",
                "Il peut recommander qu'un ministère verse une indemnité à un fournisseur, pour une plainte ayant trait à l'attribution d'un contrat, et n'a pas le pouvoir d'annuler un contrat ou d'en modifier les modalités",
              ),
              both(
                "Where a complaint is valid, it may recommend such remedy as it considers appropriate, including a new solicitation, a re-evaluation of the bids, termination of the designated contract, its award to the complainant, or compensation of the complainant for lost profits or losses",
                "Lorsqu'une plainte est fondée, il peut recommander les mesures correctives qu'il juge appropriées, notamment un nouvel appel d'offres, la réévaluation des soumissions, la résiliation du contrat spécifique, son attribution au plaignant ou le versement d'une indemnité au plaignant pour ses pertes de profits ou autres pertes",
              ),
            ],
            [
              both("Limits on amounts", "Plafonds des montants"),
              both(
                "For lost profit, the lesser of the net profit at the lower of the bid and the amount awarded, and 10% of the value of the contract awarded, each less the cost of submitting the bid; for the costs of submitting the bid, up to 10% of that value; options and extensions left out",
                "Pour le bénéfice perdu, le moindre du bénéfice net, calculé à la moindre de la soumission et de la valeur d'attribution, et de 10 % de la valeur du marché attribué, moins les coûts de soumission dans les deux cas; pour les coûts de soumission, au plus 10 % de cette valeur; options et prolongations exclues",
              ),
              both(
                "Compensation for lost profits up to 10% of the complainant's bid price, where the contract should have been awarded to it; where that cannot be determined, for the lost opportunity, up to 10% of the bid price of the awarded contract divided by the number of potential suppliers. The costs of preparing a response, only for a compliant response, up to 2% of the complainant's bid price, and then no re-evaluation, award or compensation. Bid prices leave out options and extensions",
                "Une indemnité pour les profits perdus jusqu'à 10 % du prix offert par le plaignant, si le contrat aurait dû lui être accordé; s'il n'est pas possible de le décider, pour l'occasion perdue, jusqu'à 10 % du prix offert dans la soumission retenue divisé par le nombre de fournisseurs potentiels. Les frais de préparation d'une réponse, seulement pour une réponse conforme, jusqu'à 2 % du prix offert par le plaignant, et alors sans réévaluation, attribution ni indemnité. Les prix offerts excluent les options et les prolongations",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "ombud",
      title: both("The Ombud's Review", "L'examen de l'ombud"),
      blocks: [
        p(
          "A complaint to OPO must be filed in writing. Among the conditions the Ombudsman Regulations set for a review, the facts and grounds of the complaint are not and have not been the subject of an inquiry before the Tribunal or a proceeding in a court of competent jurisdiction, and there are reasonable grounds to believe that the contract was not awarded in accordance with the regulations made under the Financial Administration Act. For a recommendation of compensation where a competitive process was held, the complainant must have submitted a bid, unless the contracting department's actions prevented it.",
          "Une plainte au BOA est déposée par écrit. Parmi les conditions que fixe le Règlement concernant l'ombudsman de l'approvisionnement pour un examen, les motifs et les faits de la plainte ne font pas, et n'ont pas fait, l'objet d'une enquête devant le Tribunal ni d'une procédure devant tout autre tribunal compétent, et il existe des motifs raisonnables de croire que le marché n'a pas été attribué conformément aux règlements pris en vertu de la Loi sur la gestion des finances publiques. Pour qu'une indemnité soit recommandée lorsqu'un appel d'offres a été lancé, le plaignant doit avoir soumissionné, à moins qu'il n'ait pu le faire en raison des actions du ministère contractant.",
        ),
      ],
    },
    {
      id: "tribunal",
      title: both("The Tribunal's Inquiry", "L'enquête du Tribunal"),
      blocks: [
        p(
          "CanadaBuys says a complaint to the Tribunal requires a procurement covered by at least one of the trade agreements under which Canada has government procurement obligations; the {trade} explains each agreement's thresholds. The Tribunal's procurement inquiries guide says that by legislation the institution is to implement its recommendations to the greatest extent possible, and that the Tribunal does not have the power to delay the performance of a contract already awarded. When a complaint is accepted for inquiry prior to contract award, the guide adds, the Tribunal may order the institution to postpone any award of contract until the resolution of the complaint. The Tribunal is reviewing the guide after the Regulations changed in June and December 2025.",
          "AchatsCanada indique qu'une plainte au Tribunal exige que l'approvisionnement soit visé par au moins un des accords commerciaux en vertu desquels le Canada a des obligations en matière d'approvisionnement gouvernemental; le {trade} explique les seuils de chaque accord. Le guide des enquêtes sur les marchés publics du Tribunal précise que, selon la loi, l'institution fédérale doit mettre en œuvre ses recommandations dans toute la mesure du possible, et que le Tribunal n'a pas le pouvoir de retarder l'exécution d'un marché déjà adjugé. Lorsqu'une plainte est acceptée aux fins d'enquête avant l'attribution du contrat, ajoute le guide, le Tribunal peut ordonner à l'institution fédérale de différer toute attribution du contrat jusqu'au règlement de la plainte. Le Tribunal révise ce guide à la suite des modifications apportées au Règlement en juin et décembre 2025.",
          { trade: a(TRADE_PATH, "guide on trade agreements", "guide sur les accords commerciaux") },
        ),
        p(
          "The Regulations bar the Tribunal from addressing or examining matters relating to measures that, among others, restrict participation in the procurement process to Canadian suppliers or favour them; the {bc} explains that policy's measures.",
          "Le Règlement interdit au Tribunal d'aborder ou de traiter toute question relative à des mesures qui, notamment, restreignent la participation à la procédure de marchés publics aux fournisseurs canadiens ou favorisent ces fournisseurs; le {bc} explique les mesures de cette politique.",
          { bc: a(BUY_CANADIAN_PATH, "guide on the Buy Canadian Policy", "guide sur la Politique « Achetez canadien »") },
        ),
      ],
    },
    {
      id: "records",
      title: both("What the Award Notice Shows", "Ce que montre l'avis d'attribution"),
      blocks: [
        p(
          "CanadaBuys' data dictionary defines the contract award date as the date when a contract is awarded, and the publication date as the date a tender notice, award notice, or contract is publicly published; Award Watch shows them under Awarded and Published. Under the Ombudsman Regulations, a complaint is filed when the information and documents the Regulations list are submitted; one item is information identifying the contract, including the date of public notice of the award or, if there was none, the date of award, if known. The Tribunal's guide says a complaint must contain information on the procurement, which includes the solicitation number or file number, the contract number if known, the estimated contract value and the relevant dates, contract award among them.",
          "Le dictionnaire de données d'AchatsCanada définit la date d'attribution du contrat comme la date à laquelle un contrat a été attribué, et la date de publication comme la date à laquelle un avis d'appel d'offres, un avis d'attribution ou un contrat est affiché publiquement; Award Watch les affiche sous Attribué le et Publié. Selon le Règlement concernant l'ombudsman de l'approvisionnement, la plainte est déposée lorsque les renseignements et documents que le Règlement énumère sont fournis; l'un d'eux est tout renseignement permettant d'identifier le marché, y compris la date de l'avis public de son attribution ou, à défaut, la date de son attribution si elle est connue. Le guide du Tribunal précise que toute plainte doit contenir des renseignements sur le marché public, dont le numéro de l'invitation à soumissionner ou le numéro du dossier, le numéro du contrat s'il est connu, la valeur estimative du contrat et les dates pertinentes, dont celle de l'adjudication du contrat.",
        ),
        figure(
          "award-procurement", SAMPLE_AWARD, ".panel-grid > section.panel",
          both(
            "The Procurement panel of an award notice's page on Award Watch: contract number, procurement number, solicitation number, instrument type, amendment type, category, notice type, procurement method, selection criteria, trade agreements and the places of delivery.",
            "Le panneau Approvisionnement de la page d'un avis d'attribution sur Award Watch : numéro de contrat, numéro d'approvisionnement, numéro de l'invitation, type d'instrument, type de modification, catégorie, type d'avis, méthode d'approvisionnement, critères de sélection, accords commerciaux et lieux de livraison.",
          ),
          both("An award notice's procurement details on Award Watch.", "Les détails d'approvisionnement d'un avis d'attribution sur Award Watch."),
          [
            mark(field("dl", 1), "A complaint to the Tribunal contains the contract number, if known.", "Une plainte au Tribunal contient le numéro du contrat, s'il est connu."),
            mark(field("dl", 3), "A complaint to the Tribunal contains the solicitation number or file number.",
              "Une plainte au Tribunal contient le numéro de l'invitation à soumissionner ou le numéro du dossier."),
            mark(field("dl", 6), "The value that divides the two bodies differs for goods and for services.", "La valeur qui sépare les deux organismes diffère pour les biens et pour les services."),
            mark(field("dl", 10), "A complaint to the Tribunal requires a procurement covered by at least one trade agreement.",
              "Une plainte au Tribunal exige un approvisionnement visé par au moins un accord commercial."),
          ],
        ),
        p(
          "The dictionary defines the trade agreements field, shown under Trade agreements, as a list of any international trade agreements that apply to the procurement action, if applicable. Where the Tribunal requires a contract's value to be determined, its Regulations deem it the value the government institution established when a notice of proposed procurement was published in accordance with one or more trade agreements or, without one, when the solicitation documentation was made available to potential suppliers.",
          "Le dictionnaire définit le champ des accords commerciaux, affiché sous Accords commerciaux, comme une liste de tous les accords commerciaux internationaux qui s'appliquent à l'action d'approvisionnement, le cas échéant. Lorsque le Tribunal exige que la valeur d'un contrat soit déterminée, son Règlement la considère égale à la valeur établie par l'institution fédérale à la date de publication d'un avis de projet de marché public conforme à un ou plusieurs accords commerciaux ou, à défaut, au moment où l'appel d'offres a été mis à la disposition des fournisseurs potentiels.",
        ),
        p(
          "This {example} from Agriculture and Agri-Food Canada, for a liquid chromatography system, shows an award date of October 21, 2026, a publication date of November 10, 2026, Goods as its category, a total contract value of $272,865 and eleven agreements in its trade agreements line, the CFTA among them.",
          "Cet {example} d'Agriculture et Agroalimentaire Canada, pour un système de chromatographie en phase liquide, indique une date d'attribution du 21 octobre 2026, une date de publication du 10 novembre 2026, la catégorie Biens, une valeur totale du contrat de 272 865 $ et onze accords dans sa ligne des accords commerciaux, dont l'ALEC.",
          { example: a(EXAMPLE_DEBRIEF, "award notice", "avis d'attribution") },
        ),
      ],
    },
  ],
  sources: [
    SRC.followUp, SRC.debriefing, SRC.procurementDirective, SRC.opoComplaints, SRC.ombudsmanRegulations, SRC.cittComplaint, SRC.cittOmbud,
    SRC.cittGuide, SRC.cittRegulations, SRC.thresholds, SRC.dictionary,
  ],
};

// The order of the index, and of the sitemap's part.
export const GUIDES: readonly Guide[] = [
  HOW_TO_BID, EVALUATION, DEBRIEF, TENDER_NOTICE, TRADE, BUY_CANADIAN, SBPP, SECURITY, CYBER, INTEGRITY, ACAN, LIMITS, STANDING_OFFERS,
  PSIB, THREE_RECORDS, CONTRACT_END,
];

export const GUIDE_SLUGS: ReadonlySet<string> = new Set(GUIDES.map((g) => g.slug));

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

// Every figure in the guides, with the guide it belongs to: what the capture tool renders and the tests check.
export function guideFigures(): { slug: string; figure: Figure }[] {
  return GUIDES.flatMap((g) => g.sections.flatMap((s) => s.blocks.filter((b): b is Figure => b.kind === "figure").map((f) => ({ slug: g.slug, figure: f }))));
}

// The newest day any guide was checked: the date the sitemap gives the section.
export function guidesChecked(): string {
  return GUIDES.reduce((d, g) => (g.checked > d ? g.checked : d), "");
}
