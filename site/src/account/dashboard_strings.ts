// The dashboard's strings (src/account/dashboard.tsx, docs/accounts.md,
// Dashboard), in English and French, spread into the site's dictionary
// (src/i18n.ts) as the accounts module's are. French is written with plain
// spaces and straight apostrophes; the dictionary's typography pass adds the
// Canadian French forms when they are read. None of these reach a page while
// the switch is off, and none while no account holds Ultra and Ultra is not
// on sale. The page's script (public/dashboard.js) reads the dash.say_*,
// dash.status_* and dash.js_* ones from the page's data block.

export const DASHBOARD_STRINGS = {
  // The rail's item, first in "Your lists", with the Ultra chip (src/layout.tsx Rail).
  "rail.dashboard": { en: "Dashboard", fr: "Tableau de bord" },
  // The Ultra card's own row (src/pro.tsx PLAN_ROWS, dashboardsWording), and the Ultra message's line: the plan's own
  // dashboards ({n}) and tiles a dashboard ({tiles}), the key chosen by the two figures so a 1 reads in the singular.
  "plans.dashboards": { en: "{n} dashboards of {tiles} tiles each", fr: "{n} tableaux de bord de {tiles} tuiles chacun" },
  "plans.dashboards_tile": { en: "{n} dashboards of {tiles} tile each", fr: "{n} tableaux de bord de {tiles} tuile chacun" },
  "plans.dashboard_one": { en: "{n} dashboard of {tiles} tiles", fr: "{n} tableau de bord de {tiles} tuiles" },
  "plans.dashboard_one_tile": { en: "{n} dashboard of {tiles} tile", fr: "{n} tableau de bord de {tiles} tuile" },

  // -- the page -------------------------------------------------------------------------
  "dash.title": { en: "Dashboard", fr: "Tableau de bord" },
  "dash.lead": {
    en: "Tiles from your saved searches, watches, the lists of contracts ending, the tables of analytics views, briefings, your organization's page and your own notes. Drag a tile by its grip to move it and by its corner to size it, or use its menu.",
    fr: "Des tuiles tirées de vos recherches enregistrées, de vos suivis, des listes de contrats prenant fin, des tableaux des vues d'analyse, des bulletins, de la page de votre organisation et de vos propres notes. Faites glisser une tuile par sa poignée pour la déplacer et par son coin pour la redimensionner, ou servez-vous de son menu.",
  },
  "dash.starter": {
    en: "These are the tiles a dashboard starts with. Your first change keeps them as your own.",
    fr: "Voici les tuiles de départ d'un tableau de bord. Votre premier changement les garde comme les vôtres.",
  },
  // Emptied by the reader: no tile left.
  "dash.empty": {
    en: "The dashboard has no tile. Add a Tile puts one here.",
    fr: "Le tableau de bord n'a aucune tuile. Le bouton Ajouter une tuile en ajoute une ici.",
  },
  "dash.add_tile": { en: "Add a Tile", fr: "Ajouter une tuile" },
  "dash.add_label": { en: "What the tile shows", fr: "Ce que montre la tuile" },
  "dash.add": { en: "Add", fr: "Ajouter" },
  "dash.add_here": { en: "Add to dashboard", fr: "Ajouter au tableau de bord" },
  // Add a Tile's three groups (dashboard.tsx AddTile): what the account holds, the analytics tables, a text.
  "dash.add_lists": { en: "From Your Lists", fr: "Depuis vos listes" },
  "dash.add_analytics": { en: "Analytics", fr: "Analyses" },
  "dash.add_analytics_line": {
    en: "Each table and chart of an analytics view has its own Add to dashboard: open a view from {link}.",
    fr: "Chaque tableau et chaque graphique d'une vue d'analyse a sa propre commande Ajouter au tableau de bord : ouvrez une vue depuis {link}.",
  },
  "dash.add_text": { en: "Text", fr: "Texte" },
  // A text tile (dashboard.tsx TextTile): the field, its note, the menu's Edit and the form's Save.
  "dash.text_label": { en: "A heading or a note", fr: "Un titre ou une note" },
  "dash.text_note": {
    en: "Plain text, {n} characters at most. A single short line shows as a heading.",
    fr: "Texte brut, {n} caractères au plus. Une seule ligne courte s'affiche comme un titre.",
  },
  "dash.text_edit": { en: "Edit", fr: "Modifier" },
  "dash.text_save": { en: "Save", fr: "Enregistrer" },
  "dash.text_empty_tile": { en: "This note is empty. Edit it from the tile's menu.", fr: "Cette note est vide. Modifiez-la depuis le menu de la tuile." },
  // What an add of a text says when it adds nothing: no text typed; the grid's tables absent.
  "dash.text_empty": { en: "Type a heading or a note to add it.", fr: "Tapez un titre ou une note pour l'ajouter." },
  "dash.text_unsaved": {
    en: "A note can be kept once the dashboard can save positions and sizes.",
    fr: "Une note pourra être conservée quand le tableau de bord pourra enregistrer les positions et les tailles.",
  },
  // The foot of an analytics table of contracts ending, which follow neither the source nor the period: their first day.
  "dash.meta_due": { en: "Contracts ending from {date}", fr: "Contrats prenant fin à partir du {date}" },
  "dash.added": { en: "Added to the dashboard.", fr: "Ajouté au tableau de bord." },
  "dash.count": { en: "{n} of {cap} tiles", fr: "{n} tuiles sur {cap}" },
  "dash.full": {
    en: "The dashboard holds its {cap} tiles. Remove one to add another.",
    fr: "Le tableau de bord contient ses {cap} tuiles. Retirez-en une pour en ajouter une autre.",
  },
  "dash.none_left": {
    en: "Everything you hold is on the dashboard already.",
    fr: "Tout ce que vous avez est déjà au tableau de bord.",
  },
  "dash.briefings_full": { en: "A dashboard shows at most {n} briefings.", fr: "Un tableau de bord présente au plus {n} bulletins." },
  "dash.gone": { en: "What this tile showed was removed.", fr: "Ce que cette tuile montrait a été retiré." },
  "dash.unavailable": { en: "This tile cannot be read right now.", fr: "Cette tuile ne peut pas être lue pour le moment." },
  // The accounts database without the dashboard's tables: nothing about the layout is kept.
  "dash.unsaved": {
    en: "The dashboard cannot be saved yet; this is the starting layout.",
    fr: "Le tableau de bord ne peut pas encore être enregistré; voici la disposition de départ.",
  },
  // The database holds the panels' table but not the tiles': tiles can be added and removed, not placed or sized.
  "dash.unsaved_layout": {
    en: "Positions and sizes cannot be saved yet: you can arrange the tiles here, and they go back to their places when the page is loaded again.",
    fr: "Les positions et les tailles ne peuvent pas encore être enregistrées : vous pouvez disposer les tuiles ici, et elles reprennent leur place quand la page est chargée de nouveau.",
  },
  "dash.open": { en: "Open", fr: "Ouvrir" },
  // A list cut to what its tile holds: the rows shown, of all there are.
  "dash.shown": { en: "{n} of {total}", fr: "{n} sur {total}" },
  // The watches tile when no watch had an event in the week's data dates.
  "dash.none_week": { en: "No event on your watches this week.", fr: "Aucun événement sur vos suivis cette semaine." },

  // -- the dashboards' row (dashboard.tsx BoardTabs) -------------------------------------------
  "dash.boards_nav": { en: "Your dashboards", fr: "Vos tableaux de bord" },
  // The name of a dashboard the reader has not named, numbered in the order the account made them.
  "dash.board_n": { en: "Dashboard {n}", fr: "Tableau de bord {n}" },
  "dash.board_new": { en: "New dashboard", fr: "Nouveau tableau de bord" },
  "dash.board_edit": { en: "Rename, order or delete", fr: "Renommer, classer ou supprimer" },
  "dash.board_name": { en: "Name", fr: "Nom" },
  "dash.board_name_note": {
    en: "{n} characters at most. Left empty, it is named {label}.",
    fr: "{n} caractères au plus. Laissé vide, il se nomme {label}.",
  },
  "dash.board_rename": { en: "Rename", fr: "Renommer" },
  "dash.board_earlier": { en: "Move earlier", fr: "Placer avant" },
  "dash.board_later": { en: "Move later", fr: "Placer après" },
  "dash.board_delete": { en: "Delete this dashboard", fr: "Supprimer ce tableau de bord" },
  // The question inside Delete this dashboard, by the dashboard's count of tiles.
  "dash.board_delete_q": { en: "Delete the dashboard {name} and its {n} tiles?", fr: "Supprimer le tableau de bord {name} et ses {n} tuiles?" },
  "dash.board_delete_q_one": { en: "Delete the dashboard {name} and its tile?", fr: "Supprimer le tableau de bord {name} et sa tuile?" },
  "dash.board_delete_q_none": { en: "Delete the dashboard {name}?", fr: "Supprimer le tableau de bord {name}?" },
  "dash.board_delete_last": {
    en: "It is the account's only dashboard: its tiles are removed and it stays, empty.",
    fr: "C'est le seul tableau de bord du compte : ses tuiles sont retirées et il reste, vide.",
  },
  "dash.board_delete_yes": { en: "Delete", fr: "Supprimer" },
  // What a post on the dashboards says once it is done ({boards}: the plan's figure; {name}: the dashboard named).
  "dash.boards_full": {
    en: "The account holds its {boards} dashboards. Delete one to make another.",
    fr: "Le compte contient ses {boards} tableaux de bord. Supprimez-en un pour en créer un autre.",
  },
  "dash.board_renamed": { en: "The dashboard was renamed.", fr: "Le tableau de bord a été renommé." },
  "dash.board_deleted": { en: "The dashboard was deleted.", fr: "Le tableau de bord a été supprimé." },
  "dash.board_emptied": {
    en: "The dashboard's tiles were removed. It is the account's only dashboard, so it stays.",
    fr: "Les tuiles du tableau de bord ont été retirées. C'est le seul tableau de bord du compte : il reste.",
  },
  "dash.moved": { en: "The tile was moved to {name}.", fr: "La tuile a été déplacée vers {name}." },
  "dash.move_exists": { en: "The dashboard {name} shows this already.", fr: "Le tableau de bord {name} présente déjà ce contenu." },
  "dash.move_full": {
    en: "The dashboard {name} holds its {cap} tiles. Remove one there to make room.",
    fr: "Le tableau de bord {name} contient ses {cap} tuiles. Retirez-en une là pour faire de la place.",
  },

  // -- a tile's handles and its menu (dashboard.tsx DashTile) -------------------------------------
  "dash.grip": { en: "Move: {title}", fr: "Déplacer : {title}" },
  "dash.corner": { en: "Resize: {title}", fr: "Redimensionner : {title}" },
  "dash.menu": { en: "Options: {title}", fr: "Options : {title}" },
  "dash.keys_move": {
    en: "Enter or Space picks the tile up, the arrow keys move it, Enter drops it and Escape puts it back.",
    fr: "Entrée ou Espace prend la tuile, les flèches la déplacent, Entrée la dépose et Échap la remet en place.",
  },
  "dash.keys_size": {
    en: "Enter or Space picks the corner up, the arrow keys size the tile, Enter drops it and Escape puts it back.",
    fr: "Entrée ou Espace prend le coin, les flèches redimensionnent la tuile, Entrée la dépose et Échap la remet en place.",
  },
  "dash.left": { en: "Move left", fr: "Déplacer à gauche" },
  "dash.right": { en: "Move right", fr: "Déplacer à droite" },
  "dash.up": { en: "Move up", fr: "Monter" },
  "dash.down": { en: "Move down", fr: "Descendre" },
  "dash.wider": { en: "Wider", fr: "Plus large" },
  "dash.narrower": { en: "Narrower", fr: "Plus étroite" },
  "dash.taller": { en: "Taller", fr: "Plus haute" },
  "dash.shorter": { en: "Shorter", fr: "Moins haute" },
  "dash.remove": { en: "Remove", fr: "Retirer" },
  // Move To: the head of the other dashboards' names in a tile's menu, and each name's words for assistive technology.
  "dash.move_to": { en: "Move to", fr: "Déplacer vers" },
  "dash.move_to_name": { en: "Move to {name}", fr: "Déplacer vers {name}" },

  // -- what the page's script says (public/dashboard.js): the status line and the live region -------------------
  "dash.status_saving": { en: "Saving the layout.", fr: "Enregistrement de la disposition." },
  "dash.status_saved": { en: "Saved.", fr: "Enregistré." },
  "dash.status_failed": { en: "The layout could not be saved.", fr: "La disposition n'a pas pu être enregistrée." },
  "dash.status_local": {
    en: "Arranged on this page only: positions and sizes cannot be saved yet.",
    fr: "Disposé sur cette page seulement : les positions et les tailles ne peuvent pas encore être enregistrées.",
  },
  "dash.status_undone": { en: "Undone.", fr: "Annulé." },
  "dash.js_undo": { en: "Undo", fr: "Annuler" },
  "dash.js_retry": { en: "Try again", fr: "Réessayer" },
  "dash.say_picked": {
    en: "{title} picked up. The arrow keys move it, Enter drops it, Escape puts it back.",
    fr: "Tuile « {title} » prise. Les flèches la déplacent, Entrée la dépose, Échap la remet en place.",
  },
  "dash.say_picked_size": {
    en: "{title}: corner picked up. The arrow keys size it, Enter drops it, Escape puts it back.",
    fr: "Coin de la tuile « {title} » pris. Les flèches la redimensionnent, Entrée la dépose, Échap la remet en place.",
  },
  "dash.say_at": { en: "{title}: column {x} of {cols}, row {y}.", fr: "{title} : colonne {x} sur {cols}, rangée {y}." },
  "dash.say_size": { en: "{title}: {w} columns wide, {h} rows high.", fr: "{title} : {w} colonnes de large, {h} rangées de haut." },
  "dash.say_dropped": { en: "{title} dropped.", fr: "Tuile « {title} » déposée." },
  "dash.say_back": { en: "{title} put back.", fr: "Tuile « {title} » remise en place." },

  // -- each tile's kind, in its head (dashboard.tsx PANEL_KINDS) ---------------------------------
  "dash.kind_tenders": { en: "Saved search: open notices", fr: "Recherche enregistrée : avis ouverts" },
  "dash.kind_radar": { en: "Contracts ending", fr: "Contrats prenant fin" },
  "dash.kind_records": { en: "Saved search: records", fr: "Recherche enregistrée : dossiers" },
  "dash.kind_watches": { en: "Your watches this week", fr: "Vos suivis cette semaine" },
  "dash.kind_view": { en: "Analytics view", fr: "Vue d'analyse" },
  "dash.kind_briefing": { en: "Weekly briefing, this week so far", fr: "Bulletin hebdomadaire, semaine en cours" },
  "dash.kind_org": { en: "Your organization: {block}", fr: "Votre organisation : {block}" },
  "dash.kind_matches": { en: "Matching notices", fr: "Avis correspondants" },
  "dash.kind_api": { en: "API requests today", fr: "Requêtes à l'API aujourd'hui" },
  "dash.kind_text": { en: "Your note", fr: "Votre note" },

  // -- More Kinds of Tile (dashboard.tsx moreKinds): each kind the account cannot add yet, the one step that
  // gives it what the tile shows, and the page where that is done ({link}, its words the _link key) ----------
  "dash.more_title": { en: "More Kinds of Tile", fr: "Autres genres de tuiles" },
  "dash.more_tenders": {
    en: "A tender search's open notices: save a search on the {link}.",
    fr: "Les avis ouverts d'une recherche d'appels d'offres : enregistrez une recherche sur la {link}.",
  },
  "dash.more_tenders_link": { en: "tender list", fr: "liste des appels d'offres" },
  "dash.more_radar": {
    en: "A filtered list of contracts ending: save a search on a {link}.",
    fr: "Une liste filtrée de contrats prenant fin : enregistrez une recherche sur une {link}.",
  },
  "dash.more_radar_link": { en: "list of contracts ending", fr: "liste de contrats prenant fin" },
  "dash.more_records": {
    en: "An organization's, a buyer's or a segment's records: paste the address of its page into Add a Search on {link}.",
    fr: "Les dossiers d'une organisation, d'un acheteur ou d'un segment : collez l'adresse de sa page dans Ajouter une recherche, sur {link}.",
  },
  "dash.more_records_link": { en: "your saved searches", fr: "vos recherches enregistrées" },
  "dash.more_view": {
    en: "A table or chart of an analytics view: open a view from {link} and choose Add to dashboard on it.",
    fr: "Un tableau ou un graphique d'une vue d'analyse : ouvrez une vue depuis {link} et choisissez Ajouter au tableau de bord sur celui-ci.",
  },
  "dash.more_view_link": { en: "Analytics", fr: "Analyses" },
  "dash.more_briefing": {
    en: "A weekly briefing, this week so far: save a briefing on a {link} or a buyer's page.",
    fr: "Un bulletin hebdomadaire, semaine en cours : enregistrez un bulletin sur la {link} ou celle d'un acheteur.",
  },
  "dash.more_briefing_link": { en: "segment's page", fr: "page d'un segment" },
  "dash.more_org": {
    en: "Your organization's figures and matching notices: {link}.",
    fr: "Les chiffres de votre organisation et les avis correspondants : {link}.",
  },
  "dash.more_org_link": { en: "choose your organization", fr: "choisissez votre organisation" },
  "dash.more_api": {
    en: "API requests today: create a key on the {link} page.",
    fr: "Les requêtes à l'API aujourd'hui : créez une clé sur la page {link}.",
  },
  "dash.more_api_link": { en: "API Keys", fr: "Clés d'API" },

  // -- what a Free or Pro reader sees -------------------------------------------------------------
  "dash.what_title": { en: "What the Dashboard Holds", fr: "Ce que contient le tableau de bord" },
  // {line} is Ultra's plan line (src/pro.tsx dashboardsWording): "5 dashboards of 24 tiles each".
  "dash.what_lead": {
    en: "Pages of tiles you choose from what the site already shows you: {line}.",
    fr: "Des pages de tuiles que vous choisissez parmi ce que le site vous montre déjà : {line}.",
  },
  // The kinds, one sentence each, in PANEL_KINDS order (an earlier view's tile is an analytics table's). A list shows
  // as many rows as its size holds.
  "dash.what_tenders": {
    en: "A saved tender search: how many open notices match it, and the ones closing soonest, as many as its size holds.",
    fr: "Une recherche d'appels d'offres enregistrée : combien d'avis ouverts y correspondent, et les prochains à fermer, autant que sa taille en contient.",
  },
  "dash.what_radar": {
    en: "A list of contracts ending, or a saved search of one: its count and counted value, and the ones ending soonest, as many as its size holds.",
    fr: "Une liste de contrats prenant fin, ou une recherche enregistrée de l'une d'elles : leur nombre et leur valeur comptée, et les prochains à prendre fin, autant que sa taille en contient.",
  },
  "dash.what_records": {
    en: "A saved search of an organization, a buyer or a segment: its records by source over the last two fiscal years.",
    fr: "Une recherche enregistrée d'une organisation, d'un acheteur ou d'un segment : ses dossiers par source au cours des deux derniers exercices.",
  },
  "dash.what_watches": {
    en: "Your watches: the week's events by kind, and the newest, as many as its size holds.",
    fr: "Vos suivis : les événements de la semaine par genre, et les derniers, autant que sa taille en contient.",
  },
  "dash.what_analytic": {
    en: "A table or chart of a buyer's, an organization's or a segment's analytics, drawn in full at the source and period you chose, as many rows as its size holds.",
    fr: "Un tableau ou un graphique des analyses d'un acheteur, d'une organisation ou d'un segment, tracé en entier avec la source et la période choisies, autant de lignes que sa taille en contient.",
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
    en: "Matching notices: the open notices closest to your organization's records, as many as its size holds.",
    fr: "Avis correspondants : les avis ouverts qui correspondent le mieux aux dossiers de votre organisation, autant que sa taille en contient.",
  },
  "dash.what_api": {
    en: "The API: each key's requests today and the plan's daily cap.",
    fr: "L'API : les requêtes de chaque clé aujourd'hui et le plafond quotidien du forfait.",
  },
  "dash.what_text": { en: "A heading or a note you type.", fr: "Un titre ou une note que vous tapez." },
  "dash.gate": { en: "The dashboard is part of Ultra.", fr: "Le tableau de bord fait partie d'Ultra." },
  // The privacy page's line (account/privacy.tsx), while Ultra is on sale.
  "dash.privacy": {
    en: "A dashboard keeps the name you give it, its place among your dashboards, the tiles you chose, the position and size of each, each tile's own choices and the text of a note you type. A tile names a saved search, a briefing, an analytics view's address and one of its tables, or a block of your organization's page. The dashboards and their tiles are deleted with the account.",
    fr: "Un tableau de bord conserve le nom que vous lui donnez, sa place parmi vos tableaux de bord, les tuiles que vous avez choisies, la position et la taille de chacune, les choix propres à chaque tuile et le texte d'une note que vous tapez. Une tuile nomme une recherche enregistrée, un bulletin, l'adresse d'une vue d'analyse et l'un de ses tableaux, ou un bloc de la page de votre organisation. Les tableaux de bord et leurs tuiles sont supprimés avec le compte.",
  },
} as const satisfies Record<string, { en: string; fr: string }>;
