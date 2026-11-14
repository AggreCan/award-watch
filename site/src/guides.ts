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
export type Block =
  | { kind: "p"; text: Text }
  | { kind: "list"; items: Text[] }
  | { kind: "terms"; items: { term: Both; text: Text }[] }
  | { kind: "table"; cols: Column[]; rows: Cell[][] };
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

// -- the publishers and pages the guides cite ------------------------------------------

const PSPC = both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada");
const TBS = both("Treasury Board of Canada Secretariat", "Secrétariat du Conseil du Trésor du Canada");
const JUSTICE = both("Justice Laws Website, Department of Justice Canada", "Site Web de la législation, ministère de la Justice Canada");
const ISC = both("Indigenous Services Canada", "Services aux Autochtones Canada");
const OPO = both("Office of the Procurement Ombud", "Bureau de l'ombud de l'approvisionnement");
// PSPC's Buyer's Guide, in each language.
const GUIDE_EN = "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide";
const GUIDE_FR = "https://achatscanada.canada.ca/fr/portail-de-l-acheteur/guide-de-l-acheteur";

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
  },
  seminar: {
    title: "Seminar notes: Bidding on opportunities",
    publisher: PSPC,
    url: "https://www.canada.ca/en/public-services-procurement/services/acquisitions/support-for-businesses/bid-on-opportunities/bidding.html",
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
// The addresses of the guides that link one another.
const ACAN_PATH = "/guides/advance-contract-award-notices-acan";
const PSIB_PATH = "/guides/indigenous-business-set-asides-psib";
const THREE_PATH = "/guides/three-records-of-one-federal-contract";

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
          "A limited tendering reason, such as exclusive rights or extreme urgency, explains why a contract is not awarded through competitive solicitation.",
          "Un motif d'appel d'offres limité, comme des droits exclusifs ou une urgence extrême, explique pourquoi un contrat n'est pas attribué par une demande de soumissions concurrentielle.",
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
          "The Government Contracts Regulations require a contracting authority to solicit bids before it enters into a contract (section 5). Section 6 allows a contract without soliciting bids in four cases:",
          "Le Règlement sur les marchés de l'État oblige l'autorité contractante à lancer un appel d'offres avant de conclure un marché (article 5). L'article 6 permet de conclure un marché sans appel d'offres dans quatre cas :",
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
          "A department must have the legal authority to amend a contract, and must follow the Treasury Board's requirements for approval. Most of the contracting limits in Appendix A of the Directive on the Management of Procurement were raised for inflation effective December 15, 2025. PSPC's limits cover both contract entry and amendments, and a submission beyond them needs Treasury Board approval.",
          "Un ministère doit détenir le pouvoir légal de modifier un contrat et respecter les exigences du Conseil du Trésor en matière d'approbation. La plupart des limites contractuelles de l'annexe A de la Directive sur la gestion de l'approvisionnement ont été augmentées pour tenir compte de l'inflation, avec effet le 15 décembre 2025. Les limites de SPAC visent à la fois la conclusion et la modification des contrats, et une présentation qui les dépasse nécessite l'approbation du Conseil du Trésor.",
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

// The order of the index, and of the sitemap's part.
export const GUIDES: readonly Guide[] = [TENDER_NOTICE, ACAN, STANDING_OFFERS, PSIB, THREE_RECORDS, CONTRACT_END];

export const GUIDE_SLUGS: ReadonlySet<string> = new Set(GUIDES.map((g) => g.slug));

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

// The newest day any guide was checked: the date the sitemap gives the section.
export function guidesChecked(): string {
  return GUIDES.reduce((d, g) => (g.checked > d ? g.checked : d), "");
}
