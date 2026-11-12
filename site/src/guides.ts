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
};

const a = (href: string, en: string, fr: string): Link => ({ href, text: { en, fr } });
const tx = (en: string, fr: string, links?: Record<string, Link>): Text => (links ? { en, fr, links } : { en, fr });
const p = (en: string, fr: string, links?: Record<string, Link>): Block => ({ kind: "p", text: tx(en, fr, links) });
const both = (en: string, fr: string): Both => ({ en, fr });

// -- the publishers and pages the guides cite ------------------------------------------

const PSPC = both("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada");
const TBS = both("Treasury Board of Canada Secretariat", "Secrétariat du Conseil du Trésor du Canada");
const JUSTICE = both("Justice Laws Website, Department of Justice Canada", "Site Web de la législation, ministère de la Justice Canada");

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
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/create-solicitation/tender-notices/advanced-contract-award-notice",
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
    url: "https://canadabuys.canada.ca/en/buyer-s-portal/buyer-s-guide/plan/determine-procurement-strategy/trade-agreement-applicability",
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
} satisfies Record<string, Source>;

// The site's own pages the guides link to.
const METHODOLOGY = "/methodology";
// One organization with records in all three contract sources and four standing offers or supply arrangements,
// so its profile shows each section the guides point to (read on awardwatch.ca on 2026-11-11).
export const EXAMPLE_PROFILE = "/organizations/org-77ed664e0c";

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
            { kind: "main", label: both("Point", "Aspect") },
            { kind: "text", label: both("Standing offer", "Offre à commandes") },
            { kind: "text", label: both("Supply arrangement", "Arrangement en matière d'approvisionnement") },
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
          "An award notice or a contract history record counts once per reference number, at the total value on its newest amendment when that is positive, else the amount on its newest amendment; a cancelled notice counts zero. A published contract row counts at its own value: the amendment value for an amendment, else the original value, else the contract value. These totals add up contract values. None of the sources reports amounts paid.",
          "Un avis d'attribution ou un dossier de l'historique compte une fois par numéro de référence, à la valeur totale de sa plus récente modification lorsqu'elle est positive, sinon au montant de sa plus récente modification; un avis annulé compte pour zéro. Une ligne de contrat publié compte à sa valeur propre : la valeur de la modification pour une modification, sinon la valeur initiale, sinon la valeur du contrat. Ces totaux additionnent des valeurs de contrats. Aucune des sources ne déclare les montants versés.",
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

// The order of the index, and of the sitemap's part.
export const GUIDES: readonly Guide[] = [TENDER_NOTICE, STANDING_OFFERS, THREE_RECORDS];

export const GUIDE_SLUGS: ReadonlySet<string> = new Set(GUIDES.map((g) => g.slug));

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

// The newest day any guide was checked: the date the sitemap gives the section.
export function guidesChecked(): string {
  return GUIDES.reduce((d, g) => (g.checked > d ? g.checked : d), "");
}
