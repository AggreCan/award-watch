// The dashboard's strings (src/account/dashboard.tsx, docs/accounts.md,
// Dashboard), in English and French, spread into the site's dictionary
// (src/i18n.ts) as the accounts module's are. French is written with plain
// spaces and straight apostrophes; the dictionary's typography pass adds the
// Canadian French forms when they are read. None of these reach a page while
// the switch is off, and none while no account holds Ultra and Ultra is not
// on sale.

export const DASHBOARD_STRINGS = {
  // The rail's item, first in "Your lists", with the Ultra chip (src/layout.tsx Rail).
  "rail.dashboard": { en: "Dashboard", fr: "Tableau de bord" },
  // The Ultra card's own row (src/pro.tsx PLAN_ROWS), and the Ultra message's line: the plan's own figure.
  "plans.dashboard": { en: "A dashboard of up to {n} panels", fr: "Tableau de bord de {n} panneaux au plus" },

  // -- the page -------------------------------------------------------------------------
  "dash.title": { en: "Dashboard", fr: "Tableau de bord" },
  "dash.lead": {
    en: "The panels you chose from your saved searches, watches, the lists of contracts ending, analytics views, briefings and your organization's page.",
    fr: "Les panneaux que vous avez choisis parmi vos recherches enregistrées, vos suivis, les listes de contrats prenant fin, les vues d'analyse, les bulletins et la page de votre organisation.",
  },
  "dash.starter": {
    en: "These are the panels a dashboard starts with. Edit the dashboard to choose your own.",
    fr: "Voici les panneaux de départ d'un tableau de bord. Modifiez-le pour choisir les vôtres.",
  },
  "dash.edit": { en: "Edit the dashboard", fr: "Modifier le tableau de bord" },
  "dash.done": { en: "Done", fr: "Terminé" },
  "dash.add_panel": { en: "Add a Panel", fr: "Ajouter un panneau" },
  "dash.add": { en: "Add", fr: "Ajouter" },
  "dash.add_here": { en: "Add to dashboard", fr: "Ajouter au tableau de bord" },
  "dash.added": { en: "Added to the dashboard.", fr: "Ajouté au tableau de bord." },
  "dash.up": { en: "Move up", fr: "Monter" },
  "dash.down": { en: "Move down", fr: "Descendre" },
  "dash.wide": { en: "Full width", fr: "Pleine largeur" },
  "dash.narrow": { en: "Half width", fr: "Demi-largeur" },
  "dash.remove": { en: "Remove", fr: "Retirer" },
  "dash.count": { en: "{n} of {cap} panels", fr: "{n} panneaux sur {cap}" },
  "dash.full": {
    en: "The dashboard holds its {cap} panels. Remove one to add another.",
    fr: "Le tableau de bord contient ses {cap} panneaux. Retirez-en un pour en ajouter un autre.",
  },
  "dash.briefings_full": { en: "A dashboard shows at most {n} briefings.", fr: "Un tableau de bord présente au plus {n} bulletins." },
  "dash.gone": { en: "What this panel showed was removed.", fr: "Ce que ce panneau montrait a été retiré." },
  "dash.unavailable": { en: "This panel cannot be read right now.", fr: "Ce panneau ne peut pas être lu pour le moment." },
  "dash.unsaved": {
    en: "The layout cannot be saved yet; this is the starting layout.",
    fr: "La disposition ne peut pas encore être enregistrée; voici la disposition de départ.",
  },
  "dash.see_all": { en: "See all", fr: "Tout voir" },
  // The watches panel when no watch had an event in the week's data dates.
  "dash.none_week": { en: "No event on your watches this week.", fr: "Aucun événement sur vos suivis cette semaine." },

  // -- each panel's kind, in its head (dashboard.tsx PANEL_KINDS) ---------------------------------
  "dash.kind_tenders": { en: "Saved search: open notices", fr: "Recherche enregistrée : avis ouverts" },
  "dash.kind_radar": { en: "Contracts ending", fr: "Contrats prenant fin" },
  "dash.kind_records": { en: "Saved search: records", fr: "Recherche enregistrée : dossiers" },
  "dash.kind_watches": { en: "Your watches this week", fr: "Vos suivis cette semaine" },
  "dash.kind_view": { en: "Analytics view", fr: "Vue d'analyse" },
  "dash.kind_briefing": { en: "Weekly briefing, this week so far", fr: "Bulletin hebdomadaire, semaine en cours" },
  "dash.kind_org": { en: "Your organization: {block}", fr: "Votre organisation : {block}" },
  "dash.kind_matches": { en: "Matching notices", fr: "Avis correspondants" },
  "dash.kind_api": { en: "API requests today", fr: "Requêtes à l'API aujourd'hui" },

  // -- what a Free or Pro reader sees -------------------------------------------------------------
  "dash.what_title": { en: "What the Dashboard Holds", fr: "Ce que contient le tableau de bord" },
  "dash.what_lead": {
    en: "One page of up to {cap} panels you choose from what the site already shows you.",
    fr: "Une page d'au plus {cap} panneaux que vous choisissez parmi ce que le site vous montre déjà.",
  },
  // The nine kinds, one sentence each, in PANEL_KINDS order.
  "dash.what_tenders": {
    en: "A saved tender search: how many open notices match it, and the five closing soonest.",
    fr: "Une recherche d'appels d'offres enregistrée : combien d'avis ouverts y correspondent, et les cinq prochains à fermer.",
  },
  "dash.what_radar": {
    en: "A list of contracts ending, or a saved search of one: its count and counted value, and the five ending soonest.",
    fr: "Une liste de contrats prenant fin, ou une recherche enregistrée de l'une d'elles : leur nombre et leur valeur comptée, et les cinq prochains à prendre fin.",
  },
  "dash.what_records": {
    en: "A saved search of an organization, a buyer or a segment: its records by source over the last two fiscal years.",
    fr: "Une recherche enregistrée d'une organisation, d'un acheteur ou d'un segment : ses dossiers par source au cours des deux derniers exercices.",
  },
  "dash.what_watches": {
    en: "Your watches: the week's events by kind, and the five newest.",
    fr: "Vos suivis : les événements de la semaine par genre, et les cinq derniers.",
  },
  "dash.what_view": {
    en: "An analytics view of a buyer, an organization or a segment: its first chart, at the source and period you chose.",
    fr: "Une vue d'analyse d'un acheteur, d'une organisation ou d'un segment : son premier graphique, avec la source et la période choisies.",
  },
  "dash.what_briefing": {
    en: "A weekly briefing: this week's new notices, awards, notable amendments and contracts ending next quarter, as counts.",
    fr: "Un bulletin hebdomadaire : les nouveaux avis, les attributions, les modifications notables et les contrats prenant fin le trimestre prochain, en nombres.",
  },
  "dash.what_org": {
    en: "A block of your organization's page: its records by fiscal year or by segment, its share of a segment, its contracts ending, its buyers or its standing offers.",
    fr: "Un bloc de la page de votre organisation : ses dossiers par exercice ou par segment, sa part d'un segment, ses contrats prenant fin, ses acheteurs ou ses offres à commandes.",
  },
  "dash.what_matches": {
    en: "Matching notices: the five open notices closest to your organization's records.",
    fr: "Avis correspondants : les cinq avis ouverts qui correspondent le mieux aux dossiers de votre organisation.",
  },
  "dash.what_api": {
    en: "The API: each key's requests today and the plan's daily cap.",
    fr: "L'API : les requêtes de chaque clé aujourd'hui et le plafond quotidien du forfait.",
  },
  "dash.gate": { en: "The dashboard is part of Ultra.", fr: "Le tableau de bord fait partie d'Ultra." },
  // The privacy page's line (account/privacy.tsx), while Ultra is on sale.
  "dash.privacy": {
    en: "A dashboard keeps the panels you chose, their order and their width. A panel names a saved search, a briefing, an analytics view's address or a block of your organization's page. The panels are deleted with the account.",
    fr: "Un tableau de bord conserve les panneaux que vous avez choisis, leur ordre et leur largeur. Un panneau nomme une recherche enregistrée, un bulletin, l'adresse d'une vue d'analyse ou un bloc de la page de votre organisation. Les panneaux sont supprimés avec le compte.",
  },
} as const satisfies Record<string, { en: string; fr: string }>;
