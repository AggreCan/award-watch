// The analytics builder's strings (src/pages/builder.tsx, src/builder.ts;
// docs/analytics.md, "The builder"), in English and French, spread into the
// site's dictionary (src/i18n.ts) as the dashboard's are. The menus' other
// labels are the analytics views' own keys. French is written with plain
// spaces and straight apostrophes; the dictionary's typography pass adds the
// Canadian French forms when they are read. None of these reach a page while
// the BUILDER switch is off.

export const BUILDER_STRINGS = {
  // The plan cards' row, on Ultra's card only (src/pro.tsx BUILDER_ROW), while the switch is on: what the builder
  // makes, and its {n} fiscal years (builder.ts BUILD_YEARS).
  "plans.builder": { en: "Analytics builder: your charts and tables", fr: "Générateur d'analyses : graphiques, tableaux" },
  // The Ultra paragraph's sentence on the builder (src/pages/pro.tsx UltraSection), while the switch is on: {years}
  // BUILD_YEARS, {n} SET_MAX.
  "propage.ultra_builder": {
    en: "With the analytics builder you choose what to count, how to group it, the source and up to {years} fiscal years, and compare up to {n} buyers or organizations side by side.",
    fr: "Avec le générateur d'analyses, vous choisissez quoi compter, comment le regrouper, la source et jusqu'à {years} exercices, et comparez jusqu'à {n} acheteurs ou organisations côte à côte.",
  },
  // The Methodology page's paragraph on the builder (src/pages/methodology.tsx), while the switch is on.
  "methodology.analytics_builder": {
    en: "The analytics builder, part of Ultra, counts by the same rules, from figures the nightly counts ahead for each buyer, segment, province of delivery, source and fiscal year. A median, a count of organizations and the largest organizations' share are never added across fiscal years; provinces and segments are never added together, since one notice can name several; a supplier withheld as a person counts in the totals and is named by no row.",
    fr: "Le générateur d'analyses, qui fait partie d'Ultra, compte selon les mêmes règles, à partir de chiffres que le traitement de nuit calcule d'avance pour chaque acheteur, segment, province de livraison, source et exercice. Une médiane, un nombre d'organisations et la part des plus grandes organisations ne s'additionnent jamais d'un exercice à l'autre; les provinces et les segments ne sont jamais additionnés, puisqu'un avis peut en nommer plusieurs; un fournisseur dont le nom est retenu parce qu'il s'agit d'une personne compte dans les totaux et ne figure dans aucune ligne.",
  },
  // The rail's item and the analytics index's link.
  "rail.builder": { en: "Analytics builder", fr: "Générateur d'analyses" },

  // -- the page ---------------------------------------------------------------------------------------
  "build.title": { en: "Analytics Builder", fr: "Générateur d'analyses" },
  "build.crumb": { en: "Builder", fr: "Générateur" },
  "build.lead": {
    en: "Choose what to count, how to group it, the source and the period. The page's address keeps the choices.",
    fr: "Choisissez quoi compter, comment le regrouper, la source et la période. L'adresse de la page conserve les choix.",
  },
  "build.description": {
    en: "Federal procurement figures by buyer, segment, organization, province and fiscal year, as you choose them.",
    fr: "Chiffres de l'approvisionnement fédéral par acheteur, segment, organisation, province et exercice, selon vos choix.",
  },
  // For a reader without Ultra, under the lead: what the builder does ({years} BUILD_YEARS, {n} SET_MAX) and that it
  // comes with Ultra, then the way to the plans (the page's one filled button), then the sample under its title.
  "build.gate_text": {
    en: "The builder draws charts and tables of the figures you choose, over up to {years} fiscal years, and compares up to {n} buyers or organizations side by side. It comes with Ultra.",
    fr: "Le générateur dessine des graphiques et des tableaux des chiffres que vous choisissez, sur au plus {years} exercices, et compare jusqu'à {n} acheteurs ou organisations côte à côte. Il fait partie d'Ultra.",
  },
  "build.gate_link": { en: "See the plans", fr: "Voir les forfaits" },
  "build.sample_title": { en: "Sample: {title}", fr: "Exemple : {title}" },
  "build.unavailable": { en: "The builder's figures cannot be read right now.", fr: "Les chiffres du générateur ne peuvent pas être lus pour le moment." },
  "build.unavailable_title": { en: "Figures Not Available Right Now", fr: "Chiffres non disponibles pour le moment" },
  "build.form": { en: "Choose the view", fr: "Choisir la vue" },

  // -- the menus ----------------------------------------------------------------------------------------
  "build.subject": { en: "About", fr: "Sujet" },
  "build.rows": { en: "Rows", fr: "Lignes" },
  "build.measure": { en: "Figure", fr: "Chiffre" },
  "build.show": { en: "Show", fr: "Afficher" },
  "build.top": { en: "Rows shown", fr: "Lignes affichées" },
  "build.top_n": { en: "The {n} largest", fr: "Les {n} plus grands" },
  "build.compare": { en: "Compare with (up to {n})", fr: "Comparer avec (jusqu'à {n})" },
  "build.apply": { en: "Show this view", fr: "Afficher cette vue" },
  "build.buyer": { en: "Buyer", fr: "Acheteur" },
  "build.segment_choose": { en: "Choose a segment", fr: "Choisir un segment" },
  "build.org": { en: "Organization", fr: "Organisation" },
  "build.buyer_choose": { en: "Choose a buyer", fr: "Choisir un acheteur" },
  "build.org_hint": {
    en: "Its id (org- and ten characters) or the address of its page.",
    fr: "Son identifiant (org- et dix caractères) ou l'adresse de sa page.",
  },
  // The link from a buyer's or an organization's analytics view to the same subject, source and period in the
  // builder (src/pages/analytics.tsx), for an Ultra reader while the switch is on.
  "build.open": { en: "Open in the builder", fr: "Ouvrir dans le générateur" },

  "build.subject_all": { en: "Every buyer", fr: "Tous les acheteurs" },
  "build.subject_buyer": { en: "One buyer", fr: "Un acheteur" },
  "build.subject_buyers": { en: "Up to five buyers", fr: "Jusqu'à cinq acheteurs" },
  "build.subject_segment": { en: "One segment", fr: "Un segment" },
  "build.subject_buyer_segment": { en: "One buyer in one segment", fr: "Un acheteur dans un segment" },
  "build.subject_org": { en: "One organization", fr: "Une organisation" },
  "build.subject_orgs": { en: "Up to five organizations", fr: "Jusqu'à cinq organisations" },

  "build.rows_year": { en: "Fiscal year", fr: "Exercice" },
  "build.rows_quarter": { en: "Fiscal quarter", fr: "Trimestre d'exercice" },
  "build.rows_buyer": { en: "Buyer", fr: "Acheteur" },
  "build.rows_province": { en: "Province of delivery", fr: "Province de livraison" },
  "build.rows_method": { en: "Procurement method", fr: "Méthode d'approvisionnement" },
  "build.rows_competitive": { en: "Competitive or not", fr: "Concurrentiel ou non" },
  "build.rows_organization": { en: "Organization", fr: "Organisation" },
  "build.rows_none": { en: "None: one figure", fr: "Aucune : un seul chiffre" },
  // The rows in a view's title, after its figure ("Median value by segment").
  "build.by_year": { en: "by fiscal year", fr: "par exercice" },
  "build.by_quarter": { en: "by fiscal quarter", fr: "par trimestre d'exercice" },
  "build.by_segment": { en: "by segment", fr: "par segment" },
  "build.by_buyer": { en: "by buyer", fr: "par acheteur" },
  "build.by_province": { en: "by province of delivery", fr: "par province de livraison" },
  "build.by_method": { en: "by procurement method", fr: "par méthode d'approvisionnement" },
  "build.by_competitive": { en: "competitive or not", fr: "concurrentiel ou non" },
  "build.by_organization": { en: "by organization", fr: "par organisation" },

  "build.measure_nc": { en: "Non-competitive share, by count and by value", fr: "Part non concurrentielle, en nombre et en valeur" },
  "build.largest_share": {
    en: "Share of the value held by the 1, 5 and 10 organizations with the largest values",
    fr: "Part de la valeur détenue par les 1, 5 et 10 organisations aux valeurs les plus élevées",
  },
  // The two long figures' names in a view's title, before its rows ("Non-competitive share by segment").
  "build.title_nc": { en: "Non-competitive share", fr: "Part non concurrentielle" },
  "build.title_largest": { en: "Share of the value held by the largest organizations", fr: "Part de la valeur détenue par les plus grandes organisations" },
  "build.measure_amendments": { en: "Change in value through amendments", fr: "Variation de la valeur par modifications" },

  "build.show_bars": { en: "Bars", fr: "Barres" },
  "build.show_line": { en: "Line", fr: "Courbe" },
  "build.show_ranked": { en: "Sorted bars", fr: "Barres triées" },
  "build.show_number": { en: "One number", fr: "Un seul nombre" },
  "build.show_table": { en: "Table", fr: "Tableau" },

  // -- why a view is not drawn ---------------------------------------------------------------------
  "build.not_offered": { en: "This combination is not offered: {why}", fr: "Cette combinaison n'est pas offerte : {why}" },
  "build.why_sum": {
    en: "a median, a count of organizations or a share of the largest organizations cannot be added across years, so choose one fiscal year.",
    fr: "une médiane, un nombre d'organisations ou une part des plus grandes organisations ne s'additionnent pas d'une année à l'autre; choisissez donc un seul exercice.",
  },
  "build.why_source": { en: "{source} does not record this.", fr: "{source} ne consigne pas cette donnée." },
  "build.why_rows": { en: "these rows are not offered for this subject.", fr: "ces lignes ne sont pas offertes pour ce sujet." },
  "build.why_measure": { en: "this figure is not offered by these rows for this subject.", fr: "ce chiffre n'est pas offert selon ces lignes pour ce sujet." },
  "build.why_quarters": {
    en: "fiscal quarters are offered for periods of up to {n} fiscal years.",
    fr: "les trimestres d'exercice sont offerts pour des périodes d'au plus {n} exercices.",
  },
  "build.choose_buyer": { en: "Choose a buyer from the list to see its figures.", fr: "Choisissez un acheteur dans la liste pour voir ses chiffres." },
  "build.choose_segment": { en: "Choose a segment to see its figures.", fr: "Choisissez un segment pour voir ses chiffres." },
  "build.choose_org": {
    en: "Enter an organization's id or the address of its page to see its figures.",
    fr: "Inscrivez l'identifiant d'une organisation ou l'adresse de sa page pour voir ses chiffres.",
  },

  // -- the result ---------------------------------------------------------------------------------------
  // {source} is the source as the line reads it, in lower case with its article (build.from_*): "Figures from the
  // award notices", "Chiffres tirés de l'historique des contrats de SPAC".
  "build.as_of": { en: "Figures from {source}, fiscal years {first} to {last}, as of {date}.", fr: "Chiffres tirés {source}, exercices {first} à {last}, au {date}." },
  "build.from_awards": { en: "the award notices", fr: "des avis d'attribution" },
  "build.from_history": { en: "the PSPC contract history", fr: "de l'historique des contrats de SPAC" },
  "build.from_contracts": { en: "the published contracts", fr: "des contrats publiés" },
  "build.from_grants": { en: "the grants and contributions", fr: "des subventions et contributions" },
  // The link in the line under a view, to the Methodology page's section on analytics, named for where it leads.
  "build.rules_link": { en: "the Analytics section of the Methodology page", fr: "la section Analyses de la page Méthodologie" },
  // The empty boxes of a comparison of organizations: what each takes.
  "build.org_placeholder": { en: "org-… or its page's address", fr: "org-… ou l'adresse de sa page" },
  "build.as_of_ending": {
    en: "Contracts ending by the radar's rule, each contract once across the three contract sources, as of {date}.",
    fr: "Contrats prenant fin selon la règle du radar, chaque contrat une seule fois dans les trois sources de contrats, au {date}.",
  },
  "build.places_note": {
    en: "A notice that names several provinces counts in each, so the provinces are not added together.",
    fr: "Un avis qui nomme plusieurs provinces compte dans chacune; les provinces ne sont donc pas additionnées.",
  },
  "build.segments_note": {
    en: "A notice whose codes reach several segments counts in each, so the segments are not added together.",
    fr: "Un avis dont les codes touchent plusieurs segments compte dans chacun; les segments ne sont donc pas additionnés.",
  },
  "build.withheld_note": {
    en: "A supplier withheld as a person counts in the totals and is named in no row.",
    fr: "Un fournisseur dont le nom est retenu parce qu'il s'agit d'une personne compte dans les totaux et ne figure dans aucune ligne.",
  },
  "build.orgs_note": {
    en: "Organizations named in the records; a supplier withheld as a person is not counted as one.",
    fr: "Organisations nommées dans les dossiers; un fournisseur dont le nom est retenu parce qu'il s'agit d'une personne n'est pas compté.",
  },
  "build.largest_note": {
    en: "Each share is of the value of every record of the year, those of suppliers withheld as persons included.",
    fr: "Chaque part est celle de la valeur de tous les dossiers de l'exercice, y compris ceux des fournisseurs dont le nom est retenu.",
  },
  "build.competitive_note": {
    en: "Value: the counted values above zero, as the non-competitive share counts them.",
    fr: "Valeur : les valeurs comptées supérieures à zéro, comme la part non concurrentielle les compte.",
  },
  "build.top_note": { en: "The {n} with the largest values in the period, sorted by the figure.", fr: "Les {n} aux valeurs les plus élevées pour la période, triés selon le chiffre." },
  "build.none": { en: "No record of this view in these fiscal years.", fr: "Aucun dossier pour cette vue et ces exercices." },
  "build.province_none": { en: "No province named", fr: "Aucune province nommée" },
  "build.in_segment": { en: "{buyer}, segment {segment}", fr: "{buyer}, dans le segment {segment}" },
  "build.the_set": { en: "The buyers or organizations compared", fr: "Les acheteurs ou organisations comparés" },
  "build.col_subject": { en: "About", fr: "Sujet" },
  "build.col_top1": { en: "Largest organization", fr: "Principale organisation" },
  "build.col_top5": { en: "Five largest", fr: "Cinq principales" },
  "build.col_top10": { en: "Ten largest", fr: "Dix principales" },
  "build.col_change": { en: "Change", fr: "Variation" },
  "build.col_period": { en: "Fiscal years {first} to {last}", fr: "Exercices {first} à {last}" },
  "build.chart_aria": { en: "Chart of the view", fr: "Graphique de la vue" },

  // -- a view kept on the account (src/account/build_views.tsx), for an Ultra reader while the switch is on ------------
  // The result's second Add to dashboard (account/dashboard_add.tsx), where the view gives one figure a fiscal year.
  "build.add_figure": { en: "Add its latest figure to dashboard", fr: "Ajouter son dernier chiffre au tableau de bord" },
  // Beside the organization's field: the dashboard's find page, whose matches open in the builder.
  "build.find_org": { en: "Find an organization by name", fr: "Trouver une organisation par son nom" },
  // A tile of one figure (kind "number", pages/builder.tsx figureBody) of a whole fiscal year: its change from the
  // fiscal year before ({change} with its sign: "+12%", "-3", "+2 percentage points"; {fy} that year), in words that
  // say how it moved.
  "build.change": { en: "{change} from {fy}", fr: "{change} par rapport à {fy}" },
  "build.change_same": { en: "No change from {fy}", fr: "Aucune variation par rapport à {fy}" },
  "build.change_none": { en: "No figure for {fy} to compare with", fr: "Aucun chiffre de {fy} auquel comparer" },
  "build.points_one": { en: "{n} percentage point", fr: "{n} point de pourcentage" },
  "build.points": { en: "{n} percentage points", fr: "{n} points de pourcentage" },
  // Under a figure of the year to date, which is never set against a whole year: the year before in full, its own
  // figure ({figure} in its own form: "$53.5M", "11", "18%"), comparing nothing.
  "build.full_year": { en: "{fy}, the full year: {figure}", fr: "{fy}, l'exercice complet : {figure}" },
  "build.full_year_none": { en: "{fy}, the full year: no figure", fr: "{fy}, l'exercice complet : aucun chiffre" },
  // The site's label of a saved view of the builder, before its source and period (pages/builder.tsx buildLabel):
  // what it is about, then its title.
  "build.label_name": { en: "{subject}: {title}", fr: "{subject} : {title}" },
  // Under the builder's Save field (account/view_pages.tsx SaveViewRow): {n} the most a typed name holds (NAME_MAX),
  // {max} the most the site's label holds (BUILD_LABEL_MAX). The placeholder is a name that fits the field.
  "build.name_hint": {
    en: "Up to {n} characters. Left empty, the view takes the site's label, of up to {max} characters.",
    fr: "Jusqu'à {n} caractères. Laissé vide, la vue prend l'étiquette du site, d'au plus {max} caractères.",
  },
  // A saved view of the builder on /account/views (account/view_pages.tsx): its email, which is not offered.
  "build.view_no_mail": { en: "Not sent by email.", fr: "Non envoyée par courriel." },
} as const;
