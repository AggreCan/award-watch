// The codes the pipeline writes into the static files, in one place. Nothing
// here imports the dictionary, so i18n.ts can read the segment titles below
// without a cycle.

// The thirteen provinces and territories, as the files write them.
export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;
// An address outside Canada, and a record with no usable address.
export const OUTSIDE = "XX";
export const UNKNOWN = "UN";
export const PLACE_CODES: readonly string[] = [...PROVINCES, OUTSIDE, UNKNOWN];

// The directory's codes are the same in lower case (they sit in URLs).
export const DIRECTORY_CODES: readonly string[] = PLACE_CODES.map((p) => p.toLowerCase());

// normalize.tender_status in the pipeline.
export const TENDER_STATUSES = ["open", "expired", "cancelled", "awarded", "unknown"] as const;
// The awardStatus column, folded to lower case; contract history uses the same words.
export const AWARD_STATUSES = ["active", "expired", "cancelled", "unknown"] as const;

// An open notice whose closing date falls within this many days is shown as
// closing soon (the home page list, the badge, the closing-window filter).
export const CLOSING_SOON_DAYS = 7;

// The five record sources of an organization profile, in the order the
// profile shows them. Lobbying reports carry no amount.
export const SOURCES = ["awards", "history", "contracts", "grants", "lobbying"] as const;
export type SourceKey = (typeof SOURCES)[number];
export const MONEY_SOURCES = ["awards", "history", "contracts", "grants"] as const;
export type MoneySource = (typeof MONEY_SOURCES)[number];

// CanadaBuys procurement categories, as the files write them without the
// leading asterisk.
export const CATEGORIES = ["SRV", "GD", "CNST", "SRVTGD"] as const;

// The 57 UNSPSC segments (the first two digits of a code), with titles in
// both languages. Segment-level codes rarely appear in the files, so the
// titles are kept here as the pipeline keeps them in its seed.
export const SEGMENTS: Readonly<Record<string, { en: string; fr: string }>> = {
  "10": { en: "Live Plant and Animal Material and Accessories and Supplies", fr: "Matériel végétal et animal vivant, accessoires et fournitures" },
  "11": { en: "Mineral and Textile and Inedible Plant and Animal Materials", fr: "Matières minérales et textiles, matières végétales et animales non comestibles" },
  "12": { en: "Chemicals including Bio Chemicals and Gas Materials", fr: "Produits chimiques, y compris les produits biochimiques et les gaz" },
  "13": { en: "Resin and Rosin and Rubber and Foam and Film and Elastomeric Materials", fr: "Résines, colophanes, caoutchouc, mousses, pellicules et élastomères" },
  "14": { en: "Paper Materials and Products", fr: "Matières et produits en papier" },
  "15": { en: "Fuels and Fuel Additives and Lubricants and Anti corrosive Materials", fr: "Combustibles, additifs pour combustibles, lubrifiants et produits anticorrosion" },
  "20": { en: "Mining and Well Drilling Machinery and Accessories", fr: "Machinerie d'exploitation minière et de forage de puits et accessoires" },
  "21": { en: "Farming and Fishing and Forestry and Wildlife Machinery and Accessories", fr: "Machinerie agricole, de pêche, forestière et faunique et accessoires" },
  "22": { en: "Building and Construction Machinery and Accessories", fr: "Machinerie de bâtiment et de construction et accessoires" },
  "23": { en: "Industrial Manufacturing and Processing Machinery and Accessories", fr: "Machinerie de fabrication et de transformation industrielles et accessoires" },
  "24": { en: "Material Handling and Conditioning and Storage Machinery and their Accessories and Supplies", fr: "Machinerie de manutention, de conditionnement et d'entreposage, accessoires et fournitures" },
  "25": { en: "Commercial and Military and Private Vehicles and their Accessories and Components", fr: "Véhicules commerciaux, militaires et privés, accessoires et composants" },
  "26": { en: "Power Generation and Distribution Machinery and Accessories", fr: "Machinerie de production et de distribution d'énergie et accessoires" },
  "27": { en: "Tools and General Machinery", fr: "Outils et machinerie générale" },
  "30": { en: "Structures and Building and Construction and Manufacturing Components and Supplies", fr: "Structures, composants et fournitures de bâtiment, de construction et de fabrication" },
  "31": { en: "Manufacturing Components and Supplies", fr: "Composants et fournitures de fabrication" },
  "32": { en: "Electronic Components and Supplies", fr: "Composants et fournitures électroniques" },
  "39": { en: "Electrical Systems and Lighting and Components and Accessories and Supplies", fr: "Systèmes électriques et d'éclairage, composants, accessoires et fournitures" },
  "40": { en: "Distribution and Conditioning Systems and Equipment and Components", fr: "Systèmes, équipement et composants de distribution et de conditionnement" },
  "41": { en: "Laboratory and Measuring and Observing and Testing Equipment", fr: "Équipement de laboratoire, de mesure, d'observation et d'essai" },
  "42": { en: "Medical Equipment and Accessories and Supplies", fr: "Équipement médical, accessoires et fournitures" },
  "43": { en: "Information Technology Broadcasting and Telecommunications", fr: "Technologies de l'information, radiodiffusion et télécommunications" },
  "44": { en: "Office Equipment and Accessories and Supplies", fr: "Équipement de bureau, accessoires et fournitures" },
  "45": { en: "Printing and Photographic and Audio and Visual Equipment and Supplies", fr: "Équipement et fournitures d'impression, de photographie et audiovisuels" },
  "46": { en: "Defense and Law Enforcement and Security and Safety Equipment and Supplies", fr: "Équipement et fournitures de défense, de maintien de l'ordre, de sécurité et de protection" },
  "47": { en: "Cleaning Equipment and Supplies", fr: "Équipement et fournitures de nettoyage" },
  "48": { en: "Service Industry Machinery and Equipment and Supplies", fr: "Machinerie, équipement et fournitures pour l'industrie des services" },
  "49": { en: "Sports and Recreational Equipment and Supplies and Accessories", fr: "Équipement, fournitures et accessoires de sport et de loisirs" },
  "50": { en: "Food Beverage and Tobacco Products", fr: "Aliments, boissons et produits du tabac" },
  "51": { en: "Drugs and Pharmaceutical Products", fr: "Médicaments et produits pharmaceutiques" },
  "52": { en: "Domestic Appliances and Supplies and Consumer Electronic Products", fr: "Appareils ménagers, fournitures et produits électroniques grand public" },
  "53": { en: "Apparel and Luggage and Personal Care Products", fr: "Vêtements, bagages et produits de soins personnels" },
  "54": { en: "Timepieces and Jewelry and Gemstone Products", fr: "Montres, bijoux et pierres précieuses" },
  "55": { en: "Published Products", fr: "Produits publiés" },
  "56": { en: "Furniture and Furnishings", fr: "Meubles et ameublement" },
  "60": { en: "Musical Instruments and Games and Toys and Arts and Crafts and Educational Equipment and Materials and Accessories and Supplies", fr: "Instruments de musique, jeux, jouets, arts et artisanat, matériel éducatif, accessoires et fournitures" },
  "64": { en: "Financial Instruments, Products, Contracts and Agreements", fr: "Instruments, produits, contrats et ententes financiers" },
  "70": { en: "Farming and Fishing and Forestry and Wildlife Contracting Services", fr: "Services agricoles, de pêche, forestiers et fauniques" },
  "71": { en: "Mining and Oil and Gas Services", fr: "Services miniers, pétroliers et gaziers" },
  "72": { en: "Building and Facility Construction and Maintenance Services", fr: "Services de construction et d'entretien de bâtiments et d'installations" },
  "73": { en: "Industrial Production and Manufacturing Services", fr: "Services de production et de fabrication industrielles" },
  "76": { en: "Industrial Cleaning Services", fr: "Services de nettoyage industriel" },
  "77": { en: "Environmental Services", fr: "Services environnementaux" },
  "78": { en: "Transportation and Storage and Mail Services", fr: "Services de transport, d'entreposage et de courrier" },
  "80": { en: "Management and Business Professionals and Administrative Services", fr: "Services de gestion, services professionnels et services administratifs" },
  "81": { en: "Engineering and Research and Technology Based Services", fr: "Services d'ingénierie, de recherche et de technologie" },
  "82": { en: "Editorial and Design and Graphic and Fine Art Services", fr: "Services de rédaction, de design, de graphisme et de beaux-arts" },
  "83": { en: "Public Utilities and Public Sector Related Services", fr: "Services publics et services liés au secteur public" },
  "84": { en: "Financial and Insurance Services", fr: "Services financiers et d'assurance" },
  "85": { en: "Healthcare Services", fr: "Services de soins de santé" },
  "86": { en: "Education and Training Services", fr: "Services d'éducation et de formation" },
  "90": { en: "Travel and Food and Lodging and Entertainment Services", fr: "Services de voyage, d'alimentation, d'hébergement et de divertissement" },
  "91": { en: "Personal and Domestic Services", fr: "Services personnels et domestiques" },
  "92": { en: "National Defense and Public Order and Security and Safety Services", fr: "Services de défense nationale, d'ordre public, de sécurité et de protection" },
  "93": { en: "Politics and Civic Affairs Services", fr: "Services politiques et d'affaires civiques" },
  "94": { en: "Organizations and Clubs", fr: "Organisations et clubs" },
  "95": { en: "Land and Buildings and Structures and Thoroughfares", fr: "Terrains, bâtiments, structures et voies de circulation" },
};
export const SEGMENT_CODES: readonly string[] = Object.keys(SEGMENTS).sort();

// Award notices start in 2012 (the historical file); the year pages count from there.
export const FIRST_AWARD_YEAR = 2012;
